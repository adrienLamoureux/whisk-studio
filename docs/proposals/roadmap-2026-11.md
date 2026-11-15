# Roadmap proposals — November 2026

> Written 2026-11-15 against `main` at commit `63471ff`.
> This is the evidence behind [`state-of-the-art.md` §12](../state-of-the-art.md): what an audit of
> the repo found, the ten ranked proposals, the code defects it turned up, and the drift left in
> other docs. Nothing here is built yet. No code was changed to produce it.

## 1. The answer first

- **The old overview had drifted.** Of 158 factual claims in the June snapshot of
  `state-of-the-art.md`, 118 held, 26 were wrong and 14 could not be checked. The file was rewritten
  and re-audited: 216 claims, each with a `path:line` or a command as evidence.
- **Ten proposals are ranked** in section 2, on two lenses: what shows engineering depth in an
  interview, and what helps the real product.
- **Both daily spend caps can under-count** under concurrent requests (section 4). This is the one
  finding that touches money. It is proposal 7.
- **Six other docs still carry old facts** (section 5). They were left alone on purpose.

How the review was done: every claim in the overview was checked against the code; 40 improvement
candidates were collected from public sources and from the repo's own backlog; each was scored 1 to 5
on both lenses. The working files (claims inventory, candidate tables, price notes) are local and not
committed. Ids such as `AG-01`, `EP-03` and `D-10` are their row labels, kept here so a finding can be
traced back to them.

## 2. Ranked proposals

Rank is showcase plus product. Ties go to the smaller effort.
Effort: S is up to a day, M up to a week, L longer.

| # | Proposal | Showcase | Product | Effort | Ids |
|---|----------|----------|---------|--------|-----|
| 1 | Stream agent turns end to end | 5 | 5 | M | AG-01, D-07 |
| 2 | Move the agent default from Haiku 4.5 to Haiku 5.5, gated by the evals | 4 | 5 | S | AG-02 |
| 3 | Character-consistent story illustrations | 5 | 4 | M | AG-11 |
| 4 | Harden the agent evals | 5 | 4 | M | EP-03 |
| 5 | Map the agent's defences to the OWASP agentic top 10 | 5 | 4 | M | EP-11 |
| 6 | Leave Create React App for Vite and Vitest | 4 | 5 | L | EP-06 |
| 7 | Close the cost-cap gaps | 3 | 5 | S | D-10, D-17, D-18 |
| 8 | Pin every GitHub Action to a commit SHA | 4 | 4 | S | EP-08 |
| 9 | Trace each agent turn with OpenTelemetry | 5 | 3 | M | EP-02 |
| 10 | One consistent server-side voice for Hiyori | 4 | 4 | M | AG-15 |

### Why each one

