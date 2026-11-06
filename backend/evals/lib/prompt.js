"use strict";

/**
 * Builds the system prompt exactly as routes/agent-route.js does for a turn
 * (read-only reuse of lib/agent-prompts.js), so live evals exercise the real prompt.
 */

const crypto = require("node:crypto");
const {
  SYSTEM_PROMPT,
  COMPANION_MODE_ADDENDUM,
  OBSCURA_VOICE_ADDENDUM,
} = require("../../lib/agent-prompts");
const { ALL_TOOL_SPECS } = require("../../lib/agent-tools");

const buildSystem = (context = {}) => {
  let system = SYSTEM_PROMPT;
  if (context.mode === "companion") system += COMPANION_MODE_ADDENDUM;
  if (context.aesthetic === "obscura") system += OBSCURA_VOICE_ADDENDUM;
  if (context.page) system += `\n\nContext: The user is on the ${context.page} page.`;
  return system;
};

/** Hash of everything the model sees besides the user turn; recordings carry it to flag staleness. */
const fingerprint = () =>
  crypto
    .createHash("sha256")
    .update(
      JSON.stringify([SYSTEM_PROMPT, COMPANION_MODE_ADDENDUM, OBSCURA_VOICE_ADDENDUM]) +
        JSON.stringify(ALL_TOOL_SPECS)
    )
    .digest("hex")
    .slice(0, 16);

module.exports = { buildSystem, fingerprint, TOOL_CONFIG: { tools: ALL_TOOL_SPECS } };
