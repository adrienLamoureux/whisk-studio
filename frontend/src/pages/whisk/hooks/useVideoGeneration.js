import { useEffect, useMemo, useRef, useState } from "react";
import { generateNovaReelVideo, getNovaReelJobStatus } from "../../../services/bedrock";
import { generateReplicateVideo, getReplicateVideoStatus } from "../../../services/replicate";
import { useNotify } from "../../../components/sakura/NotificationStack";
import createPoller, { formatElapsedLabel } from "../../../lib/polling/createPoller";
import { loadJob, saveJob, clearJob } from "../../../lib/polling/jobStore";

const VIDEO_BEDROCK_JOB_SLOT = "video-bedrock";
const VIDEO_REPLICATE_JOB_SLOT = "video-replicate";
const VIDEO_POLL_INTERVAL_MS = 5000;
const VIDEO_POLL_MAX_ATTEMPTS = 240; // ~20 minutes

const buildUnsupportedLoraMessage = ({
  modelKey = "",
  modality = "video",
  supportedModels = [],
}) => {
  const normalizedModelKey = String(modelKey || "").trim() || "selected model";
  const options = Array.isArray(supportedModels)
    ? supportedModels.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  const supportedText = options.length
    ? `Compatible models: ${options.join(", ")}.`
    : `No ${modality} models are currently configured with LoRA support.`;
  return `The selected LoRA profile cannot be used with "${normalizedModelKey}". ${supportedText}`;
};

const FALLBACK_REPLICATE_VIDEO_MODELS = Object.freeze([
  {
    key: "wan-2.2-i2v-fast",
    name: "wan-2.2-i2v-fast",
    description: "Image-to-video fast",
  },
  {
    key: "veo-3.1-fast",
    name: "veo-3.1-fast",
    description: "Image-to-video with audio",
  },
  {
    key: "kling-v2.6",
    name: "kling-v2.6",
    description: "Text-to-video",
  },
  {
    key: "seedance-1.5-pro",
    name: "seedance-1.5-pro",
    description: "Text-to-video with audio",
  },
]);

