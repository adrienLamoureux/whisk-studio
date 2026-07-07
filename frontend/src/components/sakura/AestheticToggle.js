import React from "react";
import { useTheme } from "../../contexts/ThemeContext";

/**
 * Toggle between the two aesthetics (ADR-010): Sakura Bloom (bright anime)
 * and Obscura (dark painterly). ◐ enters Obscura, ❀ returns to Sakura.
 */
export default function AestheticToggle({ className = "" }) {
  const { aesthetic, toggleAesthetic } = useTheme();
  const isObscura = aesthetic === "obscura";
  const label = isObscura ? "Switch to Sakura Bloom" : "Switch to Obscura";
  return (
    <button
      type="button"
      className={`skr-aesthetic-toggle${className ? ` ${className}` : ""}`}
      onClick={toggleAesthetic}
      title={label}
      aria-label={label}
    >
      {isObscura ? "❀" : "◐"}
    </button>
  );
}
