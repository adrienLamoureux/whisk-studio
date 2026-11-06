export const readSessionCache = <T = unknown>(key: string, maxAgeMs?: number): T | null => {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const { ts, data } = parsed as { ts?: number; data: T };
    if (maxAgeMs && ts && Date.now() - ts > maxAgeMs) return null;
    return data;
  } catch (error) {
    return null;
  }
};

export const writeSessionCache = (key: string, data: unknown): void => {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(key, JSON.stringify({ ts: Date.now(), data }));
  } catch (error) {
    // ignore cache write failures
  }
};

export const removeSessionCache = (key?: string): void => {
  if (!key || typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(key);
  } catch (error) {
    // ignore cache remove failures
  }
};

export const clearSessionCache = (): void => {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem("whisk_images_cache");
    window.sessionStorage.removeItem("whisk_videos_cache");
  } catch (error) {
    // ignore cache clear failures
  }
};
