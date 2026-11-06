"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const BACKEND = path.join(__dirname, "..", "..");
const GOLDEN = path.join(__dirname, "..", "golden.jsonl");

// No AWS credential source at all: the PR tier must run offline and credential-free.
const cleanEnv = (extra) => {
  const env = { ...process.env, ...extra };
  for (const k of Object.keys(env)) if (k.startsWith("AWS_")) delete env[k];
  return Object.assign(env, { AWS_EC2_METADATA_DISABLED: "true" });
};

const runEval = (args, reportDir) =>
  spawnSync("node", ["evals/run.js", ...args], {
    cwd: BACKEND,
    env: cleanEnv({ EVAL_REPORT_DIR: reportDir }),
    encoding: "utf8",
  });

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "eval-run-"));

test("replay passes at or above baseline with no credentials and prints PASS RATE", () => {
  const dir = tmp();
  const r = runEval([], dir);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /PASS RATE: \d+\/\d+ \(\d+(\.\d+)?%\)/);
  const report = JSON.parse(fs.readFileSync(path.join(dir, "latest.json"), "utf8"));
  assert.equal(typeof report.passRate, "number");
  assert.equal(report.mode, "replay");
});

test("replay dispatches every recorded tool call through the stubs without failures", () => {
  const dir = tmp();
  const r = runEval([], dir);
  const report = JSON.parse(fs.readFileSync(path.join(dir, "latest.json"), "utf8"));
  assert.equal(r.status, 0);
  const dispatchFailures = report.results.filter((x) => x.checks.dispatch === false);
  assert.deepEqual(dispatchFailures, []);
});

test("the gate exits non-zero when tool expectations are degraded", () => {
  const cases = fs
    .readFileSync(GOLDEN, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
  let flipped = 0;
  for (const c of cases) {
    if (flipped < 5 && c.category === "tool" && c.expect.tool) {
      c.expect.tool = c.expect.tool === "browse_gallery" ? "set_theme" : "browse_gallery";
      flipped += 1;
    }
  }
  const dir = tmp();
  const file = path.join(dir, "degraded.jsonl");
  fs.writeFileSync(file, cases.map((c) => JSON.stringify(c)).join("\n") + "\n");
  const r = runEval(["--golden", file], dir);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /GATE: BELOW baseline/);
});

test("--record without --live is rejected", () => {
  const r = runEval(["--record"], tmp());
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--record only makes sense with --live/);
});
