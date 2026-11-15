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
  interview, and what helps the real product. Section 3 gives each one a solution outline and its
  runtime cost.
- **No proposal adds a fixed monthly cost.** The bill stays pay-per-use. The exposure to watch is
  video, which has no cap today (section 3.1).
- **Both daily spend caps can under-count** under concurrent requests, and the dashboard generation
  routes have no cap at all (section 5). Proposal 7 covers both.
- **Six other docs still carry old facts** (section 6). They were left alone on purpose.

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
| 2 | Upgrade models: Haiku 4.5 to 5.5 behind the evals, and newer Replicate image and video models | 4 | 5 | S to M | AG-02, AG-13, AG-14, AG-19 |
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
   must be switched off or budgeted. The same pass refreshes the Replicate image and video models
   (section 3.4); one of them, `seedance-1.5-pro`, no longer exists on Replicate.
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
7. **Cost caps.** See section 5. The fix is small and removes a real exposure. Section 3 widens it
   to the dashboard routes.
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

## 3. Architecture and runtime cost

Read on 2026-11-15. AWS figures come from the public AWS price list files for US East
(N. Virginia). Replicate figures come from public model pages; where a page shows no price this
says "not public". Anything computed is marked as an estimate. Nothing here was measured on the
deployed stack.

### 3.1 The cost answer first

- **No proposal adds a fixed monthly cost**, provided three traps are avoided: CloudWatch custom
  metrics and alarms (billed per metric-month and per alarm), provisioned capacity of any kind, and
  a voice provider sold as a monthly plan.
- **The stack has no fixed-cost resource today.** `cdk/lib/static-web-aws-ai-stack.ts` defines no
  alarm, custom metric, secret, NAT gateway, provisioned concurrency or provisioned throughput.
  What accrues without use is storage: S3 media at $0.023 per GB-month (the media bucket has no
  lifecycle rule), DynamoDB items, and 30 days of Lambda logs.
- **What really bounds the bill today is closed sign-up** (`selfSignUpEnabled: false`,
  `cdk/lib/static-web-aws-ai-stack.ts:142`), not the caps. The daily caps cover only the agent path.
  The dashboard routes that start paid generations check only that the caller is signed in:
  `/replicate/video/generate`, `/replicate/image/generate`, `/civitai/image/generate`,
  `/bedrock/nova-reel/image-to-video-s3`, and the story illustration, animation and music routes.
  A search of those files found no cap and no rate limit.
- **Video is the expensive unit, and the cost view under-reports it.** One clip costs from about
  $0.05 (Wan 2.2 at 480p) to about $0.80 (Veo 3.1 Fast, 8 seconds). The usage table prices a Wan job
  at $0.04 and a Kling job at $0.08, and has no entry for Veo, which falls back to $0.004
  (`backend/routes/ops/usage-helpers.js:12-37`).
