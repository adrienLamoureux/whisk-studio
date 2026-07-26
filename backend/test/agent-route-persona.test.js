"use strict";
// Persona/system-prompt assembly tests for POST /api/agent/turn — split from
// agent-route.test.js to stay under the file-length cap.
const test = require("node:test");
const assert = require("node:assert/strict");
const { getRouterHandler } = require("./helpers/test-utils");
const { createMockDeps } = require("./helpers/mock-deps");
const { invalidateFlagsCache } = require("../lib/feature-flags");

const createRes = () => {
  const out = { statusCode: 200, payload: null, headers: {} };
  const res = {
    setHeader(name, value) {
      out.headers[name] = value;
    },
    status(code) {
      out.statusCode = code;
      return res;
    },
    json(payload) {
      out.payload = payload;
      return res;
    },
    out,
  };
  return res;
};

const runTurn = async ({ aesthetic }) => {
  invalidateFlagsCache();
  let capturedSystem = "";
  const express = require("express");
  const router = express.Router();
  const deps = createMockDeps({
    ConverseCommand: function FakeConverse(input) {
      this.input = input;
    },
    bedrockClient: {
      send: async (cmd) => {
        if (cmd?.input?.system?.[0]?.text) capturedSystem = cmd.input.system[0].text;
        return {
          output: { message: { content: [{ text: "Hi!\n[EMOTION: neutral]" }] } },
          stopReason: "end_turn",
        };
      },
    },
    dynamoClient: {
      send: async (cmd) => {
        const pk = cmd?.input?.Key?.pk;
        if (pk === "APP#GLOBAL") return { Item: { flags: { agentMode: true } } };
        return { Item: null };
      },
    },
    agentState: {
      load: async () => (aesthetic ? { aesthetic } : null),
      patch: async () => {},
      clear: async () => {},
    },
  });
  require("../routes/agent-route")(router, deps);
  const handler = getRouterHandler(router, "post", "/api/agent/turn");
  const res = createRes();
  await handler(
    { body: { messages: [{ role: "user", content: "hi" }] }, query: {}, user: { sub: "user-1" } },
    res
  );
  assert.equal(res.out.statusCode, 200);
  invalidateFlagsCache();
  return capturedSystem;
};

test("obscura pref appends the Obscura voice addendum", async () => {
  const system = await runTurn({ aesthetic: "obscura" });
  assert.ok(system.includes("Obscura voice"));
  assert.ok(system.includes("drop the anime flavor"));
});

test("default prefs keep the base anime voice", async () => {
  const system = await runTurn({ aesthetic: null });
  assert.ok(!system.includes("Obscura voice"));
  assert.ok(system.includes("You are Hiyori"));
});
