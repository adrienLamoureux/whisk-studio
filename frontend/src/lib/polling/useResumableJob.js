import { useEffect, useRef } from "react";
import { listActiveJobs } from "../../services/jobs";

/**
 * Resume an in-flight generation after a reload or navigation.
 *
 * The server already knows what is running (`GET /jobs?active=1`) and each job
 * carries the `poll` parameters its status endpoint needs, so the client
 * stores nothing. This replaces the sessionStorage job cache, which was
 * per-tab, lossy, and a third source of truth alongside the job row and the
 * provider's own status.
 *
 * `onResume(job)` fires at most once per mount, for the newest active job of
 * the requested kind that carries a usable `poll` recipe.
 */
export default function useResumableJob({ apiBaseUrl, kind, enabled = true, onResume }) {
  const onResumeRef = useRef(onResume);
  onResumeRef.current = onResume;
  const resumedRef = useRef(false);

  useEffect(() => {
    if (!apiBaseUrl || !enabled || resumedRef.current) return undefined;
    let cancelled = false;

    (async () => {
      let jobs = [];
      try {
        const data = await listActiveJobs(apiBaseUrl);
        jobs = Array.isArray(data?.jobs) ? data.jobs : [];
      } catch {
        // Anonymous users and transient failures simply have nothing to resume.
        return;
      }
      if (cancelled || resumedRef.current) return;
      const kinds = Array.isArray(kind) ? kind : [kind];
      const job = jobs.find((j) => kinds.includes(j.kind) && j.poll);
      if (!job) return;
      resumedRef.current = true;
      onResumeRef.current?.(job);
    })();

    return () => {
      cancelled = true;
    };
  }, [apiBaseUrl, kind, enabled]);
}
