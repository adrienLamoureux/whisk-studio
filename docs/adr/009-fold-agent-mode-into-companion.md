# ADR 009 — Fold Agent Mode into the Live2D-Central Companion Drive Surface

**Status**: Accepted
**Date**: 2026-07-04
**Supersedes**: the frontend-presentation provisions of ADR-007 (the backend agent is unchanged)

---

## Context

The frontend `ModeContext` shipped three surfaces: `dashboard` (forms), `agent`
(a route-scoped manga-panel chat on `/atelier`, the `AgentStage`), and `companion`
(a full-viewport, Live2D-central character takeover, `CompanionStage`). Both `agent`
and `companion` drive the *same* tool-calling agent (`useAgent` → `POST /api/agent/turn`).

Two things made `agent` mode feel redundant:

1. **Two characters on screen at once.** ADR-007 deliberately kept the Live2D out of
   `AgentStage` and let the global floating `CompanionPanel` keep rendering in agent mode.
   But that panel carries its *own* chat (`SideChatPanel` → `POST /api/companion/chat`, the
   v0 companion — a different, tool-less AI). So on `/atelier` in agent mode the user saw a
   Live2D-less agent conversation **and** a floating character with a separate chat box:
   two chat inputs, two AI backends, the character disconnected from the agent doing the work.
   ADR-007 itself predicted this — *"we'll revisit if user testing shows the distinction
   matters."* It did.

2. **The unified surface already existed.** `CompanionStage` already renders the Live2D
   dominant on the left with the tool-calling agent's turn stream + tool-result cards on the
   right and one composer at the bottom. It *is* "the character drives while the agent
   generates" — it was just buried behind a third mode instead of being *the* drive surface.

## Decision

Retire the standalone frontend `agent` mode. `ModeContext` now has two modes —
`dashboard` and `companion` — and the Live2D-central `CompanionStage` is the single
character-driven "drive" surface where the agent runs.

- **`AgentStage` is deleted.** Its meta controls (memory badge, session picker, transcript
  export) were ported into `CompanionStage` so no functionality was lost. The bento/column
  layout toggle was dropped (the drive stream is single-column beside the character).
- **All entry points route to `companion`:** the Forge `ModeToggle`, the "Let Hiyori take
  it" `SummonAgentButton` (its prompt stash is still consumed by the shared `AgentContext`,
  so prefill is unchanged), and the panel's ✨ button.
- **Lighter chrome:** `CompanionStage` gains a bottom-left HUD (shared `NAV_ITEMS`) so the
  takeover is navigable instead of a dead-end; a nav click exits the takeover and routes
  normally. The ✕ exit remains. Desktop shows the HUD (the shell's left Sidebar isn't
  present in the takeover); mobile hides it since the composer owns the bottom edge.
- A stored `skr-mode` of `"agent"` falls back to `"dashboard"` (dropped from `VALID_MODES`).

**Out of scope (unchanged):** the backend agent — `/api/agent/turn`, the 9-tool fleet,
memory (`AGENT#{sessionId}` / `AGENT#STATE`), rate/token guardrails — and the v0 companion
chat (`/api/companion/chat`) that still powers the floating panel's ambient presence in
dashboard mode. Merging those two brains into one is a possible future step (was "Option C"),
not this change.

## Consequences

**Positive**
- One character-driven agent surface; the "two AIs on screen" redundancy is gone.
- Seeing the Live2D is now central to the generate-by-conversation flow, as intended.
- Net less code: `AgentStage` removed; `CompanionStage` reuses the same agent + Live2D parts.

**Negative**
- Entering the drive surface is now a full-viewport transition rather than an in-page swap on
  `/atelier`. The bottom-HUD lighter chrome softens the dead-end feel, but it is heavier than
  the old inline stage. Revisit if users want an inline/docked drive variant.
- Mobile companion nav is exit-only (the composer owns the bottom edge).

## Reversibility

Reversible for the files (git). Re-introducing a distinct inline agent surface means
restoring `AgentStage` (recoverable from history) and re-adding `"agent"` to `VALID_MODES` +
the Forge branch. No data or infrastructure is affected.
