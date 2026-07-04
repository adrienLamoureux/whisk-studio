# Decisions - dev

## Entries
- Date: 2026-03-18
- Decision: Treat `codex/dev` as the full-stack source-of-truth branch and keep the frontend intentionally minimal.
- Context: The repo now supports multiple rich UI overlays in parallel. The baseline branch must remain stable for backend/CDK work and cross-branch contract management.
- Alternatives considered: letting `codex/dev` grow into another full UX branch.
- Consequences: design work must stay in overlay branches, while shared contracts and infrastructure changes land here first.

- Date: 2026-03-18 — **SUPERSEDED by 2026-07-04 below**
- Decision: Support both full-stack and UI-only deployment modes in CDK.
- Context: Some ideas need isolated backend resources; others only need a new frontend shell over an existing backend.
- Alternatives considered: full-stack-only deployments for every idea.
- Consequences: `idea:deploy -- --backend-stage=<stage>` is available, and future agents must understand whether a stage is currently full-stack or UI-only before changing stack wiring.

- Date: 2026-03-19
- Decision: Preserve the story session response shape as a frozen cross-branch contract.
- Context: both active UI worktrees depend on `{ session, messages, scenes }` with top-level arrays and chronological scene/message pairing.
- Alternatives considered: nesting `messages` and `scenes` under `session` or attaching `sceneId` directly to every message.
- Consequences: backend changes touching story payloads require deliberate coordination across all design overlays.

- Date: 2026-07-04
- Decision: Consolidate to a single design (Sakura Bloom); remove all design variants, the UI-only
  deployment mode, and per-idea worktrees. Supersedes the two 2026-03-18 decisions above.
- Context: No other design was under active development; the variant stacks (design-fusion,
  -pixnovel, -yokai, -kitsune) were stale, unused, and accruing baseline AWS cost.
- Consequences: `UiOnlyStack` / `--backend-stage` are gone; CDK deploys one full stack
  (`StaticWebAWSAIStack-dev`). The 4 variant AWS stacks were destroyed and their branches pruned.
  See [ADR-008](../../docs/adr/008-remove-design-variants.md).
