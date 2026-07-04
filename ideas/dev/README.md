# dev (main branch)

## Objective
- Provide the full-stack source-of-truth branch for backend, frontend (Sakura Bloom), infrastructure, idea registries, and shared documentation.
- Deploy a production-grade React frontend with Live2D companion, 10 themes, and bottom HUD alongside the full backend.

## Design References
- The UI: Sakura Bloom — deep indigo + pink palette, 10 themes, glassmorphism surfaces. It is the
  one and only design; there are no design overlay variants.

## Scope
- In scope:
  - backend routes, helpers, auth, storage, and provider integrations
  - CDK stacks, deployment helpers, idea registry updates
  - shared docs and documentation
  - Sakura Bloom frontend (`frontend/src/`)

## Delivery Tracks
- Build track: backend, frontend, and CDK changes land here.
- Integration/QA track: deploy `dev`, run sanity and UI smoke, then document the result in `STATUS.md`.

## Functionalities
- All backend product capabilities:
  - image generation
  - video generation
  - story sessions and scene media
  - music library flows
  - LoRA catalog and profile management
  - character CRUD
  - director operations
- Full Sakura Bloom frontend exposing: `/` (Home), `/atelier` (Forge), `/chronicle` (Story), `/sanctum` (Director), `/lora`, `/music-library`, `/about`, `/login`, `/auth/callback`

## Architecture Touchpoints
- Backend:
  - `backend/routes/index.js`
  - `backend/lib/build-deps.js`
  - `backend/lib/auth.js`
  - `backend/lib/keys.js`
- Frontend:
  - `frontend/src/App.js`
  - `frontend/src/services/runtime-config.js`
  - `frontend/src/contexts/`
- CDK:
  - `cdk/bin/static-web-aws-ai-stack.ts`
  - `cdk/lib/static-web-aws-ai-stack.ts`
  - `cdk/scripts/idea-env.js`

## Contract Notes
- API changes:
  - land all backend contract changes here; keep frontend services in sync in the same PR
- Runtime config changes:
  - preserve the deployed `config.json` shape (`apiBaseUrl`, `cognito.domain`, `cognito.clientId`, `cognito.userPoolId`, `cognito.region`)
- Data model/storage changes:
  - preserve DynamoDB `USER#<sub>` partitioning and S3 `users/<sub>/` isolation

## Handoff Notes For Sub-Agents
- Current priority:
  - preserve backend and deployment correctness while improving documentation quality
- Known blockers:
  - `Story.js` (~443 lines) is approaching the 500-line limit — watch for further growth
  - low automated test coverage on some route groups
- Next smallest shippable increment:
  - keep shared docs and idea status files aligned with the deployed state before large new feature work begins
