const { Router } = require("express");
const { filterActiveStoryPresets } = require("./active-presets");

module.exports = function registerStorySeedRoutes(deps) {
  const { mediaTable, ensureStoryPresets, ensureStoryCharacters, storyPresets } = deps;

  const router = Router();

  router.get("/presets", async (req, res) => {
    if (!mediaTable) {
      return res.status(500).json({ message: "MEDIA_TABLE is not set" });
    }
    try {
      const ensuredPresets = await ensureStoryPresets();
      const presets = filterActiveStoryPresets(
        ensuredPresets.length ? ensuredPresets : storyPresets
      );
      const characters = await ensureStoryCharacters();
      const characterMap = new Map(characters.map((character) => [character.id, character]));
      res.json({
        presets: presets.map((preset) => ({
          id: preset.id,
          name: preset.name,
          synopsis: preset.synopsis,
          protagonistName:
            characterMap.get(preset.protagonistId || "")?.name || preset.protagonistName || "",
          stylePrompt: preset.stylePrompt,
          opening: preset.opening,
        })),
      });
    } catch (error) {
      res.status(500).json({
        message: "Failed to load story presets",
        error: error?.message || String(error),
      });
    }
  });

  router.get("/characters", async (req, res) => {
    if (!mediaTable) {
      return res.status(500).json({ message: "MEDIA_TABLE is not set" });
    }
    try {
      const characters = await ensureStoryCharacters();
      res.json({
        characters: characters.map((character) => ({
          id: character.id,
          name: character.name,
          weight: character.weight,
          signatureTraits: character.signatureTraits,
          faceDetails: character.faceDetails,
          eyeDetails: character.eyeDetails,
          hairDetails: character.hairDetails,
          ears: character.ears,
          tails: character.tails,
          horns: character.horns,
          wings: character.wings,
          hairStyles: character.hairStyles,
          viewDistance: character.viewDistance,
          accessories: character.accessories,
          markings: character.markings,
          background: character.background,
          pose: character.pose,
          outfitMaterials: character.outfitMaterials,
          styleReference: character.styleReference,
          identityPrompt: character.identityPrompt,
          storyBasePrompt: character.storyBasePrompt,
          storyNegativePrompt: character.storyNegativePrompt,
        })),
      });
    } catch (error) {
      res.status(500).json({
        message: "Failed to load story characters",
        error: error?.message || String(error),
      });
    }
  });

  return router;
};
