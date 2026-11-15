# Whisk Studio — State of the Art

> Snapshot: **2026-11-15** · branch `main` at commit `63471ff`
> Counts come from commands run on 2026-11-13 and 2026-11-14 against identical application code; the three workflow files that differ were re-read on 2026-11-15.
> Prices say which price list they come from and when it was fetched.
> Companion read for a technical interview: what the system is, how it's built,
> what it costs to run, and where it's going. The authoritative deep dives live in
> [`architecture.md`](./architecture.md), [`api-spec.md`](./api-spec.md), the
> [ADRs](./adr/), and the [proposals](./proposals/).

---

## 1. What it is

Whisk Studio is a full-stack, **fully-serverless** AI creative studio on AWS. A user
signs in and can generate images, co-write illustrated stories, score scenes with
generated music, and talk to a Live2D character ("Hiyori") that can drive the whole
app on their behalf. Three main model providers (AWS Bedrock, Replicate, CivitAI), plus a
small Gradio client, sit behind one Express API; everything user-facing is a single React app.

The defining product idea is **conversation-as-interface**: the same backend powers a
traditional form-driven dashboard *and* an agent that calls real tools, *and* a
companion mode where the character leads the screen. A lighter HUD keeps the four dashboard
areas reachable, so the character leads but is not the only way around.

**Capabilities today**
- Text-to-image generation via Replicate + Bedrock + CivitAI, with LoRA support. The agent
  picks from 4 styles and 3 aspect ratios; the dashboard offers 6 style presets and 5 ratios
- Illustrated, stateful storytelling with per-scene illustration + generated music
- **Agent Mode (v1.7)** — Bedrock Converse tool-use loop with a 10-tool fleet, per-user memory, cross-session preferences, named sessions, voice input
- **Companion Mode (v0)** — full-viewport, character-driven UX; the prompt tells the agent to refuse admin operations
- Live2D companion with proactive messaging and persistent memory
- **Job spine** — one job record per asynchronous generation (Replicate, CivitAI, Nova Reel, the agent, story media); the synchronous Titan and Gradio routes write only an image item (§3.5)
- **Agent evals** — a 52-case golden set that gates changes in CI (§6.4)
- Admin "Sanctum" — feature flags (cohort-scoped), cost dashboard, job queue, model picker

---

## 2. System at a glance

| Dimension | Value | Source |
|-----------|-------|--------|
| Backend source | 90 files, 19,763 LOC (`lib/` + `routes/`, non-test JS) | repo |
| Frontend source | 161 files: 131 JS, 23 TS, 7 TSX | repo |
| Backend tests | **495 passing** (`node:test`) | `npm --prefix backend test` |
| Frontend tests | **167 passing** in 23 suites (RTL + Jest) | `npm --prefix frontend run test:ci` |
| File-length gate | clean — **0 files over 500 lines** | `scripts/check-file-length.sh` |
| HTTP endpoints | 105 route registrations in 34 route files; `index.js` registers 30 modules | `backend/routes/index.js` |
| Agent evals | 52-case golden set; credential-free replay runs in CI; baseline 47 of 52 (90.4%) | `backend/evals/` |
| Aesthetics | 2 runtime-switchable: Obscura (default, dark painterly) + Sakura Bloom (10 palettes × dark/light) | `src/styles/obscura/`, `src/styles/themes/` |
| Default LLM | Claude **Haiku 4.5** on Bedrock (admin-overridable) | `agent-config.js` |
| Infra | 100% serverless (no EC2/RDS/NAT/ALB) | §4 |
| Deploy | one command, ~build+synth+sync+smoke | `npm --prefix cdk run idea:deploy -- --stage=<idea-id>` |

---

## 3. Architecture

### 3.1 Layers
```
CloudFront (static React + config.json)
      │  PKCE / Cognito Hosted UI
      ▼
API Gateway ──► Lambda (Express via serverless-http)
      │
      ├── AWS Bedrock      (Converse tool-use, prompt help, compaction)
      ├── Replicate        (image / video generation)  ◄─ assumed dominant cost
      ├── CivitAI / Gradio (alternative image providers)
      │
      ├── DynamoDB         (single-table, PAY_PER_REQUEST)
      └── S3               (user media, signed-URL access)
```

