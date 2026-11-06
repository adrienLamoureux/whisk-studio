"use strict";

const fs = require("node:fs");
const path = require("node:path");

// USD per 1M tokens: [model id substring, input, output]. Unknown models are priced
// at the Sonnet rate so a surprise model can only over-count spend.
const RATES = [
  ["haiku-4-5", 1, 5],
  ["sonnet-4", 3, 15],
  ["opus-4", 15, 75],
];
const FALLBACK_RATE = [3, 15];

const costUsd = (model, inputTokens, outputTokens) => {
  const hit = RATES.find(([k]) => String(model || "").includes(k));
  const [i, o] = hit ? [hit[1], hit[2]] : FALLBACK_RATE;
  return (inputTokens * i + outputTokens * o) / 1e6;
};

const defaultUsageLog = () => path.join(__dirname, "..", "reports", "usage.jsonl");

/** Appends one {ts, mode, model, cases, inputTokens, outputTokens, usd} line. */
const appendUsage = (line, file = process.env.EVAL_USAGE_LOG || defaultUsageLog()) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify({ ts: new Date().toISOString(), ...line })}\n`);
  return file;
};

const maxUsd = () => {
  const n = Number(process.env.EVAL_MAX_USD);
  return Number.isFinite(n) && n > 0 ? n : 0.5;
};

module.exports = { costUsd, appendUsage, maxUsd, defaultUsageLog };
