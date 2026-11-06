"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { readJson, writeJson } = require("./io");

const EVALS_DIR = path.join(__dirname, "..");
const paths = () => ({
  golden: path.join(EVALS_DIR, "golden.jsonl"),
  recordings: path.join(EVALS_DIR, "recordings", "recordings.jsonl"),
  baseline: path.join(EVALS_DIR, "baseline.json"),
  reports: process.env.EVAL_REPORT_DIR || path.join(EVALS_DIR, "reports"),
});

const round1 = (n) => Math.round(n * 10) / 10;

const summarise = (results) => {
  const passed = results.filter((r) => r.pass).length;
  const total = results.length;
  return { passed, total, passRate: total ? round1((passed / total) * 100) : 0 };
};

const byCategory = (results) => {
  const out = {};
  for (const r of results) {
    out[r.category] ||= { passed: 0, total: 0 };
    out[r.category].total += 1;
    if (r.pass) out[r.category].passed += 1;
  }
  return out;
};

const loadBaseline = (file) => (fs.existsSync(file) ? readJson(file) : null);

/** The gate: below the committed baseline fails; no baseline means nothing to compare. */
const gate = (passRate, baseline) => {
  if (!baseline || typeof baseline.passRate !== "number") {
    return { ok: true, message: "no baseline.json yet (run with --update-baseline)" };
  }
  const ok = passRate >= baseline.passRate;
  return { ok, message: `${ok ? "at or above" : "BELOW"} baseline ${baseline.passRate}%` };
};

const writeBaseline = (file, summary, extra) =>
  writeJson(file, {
    passRate: summary.passRate,
    passed: summary.passed,
    total: summary.total,
    ...extra,
    updatedAt: new Date().toISOString(),
  });

module.exports = { paths, summarise, byCategory, loadBaseline, gate, writeBaseline };
