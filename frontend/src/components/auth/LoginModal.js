import React from "react";
import { useAuth } from "../../contexts/AuthContext";
import Modal from "../shared/Modal";
import Button from "../shared/Button";

export default function LoginModal({ isOpen, onClose, message }) {
  const { startLogin, isConfigured } = useAuth();

  const handleLogin = async () => {
    const currentPath = window.location.pathname + window.location.search;
    try {
      await startLogin(currentPath);
    } catch (err) {
      console.error("Login redirect failed:", err);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} ariaLabel="Sign in">
      <div className="skr-login-emblem" aria-hidden="true">
        ✦
      </div>
      <h2 className="skr-modal-title">Sign in to continue</h2>
      {message && <p className="skr-modal-message">{message}</p>}
      <Button className="skr-modal-action" onClick={handleLogin} disabled={!isConfigured}>
        Sign in with Cognito
      </Button>
      <Button variant="ghost" className="skr-modal-action" onClick={onClose}>
        Continue browsing
      </Button>
    </Modal>
  );
}
