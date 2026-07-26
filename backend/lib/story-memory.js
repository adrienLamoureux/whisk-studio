/**
 * story-memory — rolling compaction for story session histories.
 *
 * Mirrors the companion/agent memory pattern: past SUMMARY_THRESHOLD turns,
 * the oldest COMPACT_WINDOW messages are condensed into the session's
 * `summary` field (the same field the turn prompt already consumes) and
 * deleted, so long stories keep verbatim recent context plus a growing
 * archived summary instead of an unbounded message list the model never sees.
 *
 * Uses the OBJECT `queryBySkPrefix({ pk, skPrefix, limit, scanForward })`
 * signature from media-store — not the positional form.
 *
 * Call `compactIfNeeded` fire-and-forget after the turn response is sent;
 * every failure path is swallowed so compaction can never break a turn.
 */

const { buildMediaPk, buildStorySessionSk, storyMessagePrefix } = require("./keys");

const SUMMARY_THRESHOLD = 30; // compact once a session passes this many turns
const COMPACT_WINDOW = 20; // oldest messages summarised + deleted per pass
const RECENT_KEEP = 8; // never touch the tail the turn handler loads

function createStoryMemory({
  dynamoClient,
  mediaTable,
  queryBySkPrefix,
  bedrockClient,
  InvokeModelCommand,
  promptHelperModelId,
  agentCost = null,
}) {
  if (!dynamoClient || !mediaTable) {
    return { compactIfNeeded: async () => {}, SUMMARY_THRESHOLD };
  }

  const { PutCommand, GetCommand, DeleteCommand } = require("@aws-sdk/lib-dynamodb");

  async function compactIfNeeded({ userId, sessionId, turnCount }) {
    try {
      if (!userId || !sessionId) return;
      if ((turnCount || 0) <= SUMMARY_THRESHOLD) return;

      const pk = buildMediaPk(userId);
      // Oldest first, and over-fetch by RECENT_KEEP so we can prove the
      // recent tail survives: only when more than COMPACT_WINDOW+RECENT_KEEP
      // messages exist do we delete the head window.
      const oldest = await queryBySkPrefix({
        pk,
        skPrefix: storyMessagePrefix(sessionId),
        limit: COMPACT_WINDOW + RECENT_KEEP,
        scanForward: true,
      });
      if (!oldest || oldest.length < COMPACT_WINDOW + RECENT_KEEP) return;
      const window = oldest.slice(0, COMPACT_WINDOW);

      const sessionKey = { pk, sk: buildStorySessionSk(sessionId) };
      const sessionRecord = await dynamoClient.send(
        new GetCommand({ TableName: mediaTable, Key: sessionKey })
      );
      const sessionItem = sessionRecord?.Item;
      if (!sessionItem) return;

      const transcript = window
        .map((m) => `${m.role === "user" ? "Player" : "Narrator"}: ${m.content}`)
        .join("\n");
      const priorSummary = sessionItem.summary || "";

      const command = new InvokeModelCommand({
        modelId: promptHelperModelId,
        contentType: "application/json",
        accept: "application/json",
        body: JSON.stringify({
          anthropic_version: "bedrock-2023-05-31",
          max_tokens: 250,
          temperature: 0.3,
          system:
            "You are a story archivist. Merge the existing summary with the transcript into 3-5 sentences, past tense. Preserve plot events, promises made, named NPCs, locations visited, and unresolved threads. Return only the merged summary.",
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: `Existing summary: ${priorSummary || "(none)"}\n\nTranscript:\n${transcript}`,
                },
              ],
            },
          ],
        }),
      });

      const resp = await bedrockClient.send(command);
      const body = JSON.parse(new TextDecoder().decode(resp.body));
      const mergedSummary = (body?.content || [])
        .map((c) => c?.text)
        .filter(Boolean)
        .join("")
        .trim();

      // Summariser tokens count against the user's daily cap, same as the
      // agent memory compactor. InvokeModel returns snake_case usage.
      if (agentCost?.record && userId) {
        const usage = body?.usage || {};
        const inputTokens = Number(usage.input_tokens ?? usage.inputTokens ?? 0);
        const outputTokens = Number(usage.output_tokens ?? usage.outputTokens ?? 0);
        if (inputTokens || outputTokens) {
          agentCost.record(userId, { inputTokens, outputTokens }).catch(() => {});
        }
      }

      // Never trade real history for an empty summary.
      if (!mergedSummary) return;

      await dynamoClient.send(
        new PutCommand({
          TableName: mediaTable,
          Item: {
            ...sessionItem,
            summary: mergedSummary,
            compactedAt: new Date().toISOString(),
          },
        })
      );

      await Promise.all(
        window.map((item) =>
          dynamoClient
            .send(new DeleteCommand({ TableName: mediaTable, Key: { pk, sk: item.sk } }))
            .catch(() => {})
        )
      );
    } catch {
      // Silent — compaction is best-effort and must never fail a turn.
    }
  }

  return { compactIfNeeded, SUMMARY_THRESHOLD };
}

module.exports = { createStoryMemory };
