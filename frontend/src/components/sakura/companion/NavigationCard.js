/**
 * NavigationCard — companion action card for page navigation.
 * Renders a "Go" button that navigates to the suggested page.
 */

import { useState } from "react";

const PAGE_NAMES = {
  "/": "Realm (Home)",
  "/atelier": "Atelier",
  "/chronicle": "Chronicle",
  "/gallery": "Gallery",
  "/sanctum": "Sanctum",
};

const VALID_PATHS = new Set(Object.keys(PAGE_NAMES));

export default function NavigationCard({ navigation, onNavigate }) {
  const [navigated, setNavigated] = useState(false);

  const path = navigation?.path;
  if (!path || !VALID_PATHS.has(path)) return null;

  const pageName = PAGE_NAMES[path];

  const handleGo = () => {
    if (navigated || !onNavigate) return;
    onNavigate(path);
    setNavigated(true);
  };

  return (
    <div style={styles.card}>
      <div style={styles.label}>Navigate to</div>
      <div style={styles.pageName}>{pageName}</div>
      {navigated ? (
        <span style={styles.done}>Navigated ✓</span>
      ) : (
        <button type="button" onClick={handleGo} style={styles.goBtn}>
          Go →
        </button>
      )}
    </div>
  );
}

const styles = {
  card: {
    background: "color-mix(in srgb, var(--skr-accent-secondary) 8%, transparent)",
    border: "1px solid color-mix(in srgb, var(--skr-accent-secondary) 30%, transparent)",
    borderRadius: 8,
    padding: "8px 10px",
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  label: {
    fontSize: 9,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    color: "color-mix(in srgb, var(--skr-accent-secondary) 90%, transparent)",
    opacity: 0.8,
  },
  pageName: {
    fontSize: 13,
    fontWeight: 600,
    color: "var(--skr-text)",
  },
  goBtn: {
    alignSelf: "flex-start",
    background: "color-mix(in srgb, var(--skr-accent-secondary) 15%, transparent)",
    border: "1px solid color-mix(in srgb, var(--skr-accent-secondary) 40%, transparent)",
    borderRadius: 6,
    color: "var(--skr-accent-secondary)",
    cursor: "pointer",
    fontSize: 11,
    fontWeight: 600,
    padding: "4px 14px",
    transition: "background var(--skr-duration-fast) var(--skr-ease-out)",
  },
  done: {
    fontSize: 11,
    color: "color-mix(in srgb, var(--skr-accent-secondary) 50%, transparent)",
    fontStyle: "italic",
  },
};
