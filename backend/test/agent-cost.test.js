"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { createAgentCost } = require("../lib/agent-cost");

const makeStubClient = ({ getItem = null } = {}) => {
  const sent = [];
  return {
    sent,
    send: async (cmd) => {
      sent.push(cmd);
      const name = cmd?.constructor?.name || "";
      if (name === "GetCommand") return { Item: getItem };
      return {};
    },
  };
};

test("createAgentCost returns no-op stubs when DynamoDB unavailable", async () => {
  const c = createAgentCost({ dynamoClient: null, mediaTable: "" });
  assert.equal(await c.load("u1"), null);
  await c.record("u1", { inputTokens: 100, outputTokens: 200 });
});

test("record skips when userId missing", async () => {
  const client = makeStubClient();
  const c = createAgentCost({ dynamoClient: client, mediaTable: "t" });
  await c.record("", { inputTokens: 50, outputTokens: 30 });
  assert.equal(client.sent.length, 0);
});

test("record skips when both token counts are 0", async () => {
  const client = makeStubClient();
  const c = createAgentCost({ dynamoClient: client, mediaTable: "t" });
  await c.record("u1", { inputTokens: 0, outputTokens: 0 });
  assert.equal(client.sent.length, 0);
});

test("record issues an UpdateCommand with atomic ADD increments", async () => {
  const client = makeStubClient();
  const c = createAgentCost({ dynamoClient: client, mediaTable: "t" });
  await c.record("u1", { inputTokens: 150, outputTokens: 75 });
  const update = client.sent.find((cmd) => cmd?.constructor?.name === "UpdateCommand");
  assert.ok(update, "must issue an UpdateCommand");
  assert.match(update.input.UpdateExpression, /ADD inputTokens :i/);
  assert.match(update.input.UpdateExpression, /outputTokens :o/);
  assert.match(update.input.UpdateExpression, /turnCount :one/);
  assert.equal(update.input.ExpressionAttributeValues[":i"], 150);
  assert.equal(update.input.ExpressionAttributeValues[":o"], 75);
  assert.equal(update.input.ExpressionAttributeValues[":one"], 1);
});

test("record coerces non-integer / negative inputs safely", async () => {
  const client = makeStubClient();
  const c = createAgentCost({ dynamoClient: client, mediaTable: "t" });
  await c.record("u1", { inputTokens: -5, outputTokens: 42.7 });
  const update = client.sent.find((cmd) => cmd?.constructor?.name === "UpdateCommand");
  // -5 floored to 0 → both halves nonzero? input=0, output=42 → still records (output > 0)
  assert.equal(update.input.ExpressionAttributeValues[":i"], 0);
  assert.equal(update.input.ExpressionAttributeValues[":o"], 42);
});

test("load returns null when no record exists", async () => {
  const client = makeStubClient({ getItem: null });
  const c = createAgentCost({ dynamoClient: client, mediaTable: "t" });
  assert.equal(await c.load("u1"), null);
});

test("load returns inputTokens + outputTokens + turnCount summary", async () => {
  const client = makeStubClient({
    getItem: { inputTokens: 1200, outputTokens: 600, turnCount: 8, lastUpdatedAt: 999 },
  });
  const c = createAgentCost({ dynamoClient: client, mediaTable: "t" });
  const summary = await c.load("u1");
  assert.deepEqual(summary, {
    inputTokens: 1200,
    outputTokens: 600,
    turnCount: 8,
    lastUpdatedAt: 999,
  });
});

test("scanAll returns empty when DynamoDB has no AGENT#COST records", async () => {
  const client = makeStubClient();
  client.send = async (cmd) => {
    if (cmd?.constructor?.name === "ScanCommand") return { Items: [], ScannedCount: 0 };
    return {};
  };
  const c = createAgentCost({ dynamoClient: client, mediaTable: "t" });
  const result = await c.scanAll();
  assert.deepEqual(result.items, []);
  assert.equal(result.scannedCount, 0);
  assert.equal(result.truncated, false);
});

test("scanAll strips USER# prefix from pk and returns normalised items", async () => {
  const client = {
    send: async (cmd) => {
      if (cmd?.constructor?.name === "ScanCommand") {
        return {
          Items: [
            {
              pk: "USER#alice",
              sk: "AGENT#COST",
              inputTokens: 100,
              outputTokens: 50,
              turnCount: 3,
            },
            {
              pk: "USER#bob",
              sk: "AGENT#COST",
              inputTokens: 200,
              outputTokens: 75,
              turnCount: 5,
              lastUpdatedAt: 999,
            },
          ],
          ScannedCount: 2,
        };
      }
      return {};
    },
  };
  const c = createAgentCost({ dynamoClient: client, mediaTable: "t" });
  const result = await c.scanAll();
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].userId, "alice");
  assert.equal(result.items[1].userId, "bob");
  assert.equal(result.items[1].lastUpdatedAt, 999);
});

