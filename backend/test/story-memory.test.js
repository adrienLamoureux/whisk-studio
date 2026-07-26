"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createStoryMemory } = require("../lib/story-memory");

const makeMessages = (count) =>
  Array.from({ length: count }, (_, i) => ({
    pk: "USER#user-1",
    sk: `SESSION#story-1#MSG#${1000 + i}`,
    role: i % 2 === 0 ? "user" : "assistant",
    content: `message ${i}`,
  }));

const makeBedrockClient = (summaryText, usage = { input_tokens: 100, output_tokens: 40 }) => ({
  send: async () => ({
    body: new TextEncoder().encode(
      JSON.stringify({ content: [{ type: "text", text: summaryText }], usage })
    ),
  }),
});

const buildHarness = ({
  messages = makeMessages(28),
  summaryText = "Merged summary of the journey.",
  sessionItem = { pk: "USER#user-1", sk: "SESSION#story-1", summary: "Old summary." },
  bedrockClient,
  agentCost = null,
} = {}) => {
  const captured = { puts: [], deletes: [], queries: [] };
  const dynamoClient = {
    send: async (cmd) => {
      const name = cmd.constructor.name;
      if (name === "PutCommand") captured.puts.push(cmd.input.Item);
      if (name === "DeleteCommand") captured.deletes.push(cmd.input.Key);
      if (name === "GetCommand") return { Item: sessionItem };
      return {};
    },
  };
  const queryBySkPrefix = async (args) => {
    captured.queries.push(args);
    return messages;
  };
  const storyMemory = createStoryMemory({
    dynamoClient,
    mediaTable: "test-table",
    queryBySkPrefix,
    bedrockClient: bedrockClient || makeBedrockClient(summaryText),
    InvokeModelCommand: class InvokeModelCommand {
      constructor(input) {
        this.input = input;
      }
    },
    promptHelperModelId: "mock-model",
    agentCost,
  });
  return { storyMemory, captured };
};

test("story memory: no-op at or below the turn threshold", async () => {
  const { storyMemory, captured } = buildHarness();
  await storyMemory.compactIfNeeded({ userId: "user-1", sessionId: "story-1", turnCount: 30 });
  assert.equal(captured.queries.length, 0);
  assert.equal(captured.deletes.length, 0);
});

test("story memory: no-op when too few messages to keep the recent tail safe", async () => {
  const { storyMemory, captured } = buildHarness({ messages: makeMessages(20) });
  await storyMemory.compactIfNeeded({ userId: "user-1", sessionId: "story-1", turnCount: 40 });
  assert.equal(captured.deletes.length, 0);
  assert.equal(captured.puts.length, 0);
});

test("story memory: compacts oldest window, merges summary, preserves recent tail", async () => {
  const messages = makeMessages(28);
  const { storyMemory, captured } = buildHarness({ messages });
  await storyMemory.compactIfNeeded({ userId: "user-1", sessionId: "story-1", turnCount: 40 });

  // Uses the OBJECT queryBySkPrefix signature, oldest first.
  assert.equal(captured.queries.length, 1);
  const query = captured.queries[0];
  assert.equal(typeof query, "object");
  assert.equal(query.pk, "USER#user-1");
  assert.ok(query.skPrefix.includes("story-1"));
  assert.equal(query.scanForward, true);

  // Summary merged onto the session item.
  assert.equal(captured.puts.length, 1);
  assert.equal(captured.puts[0].summary, "Merged summary of the journey.");
  assert.equal(captured.puts[0].sk, "SESSION#story-1");

  // Exactly the oldest 20 deleted; the newest 8 survive.
  assert.equal(captured.deletes.length, 20);
  const deletedSks = new Set(captured.deletes.map((k) => k.sk));
  messages.slice(0, 20).forEach((m) => assert.ok(deletedSks.has(m.sk)));
  messages.slice(20).forEach((m) => assert.ok(!deletedSks.has(m.sk)));
});

test("story memory: never deletes when the summariser returns empty", async () => {
  const { storyMemory, captured } = buildHarness({ summaryText: "" });
  await storyMemory.compactIfNeeded({ userId: "user-1", sessionId: "story-1", turnCount: 40 });
  assert.equal(captured.puts.length, 0);
  assert.equal(captured.deletes.length, 0);
});

test("story memory: never deletes when Bedrock fails", async () => {
  const { storyMemory, captured } = buildHarness({
    bedrockClient: {
      send: async () => {
        throw new Error("bedrock down");
      },
    },
  });
  await assert.doesNotReject(
    storyMemory.compactIfNeeded({ userId: "user-1", sessionId: "story-1", turnCount: 40 })
  );
  assert.equal(captured.deletes.length, 0);
});

test("story memory: bills summariser tokens against the daily cap", async () => {
  const recorded = [];
  const { storyMemory } = buildHarness({
    agentCost: {
      record: async (userId, usage) => {
        recorded.push({ userId, usage });
      },
    },
  });
  await storyMemory.compactIfNeeded({ userId: "user-1", sessionId: "story-1", turnCount: 40 });
  assert.equal(recorded.length, 1);
  assert.deepEqual(recorded[0], {
    userId: "user-1",
    usage: { inputTokens: 100, outputTokens: 40 },
  });
});
