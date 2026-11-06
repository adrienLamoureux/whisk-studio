"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { getRouterHandler, createMockRes, withEnv } = require("./helpers/test-utils");
const registerRoutes = require("../routes/story/music-selection-routes");

function PutCommand(input) {
  this.input = input;
}
function GetObjectCommand(input) {
  this.input = input;
}

const FAV = "/sessions/:id/scenes/:sceneId/music/favorite";
const REC = "/sessions/:id/scenes/:sceneId/music/recommend";
const SEL = "/sessions/:id/scenes/:sceneId/music/select";

const build = (items = {}, overrides = {}) => {
  const puts = [];
  const copies = [];
  const deps = {
    mediaTable: "table",
    requireUserMiddleware: (req, res, next) => next(),
    getItem: async ({ sk }) => items[sk] || null,
    buildMediaPk: (u) => `USER#${u}`,
    buildStorySessionSk: (id) => `SESSION#${id}`,
    buildStorySceneSk: (id, sc) => `SCENE#${id}#${sc}`,
    queryBySkPrefix: async () => items.__tracks || [],
    normalizePromptFragment: (v) => String(v || "").trim(),
    dynamoClient: {
      send: async (cmd) => {
        puts.push(cmd.input.Item);
        return {};
      },
    },
    PutCommand,
    getSignedUrl: async () => "https://signed.example/x",
    s3Client: {},
    GetObjectCommand,
    buildUserPrefix: (u) => `users/${u}/`,
    copyS3Object: async (arg) => copies.push(arg),
    ...overrides,
  };
  const router = registerRoutes(deps);
  return { get: (p) => getRouterHandler(router, "post", p), puts, copies };
};

const call = async (handler, req) => {
  const res = createMockRes();
  await handler(
    { user: { sub: "u1" }, params: { id: "s1", sceneId: "sc1" }, body: {}, ...req },
    res
  );
  return res.output;
};

const base = () => ({
  "SESSION#s1": { sk: "SESSION#s1", summary: "a forest" },
  "SCENE#s1#sc1": {
    pk: "USER#u1",
    sk: "SCENE#s1#sc1",
    title: "Forest",
    description: "Dark woods",
    musicKey: "users/u1/music/a.mp3",
    musicMood: "tense",
  },
});

const quiet = (fn) => async () => {
  const orig = console.error;
  console.error = () => {};
  try {
    await withEnv({ MEDIA_BUCKET: "bucket" }, fn);
  } finally {
    console.error = orig;
  }
};

for (const [name, path] of [
  ["favorite", FAV],
  ["select", SEL],
]) {
  test(
    `${name}: validation and not-found paths`,
    quiet(async () => {
      const body = { trackId: "t1" };
      assert.equal(
        (await call(build(base(), { mediaTable: "" }).get(path), { body })).statusCode,
        500
      );
      await withEnv({ MEDIA_BUCKET: undefined }, async () => {
        assert.equal((await call(build(base()).get(path), { body })).statusCode, 500);
      });
      assert.equal(
        (await call(build(base()).get(path), { body, user: undefined })).statusCode,
        401
      );
      assert.equal(
        (await call(build(base()).get(path), { body, params: { id: "s1" } })).statusCode,
        400
      );
      assert.equal((await call(build({}).get(path), { body })).statusCode, 404);
      const noScene = { "SESSION#s1": base()["SESSION#s1"] };
      const out = await call(build(noScene).get(path), { body });
      assert.equal(out.payload.message, "Scene not found");
    })
  );
}

test(
  "favorite: rejects scene without music",
  quiet(async () => {
    const items = base();
    delete items["SCENE#s1#sc1"].musicKey;
    const out = await call(build(items).get(FAV));
    assert.equal(out.statusCode, 400);
  })
);

test(
  "favorite: copies audio and saves a new library track",
  quiet(async () => {
    const h = build(base());
    const out = await call(h.get(FAV), { body: { title: "My Tune" } });
    assert.equal(out.statusCode, 200);
    assert.equal(out.payload.track.title, "My Tune");
    assert.equal(h.copies.length, 1);
    assert.equal(h.copies[0].sourceKey, "users/u1/music/a.mp3");
    assert.equal(h.puts.length, 2);
    assert.equal(h.puts[0].type, "STORY_MUSIC_LIBRARY_TRACK");
    assert.equal(h.puts[1].musicLibraryTrackId, out.payload.musicLibraryTrackId);
  })
);

test(
  "favorite: default title when none supplied",
  quiet(async () => {
    const h = build(base());
    const out = await call(h.get(FAV));
    assert.equal(out.payload.track.title, "Forest soundtrack");
  })
);

