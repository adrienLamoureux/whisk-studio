/**
 * CompanionStage — the single character-driven "drive" surface.
 *
 * When mode === "companion", App.js renders THIS instead of the dashboard
 * shell. The Live2D character dominates the viewport (left ~50% on desktop),
 * the tool-calling agent turn stream + tool results sit on the right, and the
 * composer is sticky at the bottom. This is the one place where "the agent"
 * lives — the former Live2D-less agent stage was folded in here (ADR-009), so
 * there is no longer a second character floating in a corner.
 *
 * Chrome:
 *   - Top-left meta strip: MemoryBadge, AgentSessionPicker, transcript export
 *     (ported from the retired AgentStage so no functionality was lost).
 *   - Top-right: frosted ✕ to return to the dashboard.
 *   - Bottom: a lighter-chrome HUD nav (shared NAV_ITEMS) — clicking a
 *     destination exits the takeover and navigates, so the user is never
 *     stranded.
 *
 * Reuses:
 *   - useAgent  — turn stream, submit, TTS, voice (no new state)
 *   - MangaPanel — renders each turn type (user/agent/thinking/tool-result)
 *   - Composer  — input + mic + 🔊
 *   - CompanionCanvas — Live2D renderer (mounted larger here)
 *
 * Live2D model selection uses the existing /api/admin/companion-model
 * endpoint + getDefaultModel fallback. Same pattern as CompanionPanel /
 * CompanionFullScreen — keeps the runtime model swap consistent across
 * surfaces.
 */

import React, { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../../../contexts/AuthContext";
import { useConfig } from "../../../contexts/ConfigContext";
import { buildApiUrl } from "../../../services/apiClient";
import { getDefaultModel, getModelById } from "../../../lib/live2d/model-registry";
import { useMode } from "../../../lib/mode/ModeContext";
import { useAgent } from "../../../lib/agent/AgentContext";
import { turnsToMarkdown, downloadMarkdown } from "../../../lib/agent/exportTurns";
import NAV_ITEMS from "../../../lib/nav/navItems";
import CompanionCanvas from "../companion/CompanionCanvas";
import MangaPanel from "../agent/MangaPanel";
import Composer from "../agent/Composer";
import MemoryBadge from "../agent/MemoryBadge";
import AgentSessionPicker from "../agent/AgentSessionPicker";

export default function CompanionStage() {
  const { setMode } = useMode();
  const { isAuthenticated, user } = useAuth();
  const { apiBaseUrl } = useConfig();
  const { turns, greet } = useAgent();
  const navigate = useNavigate();
  const location = useLocation();
  const scrollRef = useRef(null);
  const engineRef = useRef(null);
  const [modelEntry, setModelEntry] = useState(getDefaultModel());
  const characterName = modelEntry.name.split(/[\s(]/)[0];

  // Fetch the admin-configured model on mount — same pattern as CompanionPanel.
  useEffect(() => {
    if (!apiBaseUrl) return;
    fetch(buildApiUrl(apiBaseUrl, "/api/admin/companion-model"))
      .then((r) => (r.ok ? r.json() : null))
      .then((cfg) => {
        const m = cfg?.modelId && getModelById(cfg.modelId);
        if (m) setModelEntry(m);
      })
      .catch(() => {
        // ignore — getDefaultModel fallback is fine
      });
  }, [apiBaseUrl]);

  // Canned greeting once — no LLM call. Same trick as the former AgentStage.
  useEffect(() => {
    greet();
  }, [greet]);

  // Auto-scroll the conversation column on new turns.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [turns.length]);

  const handleExit = useCallback(() => {
    setMode("dashboard");
  }, [setMode]);

  // HUD nav — leave the takeover and navigate in one gesture, so the shell's
  // routes render normally at the destination.
  const handleNavigate = useCallback(
    (path) => {
      setMode("dashboard");
      navigate(path);
    },
    [setMode, navigate]
  );

  const handleExport = useCallback(() => {
    const md = turnsToMarkdown(turns);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    downloadMarkdown(md, `hiyori-transcript-${stamp}.md`);
  }, [turns]);

  const handleEngineReady = useCallback((engine) => {
    engineRef.current = engine;
  }, []);

  // If the user signed out while in companion mode, kick them back to the
  // dashboard rather than leaving them stranded with no shell.
  useEffect(() => {
    if (!isAuthenticated) setMode("dashboard");
  }, [isAuthenticated, setMode]);

  const navItems = NAV_ITEMS.filter((item) => {
    if (item.requiredRole === "admin" && !user?.isAdmin) return false;
    if (!item.isPublic && !isAuthenticated) return false;
    return true;
  });

  return (
    <div className="skr-companion-stage" role="main">
      <div className="skr-companion-stage-backdrop" aria-hidden="true" />

      {/* Top-left meta strip — parity with the retired AgentStage */}
      <div className="skr-companion-stage-meta">
        <MemoryBadge />
        <AgentSessionPicker />
        <button
          type="button"
          className="skr-layout-toggle"
          onClick={handleExport}
          disabled={turns.length === 0}
          aria-label="Export transcript as markdown"
          title="Download transcript (.md)"
        >
          ↓ Export
        </button>
      </div>

      <button
        type="button"
        className="skr-companion-exit"
        onClick={handleExit}
        aria-label="Exit companion mode"
        title="Back to dashboard"
      >
        ✕
      </button>

      <div className="skr-companion-stage-layout">
        {/* Left — dominant Live2D canvas */}
        <div className="skr-companion-canvas-side">
          <div className="skr-companion-canvas-wrap">
            <CompanionCanvas modelEntry={modelEntry} onEngineReady={handleEngineReady} />
          </div>
          <p className="skr-companion-name-label">{characterName}</p>
        </div>

        {/* Right — conversation stream + tool result cards */}
        <div className="skr-companion-conversation">
          <div className="skr-companion-scroll" ref={scrollRef}>
            <div className="skr-companion-stream">
              {turns.map((turn) => (
                <MangaPanel key={turn.id} turn={turn} />
              ))}
            </div>
          </div>

          <div className="skr-companion-composer-wrap">
            <Composer />
          </div>
        </div>
      </div>

      {/* Lighter-chrome bottom HUD — keeps navigation available */}
      <nav className="skr-hud skr-companion-hud">
        <div className="skr-hud-pill">
          {navItems.map((item) => (
            <button
              type="button"
              key={item.path}
              className={`skr-hud-item${location.pathname === item.path ? " is-active" : ""}`}
              onClick={() => handleNavigate(item.path)}
            >
              <span className="skr-hud-icon">{item.icon}</span>
              <span className="skr-hud-label">{item.label}</span>
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}
