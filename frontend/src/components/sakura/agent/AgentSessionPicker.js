/**
 * AgentSessionPicker — dropdown of named agent sessions in the AgentStage
 * meta strip. Lets users keep parallel conversations (one per project) backed
 * by separate memory namespaces on the server.
 *
 * UX:
 *   - Click the pill → menu opens listing existing sessions + "+ New session"
 *   - Choose one → AgentContext.setActiveSession wipes local turns; next agent
 *     call hydrates memory from the backend via the new sessionId
 *   - "+ New session" prompts for a name, mints a uuid, creates the metadata
 *     record + switches immediately
 *   - Each row has a rename + delete affordance on hover
 *
 * Create/rename/delete all run through the shared Modal (name input or
 * confirm dialog) so the in-character surface never drops to native
 * window.prompt/confirm chrome; failures surface as toasts.
 */

import React, { useEffect, useState, useCallback, useRef } from "react";
import { useConfig } from "../../../contexts/ConfigContext";
import { useAgent } from "../../../lib/agent/AgentContext";
import Modal from "../../shared/Modal";
import { useNotify } from "../NotificationStack";
import {
  listAgentSessions,
  createAgentSession,
  renameAgentSession,
  deleteAgentSession,
  mintSessionId,
} from "../../../services/agentSessions";

const DEFAULT_SESSION = { sessionId: "default", name: "Default" };

export default function AgentSessionPicker() {
  const { apiBaseUrl } = useConfig();
  const { activeSessionId, setActiveSession } = useAgent();
  const notify = useNotify();
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  // dialog: null | {type:"create"} | {type:"rename",session} | {type:"delete",session}
  const [dialog, setDialog] = useState(null);
  const [nameInput, setNameInput] = useState("");
  const menuRef = useRef(null);

  const load = useCallback(() => {
    if (!apiBaseUrl) return;
    listAgentSessions(apiBaseUrl)
      .then((data) => setItems(Array.isArray(data?.items) ? data.items : []))
      .catch(() => {
        // Sessions endpoint may be disabled (flag off) — treat as no sessions
        setItems([]);
      });
  }, [apiBaseUrl]);

  useEffect(() => {
    load();
  }, [load]);

  // Click-outside to close
  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  // Compose the rendered list: the implicit "Default" session is always first
  // even though it has no metadata record, so users have a fallback.
  const renderItems = [DEFAULT_SESSION, ...items.filter((s) => s.sessionId !== "default")];

  const activeName =
    renderItems.find((s) => s.sessionId === activeSessionId)?.name || activeSessionId;

  const handleSwitch = (sessionId) => {
    setActiveSession(sessionId);
    setOpen(false);
  };

  const handleCreate = () => {
    setNameInput("New project");
    setDialog({ type: "create" });
  };

  const handleRename = (s) => {
    setNameInput(s.name);
    setDialog({ type: "rename", session: s });
  };

  const handleDelete = (s) => {
    if (s.sessionId === "default") return;
    setDialog({ type: "delete", session: s });
  };

  const closeDialog = () => {
    setDialog(null);
    setNameInput("");
  };

  const confirmDialog = async () => {
    if (!dialog) return;
    const name = nameInput.trim();
    setPending(true);
    try {
      if (dialog.type === "create") {
        if (!name) return;
        const sessionId = mintSessionId();
        const res = await createAgentSession(apiBaseUrl, { sessionId, name });
        const created = res?.session || { sessionId, name };
        setItems((prev) => [created, ...prev]);
        handleSwitch(created.sessionId);
      } else if (dialog.type === "rename") {
        const s = dialog.session;
        if (!name || name === s.name) return;
        await renameAgentSession(apiBaseUrl, s.sessionId, name);
        setItems((prev) => prev.map((it) => (it.sessionId === s.sessionId ? { ...it, name } : it)));
      } else if (dialog.type === "delete") {
        const s = dialog.session;
        await deleteAgentSession(apiBaseUrl, s.sessionId);
        setItems((prev) => prev.filter((it) => it.sessionId !== s.sessionId));
        if (activeSessionId === s.sessionId) setActiveSession("default");
      }
      closeDialog();
    } catch (err) {
      notify?.(`Couldn't ${dialog.type} session: ${err?.message || "unknown error"}`, "error");
    } finally {
      setPending(false);
    }
  };

  const dialogTitle =
    dialog?.type === "create"
      ? "New session"
      : dialog?.type === "rename"
        ? "Rename session"
        : "Delete session";

  return (
    <div className="skr-session-picker" ref={menuRef}>
      <button
        type="button"
        className="skr-session-picker-trigger"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Switch agent session"
      >
        ◧ {activeName}
      </button>
      {open ? (
        <div className="skr-session-picker-menu" role="listbox">
          {renderItems.map((s) => (
            <div
              key={s.sessionId}
              className={`skr-session-row${s.sessionId === activeSessionId ? " is-active" : ""}`}
            >
              <button
                type="button"
                className="skr-session-row-name"
                onClick={() => handleSwitch(s.sessionId)}
                role="option"
                aria-selected={s.sessionId === activeSessionId}
              >
                {s.name}
              </button>
              {s.sessionId !== "default" ? (
                <span className="skr-session-row-actions">
                  <button
                    type="button"
                    className="skr-session-row-btn"
                    onClick={() => handleRename(s)}
                    title="Rename"
                    aria-label="Rename session"
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    className="skr-session-row-btn skr-session-row-btn--danger"
                    onClick={() => handleDelete(s)}
                    title="Delete"
                    aria-label="Delete session"
                  >
                    ✕
                  </button>
                </span>
              ) : null}
            </div>
          ))}
          <button
            type="button"
            className="skr-session-picker-new"
            onClick={handleCreate}
            disabled={pending}
          >
            + New session
          </button>
        </div>
      ) : null}

      {dialog ? (
        <Modal variant="panel" title={dialogTitle} onClose={closeDialog} style={{ width: 360 }}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              confirmDialog();
            }}
            style={{ display: "flex", flexDirection: "column", gap: 12 }}
          >
            {dialog.type === "delete" ? (
              <p style={{ fontSize: 13, margin: 0 }}>
                Delete “{dialog.session.name}”? This also wipes the conversation memory for this
                session.
              </p>
            ) : (
              <input
                className="skr-input"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                placeholder="Session name"
                aria-label="Session name"
                autoFocus
              />
            )}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                type="button"
                className="skr-btn-secondary"
                onClick={closeDialog}
                disabled={pending}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="skr-btn-primary"
                disabled={pending || (dialog.type !== "delete" && !nameInput.trim())}
              >
                {dialog.type === "create"
                  ? "Create"
                  : dialog.type === "rename"
                    ? "Rename"
                    : "Delete"}
              </button>
            </div>
          </form>
        </Modal>
      ) : null}
    </div>
  );
}