### 3.2 Request flow
1. CloudFront serves the built SPA + a deploy-time `config.json` (API base, Cognito wiring).
2. The browser authenticates through Cognito Hosted UI (PKCE); JWT rides on every API call.
3. API Gateway invokes the Lambda Express adapter (`backend/lambda.js`). It uses
   `serverless-http`, which buffers the whole response. That matters for streaming (§12).
4. Routers resolve domain logic, call providers, persist to DynamoDB / S3.
5. Media is served back via short-lived **S3 signed URLs** (never public objects for user content).

### 3.3 Backend composition
- **Composition root:** `backend/lib/build-deps.js` — a single flat `deps` object
  assembled once and threaded into every router ([ADR-004](./adr/004-flat-deps-shape.md)).
  This is hand-rolled DI: trivially testable (swap the object), no framework.
- **Route hub:** `backend/routes/index.js` registers 30 route modules
  ([ADR-001](./adr/001-express-router-migration.md)). 14 are mounted as an Express
  Router with `app.use(prefix, ...)`; 16 register directly on `app`.
- **Shared guards:** `route-guards.js` (`requireEnv` / `requireAuth` / `requireParam`)
  and `error-handler.js` keep handlers thin and uniform.

### 3.4 Frontend
React 18 SPA with two runtime aesthetics (ADR-010): "Obscura" (default — dark painterly,
serif type, gold/ink) and "Sakura Bloom" (anime). No CSS framework — a hand-built `skr-` design
system on CSS custom properties ([ADR-003](./adr/003-css-design-system-over-tailwind.md)),
10 Sakura palettes. The Live2D companion renders via `pixi-live2d-display` on `pixi.js@6`.
Two top-level **modes** (`ModeContext`, persisted to `localStorage["skr-mode"]`)
swap the entire shell: `dashboard` and `companion`. A standalone `agent` mode existed
before ADR-009 and was folded into companion.
The TypeScript migration has started: 23 `.ts` and 7 `.tsx` files, covering the
`services/`, `utils/`, `types/` and `components/shared/` layers. `tsc --noEmit` is a CI step.
The other 131 files are still JavaScript.

