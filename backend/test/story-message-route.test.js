"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createMockApp, createMockRes } = require("./helpers/test-utils");
const { createMockDeps } = require("./helpers/mock-deps");

const makeBedrockBody = (text) => ({
  body: new TextEncoder().encode(JSON.stringify({ content: [{ type: "text", text }] })),
});

const makeSessionItem = (overrides = {}) => ({
  pk: "USER#user-1",
  sk: "SESSION#story-1",
  type: "STORY_SESSION",
  sessionId: "story-1",
  title: "Frieren’s Road",
  presetId: "frieren-road",
  protagonistName: "Frieren",
  worldPrompt: "fantasy countryside",
  stylePrompt: "anime cinematic illustration",
  summary: "The journey has begun.",
  lorebook: { overview: { tone: "gentle" } },
  storyState: { flags: [], scene: { locationId: "road-valley" }, meta: { turn: 0 } },
  turnCount: 0,
  sceneCount: 1,
  lastIllustrationTurn: 0,
  ...overrides,
});

const buildHandler = ({ bedrockTexts = [], sessionItem = makeSessionItem(), overrides = {} }) => {
  const app = createMockApp();
  const captured = { puts: [], deletes: [], bedrockCalls: 0 };
  const deps = createMockDeps({
    getItem: async ({ sk }) => (sk === sessionItem.sk ? sessionItem : null),
    dynamoClient: {
      send: async (cmd) => {
        if (cmd._name === "PutCommand") captured.puts.push(cmd.input.Item);
        if (cmd._name === "DeleteCommand") captured.deletes.push(cmd.input.Key);
        return { Item: null, Items: [] };
      },
    },
    queryBySkPrefix: async () => [{ role: "user", content: "hello", createdAt: "t" }],
    selectStoryEvent: () => ({ cue: null, event: null, recentLimit: 5 }),
    bedrockClient: {
      send: async () => {
        const text = bedrockTexts[Math.min(captured.bedrockCalls, bedrockTexts.length - 1)];
        captured.bedrockCalls += 1;
        return makeBedrockBody(text);
      },
    },
    aiCraftSceneContext: async ({ scenePrompt, sceneEnvironment, sceneAction }) => ({
      scenePrompt: scenePrompt || "",
      sceneEnvironment: sceneEnvironment || "",
      sceneAction: sceneAction || "",
    }),
    ...overrides,
  });
  require("../routes/story-message-route")(app, deps);
  const handler = app.routes.post.get("/story/sessions/:id/message");
  return { handler, captured, deps };
};

const makeReq = (overrides = {}) => ({
  params: { id: "story-1" },
  body: { content: "I follow the road." },
  query: {},
  user: { sub: "user-1" },
  ...overrides,
});

test("story message: happy path persists turn and returns assistant reply", async () => {
  const modelJson = JSON.stringify({
    reply: "Frieren smiles and walks on.",
    summary: "Frieren and the player walk toward the village.",
    sceneBeat: false,
    stateDelta: {},
  });
  const { handler, captured } = buildHandler({ bedrockTexts: [modelJson] });
  const res = createMockRes();
  await handler(makeReq(), res);

  assert.equal(res.output.statusCode, 200);
  assert.equal(res.output.payload.assistant.content, "Frieren smiles and walks on.");
  assert.equal(res.output.payload.summary, "Frieren and the player walk toward the village.");
  assert.equal(res.output.payload.turnCount, 1);
  assert.equal(res.output.payload.degraded, undefined);

  const types = captured.puts.map((item) => item.type);
  assert.deepEqual(types, ["STORY_MESSAGE", "STORY_MESSAGE", "STORY_SESSION"]);
  const [userMsg, assistantMsg, session] = captured.puts;
  assert.equal(userMsg.role, "user");
  assert.equal(assistantMsg.role, "assistant");
  assert.equal(assistantMsg.content, "Frieren smiles and walks on.");
  assert.equal(session.summary, "Frieren and the player walk toward the village.");
  assert.equal(session.turnCount, 1);
});

