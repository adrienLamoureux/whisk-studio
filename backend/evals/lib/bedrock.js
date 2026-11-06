"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

/** Region: BEDROCK_REGION, AWS_REGION, then the default profile's region, then us-east-1. */
const resolveRegion = () => {
  if (process.env.BEDROCK_REGION) return process.env.BEDROCK_REGION;
  if (process.env.AWS_REGION) return process.env.AWS_REGION;
  try {
    const cfg = fs.readFileSync(path.join(os.homedir(), ".aws", "config"), "utf8");
    const m = cfg.match(/^\s*region\s*=\s*(\S+)/m);
    if (m) return m[1];
  } catch {
    // no config file
  }
  return "us-east-1";
};

/** Default model: whatever the agent would use with no DynamoDB override (agent-config.js). */
const defaultModelId = async () => {
  if (process.env.EVAL_MODEL) return process.env.EVAL_MODEL;
  const { getAgentModelId } = require("../../lib/agent-config");
  return getAgentModelId({});
};

/** Thin Converse wrapper returning {text, toolUses, stopReason, usage}. Live tiers only. */
const createConverse = () => {
  const { BedrockRuntimeClient, ConverseCommand } = require("@aws-sdk/client-bedrock-runtime");
  const client = new BedrockRuntimeClient({ region: resolveRegion() });
  return async ({ modelId, system, messages, toolConfig, inferenceConfig }) => {
    const resp = await client.send(
      new ConverseCommand({
        modelId,
        system: [{ text: system }],
        messages,
        ...(toolConfig ? { toolConfig } : {}),
        inferenceConfig,
      })
    );
    const blocks = resp?.output?.message?.content || [];
    return {
      text: blocks
        .map((b) => b.text)
        .filter(Boolean)
        .join(""),
      toolUses: blocks
        .filter((b) => b.toolUse)
        .map((b) => ({ name: b.toolUse.name, input: b.toolUse.input || {} })),
      stopReason: resp?.stopReason || "end_turn",
      usage: {
        inputTokens: resp?.usage?.inputTokens || 0,
        outputTokens: resp?.usage?.outputTokens || 0,
      },
    };
  };
};

module.exports = { createConverse, defaultModelId, resolveRegion };
