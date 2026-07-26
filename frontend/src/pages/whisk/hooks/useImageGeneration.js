import { useMemo, useRef, useEffect, useState } from "react";
import { generateBedrockImage } from "../../../services/bedrock";
import { generateReplicateImage, getReplicateImageStatus } from "../../../services/replicate";
import { generateCivitaiImage, getCivitaiImageStatus } from "../../../services/civitai";
import { generateHuggingFaceImage } from "../../../services/huggingface";
import { createVideoReadyImage } from "../../../services/images";
import { putFileToUrl, requestImageUploadUrl } from "../../../services/s3";
import { buildSafeFileName } from "../../../utils/fileName";
import { useNotify } from "../../../components/sakura/NotificationStack";
import createPoller, { formatElapsedLabel } from "../../../lib/polling/createPoller";
import { loadJob, saveJob, clearJob } from "../../../lib/polling/jobStore";
import { CIVITAI_LORA_MODE_QUICK, CIVITAI_RUNTIME_PROFILE_ID } from "./image-studio-constants";

const IMAGE_JOB_SLOT = "image";
const IMAGE_POLL_INTERVAL_MS = 2500;
const IMAGE_POLL_MAX_ATTEMPTS = 240; // ~10 minutes

const buildUnsupportedLoraMessage = ({
  modelKey = "",
  modality = "image",
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

export const useImageGeneration = ({
  apiBaseUrl,
  imageSource,
  imageModel,
  imageSize,
  imageScheduler,
  imageSchedulerOptions,
  imageCount,
  imagePrompt,
  imageNegativePrompt,
  imageGenerationName,
  selectedLoraProfileId,
  civitaiLoraMode,
  civitaiRuntimeLoras,
  persistRuntimeCivitaiProfileIfNeeded,
  loraImageSupportByModel,
  loraImageSupportByProviderModel,
  supportedImageLoraModels,
  supportedImageLoraModelsByProvider,
  onError,
  onVideoReady,
  onResetVideoReady,
  onAddVideoReadyImage,
  onCloseImageModal,
  onGenerationComplete,
}) => {
  const notify = useNotify();
  const [imageGenerationStatus, setImageGenerationStatus] = useState("idle");
  const [imageGenerationNotice, setImageGenerationNotice] = useState("");
  const [selectedFile, setSelectedFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [imageName, setImageName] = useState("");
  const [uploadKey, setUploadKey] = useState("");
  const [uploadStatus, setUploadStatus] = useState("idle");

  const replicatePollRef = useRef(null);

  const isUploading = uploadStatus === "uploading";
  const isGeneratingImage = imageGenerationStatus === "loading";

  // Stops the local poll only — the sessionStorage job descriptor survives so
  // a remount (navigation back to the page) can resume checking the job.
  const clearReplicatePoll = () => {
    if (replicatePollRef.current) {
      replicatePollRef.current.stop();
      replicatePollRef.current = null;
    }
  };

  // Cleanup poll on unmount
  useEffect(() => () => clearReplicatePoll(), []);

  // Object URL lifecycle for file preview
  useEffect(() => {
    if (!selectedFile) {
      setPreviewUrl("");
      return undefined;
    }
    const objectUrl = URL.createObjectURL(selectedFile);
    setPreviewUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [selectedFile]);

  const loraSupportBySourceModel = useMemo(
    () => ({
      replicate: loraImageSupportByProviderModel?.replicate || loraImageSupportByModel || {},
      civitai: loraImageSupportByProviderModel?.civitai || {},
    }),
    [loraImageSupportByModel, loraImageSupportByProviderModel]
  );

  const supportedLoraModelsBySource = useMemo(
    () => ({
      replicate: supportedImageLoraModelsByProvider?.replicate || supportedImageLoraModels || [],
      civitai: supportedImageLoraModelsByProvider?.civitai || [],
    }),
    [supportedImageLoraModels, supportedImageLoraModelsByProvider]
  );

  const activeCharacterIdForGeneration =
    imageSource === "civitai" && civitaiLoraMode === CIVITAI_LORA_MODE_QUICK
      ? civitaiRuntimeLoras.length
        ? CIVITAI_RUNTIME_PROFILE_ID
        : ""
      : selectedLoraProfileId;

  const loraUnsupportedForCurrentSelection = Boolean(
    activeCharacterIdForGeneration &&
    (!["replicate", "civitai"].includes(imageSource) ||
      !Boolean(loraSupportBySourceModel?.[imageSource]?.[imageModel]))
  );

  const localLoraSupportNotice = loraUnsupportedForCurrentSelection
    ? buildUnsupportedLoraMessage({
        modelKey: imageModel,
        modality: "image",
        supportedModels: supportedLoraModelsBySource?.[imageSource] || [],
      })
    : "";

  const startImagePolling = ({ provider, params }) => {
    if (!apiBaseUrl) return;
    const label = provider === "civitai" ? "CivitAI" : "Replicate";
    const fetchStatus = provider === "civitai" ? getCivitaiImageStatus : getReplicateImageStatus;
    clearReplicatePoll();
    saveJob(IMAGE_JOB_SLOT, { provider, params });
    const finishError = (message) => {
      clearJob(IMAGE_JOB_SLOT);
      setImageGenerationStatus("error");
      onError?.(message);
      notify?.(message, "error");
    };
    const poller = createPoller({
      intervalMs: IMAGE_POLL_INTERVAL_MS,
      maxAttempts: IMAGE_POLL_MAX_ATTEMPTS,
      maxConsecutiveErrors: 4,
      task: async ({ elapsedMs }) => {
        let data;
        try {
          data = await fetchStatus(apiBaseUrl, params);
        } catch (error) {
          if (error?.status === 401) {
            // Session expired — AuthExpiryNotice handles the messaging.
            clearJob(IMAGE_JOB_SLOT);
            setImageGenerationStatus("idle");
            return true;
          }
          throw error;
        }
        if (data?.status === "succeeded") {
          clearJob(IMAGE_JOB_SLOT);
          setImageGenerationNotice(data?.notice || "");
          setImageGenerationStatus("success");
          notify?.("Image generation finished.", "success");
          onGenerationComplete?.();
          return true;
        }
        if (data?.status === "failed" || data?.status === "canceled") {
          finishError(data?.error || `${label} image generation failed.`);
          return true;
        }
        setImageGenerationNotice(
          `${label} is still generating the image... (${formatElapsedLabel(elapsedMs)})`
        );
        return false;
      },
      onExhausted: (reason) => {
        finishError(
          reason === "attempts"
            ? `${label} is taking longer than expected — check the gallery later or try again.`
            : `Lost contact while checking the ${label} job — please try again.`
        );
      },
    });
    replicatePollRef.current = poller;
    poller.start();
  };

  // Resume a generation left in flight by navigation: the poll dies with the
  // component, but the job descriptor survives in sessionStorage.
  const startImagePollingRef = useRef(null);
  startImagePollingRef.current = startImagePolling;
  useEffect(() => {
    if (!apiBaseUrl) return;
    if (replicatePollRef.current) return;
    const job = loadJob(IMAGE_JOB_SLOT);
    if (!job?.provider || !job?.params) return;
    setImageGenerationStatus("loading");
    setImageGenerationNotice("Resuming image generation check...");
    startImagePollingRef.current?.({ provider: job.provider, params: job.params });
  }, [apiBaseUrl]);

  const handleFileChange = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.type !== "image/jpeg") {
      onError?.("Please select a JPEG image.");
      setSelectedFile(null);
      return;
    }
    onError?.("");
    onResetVideoReady?.();
    setSelectedFile(file);
    setUploadKey("");
    setUploadStatus("idle");
    setImageGenerationStatus("idle");
  };

  const handleUpload = async () => {
    if (!selectedFile) return;
    if (!imageName.trim()) {
      onError?.("Image name is required.");
      return;
    }
    if (!apiBaseUrl) {
      onError?.("API base URL is missing. Set it in config.json or .env.");
      return;
    }
    onError?.("");
    setUploadStatus("uploading");
    setImageGenerationStatus("idle");

    const safeName = buildSafeFileName(imageName.trim()) || "upload";
    const safeBase = safeName.replace(/\.(jpg|jpeg|png)$/i, "");
    const contentType = selectedFile.type || "application/octet-stream";

    try {
      const presignData = await requestImageUploadUrl(apiBaseUrl, {
        fileName: safeBase,
        contentType,
      });

      await putFileToUrl(presignData.url, selectedFile, contentType);

      setUploadKey(presignData.key);
      setUploadStatus("uploaded");

      const videoReadyData = await createVideoReadyImage(apiBaseUrl, presignData.key);
      if (videoReadyData?.videoReadyKey) {
        onVideoReady?.({
          key: videoReadyData.videoReadyKey,
          url: videoReadyData.url || "",
          sourceKey: presignData.key,
        });
      }
      if (videoReadyData?.videoReadyKey && videoReadyData?.url) {
        onAddVideoReadyImage?.({
          key: videoReadyData.videoReadyKey,
          url: videoReadyData.url,
        });
      }
    } catch (error) {
      setUploadStatus("error");
      onError?.(error?.message || "Upload failed.");
    }
  };

  const handleGenerateImage = async () => {
    if (!apiBaseUrl) {
      onError?.("API base URL is missing. Set it in config.json or .env.");
      return;
    }
    if (!imageGenerationName.trim()) {
      onError?.("Image name is required.");
      return;
    }
    if (!imagePrompt.trim()) {
      onError?.("Prompt is required.");
      return;
    }
    if (loraUnsupportedForCurrentSelection) {
      onError?.(
        buildUnsupportedLoraMessage({
          modelKey: imageModel,
          modality: "image",
          supportedModels: supportedLoraModelsBySource?.[imageSource] || [],
        })
      );
      return;
    }
    onError?.("");
    setImageGenerationStatus("loading");
    onResetVideoReady?.();
    setImageGenerationNotice("");
    clearReplicatePoll();

    try {
      const resolvedCharacterId = await persistRuntimeCivitaiProfileIfNeeded();
      const [width, height] = imageSize.split("x").map(Number);
      const payload = {
        model: imageModel,
        imageName: imageGenerationName.trim(),
        prompt: imagePrompt.trim(),
        negativePrompt: imageNegativePrompt.trim() || undefined,
        characterId: resolvedCharacterId || activeCharacterIdForGeneration || undefined,
        width,
        height,
        numImages:
          imageSource === "replicate" || imageSource === "civitai" ? Number(imageCount) || 1 : 1,
        ...(imageSource === "replicate" && imageSchedulerOptions.length > 0
          ? { scheduler: imageScheduler }
          : {}),
      };
      onCloseImageModal?.();
      const data =
        imageSource === "bedrock"
          ? await generateBedrockImage(apiBaseUrl, payload)
          : imageSource === "civitai"
            ? await generateCivitaiImage(apiBaseUrl, payload)
            : imageSource === "huggingface"
              ? await generateHuggingFaceImage(apiBaseUrl, payload)
              : await generateReplicateImage(apiBaseUrl, payload);
      if (imageSource === "civitai" && data?.token && data?.status !== "succeeded") {
        if (data.status === "failed") {
          setImageGenerationStatus("error");
          onError?.(data?.error || "CivitAI image generation failed.");
          notify?.(data?.error || "CivitAI image generation failed.", "error");
          return;
        }
        setImageGenerationNotice(
          data?.notice || "CivitAI is processing the image. We'll keep checking."
        );
        setImageGenerationStatus("loading");
        startImagePolling({
          provider: "civitai",
          params: {
            token: data.token,
            batchId: data.batchId,
            imageName: payload.imageName,
            prompt: payload.prompt,
            negativePrompt: payload.negativePrompt || "",
            characterId: payload.characterId || "",
          },
        });
        return;
      }
      if (data?.predictionId && data?.status && data.status !== "succeeded") {
        if (data.status === "failed" || data.status === "canceled") {
          setImageGenerationStatus("error");
          onError?.(data?.error || "Replicate image generation failed.");
          notify?.(data?.error || "Replicate image generation failed.", "error");
          return;
        }
        setImageGenerationNotice(
          data?.notice || "Replicate is processing the image. We'll keep checking."
        );
        setImageGenerationStatus("loading");
        startImagePolling({
          provider: "replicate",
          params: {
            predictionId: data.predictionId,
            batchId: data.batchId,
            imageName: payload.imageName,
            prompt: payload.prompt,
            negativePrompt: payload.negativePrompt || "",
          },
        });
        return;
      }
      setImageGenerationNotice(data?.notice || "");
      setImageGenerationStatus("success");
      notify?.("Image generation finished.", "success");
      onGenerationComplete?.();
    } catch (error) {
      setImageGenerationStatus("error");
      onError?.(error?.message || "Image generation failed.");
      notify?.(error?.message || "Image generation failed.", "error");
    }
  };

  const resetImageGeneration = () => {
    setImageGenerationStatus("idle");
    setImageGenerationNotice("");
    setSelectedFile(null);
    setPreviewUrl("");
    setImageName("");
    setUploadKey("");
    setUploadStatus("idle");
    clearReplicatePoll();
    // Explicit reset abandons the job — don't resurrect it on remount.
    clearJob(IMAGE_JOB_SLOT);
  };

  const imageUploadProps = {
    imageName,
    onImageNameChange: setImageName,
    selectedFile,
    previewUrl,
    onFileChange: handleFileChange,
    onUpload: handleUpload,
    uploadKey,
    isUploading,
  };

  return {
    imageGenerationStatus,
    setImageGenerationStatus,
    imageGenerationNotice,
    isGeneratingImage,
    isUploading,
    localLoraSupportNotice,
    loraUnsupportedForCurrentSelection,
    handleGenerateImage,
    imageUploadProps,
    resetImageGeneration,
    clearReplicatePoll,
  };
};
