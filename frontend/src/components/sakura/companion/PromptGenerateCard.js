/**
 * PromptGenerateCard — companion action card for generating an image from a prompt.
 * Shows a prompt suggestion and a "Generate this →" button that navigates
 * to /atelier with the prompt pre-filled via query param.
 */

import { useState } from "react";
import { useNavigate } from "react-router-dom";

export default function PromptGenerateCard({ action }) {
  const navigate = useNavigate();
  const [done, setDone] = useState(false);

  const prompt = action?.prompt || action?.description || "";
  const label = action?.label || "Generate this image";

  if (!prompt) return null;

  const handleGenerate = () => {
    if (done) return;
    navigate(`/atelier?prompt=${encodeURIComponent(prompt)}`);
    setDone(true);
  };

  return (
    <div style={styles.card}>
      <div style={styles.header}>
        <span style={styles.icon}>✦</span>
        <span style={styles.label}>{label}</span>
      </div>
      <div style={styles.prompt}>{prompt}</div>
      {done ? (
        <span style={styles.done}>Sending to Atelier ✓</span>
      ) : (
        <button type="button" onClick={handleGenerate} style={styles.btn}>
          Generate this →
        </button>
      )}
    </div>
  );
}

const styles = {
  card: {
    background: "color-mix(in srgb, var(--skr-accent-secondary) 8%, transparent)",
    border: "1px solid color-mix(in srgb, var(--skr-accent-secondary) 25%, transparent)",
    borderRadius: 8,
    padding: "8px 10px",
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: 5,
  },
  icon: {
    fontSize: 12,
    color: "color-mix(in srgb, var(--skr-accent) 90%, transparent)",
  },
  label: {
    fontSize: 9,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    color: "color-mix(in srgb, var(--skr-accent-secondary) 85%, transparent)",
  },
  prompt: {
    fontSize: 12,
    color: "var(--skr-text)",
    lineHeight: 1.5,
    fontStyle: "italic",
  },
  btn: {
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
