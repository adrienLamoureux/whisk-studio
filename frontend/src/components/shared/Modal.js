import React, { useEffect } from "react";

/**
 * Shared modal primitive — the single skr-modal-overlay/card implementation.
 *
 * Variants:
 *  - "card" (default): centered content card (login-style), absolute ✕ in the
 *    corner; the caller renders its own heading inside children when needed.
 *  - "panel": header row (title + ✕) above free-form content — the form-dialog
 *    look previously implemented ad hoc with skr-modal-backdrop/skr-modal.
 *
 * Handles overlay-click + Escape dismissal and dialog a11y wiring so call
 * sites only provide content.
 */
export default function Modal({
  isOpen = true,
  onClose,
  title,
  variant = "card",
  ariaLabel,
  className = "",
  style,
  children,
}) {
  useEffect(() => {
    if (!isOpen) return undefined;
    const onKeyDown = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const isPanel = variant === "panel";
  const overlayClass = `skr-modal-overlay${isPanel ? " skr-modal-overlay--panel" : ""}`;
  const cardClass = `skr-modal-card${isPanel ? " skr-modal-card--panel" : ""}${
    className ? ` ${className}` : ""
  }`;

  const handleOverlayClick = (e) => {
    if (e.target === e.currentTarget) onClose?.();
  };

  return (
    <div
      className={overlayClass}
      onClick={handleOverlayClick}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel || title}
    >
      <div className={cardClass} style={style}>
        {isPanel ? (
          <div className="skr-modal-head">
            <span className="skr-modal-title">{title}</span>
            <button type="button" className="skr-modal-close" onClick={onClose} aria-label="Close">
              ✕
            </button>
          </div>
        ) : (
          <button type="button" className="skr-modal-close" onClick={onClose} aria-label="Close">
            &times;
          </button>
        )}
        {children}
      </div>
    </div>
  );
}
