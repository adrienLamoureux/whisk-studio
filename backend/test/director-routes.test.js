"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { getRouterHandler, createMockRes } = require("./helpers/test-utils");
const registerDirectorRoutes = require("../routes/ops/director-routes");

function PutCommand(input) {
  this.input = input;
  this._name = "PutCommand";
}

const REPLICATE = {
  animagine: {
    modelId: "owner/animagine",
    sizes: [{ width: 768, height: 1024 }],
    schedulers: ["euler"],
  },
};
const VIDEO = { "wan-2.2-i2v-fast": { modelId: "owner/wan", sizes: [] } };

const buildHarness = (overrides = {}) => {
  const captured = { dynamoPuts: [], mediaPuts: [] };
  const store = new Map();
  const deps = {
    mediaTable: "table",
    requireUserMiddleware: (req, res, next) => next(),
    requireAdminMiddleware: (req, res, next) => next(),
    queryMediaItems: async () => [],
    queryBySkPrefix: async () => [],
    getItem: async (key) => store.get(`${key.pk}|${key.sk}`) || null,
    putMediaItem: async (arg) => captured.mediaPuts.push(arg),
    buildMediaPk: (u) => `USER#${u}`,
    buildMediaSk: (type, key) => `${type}#${key}`,
    replicateModelConfig: REPLICATE,
    civitaiModelConfig: {},
    replicateVideoConfig: VIDEO,
    DEFAULT_NEGATIVE_PROMPT: "low quality",
    dynamoClient: {
      send: async (cmd) => {
        captured.dynamoPuts.push(cmd.input.Item);
        return {};
      },
    },
    PutCommand,
    ...overrides,
  };
  const router = registerDirectorRoutes(deps);
  const get = (method, path) => getRouterHandler(router, method, path);
  return { router, get, captured, store, deps };
};

const run = async (handler, req = {}) => {
  const res = createMockRes();
  await handler({ user: { sub: "u1" }, body: {}, query: {}, ...req }, res);
  return res.output;
};

const ROUTES = [
  ["get", "/director/config"],
  ["post", "/director/config"],
  ["get", "/director/app-config"],
  ["post", "/director/app-config"],
  ["get", "/director/overview"],
  ["post", "/director/sound/normalize"],
];

test("director: every route rejects requests without a user", async () => {
  const h = buildHarness();
  for (const [method, path] of ROUTES) {
    const out = await run(h.get(method, path), { user: undefined });
    assert.equal(out.statusCode, 401, `${method} ${path}`);
  }
});

test("director: GET /director/config returns fallback config and options", async () => {
  const h = buildHarness();
  const out = await run(h.get("get", "/director/config"));
  assert.equal(out.statusCode, 200);
  assert.ok(out.payload.config.generation);
  assert.ok(out.payload.config.video);
  assert.ok(out.payload.config.sound);
  assert.ok(out.payload.options);
  assert.equal(typeof out.payload.appConfig.theme, "string");
});

test("director: GET /director/config returns 500 when the store throws", async () => {
  const h = buildHarness({
    getItem: async () => {
      throw new Error("ddb down");
    },
  });
  const out = await run(h.get("get", "/director/config"));
  assert.equal(out.statusCode, 500);
  assert.equal(out.payload.message, "Failed to load director config");
  assert.equal(out.payload.error, "ddb down");
});

test("director: POST /director/config persists the merged config", async () => {
  const h = buildHarness();
  const out = await run(h.get("post", "/director/config"), {
    body: { config: { sound: { defaultMood: "tense" } } },
  });
  assert.equal(out.statusCode, 200);
  assert.equal(h.captured.mediaPuts.length, 1);
  const put = h.captured.mediaPuts[0];
  assert.equal(put.userId, "u1");
  assert.equal(put.type, "CFG");
  assert.equal(put.key, "director/config");
  assert.ok(put.extra.createdAt);
  assert.deepEqual(out.payload.config, put.extra.config);
});

test("director: POST /director/config accepts a bare body and reports failures", async () => {
  const ok = buildHarness();
  const a = await run(ok.get("post", "/director/config"), { body: {} });
  assert.equal(a.statusCode, 200);
  const failing = buildHarness({
    putMediaItem: async () => {
      throw new Error("write failed");
    },
  });
  const b = await run(failing.get("post", "/director/config"), { body: {} });
  assert.equal(b.statusCode, 500);
  assert.equal(b.payload.message, "Failed to save director config");
});

test("director: app-config get/post round trip and failures", async () => {
  const h = buildHarness();
  const got = await run(h.get("get", "/director/app-config"));
  assert.equal(got.statusCode, 200);
  assert.ok(Array.isArray(got.payload.options.themes));
  const saved = await run(h.get("post", "/director/app-config"), {
    body: { theme: got.payload.options.themes[0]?.id || got.payload.appConfig.theme },
  });
  assert.equal(saved.statusCode, 200);
  assert.equal(h.captured.dynamoPuts.length, 1);
  assert.equal(h.captured.dynamoPuts[0].type, "CFG");
  assert.equal(h.captured.dynamoPuts[0].key, "app/config");

  const failing = buildHarness({
    getItem: async () => {
      throw new Error("boom");
    },
  });
  assert.equal((await run(failing.get("get", "/director/app-config"))).statusCode, 500);
  assert.equal((await run(failing.get("post", "/director/app-config"))).statusCode, 500);
});

