"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { getRouterHandler } = require("./helpers/test-utils");
const { createMockDeps } = require("./helpers/mock-deps");

const createRes = () => {
  const out = { statusCode: 200, payload: null };
  const res = {
    status(code) {
      out.statusCode = code;
      return res;
    },
    json(payload) {
      out.payload = payload;
      return res;
    },
    out,
  };
  return res;
};

const FRIEREN_PRESET = {
  id: "frieren-road",
  name: "Frieren’s Road",
  synopsis: "A quiet journey.",
  protagonistId: "frieren",
  protagonistName: "Frieren",
  worldPrompt: "fantasy countryside",
  stylePrompt: "anime cinematic illustration",
  negativePrompt: "low quality",
  opening: "The road opens into a quiet valley.",
};

const buildRouter = (overrides = {}) => {
  const captured = { puts: [], deletes: [] };
  const deps = createMockDeps({
    ensureStoryPresets: async () => [],
    ensureStoryCharacters: async () => [],
    storyPresets: [FRIEREN_PRESET],
    queryBySkPrefix: async () => [],
    dynamoClient: {
      send: async (cmd) => {
        if (cmd._name === "PutCommand") captured.puts.push(cmd.input.Item);
        if (cmd._name === "DeleteCommand") captured.deletes.push(cmd.input.Key);
        return { Item: null, Items: [] };
      },
    },
    ...overrides,
  });
  const router = require("../routes/story/session-routes")(deps);
  return { router, captured, deps };
};

test("POST /sessions rejects an inactive presetId", async () => {
  const { router } = buildRouter();
  const handler = getRouterHandler(router, "post", "/sessions");
  const res = createRes();
  await handler({ user: { sub: "user-1" }, body: { presetId: "not-a-preset" } }, res);

  assert.equal(res.out.statusCode, 400);
  assert.equal(res.out.payload.message, "Invalid presetId");
  assert.ok(Array.isArray(res.out.payload.allowedPresetIds));
});

test("POST /sessions creates session + opening message + opening scene", async () => {
  const { router, captured } = buildRouter();
  const handler = getRouterHandler(router, "post", "/sessions");
  const res = createRes();
  await handler({ user: { sub: "user-1" }, body: { presetId: "frieren-road" } }, res);

  assert.equal(res.out.statusCode, 200);
  assert.equal(res.out.payload.session.presetId, "frieren-road");
  assert.equal(res.out.payload.messages[0].content, FRIEREN_PRESET.opening);
  assert.equal(res.out.payload.scenes.length, 1);

  const types = captured.puts.map((item) => item.type);
  assert.deepEqual(types, ["STORY_SESSION", "STORY_MESSAGE", "STORY_SCENE"]);
});

test("POST /sessions accepts every activated preset", async () => {
  const { ACTIVE_STORY_PRESET_IDS } = require("../routes/story/active-presets");
  for (const presetId of ACTIVE_STORY_PRESET_IDS) {
    const { storyPresets } = require("../config/story-seed-data");
    const preset = storyPresets.find((item) => item.id === presetId);
    assert.ok(preset, `active preset ${presetId} must exist in story-seed-data`);
    assert.ok(preset.protagonistId, `active preset ${presetId} must set protagonistId`);
    assert.ok(preset.opening, `active preset ${presetId} must have an opening`);

    const { router } = buildRouter({ storyPresets: [preset] });
    const handler = getRouterHandler(router, "post", "/sessions");
    const res = createRes();
    await handler({ user: { sub: "user-1" }, body: { presetId } }, res);
    assert.equal(res.out.statusCode, 200, `preset ${presetId} should create a session`);
    assert.equal(res.out.payload.session.presetId, presetId);
  }
});

test("every active preset has a lorebook enrichment branch", () => {
  const { ACTIVE_STORY_PRESET_IDS } = require("../routes/story/active-presets");
  const { applyPresetLorebook } = require("../lib/story-state/lorebook-presets");
  for (const presetId of ACTIVE_STORY_PRESET_IDS) {
    const lorebook = applyPresetLorebook({ id: presetId }, {}, "Protagonist");
    assert.ok(
      Array.isArray(lorebook.events) && lorebook.events.length > 0,
      `preset ${presetId} should resolve lorebook events`
    );
    assert.ok(lorebook.initialScene, `preset ${presetId} should resolve an initial scene`);
  }
});

test("POST /sessions replaces an existing session for the same preset (cascade delete)", async () => {
  const existing = {
    pk: "USER#user-1",
    sk: "SESSION#story-old",
    sessionId: "story-old",
    presetId: "frieren-road",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  const { router, captured } = buildRouter({
    queryBySkPrefix: async ({ skPrefix }) => (skPrefix === "SESSION#" ? [existing] : []),
  });
  const handler = getRouterHandler(router, "post", "/sessions");
  const res = createRes();
  await handler({ user: { sub: "user-1" }, body: { presetId: "frieren-road" } }, res);

  assert.equal(res.out.statusCode, 200);
  assert.ok(
    captured.deletes.some((key) => key.sk === "SESSION#story-old"),
    "old session for the same preset should be cascade-deleted"
  );
});

test("GET /sessions dedupes to one session per preset", async () => {
  const mkSession = (id, presetId, updatedAt) => ({
    pk: "USER#user-1",
    sk: `SESSION#${id}`,
    sessionId: id,
    presetId,
    updatedAt,
  });
  const { router } = buildRouter({
    queryBySkPrefix: async () => [
      mkSession("s1", "frieren-road", "2026-01-02T00:00:00.000Z"),
      mkSession("s2", "frieren-road", "2026-01-01T00:00:00.000Z"),
      mkSession("s3", "moonlit-tavern", "2026-01-03T00:00:00.000Z"),
    ],
  });
  const handler = getRouterHandler(router, "get", "/sessions");
  const res = createRes();
  await handler({ user: { sub: "user-1" } }, res);

  assert.equal(res.out.statusCode, 200);
  assert.equal(res.out.payload.sessions.length, 2);
  assert.equal(res.out.payload.duplicateSessionsHidden, 1);
});
