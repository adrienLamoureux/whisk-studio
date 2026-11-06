"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { getRouterHandler, createMockRes, withEnv } = require("./helpers/test-utils");
const registerStoryIllustrationRoutes = require("../routes/story/illustration-routes");

function Cmd(input) {
  this.input = input;
}
function PutCommand(input) {
  this.input = input;
  this._name = "PutCommand";
}

const ENV = {
  MEDIA_BUCKET: "bucket",
  REPLICATE_API_TOKEN: "token",
};

const SESSION = {
  pk: "USER#u1",
  sk: "SESSION#s1",
  protagonistId: "frieren",
  protagonistName: "Frieren",
  protagonistPrompt: "old prompt",
  summary: "A summary",
  storyState: {},
  lorebook: {},
};

const buildHarness = (overrides = {}) => {
  const captured = { puts: [], s3: [], jobs: [], replicateCalls: [] };
  const deps = {
    mediaTable: "table",
    requireUserMiddleware: (req, res, next) => next(),
    getItem: async ({ sk }) => {
      if (sk === "SESSION#s1") return { ...SESSION };
      if (sk === "SCENE#s1#scene-1") {
        return { pk: "USER#u1", sk, sceneId: "scene-1", prompt: "a road", status: "pending" };
      }
      return null;
    },
    buildMediaPk: (u) => `USER#${u}`,
    buildStorySessionSk: (s) => `SESSION#${s}`,
    buildStorySceneSk: (s, sc) => `SCENE#${s}#${sc}`,
    queryBySkPrefix: async () => [
      { role: "assistant", content: "The wind rises." },
      { role: "user", content: "I walk on." },
    ],
    storyMessagePrefix: (s) => `MSG#${s}`,
    buildSceneFragmentsFromStoryState: () => ({ environment: ["forest"], action: ["walking"] }),
    dedupeFragments: (list) => Array.from(new Set(list)),
    compactScenePayload: (p) => p,
    aiCraftSceneContext: async (p) => ({
      scenePrompt: p.scenePrompt || "scene",
      sceneEnvironment: p.sceneEnvironment || "env",
      sceneAction: p.sceneAction || "act",
    }),
    normalizePromptFragment: (v) => String(v || "").trim(),
    dynamoClient: {
      send: async (cmd) => {
        captured.puts.push(cmd.input.Item);
        return {};
      },
    },
    PutCommand,
    getSignedUrl: async (_c, cmd) => `https://signed.example/${cmd.input.Key}`,
    s3Client: {
      send: async (cmd) => {
        captured.s3.push(cmd.input);
        return {};
      },
    },
    GetObjectCommand: Cmd,
    PutObjectCommand: Cmd,
    ensureStoryCharacters: async () => [
      { id: "frieren", name: "Frieren", identityPrompt: "elf mage" },
    ],
    buildStoryCharacterPk: () => "CHAR",
    buildStoryCharacterSk: (id) => `CHAR#${id}`,
    clampPromptTokens: (v) => String(v).slice(0, 10),
    replicateModelConfig: {
      "wai-nsfw-illustrious-v11": {
        modelId: "owner/model",
        sizes: [{ width: 768, height: 1024 }],
        schedulers: ["euler"],
        buildInput: (i) => i,
      },
      animagine: { modelId: "", sizes: [{ width: 768, height: 1024 }], buildInput: (i) => i },
    },
    buildSeedList: () => [42],
    runReplicateWithRetry: async (id, input) => {
      captured.replicateCalls.push({ id, input });
      return ["https://img.example/out.png"];
    },
    getReplicateOutputUrl: (v) => v,
    fetchImageBuffer: async () => ({ buffer: Buffer.from("x"), contentType: "image/png" }),
    buildUserPrefix: (u) => `users/${u}`,
    MAX_REPLICATE_PROMPT_TOKENS: 77,
    aiCraftIllustrationPrompts: async () => ({
      positivePrompt: "positive prompt long text",
      negativePrompt: "negative prompt long",
    }),
    jobStore: {
      createJob: async (j) => captured.jobs.push(j),
    },
    ...overrides,
  };
  const router = registerStoryIllustrationRoutes(deps);
  const handler = getRouterHandler(router, "post", "/sessions/:id/illustrations");
  return { handler, captured, deps };
};

