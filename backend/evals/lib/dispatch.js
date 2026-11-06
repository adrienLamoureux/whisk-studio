"use strict";

const { dispatchTool } = require("../../lib/agent-tools");
const { STUB_USER_ID } = require("./providers");

/**
 * Runs every tool use of a model turn through the real dispatchTool, the same way
 * agent-route.js does (a throw becomes {ok:false}). Returns outcomes aligned with toolUses.
 */
const dispatchTurn = async (turn, deps) => {
  const outcomes = [];
  for (const tu of turn.toolUses || []) {
    try {
      outcomes.push(
        await dispatchTool({ name: tu.name, args: tu.input || {}, deps, userId: STUB_USER_ID })
      );
    } catch (err) {
      outcomes.push({ ok: false, error: err?.message || "tool_dispatch_failed" });
    }
  }
  return outcomes;
};

module.exports = { dispatchTurn };
