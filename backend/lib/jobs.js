"use strict";

/**
 * jobs — the single async-work record for every kind of generation.
 *
 * Before this module, "is my generation done?" had two persistence models
 * (a `type:"JOB"` row for plain image/video; status fields smeared onto the
 * STORY_SCENE item for story illustration/animation/music), three identifier
 * shapes (predictionId / invocationArn / token) and five status vocabularies.
 *
 * One record now covers all of them:
 *   pk = USER#{userId}
 *   sk = JOB#{key}          key = render/{provider}/{kind}/{providerRef}
 *
 *   { jobId, kind, provider, providerRef, status, progressPct, etaSeconds,
 *     parent: {sessionId, sceneId}|null, result: {key,url}|null, error,
 *     startedAt, updatedAt, completedAt }
 *
 * `status` is always one of JOB_STATUS below — provider vocabulary
 * (`starting`/`InProgress`/`succeeded`/…) is normalised at the boundary by
 * `normalizeJobStatus` and must never leak past it.
 *
 * Back-compat: rows written before this module carry `entityType` instead of
 * `kind` and no `jobId`; `normalizeJobItem` fills both in on read, so the
 * existing admin Job Queue keeps working untouched.
 */

const JOB_STATUS = Object.freeze({
  QUEUED: "queued",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
});

const TERMINAL_STATUSES = new Set([JOB_STATUS.COMPLETED, JOB_STATUS.FAILED]);

/**
 * Collapse any provider's status vocabulary into JOB_STATUS.
 * Mirrors (and replaces) the ad hoc normaliser in routes/ops/ops-helpers.js.
 */
const normalizeJobStatus = (status = "") => {
  const value = String(status).toLowerCase();
  if (["starting", "processing", "in_progress", "inprogress", "running"].includes(value)) {
    return JOB_STATUS.RUNNING;
  }
  if (["queued", "pending", ""].includes(value)) return JOB_STATUS.QUEUED;
  if (["succeeded", "completed", "done", "success"].includes(value)) return JOB_STATUS.COMPLETED;
  if (["failed", "error", "cancelled", "canceled"].includes(value)) return JOB_STATUS.FAILED;
  return JOB_STATUS.QUEUED;
};

const isTerminal = (status) => TERMINAL_STATUSES.has(normalizeJobStatus(status));

const buildJobKey = ({ provider, kind, providerRef }) =>
  `render/${provider || "unknown"}/${kind || "unknown"}/${providerRef || Date.now()}`;

const mintJobId = () => `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** Read-side shim so legacy rows and new rows present one shape. */
const normalizeJobItem = (item = {}) => ({
  jobId: item.jobId || item.key || "",
  key: item.key || "",
  kind: item.kind || item.entityType || "",
  provider: item.provider || "",
  providerRef: item.providerRef || item.predictionId || item.invocationArn || item.token || "",
  status: normalizeJobStatus(item.status),
  progressPct: typeof item.progressPct === "number" ? item.progressPct : null,
  etaSeconds: typeof item.etaSeconds === "number" ? item.etaSeconds : null,
  parent: item.parent || null,
  result: item.result || null,
  error: item.error || null,
  startedAt: item.startedAt || item.createdAt || null,
  updatedAt: item.updatedAt || null,
  completedAt: item.completedAt || null,
});

function createJobStore({ putMediaItem, queryMediaItems }) {
  if (!putMediaItem || !queryMediaItems) {
    return {
      createJob: async () => null,
      updateJob: async () => null,
      getJob: async () => null,
      listJobs: async () => [],
      JOB_STATUS,
      normalizeJobStatus,
      isTerminal,
    };
  }

  /** Record a newly started unit of work. Returns the normalised job. */
  async function createJob({
    userId,
    kind,
    provider,
    providerRef,
    status = JOB_STATUS.QUEUED,
    progressPct = null,
    etaSeconds = null,
    parent = null,
    meta = {},
  }) {
    if (!userId || !kind) return null;
    const now = new Date().toISOString();
    const key = buildJobKey({ provider, kind, providerRef });
    const job = {
      jobId: mintJobId(),
      kind,
      provider: provider || "",
      providerRef: providerRef || "",
      // `entityType` is retained so the existing admin Job Queue keeps
      // grouping these rows the way it always has.
      entityType: kind,
      status: normalizeJobStatus(status),
      progressPct,
      etaSeconds,
      parent,
      result: null,
      error: null,
      startedAt: now,
      updatedAt: now,
      ...meta,
    };
    await putMediaItem({ userId, type: "JOB", key, extra: job });
    return normalizeJobItem({ ...job, key });
  }

  /** Advance a job. Terminal transitions stamp completedAt. */
  async function updateJob({ userId, job, status, progressPct, etaSeconds, result, error }) {
    if (!userId || !job?.key) return null;
    const next = normalizeJobStatus(status ?? job.status);
    const now = new Date().toISOString();
    const patched = {
      ...job,
      status: next,
      ...(progressPct !== undefined ? { progressPct } : {}),
      ...(etaSeconds !== undefined ? { etaSeconds } : {}),
      ...(result !== undefined ? { result } : {}),
      ...(error !== undefined ? { error } : {}),
      updatedAt: now,
      ...(TERMINAL_STATUSES.has(next) ? { completedAt: now } : {}),
    };
    await putMediaItem({ userId, type: "JOB", key: job.key, extra: patched });
    return normalizeJobItem(patched);
  }

  /**
   * All jobs for a user, newest first. `activeOnly` keeps just the ones the
   * UI still needs to watch — this is what powers GET /jobs?active=1 and
   * replaces the client-side sessionStorage job cache.
   */
  async function listJobs({ userId, activeOnly = false, limit = 50 }) {
    if (!userId) return [];
    const items = (await queryMediaItems({ userId, type: "JOB" })) || [];
    const jobs = items
      .map(normalizeJobItem)
      .sort((a, b) => String(b.startedAt || "").localeCompare(String(a.startedAt || "")));
    const filtered = activeOnly ? jobs.filter((j) => !TERMINAL_STATUSES.has(j.status)) : jobs;
    return filtered.slice(0, limit);
  }

  async function getJob({ userId, jobId }) {
    if (!userId || !jobId) return null;
    const jobs = await listJobs({ userId, limit: 500 });
    return jobs.find((j) => j.jobId === jobId || j.key === jobId) || null;
  }

  return {
    createJob,
    updateJob,
    getJob,
    listJobs,
    JOB_STATUS,
    normalizeJobStatus,
    isTerminal,
  };
}

module.exports = {
  createJobStore,
  normalizeJobStatus,
  normalizeJobItem,
  buildJobKey,
  isTerminal,
  JOB_STATUS,
};
