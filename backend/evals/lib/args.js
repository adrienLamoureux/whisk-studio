"use strict";

const HELP = `Usage: node evals/run.js [options]
  (default)           replay recorded turns, no network (PR tier)
  --live              call Bedrock with the real prompt + tool specs (nightly tier)
  --record            with --live: write the turns to evals/recordings/
  --limit N           run only the first N cases
  --golden <path>     use another golden JSONL file
  --update-baseline   write evals/baseline.json from this run
Env: EVAL_MAX_USD (default 0.50), EVAL_USAGE_LOG, EVAL_MODEL, EVAL_TEMPERATURE, EVAL_REPORT_DIR`;

const parseArgs = (argv) => {
  const opts = { live: false, record: false, limit: null, golden: null, updateBaseline: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--live") opts.live = true;
    else if (a === "--record") opts.record = true;
    else if (a === "--update-baseline") opts.updateBaseline = true;
    else if (a === "--limit") opts.limit = Number(argv[(i += 1)]);
    else if (a === "--golden") opts.golden = argv[(i += 1)];
    else if (a === "--help" || a === "-h") opts.help = true;
    else throw new Error(`unknown option ${a}\n${HELP}`);
  }
  if (opts.limit !== null && !(Number.isInteger(opts.limit) && opts.limit > 0)) {
    throw new Error("--limit needs a positive integer");
  }
  if (opts.golden !== null && !opts.golden) throw new Error("--golden needs a path");
  if (opts.record && !opts.live) throw new Error("--record only makes sense with --live");
  return opts;
};

module.exports = { parseArgs, HELP };
