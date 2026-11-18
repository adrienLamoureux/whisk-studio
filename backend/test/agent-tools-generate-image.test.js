"use strict";

/**
 * Tests for the generate_image dispatcher's image daily cap gate.
 *
 * The cap is the single bound on Replicate spend per user (the dominant cost
 * driver — ~90% of total per the v1.7 cost model). Without this, a token-cap-
 * exhausted user could still burn unlimited Replicate budget.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const { dispatchGenerateImage } = require("../lib/agent-tools/generate-image");

// Minimal deps needed for the dispatcher to reach the cap gate without
// firing real Replicate calls. The cap is checked BEFORE Replicate is
// invoked, so we don't need to stub Replicate for the deny case.
const baseDeps = () => ({
  replicateClient: { predictions: { create: async () => ({ id: "p-1", status: "starting" }) } },
  replicateModelConfig: {
    "wai-nsfw-illustrious-v11": {
      modelId: "test-model:v1",
      buildInput: () => ({}),
      sizes: [{ width: 768, height: 1024 }],
      schedulers: ["x"],
    },
  },
  buildReplicatePredictionRequest: () => ({}),
  buildImageBatchId: () => "batch-1",
  buildImageKey: () => "users/u1/images/1.png",
  putMediaItem: async () => {},
  clampPromptTokens: (p) => p,
  getReplicateOutputUrls: () => [],
  DEFAULT_NEGATIVE_PROMPT: "low",
  fetchImageBuffer: async () => ({ buffer: Buffer.alloc(0), contentType: "image/png" }),
  s3Client: { send: async () => ({}) },
  PutObjectCommand: function () {},
  GetObjectCommand: function () {},
  getSignedUrl: async () => "https://example.com/signed",
  agentState: { patch: async () => {}, load: async () => null },
});

test("dispatchGenerateImage refuses when daily image cap is reached", async () => {
  process.env.REPLICATE_API_TOKEN = "fake-token";
  let replicateCalled = false;
  const deps = {
    ...baseDeps(),
    replicateClient: {
      predictions: {
        create: async () => {
          replicateCalled = true;
          return { id: "p-1", status: "starting" };
        },
      },
    },
    agentCost: {
      reserveImage: async () => ({
        allowed: false,
        reason: "cap_reached",
        capacity: 50,
        imagesToday: 50,
        retryAfterMs: 60_000,
      }),
      releaseImage: async () => {},
    },
  };
  const out = await dispatchGenerateImage({
    args: { prompt: "test", style: "anime", aspect: "3:4" },
    deps,
    userId: "u1",
  });
  assert.equal(out.ok, false);
  assert.equal(out.error, "image_daily_cap_reached");
  assert.equal(out.imagesToday, 50);
  assert.equal(out.capacity, 50);
  assert.equal(replicateCalled, false, "must not call Replicate when capped");
});

const allowedCharge = {
  allowed: true,
  reason: "charged",
  scope: "user",
  microUsd: 12_000,
  dayKey: "2026-11-16",
  limitMicroUsd: 3_000_000,
  spentMicroUsd: 12_000,
  retryAfterMs: 0,
};

test("dispatchGenerateImage proceeds when under cap and reserves the image", async () => {
  process.env.REPLICATE_API_TOKEN = "fake-token";
  let reserved = 0;
  let released = 0;
  const deps = {
    ...baseDeps(),
    agentCost: {
      reserveImage: async () => {
        reserved += 1;
        return { allowed: true, remaining: 49, retryAfterMs: 0 };
      },
      releaseImage: async () => {
        released += 1;
      },
    },
  };
  const out = await dispatchGenerateImage({
    args: { prompt: "test", style: "anime", aspect: "3:4" },
    deps,
    userId: "u1",
  });
  assert.equal(out.ok, true);
  assert.equal(reserved, 1, "must reserve one image before calling Replicate");
  assert.equal(released, 0, "must keep the reservation on success");
});

test("budget denial releases the image reservation", async () => {
  process.env.REPLICATE_API_TOKEN = "fake-token";
  let replicateCalled = false;
  let released = 0;
  const deps = {
    ...baseDeps(),
    replicateClient: {
      predictions: {
        create: async () => {
          replicateCalled = true;
          return { id: "p-1", status: "starting" };
        },
      },
    },
    agentCost: {
      reserveImage: async () => ({ allowed: true, remaining: 49, retryAfterMs: 0 }),
      releaseImage: async () => {
        released += 1;
      },
    },
    spendBudget: {
      charge: async () => ({
        allowed: false,
        reason: "budget_exhausted",
        scope: "user",
        microUsd: 12_000,
        dayKey: "2026-11-16",
        limitMicroUsd: 3_000_000,
        spentMicroUsd: null,
        retryAfterMs: 5_000,
      }),
      refund: async () => {},
    },
  };
  const out = await dispatchGenerateImage({
    args: { prompt: "test", style: "anime", aspect: "3:4" },
    deps,
    userId: "u1",
  });
  assert.equal(out.ok, false);
  assert.equal(out.error, "spend_budget_reached");
  assert.equal(out.limitUsd, 3);
  assert.equal(out.retryAfterMs, 5_000);
  assert.equal(released, 1, "must release the reservation");
  assert.equal(replicateCalled, false, "must not call Replicate when over budget");
});

test("replicate failure refunds the charge", async () => {
  process.env.REPLICATE_API_TOKEN = "fake-token";
  let released = 0;
  const refunds = [];
  const deps = {
    ...baseDeps(),
    replicateClient: {
      predictions: {
        create: async () => {
          throw new Error("replicate down");
        },
      },
    },
    agentCost: {
      reserveImage: async () => ({ allowed: true, remaining: 49, retryAfterMs: 0 }),
      releaseImage: async () => {
        released += 1;
      },
    },
    spendBudget: {
      charge: async () => allowedCharge,
      refund: async (args) => {
        refunds.push(args);
      },
    },
  };
  const out = await dispatchGenerateImage({
    args: { prompt: "test", style: "anime", aspect: "3:4" },
    deps,
    userId: "u1",
  });
  assert.equal(out.ok, false);
  assert.equal(out.error, "replicate down");
  assert.equal(released, 1);
  assert.deepEqual(refunds, [
    { scope: { kind: "user", id: "u1" }, dayKey: "2026-11-16", microUsd: 12_000 },
  ]);
});

test("dispatchGenerateImage tolerates a missing agentCost dep (fail open)", async () => {
  process.env.REPLICATE_API_TOKEN = "fake-token";
  const deps = { ...baseDeps() }; // no agentCost wired
  const out = await dispatchGenerateImage({
    args: { prompt: "test", style: "anime", aspect: "3:4" },
    deps,
    userId: "u1",
  });
  assert.equal(out.ok, true);
});
