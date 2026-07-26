// Single source of truth for which story presets are exposed to users.
// Consumed by both session-routes.js (create validation) and seed-routes.js
// (preset listing) — keep it here so the two can never drift apart.
const ACTIVE_STORY_PRESET_IDS = new Set(["frieren-road", "moonlit-tavern", "celestial-ruins"]);

const filterActiveStoryPresets = (presets = []) =>
  presets.filter((preset) => ACTIVE_STORY_PRESET_IDS.has(preset?.id));

module.exports = {
  ACTIVE_STORY_PRESET_IDS,
  filterActiveStoryPresets,
};
