import type { RuntimeConfig } from "../types/api";

const CONFIG_PATH = "/config.json";
const LOCALHOST_HOSTNAME = "localhost";

const asString = (value: unknown = "") => String(value || "").trim();

const shouldPreferEnvApiBaseUrl = ({
  envApiBaseUrl,
  hostname,
}: {
  envApiBaseUrl: string;
  hostname: string;
}) => Boolean(envApiBaseUrl) && asString(hostname) === LOCALHOST_HOSTNAME;

type FetchImpl = (url: string) => Promise<Response>;

const fetchJson = async (url: string, fetchImpl: FetchImpl = fetch) => {
  const response = await fetchImpl(url);
  if (!response.ok) {
    return null;
  }
  return response.json();
};

export const fetchRuntimeConfig = async (
  fetchImpl: FetchImpl = fetch
): Promise<RuntimeConfig | null> => {
  try {
    const payload = await fetchJson(CONFIG_PATH, fetchImpl);
    return payload && typeof payload === "object" ? (payload as RuntimeConfig) : null;
  } catch (_error) {
    return null;
  }
};

export const resolveApiBaseUrl = ({
  runtimeApiBaseUrl = "",
  envApiBaseUrl = "",
  hostname = "",
}: {
  runtimeApiBaseUrl?: string;
  envApiBaseUrl?: string;
  hostname?: string;
}): string => {
  const normalizedRuntimeApiBaseUrl = asString(runtimeApiBaseUrl);
  const normalizedEnvApiBaseUrl = asString(envApiBaseUrl);

  if (
    shouldPreferEnvApiBaseUrl({
      envApiBaseUrl: normalizedEnvApiBaseUrl,
      hostname,
    })
  ) {
    return normalizedEnvApiBaseUrl;
  }

  return normalizedRuntimeApiBaseUrl || normalizedEnvApiBaseUrl;
};
