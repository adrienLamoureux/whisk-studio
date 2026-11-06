import { buildApiUrl, buildUrlWithQuery, fetchJson, postJson } from "./apiClient";
import type { ApiPayload, QueryParams } from "../types/api";

export const generateCivitaiImage = (baseUrl: string, payload: ApiPayload) =>
  postJson(
    buildApiUrl(baseUrl, "/civitai/image/generate"),
    payload,
    "Failed to start CivitAI image generation."
  );

export const getCivitaiImageStatus = (baseUrl: string, params: QueryParams) =>
  fetchJson(
    buildUrlWithQuery(baseUrl, "/civitai/image/status", params),
    {},
    "Failed to fetch CivitAI job status."
  );
