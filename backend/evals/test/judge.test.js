"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildJudgePrompt, parseJudgeReply } = require("../judge");

test("parseJudgeReply extracts JSON wrapped in prose", () => {
  const v = parseJudgeReply('Sure: {"score": 4, "emotionTag": true, "reason": "good"} done');
  assert.deepEqual(v, { score: 4, emotionTag: true, reason: "good" });
});

test("parseJudgeReply rejects out-of-range scores and non-JSON", () => {
  assert.equal(parseJudgeReply('{"score": 9}'), null);
  assert.equal(parseJudgeReply("no json here"), null);
  assert.equal(parseJudgeReply('{"score": '), null);
});

test("buildJudgePrompt carries the user message, tools and reply", () => {
  const p = buildJudgePrompt(
    { user: "hi", category: "ambiguous" },
    { text: "hello [EMOTION: happy]", toolUses: [{ name: "what_can_you_do" }] }
  );
  assert.match(p, /"hi"/);
  assert.match(p, /what_can_you_do/);
  assert.match(p, /EMOTION: happy/);
});