test("director: app-config without a media table skips persistence", async () => {
  const h = buildHarness({ mediaTable: "" });
  const got = await run(h.get("get", "/director/app-config"));
  assert.equal(got.statusCode, 200);
  const saved = await run(h.get("post", "/director/app-config"), { body: { theme: "x" } });
  assert.equal(saved.statusCode, 200);
  assert.equal(h.captured.dynamoPuts.length, 0);
});

test("director: GET /director/overview aggregates sessions, tracks and queues", async () => {
  const h = buildHarness({
    queryMediaItems: async ({ type }) =>
      type === "JOB"
        ? [
            { jobId: "j1", status: "running", kind: "image", createdAt: "2026-01-01T00:00:00Z" },
            { jobId: "j2", status: "failed", kind: "video", createdAt: "2026-01-02T00:00:00Z" },
          ]
        : [],
    queryBySkPrefix: async ({ skPrefix }) =>
      skPrefix === "SESSION#"
        ? [
            { sk: "SESSION#a", title: "One", directorPinned: true, updatedAt: "2026-01-02" },
            { sk: "SESSION#b", updatedAt: "2026-01-03" },
            { sk: "SESSION#b#MSG#1" },
          ]
        : [
            { sk: "MUSICLIB#t1", title: "Full", mood: "calm", energy: "low", tags: ["a"] },
            { sk: "MUSICLIB#t2" },
          ],
    listGlobalMasonryImages: async () => [{ url: "u" }],
  });
  const out = await run(h.get("get", "/director/overview"));
  assert.equal(out.statusCode, 200, JSON.stringify(out.payload));
  const { modules } = out.payload;
  assert.equal(modules.story.summary.totalSessions, 2);
  assert.equal(modules.story.summary.pinnedSessions, 1);
  assert.equal(modules.story.sessions[0].sessionId, "b");
  assert.equal(modules.story.sessions[1].title, "One");
  assert.equal(modules.sound.summary.totalTracks, 2);
  assert.equal(modules.sound.summary.tracksMissingMetadata, 1);
  assert.equal(modules.sound.missingTracks[0].trackId, "t2");
  assert.equal(modules.sound.missingTracks[0].title, "Untitled track");
  assert.equal(modules.experience.summary.masonryImages, 1);
  assert.ok(modules.generation.summary);
  assert.ok(modules.video.summary);
  assert.ok(out.payload.queue);
});

test("director: overview works without masonry provider and reports failures", async () => {
  const h = buildHarness();
  const ok = await run(h.get("get", "/director/overview"));
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.payload.modules.experience.summary.masonryImages, 0);
  const failing = buildHarness({
    queryMediaItems: async () => {
      throw new Error("query failed");
    },
  });
  const bad = await run(failing.get("get", "/director/overview"));
  assert.equal(bad.statusCode, 500);
  assert.equal(bad.payload.message, "Failed to load director overview");
});

test("director: sound normalize fills missing metadata and counts changes", async () => {
  const tracks = [
    { pk: "USER#u1", sk: "MUSICLIB#t1", mood: "calm", energy: "low", tags: ["x"] },
    { pk: "USER#u1", sk: "MUSICLIB#t2" },
  ];
  const h = buildHarness({ queryBySkPrefix: async () => tracks });
  const out = await run(h.get("post", "/director/sound/normalize"));
  assert.equal(out.statusCode, 200, JSON.stringify(out.payload));
  assert.equal(out.payload.inspectedCount, 2);
  assert.equal(out.payload.normalizedCount, 1);
  assert.equal(h.captured.dynamoPuts.length, 1);
  assert.equal(h.captured.dynamoPuts[0].sk, "MUSICLIB#t2");
  assert.ok(h.captured.dynamoPuts[0].directorNormalizedAt);
  assert.ok(h.captured.dynamoPuts[0].mood);
});

test("director: sound normalize applies posted defaults and handles guards", async () => {
  const h = buildHarness({ queryBySkPrefix: async () => [] });
  const out = await run(h.get("post", "/director/sound/normalize"), {
    body: { soundDefaults: { defaultMood: "tense" } },
  });
  assert.equal(out.statusCode, 200);
  assert.equal(h.captured.mediaPuts.length, 1);
  assert.equal(out.payload.normalizedCount, 0);

  const noTable = buildHarness({ mediaTable: "" });
  const a = await run(noTable.get("post", "/director/sound/normalize"));
  assert.equal(a.statusCode, 500);
  assert.equal(a.payload.message, "MEDIA_TABLE is not set");

  const failing = buildHarness({
    queryBySkPrefix: async () => {
      throw new Error("scan failed");
    },
  });
  const b = await run(failing.get("post", "/director/sound/normalize"));
  assert.equal(b.statusCode, 500);
  assert.equal(b.payload.message, "Failed to normalize sound metadata");
});