### 3.5 Job spine
Every asynchronous generation (Replicate, CivitAI, Nova Reel, the agent's `generate_image`, story scene media) writes one `JOB#` record, and its status is normalised to a single `JOB_STATUS` set on read (`backend/lib/jobs.js`).
The synchronous Titan and Gradio image routes write only an `IMG` item. `GET /jobs` and
`GET /jobs/:jobId` read them (`backend/routes/jobs-routes.js`). The client resumes
in-flight jobs from that server feed, and Sanctum has a JobQueue view.
A twin doc covers it: [`archon/job-spine.md`](./archon/job-spine.md).
Known gaps today: the agent's `generate_image` job row stores no `poll`, so the feed cannot
resume it; `getJob` lists up to 500 jobs and filters, instead of a `GetItem` by id;
`queryMediaItems` does not paginate.

---

## 4. Serverless & infra posture

**There is no always-on compute and no expensive idle infrastructure.** Every component
bills on use. The billing modes below are verified in the CDK stack. The dollar column is an
assumption, not a measurement.

| Resource | Mode | Idle cost (assumed) |
|----------|------|-----------|
| Lambda | on-demand, **no provisioned concurrency** | $0 |
| DynamoDB | **PAY_PER_REQUEST** (on-demand) | $0 |
| S3 | per-GB storage + requests | ~$0 |
| CloudFront | per-GB egress + requests | ~$0 |
| Cognito | free tier assumed to cover expected MAU | $0 |
| API Gateway | per-request | $0 |

No EC2, RDS, ElastiCache, NAT Gateway, or load balancer exists in the stack. These are
commonly cited as the fixed monthly costs of an always-on AWS design (a general claim,
not measured here), and the design deliberately avoids all of them. Lambda log retention is
capped at one month (`logs.RetentionDays.ONE_MONTH`) to keep CloudWatch from accreting cost.

The one operational nuance: Live2D model assets (about 7 MB) are excluded from CDK's
`BucketDeployment` and synced post-deploy via `aws s3 sync` in `cdk/scripts/idea-env.js`.

---

## 5. The two modes (the product spine)

| Mode | Surface | Who drives | Admin ops |
|------|---------|-----------|-----------|
| **Dashboard** | Classic forms (Realm, Atelier, Chronicle, Sanctum) | User clicks | ✅ (Sanctum) |
| **Companion drive** | Full-viewport, Live2D-central: character + the tool-calling agent stream | Character-led conversation | ❌ **refused by prompt, no admin tool** |

The Companion drive is where generation-by-conversation happens: the Live2D character is
dominant on the left, the agent's turn stream + tool-result cards sit on the right, one
composer at the bottom. It runs the *same* tool-calling agent detailed in §6. Earlier there
was also a separate `agent` mode — a Live2D-less manga stream that ran *alongside* the
floating companion (a different, tool-less chat), so the user faced two chat boxes and two
AIs at once. That standalone panel was folded into the companion drive (ADR-009): one
character-driven surface, the Live2D central while the agent generates.

When active the drive leads the screen, and a lighter-chrome bottom HUD keeps
Realm/Atelier/Chronicle/Sanctum reachable. The system-prompt addendum biases toward narrative
tone and on-screen voice confirmation, and instructs a refusal for any admin/Director
operation — *"That one's behind the Director's desk — I can't help from here. Want me to
drop you into the dashboard?"* The refusal is a prompt instruction. It also holds because the
10-tool fleet contains no admin tool. Nothing server-side checks which mode is active.
Non-admin actions (generate, browse your library, change theme, score a scene) flow through the
same tool fleet.

---

## 6. Agent Mode deep-dive

The most architecturally interesting subsystem.

### 6.1 The turn loop
`POST /api/agent/turn` runs a Bedrock **Converse** call (output capped at 400 tokens)
with tool specs attached. Tools fall into three classes, which determines the control flow:

- **server-dispatch** (`generate_image`, `recall_favorites`, `browse_gallery`,
  `view_my_creations`, `what_can_you_do`) — backend executes the tool.
- **client-action** (`set_theme`, `set_aesthetic`) — returned to the browser, applied via React context.
- **intent** (`continue_story`, `illustrate_scene`, `generate_music`) — returned as a
  confirm payload; the user approves before any write hits their Chronicle.

After any tool result that does not need confirmation, a **second 120-token "closing"
model turn** comments on it (*"turned out softer than I expected — want more contrast?"*).
So it follows server-dispatch and client-action tools, not intent tools.

The 10-tool fleet: `generate_image`, `set_theme`, `set_aesthetic`, `continue_story`, `illustrate_scene`,
`recall_favorites`, `generate_music`, `browse_gallery`, plus companion-v0's
`view_my_creations` and `what_can_you_do`.

### 6.2 Memory & state
- **Per-session memory** at `AGENT#{sessionId}` with rolling-summary **compaction** above
  30 turns (the summariser's own tokens are billed back — no blind spot).
- **Cross-session preferences** at `AGENT#STATE`
  (`{lastStyle, lastAspect, lastLora, theme, aesthetic}`); the first four are injected into the system prompt
  as `<prefs>` so tool defaults bias toward prior choices, and `aesthetic` selects the Obscura voice addendum.
  Values are validated on read *and* write (enums, and a shape check for `lastLora`) — because
  they re-enter the prompt, an unchecked value would be a self-targeted prompt-injection vector.
- **Named sessions** (v1.7): the session id *is* the memory namespace, so multi-session
  history needed no schema change.

### 6.3 Guardrails (defense in depth)
- Per-user **token-bucket rate limit** (`AGENT#RATE`), fail-open on DB error.
- **Daily token cap** 200k/day (UTC rollover) → 429 + `Retry-After`. It counts input plus
  output tokens, so it bounds tokens, not dollars (§8).
- **Daily image cap** 50/day, on a *separate* counter so it rolls over independently.
  The cap check fails open on a DB error.
- **Cohort-scoped feature flag** — `agentMode ∈ {true,false,"all","admin","beta"}`,
  evaluated against the caller's Cognito groups.

### 6.4 Evals
The agent has a regression gate that needs no credentials.
- **Golden set:** 52 cases in `backend/evals/golden.jsonl`, with a scorer and an LLM judge
  (`npm --prefix backend run eval`, `eval:live`, `eval:judge`).
- **Replay tier:** runs in `ci.yml` with no credentials, dispatching recorded tool calls
  through stubs. The gate fails if the pass rate drops below the stored baseline.
- **Live and record tiers:** `--live` calls the real model; `--record` works only together with `--live`.
- **Nightly:** `nightly-eval.yml` is scheduled for 03:17 UTC but is off by default: the job runs only on a
  manual trigger or when the repo variable `ENABLE_NIGHTLY_EVAL` is `true`, and it skips while the `EVAL_AWS_*` secrets are absent.
- **Baseline:** 47 of 52 passed (90.4%), recorded 2026-11-05 (`backend/evals/baseline.json`).

---

## 7. Data model — single-table DynamoDB

One table. Most rows live in the user's partition, `pk = USER#{sub}`, with `sk` namespaces.
No GSIs required for the access patterns.

**Key layout, user partition**

| SK namespace | Holds |
|--------------|-------|
| `IMG#…` / `JOB#…` / `VID#…` | user media + one record per generation job (§3.5) |
| `COMPANION#{modelId}` (+ `#MSG#`) | long-lived companion identity memory |
| `AGENT#{sessionId}` (+ `#MSG#`) | short-lived, tool-heavy agent memory |
| `AGENT#STATE` | cross-session prefs (prompt-injected, validated) |
| `AGENT#RATE` | token bucket |
| `AGENT#COST` | running token totals + daily cap counter |
| `AGENT#IMG_COUNT` | daily image cap counter |
| `AGENT#SESSION#{id}` | named session metadata |

**Key layout, shared partitions** (the partition key is the fixed value, not `USER#`)

| PK | Holds |
|----|-------|
| `CONFIG#AGENT` | admin model override (60s cached) |
| `PRESET#STORY`, `PRESET#CHARACTER`, `PRESET#PROMPT_HELPER` | seed content |

Counters: `turnCount`, `inputTokens`, `outputTokens` and `totalImages` use atomic `ADD`
(`UpdateExpression: ADD turnCount :n`). The two **daily-cap counters are the exception**.
`tokensToday` and `imagesToday` are read, summed in JS, then written with `SET`. Two concurrent
turns can lose one update and under-count against the cap. The per-user rate limiter narrows
that window but is a separate control. Closing it is on the roadmap.

---

## 8. Cost model (per user)

The repo's working assumption is that Replicate image generation is the dominant cost; there is
no billing data in the repo to confirm it, so treat it as an assumption. Nothing here is a
measurement. Each figure is either an in-repo cap, arithmetic on a cap, or a price taken from a
named price list.

**Price lists used**
- **Anthropic API list** (https://platform.claude.com/docs/en/about-claude/pricing, fetched 2026-11-13):
  Haiku 4.5 is $1 input / $5 output per million tokens. Haiku 5.5 is $0.10 / $0.50 up to 100k
  prompt tokens and $0.50 / $2.50 above.
- **Bedrock** (https://aws.amazon.com/bedrock/pricing/, fetched 2026-11-13): the repo calls Haiku
  on Bedrock, but no public page we could fetch gave its rate. The Bedrock rate is **unconfirmed**,
  so the agent figures below use the Anthropic API list as a stand-in.
- **Replicate model pages** (fetched 2026-11-13, re-read 2026-11-14), per run and varying with inputs:
  [animagine-xl-v4-opt](https://replicate.com/aisha-ai-official/animagine-xl-v4-opt) about
  $0.0065 to $0.0069; [anillustrious-v4](https://replicate.com/aisha-ai-official/anillustrious-v4)
  about $0.012 to $0.013. The two `wai-nsfw-illustrious` models sit between them.

### Per-action unit economics
| Action | Provider | Cost basis | Notes |
|--------|----------|-----------|-------|
| Image generation | Replicate | about $0.0065 to $0.013 per run for four of the registry's image models | seedream-4.5 and Titan Image v2: no price found. A comment in `agent-cost.js` assumes $0.05 per image and no code path uses it; the Sanctum usage view (`backend/routes/ops/usage-helpers.js`) has a third set of rates, $0.003 to $0.005 per Replicate image and $0.01 for Titan |
| Agent turn | Bedrock Haiku 4.5 | Bedrock rate unconfirmed; on the Anthropic API list, about $0.005 for an assumed 3k input + 400 output tokens | arithmetic on the Anthropic list, not a Bedrock price |
| Music / video | Replicate | no price found for the default video models; music not checked | "cents per job" is an assumption |
| DynamoDB / S3 / Lambda / CloudFront | AWS | not checked | assumed ~$0 per user |

### Worst case at the caps (arithmetic, not measurement)
The two per-image figures disagree. This doc's earlier estimate was about $0.011 per image;
the code comment says "50 ≈ $2.50/day at $0.05/image". The Replicate pages above show about
$0.0065 to $0.013, well under the comment's figure and bracketing the earlier one.

| Vector | Cap | Per month at the cap |
|--------|-----|---------------------|
| Images | 50/day × 30 = 1,500 images | $75 at the comment's $0.05; about $10 to $20 at $0.0065 to $0.013 |
| Tokens (Anthropic list, Haiku 4.5) | 200k tokens/day, input + output | $0.20/day if all input, $1.00/day if all output: $6 to $30 |
| Tokens (Sanctum's UI rates, $0.80 in / $4.00 out per million) | same cap | $0.16 to $0.80/day: $4.80 to $24 |

The token cap counts input plus output tokens, so it is a token ceiling, not a dollar ceiling.
Output costs 5 times input on both rate sets. Adding the vectors, an adversarial user at
both caps lands at roughly $16 to $50 per month before infrastructure on the page prices, or
$81 to $105 on the comment's $0.05 per image.

**Takeaway for an interviewer:** the cost story is *bounded in counts and per-user observable*,
and honest about what is not yet bounded in dollars. `AGENT#COST` records real token spend per
user, surfaced in the Sanctum dashboard with a live USD estimate. Both spend vectors (tokens,
images) have daily ceilings, but the ceilings are counts. Sanctum's estimate uses hard-coded
rates ($0.80 / $4.00 per million) that differ from the Anthropic list above. The daily
counters are not atomic (§7). Fixing both is roadmap item 7.

---

## 9. Security posture

- **Auth:** Cognito JWT on every protected route; `getUserFromRequest` resolves
  `isAdmin` from `cognito:groups` across all three claim paths (REQUEST authorizer,
  legacy claims, unsigned fallback).
- **Object isolation:** every user media operation is scoped to `users/{sub}/`; cross-prefix
  access is rejected. The shared gallery lives under `shared/images/` and `shared/videos/`; its two list routes (`GET /s3/shared/images`, `GET /s3/shared/videos`) apply no `requireUserMiddleware`. User content is served only via expiring signed URLs.
- **Admin endpoints** (`/api/admin/agent/*`) sit behind `requireUser` + `requireAdmin`.
- **Prompt-injection hardening:** any value that re-enters the system prompt (the prefs)
  is validated on read and write. Model-written compaction summaries also re-enter the
  prompt; the golden set has 5 injection cases and none targets that path.
- **Abuse limits:** token bucket + daily token cap + daily image cap, all per user. The caps are
  counts and the daily counters are not atomic (§7, §8).
- **Companion safety:** the companion prompt instructs the agent to refuse admin operations,
  and the fleet has no admin tool. Nothing server-side checks the active mode.
- **Known gap, CI supply chain:** the AI workflows carry a Claude OAuth token, and
  `pr-review.yml` has `id-token: write`. Actions are pinned to movable tags such as
  `actions/checkout@v4` and `anthropics/claude-code-action@v1`. Pinning to commit SHAs is on the roadmap.

---

## 10. Engineering practices

| Practice | Detail | Rationale (ADR) |
|----------|--------|-----------------|
| Routers off one hub | 30 route modules registered in one file: 14 mounted as Routers, 16 registering on `app` | [ADR-001](./adr/001-express-router-migration.md) |
| `node:test`, not Jest (backend) | zero-dep, native runner | [ADR-002](./adr/002-node-test-over-jest.md) |
| Hand-built CSS system | `skr-` tokens, no Tailwind | [ADR-003](./adr/003-css-design-system-over-tailwind.md) |
| Flat `deps` DI object | testable, framework-free | [ADR-004](./adr/004-flat-deps-shape.md) |
| 500-line file cap | CI-enforced, forces decomposition | [ADR-005](./adr/005-file-length-limit.md) |
| Single `main` branch | backend + frontend + CDK consolidated | [ADR-006](./adr/006-branch-consolidation.md) |
| Companion panel pattern | over a Hiyori "corner" (frontend part superseded by ADR-009) | [ADR-007](./adr/007-companion-panel-over-hiyori-corner.md) |
| Single design, single stack | design variants removed | [ADR-008](./adr/008-remove-design-variants.md) |
| One companion surface | agent mode folded into the Live2D-central drive | [ADR-009](./adr/009-fold-agent-mode-into-companion.md) |
| Runtime aesthetic | Obscura default, Sakura Bloom switchable | [ADR-010](./adr/010-obscura-runtime-aesthetic.md) |

**Workflows** (`.github/workflows/`)

| Workflow | What it does |
|----------|--------------|
| `ci.yml` | jobs `backend`, `frontend`, `file-length` on push/PR to `main`; steps include lint, format check, typecheck, tests and the credential-free agent-eval replay |
| `nightly-eval.yml` | daily agent eval, off by default (manual run, or repo variable `ENABLE_NIGHTLY_EVAL`); skips while the `EVAL_AWS_*` secrets are absent |
| `pr-review.yml` | Claude reviews non-draft, same-repo PRs |
| `drift-check.yml` | weekly, off by default (manual run, or repo variable `ENABLE_DRIFT_CHECK`) and capped at USD 1 per run: Claude compares `ai-context.md` and `api-spec.md` with the code and opens a "Docs drift" issue. It does not cover this doc |
| `dev-kit.yml` | issue label `dev-kit:plan` opens a draft PR; a PR label triggers implement and review, owner-only |

- **Deploy** is one command and self-verifying: build → CDK deploy → Live2D `s3 sync` →
  6-check post-deploy sanity → 10-check Playwright UI smoke.
- **Lint/format:** ESLint + Prettier on both halves; `src/styles/` excluded from Prettier
  (compact single-line CSS notation).
- **Types and evals:** frontend TypeScript migration in progress (§3.4); agent evals gate CI (§6.4).
- **Repo hygiene:** committed test credentials were removed, and a `CLAUDE.md` guides agent sessions.

---

## 11. Documentation map

Navigation hub: [`docs/README.md`](./README.md) — organises docs by audience (human / AI) × depth (brief / detailed).

| Doc | Purpose |
|-----|---------|
| [`state-of-the-art.md`](./state-of-the-art.md) | this file — the interview overview (human deep dive). Not covered by the weekly drift check |
| [`architecture.md`](./architecture.md) | authoritative architecture + diagrams + deploy + data model |
| [`ai-context.md`](./ai-context.md) | dense agent reference — paths, DynamoDB namespaces, invariants |
| [`api-spec.md`](./api-spec.md) | full endpoint inventory (public / user / admin) |
| [`architecture-current`](./architecture-current.svg) · [`agent-turn-loop`](./agent-turn-loop.svg) | rendered diagrams (`.svg`/`.png` from `.mmd`) |
| [`adr/001`–`010`](./adr/) | the ten decisions behind the design |
| [`proposals/`](./proposals/) | Agent Mode v0, Companion Mode v0, the AI-SDLC pilot plan ([`ai-sdlc-pilot.md`](./proposals/ai-sdlc-pilot.md)) and the evidence behind the roadmap ([`roadmap-2026-11.md`](./proposals/roadmap-2026-11.md)) |
| [`archon/`](./archon/) | twin docs for engineers and agents; today one, the job spine |
| [`testing.md`](./testing.md) | quality gates + how to run them |
| `AGENTS.md` / `CONTRIBUTING.md` | collaboration rules + PR checklist |

---

## 12. Roadmap, ranked

Ranked on two lenses, interview showcase and real product, each scored 1 to 5. Rank is the sum;
ties go to the smaller effort.
The evidence for each item, the code defects found and the drift left in other docs are in
[`proposals/roadmap-2026-11.md`](./proposals/roadmap-2026-11.md).

- Stream agent turns end to end (ConverseStream through a Lambda streaming handler behind API Gateway REST response streaming) so the first token shows while the turn is still running; this replaces the Lambda Function URL plan.
- Move the agent default from Haiku 4.5 to Haiku 5.5, gated by the replay and live evals, with adaptive thinking switched off under the 400-token output cap.
- Make story illustrations character-consistent with a multi-reference image model such as Nano Banana Pro, starting from the empty `image_input` slot already in the registry.
- Harden the agent evals with repeated trials (pass^k), separate capability and regression suites, and a transcript review before a score is trusted.
- Map the agent's defences to the OWASP Top 10 for Agentic Applications and grow the injection and memory-poisoning cases in the golden set.
- Leave Create React App for Vite and Vitest, which also unblocks the TypeScript upgrade.
- Close the cost-cap gaps: make the daily token and image counters atomic, bound spend in dollars rather than tokens, and reconcile the per-image price.
- Pin every GitHub Action to a commit SHA, since the AI workflows hold a Claude token on a public repo.
- Trace each agent turn with OpenTelemetry GenAI spans (model call, tool, closing turn) shipped to CloudWatch.
- Give Hiyori one consistent server-side voice with expressive text-to-speech in place of the browser speechSynthesis voice.

**Parked, from the proposals.** Companion Mode v1 has seven more tools waiting: `open_story_session`,
`read_scene`, `share_image`, `unshare_image`, `delete_image`, `change_brightness` and `sign_out`.
Also parked: tailored frontend cards for `view_my_creations` and `what_can_you_do` (today they fall
through to the generic `ToolResultPanel`), mobile polish, vision input, an always-on mic and a
"tell me a story" tool. Agent Mode still wants more manga panel primitives and `--ar 3:4`
shorthand parsing. Open job-spine items: the agent's job row stores no `poll`, `getJob` scans
up to 500 jobs, and `queryMediaItems` does not paginate.

**Shipped since the last snapshot**

| Item | What shipped | Evidence |
|------|--------------|----------|
| Split of `story/illustration-routes.js` | now 300 lines, with four new modules split out | commit `3c01bb2` |
| Backend coverage | all-files line coverage 86.11% (includes test and helper files, so the lib-and-routes figure is lower); weakest route files are `replicate-video-routes.js` 22.03%, `civitai-image-routes.js` 30.15%, `lora/profile-routes.js` 28.81% | commit `b9dcf48`, `npm --prefix backend test -- --experimental-test-coverage` |
| Job spine | one `JOB#` record per asynchronous generation, `GET /jobs`, client resume from the server feed | commits `4f8c1f8`, `717139e` |
| Agent evals | golden set, scorer, judge, replay tier in CI, nightly workflow | commits `28d3a70`, `f42e7c2` |
| CI workflows | AI PR review, weekly drift check, nightly eval, dev-kit | commits `f42e7c2`, `dc51529` |
| TypeScript start | 23 `.ts` + 7 `.tsx` files, `tsc --noEmit` in CI | commit `173e9bf` |

---

## 13. Interview talking points (the "why")

- **Why fully serverless?** The product has spiky, low-baseline traffic. Per-request
  billing means idle cost ≈ $0 (an assumption: billing modes are verified, dollars are not),
  and the absence of NAT/ALB/RDS removes the usual fixed monthly floor. Trade-off accepted:
  cold starts, which matter little for a creative tool. The cost of the choice today is that
  `serverless-http` buffers responses, so streaming needs a different handler (§12).
- **Why a single DynamoDB table?** All access patterns are user-partitioned key lookups;
  SK namespacing covers media, memory, limits, and config without a GSI. Most counters use
  atomic `ADD`. The daily-cap counters are the known exception: a read-then-`SET` that can lose an
  update under concurrency. I would fix that first (roadmap item 7).
- **Why hand-rolled DI and `node:test`?** Minimize dependencies on a Lambda where cold-start
  weight and supply-chain surface both matter. The flat `deps` object makes every route a
  pure function of its inputs — tests just pass a mock object.
- **Why cap images separately from tokens?** They're different cost vectors with different
  abuse profiles; independent counters let each roll over and be tuned on its own. Both caps
  are counts. The token cap is a token bound, not a dollar bound, and I say so.
- **Why validate prefs on read?** The value flows back into the system prompt — treating
  stored state as untrusted closes a self-injection loop most apps miss.
- **Why two modes off one backend?** The expensive part (tools, memory, limits, providers)
  is written once; dashboard and the companion drive are two presentations of the same engine.
  The standalone agent panel was folded into the Live2D-central companion drive so there is one
  character-driven surface instead of two overlapping ones (ADR-009).
- **How do you change the agent model safely?** Behind the evals. A 52-case golden set replays
  with no credentials in CI and the gate fails if the pass rate falls below the baseline. A model
  swap is a diff in the eval score, not a feeling (§6.4, roadmap item 2).
- **What is the job spine for?** Four providers behave differently, so one normalised job record
  gives the dashboard, the agent and Sanctum a single place to ask "what is running?" and lets
  the client resume after a reload (§3.5).
- **What is the honest cost story?** Bounded in counts, observable per user, not yet bounded in
  dollars, and the cost UI uses its own hard-coded rates. I would say what I would fix first and why:
  an atomic counter and a dollar bound (§8).
