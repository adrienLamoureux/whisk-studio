/** Shared types for the frontend service layer. */

/** A JSON request body. Callers own the exact shape; the service layer only serialises it. */
export type ApiPayload = Record<string, unknown>;

/** Query-string values. `undefined`, `null` and `""` are dropped when the URL is built. */
export type QueryValue = string | number | boolean | null | undefined;
export type QueryParams = Record<string, QueryValue>;

/** Error thrown by `fetchJson` for a non-2xx response. */
export interface ApiError extends Error {
  status?: number;
  /** Structured error code from the response body (`body.error`). */
  errorCode?: string;
  /** The parsed JSON error body, when the server sent one. */
  body?: unknown;
}

/** Subset of the runtime `/config.json` the app reads. */
export interface RuntimeConfig {
  apiBaseUrl?: string;
  [key: string]: unknown;
}
