import { buildApiUrl, postJson } from "./apiClient";
import type { ApiPayload } from "../types/api";

export const generateHuggingFaceImage = (baseUrl: string, payload: ApiPayload) =>
  postJson(buildApiUrl(baseUrl, "/gradio/image/generate"), payload, "Failed to generate image.");
