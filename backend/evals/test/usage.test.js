"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { costUsd, appendUsage, maxUsd } = require("../lib/usage");

test("costUsd prices Haiku 4.5 at $1 in / $5 out per million tokens", () => {
  const usd = costUsd("us.anthropic.claude-haiku-4-5-20251001-v1:0", 1_000_000, 1_000_000);
  assert.equal(usd, 6);
});

test("an unknown model is priced at the Sonnet rate, never free", () => {
  assert.equal(costUsd("mystery-model", 1_000_000, 0), 3);
});

test("appendUsage writes one JSON line with the contract fields", () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "usage-")), "u.jsonl");
  appendUsage(
    { mode: "live", model: "m", cases: 2, inputTokens: 10, outputTokens: 5, usd: 0.001 },
    file
  );
  const row = JSON.parse(fs.readFileSync(file, "utf8").trim());
  assert.deepEqual(
    Object.keys(row).sort(),
    ["cases", "inputTokens", "mode", "model", "outputTokens", "ts", "usd"].sort()
  );
});

test("maxUsd defaults to 0.50 and honours EVAL_MAX_USD", () => {
  const saved = process.env.EVAL_MAX_USD;
  delete process.env.EVAL_MAX_USD;
  assert.equal(maxUsd(), 0.5);
  process.env.EVAL_MAX_USD = "0.2";
  assert.equal(maxUsd(), 0.2);
  if (saved === undefined) delete process.env.EVAL_MAX_USD;
  else process.env.EVAL_MAX_USD = saved;
});
