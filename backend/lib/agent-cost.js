"use strict";

/**
 * agent-cost — per-user running totals for agent Bedrock spend.
 *
 * Persistence:
 *   pk = USER#{userId}
 *   sk = AGENT#COST
 *   { inputTokens, outputTokens, turnCount, lastUpdatedAt, tokensToday, dayStartedAt }
 *
 * Lifetime and daily counters are both atomic DynamoDB `ADD`s (the daily one
 * only `SET`s at the UTC rollover, guarded by a condition), so concurrent
 * turns can't lose counts. Telemetry writes are fail-silent — they must never
 * break a request.
 *
 * The Sanctum cost view sums these across users. Dollar prices live in
 * config/pricing.js; the dollar budget is lib/spend-budget.js.
 */

const { buildMediaPk, buildAgentCostSk, buildAgentImageCountSk } = require("./keys");
const {
  SPEND_FAIL_MODE,
  SPEND_LIMIT_DEFAULTS,
  loadSpendLimits,
} = require("../config/spend-limits");

// Default per-user image generation cap per UTC day (see config/spend-limits.js).
const DEFAULT_IMAGE_DAILY_CAP = SPEND_LIMIT_DEFAULTS.imageDailyCap;

const isConditionFailure = (err) => err?.name === "ConditionalCheckFailedException";

