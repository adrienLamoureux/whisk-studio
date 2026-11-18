"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");

const express = require("express");

const { spendGuard, markSpendSkipped } = require("../lib/spend-middleware");
const { SPEND_RESOLVERS } = require("../lib/spend-resolvers");
const { createMockDeps } = require("./helpers/mock-deps");
const { replicateModelConfig, replicateVideoConfig } = require("../config/models");

const RESOLVED = { priceKey: "titan", provider: "bedrock", count: 1 };
const REFUND = { scope: { kind: "user", id: "u1" }, dayKey: "2026-11-16", microUsd: 12000 };

const verdict = (extra = {}) => ({
  allowed: true,
  reason: "charged",
  scope: "user",
  microUsd: 12000,
  dayKey: "2026-11-16",
  limitMicroUsd: 3_000_000,
  spentMicroUsd: 12000,
  retryAfterMs: 0,
  ...extra,
});

const makeBudget = (result) => {
  const calls = { charge: [], refund: [] };
  return {
    calls,
    charge: async (arg) => (calls.charge.push(arg), result),
    refund: async (arg) => void calls.refund.push(arg),
  };
};

const makeRes = () => {
  const res = Object.assign(new EventEmitter(), { statusCode: 200, locals: {}, headers: {} });
  res.set = (name, value) => ((res.headers[name] = value), res);
  res.status = (code) => ((res.statusCode = code), res);
  res.json = (body) => ((res.body = body), res);
  return res;
};

const run = async (budget, req = { user: { sub: "u1" } }, res = makeRes()) => {
  let nextCalled = false;
  const next = () => void (nextCalled = true);
  await spendGuard({ spendBudget: budget }, () => RESOLVED)(req, res, next);
  return { res, nextCalled };
};

const finish = async (res, statusCode) => {
  res.statusCode = statusCode;
  res.emit("finish");
  res.emit("finish");
  await new Promise((resolve) => setImmediate(resolve));
};

test("denied charge returns 429 spend_budget_reached with Retry-After", async () => {
  const denied = verdict({ allowed: false, reason: "budget_exhausted", retryAfterMs: 12345 });
  const { res, nextCalled } = await run(makeBudget(denied));
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 429);
  assert.equal(res.headers["Retry-After"], "13");
  assert.deepEqual(res.body, {
    error: "spend_budget_reached",
    message: "Daily spending budget reached. It resets at midnight UTC.",
    scope: "user",
    limitUsd: 3,
    retryAfterMs: 12345,
  });
});

test("closed fail mode returns 503 spend_check_unavailable", async () => {
  const denied = verdict({ allowed: false, reason: "unavailable", retryAfterMs: 60000 });
  const { res } = await run(makeBudget(denied));
  assert.equal(res.statusCode, 503);
  assert.equal(res.headers["Retry-After"], "60");
  assert.deepEqual(res.body, {
    error: "spend_check_unavailable",
    message: "Spending check unavailable. Try again shortly.",
    retryAfterMs: 60000,
  });
});

test("scope is the signed-in user, or anon without req.user", async () => {
  const budget = makeBudget(verdict());
  await run(budget);
  await run(budget, { user: null });
  assert.deepEqual(budget.calls.charge[0], { scope: REFUND.scope, ...RESOLVED });
  assert.deepEqual(budget.calls.charge[1], { scope: { kind: "anon" }, ...RESOLVED });
});

test("allowed charge calls next and keeps the charge on res.locals", async () => {
  const { res, nextCalled } = await run(makeBudget(verdict()));
  assert.equal(nextCalled, true);
  assert.deepEqual(res.locals.spendCharge, { ...REFUND, skip: false, refunded: false });
});

