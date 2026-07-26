import { useState, useRef, useCallback, useEffect } from "react";
import {
  startStorySceneAnimation,
  getStorySceneAnimationStatus,
  startStorySceneMusic,
  getStorySceneMusicStatus,
} from "../../services/story";
import createPoller from "../../lib/polling/createPoller";

const SCENE_POLL_INTERVAL_MS = 5000;
const SCENE_POLL_MAX_ATTEMPTS = 120; // ~10 minutes

/**
 * Hook encapsulating animation + music trigger/poll for story scenes.
 */
export default function useSceneMedia(apiBaseUrl) {
  const [mediaMap, setMediaMap] = useState({});
  const animPollers = useRef({});
  const musicPollers = useRef({});

  // --- helpers ---
  const updateScene = useCallback((sceneId, patch) => {
    setMediaMap((prev) => ({
      ...prev,
      [sceneId]: { ...(prev[sceneId] || {}), ...patch },
    }));
  }, []);

  const clearAnimPoll = useCallback((sceneId) => {
    if (animPollers.current[sceneId]) {
      animPollers.current[sceneId].stop();
      delete animPollers.current[sceneId];
    }
  }, []);

  const clearMusicPoll = useCallback((sceneId) => {
    if (musicPollers.current[sceneId]) {
      musicPollers.current[sceneId].stop();
      delete musicPollers.current[sceneId];
    }
  }, []);

  const clearAllPolls = useCallback(() => {
    Object.keys(animPollers.current).forEach((id) => animPollers.current[id].stop());
    Object.keys(musicPollers.current).forEach((id) => musicPollers.current[id].stop());
    animPollers.current = {};
    musicPollers.current = {};
    setMediaMap({});
  }, []);

  // Cleanup on unmount
  useEffect(() => clearAllPolls, [clearAllPolls]);

  // --- animation ---
  const triggerAnimation = useCallback(
    async (sessionId, sceneId) => {
      if (!apiBaseUrl || !sessionId || !sceneId) return;
      const current = mediaMap[sceneId];
      if (current?.videoStatus === "starting" || current?.videoStatus === "processing") return;

      clearAnimPoll(sceneId);
      updateScene(sceneId, { videoStatus: "starting", videoUrl: "", videoPredictionId: "" });

      const applyData = (data) => {
        if (!data) return;
        const patch = { videoStatus: data.status || "" };
        if (data.predictionId) patch.videoPredictionId = data.predictionId;
        if (data.status === "succeeded" && data.videoUrl) patch.videoUrl = data.videoUrl;
        if (data.videoKey) patch.videoKey = data.videoKey;
        updateScene(sceneId, patch);
      };

      const finish = () => clearAnimPoll(sceneId);

      // Bounded retry: transient status-check failures are tolerated up to the
      // poller's error cap instead of killing the poll on the first hiccup.
      const startPolling = (predictionId) => {
        const poller = createPoller({
          intervalMs: SCENE_POLL_INTERVAL_MS,
          maxAttempts: SCENE_POLL_MAX_ATTEMPTS,
          maxConsecutiveErrors: 3,
          task: async () => {
            const statusData = await getStorySceneAnimationStatus(apiBaseUrl, sessionId, sceneId, {
              predictionId,
            });
            applyData(statusData);
            const st = statusData?.status || "";
            if (st === "succeeded" || st === "failed" || st === "canceled") {
              finish();
              return true;
            }
            return false;
          },
          onExhausted: () => {
            updateScene(sceneId, { videoStatus: "failed" });
            finish();
          },
        });
        animPollers.current[sceneId] = poller;
        poller.start();
      };

      try {
        const data = await startStorySceneAnimation(apiBaseUrl, sessionId, sceneId, {
          prompt: "A lot of movements",
        });
        applyData(data);
        const st = data?.status || "";
        if (st === "succeeded" || st === "failed" || st === "canceled") {
          finish();
          return;
        }
        if (!data?.predictionId) {
          finish();
          return;
        }
        startPolling(data.predictionId);
      } catch {
        finish();
        updateScene(sceneId, { videoStatus: "failed" });
      }
    },
    [apiBaseUrl, mediaMap, clearAnimPoll, updateScene]
  );

  // --- music ---
  const triggerMusic = useCallback(
    async (sessionId, sceneId) => {
      if (!apiBaseUrl || !sessionId || !sceneId) return;
      const current = mediaMap[sceneId];
      if (current?.musicStatus === "starting" || current?.musicStatus === "processing") return;

      clearMusicPoll(sceneId);
      updateScene(sceneId, { musicStatus: "starting", musicUrl: "", musicPredictionId: "" });

      const applyData = (data) => {
        if (!data) return;
        const patch = { musicStatus: data.status || "" };
        if (data.predictionId) patch.musicPredictionId = data.predictionId;
        if (data.status === "succeeded" && data.musicUrl) patch.musicUrl = data.musicUrl;
        if (data.musicKey) patch.musicKey = data.musicKey;
        if (data.musicMood) patch.musicMood = data.musicMood;
        if (data.musicTags) patch.musicTags = data.musicTags;
        updateScene(sceneId, patch);
      };

      const finish = () => clearMusicPoll(sceneId);

      const startPolling = (predictionId) => {
        const poller = createPoller({
          intervalMs: SCENE_POLL_INTERVAL_MS,
          maxAttempts: SCENE_POLL_MAX_ATTEMPTS,
          maxConsecutiveErrors: 3,
          task: async () => {
            const statusData = await getStorySceneMusicStatus(apiBaseUrl, sessionId, sceneId, {
              predictionId,
            });
            applyData(statusData);
            const st = statusData?.status || "";
            if (st === "succeeded" || st === "failed" || st === "canceled") {
              finish();
              return true;
            }
            return false;
          },
          onExhausted: () => {
            updateScene(sceneId, { musicStatus: "failed" });
            finish();
          },
        });
        musicPollers.current[sceneId] = poller;
        poller.start();
      };

      try {
        const data = await startStorySceneMusic(apiBaseUrl, sessionId, sceneId, {});
        applyData(data);
        const st = data?.status || "";
        if (st === "succeeded" || st === "failed" || st === "canceled") {
          finish();
          return;
        }
        if (!data?.predictionId) {
          finish();
          return;
        }
        startPolling(data.predictionId);
      } catch {
        finish();
        updateScene(sceneId, { musicStatus: "failed" });
      }
    },
    [apiBaseUrl, mediaMap, clearMusicPoll, updateScene]
  );

  // --- accessor ---
  const getSceneMedia = useCallback((sceneId) => mediaMap[sceneId] || null, [mediaMap]);

  return { triggerAnimation, triggerMusic, getSceneMedia, clearAllPolls, mediaMap };
}
