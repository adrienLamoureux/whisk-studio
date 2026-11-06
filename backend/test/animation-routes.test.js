"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { getRouterHandler, createMockRes, withEnv } = require("./helpers/test-utils");
const { invalidateFlagsCache } = require("../lib/feature-flags");
const registerRoutes = require("../routes/story/animation-routes");

function Cmd(input) {
  this.input = input;
}

const PATH = "/sessions/:id/scenes/:sceneId/animation";
const ENV = { MEDIA_BUCKET: "bucket", REPLICATE_API_TOKEN: "tok" };

const build = (items = {}, overrides = {}) => {
  const puts = [];
  const sent = [];
  const jobs = { created: [], updated: [] };
  const deps = {
    mediaTable: "table",
    requireUserMiddleware: (req, res, next) => next(),
    getItem: async ({ sk }) => items[sk] || null,
    buildMediaPk: (u) => `USER#${u}`,
    buildStorySessionSk: (id) => `SESSION#${id}`,
    buildStorySceneSk: (id, sc) => `SCENE#${id}#${sc}`,
    dynamoClient: {
      send: async (cmd) => {
        if (cmd.input.Item) puts.push(cmd.input.Item);
        return {};
      },
    },
    PutCommand: Cmd,
    getSignedUrl: async () => "https://signed.example/v",
    s3Client: {
      send: async (cmd) => {
        sent.push(cmd.input);
        return {};
      },
    },
    GetObjectCommand: Cmd,
    PutObjectCommand: Cmd,
    replicateVideoConfig: {
      "wan-2.2-i2v-fast": {
        modelId: "owner/wan",
        buildInput: ({ imageUrl, prompt }) => ({ image: imageUrl, prompt }),
      },
    },
    replicateClient: {
      predictions: {
        create: async () => ({ id: "p1", status: "starting" }),
        get: async () => ({ id: "p1", status: "processing" }),
      },
    },
    buildReplicatePredictionRequest: (r) => r,
    getReplicateOutputUrl: (o) => (typeof o === "string" ? o : o?.[0] || ""),
    fetchImageBuffer: async () => ({ buffer: Buffer.from("v"), contentType: "video/mp4" }),
    fetchS3ImageBuffer: async () => ({ buffer: Buffer.from("img"), contentType: "image/png" }),
    buildUserPrefix: (u) => `users/${u}/`,
    jobStore: {
      createJob: async (j) => {
        jobs.created.push(j);
        return { jobId: "job-1" };
      },
      getJob: async () => ({ jobId: "job-1" }),
      updateJob: async (j) => {
        jobs.updated.push(j);
        return j;
      },
    },
    ...overrides,
  };
  const router = registerRoutes(deps);
  return {
    post: getRouterHandler(router, "post", PATH),
    get: getRouterHandler(router, "get", PATH),
    puts,
    sent,
    jobs,
  };
};

const call = async (handler, req) => {
  const res = createMockRes();
  await handler(
    {
      user: { sub: "u1" },
      params: { id: "s1", sceneId: "sc1" },
      body: {},
      query: {},
      ...req,
    },
    res
  );
  return res.output;
};

const base = (scene = {}) => ({
  "SESSION#s1": {},
  "SCENE#s1#sc1": { pk: "USER#u1", sk: "SCENE#s1#sc1", imageKey: "img.png", ...scene },
});

const quiet = (fn) => async () => {
  const orig = console.error;
  console.error = () => {};
  invalidateFlagsCache();
  try {
    await withEnv(ENV, fn);
  } finally {
    console.error = orig;
    invalidateFlagsCache();
  }
};

for (const method of ["post", "get"]) {
  test(
    `${method}: guards`,
    quiet(async () => {
      assert.equal((await call(build(base(), { mediaTable: "" })[method])).statusCode, 500);
      await withEnv({ MEDIA_BUCKET: undefined }, async () => {
        assert.equal((await call(build(base())[method])).statusCode, 500);
      });
      await withEnv({ REPLICATE_API_TOKEN: undefined }, async () => {
        assert.equal((await call(build(base())[method])).statusCode, 500);
      });
      assert.equal((await call(build(base())[method], { user: undefined })).statusCode, 401);
      assert.equal((await call(build(base())[method], { params: {} })).statusCode, 400);
      assert.equal((await call(build({})[method])).statusCode, 404);
      const noScene = { "SESSION#s1": {} };
      assert.equal((await call(build(noScene)[method])).payload.message, "Scene not found");
    })
  );
}

