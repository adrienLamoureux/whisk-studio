"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { SPEND_RESOLVERS, spendGuardFor } = require("../lib/spend-resolvers");
const middleware = require("../lib/spend-middleware");
const { estimateUsd } = require("../config/pricing");
const { MAX_BILLABLE_IMAGES_PER_REQUEST: MAX } = require("../config/spend-limits");

test("every resolver prices above zero, even with no body or an unknown model", () => {
  assert.equal(Object.keys(SPEND_RESOLVERS).length, 10);
  for (const [name, resolve] of Object.entries(SPEND_RESOLVERS)) {
    for (const req of [{ body: {} }, {}, { body: { model: "no-such-model" } }]) {
      assert.ok(estimateUsd(resolve(req)) > 0, `${name} ${JSON.stringify(req)}`);
    }
  }
});

test("an unknown model key charges the provider fallback", () => {
  const resolved = SPEND_RESOLVERS.replicateImage({ body: { model: "no-such-model" } });
  assert.equal(estimateUsd(resolved), 0.05);
});

test("model keys, defaults and fixed prices", () => {
  const veo = SPEND_RESOLVERS.replicateVideo({ body: { model: "veo-3.1-fast" } });
  assert.equal(estimateUsd(veo), 1.2);
  assert.equal(estimateUsd(SPEND_RESOLVERS.novaReel({})), 0.48);
  assert.equal(SPEND_RESOLVERS.bedrockImage({ body: {} }).priceKey, "titan");
  assert.equal(SPEND_RESOLVERS.gradioImage({ body: {} }).priceKey, "wainsfw");
  assert.equal(SPEND_RESOLVERS.storyIllustration({}).priceKey, "wai-nsfw-illustrious-v11");
  assert.equal(SPEND_RESOLVERS.storyAnimation({}).priceKey, "wan-2.2-i2v-fast");
  assert.equal(SPEND_RESOLVERS.bedrockLlmCall({}).provider, "bedrock-llm");
});

test("image counts follow the route clamps", () => {
  const count = (name, numImages, extra) =>
    SPEND_RESOLVERS[name]({ body: { numImages, ...extra } }).count;
  assert.equal(count("replicateImage", 99), MAX.replicate);
  assert.equal(count("civitaiImage", 99), MAX.civitai);
  assert.equal(count("bedrockImage", 99), MAX.bedrock);
  assert.equal(count("bedrockImage", -3), 1);
  assert.equal(count("civitaiImage", "abc"), 1);
  assert.equal(count("replicateImage", 1, { scheduler: "diff" }), MAX.replicate);
});

test("array-valued model on video is priced as the route runs it (veo, not the wan default)", () => {
  // The route reads String(["veo-3.1-fast"] || "").trim() === "veo-3.1-fast".
  const resolved = SPEND_RESOLVERS.replicateVideo({ body: { model: ["veo-3.1-fast"] } });
  assert.equal(resolved.priceKey, "veo-3.1-fast");
  assert.equal(estimateUsd(resolved), 1.2);
});

test("array-valued model and scheduler on image are priced as the route reads them", () => {
  const resolved = SPEND_RESOLVERS.replicateImage({
    body: { model: ["seedream-4.5"], scheduler: ["diff"] },
  });
  assert.equal(resolved.priceKey, "seedream-4.5");
  assert.equal(resolved.count, MAX.replicate);
  assert.equal(estimateUsd(resolved), 0.1);
});

test("model coercion matches each route for non-string values", () => {
  assert.equal(
    SPEND_RESOLVERS.civitaiImage({ body: { model: [" civitai-pony-sdxl "] } }).priceKey,
    "civitai-pony-sdxl"
  );
  assert.equal(SPEND_RESOLVERS.bedrockImage({ body: { model: ["titan"] } }).priceKey, "titan");
  assert.equal(
    SPEND_RESOLVERS.gradioImage({ body: { model: ["animagine-xl-3.1"] } }).priceKey,
    "animagine-xl-3.1"
  );
  assert.equal(SPEND_RESOLVERS.replicateVideo({ body: { model: 0 } }).priceKey, "wan-2.2-i2v-fast");
  assert.equal(SPEND_RESOLVERS.replicateImage({ body: { numImages: ["2"] } }).count, 2);
});

test("spendGuardFor returns a middleware and throws on an unknown name", () => {
  assert.equal(typeof spendGuardFor({}, "bedrockLlmCall"), "function");
  assert.equal(typeof middleware.spendGuardFor({}, "storyMusic"), "function");
  assert.throws(() => spendGuardFor({}, "nope"), /Unknown spend resolver/);
});
