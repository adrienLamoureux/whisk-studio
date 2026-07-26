// sessionStorage-backed store for in-flight generation job descriptors so a
// poll interrupted by navigation can resume when the page remounts. Each job
// is keyed by a stable slot name (e.g. "image", "video-replicate") and holds
// whatever identifiers the status endpoint needs plus `startedAt`.
const STORAGE_KEY = "whisk:active-jobs";

const readAll = () => {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

const writeAll = (jobs) => {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(jobs));
  } catch {
    // Storage full/unavailable — resume-on-return simply won't happen.
  }
};

export function loadJobs() {
  return readAll();
}

export function loadJob(slot) {
  return readAll()[slot] || null;
}

export function saveJob(slot, job) {
  if (!slot || !job) return;
  const jobs = readAll();
  jobs[slot] = { startedAt: Date.now(), ...job };
  writeAll(jobs);
}

export function clearJob(slot) {
  const jobs = readAll();
  if (!(slot in jobs)) return;
  delete jobs[slot];
  writeAll(jobs);
}
