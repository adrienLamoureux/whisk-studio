"use strict";

/**
 * scene-jobs — one way for story scene media (illustration, animation, music)
 * to participate in the shared job feed.
 *
 * Story media used to record no JOB at all, keeping its status on the
 * STORY_SCENE item, which made it invisible to GET /jobs and the ops
 * dashboard. These two helpers are the whole integration; every story media
 * route uses them rather than hand-rolling job bookkeeping.
 */

const startSceneJob = async ({ jobStore, userId, kind, providerRef, status, sessionId, sceneId }) =>
  (await jobStore?.createJob({
    userId,
    kind,
    provider: "replicate",
    providerRef,
    status,
    parent: { sessionId, sceneId },
  })) || null;

/** Look up the job for an in-flight prediction (poll routes have no handle). */
const findSceneJob = async ({ jobStore, userId, kind, providerRef }) =>
  providerRef
    ? await jobStore?.getJob({ userId, jobId: `render/replicate/${kind}/${providerRef}` })
    : null;

/** Mirror a provider status (and optional result) onto the job record. */
const settleSceneJob = async ({ jobStore, userId, job, status, result, error }) => {
  if (!job || !jobStore) return null;
  return jobStore.updateJob({
    userId,
    job,
    status,
    ...(result !== undefined ? { result } : {}),
    ...(error !== undefined ? { error } : {}),
  });
};

module.exports = { startSceneJob, findSceneJob, settleSceneJob };
