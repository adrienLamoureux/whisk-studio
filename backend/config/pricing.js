"use strict";

/**
 * pricing.js - the single price table.
 *
 * The daily dollar budget (lib/spend-budget.js), the usage dashboard
 * (routes/ops/usage-helpers.js) and the Sanctum cost view all price through
 * this file. An entry with `placeholder: true` is not a published price: it is
 * set high on purpose so the budget errs on the safe side. Replace those from
 * a real bill.
 */

const { replicateVideoConfig, bedrockVideoConfig } = require("./models");

const PRICE_UNIT = Object.freeze({ PER_OUTPUT: "per_output", PER_SECOND: "per_second" });
const MICRO_USD_PER_USD = 1_000_000;

const PLACEHOLDER_NOTE = "placeholder, not public";

const LLM_TOKEN_PRICES = Object.freeze({
  inputUsdPerMTok: 1,
  outputUsdPerMTok: 5,
  placeholder: true,
  source: "Anthropic API list, Claude Haiku 4.5; Bedrock rate unconfirmed",
});

// A typical public LLM call (companion chat, prompt helper).
const LLM_CALL_ESTIMATE_TOKENS = Object.freeze({ input: 3000, output: 400 });

const BEDROCK_LLM_CALL_USD =
  (LLM_CALL_ESTIMATE_TOKENS.input * LLM_TOKEN_PRICES.inputUsdPerMTok +
    LLM_CALL_ESTIMATE_TOKENS.output * LLM_TOKEN_PRICES.outputUsdPerMTok) /
  MICRO_USD_PER_USD;

const entry = (unit, usd, placeholder, source) =>
  Object.freeze({
    unit,
    usd,
    placeholder,
    source: placeholder ? `${PLACEHOLDER_NOTE}; ${source}` : source,
  });
const perOutput = (usd, placeholder, source) =>
  entry(PRICE_UNIT.PER_OUTPUT, usd, placeholder, source);
const perSecond = (usd, placeholder, source) =>
  entry(PRICE_UNIT.PER_SECOND, usd, placeholder, source);

const MODEL_PRICES = Object.freeze({
  animagine: perOutput(0.0069, false, "Replicate model page"),
  "wai-nsfw-illustrious-v11": perOutput(0.0079, false, "Replicate model page"),
  "wai-nsfw-illustrious-v12": perOutput(0.0083, false, "Replicate model page"),
  "anillustrious-v4": perOutput(0.013, false, "Replicate model page"),
  "seedream-4.5": perOutput(0.05, true, "listings say about 0.04"),
  titan: perOutput(0.012, false, "AWS price list, top of range"),
  "civitai-sd15-anime": perOutput(0.01, true, "CivitAI orchestration, no list price"),
  "civitai-pony-sdxl": perOutput(0.01, true, "CivitAI orchestration, no list price"),
  wainsfw: perOutput(0.002, true, "Hugging Face Space, free tier or ZeroGPU"),
  "animagine-xl-3.1": perOutput(0.002, true, "Hugging Face Space, free tier or ZeroGPU"),
  "wan-2.2-i2v-fast": perOutput(0.1, true, "0.05 at launch"),
  "veo-3.1-fast": perSecond(0.15, true, "Google lists 0.10 per second"),
  "kling-v2.6": perSecond(0.16, true, "kling-v4.0 lists 0.157 per second"),
  "seedance-1.5-pro": perSecond(0.1, true, "model page returns 404"),
  "nova-reel": perSecond(0.08, false, "AWS price list"),
  "story-music": perOutput(0.05, true, "meta/musicgen, billed on GPU time"),
  "bedrock-llm-call": perOutput(
    BEDROCK_LLM_CALL_USD,
    true,
    "LLM_TOKEN_PRICES x LLM_CALL_ESTIMATE_TOKENS"
  ),
});

// Names the job records use for a model that the table keys differently.
const PRICE_KEY_ALIASES = Object.freeze({ "titan-image": "titan" });