test("story message: sceneBeat creates a scene and links it to the assistant message", async () => {
  const modelJson = JSON.stringify({
    reply: "The mist parts to reveal ruins.",
    summary: "Ruins discovered.",
    sceneBeat: true,
    sceneTitle: "Ruins revealed",
    sceneDescription: "Ancient stones in the mist",
    scenePrompt: "ancient ruins, mist, glowing runes",
    sceneEnvironment: "misty ruins",
    sceneAction: "frieren gazing upward",
    stateDelta: {},
  });
  const { handler, captured } = buildHandler({ bedrockTexts: [modelJson] });
  const res = createMockRes();
  await handler(makeReq(), res);

  assert.equal(res.output.statusCode, 200);
  const scene = res.output.payload.scene;
  assert.ok(scene?.sceneId, "scene should be created with an id");
  assert.equal(scene.title, "Ruins revealed");

  const sceneItem = captured.puts.find((item) => item.type === "STORY_SCENE");
  assert.ok(sceneItem, "scene item should be persisted");
  assert.equal(sceneItem.sceneId, scene.sceneId);

  const assistantMsg = captured.puts.find(
    (item) => item.type === "STORY_MESSAGE" && item.role === "assistant"
  );
  assert.equal(
    assistantMsg.sceneId,
    scene.sceneId,
    "assistant message should carry the sceneId for stable scene pairing"
  );
});

test("story message: no scene when gating is not met", async () => {
  const modelJson = JSON.stringify({
    reply: "A quiet moment passes.",
    summary: "Quiet walk.",
    sceneBeat: false,
    stateDelta: {},
  });
  const { handler, captured } = buildHandler({ bedrockTexts: [modelJson] });
  const res = createMockRes();
  await handler(makeReq(), res);

  assert.equal(res.output.payload.scene, null);
  const assistantMsg = captured.puts.find(
    (item) => item.type === "STORY_MESSAGE" && item.role === "assistant"
  );
  assert.equal(assistantMsg.sceneId, undefined);
});

test("story message: keeps prior summary when the model omits one", async () => {
  const modelJson = JSON.stringify({ reply: "Onward.", sceneBeat: false, stateDelta: {} });
  const { handler, captured } = buildHandler({ bedrockTexts: [modelJson] });
  const res = createMockRes();
  await handler(makeReq(), res);

  assert.equal(res.output.payload.summary, "The journey has begun.");
  const session = captured.puts.find((item) => item.type === "STORY_SESSION");
  assert.equal(session.summary, "The journey has begun.");
});

test("story message: retries once on malformed model output and flags degraded turn", async () => {
  const { handler, captured } = buildHandler({
    bedrockTexts: ["not json at all", "still not json"],
  });
  const res = createMockRes();
  await handler(makeReq(), res);

  assert.equal(res.output.statusCode, 200);
  assert.equal(captured.bedrockCalls, 2, "should retry the model call once");
  assert.equal(res.output.payload.degraded, true);
  // Raw text still becomes the reply so the story never dead-ends.
  assert.equal(res.output.payload.assistant.content, "still not json");
});

test("story message: retry recovers when the second attempt returns valid JSON", async () => {
  const good = JSON.stringify({ reply: "Recovered.", summary: "Back on track.", stateDelta: {} });
  const { handler, captured } = buildHandler({ bedrockTexts: ["garbled{{", good] });
  const res = createMockRes();
  await handler(makeReq(), res);

  assert.equal(captured.bedrockCalls, 2);
  assert.equal(res.output.payload.degraded, undefined);
  assert.equal(res.output.payload.assistant.content, "Recovered.");
  assert.equal(res.output.payload.summary, "Back on track.");
});

// ── Regenerate: state semantics ───────────────────────────────────────────
// These use the REAL story-state engine (not the identity mocks) and a real
// director event with effects. With identity mocks or `event: null`, state
// compounding is structurally unobservable — which is how the original bug
// shipped green.
const { applyStateDelta, buildInitialStoryState } = require("../lib/story-state/state-core");
const { updateStoryMeta } = require("../lib/story-state/event-selection");

const DIRECTOR_EVENT = {
  id: "weather-shift",
  type: "environment",
  initiative: "environment",
  effects: { metricsDelta: { tension: 0.1 }, flags: { add: ["storm-brewing"] } },
};

