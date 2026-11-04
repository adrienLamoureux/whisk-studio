---
title: Job spine — one record for every generation
id: job-spine
doc_type: module
summary: How every image, video, illustration, animation and music generation is tracked as one JOB row that the UI resumes from after a reload.
status: current
updated: 2026-10-26
audience: software engineers
source_commit: 617a159
scope: [backend/lib/jobs.js, backend/routes/jobs-routes.js, backend/routes/story/scene-jobs.js, frontend/src/lib/polling/useResumableJob.js]
tags: [jobs, generation, polling, resume, dynamodb, replicate, bedrock]
aliases: [job store, jobStore, media job, generation job, job feed, active jobs]
related: [docs/architecture.md, docs/api-spec.md]
html_twin: job-spine.html
---

# Job spine — one record for every generation

## TL;DR
- Every async generation is one DynamoDB row: `pk = USER#<userId>`, `sk = JOB#render/<provider>/<kind>/<providerRef>` (`backend/lib/jobs.js:12-17`).
- Status is always one of `queued | running | completed | failed`; provider words are mapped by `normalizeJobStatus` (`backend/lib/jobs.js:28-50`).
- `GET /jobs?active=1` lists non-terminal jobs; the frontend resumes from it, so the client stores no job state (`backend/routes/jobs-routes.js:20-32`, `frontend/src/lib/polling/useResumableJob.js:16-46`).
- Each resumable job carries a `poll` object: the exact params its provider status endpoint needs.
- Two write paths coexist: `jobStore.createJob/updateJob` (Bedrock video, story media) and direct `putMediaItem(type "JOB")` (Replicate, CivitAI, agent, ops). `normalizeJobItem` makes both read the same.

## Job record shape
- Key: `pk = USER#<userId>` (`backend/lib/keys.js:10`), `sk = JOB#<key>` (`backend/lib/keys.js:11`).
- `key = render/<provider>/<kind>/<providerRef>`; missing parts become `unknown`, a missing ref becomes `Date.now()` (`backend/lib/jobs.js:54-55`).
- Fields: `jobId, key, kind, provider, providerRef, status, progressPct, etaSeconds, parent, poll, result, error, startedAt, updatedAt, completedAt` (`backend/lib/jobs.js:60-78`).
- `jobId` format: `job-<base36 time>-<6 random chars>` (`backend/lib/jobs.js:57`). Legacy rows have no `jobId`; reads fall back to `key`.
- `parent = {sessionId, sceneId}` for story scene media, else `null` (`backend/routes/story/scene-jobs.js:13-21`).
- `result = {key, url}` once media is stored (`backend/routes/story/animation-routes.js:187-193`).
- `entityType` duplicates `kind` so the admin Job Queue keeps grouping rows (`backend/lib/jobs.js:113-115`).

## Job status lifecycle
- Values: `queued`, `running`, `completed`, `failed` (`backend/lib/jobs.js:28-33`).
- Mapping in `normalizeJobStatus` (`backend/lib/jobs.js:41-50`):
  - `starting processing in_progress inprogress running` → `running`
  - `queued pending ""` → `queued`
  - `succeeded completed done success` → `completed`
  - `failed error cancelled canceled` → `failed`
  - anything else → `queued`
- Terminal: `completed`, `failed` (`backend/lib/jobs.js:35`). `updateJob` stamps `completedAt` on a terminal transition (`backend/lib/jobs.js:143`).
- There is no `cancelled` status: a cancel reads as `failed`.

## Job store API (`createJobStore`)
- Built once in `backend/lib/build-deps.js:206-209` from `mediaStore.putMediaItem` and `mediaStore.queryMediaItems`; exposed as `deps.jobStore`.
- Without those deps it returns a no-op store (`null` / `[]`), so callers never crash in tests (`backend/lib/jobs.js:81-91`).
- `createJob({userId, kind, provider, providerRef, status, progressPct, etaSeconds, parent, meta})` — writes a new row, returns the normalised job; `meta` is spread into the row (that is how `poll` gets in) (`backend/lib/jobs.js:94-128`).
- `updateJob({userId, job, status, progressPct, etaSeconds, result, error})` — rewrites the whole row from `job` plus patches; needs `job.key` (`backend/lib/jobs.js:131-147`).
- `listJobs({userId, activeOnly, limit = 50})` — queries all `JOB#` rows, sorts by `startedAt` desc, filters, slices (`backend/lib/jobs.js:154-162`).
- `getJob({userId, jobId})` — loads up to 500 jobs and matches `jobId` or `key` (`backend/lib/jobs.js:164-168`).

