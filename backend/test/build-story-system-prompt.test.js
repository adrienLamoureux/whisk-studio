"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { buildStorySystemPrompt } = require("../routes/story/build-story-system-prompt");

const baseArgs = {
  sessionItem: {
    protagonistName: "Frieren",
    summary: "The party crossed the valley.",
    worldPrompt: "fantasy countryside",
    stylePrompt: "anime cinematic",
  },
  resolvedLorebook: { overview: { tone: "gentle" } },
  resolvedStoryState: { flags: ["player-separated"], scene: { locationId: "road-valley" } },
  directorCue: { beat: "A fork in the road" },
  isPlayerSeparated: false,
};

test("prompt includes protagonist, summary, lorebook, state and cue", () => {
  const prompt = buildStorySystemPrompt(baseArgs);
  assert.ok(prompt.includes("Protagonist: Frieren."));
  assert.ok(prompt.includes("Story summary: The party crossed the valley."));
  assert.ok(prompt.includes('"tone":"gentle"'));
  assert.ok(prompt.includes('"locationId":"road-valley"'));
  assert.ok(prompt.includes('"beat":"A fork in the road"'));
  assert.ok(prompt.includes("World: fantasy countryside"));
  assert.ok(prompt.includes("Style: anime cinematic"));
});

test("prompt reflects separation mode and generalizes the off-screen rule", () => {
  const separated = buildStorySystemPrompt({ ...baseArgs, isPlayerSeparated: true });
  assert.ok(separated.includes("Player separation mode: separated."));
  const shared = buildStorySystemPrompt(baseArgs);
  assert.ok(shared.includes("Player separation mode: shared-scene."));
  // The off-screen rule follows the session protagonist, not a hardcoded name.
  const other = buildStorySystemPrompt({
    ...baseArgs,
    sessionItem: { ...baseArgs.sessionItem, protagonistName: "Aria" },
  });
  assert.ok(other.includes("If Aria acts away from the player"));
  assert.ok(!other.includes("Frieren"));
});

test("prompt defaults to 'New story.' when there is no summary yet", () => {
  const prompt = buildStorySystemPrompt({
    ...baseArgs,
    sessionItem: { ...baseArgs.sessionItem, summary: "" },
    directorCue: null,
  });
  assert.ok(prompt.includes("Story summary: New story."));
  assert.ok(prompt.includes("Director cue: none"));
});
