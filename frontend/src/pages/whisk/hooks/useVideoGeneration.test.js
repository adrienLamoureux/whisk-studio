import { renderHook, act } from "@testing-library/react";
import { useVideoGeneration } from "./useVideoGeneration";

jest.mock("../../../services/bedrock", () => ({
  generateNovaReelVideo: jest.fn(),
  getNovaReelJobStatus: jest.fn(),
}));
jest.mock("../../../services/replicate", () => ({
  generateReplicateVideo: jest.fn(),
  getReplicateVideoStatus: jest.fn(),
}));
jest.mock("../../../services/jobs", () => ({
  listActiveJobs: jest.fn().mockResolvedValue({ jobs: [] }),
}));

import { generateReplicateVideo, getReplicateVideoStatus } from "../../../services/replicate";
import { getNovaReelJobStatus } from "../../../services/bedrock";
import { listActiveJobs } from "../../../services/jobs";

function makeProps(overrides = {}) {
  return {
    apiBaseUrl: "https://api.example.com",
    selectedImageKey: "images/foo.jpg",
    selectedSourceImageKey: "",
    selectedImageUrl: "https://cdn.example.com/foo.jpg",
    selectedLoraProfileId: "",
    loraVideoSupportByModel: {},
    supportedVideoLoraModels: [],
    directorVideoModels: [],
    onError: jest.fn(),
    onSubmitted: jest.fn(),
    onCompleted: jest.fn(),
    ...overrides,
  };
}

describe("useVideoGeneration — resume from the shared job feed", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    listActiveJobs.mockResolvedValue({ jobs: [] });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("submits without storing anything client-side", async () => {
    generateReplicateVideo.mockResolvedValueOnce({ predictionId: "vp-1", status: "starting" });
    getReplicateVideoStatus.mockResolvedValue({ status: "processing" });

    const props = makeProps();
    const { result } = renderHook(() => useVideoGeneration(props));

    await act(async () => {
      await result.current.handleGenerateVideo();
    });

    expect(props.onSubmitted).toHaveBeenCalled();
  });

  it("resumes a replicate video reported by the server feed", async () => {
    listActiveJobs.mockResolvedValue({
      jobs: [
        {
          jobId: "job-v",
          kind: "video",
          provider: "replicate",
          status: "running",
          poll: { predictionId: "vp-9", inputKey: "images/foo.jpg", characterId: "" },
        },
      ],
    });
    getReplicateVideoStatus.mockResolvedValue({ status: "succeeded" });

    const props = makeProps();
    renderHook(() => useVideoGeneration(props));

    await act(async () => {});
    await act(async () => {
      jest.advanceTimersByTime(0);
    });

    expect(getReplicateVideoStatus).toHaveBeenCalledWith(
      "https://api.example.com",
      expect.objectContaining({ predictionId: "vp-9" })
    );
    expect(props.onCompleted).toHaveBeenCalled();
  });

  it("resumes a bedrock video via its invocationArn", async () => {
    listActiveJobs.mockResolvedValue({
      jobs: [
        {
          jobId: "job-b",
          kind: "video",
          provider: "bedrock",
          status: "running",
          providerRef: "arn:x",
          poll: { invocationArn: "arn:x", inputKey: "images/foo.jpg", outputPrefix: "out/" },
        },
      ],
    });
    getNovaReelJobStatus.mockResolvedValue({ status: "Completed" });

    const props = makeProps();
    renderHook(() => useVideoGeneration(props));

    await act(async () => {});
    await act(async () => {
      jest.advanceTimersByTime(0);
    });

    expect(getNovaReelJobStatus).toHaveBeenCalledWith(
      "https://api.example.com",
      expect.objectContaining({ invocationArn: "arn:x" })
    );
    expect(props.onCompleted).toHaveBeenCalled();
  });

  it("reports failure from a resumed job", async () => {
    listActiveJobs.mockResolvedValue({
      jobs: [
        {
          jobId: "job-v",
          kind: "video",
          provider: "replicate",
          status: "running",
          poll: { predictionId: "vp-9", inputKey: "images/foo.jpg" },
        },
      ],
    });
    getReplicateVideoStatus.mockResolvedValue({ status: "failed" });

    const props = makeProps();
    renderHook(() => useVideoGeneration(props));

    await act(async () => {});
    await act(async () => {
      jest.advanceTimersByTime(0);
    });

    expect(props.onError).toHaveBeenCalledWith("Video generation failed.");
    expect(props.onCompleted).not.toHaveBeenCalled();
  });
});
