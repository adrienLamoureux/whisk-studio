/**
 * Creates a pending "current moment" scene for a story session when the client
 * asks for an illustration with forceCurrent and no stored scene exists.
 */
const createCurrentScene = async (deps, { userId, sessionId, sessionItem }) => {
  const {
    mediaTable,
    buildMediaPk,
    buildStorySceneSk,
    queryBySkPrefix,
    storyMessagePrefix,
    buildSceneFragmentsFromStoryState,
    dedupeFragments,
    aiCraftSceneContext,
    normalizePromptFragment,
    dynamoClient,
    PutCommand,
  } = deps;

  const recentMessages = await queryBySkPrefix({
    pk: buildMediaPk(userId),
    skPrefix: storyMessagePrefix(sessionId),
    limit: 6,
    scanForward: false,
  });
  const latestAssistant = recentMessages.find((message) => message.role === "assistant");
  const stateScene = buildSceneFragmentsFromStoryState(
    sessionItem.storyState || {},
    sessionItem.worldPrompt || ""
  );
  const mergedEnvironment = dedupeFragments([...stateScene.environment]);
  const mergedAction = dedupeFragments([...stateScene.action]);
  const compactCurrentScene = await aiCraftSceneContext({
    scenePrompt: dedupeFragments([...mergedEnvironment, ...mergedAction]).join(", "),
    sceneEnvironment: mergedEnvironment.join(", "),
    sceneAction: mergedAction.join(", "),
    contextText: latestAssistant?.content || "",
    storyState: sessionItem.storyState || {},
    lorebook: sessionItem.lorebook || {},
  });
  const sceneId = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const sceneItem = {
    pk: buildMediaPk(userId),
    sk: buildStorySceneSk(sessionId, sceneId),
    type: "STORY_SCENE",
    sessionId,
    sceneId,
    title: "Current moment",
    description:
      normalizePromptFragment(latestAssistant?.content || "") ||
      `Current scene with ${sessionItem.protagonistName}.`,
    prompt: compactCurrentScene.scenePrompt,
    sceneEnvironment: compactCurrentScene.sceneEnvironment,
    sceneAction: compactCurrentScene.sceneAction,
    status: "pending",
    createdAt: new Date().toISOString(),
  };
  await dynamoClient.send(new PutCommand({ TableName: mediaTable, Item: sceneItem }));
  const updatedSession = {
    ...sessionItem,
    sceneCount: (sessionItem.sceneCount || 0) + 1,
    updatedAt: new Date().toISOString(),
  };
  await dynamoClient.send(new PutCommand({ TableName: mediaTable, Item: updatedSession }));
  sessionItem.sceneCount = updatedSession.sceneCount;
  sessionItem.updatedAt = updatedSession.updatedAt;
  return sceneItem;
};

module.exports = { createCurrentScene };
