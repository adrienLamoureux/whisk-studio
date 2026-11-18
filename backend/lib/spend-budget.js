"use strict";

/**
 * spend-budget - daily dollar budget per signed-in user, plus one shared
 * budget for visitors who are not signed in.
 *
 * Persistence (one item per scope per UTC day, no TTL):
 *   pk = USER#{userId} or SPEND#ANON
 *   sk = SPEND#DAY#{YYYY-MM-DD}
 *   { spentMicroUsd, chargeCount, lastUpdatedAt }
 *
 * `charge` is one conditional UpdateItem: the ADD and the budget check happen
 * together, so two requests at once cannot both pass the limit. Prices come
 * from config/pricing.js. Money is stored as integer micro-USD.
 *
 * Never rejects. When DynamoDB fails, `limits.failMode` decides: "closed"
 * denies, "open" lets the call through uncharged.
 */

const { buildMediaPk, buildAnonSpendPk, buildDailySpendSk } = require("./keys");
const { estimateUsd, toMicroUsd } = require("../config/pricing");
const { loadSpendLimits, SPEND_FAIL_MODE } = require("../config/spend-limits");

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const MIN_RETRY_AFTER_MS = 1000;
const MS_PER_SECOND = 1000;

const REASON = Object.freeze({
  CHARGED: "charged",
  DISABLED: "disabled",
  EXHAUSTED: "budget_exhausted",
  UNAVAILABLE: "unavailable",
});

/** @param {number} ms epoch milliseconds @returns {string} "YYYY-MM-DD" in UTC */
const utcDayKey = (ms = Date.now()) => new Date(ms).toISOString().slice(0, 10);

/** @param {number} ms epoch milliseconds @returns {number} ms to the next UTC midnight, at least 1000 */
const msUntilNextUtcDay = (ms = Date.now()) =>
  Math.max(MIN_RETRY_AFTER_MS, ONE_DAY_MS - (ms % ONE_DAY_MS));

const isUserScope = (scope) => scope?.kind === "user" && Boolean(scope.id);
const scopeName = (scope) => (isUserScope(scope) ? "user" : "anon");
const budgetUsdFor = (scope, limits) =>
  isUserScope(scope) ? limits.userDailyBudgetUsd : limits.anonDailyBudgetUsd;

const budgetKey = (scope, dayKey) => ({
  pk: isUserScope(scope) ? buildMediaPk(scope.id) : buildAnonSpendPk(),
  sk: buildDailySpendSk(dayKey),
});

const isConditionFailure = (err) => err?.name === "ConditionalCheckFailedException";

function createSpendBudget({
  dynamoClient,
  mediaTable,
  limits = loadSpendLimits(),
  now = () => Date.now(),
} = {}) {
  const verdict = (scope, dayKey, fields) => ({
    allowed: true,
    reason: REASON.DISABLED,
    scope: scopeName(scope),
    microUsd: 0,
    dayKey,
    limitMicroUsd: 0,
    spentMicroUsd: null,
    retryAfterMs: 0,
    ...fields,
  });

  if (!dynamoClient || !mediaTable) {
    return {
      charge: async ({ scope } = {}) => verdict(scope, utcDayKey(now())),
      refund: async () => {},
    };
  }
  const { UpdateCommand } = require("@aws-sdk/lib-dynamodb");

  async function charge({ scope, priceKey, provider, count = 1 } = {}) {
    const nowMs = now();
    const dayKey = utcDayKey(nowMs);
    const limitMicroUsd = toMicroUsd(budgetUsdFor(scope, limits));
    const microUsd = toMicroUsd(estimateUsd({ priceKey, provider, count }));
    if (limitMicroUsd <= 0 || microUsd <= 0) return verdict(scope, dayKey);

    const base = { dayKey, limitMicroUsd, microUsd };
    const exhausted = () =>
      verdict(scope, dayKey, {
        ...base,
        allowed: false,
        reason: REASON.EXHAUSTED,
        retryAfterMs: msUntilNextUtcDay(nowMs),
      });
    if (microUsd > limitMicroUsd) return exhausted();

    try {
      const result = await dynamoClient.send(
        new UpdateCommand({
          TableName: mediaTable,
          Key: budgetKey(scope, dayKey),
          UpdateExpression: "ADD spentMicroUsd :c, chargeCount :one SET lastUpdatedAt = :now",
          ConditionExpression: "attribute_not_exists(spentMicroUsd) OR spentMicroUsd <= :maxBefore",
          ExpressionAttributeValues: {
            ":c": microUsd,
            ":one": 1,
            ":now": nowMs,
            ":maxBefore": limitMicroUsd - microUsd,
          },
          ReturnValues: "UPDATED_NEW",
        })
      );
      const spent = Number(result?.Attributes?.spentMicroUsd);
      return verdict(scope, dayKey, {
        ...base,
        reason: REASON.CHARGED,
        spentMicroUsd: Number.isFinite(spent) ? spent : null,
      });
    } catch (err) {
      if (isConditionFailure(err)) return exhausted();
      const closed = limits.failMode === SPEND_FAIL_MODE.CLOSED;
      return verdict(scope, dayKey, {
        ...base,
        allowed: !closed,
        reason: REASON.UNAVAILABLE,
        microUsd: 0,
        retryAfterMs: closed ? limits.unavailableRetryAfterSeconds * MS_PER_SECOND : 0,
      });
    }
  }

  async function refund({ scope, dayKey, microUsd } = {}) {
    const amount = Math.floor(Number(microUsd) || 0);
    if (amount <= 0 || !dayKey) return;
    try {
      await dynamoClient.send(
        new UpdateCommand({
          TableName: mediaTable,
          Key: budgetKey(scope, dayKey),
          UpdateExpression: "ADD spentMicroUsd :neg SET lastUpdatedAt = :now",
          ConditionExpression: "attribute_exists(spentMicroUsd)",
          ExpressionAttributeValues: { ":neg": -amount, ":now": now() },
        })
      );
    } catch {
      // Silent - a failed refund leaves the user slightly overcharged, never blocks a request
    }
  }

  return { charge, refund };
}

module.exports = { createSpendBudget, utcDayKey, msUntilNextUtcDay };
