#!/usr/bin/env node
"use strict";

/**
 * Agent behaviour evals.
 *
 *   npm run eval        replay recorded model turns through the real dispatchTool,
 *                       providers stubbed, no network or AWS (PR tier, CI gate)
 *   npm run eval:live   call Bedrock with the real system prompt + tool specs
 *                       (nightly / by hand); --record refreshes recordings/
 *
 * Scores tool name, argument schema (against ALL_TOOL_SPECS), expected args and
 * refusal. Prints `PASS RATE: p/t (x%)` and exits 1 when x is below baseline.json.
 */

const path = require("node:path");
const { ALL_TOOL_SPECS } = require("../lib/agent-tools");
const { parseArgs, HELP } = require("./lib/args");
const { loadGolden } = require("./lib/golden");
const { scoreCase } = require("./lib/scorer");
const { dispatchTurn } = require("./lib/dispatch");
const { createStubDeps, applyStubEnv, blockNetwork } = require("./lib/providers");
const { fingerprint } = require("./lib/prompt");
const { readJsonl, writeJsonl, writeJson } = require("./lib/io");
const { appendUsage, maxUsd } = require("./lib/usage");
const report = require("./lib/report");

const TOOL_NAMES = ALL_TOOL_SPECS.map((s) => s.toolSpec.name);

const loadRecordings = (file) => new Map(readJsonl(file).map((r) => [r.id, r]));

/** Score every case against its turn (missing turn = failed case), dispatching via stubs. */
const scoreAll = async (cases, turns) => {
  const results = [];
  for (const golden of cases) {
    const turn = turns.get(golden.id);
    if (!turn) {
      results.push({
        id: golden.id,
        category: golden.category,
        pass: false,
        checks: {},
        failures: ["recording: none for this case (run eval:live --record)"],
        toolCalls: [],
      });
      continue;
    }
    const { deps } = createStubDeps();
    const dispatched = await dispatchTurn(turn, deps);
    results.push({
      ...scoreCase(golden, turn, dispatched),
      toolCalls: (turn.toolUses || []).map((t) => t.name),
    });
  }
  return results;
};

const mergeRecordings = (file, cases, fresh) => {
  const merged = loadRecordings(file);
  for (const [id, turn] of fresh) merged.set(id, turn);
  const order = new Map(cases.map((c, i) => [c.id, i]));
  const rows = [...merged.values()].sort(
    (a, b) => (order.get(a.id) ?? 1e9) - (order.get(b.id) ?? 1e9)
  );
  writeJsonl(file, rows);
  return rows.length;
};

const main = async (argv) => {
  const opts = parseArgs(argv);
  if (opts.help) {
    console.log(HELP);
    return 0;
  }
  const p = report.paths();
  applyStubEnv();
  if (!opts.live) blockNetwork();

  let cases = loadGolden(opts.golden ? path.resolve(opts.golden) : p.golden, TOOL_NAMES);
  if (opts.limit) cases = cases.slice(0, opts.limit);

  let turns;
  let live = null;
  if (opts.live) {
    const { runLive } = require("./lib/live");
    live = await runLive({ cases, maxUsd: maxUsd() });
    turns = live.turns;
    const calls = live.turns.size;
    if (calls > 0 || live.error) {
      const file = appendUsage({
        mode: opts.record ? "live-record" : "live",
        model: live.usage.model,
        cases: calls,
        inputTokens: live.usage.inputTokens,
        outputTokens: live.usage.outputTokens,
        usd: Number(live.usage.usd.toFixed(6)),
      });
      console.log(`LIVE: ${calls}/${cases.length} cases, $${live.usage.usd.toFixed(4)} -> ${file}`);
    }
    if (live.error) {
      console.error(`LIVE RUN FAILED: ${live.error.name}: ${live.error.message}`);
      if (calls === 0) return 2;
    }
    cases = cases.filter((c) => turns.has(c.id));
    if (opts.record && calls > 0) {
      const n = mergeRecordings(p.recordings, loadGolden(p.golden, TOOL_NAMES), turns);
      console.log(`RECORDED: ${calls} turns merged into recordings.jsonl (${n} total)`);
    }
  } else {
    turns = loadRecordings(p.recordings);
    const stale = [...turns.values()].filter((t) => t.fingerprint !== fingerprint()).length;
    if (stale) {
      console.log(
        `WARN: ${stale} recordings predate the current prompt or tool specs; run eval:live --record`
      );
    }
  }

  const results = await scoreAll(cases, turns);
  for (const r of results.filter((x) => !x.pass)) {
    console.log(`FAIL ${r.id} [${r.category}] ${r.failures.join(" | ")}`);
  }
  const summary = report.summarise(results);
  console.log(`PASS RATE: ${summary.passed}/${summary.total} (${summary.passRate}%)`);

  const baseline = report.loadBaseline(p.baseline);
  const verdict = report.gate(summary.passRate, baseline);
  console.log(`GATE: ${verdict.message}`);

  await writeJson(path.join(p.reports, opts.live ? "live.json" : "latest.json"), {
    ts: new Date().toISOString(),
    mode: opts.live ? "live" : "replay",
    model: live?.usage.model || null,
    ...summary,
    baseline: baseline?.passRate ?? null,
    categories: report.byCategory(results),
    results,
  });

  if (opts.updateBaseline) {
    await report.writeBaseline(p.baseline, summary, {
      source: opts.live ? "live" : "replay",
      model: live?.usage.model || [...turns.values()][0]?.model || null,
    });
    console.log(`BASELINE: wrote ${summary.passRate}% to baseline.json`);
    return 0;
  }
  return verdict.ok ? 0 : 1;
};

if (require.main === module) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error(err?.message || err);
      process.exit(2);
    }
  );
}

module.exports = { main, scoreAll };