// Used when the model key is unknown. Each must be >= the dearest model of that
// provider (pricing.test.js enforces it). Per-clip providers price one clip.
const PROVIDER_FALLBACK_PRICES = Object.freeze({
  replicate: perOutput(0.05, true, "dearest Replicate image or music model"),
  "replicate-video": perOutput(1.2, true, "dearest Replicate clip (veo-3.1-fast, 8 s)"),
  bedrock: perOutput(0.012, false, "AWS price list, top of range"),
  "bedrock-video": perOutput(0.48, true, "nova-reel clip, 6 s"),
  civitai: perOutput(0.01, true, "CivitAI orchestration, no list price"),
  gradio: perOutput(0.002, true, "Hugging Face Space, free tier or ZeroGPU"),
  huggingface: perOutput(0.002, true, "Hugging Face Space, free tier or ZeroGPU"),
  "bedrock-llm": perOutput(BEDROCK_LLM_CALL_USD, true, "one typical public LLM call"),
});

const has = (table, key) => typeof key === "string" && Object.hasOwn(table, key);

/**
 * Clip length in seconds for a per-second model, from config/models.js.
 *
 * @param {string} priceKey
 * @returns {number|null}
 */
function clipSecondsFor(priceKey) {
  const key = has(PRICE_KEY_ALIASES, priceKey) ? PRICE_KEY_ALIASES[priceKey] : priceKey;
  for (const config of [replicateVideoConfig, bedrockVideoConfig]) {
    if (has(config, key)) {
      const seconds = config[key].durationSeconds;
      return Number.isFinite(seconds) ? seconds : null;
    }
  }
  return null;
}

// Strip float noise (0.08 * 6 = 0.48000000000000004) without hiding real digits.
const tidy = (usd) => Math.round(usd * 1e9) / 1e9;

/**
 * Estimated USD for `count` outputs. Order: alias -> MODEL_PRICES ->
 * PROVIDER_FALLBACK_PRICES[provider] -> 0.
 *
 * @param {{priceKey?: string, provider?: string, count?: number}} params
 * @returns {number}
 */
function estimateUsd({ priceKey, provider, count = 1 } = {}) {
  const outputs = Number.isFinite(count) && count >= 0 ? count : 1;
  const key = has(PRICE_KEY_ALIASES, priceKey) ? PRICE_KEY_ALIASES[priceKey] : priceKey;
  if (has(MODEL_PRICES, key)) {
    const priceEntry = MODEL_PRICES[key];
    if (priceEntry.unit === PRICE_UNIT.PER_SECOND) {
      const seconds = clipSecondsFor(key);
      // A per-second price with no known clip length falls through to the provider.
      if (seconds !== null) return tidy(priceEntry.usd * seconds * outputs);
    } else {
      return tidy(priceEntry.usd * outputs);
    }
  }
  if (has(PROVIDER_FALLBACK_PRICES, provider)) {
    return tidy(PROVIDER_FALLBACK_PRICES[provider].usd * outputs);
  }
  return 0;
}

/**
 * USD -> whole micro-dollars, rounded up. The toFixed guard stops float noise
 * (0.48 * 1e6 = 480000.00000000006) from costing an extra micro-dollar.
 *
 * @param {number} usd
 * @returns {number} integer >= 0
 */
function toMicroUsd(usd) {
  if (!Number.isFinite(usd) || usd <= 0) return 0;
  return Math.ceil(Number((usd * MICRO_USD_PER_USD).toFixed(3)));
}

/**
 * Rates payload for the admin cost view (GET /api/admin/agent/cost).
 *
 * @returns {{llm: object, models: Array<object>}}
 */
function listRates() {
  return {
    llm: {
      inputUsdPerMTok: LLM_TOKEN_PRICES.inputUsdPerMTok,
      outputUsdPerMTok: LLM_TOKEN_PRICES.outputUsdPerMTok,
      placeholder: LLM_TOKEN_PRICES.placeholder,
      source: LLM_TOKEN_PRICES.source,
    },
    models: Object.keys(MODEL_PRICES).map((key) => ({
      key,
      unit: MODEL_PRICES[key].unit,
      usd: MODEL_PRICES[key].usd,
      clipSeconds: clipSecondsFor(key),
      usdPerOutput: estimateUsd({ priceKey: key }),
      placeholder: MODEL_PRICES[key].placeholder,
      source: MODEL_PRICES[key].source,
    })),
  };
}

module.exports = {
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
};
