const { DEFAULT_NEGATIVE_PROMPT } = require("./models");
const promptBackgrounds = require("../data/prompt-helper/backgrounds.json");
const promptPoses = require("../data/prompt-helper/poses.json");
const promptTraits = require("../data/prompt-helper/traits.json");
const promptFaceDetails = require("../data/prompt-helper/face-details.json");
const promptEyeDetails = require("../data/prompt-helper/eye-details.json");
const promptBreastSizes = require("../data/prompt-helper/breast-sizes.json");
const promptEars = require("../data/prompt-helper/ears.json");
const promptTails = require("../data/prompt-helper/tails.json");
const promptHorns = require("../data/prompt-helper/horns.json");
const promptWings = require("../data/prompt-helper/wings.json");
const promptHairStyles = require("../data/prompt-helper/hair-styles.json");
const promptViewDistance = require("../data/prompt-helper/view-distance.json");
const promptAccessories = require("../data/prompt-helper/accessories.json");
const promptMarkings = require("../data/prompt-helper/markings.json");
const promptOutfits = require("../data/prompt-helper/outfits.json");
const promptStyles = require("../data/prompt-helper/styles.json");

const buildPresetPrompt = (character) => {
  const parts = [];
  const push = (value) => {
    if (value) parts.push(value);
  };

  // 1) Shot range
  push(character.viewDistance);
  // 2) Environment / background
  push(character.background);
  // 3) Character block
  if (character.name) {
    parts.push("1girl, solo");
    push(character.outfitMaterials);
    const weight = typeof character.weight === "number" ? character.weight : 1.4;
    parts.push(`(${character.name}:${weight})`);
  }
  push(character.signatureTraits);
  // 4) Focus
  push(character.eyeDetails);
  push(character.pose);
  // 5) Face + features
  push(character.faceDetails);
  push(character.breastSize);
  push(character.ears);
  push(character.tails);
  push(character.horns);
  push(character.wings);
  push(character.hairStyles);
  push(character.accessories);
  push(character.markings);
  // 6) Clothes
  if (!character.name) {
    push(character.outfitMaterials);
  }
  // 7) Visuals
  push(character.styleReference);

  return parts.filter(Boolean).join(", ");
};

const withPresetPrompt = (character) => {
  const prompt = buildPresetPrompt(character);
  return {
    ...character,
    identityPrompt: prompt,
    storyBasePrompt: prompt,
  };
};

const storyCharacters = [
  withPresetPrompt({
    id: "frieren",
    name: "Frieren from Beyond Journey's End",
    weight: 1.5,
    viewDistance: "",
    background: "",
    signatureTraits: "official Frieren",
    eyeDetails: "",
    faceDetails: "",
    hairDetails: "",
    breastSize: "",
    ears: "",
    tails: "",
    horns: "",
    wings: "",
    hairStyles: "",
    accessories: "",
    markings: "",
    pose: "",
    outfitMaterials: "",
    styleReference: "tasteful anime design, character more detailed than background",
    storyNegativePrompt: DEFAULT_NEGATIVE_PROMPT,
  }),
];

const storyPresets = [
  {
    id: "frieren-road",
    name: "Frieren’s Road",
    synopsis:
      "A quiet journey across misty towns and open fields. Intimate conversations, reflective moments, and gentle adventure.",
    protagonistId: "frieren",
    worldPrompt:
      "fantasy countryside, soft winds, medieval villages, mossy stone roads, tranquil skies",
    stylePrompt:
      "anime cinematic illustration, soft pastel palette, luminous lighting, delicate line art, painterly shading",
    negativePrompt: DEFAULT_NEGATIVE_PROMPT,
    opening:
      "The road opens into a quiet valley, the wind carrying distant bells. Frieren walks ahead in thoughtful silence, then glances back with a small smile. “We can rest in the next village—or take the ridge and see the lakes at sunset. What feels right to you?”",
  },
  {
    id: "moonlit-tavern",
    name: "The Moonlit Tavern",
    synopsis:
      "Rain taps the windows of a warm tavern while a guarded traveler trades rumors about ancient ruins. Trust, secrets, and a choice to make before morning.",
    protagonistId: "frieren",
    worldPrompt:
      "cozy fantasy tavern at night, lantern light, wooden beams, rain on leaded windows, wet cobblestone streets outside",
    stylePrompt:
      "anime cinematic illustration, warm amber palette, chiaroscuro lantern lighting, delicate line art, painterly shading",
    negativePrompt: DEFAULT_NEGATIVE_PROMPT,
    opening:
      "Rain drums softly against the tavern windows as Frieren settles at a corner table, steam curling from her cup. Across the room, a hooded traveler keeps glancing your way. She follows your gaze and murmurs, “They've been watching us since we came in. Shall we invite them over—or enjoy the quiet a little longer?”",
  },
  {
    id: "celestial-ruins",
    name: "The Celestial Ruins",
    synopsis:
      "Ancient stones drift above the clouds, etched with starlit runes and guarded by a silent sentinel. A relic waits for those the ruins deem worthy.",
    protagonistId: "frieren",
    worldPrompt:
      "floating ancient ruins above the clouds at night, glowing star runes, suspended stone bridges, pale starlight, endless sky",
    stylePrompt:
      "anime cinematic illustration, cool celestial palette, luminous rune glow, delicate line art, painterly shading",
    negativePrompt: DEFAULT_NEGATIVE_PROMPT,
    opening:
      "The last stair crests the cloud line, and the ruins unfold above you—floating stones stitched together by threads of starlight. Frieren tilts her head, eyes reflecting the runes' slow pulse. “This magic is older than anything I've catalogued. The runes respond to intent... so, do we announce ourselves politely, or explore first and apologize later?”",
  },
];

const promptHelperDefaults = {
  backgrounds: promptBackgrounds,
  poses: promptPoses,
  traits: promptTraits,
  faceDetails: promptFaceDetails,
  eyeDetails: promptEyeDetails,
  breastSizes: promptBreastSizes,
  ears: promptEars,
  tails: promptTails,
  horns: promptHorns,
  wings: promptWings,
  hairStyles: promptHairStyles,
  viewDistance: promptViewDistance,
  accessories: promptAccessories,
  markings: promptMarkings,
  outfits: promptOutfits,
  styles: promptStyles,
};

const buildCharacterPrompt = (character) => {
  if (!character) return "";
  return buildPresetPrompt(character);
};

module.exports = {
  buildPresetPrompt,
  withPresetPrompt,
  storyCharacters,
  storyPresets,
  promptHelperDefaults,
  buildCharacterPrompt,
};
