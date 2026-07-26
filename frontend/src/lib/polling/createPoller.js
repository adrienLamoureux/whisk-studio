// Framework-agnostic setTimeout poller with bounded attempts and bounded
// consecutive errors, shared by the generation status polling hooks so a
// hung backend job can never keep a poll alive forever.
//
// `task({ attempt, elapsedMs })` runs each tick; return truthy to stop the
// poller (terminal state reached). A thrown error counts toward
// `maxConsecutiveErrors`; any successful run resets the count. When either
// bound is hit the poller stops and calls `onExhausted(reason, error)` with
// reason "errors" or "attempts".
export default function createPoller({
  task,
  intervalMs = 5000,
  maxAttempts = 120,
  maxConsecutiveErrors = 5,
  immediate = false,
  onExhausted,
}) {
  let timeoutId = null;
  let stopped = false;
  let attempt = 0;
  let consecutiveErrors = 0;
  let startedAt = null;

  const stop = () => {
    stopped = true;
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
  };

  const run = async () => {
    if (stopped) return;
    attempt += 1;
    let done = false;
    try {
      done = Boolean(await task({ attempt, elapsedMs: Date.now() - startedAt }));
      consecutiveErrors = 0;
    } catch (error) {
      consecutiveErrors += 1;
      if (consecutiveErrors >= maxConsecutiveErrors) {
        stop();
        onExhausted?.("errors", error);
        return;
      }
    }
    if (stopped) return;
    if (done) {
      stop();
      return;
    }
    if (attempt >= maxAttempts) {
      stop();
      onExhausted?.("attempts", null);
      return;
    }
    timeoutId = setTimeout(run, intervalMs);
  };

  const start = () => {
    if (startedAt !== null) return;
    startedAt = Date.now();
    if (immediate) {
      run();
    } else {
      timeoutId = setTimeout(run, intervalMs);
    }
  };

  return {
    start,
    stop,
    isActive: () => startedAt !== null && !stopped,
    getElapsedMs: () => (startedAt === null ? 0 : Date.now() - startedAt),
  };
}

// "38s", "2m 05s" — compact elapsed label for in-flight status notices.
export function formatElapsedLabel(elapsedMs) {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}