const call = async (handler, req, env = ENV) => {
  const res = createMockRes();
  await withEnv(env, () =>
    handler({ user: { sub: "u1" }, params: { id: "s1" }, body: {}, query: {}, ...req }, res)
  );
  return res.output;
};

test("illustrations: registers the POST route and exports a router", () => {
  const { handler } = buildHarness();
  assert.equal(typeof handler, "function");
});

test("illustrations: config and auth guards", async () => {
  const { handler } = buildHarness();
  assert.equal(
    (await call(handler, { body: { sceneId: "scene-1" } }, { ...ENV, MEDIA_BUCKET: undefined }))
      .statusCode,
    500
  );
  assert.equal(
    (
      await call(
        handler,
        { body: { sceneId: "scene-1" } },
        { ...ENV, REPLICATE_API_TOKEN: undefined }
      )
    ).statusCode,
    500
  );
  assert.equal((await call(handler, { user: undefined, body: { sceneId: "x" } })).statusCode, 401);
  const noMediaTable = buildHarness({ mediaTable: "" });
  assert.equal((await call(noMediaTable.handler, { body: { sceneId: "x" } })).statusCode, 500);
});

test("illustrations: validates sceneId and model", async () => {
  const { handler } = buildHarness();
  const missing = await call(handler, { body: {} });
  assert.equal(missing.statusCode, 400);
  const badModel = await call(handler, { body: { sceneId: "scene-1", model: "nope" } });
  assert.equal(badModel.statusCode, 400);
  assert.match(badModel.payload.message, /Unsupported model/);
  assert.ok(Array.isArray(badModel.payload.allowed));
});

test("illustrations: 404 for unknown session and unknown scene", async () => {
  const noSession = buildHarness({ getItem: async () => null });
  assert.equal((await call(noSession.handler, { body: { sceneId: "scene-1" } })).statusCode, 404);
  const { handler } = buildHarness();
  const out = await call(handler, { body: { sceneId: "missing" } });
  assert.equal(out.statusCode, 404);
  assert.equal(out.payload.message, "Scene not found");
});

