/**
 * Resolves the protagonist character for a session and syncs the session's
 * stored protagonist prompt/name when the character identity has changed.
 */
const resolveSessionCharacter = async (deps, sessionItem) => {
  const {
    mediaTable,
    getItem,
    dynamoClient,
    PutCommand,
    ensureStoryCharacters,
    buildStoryCharacterPk,
    buildStoryCharacterSk,
  } = deps;

  const characters = await ensureStoryCharacters();
  const characterMap = new Map(characters.map((character) => [character.id, character]));
  const resolvedProtagonistId =
    sessionItem.protagonistId ||
    (sessionItem.protagonistName?.toLowerCase().includes("frieren") ? "frieren" : "");
  const characterItem = resolvedProtagonistId
    ? await getItem({
        pk: buildStoryCharacterPk(),
        sk: buildStoryCharacterSk(resolvedProtagonistId),
      })
    : null;
  const fallbackCharacter = characterMap.get(resolvedProtagonistId || "") || null;
  const resolvedCharacter = characterItem || fallbackCharacter || characters[0] || null;

  if (
    resolvedCharacter?.identityPrompt &&
    sessionItem.protagonistPrompt !== resolvedCharacter.identityPrompt
  ) {
    const updatedSession = {
      ...sessionItem,
      protagonistPrompt: resolvedCharacter.identityPrompt,
      protagonistName: resolvedCharacter.name || sessionItem.protagonistName,
      protagonistId: resolvedProtagonistId || resolvedCharacter.id || "",
      updatedAt: new Date().toISOString(),
    };
    await dynamoClient.send(new PutCommand({ TableName: mediaTable, Item: updatedSession }));
    sessionItem.protagonistPrompt = updatedSession.protagonistPrompt;
    sessionItem.protagonistName = updatedSession.protagonistName;
  }
  return resolvedCharacter;
};

module.exports = { resolveSessionCharacter };