- **The cheapest strong guard needs no code: Replicate prepaid credit with auto-reload off.**
  Replicate retired its monthly spend limit
  ([changelog, 2025-07-01](https://replicate.com/changelog/2025-07-01-set-a-monthly-spend-limit/)).
  With [prepaid credit](https://replicate.com/docs/topics/billing/prepaid-credit), new work stops
  when the balance reaches zero. Check in billing settings that the account is on prepaid credit:
  accounts opened before July 2025 may still be billed monthly.

Suggested order under a pay-as-you-go priority: proposal 7 first, widened to the dashboard routes
and the price table; then proposal 2; then proposal 1.

### 3.2 What one unit costs today

| Unit | Price | Source |
|------|-------|--------|
| Agent turn on Haiku 4.5 | about $0.009 (estimate) | Anthropic API list, $1 and $5 per million tokens |
| Agent turn on Haiku 5.5 | about $0.0009 (estimate) | Anthropic API list, $0.10 and $0.50 per million tokens |
| Image, the four anime SDXL models | $0.0065 to $0.013 per run | Replicate model pages |
| Image, `seedream-4.5` | not public; third-party listings say about $0.04 | Replicate page shows no price |
| Image, Titan Image Generator v2 | $0.008 to $0.012 | AWS price list |
| Video, `wan-2.2-i2v-fast`, 81 frames at 480p | $0.05 per video at launch; today's price not public | [Replicate, 2025-08](https://replicate.com/blog/wan-22) |
| Video, `veo-3.1-fast`, 8 s at 720p with audio | about $0.80, at Google's own $0.10 per second; Replicate's price not public | [Google price list](https://ai.google.dev/gemini-api/docs/pricing) |
| Video, `kling-v2.6`, 5 s | not public | Replicate page shows no price |
| Video, Nova Reel, 6 s | $0.48, at $0.08 per second | AWS price list |
| Lambda, 512 MB | $0.0000166667 per GB-second: a 10-second turn costs $0.00008 | AWS price list |
| API Gateway REST | $3.50 per million requests | AWS price list |
| DynamoDB on demand | $0.625 per million writes, $0.125 per million reads | AWS price list |

The agent-turn estimate assumes about 3,000 input tokens for the main call (tool specs and prompts
were sized at about 2,700 tokens during the review), the 400-token output cap, and a closing call of
about 3,400 input and 120 output tokens. The repo calls Bedrock. The AWS price list file has no
entry for Haiku 4.5 or 5.5, because Bedrock bills them through AWS Marketplace, so the Bedrock rate
stays unconfirmed until it is read from a bill.

### 3.3 Proposal by proposal

**1. Stream agent turns**

- Solution: API Gateway REST response streaming. No new service.
  - CDK: a second Lambda function from the same code asset, with a streaming handler, because
    `serverless-http` buffers (`backend/lambda.js`). Its integration sets
    `responseTransferMode: STREAM` and uses the `/response-streaming-invocations` URI
    ([AWS docs](https://docs.aws.amazon.com/apigateway/latest/developerguide/response-transfer-mode.html)).
  - Handler: `awslambda.streamifyResponse`, with `HttpResponseStream.from(...)` for the status and
    headers. Supported on the Node.js managed runtimes; the stack runs `NODEJS_22_X`.
  - Backend: replace `ConverseCommand` with `ConverseStreamCommand` in a shared turn function, and
    emit events for text, tool use, tool result, the closing line and the final usage. Keep the
    buffered route for the eval replay tier.
  - Frontend: the call at `frontend/src/lib/agent/AgentContext.js:245` becomes a streamed fetch.
- Limits: a stream can run 15 minutes. The idle timeout is 5 minutes on a Regional endpoint and
  30 seconds on an edge-optimized one. The stack sets no endpoint type, so it has the CDK default;
  if that is edge-optimized, send a heartbeat while a tool runs, or make the API Regional. Endpoint
  caching, content encoding and VTL response transforms do not work on a streamed integration.
- Runtime cost: unchanged per turn. A streamed response is billed in 10 MB increments, so a text
  turn is still one request. Lambda already waits for the model, so duration is the same. Streamed
  bytes cost $0.008 per GiB, with the first 100 GiB a month at $0 in the price list.
- Fixed monthly cost: none.
- Rejected: a WebSocket API ($1 per million messages plus $0.25 per million connection-minutes, and
  a connection table to maintain); a Lambda Function URL (no API Gateway charge, but the request
  authorizer does not apply, so auth must be rebuilt); any always-on container.
- Open point: the AWS pages read do not say whether a REQUEST authorizer and CORS behave the same
  on a streamed integration. Test that first.

**2. Model upgrades** — see 3.4 for the full table.

- Solution for the agent model: the default comes from `BEDROCK_PROMPT_HELPER_MODEL_ID`, else the
  hardcoded Haiku 4.5 id (`backend/lib/build-deps.js:154-159`, `backend/lib/agent-config.js:35`).
  The story model falls back to the same value. Sanctum can already override the agent model at
  runtime (`CONFIG#AGENT`), so the rollout needs no deploy: set the override, run `eval:live`,
  compare with the baseline, then change the default.
- Runtime cost: about ten times lower per turn on the Anthropic list. At the 200,000-token daily cap,
  a user costs $0.20 to $1.00 a day on Haiku 4.5 and $0.02 to $0.10 on Haiku 5.5.
- Fixed monthly cost: none.
- Open points: confirm the Bedrock rate from the first bill; switch adaptive thinking off under the
  400-token and 120-token output caps; put model rates in one table that both the backend and
  Sanctum read.

**3. Character-consistent illustrations**

- Solution: keep one or more reference images per story (S3 keys in the story state), and pass
  signed URLs to a model that accepts reference images. `seedream-4.5` already has the empty
  `image_input` slot (`backend/config/models.js:70`).
- Runtime cost per illustration:

  | Model | Price | Ten-scene story |
  |-------|-------|-----------------|
  | Anime SDXL models (today, no references) | $0.0065 to $0.013 | $0.07 to $0.13 |
  | `seedream-4.5` | not public; listings say about $0.04 | about $0.40 |
  | `seedream-5-pro` | $0.045 at 1K, $0.09 at 2K | $0.45 to $0.90 |
  | Nano Banana Pro | $0.134 at 1K or 2K on Google's own list; Replicate's price not public | about $1.34 |

- Fixed monthly cost: none. Reference images add a few megabytes of S3 storage.
- Open point: this is 3 to 20 times the current price per illustration. Make it opt-in per story and
  count it under the image cap.

**4. Harden the evals**

- Solution: a `--trials k` option in `backend/evals/run.js` for the live tier, a pass rate per case,
  capability and regression tags in the golden set, and a saved transcript for review. The replay
  tier stays deterministic.
- Runtime cost: the replay tier calls no model, so it is free. A live run of 52 cases costs about
  $0.47 on Haiku 4.5 (estimate), which matches the default cap `EVAL_MAX_USD` of $0.50. Three trials
  cost about $1.40, so the cap must be raised on purpose. On Haiku 5.5 the same runs cost about
  $0.05 and $0.14.
- Fixed monthly cost: none while the nightly job stays off, which is its default. Switched on with
  three trials, it would cost about $42 a month on Haiku 4.5 or $4 on Haiku 5.5 (estimate).

**5. OWASP agentic mapping**

- Solution: a table from each OWASP risk to the control that answers it (enum-validated prefs,
  cohort flags, confirmation before writes, the caps), plus new golden cases for memory poisoning
  through the compaction summary.
- Runtime cost: none. New cases run free in the replay tier and add one turn each to a live run.

**6. Vite and Vitest**

- Solution: swap the build tool, move the 23 Jest suites to Vitest, rename the six
  `process.env.REACT_APP_*` uses, and set the output folder to `build` so the CDK deployment path
  (`cdk/lib/static-web-aws-ai-stack.ts:569`) does not change.
- Runtime cost: none. Same S3 bucket and CloudFront distribution.

**7. Close the cost-cap gaps** — widened by this costing

- Solution:
  - One atomic `UpdateItem` per turn: `ADD` on a per-day counter, with the cap as a condition.
    This replaces the read-then-`SET` pair.
  - One daily budget per user in dollars, fed by a single price table, checked by one middleware on
    every route that starts a paid generation, dashboard routes included.
  - Fix the usage table: add `veo-3.1-fast` and `anillustrious-v4`, and price per-second models by
    clip length (Nova Reel is $0.08 per second, not per job).
  - Decide whether image and video checks should fail closed on a DynamoDB error.
  - Outside the code: Replicate prepaid credit with auto-reload off.
- Runtime cost: slightly lower. One write replaces a read and a write.
- Fixed monthly cost: none.

**8. Pin GitHub Actions**

- Solution: replace tags with commit SHAs, and let Dependabot's `github-actions` updates move them.
- Runtime cost: none. Watch item: `pr-review.yml` runs on same-repo PRs that are not drafts, so
  bot PRs would start AI reviews against the Claude plan unless they are excluded.

**9. Trace agent turns**

- Options:
  - A structured JSON log line per span, named after the OpenTelemetry GenAI attributes, queried with
    Logs Insights. No new dependency. Recommended first step.
  - OpenTelemetry spans exported to X-Ray. Adds a layer to the Lambda, which lengthens cold starts
    (not measured).
  - CloudWatch custom metrics. Rejected: $0.30 per metric-month, and a per-user dimension multiplies it.
- Runtime cost: logs cost $0.50 per GB ingested and $0.005 per GB scanned by a query. X-Ray stores
  the first 100,000 traces a month at $0, then $5 per million.
- Fixed monthly cost: none for the first two options. Alarms would add $0.10 each per month.

**10. Server-side voice**

- Solution: `POST /api/agent/speech` hashes the text and voice, returns a signed URL for
  `tts/<voice>/<hash>.mp3` if it exists, and otherwise calls the speech service, stores the audio in
  S3 and returns it. A daily character budget per user sits in the same counter as proposal 7.
  `useSpeech.js` falls back to the browser voice.
- Runtime cost with Amazon Polly: $16 per million characters for a neural voice, $30 for a
  generative one. At four characters per token (estimate), a 120-token closing line costs about
  $0.008 neural or $0.014 generative; a 400-token reply costs about $0.026 or $0.048.
- Fixed monthly cost: none with Polly. Any provider sold as a monthly plan breaks the priority.
- Open point: a spoken reply would cost more than the model turn itself, up to about 30 times more
  on Haiku 5.5. Speak only the closing line, and cap it. Replicate-hosted speech models were not priced.

### 3.4 Model upgrades, same family

Model lists were read from Replicate's public account pages on 2026-11-15. Run counts are as shown
there.

| In the registry | Newer in the same family | Price | Suggested move |
|-----------------|--------------------------|-------|----------------|
| Claude Haiku 4.5 (agent and story default) | Haiku 5.5 | $1 and $5, against $0.10 and $0.50, per million tokens (Anthropic list) | Upgrade behind the evals |
| `animagine-xl-v4-opt` (default image, 20.5M runs) | none; `animagine-xl-4.0` on the same account is the same generation | about $0.0065 to $0.0069 per run | Keep |
| `wai-nsfw-illustrious-v11` (590.9K runs) | `v12`, already in the registry; nothing newer on the account | about $0.0079, against $0.0074 to $0.0083 for v12 | Keep v12, consider dropping v11 |
| `anillustrious-v4` (2.2M runs) | none | about $0.012 to $0.013 per run | Keep; add it to the usage table |
| `seedream-4.5` (37.7M runs) | `seedream-5-lite` (3.6M runs), `seedream-5-pro` (855.2K runs) | 4.5 and 5-lite: not public. 5-pro: $0.045 at 1K, $0.09 at 2K | Add 5-lite after a priced test |
| `wan-2.2-i2v-fast` (default video, 15.3M runs) | `wan-2.5-i2v-fast` (78.4K), `wan2.6-i2v-flash` (97.5K), `wan-2.6-i2v` (50.5K), `wan-2.7-i2v` (99.5K; 720p or 1080p, 2 to 15 s, audio) | 2.2: $0.05 per 480p video at launch. Newer: not public | Test `wan-2.5-i2v-fast` first |
| `veo-3.1-fast` (894.6K runs) | none; 3.1 is the newest Veo on Replicate | not public; Google's own list is $0.10 per second at 720p | Keep; price it in the usage table |
| `kling-v2.6` (1M runs) | `kling-v3-video`, `kling-v3-omni-video` (reference images), `kling-v4.0`, `kling-v4-flash` (first-frame input) | v2.6: not public. v4.0: $0.157 per second at 720p. v4-flash: $0.094 per second | Test `kling-v4-flash`: $0.47 for 5 s |
| `seedance-1.5-pro` | **the model page returns 404.** Listed now: `seedance-2.0`, `-2.0-fast`, `-2.0-mini`, `seedance-2.5` | not public | Broken today: replace or remove |
| Titan Image Generator v2 (Bedrock) | Nova Canvas | $0.008 to $0.012, against $0.04 to $0.08 per image | Keep Titan; its retirement date was not checked |

Three checks before any default changes:

- **Price.** Most official Replicate models show no public price. Generate one test clip or image,
  read the charge in the Replicate dashboard, and write it into the usage table before the model is
  offered in the UI.
- **LoRA support.** The Wan 2.2 entry injects LoRA scales (`backend/config/models.js:316-318`). A
  newer hosted Wan model may not accept them.
- **Upstream releases.** Later WAI Illustrious checkpoints exist outside Replicate. They were not
  verified here. They would run through the CivitAI provider path, not this registry.

### 3.5 Summary

| # | Proposal | New fixed monthly cost | Cost per use |
|---|----------|------------------------|--------------|
| 1 | Streaming | none | unchanged per turn |
| 2 | Model upgrades | none | agent turn about ten times cheaper; video depends on a priced test |
| 3 | Consistent illustrations | none | 3 to 20 times today's price per illustration |
| 4 | Harder evals | none while the nightly job is off | $0.05 to $1.40 per live run (estimate) |
| 5 | OWASP mapping | none | none |
| 6 | Vite | none | none |
| 7 | Cost caps | none | slightly lower |
| 8 | Pinned Actions | none | none |
| 9 | Tracing | none without custom metrics or alarms | $0.50 per GB of logs; first 100,000 traces free |
| 10 | Voice | none with a pay-per-character service | $0.008 to $0.048 per spoken reply (estimate) |

## 4. Shipped since the June snapshot

These were on the old roadmap or missing from the overview. All are on `main`.

| Item | What shipped | Commit |
|------|--------------|--------|
| Split of `story/illustration-routes.js` | 300 lines now, four modules split out | `3c01bb2` |
| Backend route tests | all-files line coverage 86.11% (the figure includes test and helper files) | `b9dcf48` |
| Agent evals | 52-case golden set, scorer, judge, credential-free replay tier in CI | `28d3a70` |
| AI workflows | PR review, nightly eval and weekly docs drift check; the last two are off by default | `f42e7c2`, `0a24277` |
| dev-kit in CI | plan, implement and review from issue and PR labels | `dc51529` |
| TypeScript start | 23 `.ts` and 7 `.tsx` files, `tsc --noEmit` in CI | `173e9bf` |

## 5. Code defects found, not fixed

In `backend/lib/agent-cost.js` unless another path is given. Proposal 7 covers all but the last,
which is part of proposal 2.

| Defect | Where | Impact |
|--------|-------|--------|
| The daily token counter `tokensToday` is read, summed in JavaScript, then written with `SET`. Only the lifetime counters use atomic `ADD`. | `:60-84` | Two concurrent turns can lose one update, so a user can pass the daily token cap. |
| The daily image counter `imagesToday` follows the same read-then-`SET` pattern. | `:121`, `:154-167` | Concurrent image requests can pass the 50-image daily cap. |
| The image cap fails open: if the read throws, the check allows the request. | `:128-130` | A DynamoDB error removes the cap on the costliest operation. The code states this as a choice, so it is a risk to accept knowingly, not a bug. |
| A comment prices an image at $0.05. | `:19-21` | The four default Replicate image models ran about $0.0065 to $0.013 per run on their public pages (fetched 2026-11-13 and 2026-11-14). The comment overstates exposure four to eight times. |
| The Sanctum cost view uses $0.80 input and $4.00 output per million tokens. | `frontend/src/pages/director/AgentCostSection.js:17-18` | The Anthropic API list gives Haiku 4.5 at $1 and $5 ([pricing page](https://platform.claude.com/docs/en/about-claude/pricing), fetched 2026-11-13). The repo calls Bedrock, whose rate was not confirmed. |
| The token cap counts tokens, not dollars. | `:74-75`, `:189` | At the Anthropic list rates, 200,000 tokens cost $0.20 if all are input and $1.00 if all are output. A model change moves the dollar value with no change to the cap. |
| The dashboard generation routes have no cap. They check only that the caller is signed in. | `backend/routes/replicate-video-routes.js:54`, `replicate-image-routes.js:63`, `civitai-image-routes.js:112`, `bedrock-image-video-route.js:19`, `story/illustration-routes.js:43` | The daily caps apply to the agent path only. Closed sign-up is what bounds spend today. |
| The usage table under-prices video and misses two models. | `backend/routes/ops/usage-helpers.js:12-37` | `veo-3.1-fast` and `anillustrious-v4` fall back to $0.004. Nova Reel is priced $0.08 per job, though Bedrock bills $0.08 per second. The Sanctum usage view under-reports video spend. |
| The video model `bytedance/seedance-1.5-pro` returns 404 on Replicate. | `backend/config/models.js:358-360` | A request for that model is expected to fail. Read on 2026-11-13 and 2026-11-15. |

Two comments in the same file mislead:

- Line 11 says increments are atomic "so concurrent turns can't lose counts". True for the lifetime
  counters, false for the two daily counters that enforce the caps.
- Lines 185-186 call the 200k-token cap "~$0.20 at Haiku prices". True only if every token is input.

One more thing to look at: the two shared list routes, `GET /s3/shared/images` and
`GET /s3/shared/videos`, apply no `requireUserMiddleware`
(`backend/routes/media/shared-media-routes.js:65` and `:182`). Whether app-level or API Gateway
auth stands in front of them was not checked. If the shared gallery is meant to be public, nothing is
wrong.

## 6. Drift left in other docs

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

## 7. Internal backlog

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

## 8. Limits of this review

- "216 of 216 verified" covers the audit's own inventory of the overview. A few sentences have no row.
- Bedrock rates for Claude Haiku were not confirmed: the AWS price list file has no entry for them.
  Every model price above is the Anthropic API list price and says so.
- Most official Replicate models show no public price. Those rows say "not public". The Veo and
  Nano Banana Pro figures are Google's own list prices, read through a web search, not Replicate's.
- Runtime costs in section 3 marked "estimate" are arithmetic on list prices and assumed token
  counts. None was measured on the deployed stack.
- The deployed stack was out of scope. No AWS, Replicate or Bedrock call was made.
- Auth on the shared list routes was checked at route level only.
- Line coverage of 86.11% is an all-files figure that includes test and helper files.
