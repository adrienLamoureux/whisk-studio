import { buildApiUrl, buildUrlWithQuery, postJson, fetchJson } from "./apiClient";
import type { ApiPayload, QueryParams } from "../types/api";

export const generateReplicateImage = (baseUrl: string, payload: ApiPayload) =>
  postJson(buildApiUrl(baseUrl, "/replicate/image/generate"), payload, "Failed to generate image.");

export const generateReplicateVideo = (baseUrl: string, payload: ApiPayload) =>
  postJson(
    buildApiUrl(baseUrl, "/replicate/video/generate"),
    payload,
    "Failed to start video generation."
  );

export const getReplicateImageStatus = (baseUrl: string, params: QueryParams) =>
  fetchJson(
    buildUrlWithQuery(baseUrl, "/replicate/image/status", params),
    {},
    "Failed to fetch prediction status."
  );

export const getReplicateVideoStatus = (baseUrl: string, params: QueryParams) =>
  fetchJson(
    buildUrlWithQuery(baseUrl, "/replicate/video/status", params),
    {},
    "Failed to fetch prediction status."
  );
