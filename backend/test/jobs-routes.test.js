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

const JOBS = [
  {
    key: "render/replicate/image/a",
    entityType: "image",
    provider: "replicate",
    predictionId: "a",
    status: "succeeded",
    startedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    key: "render/replicate/animation/b",
    kind: "animation",
    jobId: "job-b",
    provider: "replicate",
    providerRef: "b",
    status: "processing",
    parent: { sessionId: "story-1", sceneId: "scene-1" },
    startedAt: "2026-01-02T00:00:00.000Z",
  },
];

const buildRouter = (items = JOBS) => {
  const deps = createMockDeps({ queryMediaItems: async () => items });
  return require("../routes/jobs-routes")(deps);
};

test("GET /jobs returns every job, newest first, in one vocabulary", async () => {
  const handler = getRouterHandler(buildRouter(), "get", "/jobs");
  const res = createRes();
  await handler({ user: { sub: "u1" }, query: {} }, res);

  assert.equal(res.out.statusCode, 200);
  assert.equal(res.out.payload.jobs.length, 2);
  assert.equal(res.out.payload.jobs[0].kind, "animation", "newest first");
  // Provider vocabularies are normalised away at the boundary.
  assert.deepEqual(res.out.payload.jobs.map((j) => j.status).sort(), ["completed", "running"]);
  // Legacy rows still resolve a kind and a providerRef.
  const legacy = res.out.payload.jobs.find((j) => j.kind === "image");
  assert.equal(legacy.providerRef, "a");
});

test("GET /jobs?active=1 returns only work still in flight", async () => {
  const handler = getRouterHandler(buildRouter(), "get", "/jobs");
  const res = createRes();
  await handler({ user: { sub: "u1" }, query: { active: "1" } }, res);

  assert.equal(res.out.payload.jobs.length, 1);
  assert.equal(res.out.payload.jobs[0].kind, "animation");
  // Story media carries its parent so the UI can attach it to a scene.
  assert.deepEqual(res.out.payload.jobs[0].parent, {
    sessionId: "story-1",
    sceneId: "scene-1",
  });
});

test("GET /jobs/:jobId finds by jobId and 404s otherwise", async () => {
  const handler = getRouterHandler(buildRouter(), "get", "/jobs/:jobId");

  const found = createRes();
  await handler({ user: { sub: "u1" }, params: { jobId: "job-b" } }, found);
  assert.equal(found.out.statusCode, 200);
  assert.equal(found.out.payload.job.kind, "animation");

  const missing = createRes();
  await handler({ user: { sub: "u1" }, params: { jobId: "nope" } }, missing);
  assert.equal(missing.out.statusCode, 404);
});

test("GET /jobs requires auth", async () => {
  const handler = getRouterHandler(buildRouter(), "get", "/jobs");
  const res = createRes();
  await handler({ user: {}, query: {} }, res);
  assert.equal(res.out.statusCode, 401);
});