test("OPTIONS, a missing spendBudget and a bare res pass through", async () => {
  const budget = makeBudget(verdict());
  assert.equal((await run(budget, { method: "OPTIONS" })).nextCalled, true);
  assert.equal(budget.calls.charge.length, 0);
  let called = 0;
  const next = () => called++;
  await spendGuard({}, () => RESOLVED)({}, makeRes(), next);
  await spendGuard({ spendBudget: budget }, () => RESOLVED)({ user: { sub: "u1" } }, {}, next);
  assert.equal(called, 2);
  markSpendSkipped({});
});

test("a 500 response refunds the charge once; a 200 keeps it", async () => {
  const failed = makeBudget(verdict());
  await finish((await run(failed)).res, 500);
  assert.deepEqual(failed.calls.refund, [REFUND]);
  const ok = makeBudget(verdict());
  await finish((await run(ok)).res, 200);
  assert.equal(ok.calls.refund.length, 0);
});

test("markSpendSkipped refunds on finish, once even with a 500", async () => {
  const budget = makeBudget(verdict());
  const { res } = await run(budget);
  markSpendSkipped(res);
  await finish(res, 500);
  assert.equal(budget.calls.refund.length, 1);
});

test("a charge of zero dollars is never refunded", async () => {
  const budget = makeBudget(verdict({ reason: "disabled", microUsd: 0 }));
  await finish((await run(budget)).res, 500);
  assert.equal(budget.calls.refund.length, 0);
});

// Any retryAfterMs under one second (for example 200 ms before UTC midnight) still says "1".
test("Retry-After never drops below one second", async () => {
  for (const retryAfterMs of [200, 0]) {
    const denied = verdict({ allowed: false, reason: "budget_exhausted", retryAfterMs });
    assert.equal((await run(makeBudget(denied))).res.headers["Retry-After"], "1");
  }
});

// `{"model":{"toString":1}}` makes String() throw inside the resolver.
const BAD_REQ = { user: { sub: "u1" }, body: { model: { toString: 1 } } };
const LIMITS = { failMode: "closed", unavailableRetryAfterSeconds: 60 };

const runResolver = async (limits, budget, resolver = SPEND_RESOLVERS.replicateVideo) => {
  const res = makeRes();
  let nextCalled = 0;
  await spendGuard({ spendBudget: budget }, resolver, limits)(BAD_REQ, res, () => nextCalled++);
  return { res, nextCalled };
};

test("a resolver that throws gets 503 in closed mode and never charges", async (t) => {
  t.mock.method(console, "error", () => {});
  const budget = makeBudget(verdict());
  const { res, nextCalled } = await runResolver(LIMITS, budget);
  assert.equal(nextCalled, 0);
  assert.equal(res.statusCode, 503);
  assert.equal(res.headers["Retry-After"], "60");
  assert.deepEqual(res.body, {
    error: "spend_check_unavailable",
    message: "Spending check unavailable. Try again shortly.",
    retryAfterMs: 60000,
  });
  assert.equal(budget.calls.charge.length, 0);
});

test("a resolver that throws passes in open mode with one outcome", async (t) => {
  t.mock.method(console, "error", () => {});
  const { res, nextCalled } = await runResolver({ ...LIMITS, failMode: "open" }, makeBudget(null));
  assert.equal(nextCalled, 1);
  assert.equal(res.body, undefined);
});

test("a charge that rejects is 503 in closed mode and next() in open mode", async (t) => {
  t.mock.method(console, "error", () => {});
  const budget = { charge: async () => Promise.reject(new Error("boom")), refund: async () => {} };
  const closed = await runResolver(LIMITS, budget, () => RESOLVED);
  assert.deepEqual([closed.res.statusCode, closed.nextCalled], [503, 0]);
  const open = await runResolver({ ...LIMITS, failMode: "open" }, budget, () => RESOLVED);
  assert.deepEqual([open.res.statusCode, open.nextCalled], [200, 1]);
});

// ---- Route level: the guard must stay on the paid routes ----

