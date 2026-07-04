# ADR 008 — Remove Design Variants

**Status**: Accepted
**Date**: 2026-07-04
**Supersedes the UI-only provisions of**: [ADR 006 — Branch Consolidation](./006-branch-consolidation.md)

---

## Context

ADR 006 consolidated everything onto `main` but deliberately preserved `UiOnlyStack` and the
`codex/design-*` branches "in case" a second design resumed. That never happened. By mid-2026 the
situation was:

- **One design in use** — Sakura Bloom is the only frontend anyone ships or maintains.
- **Stale variant stacks still live on AWS** — `StaticWebAWSAIStack-design-fusion`, `-pixnovel`,
  `-yokai`, and `-kitsune` were still deployed (last touched March 2026), accruing baseline cost
  (S3 + CloudFront, and for `design-fusion` a full API/Cognito/DynamoDB stack) and holding orphaned
  data. Two of them (`-yokai`, `-kitsune`) were not even tracked in `IDEAS.md`.
- **Registry drift** — `IDEAS.md` listed `design-atelier/-kinetic/-solaris` as LIVE though they had
  already been destroyed, and omitted the two orphans. The ledger no longer matched reality.
- **Dead machinery** — `cdk/lib/ui-stack.ts` (`UiOnlyStack`), the `stackMode=ui-only` /
  `--backend-stage` code path, `scripts/check-variant-scope.sh`, five `ideas/design-*` folders, and
  the per-idea worktree workflow all existed solely to serve variants that no longer exist.

Keeping this scaffolding cost real money and added ongoing "which mode is this stage?" cognitive
overhead to every infra change, for zero benefit.

---

## Decision

Collapse to a single design and a single deploy path.

1. **Destroy** the 4 live variant AWS stacks (`design-fusion`, `-pixnovel`, `-yokai`, `-kitsune`) —
   S3 buckets emptied first, then `cloudformation delete-stack`.
2. **Delete the UI-only machinery**: `cdk/lib/ui-stack.ts`, the `stackMode`/`ui-only` branch in
   `cdk/bin/static-web-aws-ai-stack.ts`, the `--backend-stage` option and ui-only context builder in
   `cdk/scripts/idea-env.js`, `scripts/check-variant-scope.sh`, and its `idea:scope-check` npm script.
3. **Delete the 5 `ideas/design-*` folders** and reduce the `IDEAS.md` registry to `dev`.
4. **Prune the 8 stale `codex/design-*` / `codex/palette-*` remote branches.**
5. **Scrub the docs** of every "design variant / UI-only overlay / per-idea worktree" reference so the
   documentation matches the single-design reality.

The multi-idea `idea-env.js` core (init/deploy/destroy/diff/synth/sanity/ui-smoke and the
rollout/deploy-many helpers) is kept — it still deploys `dev` — but it now only ever produces one
full stack, `StaticWebAWSAIStack-dev`.

---

## Consequences

**Positive:**
- No stale AWS stacks; the account holds exactly one environment (`dev`).
- One deploy mode, one stack file, one design. No `stackMode` branching to reason about.
- `IDEAS.md` and the docs are self-consistent with what is actually deployed.

**Neutral:**
- `UiOnlyStack` and `--backend-stage` are gone. If a second design is ever wanted, it comes back as a
  fresh decision — not resurrected scaffolding.
- The `dev` Cognito pool (`us-east-1_KGfmw3Ykn`) is unchanged and remains the sole user pool.

**Trade-off:**
- The parallel-worktree / `codex/<idea-id>` workflow in `AGENTS.md` is retired in favor of
  short-lived feature branches off `main`. Large tasks still use planner → workers → integrator
  roles, run sequentially rather than in isolated worktrees.

---

## Rollback

The removed code and folders are recoverable from git history (the commit that landed this ADR).
The destroyed AWS stacks are **not** recoverable — they would need to be redeployed from CDK, and
their prior DynamoDB/S3/Cognito contents are gone. This was accepted as intended: the data was
orphaned test content from abandoned design explorations.