const realStateOverrides = {
  applyStateDelta,
  updateStoryMeta,
  buildInitialStoryState,
  selectStoryEvent: () => ({ cue: { beat: "b" }, event: DIRECTOR_EVENT, recentLimit: 4 }),
};

const STARTING_STATE = {
  version: 1,
  scene: { locationId: "road-valley", tags: [] },
  metrics: { tension: 0.2, mystery: 0.35, urgency: 0.2, progress: 0.1, fatigue: 0.1 },
  goals: { active: [], completed: [] },
  flags: [],
  npcs: { present: [] },
  meta: { turn: 0, lastEventId: "", recentEvents: [], turnsSinceInitiative: 0 },
};

const turnJson = JSON.stringify({
  reply: "The wind rises.",
  summary: "A storm gathers.",
  sceneBeat: true,
  sceneTitle: "Storm",
  scenePrompt: "storm clouds",
  sceneEnvironment: "dark sky",
  sceneAction: "frieren looking up",
  stateDelta: { metricsDelta: { tension: 0.1 } },
});

test("story message: regenerate rolls back state instead of compounding it", async () => {
  // Turn 1 — normal turn from a known starting state.
  const first = buildHandler({
    bedrockTexts: [turnJson],
    sessionItem: makeSessionItem({ storyState: STARTING_STATE, sceneCount: 1, turnCount: 0 }),
    overrides: realStateOverrides,
  });
  const res1 = createMockRes();
  await first.handler(makeReq(), res1);

  const afterTurn = first.captured.puts.find((item) => item.type === "STORY_SESSION");
  const sceneAfterTurn = first.captured.puts.find((item) => item.type === "STORY_SCENE");
  assert.ok(afterTurn.previousTurn, "a normal turn must snapshot its starting state");
  // tension: 0.2 base + 0.1 event effect + 0.1 model delta = 0.4
  assert.equal(Number(afterTurn.storyState.metrics.tension.toFixed(2)), 0.4);
  assert.equal(afterTurn.sceneCount, 2);
  assert.equal(afterTurn.storyState.meta.recentEvents.length, 1);

  // Turn 1 regenerated — must land on the SAME state as the original turn,
  // not stack a second event application on top.
  const second = buildHandler({
    bedrockTexts: [turnJson],
    sessionItem: afterTurn,
    overrides: {
      ...realStateOverrides,
      queryBySkPrefix: async () => [
        {
          role: "assistant",
          content: "The wind rises.",
          sk: "SESSION#story-1#MSG#2000",
          sceneId: sceneAfterTurn.sceneId,
        },
        { role: "user", content: "I follow the road.", sk: "SESSION#story-1#MSG#1000" },
      ],
    },
  });
  const res2 = createMockRes();
  await second.handler(makeReq({ body: { regenerate: true } }), res2);

  const afterRegen = second.captured.puts.find((item) => item.type === "STORY_SESSION");
  assert.equal(
    Number(afterRegen.storyState.metrics.tension.toFixed(2)),
    0.4,
    "tension must not compound across a regenerate"
  );
  assert.deepEqual(afterRegen.storyState.flags, ["storm-brewing"], "flags must not duplicate");
  assert.equal(afterRegen.sceneCount, 2, "sceneCount must not double-increment");
  assert.equal(
    afterRegen.storyState.meta.recentEvents.length,
    1,
    "recentEvents must not gain a second entry for the same turn"
  );
  assert.equal(afterRegen.turnCount, afterTurn.turnCount, "turnCount stays put on regenerate");
  // The discarded reply's scene is removed, not orphaned.
  assert.ok(
    second.captured.deletes.some(
      (key) => key.sk === `SESSION#story-1#SCENE#${sceneAfterTurn.sceneId}`
    ),
    "the superseded scene row must be deleted"
  );
  // The snapshot survives so a second regenerate rolls back to the same base.
  assert.deepEqual(afterRegen.previousTurn, afterTurn.previousTurn);
});

