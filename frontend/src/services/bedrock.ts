import { buildApiUrl, buildUrlWithQuery, fetchJson, postJson } from "./apiClient";
import type { ApiPayload, QueryParams } from "../types/api";

export const fetchApiStatus = (baseUrl: string) =>
  fetchJson(buildApiUrl(baseUrl, "/"), {}, "Failed to load API status.");

export const generateBedrockImage = (baseUrl: string, payload: ApiPayload) =>
  postJson(buildApiUrl(baseUrl, "/bedrock/image/generate"), payload, "Failed to generate image.");

export const generatePromptHelper = (baseUrl: string, payload: ApiPayload) =>
  postJson(buildApiUrl(baseUrl, "/bedrock/prompt-helper"), payload, "Prompt helper failed.");

export const generateNovaReelVideo = (baseUrl: string, payload: ApiPayload) =>
  postJson(
    buildApiUrl(baseUrl, "/bedrock/nova-reel/image-to-video-s3"),
    payload,
    "Failed to start video generation."
  );

export const getNovaReelJobStatus = (baseUrl: string, params: QueryParams) =>
  fetchJson(
    buildUrlWithQuery(baseUrl, "/bedrock/nova-reel/job-status", params),
    {},
    "Failed to fetch job status."
  );
