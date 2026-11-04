# AI-SDLC pilot — plan (not started)

> **Status:** planned 2026-11-04, nothing started yet. Tick the boxes as work lands.
> For the existing roadmap see [`../state-of-the-art.md`](../state-of-the-art.md) §12; for the
> agent rules see [`../../AGENTS.md`](../../AGENTS.md).

## Goal
An AI agent takes part at every stage of the loop (plan → build → review → test → deploy →
operate) on this real, deployed product, with evidence that can be shown.

## Why this repo
It already has the rules an agent needs: `AGENTS.md` (planner → workers → integrator), quality
gates, the ADRs, CI (lint, prettier, tests, 500-line cap), and a deploy that runs sanity and UI
smoke checks. What it lacks is the AI part of the loop.

## A1. Agent evals (highest value)
The agent (Bedrock Converse, default Haiku 4.5, 10 tools in `backend/lib/agent-tools.js`) has
unit tests for routes, config, memory and cost, but **no behaviour evals**: nothing checks that a
given request picks the right tool or refuses.
- [ ] Golden set `backend/evals/golden.jsonl`: about 40 cases, each with a user turn and the
      expected tool, or the expected refusal. Cover every tool, the admin-refusal rule in
      `agent-prompts.js`, prompt-injection attempts, and ambiguous asks.
- [ ] Runner `backend/evals/run.js`: replay each case through the real tool-dispatch path with
      providers stubbed, and score tool choice, arguments and refusal. Write a JSON report.
- [ ] Two tiers: deterministic checks (tool name and argument schema) on every PR; an LLM-judge
      pass for narration quality run nightly, or by hand before a model change.
- [ ] Gate: a change to the model or the prompt must not lower the pass rate (store the baseline
      in the repo).
- **Done when:** `npm --prefix backend run eval` prints a pass rate, and CI fails if it drops.

## A2. Claude in the review loop
- [ ] Install the Claude GitHub app (`/install-github-app`) with a token from `claude setup-token`.
- [ ] A workflow that reviews PRs against `AGENTS.md` and `CONTRIBUTING.md`: contract drift,
      hard-coded values, the 500-line cap, missing tests.
- [ ] `@claude` on issues to open draft PRs for small, well-defined tickets.
- **Done when:** the next three PRs get an automatic review that finds at least one real issue.

## A3. Agent-sized roadmap items (from `state-of-the-art.md` §12)
Run each as its own Claude Code session, in its own worktree, with the planner → worker →
integrator templates from `AGENTS.md`:
- [ ] **Streaming responses** through a Lambda Function URL (the headline roadmap item).
- [ ] **Backend coverage above ~40%**: start with the thinnest new routes, and split
      `story/illustration-routes.js`.
- [ ] **Frontend JS → TypeScript** (about 23k lines, no `.ts` files today). Go module by module,
      starting with `services/` and shared primitives, and use `allowJs` so it converts gradually.

## A4. Operate
- [ ] A weekly scheduled agent (`/schedule`) that checks `docs/ai-context.md` and
      `docs/api-spec.md` still match the routes (the drift check).
- [ ] A nightly scheduled eval run (A1) that opens an issue with the report when the pass rate drops.
- [ ] Bill these headless runs to an API key from a Console org with a workspace spend limit, so
      they don't use up interactive Claude Code limits.

## What builds on this
- The planner → worker → integrator templates become a reusable plugin in
  [claude-skills](https://github.com/adrienLamoureux/claude-skills) (see its `ROADMAP.md`).
- Once A1 and A2 have run for a while, the method they taught goes into the general
  knowledge-transfer docs, written without naming this project.