test("scanAll respects maxItems cap and reports truncation", async () => {
  const client = {
    send: async () => ({
      Items: Array.from({ length: 5 }, (_, i) => ({
        pk: `USER#u${i}`,
        sk: "AGENT#COST",
        inputTokens: i * 10,
        outputTokens: i * 5,
        turnCount: i,
      })),
      ScannedCount: 5,
      LastEvaluatedKey: { pk: "USER#u4", sk: "AGENT#COST" }, // signal more pages
    }),
  };
  const c = createAgentCost({ dynamoClient: client, mediaTable: "t" });
  const result = await c.scanAll({ maxItems: 3 });
  assert.equal(result.items.length, 3);
  assert.equal(
    result.truncated,
    true,
    "must flag truncation when items hit max and more pages exist"
  );
});

test("scanAll fails silently on DynamoDB errors, returning collected items", async () => {
  const client = {
    send: async () => {
      throw new Error("connection refused");
    },
  };
  const c = createAgentCost({ dynamoClient: client, mediaTable: "t" });
  const result = await c.scanAll();
  assert.deepEqual(result.items, []);
});

// ── v1.6: checkDailyCap ───────────────────────────────────────────────────

test("checkDailyCap allows when DynamoDB unavailable (fail open)", async () => {
  const c = createAgentCost({ dynamoClient: null, mediaTable: "" });
  const v = await c.checkDailyCap("u1");
  assert.equal(v.allowed, true);
});

test("checkDailyCap allows when no prior usage exists", async () => {
  const client = makeStubClient({ getItem: null });
  const c = createAgentCost({ dynamoClient: client, mediaTable: "t" });
  const v = await c.checkDailyCap("u1", { dailyCap: 100_000 });
  assert.equal(v.allowed, true);
  assert.equal(v.remaining, 100_000);
});

test("checkDailyCap allows when under cap", async () => {
  const today = Date.now() - (Date.now() % (24 * 60 * 60 * 1000));
  const client = makeStubClient({
    getItem: { dayStartedAt: today, tokensToday: 30_000 },
  });
  const c = createAgentCost({ dynamoClient: client, mediaTable: "t" });
  const v = await c.checkDailyCap("u1", { dailyCap: 100_000 });
  assert.equal(v.allowed, true);
  assert.equal(v.remaining, 70_000);
});

test("checkDailyCap denies when tokensToday >= dailyCap", async () => {
  const today = Date.now() - (Date.now() % (24 * 60 * 60 * 1000));
  const client = makeStubClient({
    getItem: { dayStartedAt: today, tokensToday: 105_000 },
  });
  const c = createAgentCost({ dynamoClient: client, mediaTable: "t" });
  const v = await c.checkDailyCap("u1", { dailyCap: 100_000 });
  assert.equal(v.allowed, false);
  assert.equal(v.tokensToday, 105_000);
  assert.equal(v.capacity, 100_000);
  assert.ok(v.retryAfterMs > 0);
  assert.ok(v.retryAfterMs <= 24 * 60 * 60 * 1000);
});

test("checkDailyCap ignores stale dayStartedAt (rolls over at UTC midnight)", async () => {
  const twoDaysAgo = Date.now() - 2 * 24 * 60 * 60 * 1000;
  const client = makeStubClient({
    getItem: { dayStartedAt: twoDaysAgo, tokensToday: 999_999 },
  });
  const c = createAgentCost({ dynamoClient: client, mediaTable: "t" });
  const v = await c.checkDailyCap("u1", { dailyCap: 100_000 });
  assert.equal(v.allowed, true, "stale day data must not count toward today's cap");
  assert.equal(v.remaining, 100_000);
});

test("checkDailyCap fails open when DynamoDB throws", async () => {
  const client = {
    send: async () => {
      throw new Error("connection refused");
    },
  };
  const c = createAgentCost({ dynamoClient: client, mediaTable: "t" });
  const v = await c.checkDailyCap("u1");
  assert.equal(v.allowed, true);
});

test("checkDailyCap fails open on missing userId", async () => {
  const c = createAgentCost({ dynamoClient: makeStubClient(), mediaTable: "t" });
  const v = await c.checkDailyCap("");
  assert.equal(v.allowed, true);
});

