"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { ALL_TOOL_SPECS } = require("../../lib/agent-tools");
const { loadGolden, validateCase } = require("../lib/golden");

const TOOLS = ALL_TOOL_SPECS.map((s) => s.toolSpec.name);
const GOLDEN = path.join(__dirname, "..", "golden.jsonl");

test("the committed golden set covers all tools and the three guard categories", () => {
  const cases = loadGolden(GOLDEN, TOOLS);
  assert.ok(cases.length >= 40, `only ${cases.length} cases`);
  const covered = new Set(cases.map((c) => c.expect.tool).filter(Boolean));
  assert.deepEqual([...covered].sort(), [...TOOLS].sort());
  for (const cat of ["admin-refusal", "injection", "ambiguous"]) {
    assert.ok(cases.filter((c) => c.category === cat).length >= 3, `too few ${cat}`);
  }
});

test("validateCase flags malformed cases", () => {
  const good = { id: "a", category: "tool", user: "hi", expect: { tool: null, refusal: false } };
  assert.deepEqual(validateCase(good, TOOLS), []);
  assert.ok(validateCase({ ...good, category: "nope" }, TOOLS).length);
  assert.ok(validateCase({ ...good, expect: { tool: "ghost", refusal: false } }, TOOLS).length);
  assert.ok(validateCase({ ...good, expect: { tool: null } }, TOOLS).length);
});

test("loadGolden rejects bad JSON and duplicate ids", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "golden-"));
  const file = path.join(dir, "g.jsonl");
  const line = JSON.stringify({
    id: "a",
    category: "tool",
    user: "hi",
    expect: { tool: null, refusal: false },
  });
  fs.writeFileSync(file, `${line}\n${line}\nnot json\n`);
  assert.throws(
    () => loadGolden(file, TOOLS),
    /duplicate id[\s\S]*invalid JSON|invalid JSON[\s\S]*duplicate id/
  );
});
