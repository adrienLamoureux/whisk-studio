const PROMPT_PATTERN = [
  "character (1girl, solo + name + recognizable)",
  "shot range",
  "focus/action",
  "subject framing/facial fidelity",
  "environment/background",
  "visual/style",
];

/** Builds the extra payload returned when the request has ?debug=true. */
const buildIllustrationDebugPayload = ({
  positivePrompt,
  negativePrompt,
  promptWasTrimmed,
  negativeWasTrimmed,
  maxPromptTokens,
  identityBlock,
  contextMode,
  summaryLine,
  contextLine,
  recentTranscript,
  cleanScenePrompt,
  updatedScene,
  requestedModelKey,
  modelConfig,
  input,
}) => ({
  prompt: { positive: positivePrompt, negative: negativePrompt },
  identity: identityBlock,
  context: {
    mode: contextMode,
    summary: summaryLine,
    latest: contextLine,
    recent: recentTranscript,
    scene: cleanScenePrompt,
    sceneEnvironment: updatedScene.sceneEnvironment || "",
    sceneAction: updatedScene.sceneAction || "",
  },
  promptPattern: PROMPT_PATTERN,
  replicate: {
    modelKey: requestedModelKey,
    modelId: modelConfig.modelId,
    input,
    ...(promptWasTrimmed || negativeWasTrimmed
      ? {
          notice: [
            promptWasTrimmed
              ? `Positive prompt trimmed to ${maxPromptTokens} tokens for Replicate.`
              : null,
            negativeWasTrimmed
              ? `Negative prompt trimmed to ${maxPromptTokens} tokens for Replicate.`
              : null,
          ]
            .filter(Boolean)
            .join(" "),
        }
      : {}),
  },
});

module.exports = { buildIllustrationDebugPayload };
