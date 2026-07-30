/**
 * ToolResultPanel — polls the existing /replicate/image/status endpoint until
 * the prediction succeeds or fails. Renders the resulting image inline.
 *
 * The agent route already kicked off the prediction and persisted a JOB row,
 * so we just poll like GenerationCard does.
 */

import React, { useEffect, useRef, useState } from "react";
import { useConfig } from "../../../contexts/ConfigContext";
import { useAgent } from "../../../lib/agent/AgentContext";
import { useCompanion, CompanionActions } from "../../../lib/companion/CompanionContext";
import { getReplicateImageStatus } from "../../../services/replicate";
import createPoller from "../../../lib/polling/createPoller";

const POLL_INTERVAL_MS = 3000;
const MAX_POLLS = 40; // ~2 minutes

export default function ToolResultPanel({ turn }) {
  const { apiBaseUrl } = useConfig();
  const { dispatch } = useCompanion();
  const { setPendingText } = useAgent();
  const { payload } = turn;

  // Click handler shared by the prompt text — quotes it back into the composer
  // so the user can riff on the exact prompt without retyping. No-op when
  // payload has no prompt (very early polling state).
  const onQuotePrompt = () => {
    if (payload?.prompt) setPendingText(payload.prompt);
  };

  const [status, setStatus] = useState(payload?.status || "starting");
  const [imageUrl, setImageUrl] = useState(payload?.imageUrl || null);
  const [error, setError] = useState(payload?.error || null);
  const pollRef = useRef(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    // Fast-path: backend returned imageUrl synchronously — skip polling.
    if (payload?.imageUrl) {
      setImageUrl(payload.imageUrl);
      setStatus("succeeded");
      return undefined;
    }
    if (!payload?.predictionId || !payload?.imageName || !payload?.batchId) {
      // No prediction descriptor — nothing to poll
      if (payload?.error) setStatus("failed");
      return undefined;
    }

    // Shared poller: bounded attempts + bounded consecutive errors, the same
    // primitive the Atelier hooks use. This used to be a hand-rolled
    // setTimeout loop duplicating GenerationCard's.
    const poller = createPoller({
      immediate: true,
      intervalMs: POLL_INTERVAL_MS,
      maxAttempts: MAX_POLLS,
      maxConsecutiveErrors: 3,
      task: async () => {
        if (cancelledRef.current) return true;
        const data = await getReplicateImageStatus(apiBaseUrl, {
          predictionId: payload.predictionId,
          imageName: payload.imageName,
          batchId: payload.batchId,
          prompt: payload.prompt || "",
          negativePrompt: payload.negativePrompt || "",
        });
        if (cancelledRef.current) return true;
        if (data?.status === "succeeded" && data?.images?.length > 0) {
          setImageUrl(data.images[0].url);
          setStatus("succeeded");
          dispatch(CompanionActions.GENERATION_DONE, { type: "image", success: true });
          return true;
        }
        if (data?.status === "failed" || data?.status === "canceled") {
          setStatus("failed");
          setError(data?.error || "Generation failed.");
          dispatch(CompanionActions.GENERATION_ERROR, { type: "image", error: data?.error });
          return true;
        }
        setStatus(data?.status || "processing");
        return false;
      },
      onExhausted: (reason, err) => {
        if (cancelledRef.current) return;
        setStatus("failed");
        setError(reason === "attempts" ? "Generation timed out." : err?.message || "Network error");
        dispatch(CompanionActions.GENERATION_ERROR, {
          type: "image",
          error: reason === "attempts" ? "timeout" : err?.message,
        });
      },
    });
    pollRef.current = poller;
    poller.start();

    return () => {
      cancelledRef.current = true;
      poller.stop();
    };
    // Poll once per mount; stable identifiers come from payload.predictionId.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payload?.predictionId]);

  if (error || status === "failed") {
    return (
      <div className="skr-tool-result is-error">
        <p className="skr-tool-result-prompt">{payload?.prompt}</p>
        <p className="skr-tool-result-status">⚠ {String(error || "failed")}</p>
      </div>
    );
  }

  if (status === "succeeded" && imageUrl) {
    return (
      <div className="skr-tool-result is-done">
        <div className="skr-tool-result-image-wrap">
          <img src={imageUrl} alt={payload?.prompt || "Generated image"} loading="lazy" />
        </div>
        {payload?.prompt ? (
          <button
            type="button"
            className="skr-tool-result-prompt is-clickable"
            onClick={onQuotePrompt}
            title="Click to quote in composer"
          >
            {payload.prompt}
          </button>
        ) : null}
      </div>
    );
  }

  // In-progress
  const aspect = payload?.aspect || "3:4";
  return (
    <div className="skr-tool-result is-pending" data-aspect={aspect}>
      <div className="skr-tool-result-skeleton" aria-hidden="true">
        <span className="skr-thinking-dot">●</span>
        <span className="skr-thinking-dot" style={{ animationDelay: "0.15s" }}>
          ●
        </span>
        <span className="skr-thinking-dot" style={{ animationDelay: "0.3s" }}>
          ●
        </span>
      </div>
      <p className="skr-tool-result-prompt">{payload?.prompt}</p>
      <p className="skr-tool-result-status">{status}…</p>
    </div>
  );
}
