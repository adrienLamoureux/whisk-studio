import { loadJob, loadJobs, saveJob, clearJob } from "./jobStore";

const STORAGE_KEY = "whisk:active-jobs";

describe("jobStore", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it("saves and loads a job with a startedAt stamp", () => {
    saveJob("image", { predictionId: "pred-1", provider: "replicate" });
    const job = loadJob("image");
    expect(job).toMatchObject({ predictionId: "pred-1", provider: "replicate" });
    expect(typeof job.startedAt).toBe("number");
  });

  it("keeps jobs in independent slots", () => {
    saveJob("image", { predictionId: "pred-1" });
    saveJob("video-replicate", { predictionId: "pred-2" });
    expect(Object.keys(loadJobs()).sort()).toEqual(["image", "video-replicate"]);
    expect(loadJob("video-replicate").predictionId).toBe("pred-2");
  });

  it("clears a single slot", () => {
    saveJob("image", { predictionId: "pred-1" });
    saveJob("video-bedrock", { invocationArn: "arn:x" });
    clearJob("image");
    expect(loadJob("image")).toBeNull();
    expect(loadJob("video-bedrock")).not.toBeNull();
  });

  it("returns empty state on corrupt JSON", () => {
    window.sessionStorage.setItem(STORAGE_KEY, "{not json");
    expect(loadJobs()).toEqual({});
    expect(loadJob("image")).toBeNull();
    // Writes still work after corruption.
    saveJob("image", { predictionId: "pred-1" });
    expect(loadJob("image").predictionId).toBe("pred-1");
  });

  it("returns empty state when the stored value is not an object", () => {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(["nope"]));
    expect(loadJobs()).toEqual({});
  });

  it("ignores save calls without a slot or job", () => {
    saveJob("", { predictionId: "x" });
    saveJob("image", null);
    expect(loadJobs()).toEqual({});
  });
});
