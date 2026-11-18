"use strict";

/**
 * spend-middleware.js - charge the daily dollar budget before a paid call.
 * The charge is refunded once when the response ends with status >= 400 or the
 * handler calls markSpendSkipped(res) (cached result). Signed-in callers spend
 * their own budget; the rest share the anonymous one.
 */

const { MICRO_USD_PER_USD } = require("../config/pricing");
const { SPEND_FAIL_MODE, loadSpendLimits } = require("../config/spend-limits");

const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_UNAVAILABLE = 503;
const HTTP_ERROR_FLOOR = 400;
const MS_PER_SECOND = 1000;

const retryAfterHeader = (ms) => String(Math.max(1, Math.ceil((Number(ms) || 0) / MS_PER_SECOND)));

const refundOnce = (deps, charge) => {
  if (charge.refunded || !(charge.microUsd > 0)) return;
  charge.refunded = true;
  const { scope, dayKey, microUsd } = charge;
  // refund never rejects by contract; the catch guards a misbehaving stub.
  Promise.resolve(deps.spendBudget.refund({ scope, dayKey, microUsd })).catch(() => {});
};

const sendDenied = (res, verdict) => {
  res.set("Retry-After", retryAfterHeader(verdict.retryAfterMs));
  if (verdict.reason === "unavailable") {
    return res.status(HTTP_UNAVAILABLE).json({
      error: "spend_check_unavailable",
      message: "Spending check unavailable. Try again shortly.",
      retryAfterMs: verdict.retryAfterMs,
    });
  }
  return res.status(HTTP_TOO_MANY_REQUESTS).json({
    error: "spend_budget_reached",
    message: "Daily spending budget reached. It resets at midnight UTC.",
    scope: verdict.scope,
    limitUsd: verdict.limitMicroUsd / MICRO_USD_PER_USD,
    retryAfterMs: verdict.retryAfterMs,
  });
};

/**
 * Express middleware charging `resolver(req)` to the caller's daily budget.
 * Without deps.spendBudget it passes through (tests, local dev). A throw while
 * resolving or charging answers 503 in closed fail mode and passes in open mode.
 */
function spendGuard(deps, resolver, limits = loadSpendLimits()) {
  const failClosed = limits.failMode === SPEND_FAIL_MODE.CLOSED;
  const guard = async (req, res, next) => {
    if (!deps?.spendBudget || req.method === "OPTIONS") return next();
    const scope = req.user?.sub ? { kind: "user", id: req.user.sub } : { kind: "anon" };
    let verdict;
    try {
      verdict = await deps.spendBudget.charge({ scope, ...resolver(req) });
    } catch (error) {
      // A bad body or a throwing budget must still end in one outcome, never a hung request.
      console.error("Spend guard failed:", error?.message || String(error));
      if (!failClosed) return next();
      const retryAfterMs = limits.unavailableRetryAfterSeconds * MS_PER_SECOND;
      return sendDenied(res, { reason: "unavailable", retryAfterMs });
    }
    if (!verdict.allowed) return sendDenied(res, verdict);

    const { dayKey, microUsd } = verdict;
    const charge = { scope, dayKey, microUsd, skip: false, refunded: false };
    if (res.locals && typeof res.on === "function") {
      res.locals.spendCharge = charge;
      res.on("finish", () => {
        if (res.statusCode >= HTTP_ERROR_FLOOR || charge.skip) refundOnce(deps, charge);
      });
    }
    return next();
  };
  guard.spendResolver = resolver; // lets a route test see which resolver guards a route
  return guard;
}

/** The handler served a cached result: the charge is refunded when the response finishes. */
function markSpendSkipped(res) {
  if (res?.locals?.spendCharge) res.locals.spendCharge.skip = true;
}

/** spendGuardFor lives with the resolvers; loaded on first use because they require this file. */
function spendGuardFor(deps, name) {
  return require("./spend-resolvers").spendGuardFor(deps, name);
}

module.exports = { spendGuard, markSpendSkipped, spendGuardFor };