const authMarker = (req, res, next) => next(); // stands in for requireUserMiddleware
const PAID_ROUTES = [
  ["../routes/replicate-video-routes", "/replicate/video/generate", "replicateVideo"],
  ["../routes/replicate-image-routes", "/replicate/image/generate", "replicateImage"],
  ["../routes/civitai-image-routes", "/civitai/image/generate", "civitaiImage"],
  ["../routes/bedrock-routes", "/bedrock/image/generate", "bedrockImage"],
  ["../routes/gradio-routes", "/gradio/image/generate", "gradioImage"],
  ["../routes/bedrock-image-video-route", "/bedrock/nova-reel/image-to-video-s3", "novaReel"],
  ["../routes/story/illustration-routes", "/sessions/:id/illustrations", "storyIllustration"],
  ["../routes/story/animation-routes", "/sessions/:id/scenes/:sceneId/animation", "storyAnimation"],
  ["../routes/story/music-routes", "/sessions/:id/scenes/:sceneId/music", "storyMusic"],
];
// Public routes have no auth middleware: the guard is the first handler.
const PUBLIC_ROUTES = [
  ["../routes/companion-route", "/api/companion/chat"],
  ["../routes/companion-route", "/api/companion/proactive"],
  ["../routes/companion-route", "/api/companion/initiative"],
  ["../routes/core-prompt", "/bedrock/prompt-helper"],
];

const routeLayers = (stack) =>
  stack.flatMap((layer) => (layer.route ? [layer.route] : routeLayers(layer.handle.stack || [])));

test("every paid route chain is auth, then its spend guard, then the handler", () => {
  const app = express();
  const deps = createMockDeps({ requireUserMiddleware: authMarker });
  for (const [file] of [...PAID_ROUTES, ...PUBLIC_ROUTES]) {
    const register = require(file);
    const router = register.length === 1 ? register(deps) : register(app, deps);
    if (router) app.use(router);
  }
  const posts = routeLayers(app._router.stack).filter((route) => route.methods.post);
  const chains = new Map(posts.map((route) => [route.path, route.stack]));
  const handlersOf = (path) => chains.get(path).map((layer) => layer.handle);
  for (const [, path, name] of PAID_ROUTES) {
    const chain = handlersOf(path);
    const at = chain.indexOf(authMarker);
    assert.ok(at >= 0 && at < chain.length - 2, `${path} has auth before the guard and handler`);
    assert.equal(chain[at + 1].spendResolver, SPEND_RESOLVERS[name], `${path} guard is ${name}`);
  }
  for (const [, path] of PUBLIC_ROUTES) {
    const chain = handlersOf(path);
    assert.equal(chain[0].spendResolver, SPEND_RESOLVERS.bedrockLlmCall, `${path} guard first`);
    assert.ok(chain.length >= 2, `${path} keeps its handler after the guard`);
  }
});

test("replicate video route answers 429 and never calls Replicate when the budget is denied", async () => {
  const denied = verdict({ allowed: false, reason: "budget_exhausted", retryAfterMs: 5000 });
  let created = 0;
  const deps = createMockDeps({
    replicateModelConfig,
    replicateVideoConfig,
    spendBudget: makeBudget(denied),
    requireUserMiddleware: (req, res, next) => ((req.user = { sub: "u1" }), next()),
    replicateClient: { predictions: { create: async () => void created++ } },
  });
  const app = express();
  app.use(express.json());
  require("../routes/replicate-video-routes")(app, deps);
  const server = app.listen(0);
  try {
    const url = `http://127.0.0.1:${server.address().port}/replicate/video/generate`;
    const body = JSON.stringify({ inputKey: "k", prompt: "p" });
    const headers = { "Content-Type": "application/json" };
    const response = await fetch(url, { method: "POST", headers, body });
    assert.equal(response.status, 429);
    assert.equal(response.headers.get("Retry-After"), "5");
    assert.equal((await response.json()).error, "spend_budget_reached");
    assert.equal(created, 0);
  } finally {
    server.close();
  }
});
