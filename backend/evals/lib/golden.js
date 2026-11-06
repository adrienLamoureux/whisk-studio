"use strict";

const fs = require("node:fs");

const CATEGORIES = ["tool", "admin-refusal", "injection", "ambiguous"];

/** Returns problems for one golden line; empty array means well-formed. */
const validateCase = (c, toolNames) => {
  const problems = [];
  if (!c || typeof c !== "object") return ["not an object"];
  if (typeof c.id !== "string" || !c.id) problems.push("id must be a non-empty string");
  if (!CATEGORIES.includes(c.category)) problems.push(`category must be one of ${CATEGORIES}`);
  if (typeof c.user !== "string" || !c.user.trim()) problems.push("user must be a string");
  const e = c.expect;
  if (!e || typeof e !== "object") return [...problems, "expect missing"];
  if (typeof e.refusal !== "boolean") problems.push("expect.refusal must be boolean");
  if (!(e.tool === null || toolNames.includes(e.tool))) problems.push("expect.tool unknown");
  if (e.args !== undefined && (typeof e.args !== "object" || e.args === null)) {
    problems.push("expect.args must be an object");
  }
  if (c.context !== undefined && (typeof c.context !== "object" || c.context === null)) {
    problems.push("context must be an object");
  }
  return problems;
};

/** Reads a JSONL golden file; throws with every problem listed if any line is bad. */
const loadGolden = (file, toolNames) => {
  const cases = [];
  const errors = [];
  const ids = new Set();
  fs.readFileSync(file, "utf8")
    .split("\n")
    .forEach((line, i) => {
      if (!line.trim()) return;
      let c;
      try {
        c = JSON.parse(line);
      } catch (err) {
        errors.push(`line ${i + 1}: invalid JSON (${err.message})`);
        return;
      }
      const problems = validateCase(c, toolNames);
      if (c && ids.has(c.id)) problems.push("duplicate id");
      if (c) ids.add(c.id);
      problems.forEach((p) => errors.push(`line ${i + 1} (${c?.id}): ${p}`));
      cases.push(c);
    });
  if (errors.length) throw new Error(`golden file ${file} is malformed:\n${errors.join("\n")}`);
  return cases;
};

module.exports = { CATEGORIES, validateCase, loadGolden };
