"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { createSpendBudget, utcDayKey, msUntilNextUtcDay } = require("../lib/spend-budget");
const { SPEND_LIMIT_DEFAULTS } = require("../config/spend-limits");
const { estimateUsd, toMicroUsd } = require("../config/pricing");

const NOON = Date.UTC(2026, 10, 16, 12, 0, 0);
const USER = { kind: "user", id: "u1" };
const ANON = { kind: "anon" };
const SDXL = { priceKey: "animagine", provider: "replicate" };
const SDXL_MICRO = toMicroUsd(estimateUsd(SDXL));

const makeStubClient = ({ result = { Attributes: { spentMicroUsd: SDXL_MICRO } }, error } = {}) => {
  const sent = [];
  return {
    sent,
    send: async (cmd) => {
      sent.push(cmd);
      if (error) throw error;
      return result;
    },
  };
};

const conditionFailure = () =>
  Object.assign(new Error("condition"), { name: "ConditionalCheckFailedException" });

const makeBudget = (client, limits = {}) =>
  createSpendBudget({
    dynamoClient: client,
    mediaTable: "t",
    limits: { ...SPEND_LIMIT_DEFAULTS, ...limits },
    now: () => NOON,
  });

test("charge sends one conditional UpdateItem with ADD spentMicroUsd", async () => {
  const client = makeStubClient();
  const v = await makeBudget(client).charge({ scope: USER, ...SDXL });
  assert.equal(client.sent.length, 1);
  const input = client.sent[0].input;
  assert.deepEqual(input.Key, { pk: "USER#u1", sk: "SPEND#DAY#2026-11-16" });
  assert.equal(
    input.UpdateExpression,
    "ADD spentMicroUsd :c, chargeCount :one SET lastUpdatedAt = :now"
  );
  assert.equal(
    input.ConditionExpression,
    "attribute_not_exists(spentMicroUsd) OR spentMicroUsd <= :maxBefore"
  );
  assert.equal(input.ReturnValues, "UPDATED_NEW");
  assert.equal(input.ExpressionAttributeValues[":c"], SDXL_MICRO);
  assert.equal(input.ExpressionAttributeValues[":maxBefore"], 3_000_000 - SDXL_MICRO);
  assert.equal(v.allowed, true);
  assert.equal(v.reason, "charged");
  assert.equal(v.scope, "user");
  assert.equal(v.microUsd, SDXL_MICRO);
  assert.equal(v.spentMicroUsd, SDXL_MICRO);
});

test("anon scope charges the shared SPEND#ANON item against the anon limit", async () => {
  const client = makeStubClient();
  const v = await makeBudget(client).charge({ scope: ANON, ...SDXL });
  assert.equal(client.sent[0].input.Key.pk, "SPEND#ANON");
  assert.equal(
    client.sent[0].input.ExpressionAttributeValues[":maxBefore"],
    1_000_000 - SDXL_MICRO
  );
  assert.equal(v.scope, "anon");
  assert.equal(v.limitMicroUsd, 1_000_000);
});

test("charge denies a cost above the limit without a DynamoDB call", async () => {
  const client = makeStubClient();
  const v = await makeBudget(client).charge({
    scope: ANON,
    priceKey: "veo-3.1-fast",
    provider: "replicate-video",
  });
  assert.equal(client.sent.length, 0);
  assert.equal(v.allowed, false);
  assert.equal(v.reason, "budget_exhausted");
  assert.equal(v.retryAfterMs, 12 * 60 * 60 * 1000);
});

test("charge maps ConditionalCheckFailedException to budget_exhausted", async () => {
  const client = makeStubClient({ error: conditionFailure() });
  const v = await makeBudget(client).charge({ scope: USER, ...SDXL });
  assert.equal(v.allowed, false);
  assert.equal(v.reason, "budget_exhausted");
  assert.equal(v.spentMicroUsd, null);
  assert.ok(v.retryAfterMs >= 1000);
});

test("charge on a thrown error denies in closed mode and allows uncharged in open mode", async () => {
  const closed = await makeBudget(makeStubClient({ error: new Error("boom") })).charge({
    scope: USER,
    ...SDXL,
  });
  assert.equal(closed.allowed, false);
  assert.equal(closed.reason, "unavailable");
  assert.equal(closed.retryAfterMs, SPEND_LIMIT_DEFAULTS.unavailableRetryAfterSeconds * 1000);

  const open = await makeBudget(makeStubClient({ error: new Error("boom") }), {
    failMode: "open",
  }).charge({ scope: USER, ...SDXL });
  assert.equal(open.allowed, true);
  assert.equal(open.reason, "unavailable");
  assert.equal(open.microUsd, 0);
});

test("a budget of 0 disables charging and makes no call", async () => {
  const client = makeStubClient();
  const v = await makeBudget(client, { userDailyBudgetUsd: 0 }).charge({ scope: USER, ...SDXL });
  assert.equal(client.sent.length, 0);
  assert.equal(v.allowed, true);
  assert.equal(v.reason, "disabled");
  assert.equal(v.microUsd, 0);
});

test("without DynamoDB charge returns a disabled verdict", async () => {
  const b = createSpendBudget({ dynamoClient: null, mediaTable: "" });
  const v = await b.charge({ scope: USER, ...SDXL });
  assert.equal(v.allowed, true);
  assert.equal(v.reason, "disabled");
  await b.refund({ scope: USER, dayKey: "2026-11-16", microUsd: 5 });
});

test("refund sends a negative ADD guarded by attribute_exists", async () => {
  const client = makeStubClient();
  await makeBudget(client).refund({ scope: USER, dayKey: "2026-11-15", microUsd: 6900 });
  const input = client.sent[0].input;
  assert.deepEqual(input.Key, { pk: "USER#u1", sk: "SPEND#DAY#2026-11-15" });
  assert.match(input.UpdateExpression, /^ADD spentMicroUsd :neg/);
  assert.equal(input.ExpressionAttributeValues[":neg"], -6900);
  assert.equal(input.ConditionExpression, "attribute_exists(spentMicroUsd)");
});

test("refund never rejects and skips a zero amount", async () => {
  const failing = makeStubClient({ error: new Error("boom") });
  await makeBudget(failing).refund({ scope: ANON, dayKey: "2026-11-16", microUsd: 10 });
  const client = makeStubClient();
  await makeBudget(client).refund({ scope: ANON, dayKey: "2026-11-16", microUsd: 0 });
  assert.equal(client.sent.length, 0);
});

test("utcDayKey and msUntilNextUtcDay at 23:59:59 UTC", () => {
  const late = Date.UTC(2026, 10, 16, 23, 59, 59);
  assert.equal(utcDayKey(late), "2026-11-16");
  assert.equal(msUntilNextUtcDay(late), 1000);
  assert.equal(utcDayKey(late + 1000), "2026-11-17");
  assert.equal(msUntilNextUtcDay(Date.UTC(2026, 10, 16, 23, 59, 59, 900)), 1000);
});
