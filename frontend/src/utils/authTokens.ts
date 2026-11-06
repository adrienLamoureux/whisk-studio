const TOKEN_STORAGE_KEY = "whisk_auth_tokens";

/** Tokens as stored in sessionStorage. */
export interface AuthTokens {
  accessToken: string;
  idToken: string;
  refreshToken: string;
  tokenType: string;
  expiresIn: number;
  savedAt: number;
}

/** Fields accepted by `saveAuthTokens`; anything missing falls back to a default. */
export type AuthTokenInput = Partial<Omit<AuthTokens, "savedAt">>;

/** Decoded JWT claims the app reads. Other claims pass through untyped. */
export interface JwtPayload {
  exp?: number;
  sub?: string;
  email?: string;
  name?: string;
  "cognito:groups"?: unknown;
  [claim: string]: unknown;
}

/** The signed-in user derived from an ID token. */
export interface AuthUser {
  sub?: string;
  email?: string;
  name?: string;
  groups: string[];
  isAdmin: boolean;
}

const base64UrlDecode = (value = ""): string => {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
  try {
    return window.atob(padded);
  } catch (error) {
    return "";
  }
};

export const parseJwt = (token = ""): JwtPayload | null => {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length < 2) return null;
  const payload = base64UrlDecode(parts[1]);
  if (!payload) return null;
  try {
    return JSON.parse(payload);
  } catch (error) {
    return null;
  }
};

export const isTokenExpired = (token = "", skewSeconds = 60): boolean => {
  const payload = parseJwt(token);
  if (!payload?.exp) return false;
  const now = Math.floor(Date.now() / 1000);
  return now >= payload.exp - skewSeconds;
};

export const saveAuthTokens = (tokens: AuthTokenInput = {}): void => {
  if (typeof window === "undefined") return;
  const payload: AuthTokens = {
    accessToken: tokens.accessToken || "",
    idToken: tokens.idToken || "",
    refreshToken: tokens.refreshToken || "",
    tokenType: tokens.tokenType || "Bearer",
    expiresIn: tokens.expiresIn || 0,
    savedAt: Date.now(),
  };
  try {
    window.sessionStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(payload));
  } catch (error) {
    // ignore storage errors
  }
};

export const loadAuthTokens = (): AuthTokens | null => {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(TOKEN_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AuthTokens> | null;
    if (!parsed?.accessToken) return null;
    if (isTokenExpired(parsed.accessToken)) {
      clearAuthTokens();
      return null;
    }
    return parsed as AuthTokens;
  } catch (error) {
    return null;
  }
};

export const clearAuthTokens = (): void => {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch (error) {
    // ignore storage errors
  }
};

export const getAccessToken = (): string => loadAuthTokens()?.accessToken || "";

export const getIdToken = (): string => loadAuthTokens()?.idToken || "";

export const getAuthToken = (): string => {
  const tokens = loadAuthTokens();
  return tokens?.idToken || tokens?.accessToken || "";
};

export const getUserFromIdToken = (idToken = ""): AuthUser | null => {
  const token = idToken || getIdToken();
  const payload = parseJwt(token);
  if (!payload) return null;
  const rawGroups = payload["cognito:groups"];
  const groups: string[] = Array.isArray(rawGroups) ? (rawGroups as string[]) : [];
  return {
    sub: payload.sub,
    email: payload.email,
    name: payload.name,
    groups,
    isAdmin: groups.includes("admin"),
  };
};
