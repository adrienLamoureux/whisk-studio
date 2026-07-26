import { useEffect, useRef } from "react";
import { useAuth } from "../../contexts/AuthContext";
import { useNotify } from "./NotificationStack";

// A burst of parallel requests can all 401 at once; only toast once per window.
const REPEAT_WINDOW_MS = 8000;

/**
 * Renders nothing — listens for the global `whisk:auth:expired` event
 * (dispatched by apiClient on any 401) and surfaces a visible toast so a
 * mid-action sign-out never reads as a generic request failure. Only
 * listens while authenticated: an anonymous visitor hitting a protected
 * endpoint is not an "expired session".
 */
export default function AuthExpiryNotice() {
  const notify = useNotify();
  const { isAuthenticated } = useAuth();
  const lastNoticeAtRef = useRef(0);

  useEffect(() => {
    if (!isAuthenticated) return undefined;
    const handler = () => {
      const now = Date.now();
      if (now - lastNoticeAtRef.current < REPEAT_WINDOW_MS) return;
      lastNoticeAtRef.current = now;
      notify?.("Your session expired — please sign in again.", "error");
    };
    window.addEventListener("whisk:auth:expired", handler);
    return () => window.removeEventListener("whisk:auth:expired", handler);
  }, [isAuthenticated, notify]);

  return null;
}
