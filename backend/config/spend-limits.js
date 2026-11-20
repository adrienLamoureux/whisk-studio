"use strict";

/**
 * spend-limits.js - daily spending limits and their environment overrides.
 *
 * Prices live in config/pricing.js; this file only holds the limits that the
 * daily dollar budget (lib/spend-budget.js) and the agent counters
 * (lib/agent-cost.js) enforce.
 */

const SPEND_FAIL_MODE = Object.freeze({ OPEN: "open", CLOSED: "closed" });

const SPEND_LIMIT_DEFAULTS = Object.freeze({
  userDailyBudgetUsd: 3,
  anonDailyBudgetUsd: 1,
  failMode: SPEND_FAIL_MODE.CLOSED,
  unavailableRetryAfterSeconds: 60,
  tokenDailyCap: 200_000,
  imageDailyCap: 50,
});

const SPEND_LIMIT_ENV = Object.freeze({
  userDailyBudgetUsd: "SPEND_USER_DAILY_BUDGET_USD",
  anonDailyBudgetUsd: "SPEND_ANON_DAILY_BUDGET_USD",
  failMode: "SPEND_FAIL_MODE",
  unavailableRetryAfterSeconds: "SPEND_UNAVAILABLE_RETRY_AFTER_SECONDS",
  tokenDailyCap: "AGENT_TOKEN_DAILY_CAP",
  imageDailyCap: "AGENT_IMAGE_DAILY_CAP",
});

// Mirrors the clamps already in the routes (replicate-image, civitai, bedrock).
// If a route clamp changes, this table must follow.
const MAX_BILLABLE_IMAGES_PER_REQUEST = Object.freeze({ replicate: 2, civitai: 4, bedrock: 2 });

const readNumber = (raw, fallback) => {
  if (raw === undefined || raw === null || String(raw).trim() === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

const readFailMode = (raw, fallback) => {
  const normalized = String(raw ?? "")
    .trim()
    .toLowerCase();
  return Object.values(SPEND_FAIL_MODE).includes(normalized) ? normalized : fallback;
};

/**
 * Read the six limits from env. An invalid or missing value falls back to the
 * default. Numbers must be finite and >= 0; a budget <= 0 disables that budget.
 *
 * @param {object} [env]
 * @returns {{userDailyBudgetUsd:number, anonDailyBudgetUsd:number, failMode:string,
 *   unavailableRetryAfterSeconds:number, tokenDailyCap:number, imageDailyCap:number}}
 */
function loadSpendLimits(env = process.env) {
  const source = env || {};
  const defaults = SPEND_LIMIT_DEFAULTS;
  const names = SPEND_LIMIT_ENV;
  return {
    userDailyBudgetUsd: readNumber(source[names.userDailyBudgetUsd], defaults.userDailyBudgetUsd),
    anonDailyBudgetUsd: readNumber(source[names.anonDailyBudgetUsd], defaults.anonDailyBudgetUsd),
    failMode: readFailMode(source[names.failMode], defaults.failMode),
    unavailableRetryAfterSeconds: readNumber(
      source[names.unavailableRetryAfterSeconds],
      defaults.unavailableRetryAfterSeconds
    ),
    tokenDailyCap: readNumber(source[names.tokenDailyCap], defaults.tokenDailyCap),
    imageDailyCap: readNumber(source[names.imageDailyCap], defaults.imageDailyCap),
  };
}

module.exports = {
  SPEND_FAIL_MODE,
  SPEND_LIMIT_DEFAULTS,
  SPEND_LIMIT_ENV,
  MAX_BILLABLE_IMAGES_PER_REQUEST,
  loadSpendLimits,
};