test(
  "post: 503 when the feature flag is off",
  quiet(async () => {
    const h = build(base(), {
      dynamoClient: {
        send: async () => ({ Item: { flags: { enableStoryAnimations: false } } }),
      },
    });
    const out = await call(h.post);
    assert.equal(out.statusCode, 503);
  })
);

test(
  "post: 500 when the video model is not configured",
  quiet(async () => {
    const out = await call(build(base(), { replicateVideoConfig: {} }).post);
    assert.equal(out.statusCode, 500);
    assert.match(out.payload.message, /not configured/);
  })
);

test(
  "post: requires an illustration first",
  quiet(async () => {
    const out = await call(build(base({ imageKey: "" })).post);
    assert.equal(out.statusCode, 400);
  })
);

test(
  "post: starts animation and records the job",
  quiet(async () => {
    const h = build(base());
    const out = await call(h.post, { body: { prompt: "pan left" } });
    assert.equal(out.statusCode, 200);
    assert.equal(out.payload.status, "starting");
    assert.equal(out.payload.prompt, "pan left");
    assert.equal(out.payload.jobId, "job-1");
    assert.equal(h.puts[0].videoStatus, "starting");
    assert.equal(h.jobs.created[0].kind, "animation");
  })
);

test(
  "post: no prediction returned",
  quiet(async () => {
    const h = build(base(), { replicateClient: { predictions: { create: async () => null } } });
    assert.equal((await call(h.post)).statusCode, 500);
  })
);

test(
  "post: succeeded prediction is stored to S3",
  quiet(async () => {
    const h = build(base(), {
      replicateClient: {
        predictions: { create: async () => ({ id: "p2", status: "succeeded", output: "v.mp4" }) },
      },
    });
    const out = await call(h.post);
    assert.equal(out.payload.status, "succeeded");
    assert.ok(out.payload.videoKey);
    assert.equal(out.payload.videoUrl, "https://signed.example/v");
    assert.equal(h.sent[0].ContentType, "video/mp4");
    assert.equal(h.jobs.updated[0].status, "succeeded");
  })
);

test(
  "post: provider failure becomes 500",
  quiet(async () => {
    const h = build(base(), {
      fetchS3ImageBuffer: async () => {
        throw new Error("no image");
      },
    });
    const out = await call(h.post);
    assert.equal(out.statusCode, 500);
    assert.equal(out.payload.error, "no image");
  })
);

test(
  "get: no prediction returns stored state",
  quiet(async () => {
    const out = await call(build(base({ videoStatus: "succeeded", videoKey: "v.mp4" })).get);
    assert.equal(out.payload.status, "succeeded");
    assert.equal(out.payload.predictionId, "");
  })
);

test(
  "get: in-progress prediction updates scene",
  quiet(async () => {
    const h = build(base({ videoPredictionId: "p1" }));
    const out = await call(h.get);
    assert.equal(out.payload.status, "processing");
    assert.equal(out.payload.videoUrl, "");
    assert.equal(h.puts[0].videoStatus, "processing");
  })
);

test(
  "get: failed prediction marks the job failed",
  quiet(async () => {
    const h = build(base(), {
      replicateClient: { predictions: { get: async () => ({ id: "p9", status: "failed" }) } },
    });
    await call(h.get, { query: { predictionId: "p9" } });
    assert.equal(h.jobs.updated[0].error, "animation_failed");
  })
);

test(
  "get: missing prediction is 500",
  quiet(async () => {
    const h = build(base({ videoPredictionId: "p1" }), {
      replicateClient: { predictions: { get: async () => null } },
    });
    assert.equal((await call(h.get)).payload.message, "Prediction not found");
  })
);

test(
  "get: succeeded prediction persists video",
  quiet(async () => {
    const h = build(base({ videoPredictionId: "p1", videoPrompt: "zoom" }), {
      replicateClient: {
        predictions: { get: async () => ({ id: "p1", status: "succeeded", output: ["v.mp4"] }) },
      },
    });
    const out = await call(h.get);
    assert.equal(out.payload.status, "succeeded");
    assert.equal(out.payload.prompt, "zoom");
    assert.ok(out.payload.videoKey);
  })
);

test(
  "get: succeeded with no output is 500",
  quiet(async () => {
    const h = build(base({ videoPredictionId: "p1" }), {
      replicateClient: { predictions: { get: async () => ({ id: "p1", status: "succeeded" }) } },
    });
    const out = await call(h.get);
    assert.equal(out.statusCode, 500);
    assert.match(out.payload.error, /No video returned/);
  })
);
