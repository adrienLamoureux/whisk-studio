const { Router } = require("express");
const { requireEnv, requireAuth } = require("../lib/route-guards");
const { handleRouteError } = require("../lib/error-handler");

/**
 * jobs-routes — the one place a client asks "what is still running?".
 *
 * Replaces per-provider status polling as the resume mechanism: instead of the
 * client remembering predictionId/invocationArn/token in sessionStorage, it
 * asks `GET /jobs?active=1` on load and re-attaches to whatever is in flight —
 * on any device, after any refresh.
 *
 * Provider-specific `/…/status` routes still exist for the live poll of a
 * single job; this endpoint is about discovery and the shared job feed.
 */
module.exports = function registerJobsRoutes(deps) {
  const { mediaTable, jobStore } = deps;
  const router = Router();

  router.get("/jobs", deps.requireUserMiddleware, async (req, res) => {
    const userId = req.user?.sub;
    if (!requireEnv(res, "MEDIA_TABLE", mediaTable)) return;
    if (!requireAuth(res, userId)) return;
    try {
      const activeOnly = req.query?.active === "1" || req.query?.active === "true";
      const limit = Math.min(Math.max(Number(req.query?.limit) || 50, 1), 200);
      const jobs = await jobStore.listJobs({ userId, activeOnly, limit });
      res.json({ jobs, activeOnly });
    } catch (error) {
      return handleRouteError(res, "list jobs", error);
    }
  });

  router.get("/jobs/:jobId", deps.requireUserMiddleware, async (req, res) => {
    const userId = req.user?.sub;
    if (!requireEnv(res, "MEDIA_TABLE", mediaTable)) return;
    if (!requireAuth(res, userId)) return;
    try {
      const job = await jobStore.getJob({ userId, jobId: req.params.jobId });
      if (!job) return res.status(404).json({ message: "Job not found" });
      res.json({ job });
    } catch (error) {
      return handleRouteError(res, "get job", error);
    }
  });

  return router;
};
