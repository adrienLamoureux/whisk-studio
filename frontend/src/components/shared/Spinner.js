import React from "react";

/**
 * Shared loading spinner — a ring (skr-ring-spin) with an optional text label.
 * Pass label={null} for a bare ring (e.g. inside buttons).
 */
export default function Spinner({ size = "md", label = "Loading…", className = "" }) {
  const cls = `skr-spinner skr-spinner--${size}${className ? ` ${className}` : ""}`;
  return (
    <span className={cls} role="status" aria-label={label || "Loading"}>
      <span className="skr-spinner-ring" aria-hidden="true" />
      {label ? <span className="skr-spinner-label">{label}</span> : null}
    </span>
  );
}
