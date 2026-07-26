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

import { generateReplicateVideo, getReplicateVideoStatus } from "../../../services/replicate";
import { saveJob, loadJob } from "../../../lib/polling/jobStore";

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

describe("useVideoGeneration — job persistence & resume", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    window.sessionStorage.clear();
  });

  afterEach(() => {
    window.sessionStorage.clear();
    jest.useRealTimers();
  });

  it("persists a replicate job descriptor on submit", async () => {
    generateReplicateVideo.mockResolvedValueOnce({ predictionId: "vp-1", status: "starting" });
    getReplicateVideoStatus.mockResolvedValue({ status: "processing" });

    const props = makeProps();
    const { result } = renderHook(() => useVideoGeneration(props));

    await act(async () => {
      await result.current.handleGenerateVideo();
    });

    expect(props.onSubmitted).toHaveBeenCalled();
    expect(loadJob("video-replicate")).toMatchObject({
      predictionId: "vp-1",
      inputKey: "images/foo.jpg",
    });
  });

  it("resumes a persisted replicate job on mount and completes it", async () => {
    saveJob("video-replicate", { predictionId: "vp-9", inputKey: "images/foo.jpg" });
    getReplicateVideoStatus.mockResolvedValue({ status: "succeeded" });

    const props = makeProps();
    renderHook(() => useVideoGeneration(props));

    await act(async () => {
      jest.advanceTimersByTime(0);
    });

    expect(getReplicateVideoStatus).toHaveBeenCalledWith(
      "https://api.example.com",
      expect.objectContaining({ predictionId: "vp-9" })
    );
    expect(props.onCompleted).toHaveBeenCalled();
    expect(loadJob("video-replicate")).toBeNull();
  });

  it("clears the job and reports the error when the poll reports failure", async () => {
    saveJob("video-replicate", { predictionId: "vp-9", inputKey: "images/foo.jpg" });
    getReplicateVideoStatus.mockResolvedValue({ status: "failed" });

    const props = makeProps();
    renderHook(() => useVideoGeneration(props));

    await act(async () => {
      jest.advanceTimersByTime(0);
    });

    expect(props.onError).toHaveBeenCalledWith("Video generation failed.");
    expect(props.onCompleted).not.toHaveBeenCalled();
    expect(loadJob("video-replicate")).toBeNull();
  });
});