test(
  "favorite: reuses existing library track",
  quiet(async () => {
    const items = base();
    items["SCENE#s1#sc1"].musicLibraryTrackId = "t9";
    const sk = require("../routes/story/music-helpers").buildStoryMusicLibrarySk("t9");
    items[sk] = { trackId: "t9", key: "lib/t9.mp3", title: "Old" };
    const h = build(items);
    const out = await call(h.get(FAV));
    assert.equal(out.statusCode, 200);
    assert.equal(out.payload.musicLibraryTrackId, "t9");
    assert.equal(h.copies.length, 0);
    // legacy track lacked searchText/source, so it is normalised and re-saved
    assert.equal(h.puts.length, 1);
  })
);

test(
  "favorite: 500 when copy fails",
  quiet(async () => {
    const h = build(base(), {
      copyS3Object: async () => {
        throw new Error("s3 down");
      },
    });
    const out = await call(h.get(FAV));
    assert.equal(out.statusCode, 500);
    assert.equal(out.payload.error, "s3 down");
  })
);

test(
  "recommend: validation and not-found",
  quiet(async () => {
    assert.equal((await call(build(base(), { mediaTable: "" }).get(REC))).statusCode, 500);
    assert.equal((await call(build(base()).get(REC), { user: undefined })).statusCode, 401);
    assert.equal((await call(build(base()).get(REC), { params: {} })).statusCode, 400);
    assert.equal((await call(build({}).get(REC))).statusCode, 404);
    const noScene = { "SESSION#s1": base()["SESSION#s1"] };
    assert.equal((await call(build(noScene).get(REC))).payload.message, "Scene not found");
  })
);

test(
  "recommend: ranks library tracks and persists the choice",
  quiet(async () => {
    const items = base();
    items.__tracks = [
      {
        trackId: "t1",
        title: "Dark woods theme",
        mood: "tense",
        energy: "low",
        tags: ["forest", "dark"],
        searchText: "dark woods theme tense forest",
      },
      { trackId: "t2", title: "Beach party", mood: "happy", tags: ["sun"], searchText: "beach" },
    ];
    const h = build(items);
    const out = await call(h.get(REC));
    assert.equal(out.statusCode, 200);
    assert.equal(out.payload.sceneId, "sc1");
    assert.ok(Array.isArray(out.payload.candidates));
    assert.equal(h.puts.length, 1);
    // second call with an unchanged scene skips the write
    const again = build({ ...items, "SCENE#s1#sc1": h.puts[0] });
    const out2 = await call(again.get(REC));
    assert.equal(out2.payload.recommendedTrackId, out.payload.recommendedTrackId);
    assert.equal(again.puts.length, 0);
  })
);

test(
  "recommend: empty library yields no candidates",
  quiet(async () => {
    const out = await call(build(base()).get(REC));
    assert.equal(out.payload.recommendedTrackId, "");
    assert.deepEqual(out.payload.candidates, []);
  })
);

test(
  "recommend: 500 on lookup failure",
  quiet(async () => {
    const h = build(base(), {
      queryBySkPrefix: async () => {
        throw new Error("ddb");
      },
    });
    assert.equal((await call(h.get(REC))).statusCode, 500);
  })
);

test(
  "select: requires trackId and an existing track",
  quiet(async () => {
    assert.equal((await call(build(base()).get(SEL))).payload.message, "trackId is required");
    const out = await call(build(base()).get(SEL), { body: { trackId: "nope" } });
    assert.equal(out.payload.message, "Track not found");
  })
);

test(
  "select: applies library track to scene",
  quiet(async () => {
    const items = base();
    const sk = require("../routes/story/music-helpers").buildStoryMusicLibrarySk("t1");
    items[sk] = {
      trackId: "t1",
      key: "lib/t1.mp3",
      mood: "calm",
      energy: "low",
      tags: ["a"],
      tempoBpm: 90,
      prompt: "calm loop",
    };
    const h = build(items);
    const out = await call(h.get(SEL), { body: { trackId: "t1" } });
    assert.equal(out.statusCode, 200);
    assert.equal(h.puts[0].musicKey, "lib/t1.mp3");
    assert.equal(h.puts[0].musicStatus, "succeeded");
    assert.equal(out.payload.track.trackId, "t1");
  })
);

test(
  "select: 500 when persistence fails",
  quiet(async () => {
    const items = base();
    const sk = require("../routes/story/music-helpers").buildStoryMusicLibrarySk("t1");
    items[sk] = { trackId: "t1", key: "lib/t1.mp3" };
    const h = build(items, {
      dynamoClient: {
        send: async () => {
          throw new Error("write failed");
        },
      },
    });
    assert.equal((await call(h.get(SEL), { body: { trackId: "t1" } })).statusCode, 500);
  })
);
