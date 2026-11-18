"use strict";

/**
 * spend-resolvers.js - what each paid route charges to the daily budget.
 * A resolver returns { priceKey, provider, count }; an unknown model key falls
 * back to the provider price in config/pricing.js, so it never prices at zero.
 */

const { MAX_BILLABLE_IMAGES_PER_REQUEST: MAX } = require("../config/spend-limits");
const {
  replicateModelConfig,
  replicateVideoConfig,
  civitaiModelConfig,
} = require("../config/models");
const { buildDirectorFallbackConfig } = require("./director-config");
const {
  DEFAULT_STORY_ILLUSTRATION_MODEL,
  STORY_ANIMATION_MODEL_KEY,
} = require("../routes/story/illustration-helpers");
const { spendGuard } = require("./spend-middleware");

// Same literals as routes/bedrock-routes.js and routes/gradio-routes.js.
const DEFAULT_BEDROCK_IMAGE_MODEL = "titan";
const DEFAULT_GRADIO_IMAGE_MODEL = "wainsfw";
const DIFF_SCHEDULER = "diff"; // the replicate image route forces two images for it

// Defaults are read once, as the routes do.
const directorDefaults = buildDirectorFallbackConfig({
  replicateModelConfig,
  replicateVideoConfig,
  defaultNegativePrompt: "",
});

// Same coercion as the routes: String(value || "").trim(), so an array or number is
// read as the route reads it and never prices a different model than the one that runs.
const text = (value) => String(value || "").trim();
const modelOr = (req, fallback) => text(req.body?.model) || fallback;
// bedrock, gradio and story illustrations use `req.body?.model || fallback` without trim.
const rawModelOr = (req, fallback) => String(req.body?.model || fallback);
// Mirrors the route clamp: Number(numImages) || 1, then min/max.
const clampImages = (req, max) => Math.min(Math.max(Number(req.body?.numImages) || 1, 1), max);
const fixed = (priceKey, provider) => () => ({ priceKey, provider, count: 1 });
const single = (getKey, provider) => (req) => ({ priceKey: getKey(req), provider, count: 1 });

const SPEND_RESOLVERS = Object.freeze({
  replicateVideo: single(
    (req) => modelOr(req, directorDefaults.video.videoModel),
    "replicate-video"
  ),
  replicateImage: (req) => ({
    priceKey: modelOr(req, directorDefaults.generation.imageModel),
    provider: "replicate",
    count:
      text(req.body?.scheduler) === DIFF_SCHEDULER
        ? MAX.replicate
        : clampImages(req, MAX.replicate),
  }),
  civitaiImage: (req) => ({
    priceKey: modelOr(req, Object.keys(civitaiModelConfig)[0]),
    provider: "civitai",
    count: clampImages(req, MAX.civitai),
  }),
  bedrockImage: (req) => ({
    priceKey: rawModelOr(req, DEFAULT_BEDROCK_IMAGE_MODEL),
    provider: "bedrock",
    count: clampImages(req, MAX.bedrock),
  }),
  gradioImage: single((req) => rawModelOr(req, DEFAULT_GRADIO_IMAGE_MODEL), "gradio"),
  novaReel: fixed("nova-reel", "bedrock-video"),
  storyIllustration: single(
    (req) => rawModelOr(req, DEFAULT_STORY_ILLUSTRATION_MODEL),
    "replicate"
  ),
  storyAnimation: fixed(STORY_ANIMATION_MODEL_KEY, "replicate-video"),
  storyMusic: fixed("story-music", "replicate"),
  bedrockLlmCall: fixed("bedrock-llm-call", "bedrock-llm"),
});

/** spendGuard for a named resolver; an unknown name throws when the route is registered. */
function spendGuardFor(deps, name) {
  if (!Object.hasOwn(SPEND_RESOLVERS, name)) throw new Error(`Unknown spend resolver: ${name}`);
  return spendGuard(deps, SPEND_RESOLVERS[name]);
}

module.exports = { SPEND_RESOLVERS, spendGuardFor };
