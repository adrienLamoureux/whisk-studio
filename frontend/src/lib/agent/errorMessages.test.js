import {
  friendlyAgentError,
  friendlyAgentErrorFor,
  formatRetryDelay,
  isAgentDisabledError,
} from "./errorMessages";

describe("friendlyAgentError", () => {
  it("maps known codes and prefix codes", () => {
    expect(friendlyAgentError("rate_limited")).toMatch(/catching her breath/);
    expect(friendlyAgentError("unknown_tool:foo")).toMatch(/don't know that move/);
  });

  it("falls back for unknown codes", () => {
    expect(friendlyAgentError("nope", "custom fallback")).toBe("custom fallback");
  });
});

describe("formatRetryDelay", () => {
  it("formats seconds, minutes and hours", () => {
    expect(formatRetryDelay(45000)).toBe("try again in 45s");
    expect(formatRetryDelay(120000)).toBe("try again in 2m");
    expect(formatRetryDelay(2 * 60 * 60 * 1000)).toBe("try again in ~2h");
  });
});

describe("friendlyAgentErrorFor", () => {
  it("appends the backend retry wait for rate-limit errors", () => {
    const err = Object.assign(new Error("Request failed."), {
      errorCode: "rate_limited",
      body: { retryAfterMs: 30000 },
    });
    expect(friendlyAgentErrorFor(err)).toMatch(/catching her breath.*try again in 30s/);
  });

  it("appends the wait for daily-cap errors", () => {
    const err = Object.assign(new Error("Request failed."), {
      errorCode: "daily_cap_reached",
      body: { retryAfterMs: 3 * 60 * 60 * 1000 },
    });
    expect(friendlyAgentErrorFor(err)).toMatch(/daily token budget.*try again in ~3h/);
  });

  it("does not append a wait for unrelated errors even if retryAfterMs is set", () => {
    const err = Object.assign(new Error("Request failed."), {
      errorCode: "tool_failed",
      body: { retryAfterMs: 30000 },
    });
    expect(friendlyAgentErrorFor(err)).not.toMatch(/try again in/);
  });

  it("prefers the structured errorCode over the message", () => {
    const err = Object.assign(new Error("Request failed."), { errorCode: "rate_limited" });
    expect(friendlyAgentErrorFor(err)).toMatch(/catching her breath/);
  });
});

describe("isAgentDisabledError", () => {
  it("matches only the explicit disabled signal", () => {
    expect(isAgentDisabledError({ errorCode: "agent_mode_disabled" })).toBe(true);
    expect(isAgentDisabledError(new Error("Request failed."))).toBe(false);
  });
});
