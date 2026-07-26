import { useCallback } from "react";
import {
  createStorySession,
  generateStoryIllustration,
  sendStoryMessage,
} from "../../services/story";
import { useNotify } from "../../components/sakura/NotificationStack";

/**
 * Encapsulates the three primary async actions for the Story page:
 *   - autoIllustrateOpening  (fires after session creation)
 *   - handleCreateSession    (creates a new session + triggers opening illustration)
 *   - sendMessage            (sends a user turn and appends the reply)
 *
 * All state setters are passed in as stable references (from useState/useCallback)
 * so this hook has no stale-closure risk.
 */
export default function useStoryActions({
  apiBaseUrl,
  presets,
  selectedPresetId,
  selectSession,
  mergeScenes,
  setCreatingSession,
  setError,
  setSessions,
  setShowPresetPicker,
  setScenes,
  setMessages,
  input,
  setInput,
  setSending,
  activeSessionId,
}) {
  const notify = useNotify();
  const autoIllustrateOpening = useCallback(
    async (sessionId, knownSceneId = null) => {
      if (!sessionId || !apiBaseUrl) return;
      const payload = knownSceneId ? { sceneId: knownSceneId } : { forceCurrent: true };
      try {
        const data = await generateStoryIllustration(apiBaseUrl, sessionId, payload);
        const imageUrl = data?.imageUrl || null;
        const scene = data?.scene || null;
        const sceneId = data?.sceneId || scene?.sceneId || null;
        if (!sceneId) return;
        mergeScenes([
          { ...(scene || {}), sceneId, imageUrl: imageUrl || scene?.imageUrl, illustrating: false },
        ]);
        setMessages((prev) => {
          const idx = prev.findIndex((m) => m.role === "assistant" && !m.sceneId);
          if (idx === -1) return prev;
          const updated = [...prev];
          updated[idx] = { ...updated[idx], sceneId };
          return updated;
        });
      } catch {
        setScenes((prev) => {
          const updated = { ...prev };
          for (const [key, val] of Object.entries(updated)) {
            if (val?.illustrating) updated[key] = { ...val, illustrating: false };
          }
          return updated;
        });
      }
    },
    [apiBaseUrl, mergeScenes, setMessages, setScenes]
  );

  const handleCreateSession = useCallback(async () => {
    if (!apiBaseUrl || !selectedPresetId) return;
    setCreatingSession(true);
    setError("");
    try {
      const preset = presets.find((p) => p.id === selectedPresetId);
      const payload = { presetId: selectedPresetId };
      if (preset?.defaultCharacterId) payload.characterId = preset.defaultCharacterId;
      const created = await createStorySession(apiBaseUrl, payload);
      const newSession = created?.session || created;
      const sessionId = newSession?.id || newSession?.sessionId;
      if (sessionId) {
        const normalized = { ...newSession, sessionId };
        setSessions((prev) => [normalized, ...prev]);
        setShowPresetPicker(false);
        await selectSession(sessionId);
        const openingScenes = Array.isArray(created?.scenes) ? created.scenes : [];
        const openingSceneId = openingScenes[0]?.sceneId;
        if (openingSceneId) {
          mergeScenes(openingScenes);
          setScenes((prev) => ({
            ...prev,
            [openingSceneId]: { ...(prev[openingSceneId] || openingScenes[0]), illustrating: true },
          }));
          setMessages((prev) => {
            const idx = prev.findIndex((m) => m.role === "assistant" && !m.sceneId);
            if (idx === -1) return prev;
            const updated = [...prev];
            updated[idx] = { ...updated[idx], sceneId: openingSceneId };
            return updated;
          });
        }
        autoIllustrateOpening(sessionId, openingSceneId || null);
      }
    } catch (e) {
      setError(e?.message || "Failed to create session.");
      notify?.(e?.message || "Failed to create session.", "error");
    } finally {
      setCreatingSession(false);
    }
  }, [
    apiBaseUrl,
    selectedPresetId,
    presets,
    selectSession,
    mergeScenes,
    setCreatingSession,
    setError,
    setSessions,
    setShowPresetPicker,
    setScenes,
    setMessages,
    autoIllustrateOpening,
    notify,
  ]);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || !activeSessionId) return;
    setInput("");
    setMessages((prev) => [...prev, { role: "user", text, sceneId: null }]);
    setSending(true);
    setError("");
    try {
      const data = await sendStoryMessage(apiBaseUrl, activeSessionId, { content: text });
      const reply =
        data?.assistant?.content || data?.reply || data?.message || data?.content || "…";
      const scene = data?.scene || null;
      if (scene?.sceneId) mergeScenes([scene]);
      if (data?.degraded) {
        notify?.(
          "The story stumbled on that turn — try Regenerate if the reply looks off.",
          "error"
        );
      }
      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: reply, sceneId: scene?.sceneId || null },
      ]);
    } catch (e) {
      notify?.(e?.message || "The story reply failed — please try again.", "error");
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: "Sorry, something went wrong. Please try again.",
          sceneId: null,
        },
      ]);
    } finally {
      setSending(false);
    }
  }, [
    apiBaseUrl,
    activeSessionId,
    input,
    setInput,
    setMessages,
    setSending,
    setError,
    mergeScenes,
    notify,
  ]);

  // Re-answers the last user turn: the backend deletes the previous assistant
  // reply, so the last assistant bubble is replaced in place here too.
  const regenerateLastReply = useCallback(async () => {
    if (!activeSessionId) return;
    setSending(true);
    setError("");
    try {
      const data = await sendStoryMessage(apiBaseUrl, activeSessionId, { regenerate: true });
      const reply = data?.assistant?.content || "…";
      const scene = data?.scene || null;
      if (scene?.sceneId) mergeScenes([scene]);
      if (data?.degraded) {
        notify?.("The story stumbled again — you may want to rephrase your last message.", "error");
      }
      setMessages((prev) => {
        const updated = [...prev];
        for (let i = updated.length - 1; i >= 0; i -= 1) {
          if (updated[i].role === "assistant") {
            updated[i] = { role: "assistant", text: reply, sceneId: scene?.sceneId || null };
            return updated;
          }
        }
        return [...updated, { role: "assistant", text: reply, sceneId: scene?.sceneId || null }];
      });
    } catch (e) {
      notify?.(e?.message || "Could not regenerate the reply.", "error");
    } finally {
      setSending(false);
    }
  }, [apiBaseUrl, activeSessionId, setMessages, setSending, setError, mergeScenes, notify]);

  return { handleCreateSession, sendMessage, regenerateLastReply };
}
