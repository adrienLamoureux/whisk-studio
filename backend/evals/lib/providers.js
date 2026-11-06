"use strict";

/**
 * Provider stubs for eval dispatch. `dispatchTool` is the REAL router; only the
 * things it would reach over the network (Replicate, S3, DynamoDB) are faked, so
 * an eval run can never spend money or touch a bucket. Pure config and helper
 * functions (model config, prediction request builder) are the real ones.
 */

const { replicateModelConfig, DEFAULT_NEGATIVE_PROMPT } = require("../../config/models");
const {
  buildReplicatePredictionRequest,
  getReplicateOutputUrls,
} = require("../../lib/replicate-utils");

const STUB_USER_ID = "eval-user";

// A tiny story library the intent tools (continue_story, generate_music) resolve against.
const SESSIONS = [
  { sk: "SESSION#s-1", sessionId: "s-1", title: "Rooftop Nights", updatedAt: 200 },
  { sk: "SESSION#s-1#SCENE#sc-1", sceneId: "sc-1", createdAt: 100 },
  { sk: "SESSION#s-1#SCENE#sc-2", sceneId: "sc-2", createdAt: 150 },
];

const IMAGES = [1, 2, 3, 4, 5].map((n) => ({
  key: `users/${STUB_USER_ID}/img-${n}.png`,
  prompt: `stub prompt ${n}`,
  model: "stub",
  createdAt: n * 1000,
}));

class StubCommand {
  constructor(input) {
    this.input = input;
  }
}

const createStubDeps = () => {
  const calls = { replicate: 0, s3: 0, signed: 0 };
  let batch = 0;
  const deps = {
    replicateClient: {
      predictions: {
        create: async () => {
          calls.replicate += 1;
          return { id: `stub-pred-${calls.replicate}`, status: "starting" };
        },
      },
    },
    replicateModelConfig,
    buildReplicatePredictionRequest,
    getReplicateOutputUrls,
    DEFAULT_NEGATIVE_PROMPT,
    buildImageBatchId: () => `stub-batch-${(batch += 1)}`,
    clampPromptTokens: (p) => p,
    putMediaItem: async () => {},
    queryMediaItems: async () => IMAGES,
    queryBySkPrefix: async () => SESSIONS,
    buildMediaPk: (userId) => `USER#${userId}`,
    agentState: { patch: async () => ({}), load: async () => null },
    agentCost: { checkDailyImageCap: async () => ({ allowed: true }), recordImage: async () => {} },
    s3Client: {
      send: async () => {
        calls.s3 += 1;
        return {
          Contents: IMAGES.map((i) => ({
            Key: `shared/images/${i.key.split("/").pop()}`,
            LastModified: new Date(i.createdAt),
          })),
        };
      },
    },
    GetObjectCommand: StubCommand,
    ListObjectsV2Command: StubCommand,
    getSignedUrl: async (_client, cmd) => {
      calls.signed += 1;
      return `https://stub.invalid/${cmd.input.Key}`;
    },
  };
  return { deps, calls };
};

/** Env the stubbed dispatchers expect. Set unconditionally: replay must be deterministic. */
const applyStubEnv = () => {
  process.env.REPLICATE_API_TOKEN = "eval-stub-token";
  process.env.MEDIA_BUCKET = "eval-stub-bucket";
};

/** In replay mode nothing may use the network: make any accidental fetch loud. */
const blockNetwork = () => {
  globalThis.fetch = async (url) => {
    throw new Error(`network access blocked in eval replay: ${url}`);
  };
};

module.exports = { createStubDeps, applyStubEnv, blockNetwork, STUB_USER_ID };