## HTTP endpoints
| Endpoint | Auth | Returns | Ref |
|---|---|---|---|
| `GET /jobs?active=1&limit=N` | `requireUserMiddleware` | `{jobs, activeOnly}`; `limit` clamped to 1-200, default 50 | `backend/routes/jobs-routes.js:20-32` |
| `GET /jobs/:jobId` | `requireUserMiddleware` | `{job}` or 404 `Job not found` | `backend/routes/jobs-routes.js:34-45` |

- `active` accepts `1` or `true`. Both routes return the `MEDIA_TABLE` env error if the table is unset.
- Mounted at `/` in `backend/routes/index.js:34`.
- Provider status routes (for example `/replicate/image/status`, `/bedrock/nova-reel/job-status`) still do the live poll of one job; `/jobs` is for discovery.

## Producers (who writes JOB rows)
| Producer | Write path | `poll` stored | Ref |
|---|---|---|---|
| Replicate image | direct `putMediaItem` | yes | `backend/routes/replicate-image-routes.js:257-279` |
| Replicate video | direct `putMediaItem` | yes | `backend/routes/replicate-video-routes.js:237-277` |
| CivitAI image | direct `putMediaItem` | no | `backend/routes/civitai-image-routes.js:238` |
| Agent `generate_image` tool | direct `putMediaItem` | no [unverified] | `backend/lib/agent-tools/generate-image.js:224` |
| Bedrock Nova Reel video | `jobStore.createJob`, status `running` | yes | `backend/routes/bedrock-image-video-route.js:167-174` |
| Story animation | `startSceneJob` / `settleSceneJob` | no | `backend/routes/story/animation-routes.js:167-193` |
| Story music | `startSceneJob` / `settleSceneJob` | no | `backend/routes/story/music-routes.js:131-153` |
| Story illustration | `startSceneJob`, already `succeeded` (synchronous) | no | `backend/routes/story/illustration-routes.js:410-418` |
| Ops dashboard actions | direct `putMediaItem` | no | `backend/routes/ops/dashboard-routes.js:170-285` |

- Scene helpers live in `backend/routes/story/scene-jobs.js`: `startSceneJob` hard-codes `provider: "replicate"`; `findSceneJob` looks a job up by its key `render/replicate/<kind>/<predictionId>`; `settleSceneJob` forwards to `updateJob`.

## Resume flow (frontend)
1. A generation hook mounts and calls `useResumableJob({apiBaseUrl, kind, enabled, onResume})` (`frontend/src/lib/polling/useResumableJob.js:16`).
2. The hook calls `listActiveJobs` → `GET /jobs?active=1` (`frontend/src/services/jobs.js:7-12`).
3. It picks the newest job of that `kind` that has a `poll` object (`frontend/src/lib/polling/useResumableJob.js:35-36`).
4. It calls `onResume(job)` at most once per mount (`frontend/src/lib/polling/useResumableJob.js:38-39`).
5. The caller re-arms its provider poll from `job.poll`:
   - image: `startImagePolling({provider, params: job.poll})` (`frontend/src/pages/whisk/hooks/useImageGeneration.js:191-203`)
   - video: restores `invocationArn` (Bedrock) or `predictionId` (Replicate) state, which re-triggers the poll effects (`frontend/src/pages/whisk/hooks/useVideoGeneration.js:375-392`)
- Errors and anonymous users resolve to "nothing to resume" (`frontend/src/lib/polling/useResumableJob.js:30-33`).
- Replaced: the per-tab sessionStorage cache `frontend/src/lib/polling/jobStore.js`, deleted in commit `717139e`.

