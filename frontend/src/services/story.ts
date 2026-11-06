import { buildApiUrl, buildUrlWithQuery, fetchJson, postJson, deleteJson } from "./apiClient";
import type { ApiPayload, QueryParams } from "../types/api";

export const listStoryPresets = (baseUrl: string) =>
  fetchJson(buildApiUrl(baseUrl, "/story/presets"), {}, "Failed to load story presets.");

export const listStorySessions = (baseUrl: string) =>
  fetchJson(buildApiUrl(baseUrl, "/story/sessions"), {}, "Failed to load story sessions.");

export const listStoryCharacters = (baseUrl: string) =>
  fetchJson(buildApiUrl(baseUrl, "/story/characters"), {}, "Failed to load story characters.");

export const createStorySession = (baseUrl: string, payload: ApiPayload) =>
  postJson(buildApiUrl(baseUrl, "/story/sessions"), payload, "Failed to create story session.");

export const getStorySession = (baseUrl: string, sessionId: string) =>
  fetchJson(
    buildApiUrl(baseUrl, `/story/sessions/${sessionId}`),
    {},
    "Failed to load story session."
  );

export const sendStoryMessage = (baseUrl: string, sessionId: string, payload: ApiPayload) =>
  postJson(
    buildApiUrl(baseUrl, `/story/sessions/${sessionId}/message`),
    payload,
    "Failed to send message."
  );

export const generateStoryIllustration = (
  baseUrl: string,
  sessionId: string,
  payload: ApiPayload,
  options: { debug?: boolean } = {}
) =>
  postJson(
    buildApiUrl(
      baseUrl,
      `/story/sessions/${sessionId}/illustrations${options.debug ? "?debug=true" : ""}`
    ),
    payload,
    "Failed to generate illustration."
  );

export const startStorySceneAnimation = (
  baseUrl: string,
  sessionId: string,
  sceneId: string,
  payload: ApiPayload
) =>
  postJson(
    buildApiUrl(baseUrl, `/story/sessions/${sessionId}/scenes/${sceneId}/animation`),
    payload,
    "Failed to start scene animation."
  );

export const getStorySceneAnimationStatus = (
  baseUrl: string,
  sessionId: string,
  sceneId: string,
  params: QueryParams = {}
) =>
  fetchJson(
    buildUrlWithQuery(baseUrl, `/story/sessions/${sessionId}/scenes/${sceneId}/animation`, params),
    {},
    "Failed to fetch scene animation status."
  );

export const startStorySceneMusic = (
  baseUrl: string,
  sessionId: string,
  sceneId: string,
  payload: ApiPayload
) =>
  postJson(
    buildApiUrl(baseUrl, `/story/sessions/${sessionId}/scenes/${sceneId}/music`),
    payload,
    "Failed to start scene music generation."
  );

export const getStorySceneMusicStatus = (
  baseUrl: string,
  sessionId: string,
  sceneId: string,
  params: QueryParams = {}
) =>
  fetchJson(
    buildUrlWithQuery(baseUrl, `/story/sessions/${sessionId}/scenes/${sceneId}/music`, params),
    {},
    "Failed to fetch scene music status."
  );

export const saveStorySceneMusicToLibrary = (
  baseUrl: string,
  sessionId: string,
  sceneId: string,
  payload: ApiPayload = {}
) =>
  postJson(
    buildApiUrl(baseUrl, `/story/sessions/${sessionId}/scenes/${sceneId}/music/favorite`),
    payload,
    "Failed to save soundtrack to library."
  );

export const recommendStorySceneMusic = (baseUrl: string, sessionId: string, sceneId: string) =>
  postJson(
    buildApiUrl(baseUrl, `/story/sessions/${sessionId}/scenes/${sceneId}/music/recommend`),
    {},
    "Failed to recommend soundtrack for scene."
  );

export const listStoryMusicLibrary = (baseUrl: string, params: QueryParams = {}) =>
  fetchJson(
    buildUrlWithQuery(baseUrl, "/story/music-library", params),
    {},
    "Failed to load soundtrack library."
  );

export const requestStoryMusicUploadUrl = (baseUrl: string, payload: ApiPayload) =>
  postJson(
    buildApiUrl(baseUrl, "/story/music-library/upload-url"),
    payload,
    "Failed to request music upload URL."
  );

export const saveUploadedStoryMusicTrack = (baseUrl: string, payload: ApiPayload) =>
  postJson(
    buildApiUrl(baseUrl, "/story/music-library/upload"),
    payload,
    "Failed to save uploaded music track."
  );

export const selectStorySceneLibraryTrack = (
  baseUrl: string,
  sessionId: string,
  sceneId: string,
  payload: ApiPayload
) =>
  postJson(
    buildApiUrl(baseUrl, `/story/sessions/${sessionId}/scenes/${sceneId}/music/select`),
    payload,
    "Failed to apply soundtrack from library."
  );

export const deleteStorySession = (baseUrl: string, sessionId: string) =>
  deleteJson(
    buildApiUrl(baseUrl, `/story/sessions/${sessionId}`),
    "Failed to delete story session."
  );

// Switch the LoRA profile on an active story session without changing the character.
export const switchSessionLora = (
  baseUrl: string,
  sessionId: string,
  loraProfileId: string | null | undefined
) =>
  fetchJson(
    buildApiUrl(baseUrl, `/story/sessions/${sessionId}/lora`),
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ loraProfileId: loraProfileId || null }),
    },
    "Failed to switch session LoRA profile."
  );
