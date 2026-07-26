"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createJobStore,
  normalizeJobStatus,
  normalizeJobItem,
  buildJobKey,
  isTerminal,
  JOB_STATUS,
} = require("../lib/jobs");

const makeStore = (existing = []) => {
  const written = [];
  const store = createJobStore({
    putMediaItem: async (args) => {
      written.push(args);
      // Simulate the table: later writes to the same key replace earlier ones.
      const idx = existing.findIndex((i) => i.key === args.key);
      const item = { key: args.key, type: "JOB", ...args.extra };
      if (idx >= 0) existing[idx] = item;
      else existing.push(item);
    },
    queryMediaItems: async () => existing,
  });
  return { store, written, existing };
};

test("normalizeJobStatus collapses every provider vocabulary to one", () => {
  // Replicate / CivitAI
  assert.equal(normalizeJobStatus("starting"), JOB_STATUS.RUNNING);
  assert.equal(normalizeJobStatus("processing"), JOB_STATUS.RUNNING);
  assert.equal(normalizeJobStatus("succeeded"), JOB_STATUS.COMPLETED);
  assert.equal(normalizeJobStatus("canceled"), JOB_STATUS.FAILED);
  // Bedrock PascalCase
  assert.equal(normalizeJobStatus("InProgress"), JOB_STATUS.RUNNING);
  assert.equal(normalizeJobStatus("Completed"), JOB_STATUS.COMPLETED);
  assert.equal(normalizeJobStatus("Failed"), JOB_STATUS.FAILED);
  // Local UI vocabulary
  assert.equal(normalizeJobStatus("pending"), JOB_STATUS.QUEUED);
  assert.equal(normalizeJobStatus("done"), JOB_STATUS.COMPLETED);
  assert.equal(normalizeJobStatus("error"), JOB_STATUS.FAILED);
  // Unknown / empty defaults to queued rather than throwing
  assert.equal(normalizeJobStatus(""), JOB_STATUS.QUEUED);
  assert.equal(normalizeJobStatus("wat"), JOB_STATUS.QUEUED);
});

test("isTerminal only for completed/failed", () => {
  assert.equal(isTerminal("succeeded"), true);
  assert.equal(isTerminal("Failed"), true);
  assert.equal(isTerminal("processing"), false);
  assert.equal(isTerminal("queued"), false);
});

test("buildJobKey keeps the existing render/{provider}/{kind}/{ref} convention", () => {
  assert.equal(
    buildJobKey({ provider: "replicate", kind: "image", providerRef: "pred-1" }),
    "render/replicate/image/pred-1"
  );
});

test("normalizeJobItem reads legacy rows (entityType, no jobId, provider ids)", () => {
  const legacy = normalizeJobItem({
    key: "render/replicate/image/pred-9",
    entityType: "image",
    provider: "replicate",
    predictionId: "pred-9",
    status: "starting",
    progressPct: 18,
    createdAt: "2026-01-01T00:00:00.000Z",
  });
  assert.equal(legacy.kind, "image", "entityType maps to kind");
  assert.equal(legacy.jobId, "render/replicate/image/pred-9", "key stands in for a missing jobId");
  assert.equal(legacy.providerRef, "pred-9", "predictionId maps to providerRef");
  assert.equal(legacy.status, JOB_STATUS.RUNNING, "provider status is normalised");
  assert.equal(legacy.startedAt, "2026-01-01T00:00:00.000Z");

  // Bedrock's invocationArn and CivitAI's token collapse to the same field.
  assert.equal(normalizeJobItem({ invocationArn: "arn:x" }).providerRef, "arn:x");
  assert.equal(normalizeJobItem({ token: "tok-1" }).providerRef, "tok-1");
});

test("createJob writes a normalised row and returns it", async () => {
  const { store, written } = makeStore();
  const job = await store.createJob({
    userId: "u1",
    kind: "illustration",
    provider: "replicate",
    providerRef: "pred-1",
    status: "starting",
    parent: { sessionId: "story-1", sceneId: "scene-1" },
  });

  assert.equal(written.length, 1);
  assert.equal(written[0].type, "JOB");
  assert.equal(written[0].key, "render/replicate/illustration/pred-1");
  // entityType retained so the existing admin Job Queue still groups these.
  assert.equal(written[0].extra.entityType, "illustration");
  assert.equal(job.status, JOB_STATUS.RUNNING);
  assert.equal(job.kind, "illustration");
  assert.deepEqual(job.parent, { sessionId: "story-1", sceneId: "scene-1" });
  assert.ok(job.jobId.startsWith("job-"));
});

test("updateJob advances status and stamps completedAt only on terminal", async () => {
  const { store } = makeStore();
  const job = await store.createJob({
    userId: "u1",
    kind: "image",
    provider: "replicate",
    providerRef: "pred-2",
  });

  const running = await store.updateJob({ userId: "u1", job, status: "processing" });
  assert.equal(running.status, JOB_STATUS.RUNNING);
  assert.equal(running.completedAt, null);

  const done = await store.updateJob({
    userId: "u1",
    job: { ...job, key: "render/replicate/image/pred-2" },
    status: "succeeded",
    result: { key: "users/u1/img.png", url: "https://signed" },
  });
  assert.equal(done.status, JOB_STATUS.COMPLETED);
  assert.ok(done.completedAt);
  assert.deepEqual(done.result, { key: "users/u1/img.png", url: "https://signed" });
});

test("listJobs active=true hides terminal jobs and sorts newest first", async () => {
  const existing = [
    {
      key: "render/replicate/image/a",
      entityType: "image",
      status: "succeeded",
      startedAt: "2026-01-01T00:00:00.000Z",
    },
    {
      key: "render/replicate/video/b",
      entityType: "video",
      status: "processing",
      startedAt: "2026-01-03T00:00:00.000Z",
    },
    {
      key: "render/replicate/music/c",
      entityType: "music",
      status: "starting",
      startedAt: "2026-01-02T00:00:00.000Z",
    },
  ];
  const { store } = makeStore(existing);

  const all = await store.listJobs({ userId: "u1" });
  assert.equal(all.length, 3);
  assert.equal(all[0].kind, "video", "newest first");

  const active = await store.listJobs({ userId: "u1", activeOnly: true });
  assert.deepEqual(
    active.map((j) => j.kind),
    ["video", "music"],
    "the completed image job is excluded"
  );
});

test("getJob finds by jobId or by legacy key", async () => {
  const { store } = makeStore();
  const job = await store.createJob({
    userId: "u1",
    kind: "image",
    provider: "replicate",
    providerRef: "pred-3",
  });
  assert.equal((await store.getJob({ userId: "u1", jobId: job.jobId }))?.jobId, job.jobId);
  assert.ok(await store.getJob({ userId: "u1", jobId: "render/replicate/image/pred-3" }));
  assert.equal(await store.getJob({ userId: "u1", jobId: "nope" }), null);
});

test("store degrades to no-ops without a media store", async () => {
  const store = createJobStore({});
  assert.equal(await store.createJob({ userId: "u1", kind: "image" }), null);
  assert.deepEqual(await store.listJobs({ userId: "u1" }), []);
});
