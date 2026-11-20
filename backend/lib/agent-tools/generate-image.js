"use strict";

/**
 * generate_image — Bedrock Converse tool dispatcher.
 *
 * Maps a user's intent (prompt + style + aspect) to a Replicate prediction,
 * persisting a JOB row for the existing /replicate/image/status poller. Runs
 * a synchronous fast-path when Replicate returns `succeeded` inside the
 * `Prefer: wait=5` window — extracts the URL, writes the IMG row + signed
 * URL, and returns `imageUrl` so the frontend can skip polling entirely.
 *
 * Also patches the user's `agentState` with `lastStyle` + `lastAspect` so
 * future tool calls bias toward what they've actually chosen.
 */

const { MICRO_USD_PER_USD } = require("../../config/pricing");

// ─── Style → Replicate model key ────────────────────────────────────────────
const STYLE_TO_MODEL_KEY = {
  anime: "wai-nsfw-illustrious-v11",
  manga: "wai-nsfw-illustrious-v11",
  chibi: "animagine",
  photoreal: "seedream-4.5",
};

// ─── Aspect → width/height ──────────────────────────────────────────────────
const ASPECT_TO_SIZE = {
  "1:1": { width: 1024, height: 1024 },
  "3:4": { width: 768, height: 1024 },
  "16:9": { width: 1280, height: 720 },
};

const SEEDREAM_ASPECT_TO_SIZE = {
  "1:1": { width: 2048, height: 2048 },
  "3:4": { width: 2048, height: 2048 },
  "16:9": { width: 2048, height: 1152 },
};

const slugifyPrompt = (prompt = "") =>
  String(prompt)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32) || "agent-image";

const resolveModel = ({ style, aspect, replicateModelConfig }) => {
  const styleKey = STYLE_TO_MODEL_KEY[style] ? style : "anime";
  const modelKey = STYLE_TO_MODEL_KEY[styleKey];
  const modelConfig = replicateModelConfig?.[modelKey];
  if (!modelConfig) throw new Error(`Replicate model '${modelKey}' not configured`);

  const aspectKey = ASPECT_TO_SIZE[aspect] ? aspect : "3:4";
  const sizeMap = modelKey === "seedream-4.5" ? SEEDREAM_ASPECT_TO_SIZE : ASPECT_TO_SIZE;
  const candidate = sizeMap[aspectKey];
  const allowed = (modelConfig.sizes || []).find(
    (s) => s.width === candidate.width && s.height === candidate.height
  );
  const size = allowed || modelConfig.sizes?.[0] || candidate;
  return { modelKey, modelConfig, width: size.width, height: size.height };
};

const persistFinishedImage = async ({ outputUrl, userId, imageName, batchId, prompt, deps }) => {
  const {
    fetchImageBuffer,
    buildImageKey,
    s3Client,
    PutObjectCommand,
    putMediaItem,
    getSignedUrl,
    GetObjectCommand,
  } = deps;
  const mediaBucket = process.env.MEDIA_BUCKET;
  if (!mediaBucket || !s3Client || !fetchImageBuffer) return null;

  try {
    const { buffer, contentType } = await fetchImageBuffer(outputUrl);
    const key = buildImageKey({
      userId,
      provider: "replicate",
      index: 0,
      baseName: imageName,
      batchId,
    });
    await s3Client.send(
      new PutObjectCommand({
        Bucket: mediaBucket,
        Key: key,
        Body: buffer,
        ContentType: contentType,
      })
    );
    await putMediaItem({
      userId,
      type: "IMG",
      key,
      extra: { prompt, model: "agent", agentInitiated: true },
    });
    const signedUrl = await getSignedUrl(
      s3Client,
      new GetObjectCommand({ Bucket: mediaBucket, Key: key }),
      { expiresIn: 900 }
    );
    return { key, url: signedUrl };
  } catch {
    return null;
  }
};

