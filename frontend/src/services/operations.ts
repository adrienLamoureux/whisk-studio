import {
  buildApiUrl,
  buildUrlWithQuery,
  fetchJson,
  postJson,
  putJson,
  deleteJson,
} from "./apiClient";
import type { ApiPayload } from "../types/api";

export const fetchOperationalDashboard = async (apiBaseUrl: string) => {
  const url = buildApiUrl(apiBaseUrl, "/ops/dashboard");
  return fetchJson(url, {}, "Failed to load operational dashboard.");
};

export const fetchDirectorOverview = async (apiBaseUrl: string) => {
  const url = buildApiUrl(apiBaseUrl, "/ops/director/overview");
  return fetchJson(url, {}, "Failed to load director overview.");
};

export const fetchDirectorConfig = async (apiBaseUrl: string) => {
  const url = buildApiUrl(apiBaseUrl, "/ops/director/config");
  return fetchJson(url, {}, "Failed to load director config.");
};

export const saveDirectorConfig = async (apiBaseUrl: string, payload: ApiPayload) => {
  const url = buildApiUrl(apiBaseUrl, "/ops/director/config");
  return postJson(url, payload, "Failed to save director config.");
};

export const prioritizeDirectorJob = async (apiBaseUrl: string, payload: ApiPayload) => {
  const url = buildApiUrl(apiBaseUrl, "/ops/director/jobs/prioritize");
  return postJson(url, payload, "Failed to prioritize job.");
};

export const pinDirectorStorySession = async (apiBaseUrl: string, payload: ApiPayload) => {
  const url = buildApiUrl(apiBaseUrl, "/ops/director/story/sessions/pin");
  return postJson(url, payload, "Failed to update story session pin.");
};

export const normalizeDirectorSoundMetadata = async (
  apiBaseUrl: string,
  payload: ApiPayload = {}
) => {
  const url = buildApiUrl(apiBaseUrl, "/ops/director/sound/normalize");
  return postJson(url, payload, "Failed to normalize sound metadata.");
};

export const fetchDirectorAppConfig = async (apiBaseUrl: string) => {
  const url = buildApiUrl(apiBaseUrl, "/ops/director/app-config");
  return fetchJson(url, {}, "Failed to load app config.");
};

export const saveDirectorAppConfig = async (apiBaseUrl: string, payload: ApiPayload) => {
  const url = buildApiUrl(apiBaseUrl, "/ops/director/app-config");
  return postJson(url, payload, "Failed to save app config.");
};

export const listDirectorMasonryImages = async (apiBaseUrl: string) => {
  const url = buildApiUrl(apiBaseUrl, "/ops/director/masonry/images");
  return fetchJson(url, {}, "Failed to load masonry images.");
};

export const requestDirectorMasonryUploadUrl = async (apiBaseUrl: string, payload: ApiPayload) => {
  const url = buildApiUrl(apiBaseUrl, "/ops/director/masonry/upload-url");
  return postJson(url, payload, "Failed to request masonry upload URL.");
};

export const deleteDirectorMasonryImage = async (apiBaseUrl: string, payload: ApiPayload) => {
  const url = buildApiUrl(apiBaseUrl, "/ops/director/masonry/images/delete");
  return postJson(url, payload, "Failed to delete masonry image.");
};

export const fetchDashboard = async (apiBaseUrl: string) => {
  const url = buildApiUrl(apiBaseUrl, "/ops/dashboard");
  return fetchJson(url, {}, "Failed to load dashboard.");
};

export const fetchCompanionModel = async (apiBaseUrl: string) => {
  const url = buildApiUrl(apiBaseUrl, "/api/admin/companion-model");
  return fetchJson(url, {}, "Failed to load companion model.");
};

export const saveCompanionModel = async (apiBaseUrl: string, { modelId }: { modelId: string }) => {
  const url = buildApiUrl(apiBaseUrl, "/api/admin/companion-model");
  return putJson(url, { modelId }, "Failed to save companion model.");
};

export const retryDirectorJob = async (apiBaseUrl: string, { jobKey }: { jobKey: string }) => {
  const url = buildApiUrl(apiBaseUrl, "/ops/director/jobs/retry");
  return postJson(url, { jobKey }, "Failed to retry job.");
};

