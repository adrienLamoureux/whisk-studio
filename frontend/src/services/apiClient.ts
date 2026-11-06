import { getAuthToken } from "../utils/authTokens";
import type { ApiError, ApiPayload, QueryParams } from "../types/api";

export const normalizeBaseUrl = (baseUrl: string = "") => baseUrl.replace(/\/+$/, "");

export const buildApiUrl = (baseUrl: string | undefined, path = "") => {
  if (!baseUrl) return path || "";
  const trimmed = normalizeBaseUrl(baseUrl);
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${trimmed}${suffix}`;
};

export const buildUrlWithQuery = (
  baseUrl: string | undefined,
  path: string,
  params: QueryParams = {}
) => {
  const url = buildApiUrl(baseUrl, path);
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    search.append(key, String(value));
  });
  const query = search.toString();
  return query ? `${url}?${query}` : url;
};

type FetchOptions = Omit<RequestInit, "headers"> & { headers?: Record<string, string> };

const withAuthHeaders = (headers: Record<string, string> = {}): Record<string, string> => {
  const token = getAuthToken();
  if (!token) return headers;
  return { ...headers, Authorization: `Bearer ${token}` };
};

export const fetchJson = async (
  url: string,
  options: FetchOptions = {},
  errorMessage?: string
): Promise<any> => {
  // Response shapes vary per endpoint and are not modelled yet, so the parsed JSON is `any`.
  const response = await fetch(url, {
    ...options,
    headers: withAuthHeaders(options.headers || {}),
  });
  let data: any = null;
  try {
    data = await response.json();
  } catch (err) {
    data = null;
  }
  if (response.status === 401) {
    window.dispatchEvent(new CustomEvent("whisk:auth:expired"));
  }
  if (!response.ok) {
    // Attach status + structured error code so callers can branch on them
    // (e.g. distinguishing "feature disabled" 404 from a transient network
    // failure that surfaces as the same generic "Request failed." message).
    const err: ApiError = new Error(data?.message || errorMessage || "Request failed.");
    err.status = response.status;
    if (data?.error) err.errorCode = data.error;
    if (data) err.body = data;
    throw err;
  }
  return data;
};

export const postJson = (url: string, payload: ApiPayload, errorMessage?: string) =>
  fetchJson(
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    errorMessage
  );

export const putJson = (url: string, payload: ApiPayload, errorMessage?: string) =>
  fetchJson(
    url,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    errorMessage
  );

export const deleteJson = (url: string, errorMessage?: string) =>
  fetchJson(
    url,
    {
      method: "DELETE",
    },
    errorMessage
  );
