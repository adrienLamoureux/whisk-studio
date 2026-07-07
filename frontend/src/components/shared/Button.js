import React from "react";
import Spinner from "./Spinner";

const VARIANT_CLASS = {
  primary: "skr-btn-primary",
  secondary: "skr-btn-secondary",
  ghost: "skr-btn-ghost",
  icon: "skr-icon-btn",
};

/**
 * Shared button primitive over the existing skr-btn-* classes.
 * `loading` disables the button and prefixes a bare spinner ring.
 */
export default function Button({
  variant = "primary",
  loading = false,
  disabled = false,
  type = "button",
  className = "",
  children,
  ...rest
}) {
  const base = VARIANT_CLASS[variant] || VARIANT_CLASS.primary;
  const cls = `${base}${className ? ` ${className}` : ""}`;
  return (
    <button type={type} className={cls} disabled={disabled || loading} {...rest}>
      {loading && <Spinner size="sm" label={null} />}
      {children}
    </button>
  );
}