export const cancelDirectorJob = async (apiBaseUrl: string, { jobKey }: { jobKey: string }) => {
  const url = buildApiUrl(apiBaseUrl, "/ops/director/jobs/cancel");
  return postJson(url, { jobKey }, "Failed to cancel job.");
};

export const fetchAllStorySessions = async (
  apiBaseUrl: string,
  { limit = 100 }: { limit?: number } = {}
) => {
  const url = buildUrlWithQuery(apiBaseUrl, "/ops/director/story/sessions/all", { limit });
  return fetchJson(url, {}, "Failed to load all story sessions.");
};

export const fetchCompanionMemory = async (
  apiBaseUrl: string,
  { userId, modelId }: { userId: string; modelId: string }
) => {
  const url = buildUrlWithQuery(apiBaseUrl, "/ops/director/companion/memory", { userId, modelId });
  return fetchJson(url, {}, "Failed to load companion memory.");
};

export const clearCompanionMemoryAdmin = async (
  apiBaseUrl: string,
  { userId, modelId }: { userId: string; modelId: string }
) => {
  const url = buildUrlWithQuery(apiBaseUrl, "/ops/director/companion/memory", { userId, modelId });
  return deleteJson(url, "Failed to clear companion memory.");
};

export const fetchDirectorUsage = async (
  apiBaseUrl: string,
  { window: w = "24h" }: { window?: string } = {}
) => {
  const url = buildUrlWithQuery(apiBaseUrl, "/ops/director/usage", { window: w });
  return fetchJson(url, {}, "Failed to load usage data.");
};

export const listSharedImagesAdmin = async (
  apiBaseUrl: string,
  { limit = 120, continuationToken }: { limit?: number; continuationToken?: string } = {}
) => {
  const url = buildUrlWithQuery(apiBaseUrl, "/ops/director/media/shared/images", {
    limit,
    continuationToken,
  });
  return fetchJson(url, {}, "Failed to list shared images.");
};

export const deleteSharedImageAdmin = async (apiBaseUrl: string, { key }: { key: string }) => {
  const url = buildApiUrl(apiBaseUrl, "/ops/director/media/shared/images/delete");
  return postJson(url, { key }, "Failed to delete shared image.");
};

export const listSharedVideosAdmin = async (
  apiBaseUrl: string,
  { limit = 120, continuationToken }: { limit?: number; continuationToken?: string } = {}
) => {
  const url = buildUrlWithQuery(apiBaseUrl, "/ops/director/media/shared/videos", {
    limit,
    continuationToken,
  });
  return fetchJson(url, {}, "Failed to list shared videos.");
};

export const deleteSharedVideoAdmin = async (apiBaseUrl: string, { key }: { key: string }) => {
  const url = buildApiUrl(apiBaseUrl, "/ops/director/media/shared/videos/delete");
  return postJson(url, { key }, "Failed to delete shared video.");
};

export const fetchFeatureFlags = async (apiBaseUrl: string) => {
  const url = buildApiUrl(apiBaseUrl, "/ops/director/features");
  return fetchJson(url, {}, "Failed to load feature flags.");
};

export const saveFeatureFlags = async (
  apiBaseUrl: string,
  { flags }: { flags: Record<string, boolean> }
) => {
  const url = buildApiUrl(apiBaseUrl, "/ops/director/features");
  return putJson(url, { flags }, "Failed to save feature flags.");
};

export const fetchAgentCost = async (
  apiBaseUrl: string,
  { limit = 50 }: { limit?: number } = {}
) => {
  const url = buildApiUrl(apiBaseUrl, `/api/admin/agent/cost?limit=${encodeURIComponent(limit)}`);
  return fetchJson(url, {}, "Failed to load agent cost telemetry.");
};

export const fetchAgentModel = async (apiBaseUrl: string) => {
  const url = buildApiUrl(apiBaseUrl, "/api/admin/agent/model");
  return fetchJson(url, {}, "Failed to load agent model.");
};

export const saveAgentModel = async (apiBaseUrl: string, modelId: string) => {
  const url = buildApiUrl(apiBaseUrl, "/api/admin/agent/model");
  return putJson(url, { modelId }, "Failed to save agent model.");
};
