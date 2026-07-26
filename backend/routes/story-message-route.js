const { buildStorySystemPrompt } = require("./story/build-story-system-prompt");

module.exports = (app, deps) => {
  const {
    mediaTable,
    getItem,
    buildMediaPk,
    buildStorySessionSk,
    buildStoryMessageSk,
    dynamoClient,
    PutCommand,
    queryBySkPrefix,
    storyMessagePrefix,
    resolveStoryLorebook,
    buildInitialStoryState,
    selectStoryEvent,
    InvokeModelCommand,
    storyModelId,
    bedrockClient,
    safeJsonParse,
    extractJsonStringField,
    applyStateDelta,
    updateStoryMeta,
    aiCraftSceneContext,
    buildSceneFragmentsFromStoryState,
    dedupeFragments,
    splitPromptFragments,
    buildStorySceneSk,
    storyMemory,
    DeleteCommand,
  } = deps;

  const parseBooleanLike = (value) => {
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (["true", "1", "yes", "y"].includes(normalized)) return true;
      if (["false", "0", "no", "n", ""].includes(normalized)) return false;
    }
    return false;
  };

  app.post("/story/sessions/:id/message", deps.requireUserMiddleware, async (req, res) => {
    const userId = req.user?.sub;
    const sessionId = req.params.id;
    const content = req.body?.content?.trim();
    // regenerate=true re-answers the last user turn: no new user message is
    // written and the previous assistant reply is removed from history.
    const regenerate = req.body?.regenerate === true;
    const debug = req.query?.debug === "true";
    if (!mediaTable) {
      return res.status(500).json({ message: "MEDIA_TABLE is not set" });
    }
    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    if (!sessionId) {
      return res.status(400).json({ message: "sessionId is required" });
    }
    if (!content && !regenerate) {
      return res.status(400).json({ message: "content is required" });
    }

    try {
      const sessionItem = await getItem({
        pk: buildMediaPk(userId),
        sk: buildStorySessionSk(sessionId),
      });
      if (!sessionItem) {
        return res.status(404).json({ message: "Session not found" });
      }

      const now = new Date().toISOString();
      const newTurnCount = regenerate
        ? sessionItem.turnCount || 1
        : (sessionItem.turnCount || 0) + 1;

      // Regenerate is a true re-roll: the previous attempt's effects must be
      // undone, not stacked on. `previousTurn` holds the pre-turn snapshot
      // written by every normal turn; without it (legacy sessions) we fall
      // back to current state, which is the old compounding behaviour.
      const rollback = regenerate ? sessionItem.previousTurn || null : null;
      const baseState = rollback || sessionItem;
      const lastIllustrationTurn = baseState.lastIllustrationTurn || 0;
      if (!regenerate) {
        const userMessageItem = {
          pk: buildMediaPk(userId),
          sk: buildStoryMessageSk(sessionId, Date.now()),
          type: "STORY_MESSAGE",
          sessionId,
          role: "user",
          content,
          createdAt: now,
        };
        await dynamoClient.send(
          new PutCommand({
            TableName: mediaTable,
            Item: userMessageItem,
          })
        );
      }

      const recentMessages = await queryBySkPrefix({
        pk: buildMediaPk(userId),
        skPrefix: storyMessagePrefix(sessionId),
        limit: 8,
        scanForward: false,
      });
      let orderedMessages = recentMessages.reverse();
      if (regenerate) {
        // Drop and delete the reply being regenerated so the model re-answers
        // the last user turn instead of continuing past its own old reply.
        const lastMessage = orderedMessages[orderedMessages.length - 1];
        if (lastMessage?.role === "assistant" && lastMessage?.sk) {
          orderedMessages = orderedMessages.slice(0, -1);
          await dynamoClient.send(
            new DeleteCommand({
              TableName: mediaTable,
              Key: { pk: buildMediaPk(userId), sk: lastMessage.sk },
            })
          );
          // The discarded reply's scene would otherwise be orphaned: still in
          // the table, counted in sceneCount, with an image job nobody polls.
          if (lastMessage.sceneId) {
            await dynamoClient.send(
              new DeleteCommand({
                TableName: mediaTable,
                Key: {
                  pk: buildMediaPk(userId),
                  sk: buildStorySceneSk(sessionId, lastMessage.sceneId),
                },
              })
            );
          }
        }
        const hasUserTurn = orderedMessages.some((message) => message.role === "user");
        if (!hasUserTurn) {
          return res.status(400).json({ message: "Nothing to regenerate yet" });
        }
      }
      const lorebookSeed = {
        id: sessionItem.presetId,
        name: sessionItem.title,
        synopsis: sessionItem.synopsis,
        worldPrompt: sessionItem.worldPrompt,
        opening: sessionItem.opening,
        lorebook: sessionItem.lorebook,
      };
      const resolvedLorebook =
        sessionItem.lorebook || resolveStoryLorebook(lorebookSeed, sessionItem.protagonistName);
      const resolvedStoryState = baseState.storyState || buildInitialStoryState(resolvedLorebook);
      const directorSelection = selectStoryEvent(
        resolvedLorebook,
        resolvedStoryState,
        newTurnCount
      );
      const directorCue = directorSelection.cue;
      const isPlayerSeparated = (resolvedStoryState.flags || []).includes("player-separated");

      const systemPrompt = buildStorySystemPrompt({
        sessionItem,
        resolvedLorebook,
        resolvedStoryState,
        directorCue,
        isPlayerSeparated,
      });

      const messagePayload = orderedMessages.map((message) => ({
        role: message.role,
        content: [{ type: "text", text: message.content }],
      }));

      const invokeStoryModel = async () => {
        const command = new InvokeModelCommand({
          modelId: storyModelId,
          contentType: "application/json",
          accept: "application/json",
          body: JSON.stringify({
            anthropic_version: "bedrock-2023-05-31",
            max_tokens: 600,
            temperature: 0.7,
            system: systemPrompt,
            messages: messagePayload,
          }),
        });
        const response = await bedrockClient.send(command);
        const responseBody = JSON.parse(new TextDecoder().decode(response.body));
        return (responseBody?.content || [])
          .map((item) => item?.text)
          .filter(Boolean)
          .join("")
          .trim();
      };

      const hasUsableReply = (candidate, text) =>
        (typeof candidate.reply === "string" && candidate.reply.trim().length > 0) ||
        Boolean(extractJsonStringField(text, "reply"));

      let responseText = await invokeStoryModel();
      let parsed = safeJsonParse(responseText) || {};
      // One bounded same-params retry when the output carries no usable reply
      // — previously a malformed turn silently degraded with no second chance.
      let degraded = false;
      if (!hasUsableReply(parsed, responseText)) {
        responseText = await invokeStoryModel();
        parsed = safeJsonParse(responseText) || {};
        if (!hasUsableReply(parsed, responseText)) {
          degraded = true;
          console.warn("Story model output unparseable after retry", {
            sessionId,
            userId,
            turnCount: newTurnCount,
          });
        }
      }

      const extractedReply =
        typeof parsed.reply === "string" && parsed.reply.trim().length > 0
          ? ""
          : extractJsonStringField(responseText, "reply");
      const replyText = parsed.reply || extractedReply || responseText || "The story continues.";
      const modelSummary =
        typeof parsed.summary === "string" && parsed.summary.trim().length > 0
          ? parsed.summary.trim()
          : "";
      if (!modelSummary && !degraded) {
        // Observable, not fatal — the turn keeps the previous summary, but a
        // model that stops updating summaries erodes long-story coherence.
        console.warn("Story model omitted summary; keeping previous", {
          sessionId,
          turnCount: newTurnCount,
        });
      }
      const nextSummary = modelSummary || baseState.summary || "";
      const sceneBeat = parseBooleanLike(parsed.sceneBeat);
      const sceneTitle = parsed.sceneTitle?.trim() || "";
      const sceneDescription = parsed.sceneDescription?.trim() || "";
      let scenePrompt = parsed.scenePrompt?.trim() || "";
      let sceneEnvironment = parsed.sceneEnvironment?.trim() || "";
      let sceneAction = parsed.sceneAction?.trim() || "";
      const rawStateDelta = parsed.stateDelta;
      const stateDelta = rawStateDelta && typeof rawStateDelta === "object" ? rawStateDelta : {};

      let nextStoryState = applyStateDelta(
        resolvedStoryState,
        directorSelection.event?.effects || {}
      );
      nextStoryState = applyStateDelta(nextStoryState, stateDelta);
      nextStoryState.meta = updateStoryMeta(
        nextStoryState,
        directorSelection.event,
        newTurnCount,
        directorSelection.recentLimit
      );

      const locationChanged = Boolean(
        stateDelta?.scene?.locationId ||
        stateDelta?.scene?.locationName ||
        stateDelta?.scene?.description
      );
      const eventType = directorSelection.event?.type;
      const turnsSinceIllustration = newTurnCount - lastIllustrationTurn;
      const shouldAutoIllustrate = turnsSinceIllustration >= 2;
      const shouldForceScene =
        locationChanged ||
        eventType === "environment" ||
        eventType === "discovery" ||
        eventType === "npc" ||
        eventType === "choice" ||
        shouldAutoIllustrate;
      let hasSceneVisual =
        Boolean(scenePrompt) || Boolean(sceneEnvironment) || Boolean(sceneAction);
      const hadModelSceneVisual = hasSceneVisual;
      let sceneWasCompacted = false;
      let sceneCompactionFailed = false;
      let sceneDebugReason = "";
      if (!hasSceneVisual && shouldForceScene) {
        const aiSeedScene = await aiCraftSceneContext({
          scenePrompt,
          sceneEnvironment,
          sceneAction,
          contextText: replyText,
          storyState: nextStoryState,
          lorebook: resolvedLorebook,
        });
        scenePrompt = aiSeedScene.scenePrompt;
        sceneEnvironment = aiSeedScene.sceneEnvironment;
        sceneAction = aiSeedScene.sceneAction;
        hasSceneVisual = Boolean(scenePrompt) || Boolean(sceneEnvironment) || Boolean(sceneAction);
        sceneWasCompacted = hasSceneVisual;
      }
      if (!hasSceneVisual && shouldForceScene) {
        sceneCompactionFailed = true;
        sceneDebugReason =
          "Scene compaction returned no visual fragments; illustration skipped for this turn.";
        console.warn("Story scene compaction empty output", {
          sessionId,
          userId,
          turnCount: newTurnCount,
          locationChanged,
          eventType: eventType || "",
        });
      }
      if (locationChanged && hasSceneVisual) {
        const stateScene = buildSceneFragmentsFromStoryState(
          nextStoryState,
          sessionItem.worldPrompt
        );
        sceneEnvironment = dedupeFragments([
          ...splitPromptFragments(sceneEnvironment),
          ...stateScene.environment,
        ]).join(", ");
        sceneAction = dedupeFragments([
          ...splitPromptFragments(sceneAction),
          ...stateScene.action,
        ]).join(", ");
        scenePrompt = dedupeFragments([
          ...splitPromptFragments(scenePrompt),
          ...stateScene.environment,
          ...stateScene.action,
        ]).join(", ");
        hasSceneVisual = Boolean(scenePrompt) || Boolean(sceneEnvironment) || Boolean(sceneAction);
        sceneWasCompacted = false;
      }
      if (hasSceneVisual && !sceneWasCompacted) {
        const compactScene = await aiCraftSceneContext({
          scenePrompt,
          sceneEnvironment,
          sceneAction,
          contextText: replyText,
          storyState: nextStoryState,
          lorebook: resolvedLorebook,
        });
        scenePrompt = compactScene.scenePrompt;
        sceneEnvironment = compactScene.sceneEnvironment;
        sceneAction = compactScene.sceneAction;
        hasSceneVisual = Boolean(scenePrompt) || Boolean(sceneEnvironment) || Boolean(sceneAction);
        sceneWasCompacted = true;
      }

      let scene = null;
      let nextSceneCount = baseState.sceneCount || 0;
      const isSituationIllustration =
        locationChanged || eventType === "environment" || eventType === "discovery";
      const isCadenceIllustration = shouldAutoIllustrate;
      const shouldIllustrate =
        hasSceneVisual && (sceneBeat || isSituationIllustration || isCadenceIllustration);
      if (!shouldIllustrate && !sceneDebugReason) {
        sceneDebugReason = hasSceneVisual
          ? "Illustration gating not met (sceneBeat/situation/cadence)."
          : "No scene visual available for illustration.";
      }

      if (shouldIllustrate) {
        const sceneId = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const sceneItem = {
          pk: buildMediaPk(userId),
          sk: buildStorySceneSk(sessionId, sceneId),
          type: "STORY_SCENE",
          sessionId,
          sceneId,
          title: sceneTitle,
          description: sceneDescription,
          prompt: scenePrompt,
          sceneEnvironment,
          sceneAction,
          status: "pending",
          createdAt: new Date().toISOString(),
        };
        await dynamoClient.send(
          new PutCommand({
            TableName: mediaTable,
            Item: sceneItem,
          })
        );
        nextSceneCount += 1;
        scene = {
          sceneId,
          title: sceneTitle,
          description: sceneDescription,
          prompt: scenePrompt,
          sceneEnvironment,
          sceneAction,
          status: "pending",
        };
      }

      // Persisted after the scene decision so the message can carry its
      // sceneId — the frontend then pairs message↔scene by id instead of the
      // fragile nearest-timestamp heuristic (kept only for legacy sessions).
      const assistantMessageItem = {
        pk: buildMediaPk(userId),
        sk: buildStoryMessageSk(sessionId, Date.now() + 1),
        type: "STORY_MESSAGE",
        sessionId,
        role: "assistant",
        content: replyText,
        ...(scene ? { sceneId: scene.sceneId } : {}),
        createdAt: new Date().toISOString(),
      };
      await dynamoClient.send(
        new PutCommand({
          TableName: mediaTable,
          Item: assistantMessageItem,
        })
      );

      const updatedSession = {
        ...sessionItem,
        summary: nextSummary,
        lorebook: resolvedLorebook,
        storyState: nextStoryState,
        turnCount: newTurnCount,
        sceneCount: nextSceneCount,
        lastIllustrationTurn: shouldIllustrate ? newTurnCount : lastIllustrationTurn,
        // Snapshot of the state this turn started from, so Regenerate can roll
        // back instead of compounding. Preserved untouched across repeated
        // regenerates so every re-roll starts from the same base.
        previousTurn: regenerate
          ? sessionItem.previousTurn || null
          : {
              storyState: resolvedStoryState,
              sceneCount: baseState.sceneCount || 0,
              lastIllustrationTurn,
              summary: baseState.summary || "",
            },
        updatedAt: new Date().toISOString(),
      };

      await dynamoClient.send(
        new PutCommand({
          TableName: mediaTable,
          Item: updatedSession,
        })
      );

      // Fire-and-forget: past the threshold, condense the oldest messages
      // into the session summary (never awaited in the response path).
      if (storyMemory?.compactIfNeeded) {
        storyMemory.compactIfNeeded({ userId, sessionId, turnCount: newTurnCount }).catch(() => {});
      }

      res.json({
        sessionId,
        turnCount: newTurnCount,
        storyState: nextStoryState,
        lorebook: resolvedLorebook,
        summary: nextSummary,
        assistant: {
          role: "assistant",
          content: replyText,
        },
        scene,
        ...(degraded ? { degraded: true } : {}),
        ...(sceneCompactionFailed || debug
          ? {
              sceneDebug: {
                hadModelSceneVisual,
                shouldForceScene,
                locationChanged,
                eventType: eventType || "",
                turnsSinceIllustration,
                shouldAutoIllustrate,
                hasSceneVisual,
                sceneWasCompacted,
                shouldIllustrate,
                reason: sceneDebugReason,
              },
            }
          : {}),
      });
    } catch (error) {
      console.error("Story message error:", {
        message: error?.message || String(error),
      });
      res.status(500).json({
        message: "Failed to process story message",
        error: error?.message || String(error),
      });
    }
  });
};