test("illustrations: returns a signed url for a completed scene without regenerating", async () => {
  const completed = {
    sceneId: "scene-1",
    status: "completed",
    imageKey: "users/u1/img.png",
    prompt: "p",
  };
  const { handler, captured } = buildHarness({
    getItem: async ({ sk }) => (sk === "SESSION#s1" ? { ...SESSION } : { ...completed }),
  });
  const out = await call(handler, { body: { sceneId: "scene-1" } });
  assert.equal(out.statusCode, 200);
  assert.equal(out.payload.imageKey, "users/u1/img.png");
  assert.match(out.payload.imageUrl, /^https:\/\/signed\.example\//);
  assert.equal(captured.replicateCalls.length, 0);
});

test("illustrations: generates an image end to end, syncs character and records job", async () => {
  const { handler, captured } = buildHarness();
  const out = await call(handler, { body: { sceneId: "scene-1" } });
  assert.equal(out.statusCode, 200, JSON.stringify(out.payload));
  assert.equal(out.payload.sceneId, "scene-1");
  assert.ok(out.payload.imageKey.includes("u1"));
  assert.equal(captured.replicateCalls.length, 1);
  assert.equal(captured.replicateCalls[0].id, "owner/model");
  assert.equal(captured.s3.length, 1);
  assert.equal(captured.s3[0].ContentType, "image/png");
  const synced = captured.puts.find((i) => i.protagonistPrompt === "elf mage");
  assert.ok(synced, "session protagonist prompt synced");
  const finalScene = captured.puts.find((i) => i.status === "completed");
  assert.equal(finalScene.promptNegative, "negative p");
  assert.equal(out.payload.prompt, undefined);
  assert.equal(captured.jobs.length, 1);
  assert.equal(captured.jobs[0].kind, "illustration");
  assert.equal(captured.jobs[0].status, "succeeded");
});

test("illustrations: debug flag exposes prompt context and trim notice", async () => {
  const { handler } = buildHarness();
  const out = await call(handler, { body: { sceneId: "scene-1" }, query: { debug: "true" } });
  assert.equal(out.statusCode, 200);
  assert.equal(out.payload.prompt.positive, "positive p");
  assert.equal(out.payload.identity, "elf mage");
  assert.equal(out.payload.context.mode, "summary+scene");
  assert.equal(out.payload.replicate.modelKey, "wai-nsfw-illustrious-v11");
  assert.match(out.payload.replicate.notice, /Positive prompt trimmed to 77 tokens/);
  assert.match(out.payload.replicate.notice, /Negative prompt/);
  assert.equal(out.payload.promptPattern.length, 6);
});

test("illustrations: forceCurrent creates a current-moment scene", async () => {
  const { handler, captured } = buildHarness();
  const out = await call(handler, { body: { forceCurrent: true } });
  assert.equal(out.statusCode, 200, JSON.stringify(out.payload));
  const created = captured.puts.find((i) => i.type === "STORY_SCENE");
  assert.ok(created);
  assert.equal(created.title, "Current moment");
  assert.equal(created.description, "The wind rises.");
  const bumped = captured.puts.find((i) => i.sceneCount === 1);
  assert.ok(bumped, "session scene count incremented");
  assert.equal(out.payload.sceneId, created.sceneId);
});

test("illustrations: forceCurrent without assistant message falls back to protagonist text", async () => {
  const { handler, captured } = buildHarness({ queryBySkPrefix: async () => [] });
  await call(handler, { body: { forceCurrent: true } });
  const created = captured.puts.find((i) => i.type === "STORY_SCENE");
  assert.equal(created.description, "Current scene with Frieren.");
});

test("illustrations: opening scene uses compacted payload limits", async () => {
  const { handler } = buildHarness({
    getItem: async ({ sk }) =>
      sk === "SESSION#s1"
        ? { ...SESSION }
        : { sceneId: "opening-1", title: "opening scene", prompt: "p", status: "pending" },
  });
  const out = await call(handler, { body: { sceneId: "opening-1" } });
  assert.equal(out.statusCode, 200, JSON.stringify(out.payload));
});

test("illustrations: failure branches return 500 with a message", async () => {
  const noPrompts = buildHarness({ aiCraftIllustrationPrompts: async () => ({}) });
  const a = await call(noPrompts.handler, { body: { sceneId: "scene-1" } });
  assert.equal(a.statusCode, 500);
  assert.match(a.payload.message, /Failed to generate prompts/);

  const noModelId = buildHarness();
  const b = await call(noModelId.handler, { body: { sceneId: "scene-1", model: "animagine" } });
  assert.equal(b.statusCode, 500);
  assert.match(b.payload.message, /modelId is not configured/);

  const noSizes = buildHarness();
  noSizes.deps.replicateModelConfig["wai-nsfw-illustrious-v11"].sizes = [];
  const c = await call(noSizes.handler, { body: { sceneId: "scene-1" } });
  assert.equal(c.statusCode, 500);
  assert.match(c.payload.message, /no supported image sizes/);

  const noImage = buildHarness({ runReplicateWithRetry: async () => [] });
  const d = await call(noImage.handler, { body: { sceneId: "scene-1" } });
  assert.equal(d.statusCode, 500);
  assert.equal(d.payload.message, "No image returned from Replicate");

  const boom = buildHarness({
    runReplicateWithRetry: async () => {
      throw new Error("replicate down");
    },
  });
  const origError = console.error;
  console.error = () => {};
  try {
    const e = await call(boom.handler, { body: { sceneId: "scene-1" } });
    assert.equal(e.statusCode, 500);
    assert.equal(e.payload.message, "Failed to generate illustration");
    assert.equal(e.payload.error, "replicate down");
  } finally {
    console.error = origError;
  }
});
