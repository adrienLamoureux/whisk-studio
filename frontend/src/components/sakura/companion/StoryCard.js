/**
 * StoryCard — companion action card for starting a new story.
 * Navigates to /chronicle with prefilled title and genre query params.
 */

import { useState } from "react";
import { useAuth } from "../../../contexts/AuthContext";

export default function StoryCard({ storyAction, onNavigate }) {
  const { isAuthenticated } = useAuth();
  const [title, setTitle] = useState(storyAction?.title || "");
  const [genre, setGenre] = useState(storyAction?.genre || "");
  const [started, setStarted] = useState(false);

  const handleStart = () => {
    if (started || !onNavigate) return;
    const params = new URLSearchParams();
    if (title.trim()) params.set("companionTitle", title.trim());
    if (genre.trim()) params.set("companionGenre", genre.trim());
    const query = params.toString();
    onNavigate(`/chronicle${query ? `?${query}` : ""}`);
    setStarted(true);
  };

  return (
    <div style={styles.card}>
      <div style={styles.label}>Start a Story</div>

      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Story title..."
        style={styles.field}
        disabled={started}
        maxLength={80}
      />
      <input
        type="text"
        value={genre}
        onChange={(e) => setGenre(e.target.value)}
        placeholder="Genre (e.g. fantasy, mystery)..."
        style={styles.field}
        disabled={started}
        maxLength={40}
      />

      {!isAuthenticated ? (
        <p style={styles.authHint}>Log in to start a story</p>
      ) : started ? (
        <span style={styles.done}>Opening Chronicle ✓</span>
      ) : (
        <button
          type="button"
          onClick={handleStart}
          style={styles.startBtn}
          disabled={!title.trim()}
        >
          Start Story →
        </button>
      )}
    </div>
  );
}

const styles = {
  card: {
    background: "color-mix(in srgb, var(--skr-accent-info) 7%, transparent)",
    border: "1px solid color-mix(in srgb, var(--skr-accent-info) 25%, transparent)",
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
    color: "color-mix(in srgb, var(--skr-accent-info) 90%, transparent)",
    opacity: 0.8,
  },
  field: {
    background: "var(--skr-comp-input-bg)",
    border: "1px solid color-mix(in srgb, var(--skr-accent-info) 20%, transparent)",
    borderRadius: 6,
    padding: "5px 8px",
    color: "var(--skr-text)",
    fontSize: 11,
    outline: "none",
    fontFamily: "inherit",
  },
  startBtn: {
    alignSelf: "flex-start",
    background: "color-mix(in srgb, var(--skr-accent-info) 15%, transparent)",
    border: "1px solid color-mix(in srgb, var(--skr-accent-info) 40%, transparent)",
    borderRadius: 6,
    color: "var(--skr-accent-info)",
    cursor: "pointer",
    fontSize: 11,
    fontWeight: 600,
    padding: "4px 14px",
    transition: "background var(--skr-duration-fast) var(--skr-ease-out)",
  },
  authHint: {
    fontSize: 11,
    color: "var(--skr-text-muted)",
    fontStyle: "italic",
    margin: 0,
  },
  done: {
    fontSize: 11,
    color: "color-mix(in srgb, var(--skr-accent-info) 50%, transparent)",
    fontStyle: "italic",
  },
};
