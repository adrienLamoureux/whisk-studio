import { buildApiUrl, fetchJson } from "./apiClient";

export const listPromptHelperOptions = (baseUrl: string) =>
  fetchJson(
    buildApiUrl(baseUrl, "/prompt-helper/options"),
    {},
    "Failed to load prompt helper options."
  );
