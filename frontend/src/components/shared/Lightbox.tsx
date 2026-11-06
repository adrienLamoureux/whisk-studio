import React, { useEffect, useRef } from "react";

/**
 * Shared image lightbox overlay — replaces the hand-rolled copies that lived
 * in HomePage and Whisk. Escape and backdrop click both dismiss; focus lands
 * on the close button so keyboard users aren't stranded behind the overlay.
 *
 * Renders nothing when `image` is falsy; expects `{ url, prompt? }`.
 */
export interface LightboxProps {
  image?: { url?: string; prompt?: string } | null;
  onClose?: () => void;
}

export default function Lightbox({ image, onClose }: LightboxProps) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!image) return undefined;
    closeRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [image, onClose]);

  if (!image) return null;

  return (
    <div
      className="skr-lightbox"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Image preview"
    >
      <button ref={closeRef} className="skr-lightbox-close" onClick={onClose} aria-label="Close">
        ✕
      </button>
      <img src={image.url} alt={image.prompt || ""} onClick={(e) => e.stopPropagation()} />
    </div>
  );
}