const dispatchGenerateImage = async ({ args, deps, userId }) => {
  const {
    replicateClient,
    replicateModelConfig,
    buildReplicatePredictionRequest,
    buildImageBatchId,
    putMediaItem,
    clampPromptTokens,
    getReplicateOutputUrls,
    DEFAULT_NEGATIVE_PROMPT,
  } = deps;

  if (!userId) return { ok: false, error: "unauthorized" };
  if (!process.env.REPLICATE_API_TOKEN) return { ok: false, error: "replicate_token_missing" };

  const prompt = String(args.prompt || "").trim();
  if (!prompt) return { ok: false, error: "prompt_required" };

  let modelKey;
  let modelConfig;
  let width;
  let height;
  try {
    ({ modelKey, modelConfig, width, height } = resolveModel({
      style: args.style,
      aspect: args.aspect,
      replicateModelConfig,
    }));
  } catch (err) {
    return { ok: false, error: err?.message || "model_resolve_failed" };
  }

  // ── Daily image cap — bounds Replicate spend per user. Reserved atomically
  // (count + 1 before the call); released if the call never starts.
  const reserved = Boolean(deps.agentCost?.reserveImage);
  if (reserved) {
    const verdict = await deps.agentCost.reserveImage(userId);
    if (!verdict.allowed) {
      if (verdict.reason === "unavailable") {
        return {
          ok: false,
          error: "spend_check_unavailable",
          retryAfterMs: verdict.retryAfterMs,
        };
      }
      return {
        ok: false,
        error: "image_daily_cap_reached",
        capacity: verdict.capacity,
        imagesToday: verdict.imagesToday,
        retryAfterMs: verdict.retryAfterMs,
      };
    }
  }
  const releaseImage = () => (reserved ? deps.agentCost.releaseImage?.(userId) : undefined);

  // ── Daily dollar budget (per user). Refunded if Replicate never starts.
  const spendVerdict = await deps.spendBudget?.charge({
    scope: { kind: "user", id: userId },
    priceKey: modelKey,
    provider: "replicate",
    count: 1,
  });
  if (spendVerdict && !spendVerdict.allowed) {
    await releaseImage();
    if (spendVerdict.reason === "unavailable") {
      return {
        ok: false,
        error: "spend_check_unavailable",
        retryAfterMs: spendVerdict.retryAfterMs,
      };
    }
    return {
      ok: false,
      error: "spend_budget_reached",
      retryAfterMs: spendVerdict.retryAfterMs,
      limitUsd: spendVerdict.limitMicroUsd / MICRO_USD_PER_USD,
    };
  }
  const undoSpend = async () => {
    await releaseImage();
    if (spendVerdict?.microUsd > 0) {
      await deps.spendBudget.refund({
        scope: { kind: "user", id: userId },
        dayKey: spendVerdict.dayKey,
        microUsd: spendVerdict.microUsd,
      });
    }
  };

  const trimmedPrompt = clampPromptTokens ? clampPromptTokens(prompt) : prompt;
  const batchId = buildImageBatchId();
  const imageName = slugifyPrompt(trimmedPrompt);
  const seed = Number.isFinite(Number(args.seed))
    ? Number(args.seed)
    : Math.floor(Math.random() * 2147483647);

  const input = modelConfig.buildInput({
    prompt: trimmedPrompt,
    negativePrompt: DEFAULT_NEGATIVE_PROMPT,
    width,
    height,
    numOutputs: 1,
    seed,
    scheduler: modelConfig.schedulers?.[0],
  });

  let prediction;
  try {
    const predictionRequest = buildReplicatePredictionRequest({
      modelId: modelConfig.modelId,
      input,
    });
    prediction = await replicateClient.predictions.create(predictionRequest, {
      headers: { Prefer: "wait=5", "Cancel-After": "10m" },
    });
  } catch (err) {
    await undoSpend();
    return { ok: false, error: err?.message || "replicate_create_failed" };
  }

  if (!prediction?.id) {
    await undoSpend();
    return { ok: false, error: "replicate_no_prediction" };
  }

  if (deps.agentState && userId) {
    deps.agentState
      .patch(userId, { lastStyle: args.style || "anime", lastAspect: args.aspect || "3:4" })
      .catch(() => {});
  }

  const isSucceeded = prediction.status === "succeeded";
  const progressPct = isSucceeded ? 100 : prediction.status === "starting" ? 18 : 42;

  let fastImage = null;
  if (isSucceeded) {
    const urls = (getReplicateOutputUrls && getReplicateOutputUrls(prediction.output)) || [];
    const firstUrl = urls.find(Boolean);
    if (firstUrl) {
      fastImage = await persistFinishedImage({
        outputUrl: firstUrl,
        userId,
        imageName,
        batchId,
        prompt: trimmedPrompt,
        deps,
      });
    }
  }

  const jobKey = `render/replicate/image/${prediction.id}`;
  try {
    await putMediaItem({
      userId,
      type: "JOB",
      key: jobKey,
      extra: {
        provider: "replicate",
        entityType: "image",
        predictionId: prediction.id,
        imageName,
        batchId,
        characterId: null,
        status: fastImage ? "completed" : prediction.status || "starting",
        progressPct: fastImage ? 100 : progressPct,
        etaSeconds: fastImage ? 0 : 75,
        startedAt: new Date().toISOString(),
        ...(fastImage ? { completedAt: new Date().toISOString() } : {}),
        updatedAt: new Date().toISOString(),
        agentInitiated: true,
      },
    });
  } catch {
    // Best-effort; the status endpoint also writes JOB rows on poll.
  }

  return {
    ok: true,
    result: {
      provider: "replicate",
      modelKey,
      modelId: modelConfig.modelId,
      predictionId: prediction.id,
      batchId,
      imageName,
      status: fastImage ? "succeeded" : prediction.status || "starting",
      prompt: trimmedPrompt,
      negativePrompt: DEFAULT_NEGATIVE_PROMPT,
      width,
      height,
      aspect: args.aspect || "3:4",
      style: args.style || "anime",
      seed,
      ...(fastImage ? { imageUrl: fastImage.url, imageKey: fastImage.key } : {}),
    },
  };
};

module.exports = {
  STYLE_TO_MODEL_KEY,
  ASPECT_TO_SIZE,
  SEEDREAM_ASPECT_TO_SIZE,
  dispatchGenerateImage,
};
