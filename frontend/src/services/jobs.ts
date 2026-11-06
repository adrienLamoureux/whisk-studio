import { buildApiUrl, buildUrlWithQuery, fetchJson } from "./apiClient";

/**
 * The shared job feed — one question ("what is still running?") answered for
 * every media kind and provider, replacing the per-tab sessionStorage cache.
 */
export const listActiveJobs = (apiBaseUrl: string) =>
  fetchJson(
    buildUrlWithQuery(apiBaseUrl, "/jobs", { active: "1" }),
    {},
    "Failed to load active jobs."
  );

export const listJobs = (apiBaseUrl: string, { limit }: { limit?: number } = {}) =>
  fetchJson(buildUrlWithQuery(apiBaseUrl, "/jobs", { limit }), {}, "Failed to load jobs.");

export const getJob = (apiBaseUrl: string, jobId: string) =>
  fetchJson(buildApiUrl(apiBaseUrl, `/jobs/${encodeURIComponent(jobId)}`), {}, "Job not found.");
