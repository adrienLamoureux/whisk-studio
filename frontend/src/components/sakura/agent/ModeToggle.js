/**
 * ModeToggle — pill-shaped toggle that flips between Dashboard and the
 * Live2D-central Companion drive surface.
 *
 * Mounted inside Forge (only on /atelier) in the fixed top-right slot. From
 * Dashboard it enters companion mode (CompanionStage takes the viewport with
 * the character dominant); the drive surface has its own ✕ to return. The
 * former in-page "agent" stage was folded into companion — see ADR-009.
 */

import React from "react";
import { useMode } from "../../../lib/mode/ModeContext";

export default function ModeToggle() {
  const { mode, toggleMode } = useMode();
  const isDrive = mode === "companion";

  return (
    <button
      type="button"
      className={`skr-mode-toggle${isDrive ? " is-agent" : ""}`}
      onClick={toggleMode}
      aria-pressed={isDrive}
      aria-label={isDrive ? "Back to Dashboard" : "Enter companion drive mode"}
      title={isDrive ? "Back to Dashboard" : "Let Hiyori drive — full-screen with the agent"}
    >
      <span className="skr-mode-toggle-icon" aria-hidden="true">
        {isDrive ? "✦" : "◈"}
      </span>
      <span className="skr-mode-toggle-label">{isDrive ? "Companion" : "Dashboard"}</span>
    </button>
  );
}