export const useVideoGeneration = ({
  apiBaseUrl,
  selectedImageKey,
  selectedSourceImageKey,
  selectedImageUrl,
  selectedLoraProfileId = "",
  loraVideoSupportByModel = {},
  supportedVideoLoraModels = [],
  directorVideoModels = [],
  onError,
  onSubmitted,
  onCompleted,
}) => {
  const notify = useNotify();
  const [videoProvider, setVideoProvider] = useState("replicate");
  const [videoModel, setVideoModel] = useState("wan-2.2-i2v-fast");
  const [videoGenerateAudio, setVideoGenerateAudio] = useState(true);
  const [prompt, setPrompt] = useState("A cinematic push-in on the scene.");
  const [generationStatus, setGenerationStatus] = useState("idle");
  const [invocationArn, setInvocationArn] = useState("");
  const [outputPrefix, setOutputPrefix] = useState("");
  const [jobStatus, setJobStatus] = useState("");
  const [replicatePredictionId, setReplicatePredictionId] = useState("");
  const [replicateJobStatus, setReplicateJobStatus] = useState("");
  const [replicateInputKey, setReplicateInputKey] = useState("");
  const [replicateCharacterId, setReplicateCharacterId] = useState("");
  const [bedrockInputKey, setBedrockInputKey] = useState("");
  const [videoJobNotice, setVideoJobNotice] = useState("");
  const onCompletedRef = useRef(onCompleted);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    onCompletedRef.current = onCompleted;
    onErrorRef.current = onError;
  }, [onCompleted, onError]);

  const isGenerating = generationStatus === "loading";
  const isVideoInProgress =
    isGenerating ||
    jobStatus === "InProgress" ||
    (videoProvider === "replicate" &&
      (replicateJobStatus === "starting" || replicateJobStatus === "processing"));

  const videoProviderOptions = [
    {
      key: "bedrock",
      name: "Bedrock",
      description: "Nova Reel",
    },
    {
      key: "replicate",
      name: "Replicate",
      description: "WAN i2v fast",
    },
  ];

  const replicateModelOptionsFromDirector = useMemo(
    () =>
      (Array.isArray(directorVideoModels) ? directorVideoModels : [])
        .map((item) => {
          const key = String(item?.key || "").trim();
          if (!key) return null;
          return {
            key,
            name: key,
            description: String(item?.label || key).trim() || key,
          };
        })
        .filter(Boolean),
    [directorVideoModels]
  );

  const videoModelOptions = useMemo(() => {
    if (videoProvider === "replicate") {
      return replicateModelOptionsFromDirector.length
        ? replicateModelOptionsFromDirector
        : FALLBACK_REPLICATE_VIDEO_MODELS;
    }
    return [
      {
        key: "nova-reel",
        name: "amazon.nova-reel-v1:1",
        description: "Bedrock Nova Reel",
      },
    ];
  }, [videoProvider, replicateModelOptionsFromDirector]);

  const isReplicateAudioOption =
    videoProvider === "replicate" &&
    (videoModel === "veo-3.1-fast" ||
      videoModel === "kling-v2.6" ||
      videoModel === "seedance-1.5-pro");

  // Costly Replicate models — the caller shows an in-modal confirmation
  // before invoking handleGenerateVideo (replaces the old window.confirm).
  const isExpensiveModelSelected =
    videoProvider === "replicate" &&
    (videoModel === "veo-3.1-fast" ||
      videoModel === "kling-v2.6" ||
      videoModel === "seedance-1.5-pro");

  useEffect(() => {
    const allowedModels = videoModelOptions.map((option) => option.key);
    if (!allowedModels.includes(videoModel)) {
      setVideoModel(videoModelOptions[0]?.key || "nova-reel");
    }
  }, [videoModel, videoModelOptions]);

  const derivePrefixFromS3Uri = (s3Uri = "") => {
    if (!s3Uri.startsWith("s3://")) return "";
    const parts = s3Uri.replace("s3://", "").split("/");
    if (parts.length < 2) return "";
    return parts.slice(1).join("/");
  };

  const handleGenerateVideo = async () => {
    if (!selectedImageKey && !selectedSourceImageKey) {
      onError?.("Select an image before generating a video.");
      return;
    }
    if (!apiBaseUrl) {
      onError?.("API base URL is missing. Set it in config.json or .env.");
      return;
    }
    if (
      selectedLoraProfileId &&
      (videoProvider !== "replicate" || !Boolean(loraVideoSupportByModel[videoModel]))
    ) {
      onError?.(
        buildUnsupportedLoraMessage({
          modelKey: videoModel,
          modality: "video",
          supportedModels: supportedVideoLoraModels,
        })
      );
      return;
    }
    onError?.("");
    setGenerationStatus("loading");
    setInvocationArn("");
    setOutputPrefix("");
    setJobStatus("");
    setReplicatePredictionId("");
    setReplicateJobStatus("");
    setReplicateInputKey("");
    setBedrockInputKey("");

    try {
      if (videoProvider === "replicate") {
        if (!selectedImageUrl) {
          throw new Error("Selected image URL is missing.");
        }
        const resolvedInputKey =
          videoModel === "wan-2.2-i2v-fast" && selectedSourceImageKey
            ? selectedSourceImageKey
            : selectedImageKey || selectedSourceImageKey;
        const data = await generateReplicateVideo(apiBaseUrl, {
          model: videoModel,
          prompt: prompt?.trim() || undefined,
          inputKey: resolvedInputKey,
          imageUrl: selectedImageUrl,
          characterId: selectedLoraProfileId || undefined,
          ...(isReplicateAudioOption ? { generateAudio: videoGenerateAudio } : {}),
        });
        if (data?.predictionId && data?.status !== "succeeded") {
          setReplicatePredictionId(data.predictionId);
          setReplicateJobStatus(data.status || "starting");
          setReplicateInputKey(resolvedInputKey);
          setReplicateCharacterId(selectedLoraProfileId || "");
          saveJob(VIDEO_REPLICATE_JOB_SLOT, {
            predictionId: data.predictionId,
            inputKey: resolvedInputKey,
            characterId: selectedLoraProfileId || "",
          });
        } else {
          setGenerationStatus("success");
          notify?.("Video generation finished.", "success");
        }
        onSubmitted?.();
      } else {
        const resolvedInputKey = selectedImageKey || selectedSourceImageKey;
        const data = await generateNovaReelVideo(apiBaseUrl, {
          prompt: prompt?.trim() || undefined,
          inputKey: resolvedInputKey,
          model: videoModel,
        });
        setGenerationStatus("success");
        const resolvedArn = data?.response?.invocationArn || "";
        setInvocationArn(resolvedArn);
        const resolvedPrefix = data?.outputPrefix || derivePrefixFromS3Uri(data?.outputS3Uri || "");
        setOutputPrefix(resolvedPrefix);
        setBedrockInputKey(resolvedInputKey);
        if (resolvedArn) {
          saveJob(VIDEO_BEDROCK_JOB_SLOT, {
            invocationArn: resolvedArn,
            outputPrefix: resolvedPrefix,
            inputKey: resolvedInputKey,
          });
        }
        onSubmitted?.();
      }
    } catch (error) {
      setGenerationStatus("error");
      onError?.(error?.message || "Video generation failed.");
      notify?.(error?.message || "Video generation failed.", "error");
    }
  };

  useEffect(() => {
    if (!invocationArn || !apiBaseUrl) return undefined;
    const poller = createPoller({
      immediate: true,
      intervalMs: VIDEO_POLL_INTERVAL_MS,
      maxAttempts: VIDEO_POLL_MAX_ATTEMPTS,
      maxConsecutiveErrors: 4,
      task: async ({ elapsedMs }) => {
        let data;
        try {
          data = await getNovaReelJobStatus(apiBaseUrl, {
            invocationArn,
            inputKey: bedrockInputKey || selectedImageKey || selectedSourceImageKey,
            outputPrefix,
          });
        } catch (error) {
          if (error?.status === 401) {
            // Session expired — AuthExpiryNotice handles the messaging.
            clearJob(VIDEO_BEDROCK_JOB_SLOT);
            setVideoJobNotice("");
            return true;
          }
          throw error;
        }
        const statusValue = data?.status || "";
        setJobStatus(statusValue);
        if (statusValue === "Completed") {
          clearJob(VIDEO_BEDROCK_JOB_SLOT);
          setVideoJobNotice("");
          notify?.("Video generation finished.", "success");
          onCompletedRef.current?.();
          return true;
        }
        if (statusValue === "Failed") {
          clearJob(VIDEO_BEDROCK_JOB_SLOT);
          setVideoJobNotice("");
          onErrorRef.current?.("Video generation failed.");
          notify?.("Video generation failed.", "error");
          return true;
        }
        setVideoJobNotice(`Video is still processing... (${formatElapsedLabel(elapsedMs)})`);
        return false;
      },
      onExhausted: (reason) => {
        clearJob(VIDEO_BEDROCK_JOB_SLOT);
        setVideoJobNotice("");
        const message =
          reason === "attempts"
            ? "Video generation is taking longer than expected — check the Videos tab later."
            : "Lost contact while checking the video job — please try again.";
        onErrorRef.current?.(message);
        notify?.(message, "error");
      },
    });
    poller.start();
    return () => poller.stop();
  }, [
    apiBaseUrl,
    invocationArn,
    outputPrefix,
    bedrockInputKey,
    selectedImageKey,
    selectedSourceImageKey,
    notify,
  ]);

  useEffect(() => {
    if (!replicatePredictionId || !apiBaseUrl) return undefined;
    const poller = createPoller({
      immediate: true,
      intervalMs: VIDEO_POLL_INTERVAL_MS,
      maxAttempts: VIDEO_POLL_MAX_ATTEMPTS,
      maxConsecutiveErrors: 4,
      task: async ({ elapsedMs }) => {
        let data;
        try {
          data = await getReplicateVideoStatus(apiBaseUrl, {
            predictionId: replicatePredictionId,
            inputKey: replicateInputKey || selectedImageKey,
            characterId: replicateCharacterId || undefined,
          });
        } catch (error) {
          if (error?.status === 401) {
            clearJob(VIDEO_REPLICATE_JOB_SLOT);
            setVideoJobNotice("");
            return true;
          }
          throw error;
        }
        const statusValue = data?.status || "";
        setReplicateJobStatus(statusValue);
        if (statusValue === "succeeded") {
          clearJob(VIDEO_REPLICATE_JOB_SLOT);
          setVideoJobNotice("");
          setGenerationStatus("success");
          notify?.("Video generation finished.", "success");
          onCompletedRef.current?.();
          return true;
        }
        if (statusValue === "failed" || statusValue === "canceled") {
          clearJob(VIDEO_REPLICATE_JOB_SLOT);
          setVideoJobNotice("");
          setGenerationStatus("error");
          onErrorRef.current?.("Video generation failed.");
          notify?.("Video generation failed.", "error");
          return true;
        }
        setVideoJobNotice(`Video is still processing... (${formatElapsedLabel(elapsedMs)})`);
        return false;
      },
      onExhausted: (reason) => {
        clearJob(VIDEO_REPLICATE_JOB_SLOT);
        setVideoJobNotice("");
        const message =
          reason === "attempts"
            ? "Video generation is taking longer than expected — check the Videos tab later."
            : "Lost contact while checking the video job — please try again.";
        setGenerationStatus("error");
        onErrorRef.current?.(message);
        notify?.(message, "error");
      },
    });
    poller.start();
    return () => poller.stop();
  }, [
    apiBaseUrl,
    replicatePredictionId,
    replicateInputKey,
    replicateCharacterId,
    selectedImageKey,
    notify,
  ]);

  // Resume video jobs left in flight by navigation — restoring the stored
  // identifiers re-arms the poll effects above.
  useEffect(() => {
    if (!apiBaseUrl) return;
    const bedrockJob = loadJob(VIDEO_BEDROCK_JOB_SLOT);
    if (bedrockJob?.invocationArn && !invocationArn) {
      setJobStatus("InProgress");
      setVideoJobNotice("Resuming video job check...");
      setBedrockInputKey(bedrockJob.inputKey || "");
      setOutputPrefix(bedrockJob.outputPrefix || "");
      setInvocationArn(bedrockJob.invocationArn);
    }
    const replicateJob = loadJob(VIDEO_REPLICATE_JOB_SLOT);
    if (replicateJob?.predictionId && !replicatePredictionId) {
      setReplicateJobStatus("processing");
      setVideoJobNotice("Resuming video job check...");
      setReplicateInputKey(replicateJob.inputKey || "");
      setReplicateCharacterId(replicateJob.characterId || "");
      setReplicatePredictionId(replicateJob.predictionId);
    }
  }, [apiBaseUrl, invocationArn, replicatePredictionId]);

  return {
    videoProvider,
    videoProviderOptions,
    videoModel,
    videoModelOptions,
    setVideoProvider,
    setVideoModel,
    videoGenerateAudio,
    setVideoGenerateAudio,
    isReplicateAudioOption,
    isExpensiveModelSelected,
    isGenerating,
    isVideoInProgress,
    videoJobNotice,
    prompt,
    setPrompt,
    handleGenerateVideo,
  };
};
