"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  imageModelConfig,
  replicateModelConfig,
  replicateVideoConfig,
  civitaiModelConfig,
  gradioSpaceConfig,
  bedrockVideoConfig,
} = require("../config/models");
const {
  PRICE_UNIT,
  MICRO_USD_PER_USD,
  LLM_TOKEN_PRICES,
  LLM_CALL_ESTIMATE_TOKENS,
  MODEL_PRICES,
  PRICE_KEY_ALIASES,
  PROVIDER_FALLBACK_PRICES,
  clipSecondsFor,
  estimateUsd,
  toMicroUsd,
  listRates,
} = require("../config/pricing");
const {
  SPEND_FAIL_MODE,
  SPEND_LIMIT_DEFAULTS,
  SPEND_LIMIT_ENV,
  MAX_BILLABLE_IMAGES_PER_REQUEST,
  loadSpendLimits,
} = require("../config/spend-limits");

const PROVIDER_OF_CONFIG = [
  [imageModelConfig, "bedrock"],
  [replicateModelConfig, "replicate"],
  [replicateVideoConfig, "replicate-video"],
  [civitaiModelConfig, "civitai"],
  [gradioSpaceConfig, "gradio"],
  [bedrockVideoConfig, "bedrock-video"],
];

test("every model config key has a price", () => {
  for (const [config] of PROVIDER_OF_CONFIG) {
    for (const key of Object.keys(config)) {
      const priceKey = PRICE_KEY_ALIASES[key] || key;
      assert.ok(MODEL_PRICES[priceKey], `no price for ${key}`);
      assert.ok(estimateUsd({ priceKey: key }) > 0, `${key} prices at zero`);
    }
  }
});

test("every price entry carries a source, and placeholders say so", () => {
  const entries = [...Object.entries(MODEL_PRICES), ...Object.entries(PROVIDER_FALLBACK_PRICES)];
  for (const [key, price] of entries) {
    assert.ok(price.source.length > 0, `${key} has no source`);
    assert.equal(typeof price.placeholder, "boolean", key);
    assert.equal(
      price.source.includes("placeholder, not public"),
      price.placeholder,
      `${key} placeholder flag and source disagree`
    );
  }
});

test("per-second video prices use the clip length from models.js", () => {
  assert.equal(clipSecondsFor("nova-reel"), 6);
  assert.equal(clipSecondsFor("veo-3.1-fast"), 8);
  assert.equal(clipSecondsFor("kling-v2.6"), 5);
  assert.equal(clipSecondsFor("seedance-1.5-pro"), 5);
  assert.equal(clipSecondsFor("animagine"), null);
  assert.equal(clipSecondsFor("nope"), null);
  for (const [key, price] of Object.entries(MODEL_PRICES)) {
    if (price.unit === PRICE_UNIT.PER_SECOND) {
      assert.ok(clipSecondsFor(key) > 0, `${key} has no clip seconds`);
    }
  }
});

test("buildInput durations match durationSeconds", () => {
  const input = { imageUrl: "u", prompt: "p" };
  assert.equal(replicateVideoConfig["veo-3.1-fast"].buildInput(input).duration, 8);
  assert.equal(replicateVideoConfig["kling-v2.6"].buildInput(input).duration, 5);
  assert.equal(replicateVideoConfig["seedance-1.5-pro"].buildInput(input).duration, 5);
  const wan = replicateVideoConfig["wan-2.2-i2v-fast"];
  const wanInput = wan.buildInput(input);
  assert.equal(wanInput.num_frames / wanInput.frames_per_second, wan.durationSeconds);
});

test("nova-reel costs 0.48 and veo-3.1-fast costs 1.2", () => {
  assert.equal(estimateUsd({ priceKey: "nova-reel" }), 0.48);
  assert.equal(estimateUsd({ priceKey: "veo-3.1-fast" }), 1.2);
  assert.equal(estimateUsd({ priceKey: "veo-3.1-fast", count: 2 }), 2.4);
});

test("estimateUsd resolves aliases, then provider fallbacks, then zero", () => {
  assert.equal(estimateUsd({ priceKey: "titan-image" }), MODEL_PRICES.titan.usd);
  assert.equal(estimateUsd({ priceKey: "animagine", count: 2 }), 0.0138);
  assert.equal(
    estimateUsd({ priceKey: "mystery", provider: "replicate" }),
    PROVIDER_FALLBACK_PRICES.replicate.usd
  );
  assert.equal(estimateUsd({ priceKey: undefined, provider: "civitai", count: 3 }), 0.03);
  assert.equal(estimateUsd({ priceKey: "mystery", provider: "mystery" }), 0);
  assert.equal(estimateUsd({ priceKey: "constructor", provider: "toString" }), 0);
});

test("bedrock-llm-call is computed from the token prices", () => {
  const expected =
    (LLM_CALL_ESTIMATE_TOKENS.input * LLM_TOKEN_PRICES.inputUsdPerMTok +
      LLM_CALL_ESTIMATE_TOKENS.output * LLM_TOKEN_PRICES.outputUsdPerMTok) /
    MICRO_USD_PER_USD;
  assert.equal(estimateUsd({ priceKey: "bedrock-llm-call" }), expected);
  assert.equal(expected, 0.005);
});

