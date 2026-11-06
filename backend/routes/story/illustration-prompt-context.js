const {
  STORY_OPENING_SCENE_MAX_ENVIRONMENT_FRAGMENTS,
  STORY_OPENING_SCENE_MAX_ACTION_FRAGMENTS,
  isOpeningSceneItem,
} = require("./illustration-helpers");

/**
 * Gathers recent conversation context, compacts the scene and asks the model
 * to draft the positive/negative illustration prompts.
 */
const buildIllustrationPromptContext = async (
  deps,
  { userId, sessionId, sessionItem, sceneItem, resolvedCharacter, contextMode }
) => {
  const {
    buildMediaPk,
    queryBySkPrefix,
    storyMessagePrefix,
    compactScenePayload,
    aiCraftSceneContext,
    normalizePromptFragment,
    aiCraftIllustrationPrompts,
  } = deps;

  const recentMessages = await queryBySkPrefix({
    pk: buildMediaPk(userId),
    skPrefix: storyMessagePrefix(sessionId),
    limit: 6,
    scanForward: false,
  });
  const orderedRecent = recentMessages.slice().reverse();
  const lastAssistant = recentMessages.find((message) => message.role === "assistant");
  const contextLine = lastAssistant?.content ? normalizePromptFragment(lastAssistant.content) : "";
  const summaryLine = sessionItem.summary ? normalizePromptFragment(sessionItem.summary) : "";
  const recentTranscript = orderedRecent
    .map((message) => {
      const label = message.role === "user" ? "Player" : "Narrator";
      return `${label}: ${normalizePromptFragment(message.content || "")}`;
    })
    .filter(Boolean)
    .join(" ");
  const isOpening = isOpeningSceneItem(normalizePromptFragment, sceneItem);
  const openingSceneContextLimits = isOpening
    ? {
        maxEnvironmentFragments: STORY_OPENING_SCENE_MAX_ENVIRONMENT_FRAGMENTS,
        maxActionFragments: STORY_OPENING_SCENE_MAX_ACTION_FRAGMENTS,
      }
    : {};
  const compactSceneForPrompt = await aiCraftSceneContext({
    scenePrompt: sceneItem.prompt || "",
    sceneEnvironment: sceneItem.sceneEnvironment || "",
    sceneAction: sceneItem.sceneAction || "",
    contextText: contextLine || recentTranscript,
    storyState: sessionItem.storyState || {},
    lorebook: sessionItem.lorebook || {},
    ...openingSceneContextLimits,
  });
  const sceneContextForPrompt = isOpening
    ? compactScenePayload({
        scenePrompt: compactSceneForPrompt.scenePrompt || sceneItem.prompt || "",
        sceneEnvironment:
          compactSceneForPrompt.sceneEnvironment || sceneItem.sceneEnvironment || "",
        sceneAction: compactSceneForPrompt.sceneAction || sceneItem.sceneAction || "",
        maxEnvironment: STORY_OPENING_SCENE_MAX_ENVIRONMENT_FRAGMENTS,
        maxAction: STORY_OPENING_SCENE_MAX_ACTION_FRAGMENTS,
      })
    : compactSceneForPrompt;
  const cleanScenePrompt = sceneContextForPrompt.scenePrompt || sceneItem.prompt || "";

  const protagonistLine = sessionItem.protagonistPrompt?.includes(sessionItem.protagonistName)
    ? sessionItem.protagonistPrompt
    : `${sessionItem.protagonistName}, ${sessionItem.protagonistPrompt}`;
  const identityBlock =
    resolvedCharacter?.identityPrompt || sessionItem.protagonistPrompt || protagonistLine;

  const draftedPrompts = await aiCraftIllustrationPrompts({
    character: {
      name: resolvedCharacter?.name || sessionItem.protagonistName || "",
      identityPrompt: identityBlock,
      signatureTraits: resolvedCharacter?.signatureTraits || "",
      styleReference: resolvedCharacter?.styleReference || sessionItem.stylePrompt || "",
      viewDistance: resolvedCharacter?.viewDistance || "",
      eyeDetails: resolvedCharacter?.eyeDetails || "",
      pose: resolvedCharacter?.pose || "",
    },
    scenePrompt: cleanScenePrompt,
    sceneEnvironment: sceneContextForPrompt.sceneEnvironment || sceneItem.sceneEnvironment || "",
    sceneAction: sceneContextForPrompt.sceneAction || sceneItem.sceneAction || "",
    summary: summaryLine,
    latest: contextLine,
    recent: recentTranscript,
    contextMode,
  });

  return {
    sceneContextForPrompt,
    cleanScenePrompt,
    summaryLine,
    contextLine,
    recentTranscript,
    identityBlock,
    draftedPrompts,
  };
};

module.exports = { buildIllustrationPromptContext };
