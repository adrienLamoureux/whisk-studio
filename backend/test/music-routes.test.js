"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { getRouterHandler, createMockRes, withEnv } = require("./helpers/test-utils");
const registerRoutes = require("../routes/story/music-routes");

function PutCommand(input) {
  this.input = input;
}
function Cmd(input) {
  this.input = input;
}

const PATH = "/sessions/:id/scenes/:sceneId/music";
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
    queryBySkPrefix: async () => [{ role: "assistant", content: "hello there" }],
    storyMessagePrefix: (id) => `MSG#${id}#`,
    normalizePromptFragment: (v) => String(v || "").trim(),
    dynamoClient: {
      send: async (cmd) => {
        puts.push(cmd.input.Item);
        return {};
      },
    },
    PutCommand,
    getSignedUrl: async () => "https://signed.example/x",
    s3Client: {
      send: async (cmd) => {
        sent.push(cmd.input);
        return {};
      },
    },
    GetObjectCommand: Cmd,
    PutObjectCommand: Cmd,
    HeadObjectCommand: Cmd,
    buildUserPrefix: (u) => `users/${u}/`,
    replicateClient: {
      predictions: {
        create: async () => ({ id: "p1", status: "starting" }),
        get: async () => ({ id: "p1", status: "processing" }),
      },
    },
    buildReplicatePredictionRequest: (r) => r,
    aiCraftMusicDirection: async () => ({
      prompt: "calm piano",
      mood: "calm",
      energy: "low",
      tempoBpm: 80.4,
      tags: ["piano"],
    }),
    getReplicateOutputUrl: (o) => (typeof o === "string" ? o : o?.[0] || ""),
    fetchImageBuffer: async () => ({ buffer: Buffer.from("x"), contentType: "audio/mpeg" }),
    jobStore: {
      createJob: async (j) => {
        jobs.created.push(j);
        return { jobId: "job-1", ...j };
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
  "SESSION#s1": { summary: "story" },
  "SCENE#s1#sc1": { pk: "USER#u1", sk: "SCENE#s1#sc1", title: "Cave", ...scene },
});

const quiet = (fn) => async () => {
  const orig = console.error;
  console.error = () => {};
  try {
    await withEnv(ENV, fn);
  } finally {
    console.error = orig;
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
  "post: starts generation and stores in-flight state",
  quiet(async () => {
    const h = build(base());
    const out = await call(h.post, { body: { prompt: "  rainy  " } });
    assert.equal(out.statusCode, 200);
    assert.equal(out.payload.status, "starting");
    assert.equal(out.payload.jobId, "job-1");
    assert.equal(out.payload.direction.mood, "calm");
    assert.equal(h.puts.length, 1);
    assert.equal(h.puts[0].musicPredictionId, "p1");
    assert.equal(h.puts[0].musicTempoBpm, 80);
    assert.deepEqual(h.puts[0].musicTags, ["piano"]);
    assert.equal(h.jobs.created[0].kind, "music");
  })
);

test(
  "post: falls back when direction is empty",
  quiet(async () => {
    const h = build(base({ musicTags: ["old"], musicTempoBpm: 70 }), {
      aiCraftMusicDirection: async () => null,
    });
    const out = await call(h.post);
    assert.equal(out.statusCode, 200);
    assert.deepEqual(h.puts[0].musicTags, ["old"]);
    assert.equal(h.puts[0].musicTempoBpm, 70);
  })
);

test(
  "post: no prediction returned",
  quiet(async () => {
    const h = build(base(), {
      replicateClient: { predictions: { create: async () => null } },
    });
    assert.equal((await call(h.post)).payload.message, "No prediction returned from Replicate");
  })
);

test(
  "post: succeeded prediction is persisted to the library",
  quiet(async () => {
    const h = build(base(), {
      replicateClient: {
        predictions: {
          create: async () => ({ id: "p2", status: "succeeded", output: "https://x/a.mp3" }),
        },
      },
    });
    const out = await call(h.post);
    assert.equal(out.statusCode, 200);
    assert.equal(out.payload.status, "succeeded");
    assert.ok(out.payload.musicKey.startsWith("users/u1/"));
    assert.ok(out.payload.track);
    assert.equal(h.jobs.updated[0].status, "succeeded");
    assert.equal(h.sent.length, 2); // put + head
  })
);

test(
  "post: provider error becomes 500",
  quiet(async () => {
    const h = build(base(), {
      aiCraftMusicDirection: async () => {
        throw new Error("bedrock");
      },
    });
    const out = await call(h.post);
    assert.equal(out.statusCode, 500);
    assert.equal(out.payload.error, "bedrock");
  })
);

test(
  "get: no prediction returns stored scene state",
  quiet(async () => {
    const out = await call(build(base({ musicStatus: "succeeded", musicKey: "k.mp3" })).get);
    assert.equal(out.statusCode, 200);
    assert.equal(out.payload.status, "succeeded");
    assert.equal(out.payload.predictionId, "");
  })
);

test(
  "get: in-progress prediction updates the scene",
  quiet(async () => {
    const h = build(base({ musicPredictionId: "p1" }));
    const out = await call(h.get);
    assert.equal(out.payload.status, "processing");
    assert.equal(out.payload.predictionId, "p1");
    assert.equal(h.puts[0].musicStatus, "processing");
    assert.equal(h.jobs.updated[0].status, "processing");
  })
);

test(
  "get: failed prediction marks the job failed",
  quiet(async () => {
    const h = build(base(), {
      replicateClient: { predictions: { get: async () => ({ id: "p9", status: "failed" }) } },
    });
    const out = await call(h.get, { query: { predictionId: "p9" } });
    assert.equal(out.payload.status, "failed");
    assert.equal(h.jobs.updated[0].error, "music_failed");
  })
);

test(
  "get: missing prediction is 500",
  quiet(async () => {
    const h = build(base({ musicPredictionId: "p1" }), {
      replicateClient: { predictions: { get: async () => null } },
    });
    assert.equal((await call(h.get)).payload.message, "Prediction not found");
  })
);

test(
  "get: succeeded prediction persists the track",
  quiet(async () => {
    const h = build(base({ musicPredictionId: "p1", musicPrompt: "loop" }), {
      replicateClient: {
        predictions: { get: async () => ({ id: "p1", status: "succeeded", output: ["u.mp3"] }) },
      },
    });
    const out = await call(h.get);
    assert.equal(out.statusCode, 200);
    assert.equal(out.payload.status, "succeeded");
    assert.ok(out.payload.musicKey);
    assert.ok(out.payload.track.trackId);
  })
);

test(
  "get: succeeded prediction with no output is 500",
  quiet(async () => {
    const h = build(base({ musicPredictionId: "p1" }), {
      replicateClient: { predictions: { get: async () => ({ id: "p1", status: "succeeded" }) } },
    });
    const out = await call(h.get);
    assert.equal(out.statusCode, 500);
    assert.match(out.payload.error, /No music returned/);
  })
);
