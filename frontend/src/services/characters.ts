import { buildApiUrl, fetchJson, postJson, putJson, deleteJson } from "./apiClient";
import type { ApiPayload } from "../types/api";

export const listCharacters = (baseUrl: string) =>
  fetchJson(buildApiUrl(baseUrl, "/characters"), {}, "Failed to load characters.");

export const getCharacter = (baseUrl: string, characterId: string) =>
  fetchJson(
    buildApiUrl(baseUrl, `/characters/${encodeURIComponent(characterId)}`),
    {},
    "Failed to load character."
  );

export const createCharacter = (baseUrl: string, payload: ApiPayload) =>
  postJson(buildApiUrl(baseUrl, "/characters"), payload, "Failed to create character.");

export const updateCharacter = (baseUrl: string, characterId: string, payload: ApiPayload) =>
  putJson(
    buildApiUrl(baseUrl, `/characters/${encodeURIComponent(characterId)}`),
    payload,
    "Failed to update character."
  );

export const deleteCharacter = (baseUrl: string, characterId: string) =>
  deleteJson(
    buildApiUrl(baseUrl, `/characters/${encodeURIComponent(characterId)}`),
    "Failed to delete character."
  );