test("DynamoDB errors fail silently — record never throws", async () => {
  const client = {
    send: async () => {
      throw new Error("connection refused");
    },
  };
  const c = createAgentCost({ dynamoClient: client, mediaTable: "t" });
  await c.record("u1", { inputTokens: 100, outputTokens: 50 }); // must not throw
  assert.equal(await c.load("u1"), null); // load gracefully returns null
});

// ── Image daily cap (caps Replicate spend, the dominant cost driver) ──────

test("checkDailyImageCap allows when DynamoDB unavailable (fail open)", async () => {
  const c = createAgentCost({ dynamoClient: null, mediaTable: "" });
  const v = await c.checkDailyImageCap("u1");
  assert.equal(v.allowed, true);
});

test("checkDailyImageCap allows when no prior images today", async () => {
  const c = createAgentCost({ dynamoClient: makeStubClient({ getItem: null }), mediaTable: "t" });
  const v = await c.checkDailyImageCap("u1", { dailyImageCap: 50 });
  assert.equal(v.allowed, true);
  assert.equal(v.remaining, 50);
});

test("checkDailyImageCap denies when imagesToday >= cap", async () => {
  const today = Date.now() - (Date.now() % (24 * 60 * 60 * 1000));
  const client = makeStubClient({ getItem: { dayStartedAt: today, imagesToday: 50 } });
  const c = createAgentCost({ dynamoClient: client, mediaTable: "t" });
  const v = await c.checkDailyImageCap("u1", { dailyImageCap: 50 });
  assert.equal(v.allowed, false);
  assert.equal(v.imagesToday, 50);
  assert.equal(v.capacity, 50);
  assert.ok(v.retryAfterMs > 0);
});

test("checkDailyImageCap rolls over at UTC midnight (stale day ignored)", async () => {
  const twoDaysAgo = Date.now() - 2 * 24 * 60 * 60 * 1000;
  const client = makeStubClient({
    getItem: { dayStartedAt: twoDaysAgo, imagesToday: 9999 },
  });
  const c = createAgentCost({ dynamoClient: client, mediaTable: "t" });
  const v = await c.checkDailyImageCap("u1", { dailyImageCap: 50 });
  assert.equal(v.allowed, true);
  assert.equal(v.remaining, 50);
});

// ── Atomic counters: no read, conditional writes, rollover fallback ───────

const conditionFailure = () =>
  Object.assign(new Error("conditional"), { name: "ConditionalCheckFailedException" });

// Scripted client: each outcome is "ok", "condition" or "boom", consumed per send.
const makeScriptedClient = (outcomes, attributes) => {
  const sent = [];
  return {
    sent,
    send: async (cmd) => {
      sent.push(cmd);
      const outcome = outcomes[sent.length - 1] ?? "ok";
      if (outcome === "condition") throw conditionFailure();
      if (outcome === "boom") throw new Error("connection refused");
      return { Attributes: attributes };
    },
  };
};
const names = (client) => client.sent.map((cmd) => cmd.constructor.name);

test("record issues one conditional UpdateCommand on the same day", async () => {
  const client = makeScriptedClient(["ok"]);
  const c = createAgentCost({ dynamoClient: client, mediaTable: "t" });
  await c.record("u1", { inputTokens: 10, outputTokens: 5 });
  assert.deepEqual(names(client), ["UpdateCommand"]);
  const { UpdateExpression, ConditionExpression } = client.sent[0].input;
  assert.match(UpdateExpression, /ADD .*tokensToday :tt SET lastUpdatedAt = :now/);
  assert.doesNotMatch(UpdateExpression, /SET tokensToday/);
  assert.equal(ConditionExpression, "dayStartedAt = :ds");
  assert.equal(client.sent[0].input.ExpressionAttributeValues[":tt"], 15);
});

test("record rolls the day over with a second write that sets tokensToday", async () => {
  const client = makeScriptedClient(["condition", "ok"]);
  const c = createAgentCost({ dynamoClient: client, mediaTable: "t" });
  await c.record("u1", { inputTokens: 10, outputTokens: 5 });
  assert.deepEqual(names(client), ["UpdateCommand", "UpdateCommand"]);
  const rollover = client.sent[1].input;
  assert.match(rollover.UpdateExpression, /SET tokensToday = :tt, dayStartedAt = :ds/);
  assert.match(rollover.ConditionExpression, /attribute_not_exists\(dayStartedAt\)/);
});

test("record retries the same-day write once when another request rolled the day", async () => {
  const client = makeScriptedClient(["condition", "condition", "ok"]);
  const c = createAgentCost({ dynamoClient: client, mediaTable: "t" });
  await c.record("u1", { inputTokens: 10, outputTokens: 5 });
  assert.equal(client.sent.length, 3);
  assert.equal(client.sent[2].input.ConditionExpression, "dayStartedAt = :ds");
});

