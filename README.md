# Whisk Studio

Whisk Studio is an AWS-hosted AI creation platform with image, video, story, music, LoRA, and director workflows. The entire stack — backend, frontend (Sakura Bloom), and CDK infrastructure — lives on a single `main` branch.

## Product Capabilities
- Authenticated creative workspace for images, videos, stories, soundtracks, and LoRA profiles
- Two conversational modes (one backend): **Dashboard** (forms) and **Companion drive** —
  a full-viewport, Live2D-central surface where the character-led chat calls a 9-tool agent
  fleet via Bedrock Converse (refuses admin ops). The standalone agent panel was folded into
  the companion drive so there is one character-driven surface, not two (ADR-009)
- Shared image/video library with favorites and sharing flows
- Director operations for configuration, queue visibility, session pinning, and masonry asset management
- Story sessions with scene illustrations, animation, and per-scene music
- Multi-provider AI integrations through Bedrock, Replicate, CivitAI, and Gradio/HuggingFace
- Live2D companion (Hiyori) with contextual AI chat, emotion reactions, proactive prompts, and TTS

## Architecture At A Glance
1. CloudFront serves the Sakura Bloom React bundle and a generated `/config.json`.
2. The frontend resolves `apiBaseUrl` and Cognito settings from `/config.json` at startup.
3. The app authenticates through Cognito Hosted UI + PKCE.
4. API Gateway invokes the Lambda-wrapped Express backend.
5. Express routes persist metadata in DynamoDB and media in S3.
6. Backend routes call Bedrock, Replicate, CivitAI, and Gradio providers when needed.

See `docs/architecture.md` for the full route map, storage keys, and deployment.

## Repository Layout
- `backend/`: Express API, 29 route modules, auth, data access helpers, provider integrations
- `frontend/`: Sakura Bloom React app — Live2D companion, `skr-` CSS system, 10 themes, bottom HUD
- `cdk/`: infrastructure stacks plus `idea:*` helper scripts
- `ideas/`: per-idea context (`README`, `DECISIONS`, `RUNBOOK`, `STATUS`, `IMPROVEMENTS`, sometimes `cdk-outputs.json`)
- `docs/`: architecture, API spec, ADRs, and workflow docs
- `ai/`: optional research scripts/notebooks only (no runtime dependency)
- `IDEAS.md`: top-level registry of deployed idea stacks
- `AGENTS.md`: collaboration rules for future agents

## Backend Contract Summary
- Route registration: `backend/routes/index.js`
- 29 registered route modules exposing 73+ HTTP endpoints
- Major domains: prompt helper, media management and sharing, image generation, video generation, story sessions/illustration/animation/music, LoRA catalog and profiles, characters, companion (Hiyori), **agent mode** (turn/suggest/sessions/admin), director operations
- Critical invariant: `POST /story/sessions` and `GET /story/sessions/:id` both return `{ session, messages, scenes }` with `messages` and `scenes` at top level, not nested inside `session`

## Storage Model Summary
- DynamoDB single table with `pk` / `sk`
- User partition root: `USER#<cognito-sub>`
- Story session root: `SESSION#<sessionId>`
- Story message keys: `SESSION#<sessionId>#MSG#<timestamp>`
- Story scene keys: `SESSION#<sessionId>#SCENE#<sceneId>`
- S3 user isolation: `users/<cognito-sub>/`

## Deployment

Full stack (backend + Sakura frontend + CDK — all from `main`):
```bash
npm --prefix cdk run idea:deploy -- --stage=dev
```

Post-deploy validation is mandatory: `idea:deploy` runs sanity + UI smoke checks automatically.

## Live Stacks

| Idea ID | CloudFront | Notes |
|---------|------------|-------|
| `dev` | `d2l9b1xmucsb19.cloudfront.net` | Full stack — Sakura Bloom frontend (the only design) |

Shared test credentials: `test@test.com` / `Test1234567@`

API: `https://k002t5i8r9.execute-api.us-east-1.amazonaws.com/prod/`
Cognito domain: `whiskstudio-alx-dev-761593662432.auth.us-east-1.amazoncognito.com`

## Local Development

Install dependencies:
```bash
npm --prefix frontend install
npm --prefix backend install
npm --prefix cdk install
```

Run the frontend against the hosted dev stack:
```bash
npm --prefix cdk run idea:ui-local -- --stage=dev
```

Or run without a live stack (uses committed `frontend/public/config.json` as fallback):
```bash
npm --prefix frontend start
```

Useful flags for `idea:ui-local`: `--port=<port>`, `--print-env`, `--open`

Quick backend sanity check:
```bash
node -e "require('./backend/index')"
```

## Infrastructure Commands
```bash
npm --prefix cdk run build
npm --prefix cdk run idea:list
npm --prefix cdk run idea:deploy -- --stage=dev
npm --prefix cdk run idea:ui-local -- --stage=dev
npm --prefix cdk run idea:destroy -- --stage=dev
```

## Validation Rules
- Backend touched: `node -e "require('./backend/index')"`
- Frontend touched: `npm --prefix frontend run build`
- CDK touched: `npm --prefix cdk run build`
- Backend or CDK changes are not complete until the relevant stage deploy succeeds and both sanity and UI smoke pass

See `CONTRIBUTING.md` for the full quality gate table and PR checklist.

## Documentation Map
Start at **[`docs/README.md`](docs/README.md)** — the index that organises everything by audience
(human / AI) × depth (brief / detailed). Key entries:
- `docs/architecture.md`: detailed human reference — system layers, **diagrams**, data model, deployment modes
- `docs/state-of-the-art.md`: interview-framed deep dive — cost model, security, roadmap, the "why"
- `docs/ai-context.md`: dense agent reference — paths, DynamoDB namespaces, invariants
- `AGENTS.md`: collaboration rules and repo reality (AI brief)
- `CONTRIBUTING.md`: code style, quality gates, PR checklist
- `docs/api-spec.md`: full API contract (73+ endpoints, request/response shapes)
- `docs/testing.md`: how to run and write all test layers
- `docs/adr/`: architecture decision records (001–009)
- `frontend/ARCHITECTURE.md`: component tree, hook graph, CSS system

## Common Configuration
- `ADMIN_EMAIL`
- `SECONDARY_ADMIN_EMAIL`
- `ADMIN_TEMP_PASSWORD`
- `COGNITO_DOMAIN_PREFIX` or `COGNITO_DOMAIN_PREFIX_BASE`
- `FRONTEND_API_URL_OVERRIDE`
- `REPLICATE_API_TOKEN`
- `HUGGING_FACE_TOKEN`
- `BEDROCK_*`

Keep secrets in env or secret stores, never in committed files.

## Troubleshooting
- **Unauthorized after login**: check that the deployed `config.json` points to the matching API and Cognito pool; hard refresh and sign in again; clear the `whisk_auth_tokens` session storage key if token state is stale
- **Slow stack updates**: `BucketDeployment` and CloudFront invalidation can take several minutes
- **Seeding issues**: use `--source-stack=<stack-name>` when the source stack name does not follow stage naming