function createAgentCost({ dynamoClient, mediaTable, limits = loadSpendLimits() }) {
  if (!dynamoClient || !mediaTable) {
    return {
      record: async () => {},
      load: async () => null,
      scanAll: async () => ({ items: [], scannedCount: 0, truncated: false }),
      checkDailyCap: async () => ({ allowed: true, remaining: null, retryAfterMs: 0 }),
      checkDailyImageCap: async () => ({ allowed: true, remaining: null, retryAfterMs: 0 }),
      recordImage: async () => {},
      reserveImage: async () => ({ allowed: true, remaining: null, retryAfterMs: 0 }),
      releaseImage: async () => {},
    };
  }
  const { GetCommand, UpdateCommand, ScanCommand } = require("@aws-sdk/lib-dynamodb");

  // Day boundary in ms (UTC). Used by checkDailyCap to reset the
  // tokensToday counter at midnight UTC for a stable rolling window.
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
  const dayStart = (now = Date.now()) => now - (now % ONE_DAY_MS);

  /**
   * Atomically add to a daily counter plus lifetime counters, no read.
   *   1. same-day write: ADD, condition dayStartedAt = today (+ optional cap)
   *   2. rollover write: SET the daily field, condition day unset or older
   *   3. same-day write again (another request rolled the day over first)
   * Resolves the DynamoDB result of the write that landed, or null when all
   * conditions failed. Non-condition errors propagate to the caller.
   */
  async function addToday(sk, userId, { lifetime, lifetimeValues, field, ph, amount, maxBefore }) {
    const now = Date.now();
    const today = dayStart(now);
    const Key = { pk: buildMediaPk(userId), sk };
    const base = { ...lifetimeValues, ":now": now, ":ds": today, [ph]: amount };
    const send = async (UpdateExpression, ConditionExpression, values) => {
      try {
        return await dynamoClient.send(
          new UpdateCommand({
            TableName: mediaTable,
            Key,
            UpdateExpression,
            ConditionExpression,
            ExpressionAttributeValues: values,
            ReturnValues: "UPDATED_NEW",
          })
        );
      } catch (err) {
        if (isConditionFailure(err)) return null;
        throw err;
      }
    };
    const sameDay = () =>
      send(
        `ADD ${lifetime}, ${field} ${ph} SET lastUpdatedAt = :now`,
        maxBefore === undefined
          ? "dayStartedAt = :ds"
          : `dayStartedAt = :ds AND ${field} <= :maxBefore`,
        maxBefore === undefined ? base : { ...base, ":maxBefore": maxBefore }
      );
    return (
      (await sameDay()) ||
      (await send(
        `ADD ${lifetime} SET ${field} = ${ph}, dayStartedAt = :ds, lastUpdatedAt = :now`,
        "attribute_not_exists(dayStartedAt) OR dayStartedAt < :ds",
        base
      )) ||
      sameDay()
    );
  }

  /**
   * Record one turn's usage. Pass the aggregated input+output tokens across
   * all Bedrock calls in the turn (initial Converse + closing turn).
   *
   * Also increments `tokensToday` (rolling at UTC midnight) so the daily-cap
   * gate has fresh numbers, in one atomic write and no read.
   */
  async function record(userId, { inputTokens = 0, outputTokens = 0 } = {}) {
    if (!userId) return;
    const it = Math.max(0, Math.floor(Number(inputTokens) || 0));
    const ot = Math.max(0, Math.floor(Number(outputTokens) || 0));
    if (it === 0 && ot === 0) return;
    try {
      await addToday(buildAgentCostSk(), userId, {
        lifetime: "inputTokens :i, outputTokens :o, turnCount :one",
        lifetimeValues: { ":i": it, ":o": ot, ":one": 1 },
        field: "tokensToday",
        ph: ":tt",
        amount: it + ot,
      });
    } catch {
      // Silent — telemetry must never break a request
    }
  }

  /**
   * Check whether the user is under their daily IMAGE cap (separate from the
   * token cap). Caps the Replicate spend exposure — image generation is the
   * dominant cost driver (prices: config/pricing.js).
   *
   * Returns { allowed: true, remaining } on success;
   *         { allowed: false, capacity, imagesToday, retryAfterMs } when over.
   * Fails open on DB errors.
   */
  async function checkDailyImageCap(userId, opts = {}) {
    const cap = opts.dailyImageCap ?? limits.imageDailyCap;
    if (!userId || cap <= 0) return { allowed: true, remaining: null, retryAfterMs: 0 };
    const today = dayStart();
    try {
      const result = await dynamoClient.send(
        new GetCommand({
          TableName: mediaTable,
          Key: { pk: buildMediaPk(userId), sk: buildAgentImageCountSk() },
        })
      );
      const item = result?.Item;
      const imagesToday =
        item?.dayStartedAt && item.dayStartedAt >= today ? item.imagesToday || 0 : 0;
      if (imagesToday >= cap) {
        const retryAfterMs = Math.max(1000, today + ONE_DAY_MS - Date.now());
        return { allowed: false, capacity: cap, imagesToday, retryAfterMs };
      }
      return { allowed: true, remaining: cap - imagesToday, retryAfterMs: 0 };
    } catch {
      return { allowed: true, remaining: null, retryAfterMs: 0 };
    }
  }

  /**
   * Increment the user's daily image counter. Resets at UTC midnight; both
   * `imagesToday` and `totalImages` are atomic ADDs (see addToday), so counts
   * can't be lost under concurrency.
   */
  async function recordImage(userId, count = 1) {
    if (!userId) return;
    const n = Math.max(1, Math.floor(Number(count) || 1));
    try {
      await addToday(buildAgentImageCountSk(), userId, {
        lifetime: "totalImages :n",
        lifetimeValues: { ":n": n },
        field: "imagesToday",
        ph: ":it",
        amount: n,
      });
    } catch {
      // Silent — telemetry must never break a request
    }
  }

  /**
   * Reserve one image against the daily image cap in a single conditional
   * write (check and increment cannot be split by a concurrent request).
   * Never rejects. Returns
   *   { allowed: true, remaining, retryAfterMs: 0 }
   *   { allowed: false, reason: "cap_reached", capacity, imagesToday: null, retryAfterMs }
   *   { allowed: false, reason: "unavailable", retryAfterMs }  (failMode "closed" only)
   * Pair with releaseImage when the paid call is not made.
   */
  async function reserveImage(userId, opts = {}) {
    const cap = opts.dailyImageCap ?? limits.imageDailyCap;
    if (!userId || cap <= 0) return { allowed: true, remaining: null, retryAfterMs: 0 };
    try {
      const result = await addToday(buildAgentImageCountSk(), userId, {
        lifetime: "totalImages :n",
        lifetimeValues: { ":n": 1 },
        field: "imagesToday",
        ph: ":it",
        amount: 1,
        maxBefore: cap - 1,
      });
      if (result) {
        const used = result.Attributes?.imagesToday;
        return {
          allowed: true,
          remaining: typeof used === "number" ? Math.max(0, cap - used) : null,
          retryAfterMs: 0,
        };
      }
      const retryAfterMs = Math.max(1000, dayStart() + ONE_DAY_MS - Date.now());
      return {
        allowed: false,
        reason: "cap_reached",
        capacity: cap,
        imagesToday: null,
        retryAfterMs,
      };
    } catch {
      if (limits.failMode === SPEND_FAIL_MODE.CLOSED) {
        const retryAfterMs = limits.unavailableRetryAfterSeconds * 1000;
        return { allowed: false, reason: "unavailable", retryAfterMs };
      }
      return { allowed: true, remaining: null, retryAfterMs: 0 };
    }
  }

  /** Give back one reserved image. Never rejects; only touches today's counter. */
  async function releaseImage(userId) {
    if (!userId) return;
    try {
      await dynamoClient.send(
        new UpdateCommand({
          TableName: mediaTable,
          Key: { pk: buildMediaPk(userId), sk: buildAgentImageCountSk() },
          UpdateExpression: "ADD imagesToday :minusOne SET lastUpdatedAt = :now",
          ConditionExpression: "dayStartedAt = :ds AND imagesToday >= :one",
          ExpressionAttributeValues: {
            ":minusOne": -1,
            ":one": 1,
            ":now": Date.now(),
            ":ds": dayStart(),
          },
        })
      );
    } catch {
      // Silent — a stale or missing counter needs no release
    }
  }

  /**
   * Check whether the user is under their daily token cap. Returns
   *   { allowed: true, remaining }            on success
   *   { allowed: false, capacity, tokensToday, retryAfterMs } when over
   * Fails open on DB errors. Default cap is 200k tokens/day ($0.20 all-input
   * to $1.00 all-output at Haiku 4.5 list rates) — tunable per call via
   * opts.dailyCap.
   */
  async function checkDailyCap(userId, opts = {}) {
    const cap = opts.dailyCap ?? limits.tokenDailyCap;
    if (!userId || cap <= 0) return { allowed: true, remaining: null, retryAfterMs: 0 };
    const today = dayStart();
    try {
      const result = await dynamoClient.send(
        new GetCommand({
          TableName: mediaTable,
          Key: { pk: buildMediaPk(userId), sk: buildAgentCostSk() },
        })
      );
      const item = result?.Item;
      // Counter rolls over at UTC midnight automatically by ignoring old data
      const tokensToday =
        item?.dayStartedAt && item.dayStartedAt >= today ? item.tokensToday || 0 : 0;
      if (tokensToday >= cap) {
        const retryAfterMs = Math.max(1000, today + ONE_DAY_MS - Date.now());
        return { allowed: false, capacity: cap, tokensToday, retryAfterMs };
      }
      return { allowed: true, remaining: cap - tokensToday, retryAfterMs: 0 };
    } catch {
      return { allowed: true, remaining: null, retryAfterMs: 0 };
    }
  }

  async function load(userId) {
    if (!userId) return null;
    try {
      const result = await dynamoClient.send(
        new GetCommand({
          TableName: mediaTable,
          Key: { pk: buildMediaPk(userId), sk: buildAgentCostSk() },
        })
      );
      if (!result?.Item) return null;
      return {
        inputTokens: result.Item.inputTokens || 0,
        outputTokens: result.Item.outputTokens || 0,
        turnCount: result.Item.turnCount || 0,
        lastUpdatedAt: result.Item.lastUpdatedAt || null,
      };
    } catch {
      return null;
    }
  }

  /**
   * Admin-only — scan all AGENT#COST records across users. Returns
   * `{ items, scannedCount, lastKey? }`. Uses a FilterExpression on the
   * single-table sort key; intentionally not optimised for read-heavy paths
   * since this powers the Sanctum cost dashboard (occasional access).
   *
   * Stops at `maxItems` after merging pages (default 200).
   */
  async function scanAll({ maxItems = 200 } = {}) {
    const items = [];
    let exclusiveStartKey;
    let scanned = 0;
    let pages = 0;
    const MAX_PAGES = 10; // hard ceiling so a misuse can't burn capacity

    try {
      do {
        const result = await dynamoClient.send(
          new ScanCommand({
            TableName: mediaTable,
            FilterExpression: "sk = :sk",
            ExpressionAttributeValues: { ":sk": buildAgentCostSk() },
            ExclusiveStartKey: exclusiveStartKey,
          })
        );
        scanned += result?.ScannedCount || 0;
        for (const item of result?.Items || []) {
          // pk format is "USER#<sub>"
          const userId = String(item.pk || "").replace(/^USER#/, "");
          items.push({
            userId,
            inputTokens: item.inputTokens || 0,
            outputTokens: item.outputTokens || 0,
            turnCount: item.turnCount || 0,
            lastUpdatedAt: item.lastUpdatedAt || null,
          });
          if (items.length >= maxItems) break;
        }
        exclusiveStartKey = result?.LastEvaluatedKey;
        pages += 1;
      } while (exclusiveStartKey && items.length < maxItems && pages < MAX_PAGES);
    } catch {
      // Return whatever we collected
    }
    return {
      items,
      scannedCount: scanned,
      truncated: Boolean(exclusiveStartKey) && items.length >= maxItems,
    };
  }

  return {
    record,
    load,
    scanAll,
    checkDailyCap,
    checkDailyImageCap,
    recordImage,
    reserveImage,
    releaseImage,
  };
}

module.exports = { createAgentCost, DEFAULT_IMAGE_DAILY_CAP };
