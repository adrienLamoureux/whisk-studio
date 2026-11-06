"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { validate } = require("../lib/schema");

const schema = {
  type: "object",
  properties: {
    name: { type: "string" },
    kind: { type: "string", enum: ["a", "b"] },
    n: { type: "number" },
  },
  required: ["name"],
};

test("accepts a valid object", () => {
  assert.deepEqual(validate({ name: "x", kind: "a", n: 2 }, schema), []);
});

test("reports missing required, bad enum and wrong type", () => {
  assert.match(validate({}, schema).join(), /name: required property missing/);
  assert.match(validate({ name: "x", kind: "c" }, schema).join(), /not in enum/);
  assert.match(validate({ name: "x", n: "2" }, schema).join(), /expected number, got string/);
});

test("rejects a non-object input", () => {
  assert.match(validate("oops", schema).join(), /expected object, got string/);
});