1. **Stream agent turns.** The agent route blocks on one `ConverseCommand`
   (`backend/routes/agent-route.js:274`) behind a 120-second Lambda. API Gateway REST APIs can now
   stream Lambda responses
   ([AWS, 2025-11-19](https://aws.amazon.com/about-aws/whats-new/2025/11/api-gateway-response-streaming-rest-apis)),
   so the older Lambda Function URL plan is no longer needed. Catch: `backend/lambda.js` uses
   `serverless-http`, which buffers the whole response, so a streaming handler is required.
2. **Haiku 5.5.** The default model is a hardcoded Haiku 4.5 fallback
   (`backend/lib/agent-config.js:35`). The evals already exist to gate a change (`backend/evals/`,
   baseline 47 of 52). Haiku 5.5 lists Converse support
   ([Bedrock model card, 2026-10-07](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-haiku-5-5.html)).
   Adaptive thinking is on by default in 5.5 and the route caps output at 400 tokens, so thinking
   must be switched off or budgeted.
3. **Consistent illustrations.** The story pipeline has no reference-image mechanism.
   `backend/config/models.js:70` already exposes an unused, empty `image_input` for `seedream-4.5`,
   so a first version needs no new model. Multi-reference models such as Nano Banana Pro take up to
   14 input images ([Google, 2025-11-20](https://blog.google/technology/ai/nano-banana-pro)).
4. **Harder evals.** `backend/evals` records one sample per case. The 90.4% baseline hides weak
   categories (`ambiguous` 4 of 6, `tool` 33 of 36), and CI only guards against a fall. Repeated
   trials and separate capability and regression suites are the current practice
   ([Anthropic, 2026-01-09](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)).
5. **OWASP mapping.** The `injection` category has 5 cases. Model-written memory summaries re-enter
   the prompt (`backend/lib/agent-memory.js`) and no case covers that path
   ([OWASP, 2025-12-09](https://genai.owasp.org/resource/2025-12-09/owasp-top-10-for-agentic-applications-for-2026)).
   It can ship together with proposal 4.
6. **Vite.** `react-scripts ^5.0.1` is unmaintained, and its peer range allows only TypeScript 3 or 4
   (`frontend/node_modules/react-scripts/package.json:88`). That blocks the compiler upgrade the
   TypeScript migration will need ([Vite 8, 2026-03-12](https://vite.dev/blog/announcing-vite8)).
7. **Cost caps.** See section 4. The fix is small and removes a real exposure.
8. **Pinned Actions.** Workflows use movable tags such as `actions/checkout@v4` and
   `anthropics/claude-code-action@v1` (`.github/workflows/pr-review.yml:41`). The AI workflows hold a
   Claude token and `id-token: write` on a public repo
   ([GitHub, 2026-03-26](https://github.blog/news-insights/product-news/whats-coming-to-our-github-actions-2026-security-roadmap/)).
9. **Tracing.** Per-user spend is recorded in `AGENT#COST`, but there is no per-turn latency or tool
   trace. The OpenTelemetry GenAI conventions
   ([repository](https://github.com/open-telemetry/semantic-conventions-genai)) are still marked
   Development for agent spans, so the version must be pinned.
10. **Server-side voice.** The voice is whatever the browser provides
    (`frontend/src/lib/agent/useSpeech.js:38,65-70`), so Hiyori sounds different on every device.
    It needs a new audio route, S3 caching and a per-user cap like the image cap.

### Close calls, left off the list

- **Lyria 3.5 for scene scoring** (AG-12) and **interactive result cards in the MCP Apps style**
  (EP-16) tie with proposals 9 and 10. Either could replace one of them.
- **Speech-to-speech voice** (AG-16, EP-14) depends on proposal 1 and on a transport the REST API
  cannot carry.
- **Turning on the nightly live eval** (EP-04) is the best small operational item. It needs two AWS
  secrets and the repo variable `ENABLE_NIGHTLY_EVAL`.

## 3. Shipped since the June snapshot

These were on the old roadmap or missing from the overview. All are on `main`.

| Item | What shipped | Commit |
|------|--------------|--------|
| Split of `story/illustration-routes.js` | 300 lines now, four modules split out | `3c01bb2` |
| Backend route tests | all-files line coverage 86.11% (the figure includes test and helper files) | `b9dcf48` |
| Agent evals | 52-case golden set, scorer, judge, credential-free replay tier in CI | `28d3a70` |
| AI workflows | PR review, nightly eval and weekly docs drift check; the last two are off by default | `f42e7c2`, `0a24277` |
| dev-kit in CI | plan, implement and review from issue and PR labels | `dc51529` |
| TypeScript start | 23 `.ts` and 7 `.tsx` files, `tsc --noEmit` in CI | `173e9bf` |

## 4. Code defects found, not fixed

All in `backend/lib/agent-cost.js` unless stated. Proposal 7 covers the first, second, fourth, fifth
and sixth.

| Defect | Where | Impact |
|--------|-------|--------|
| The daily token counter `tokensToday` is read, summed in JavaScript, then written with `SET`. Only the lifetime counters use atomic `ADD`. | `:60-84` | Two concurrent turns can lose one update, so a user can pass the daily token cap. |
| The daily image counter `imagesToday` follows the same read-then-`SET` pattern. | `:121`, `:154-167` | Concurrent image requests can pass the 50-image daily cap. Images are the dominant cost. |
| The image cap fails open: if the read throws, the check allows the request. | `:128-130` | A DynamoDB error removes the cap on the costliest operation. The code states this as a choice, so it is a risk to accept knowingly, not a bug. |
| A comment prices an image at $0.05. | `:19-21` | The four default Replicate image models ran about $0.0065 to $0.013 per run on their public pages (fetched 2026-11-13 and 2026-11-14). The comment overstates exposure four to eight times. |
| The Sanctum cost view uses $0.80 input and $4.00 output per million tokens. | `frontend/src/pages/director/AgentCostSection.js:17-18` | The Anthropic API list gives Haiku 4.5 at $1 and $5 ([pricing page](https://platform.claude.com/docs/en/about-claude/pricing), fetched 2026-11-13). The repo calls Bedrock, whose rate was not confirmed. |
| The token cap counts tokens, not dollars. | `:74-75`, `:189` | At the Anthropic list rates, 200,000 tokens cost $0.20 if all are input and $1.00 if all are output. A model change moves the dollar value with no change to the cap. |

Two comments in the same file mislead:

- Line 11 says increments are atomic "so concurrent turns can't lose counts". True for the lifetime
  counters, false for the two daily counters that enforce the caps.
- Lines 185-186 call the 200k-token cap "~$0.20 at Haiku prices". True only if every token is input.

One more thing to look at: the two shared list routes, `GET /s3/shared/images` and
`GET /s3/shared/videos`, apply no `requireUserMiddleware`
(`backend/routes/media/shared-media-routes.js:65` and `:182`). Whether app-level or API Gateway
auth stands in front of them was not checked. If the shared gallery is meant to be public, nothing is
wrong.

## 5. Drift left in other docs

Reported, not fixed. The route counts below rest on `backend/routes/index.js:33-62`: 30 registered
modules, 14 mounted as an Express `Router` and 16 registering directly on `app`.

| Doc | Drift |
|-----|-------|
| `docs/architecture.md` | says 29 route modules and that all of them use the Router pattern; the route table omits `jobs-routes.js` and the five `routes/ops/*` sub-routers |
| `docs/architecture.md` | prefs miss `aesthetic`; the daily counters are called atomic; no `JOB#` record; "Live2D ~50 MB" (7.4 MB); coverage "~40%"; no mention of evals, TypeScript, the newer workflows or the job spine |
| `docs/ai-context.md` | "Agent tool fleet (9)" (the code has 10); tests 358 and 129 (now 495 and 167); "29 Router modules"; "every route module returns a Router"; prefs omit `aesthetic`; `PRESET#` shown as sort keys though they are partition keys; no Obscura |
| `docs/api-spec.md` | `GET /api/admin/agent/model` listed as public though it requires user and admin middleware; 14 registered endpoints have no entry; repeats the "$0.20" ceiling claim |
| `README.md`, `AGENTS.md` | "29 route modules", "9-tool fleet"; README lists ADRs 001-009 and no Obscura; AGENTS.md quality gates omit typecheck and the eval replay |
| `docs/README.md` | line 27 says "the 9 architecture decisions (001-009)"; there are ten |
| `IDEAS.md`, `ideas/dev/README.md`, `ideas/dev/STATUS.md` | "Sakura Bloom is the one and only design" contradicts ADR-010; file-length and coverage notes are stale |
| `docs/proposals/ai-sdlc-pilot.md` | says nothing has started; evals, PR review, the drift check, coverage and the TypeScript start have shipped |
| `docs/proposals/companion-mode-v0.md` | "a third `ModeContext` value" (two modes since ADR-009); "6 more tools" followed by 7 names |
| `CONTRIBUTING.md` | "each route module returns an Express `Router`; do not mutate `app` directly" — 16 of 30 modules register on `app` |

## 6. Internal backlog

46 backlog items were found across `IDEAS.md`, `IMPROVEMENTS.md`, `ideas/dev/`, the proposals and the
job-spine doc: 8 shipped, 8 partly done, 2 dropped, 28 open.

Open items worth knowing about, by source:

- `docs/proposals/companion-mode-v0.md`: seven more tools, tailored cards for `view_my_creations` and
  `what_can_you_do`, always-on mic, vision input, a "tell me a story" tool, mid-flight cancel, mobile
  polish.
- `docs/proposals/agent-mode-v0.md`: streaming (proposal 1), more manga panel primitives, `--ar 3:4`
  parsing.
- `docs/archon/job-spine.md`: Bedrock video jobs never settle; the agent `generate_image` job row and
  the CivitAI rows store no `poll`; `getJob` scans up to 500 jobs; `queryMediaItems` does not paginate.
- From the AI-SDLC pilot: no tolerance band below the 90.4% eval baseline, `judge.js` never run live,
  26 backend files without tests.

## 7. Limits of this review

- "216 of 216 verified" covers the audit's own inventory of the overview. A few sentences have no row.
- Bedrock rates for Claude Haiku were not confirmed from a public page. Every model price above is the
  Anthropic API list price and says so.
- The deployed stack was out of scope. No AWS, Replicate or Bedrock call was made.
- Auth on the shared list routes was checked at route level only.
- Line coverage of 86.11% is an all-files figure that includes test and helper files.