test("story message: repeated regenerates all start from the same snapshot", async () => {
  const base = buildHandler({
    bedrockTexts: [turnJson],
    sessionItem: makeSessionItem({ storyState: STARTING_STATE, sceneCount: 1, turnCount: 0 }),
    overrides: realStateOverrides,
  });
  await base.handler(makeReq(), createMockRes());
  let session = base.captured.puts.find((item) => item.type === "STORY_SESSION");

  for (let i = 0; i < 3; i += 1) {
    const run = buildHandler({
      bedrockTexts: [turnJson],
      sessionItem: session,
      overrides: {
        ...realStateOverrides,
        queryBySkPrefix: async () => [
          { role: "assistant", content: "x", sk: "SESSION#story-1#MSG#2000" },
          { role: "user", content: "I follow the road.", sk: "SESSION#story-1#MSG#1000" },
        ],
      },
    });
    await run.handler(makeReq({ body: { regenerate: true } }), createMockRes());
    session = run.captured.puts.find((item) => item.type === "STORY_SESSION");
    assert.equal(
      Number(session.storyState.metrics.tension.toFixed(2)),
      0.4,
      `tension drifted on regenerate #${i + 1}`
    );
    assert.equal(session.sceneCount, 2, `sceneCount drifted on regenerate #${i + 1}`);
  }
});

test("story message: legacy session without a snapshot still regenerates without crashing", async () => {
  const legacy = makeSessionItem({ storyState: STARTING_STATE, turnCount: 3, sceneCount: 2 });
  delete legacy.previousTurn;
  const run = buildHandler({
    bedrockTexts: [turnJson],
    sessionItem: legacy,
    overrides: {
      ...realStateOverrides,
      queryBySkPrefix: async () => [
        { role: "assistant", content: "x", sk: "SESSION#story-1#MSG#2000" },
        { role: "user", content: "I follow the road.", sk: "SESSION#story-1#MSG#1000" },
      ],
    },
  });
  const res = createMockRes();
  await run.handler(makeReq({ body: { regenerate: true } }), res);
  assert.equal(res.output.statusCode, 200);
});

test("story message: regenerate re-answers the last user turn without duplicating it", async () => {
  const modelJson = JSON.stringify({
    reply: "A different take on the moment.",
    summary: "Retold the last beat.",
    stateDelta: {},
  });
  const { handler, captured } = buildHandler({
    bedrockTexts: [modelJson],
    sessionItem: makeSessionItem({ turnCount: 3 }),
    overrides: {
      // Descending order, as the route requests (scanForward: false).
      queryBySkPrefix: async () => [
        { role: "assistant", content: "Old reply.", sk: "SESSION#story-1#MSG#2000" },
        { role: "user", content: "I open the door.", sk: "SESSION#story-1#MSG#1000" },
      ],
    },
  });
  const res = createMockRes();
  await handler(makeReq({ body: { regenerate: true } }), res);

  assert.equal(res.output.statusCode, 200);
  assert.equal(res.output.payload.assistant.content, "A different take on the moment.");
  // Turn count does not advance on regenerate.
  assert.equal(res.output.payload.turnCount, 3);
  // The old assistant reply is deleted; no new user message is written.
  assert.ok(captured.deletes.some((key) => key.sk === "SESSION#story-1#MSG#2000"));
  const userPuts = captured.puts.filter(
    (item) => item.type === "STORY_MESSAGE" && item.role === "user"
  );
  assert.equal(userPuts.length, 0);
});

test("story message: regenerate 400s when no user turn exists yet", async () => {
  const { handler } = buildHandler({
    bedrockTexts: ["{}"],
    overrides: {
      queryBySkPrefix: async () => [
        { role: "assistant", content: "Opening.", sk: "SESSION#story-1#MSG#500" },
      ],
    },
  });
  const res = createMockRes();
  await handler(makeReq({ body: { regenerate: true } }), res);
  assert.equal(res.output.statusCode, 400);
});

test("story message: 400 when content missing, 404 when session unknown", async () => {
  const { handler } = buildHandler({ bedrockTexts: ["{}"] });

  const res400 = createMockRes();
  await handler(makeReq({ body: {} }), res400);
  assert.equal(res400.output.statusCode, 400);

  const res404 = createMockRes();
  await handler(makeReq({ params: { id: "missing" } }), res404);
  assert.equal(res404.output.statusCode, 404);
});