## Adding a job producer
1. On start: `deps.jobStore.createJob({userId, kind, provider, providerRef, status, meta: {poll: {...}}})`.
2. `poll` holds every param the provider status route needs to resume the job.
3. On finish: `deps.jobStore.updateJob({userId, job, status, result})` with `completed`, or with `failed` and `error`. An unsettled job stays in the active feed.
4. Frontend: `useResumableJob({apiBaseUrl, kind, onResume})`; re-arm the provider poll from `job.poll` in `onResume`.

## Invariants
- Job `status` stored or returned is always a `JOB_STATUS` value; provider vocabulary must not pass `normalizeJobStatus` (`backend/lib/jobs.js:19-21`).
- The client never writes job state; the server feed is the only source of truth for "what is running".
- A job is resumable only if it has `poll`; a producer that wants resume must store every param its status endpoint needs.
- New producers should use `jobStore.createJob/updateJob` (or the scene helpers), not hand-rolled `putMediaItem` rows [inferred: direction of the 2026-07 refactor].

## Gotchas
- Bedrock video jobs are never settled: `/bedrock/nova-reel/job-status` (`backend/routes/bedrock-routes.js:27`) does not touch the job row, so the row stays `running` and keeps appearing in `GET /jobs?active=1`. Effect: `useVideoGeneration` may resume a finished Bedrock job on every load [inferred].
- CivitAI image rows have no `poll`, so `useResumableJob` skips them although `useImageGeneration` has a `civitai` branch (`frontend/src/pages/whisk/hooks/useImageGeneration.js:199`).
- `getJob` is a scan: it lists up to 500 jobs and filters in memory (`backend/lib/jobs.js:166`). There is no GetItem by `jobId`.
- `queryMediaItems` does not paginate (`backend/lib/media-store.js:37-51`): users with more than 1 MB of JOB rows get a truncated list [inferred].
- `updateJob` writes the full row from the `job` you pass: pass the normalised job you read, or fields you omit are lost (`backend/lib/jobs.js:135-145`).
- Story scene media still keeps its own status fields on the `STORY_SCENE` item; the job row mirrors it, it does not replace it.

## Code map
| Path | Role |
|---|---|
| `backend/lib/jobs.js` | job store, status vocabulary, read-side normaliser |
| `backend/routes/jobs-routes.js` | `GET /jobs`, `GET /jobs/:jobId` |
| `backend/routes/story/scene-jobs.js` | start / find / settle helpers for story media |
| `backend/lib/media-store.js` | `putMediaItem`, `queryMediaItems` (DynamoDB access) |
| `frontend/src/services/jobs.js` | `listActiveJobs`, `listJobs`, `getJob` clients |
| `frontend/src/lib/polling/useResumableJob.js` | resume-on-mount hook |
| `backend/test/jobs.test.js`, `backend/test/jobs-routes.test.js` | unit + route tests |

## Glossary
- `JOB` row — the DynamoDB item that tracks one generation. Aliases: media job, generation job.
- `providerRef` — the provider's own id: Replicate `predictionId`, Bedrock `invocationArn`, CivitAI `token`.
- `poll` — the param bag a provider status endpoint needs to resume a job.
- Job feed — `GET /jobs?active=1`.
- Terminal — `completed` or `failed`; a terminal job never appears in the active feed.

## Open questions
- Should Bedrock video settle its job in `/bedrock/nova-reel/job-status`? [unverified: no ticket found]
- Does the agent `generate_image` row store `poll`? Line 224 writes the row; contents not checked [unverified].

## Sources
- `backend/lib/jobs.js:1-188` — store, statuses, normaliser
- `backend/routes/jobs-routes.js:1-48` — HTTP surface
- `backend/routes/story/scene-jobs.js:1-41` — scene helpers
- `frontend/src/lib/polling/useResumableJob.js:1-46` — resume hook
- `backend/routes/bedrock-routes.js:27` — status route without job update
- Commits `4f8c1f8` (job record) and `717139e` (server-driven resume)
