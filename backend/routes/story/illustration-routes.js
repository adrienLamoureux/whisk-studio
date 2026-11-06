const { Router } = require("express");
const {
  DEFAULT_STORY_ILLUSTRATION_MODEL,
  STORY_ILLUSTRATION_MODEL_KEYS,
  resolveStoryIllustrationSize,
  signSceneVideoUrl,
  signSceneMusicUrl,
  buildStorySceneImageKey,
  buildSceneResponse,
} = require("./illustration-helpers");
const { startSceneJob } = require("./scene-jobs");
const { parseOptionalNumber, buildSceneMusicPayload } = require("./music-helpers");
const { createCurrentScene } = require("./illustration-current-scene");
const { resolveSessionCharacter } = require("./illustration-character");
const { buildIllustrationPromptContext } = require("./illustration-prompt-context");
const { buildIllustrationDebugPayload } = require("./illustration-debug");

module.exports = function registerStoryIllustrationRoutes(deps) {
  const {
    mediaTable,
    getItem,
    buildMediaPk,
    buildStorySessionSk,
    buildStorySceneSk,
    dynamoClient,
    PutCommand,
    getSignedUrl,
    s3Client,
    GetObjectCommand,
    clampPromptTokens,
    replicateModelConfig,
    buildSeedList,
    runReplicateWithRetry,
    getReplicateOutputUrl,
    fetchImageBuffer,
    buildUserPrefix,
    PutObjectCommand,
    MAX_REPLICATE_PROMPT_TOKENS,
  } = deps;

  const router = Router();

  router.post("/sessions/:id/illustrations", deps.requireUserMiddleware, async (req, res) => {
    const userId = req.user?.sub;
    const sessionId = req.params.id;
    let sceneId = req.body?.sceneId;
    const forceCurrent = Boolean(req.body?.forceCurrent);
    const regenerate = Boolean(req.body?.regenerate);
    const contextMode = req.body?.contextMode || "summary+scene";
    const requestedModelKey = req.body?.model || DEFAULT_STORY_ILLUSTRATION_MODEL;
    const bucket = process.env.MEDIA_BUCKET;
    const apiToken = process.env.REPLICATE_API_TOKEN;
    const debug = req.query?.debug === "true";
    if (!mediaTable) {
      return res.status(500).json({ message: "MEDIA_TABLE is not set" });
    }
    if (!bucket) {
      return res.status(500).json({ message: "MEDIA_BUCKET is not set" });
    }
    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    if (!apiToken) return res.status(500).json({ message: "REPLICATE_API_TOKEN must be set" });
    if (!sessionId || (!sceneId && !forceCurrent)) {
      return res
        .status(400)
        .json({ message: "sessionId and sceneId are required unless forceCurrent is true" });
    }
    if (!STORY_ILLUSTRATION_MODEL_KEYS.has(requestedModelKey)) {
      return res.status(400).json({
        message: `Unsupported model selection: ${requestedModelKey}`,
        allowed: Array.from(STORY_ILLUSTRATION_MODEL_KEYS),
      });
    }

    try {
      const sessionItem = await getItem({
        pk: buildMediaPk(userId),
        sk: buildStorySessionSk(sessionId),
      });
      if (!sessionItem) {
        return res.status(404).json({ message: "Session not found" });
      }

      let sceneItem = null;
      if (sceneId) {
        sceneItem = await getItem({
          pk: buildMediaPk(userId),
          sk: buildStorySceneSk(sessionId, sceneId),
        });
      }
      if (!sceneItem && forceCurrent) {
        sceneItem = await createCurrentScene(deps, { userId, sessionId, sessionItem });
        sceneId = sceneItem.sceneId;
      }
      if (!sceneItem) {
        return res.status(404).json({ message: "Scene not found" });
      }
      if (sceneItem.status === "completed" && sceneItem.imageKey && !regenerate) {
        const url = await getSignedUrl(
          s3Client,
          new GetObjectCommand({
            Bucket: bucket,
            Key: sceneItem.imageKey,
          }),
          { expiresIn: 900 }
        );
        const videoUrl = await signSceneVideoUrl(
          s3Client,
          GetObjectCommand,
          getSignedUrl,
          bucket,
          sceneItem
        );
        const musicUrl = await signSceneMusicUrl(
          s3Client,
          GetObjectCommand,
          getSignedUrl,
          bucket,
          sceneItem
        );
        return res.json({
          sceneId,
          imageKey: sceneItem.imageKey,
          imageUrl: url,
          videoKey: sceneItem.videoKey || "",
          videoUrl,
          ...buildSceneMusicPayload(parseOptionalNumber, sceneItem, musicUrl),
          scene: buildSceneResponse({
            scene: sceneItem,
            musicPayload: buildSceneMusicPayload(parseOptionalNumber, sceneItem, musicUrl),
            videoUrl,
          }),
        });
      }

      const resolvedCharacter = await resolveSessionCharacter(deps, sessionItem);
      const {
        sceneContextForPrompt,
        cleanScenePrompt,
        summaryLine,
        contextLine,
        recentTranscript,
        identityBlock,
        draftedPrompts,
      } = await buildIllustrationPromptContext(deps, {
        userId,
        sessionId,
        sessionItem,
        sceneItem,
        resolvedCharacter,
        contextMode,
      });

      const positivePrompt = draftedPrompts?.positivePrompt || "";
      const negativePrompt = draftedPrompts?.negativePrompt || "";
      if (!positivePrompt || !negativePrompt) {
        return res.status(500).json({
          message: "Failed to generate prompts from Haiku.",
        });
      }
      const trimmedPositivePrompt = clampPromptTokens(positivePrompt);
      const trimmedNegativePrompt = clampPromptTokens(negativePrompt);
      const promptWasTrimmed = trimmedPositivePrompt.trim() !== positivePrompt.trim();
      const negativeWasTrimmed = trimmedNegativePrompt.trim() !== negativePrompt.trim();

      const modelConfig = replicateModelConfig[requestedModelKey];
      if (!modelConfig?.modelId) {
        return res.status(500).json({
          message: `Replicate modelId is not configured for ${requestedModelKey}`,
        });
      }
      const resolvedImageSize = resolveStoryIllustrationSize(modelConfig);
      if (!resolvedImageSize) {
        return res.status(500).json({
          message: `${requestedModelKey} has no supported image sizes configured for story illustrations`,
        });
      }
      const defaultScheduler = modelConfig.schedulers?.[0];
      const [seed] = buildSeedList(1);
      const input = modelConfig.buildInput({
        prompt: trimmedPositivePrompt,
        negativePrompt: trimmedNegativePrompt,
        width: resolvedImageSize.width,
        height: resolvedImageSize.height,
        numOutputs: 1,
        seed,
        scheduler: defaultScheduler,
      });
      const output = await runReplicateWithRetry(modelConfig.modelId, input, 3);
      const outputItems = Array.isArray(output) ? output : [output];
      const imageUrl = outputItems.map(getReplicateOutputUrl).find(Boolean);
      if (!imageUrl) {
        return res.status(500).json({ message: "No image returned from Replicate" });
      }

      const { buffer, contentType } = await fetchImageBuffer(imageUrl);
      const imageKey =
        sceneItem.imageKey || buildStorySceneImageKey(buildUserPrefix, userId, sessionId, sceneId);
      await s3Client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: imageKey,
          Body: buffer,
          ContentType: contentType || "image/png",
        })
      );

      const updatedScene = {
        ...sceneItem,
        prompt: sceneContextForPrompt.scenePrompt || sceneItem.prompt,
        sceneEnvironment: sceneContextForPrompt.sceneEnvironment || sceneItem.sceneEnvironment,
        sceneAction: sceneContextForPrompt.sceneAction || sceneItem.sceneAction,
        imageKey,
        status: "completed",
        promptPositive: trimmedPositivePrompt,
        promptNegative: trimmedNegativePrompt,
        videoKey: "",
        videoStatus: "",
        videoPredictionId: "",
        videoPrompt: "",
        videoUpdatedAt: "",
        updatedAt: new Date().toISOString(),
      };
      await dynamoClient.send(
        new PutCommand({
          TableName: mediaTable,
          Item: updatedScene,
        })
      );

      const signedUrl = await getSignedUrl(
        s3Client,
        new GetObjectCommand({
          Bucket: bucket,
          Key: imageKey,
        }),
        { expiresIn: 900 }
      );
      const musicUrl = await signSceneMusicUrl(
        s3Client,
        GetObjectCommand,
        getSignedUrl,
        bucket,
        updatedScene
      );
      // Illustration runs synchronously, so its job is recorded already
      // settled — it still belongs in the shared feed for history and ops.
      await startSceneJob({
        jobStore: deps.jobStore,
        userId,
        kind: "illustration",
        providerRef: sceneId,
        status: "succeeded",
        sessionId,
        sceneId,
      });

      res.json({
        sceneId,
        imageKey,
        imageUrl: signedUrl,
        ...buildSceneMusicPayload(parseOptionalNumber, updatedScene, musicUrl),
        scene: buildSceneResponse({
          scene: updatedScene,
          musicPayload: buildSceneMusicPayload(parseOptionalNumber, updatedScene, musicUrl),
        }),
        ...(debug
          ? buildIllustrationDebugPayload({
              positivePrompt: trimmedPositivePrompt,
              negativePrompt: trimmedNegativePrompt,
              promptWasTrimmed,
              negativeWasTrimmed,
              maxPromptTokens: MAX_REPLICATE_PROMPT_TOKENS,
              identityBlock,
              contextMode,
              summaryLine,
              contextLine,
              recentTranscript,
              cleanScenePrompt,
              updatedScene,
              requestedModelKey,
              modelConfig,
              input,
            })
          : {}),
      });
    } catch (error) {
      console.error("Story illustration error:", {
        message: error?.message || String(error),
      });
      res.status(500).json({
        message: "Failed to generate illustration",
        error: error?.message || String(error),
      });
    }
  });

  return router;
};