test("concurrent record calls never use SET tokensToday on the same day", async () => {
  const client = makeScriptedClient([]);
  const c = createAgentCost({ dynamoClient: client, mediaTable: "t" });
  await Promise.all(
    Array.from({ length: 5 }, () => c.record("u1", { inputTokens: 1, outputTokens: 1 }))
  );
  assert.equal(client.sent.length, 5);
  for (const cmd of client.sent) assert.doesNotMatch(cmd.input.UpdateExpression, /SET tokensToday/);
});

test("recordImage adds imagesToday and totalImages atomically with no read", async () => {
  const client = makeScriptedClient(["ok"]);
  const c = createAgentCost({ dynamoClient: client, mediaTable: "t" });
  await c.recordImage("u1", 2);
  assert.deepEqual(names(client), ["UpdateCommand"]);
  assert.match(client.sent[0].input.UpdateExpression, /ADD totalImages :n, imagesToday :it/);
  assert.equal(client.sent[0].input.ExpressionAttributeValues[":it"], 2);
});

test("recordImage rolls imagesToday over after UTC midnight with a second write", async () => {
  const client = makeScriptedClient(["condition", "ok"]);
  const c = createAgentCost({ dynamoClient: client, mediaTable: "t" });
  await c.recordImage("u1", 1);
  assert.equal(client.sent.length, 2);
  assert.match(client.sent[1].input.UpdateExpression, /SET imagesToday = :it, dayStartedAt = :ds/);
});

test("reserveImage allows under cap with one conditional write", async () => {
  const client = makeScriptedClient(["ok"], { imagesToday: 3 });
  const c = createAgentCost({ dynamoClient: client, mediaTable: "t" });
  const v = await c.reserveImage("u1", { dailyImageCap: 10 });
  assert.deepEqual(v, { allowed: true, remaining: 7, retryAfterMs: 0 });
  const { ConditionExpression, ExpressionAttributeValues } = client.sent[0].input;
  assert.equal(ConditionExpression, "dayStartedAt = :ds AND imagesToday <= :maxBefore");
  assert.equal(ExpressionAttributeValues[":maxBefore"], 9);
});

test("reserveImage denies at cap", async () => {
  const client = makeScriptedClient(["condition", "condition", "condition"]);
  const c = createAgentCost({ dynamoClient: client, mediaTable: "t" });
  const v = await c.reserveImage("u1", { dailyImageCap: 10 });
  assert.equal(v.allowed, false);
  assert.equal(v.reason, "cap_reached");
  assert.equal(v.capacity, 10);
  assert.equal(v.imagesToday, null);
  assert.ok(v.retryAfterMs >= 1000);
});

test("reserveImage denies on a thrown error in closed mode, allows in open mode", async () => {
  const limits = { imageDailyCap: 50, unavailableRetryAfterSeconds: 60 };
  const closed = createAgentCost({
    dynamoClient: makeScriptedClient(["boom"]),
    mediaTable: "t",
    limits: { ...limits, failMode: "closed" },
  });
  assert.deepEqual(await closed.reserveImage("u1"), {
    allowed: false,
    reason: "unavailable",
    retryAfterMs: 60_000,
  });
  const open = createAgentCost({
    dynamoClient: makeScriptedClient(["boom"]),
    mediaTable: "t",
    limits: { ...limits, failMode: "open" },
  });
  assert.equal((await open.reserveImage("u1")).allowed, true);
});

test("releaseImage subtracts one only for today and never rejects", async () => {
  const client = makeScriptedClient(["ok"]);
  const c = createAgentCost({ dynamoClient: client, mediaTable: "t" });
  await c.releaseImage("u1");
  assert.equal(client.sent[0].input.ExpressionAttributeValues[":minusOne"], -1);
  assert.match(client.sent[0].input.ConditionExpression, /dayStartedAt = :ds/);
  const failing = createAgentCost({ dynamoClient: makeScriptedClient(["boom"]), mediaTable: "t" });
  await failing.releaseImage("u1");
});

test("reserveImage and releaseImage are no-ops without DynamoDB", async () => {
  const c = createAgentCost({ dynamoClient: null, mediaTable: "" });
  assert.equal((await c.reserveImage("u1")).allowed, true);
  await c.releaseImage("u1");
});

test("recordImage is a silent no-op when DynamoDB errors", async () => {
  const client = {
    send: async () => {
      throw new Error("connection refused");
    },
  };
  const c = createAgentCost({ dynamoClient: client, mediaTable: "t" });
  await c.recordImage("u1", 1); // must not throw
});