test("provider fallbacks are at least the dearest model of that provider", () => {
  const providerOfModel = {};
  for (const [config, provider] of PROVIDER_OF_CONFIG) {
    for (const key of Object.keys(config))
      providerOfModel[PRICE_KEY_ALIASES[key] || key] = provider;
  }
  providerOfModel["story-music"] = "replicate";
  providerOfModel["bedrock-llm-call"] = "bedrock-llm";

  const dearest = {};
  for (const key of Object.keys(MODEL_PRICES)) {
    const provider = providerOfModel[key];
    assert.ok(provider, `${key} is not mapped to a provider in this test`);
    dearest[provider] = Math.max(dearest[provider] || 0, estimateUsd({ priceKey: key }));
  }
  for (const [provider, max] of Object.entries(dearest)) {
    assert.ok(PROVIDER_FALLBACK_PRICES[provider], `no fallback for ${provider}`);
    assert.ok(
      PROVIDER_FALLBACK_PRICES[provider].usd >= max,
      `${provider} fallback ${PROVIDER_FALLBACK_PRICES[provider].usd} < dearest model ${max}`
    );
  }
});

test("toMicroUsd rounds up to a whole integer", () => {
  assert.equal(toMicroUsd(0), 0);
  assert.equal(toMicroUsd(-1), 0);
  assert.equal(toMicroUsd(Number.NaN), 0);
  assert.equal(toMicroUsd(0.0000011), 2);
  assert.equal(toMicroUsd(0.0000001), 1);
  assert.equal(toMicroUsd(0.48), 480_000);
  assert.equal(toMicroUsd(1.2), 1_200_000);
  assert.ok(Number.isInteger(toMicroUsd(0.0069)));
});

test("listRates returns the llm rates and one row per priced model", () => {
  const rates = listRates();
  assert.equal(rates.llm.inputUsdPerMTok, LLM_TOKEN_PRICES.inputUsdPerMTok);
  assert.equal(rates.llm.outputUsdPerMTok, LLM_TOKEN_PRICES.outputUsdPerMTok);
  assert.equal(rates.llm.placeholder, true);
  assert.equal(rates.models.length, Object.keys(MODEL_PRICES).length);
  const veo = rates.models.find((row) => row.key === "veo-3.1-fast");
  assert.deepEqual(
    { unit: veo.unit, usd: veo.usd, clipSeconds: veo.clipSeconds, usdPerOutput: veo.usdPerOutput },
    { unit: "per_second", usd: 0.15, clipSeconds: 8, usdPerOutput: 1.2 }
  );
  assert.ok(rates.models.some((row) => row.key === "nova-reel"));
  assert.equal(rates.models.find((row) => row.key === "animagine").clipSeconds, null);
});

test("loadSpendLimits returns the defaults for an empty env", () => {
  assert.deepEqual(loadSpendLimits({}), { ...SPEND_LIMIT_DEFAULTS });
  assert.equal(SPEND_LIMIT_DEFAULTS.failMode, SPEND_FAIL_MODE.CLOSED);
});

test("loadSpendLimits reads valid env values", () => {
  const limits = loadSpendLimits({
    [SPEND_LIMIT_ENV.userDailyBudgetUsd]: "5.5",
    [SPEND_LIMIT_ENV.anonDailyBudgetUsd]: "0",
    [SPEND_LIMIT_ENV.failMode]: "OPEN",
    [SPEND_LIMIT_ENV.unavailableRetryAfterSeconds]: "30",
    [SPEND_LIMIT_ENV.tokenDailyCap]: "1000",
    [SPEND_LIMIT_ENV.imageDailyCap]: "7",
  });
  assert.deepEqual(limits, {
    userDailyBudgetUsd: 5.5,
    anonDailyBudgetUsd: 0,
    failMode: SPEND_FAIL_MODE.OPEN,
    unavailableRetryAfterSeconds: 30,
    tokenDailyCap: 1000,
    imageDailyCap: 7,
  });
});

test("loadSpendLimits rejects bad env and keeps the defaults", () => {
  const bad = {
    [SPEND_LIMIT_ENV.userDailyBudgetUsd]: "abc",
    [SPEND_LIMIT_ENV.anonDailyBudgetUsd]: "-2",
    [SPEND_LIMIT_ENV.failMode]: "maybe",
    [SPEND_LIMIT_ENV.unavailableRetryAfterSeconds]: "Infinity",
    [SPEND_LIMIT_ENV.tokenDailyCap]: "",
    [SPEND_LIMIT_ENV.imageDailyCap]: "NaN",
  };
  assert.deepEqual(loadSpendLimits(bad), { ...SPEND_LIMIT_DEFAULTS });
});

test("MAX_BILLABLE_IMAGES_PER_REQUEST mirrors the route clamps", () => {
  assert.deepEqual(
    { ...MAX_BILLABLE_IMAGES_PER_REQUEST },
    { replicate: 2, civitai: 4, bedrock: 2 }
  );
});
