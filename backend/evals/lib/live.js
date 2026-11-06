"use strict";

const { createConverse, defaultModelId } = require("./bedrock");
const { buildSystem, fingerprint, TOOL_CONFIG } = require("./prompt");
const { costUsd } = require("./usage");

// Same inference settings as routes/agent-route.js, except temperature: 0 so a
// recording run is repeatable (override with EVAL_TEMPERATURE).
const inferenceConfig = () => ({
  maxTokens: 400,
  temperature: Number.isFinite(Number(process.env.EVAL_TEMPERATURE))
    ? Number(process.env.EVAL_TEMPERATURE)
    : 0,
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const callWithRetry = async (fn, attempts = 3) => {
  for (let i = 1; ; i += 1) {
    try {
      return await fn();
    } catch (err) {
      const throttled = /throttl|too many requests/i.test(`${err?.name} ${err?.message}`);
      if (!throttled || i >= attempts) throw err;
      await sleep(2000 * i);
    }
  }
};

/**
 * Calls Bedrock once per case (first model turn only: tool choice is what is scored).
 * Stops BEFORE the next call once spend reaches maxUsd. Returns
 * { turns: Map(id -> recording), usage, stoppedEarly, error }.
 * An error mid-run (e.g. rejected credentials) is returned, not thrown, so the
 * caller can still log the usage already incurred.
 */
const runLive = async ({ cases, maxUsd, log = console.log }) => {
  const turns = new Map();
  const usage = { inputTokens: 0, outputTokens: 0, usd: 0, model: null };
  let stoppedEarly = false;
  let error = null;
  try {
    usage.model = await defaultModelId();
    const converse = createConverse();
    const fp = fingerprint();
    for (const c of cases) {
      if (usage.usd >= maxUsd) {
        stoppedEarly = true;
        log(`EVAL_MAX_USD reached ($${usage.usd.toFixed(4)} >= $${maxUsd}); stopping at ${c.id}`);
        break;
      }
      const res = await callWithRetry(() =>
        converse({
          modelId: usage.model,
          system: buildSystem(c.context),
          messages: [{ role: "user", content: [{ text: c.user }] }],
          toolConfig: TOOL_CONFIG,
          inferenceConfig: inferenceConfig(),
        })
      );
      usage.inputTokens += res.usage.inputTokens;
      usage.outputTokens += res.usage.outputTokens;
      usage.usd += costUsd(usage.model, res.usage.inputTokens, res.usage.outputTokens);
      turns.set(c.id, {
        id: c.id,
        model: usage.model,
        fingerprint: fp,
        recordedAt: new Date().toISOString(),
        stopReason: res.stopReason,
        text: res.text,
        toolUses: res.toolUses,
        usage: res.usage,
      });
    }
  } catch (err) {
    error = err;
  }
  return { turns, usage, stoppedEarly, error };
};

module.exports = { runLive };
