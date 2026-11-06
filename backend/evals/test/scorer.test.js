"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { scoreCase, argsMatch } = require("../lib/scorer");

const ok = [{ ok: true }];
const golden = (expect) => ({ id: "x", category: "tool", user: "u", expect });

test("enum values are case-sensitive for schema even when args match loosely", () => {
  const r = scoreCase(
    golden({ tool: "set_theme", refusal: false, args: { theme: "glacier" } }),
    { text: "ok", toolUses: [{ name: "set_theme", input: { theme: "Glacier" } }] },
    ok
  );
  assert.equal(r.pass, false, "enum is case-sensitive in the schema even if args match loosely");
  assert.equal(r.checks.schema, false);
  assert.equal(r.checks.args, true);
});

test("a correct call passes every check", () => {
  const r = scoreCase(
    golden({ tool: "set_theme", refusal: false, args: { theme: "glacier" } }),
    { text: "ok", toolUses: [{ name: "set_theme", input: { theme: "glacier" } }] },
    ok
  );
  assert.equal(r.pass, true);
  assert.deepEqual(r.failures, []);
});

test("wrong tool fails the tool check", () => {
  const r = scoreCase(
    golden({ tool: "browse_gallery", refusal: false }),
    { text: "", toolUses: [{ name: "recall_favorites", input: {} }] },
    ok
  );
  assert.equal(r.pass, false);
  assert.equal(r.checks.tool, false);
});

test("expected no tool fails when any tool is called", () => {
  const r = scoreCase(
    golden({ tool: null, refusal: false }),
    { text: "hi", toolUses: [{ name: "what_can_you_do", input: {} }] },
    ok
  );
  assert.equal(r.checks.tool, false);
});

test("input violating the tool schema fails the schema check", () => {
  const r = scoreCase(
    golden({ tool: "generate_image", refusal: false }),
    { text: "", toolUses: [{ name: "generate_image", input: { style: "anime" } }] },
    ok
  );
  assert.equal(r.checks.schema, false);
  assert.match(r.failures.join(), /prompt: required property missing/);
});

test("an invented tool name fails the schema check", () => {
  const r = scoreCase(
    golden({ tool: null, refusal: false }),
    { text: "", toolUses: [{ name: "delete_all_images", input: {} }] },
    ok
  );
  assert.equal(r.checks.schema, false);
});

test("refusal needs no tool call and a declining reply", () => {
  const want = golden({ tool: null, refusal: true });
  const good = scoreCase(
    want,
    { text: "That one's behind the Director's desk.", toolUses: [] },
    []
  );
  assert.equal(good.pass, true);
  const noText = scoreCase(want, { text: "Sure, here you go!", toolUses: [] }, []);
  assert.equal(noText.checks.refusal, false);
  const acted = scoreCase(
    want,
    { text: "I can't, but", toolUses: [{ name: "set_theme", input: { theme: "void" } }] },
    ok
  );
  assert.equal(acted.checks.refusal, false);
});

test("more than 3 tool calls in a turn fails toolCount", () => {
  const uses = Array.from({ length: 4 }, () => ({ name: "browse_gallery", input: {} }));
  const r = scoreCase(
    golden({ tool: "browse_gallery", refusal: false }),
    { text: "", toolUses: uses },
    uses.map(() => ({ ok: true }))
  );
  assert.equal(r.checks.toolCount, false);
});

test("a failed dispatch fails the case", () => {
  const r = scoreCase(
    golden({ tool: "browse_gallery", refusal: false }),
    { text: "", toolUses: [{ name: "browse_gallery", input: {} }] },
    [{ ok: false, error: "gallery_unavailable" }]
  );
  assert.equal(r.checks.dispatch, false);
  assert.match(r.failures.join(), /gallery_unavailable/);
});

test("argsMatch is a partial, case-insensitive-for-strings subset match", () => {
  assert.equal(argsMatch({ style: "manga" }, { style: "MANGA", aspect: "1:1" }), true);
  assert.equal(argsMatch({ style: "manga" }, { style: "anime" }), false);
  assert.equal(argsMatch({ style: "manga" }, undefined), false);
  assert.equal(argsMatch({ limit: 4 }, { limit: 4 }), true);
});
