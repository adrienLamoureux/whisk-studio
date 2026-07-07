import React from "react";
import Spinner from "../shared/Spinner";

export default function ModulePanel({ title, isLoading, action, children }) {
  return (
    <div className="skr-card" style={{ padding: 20 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 12,
        }}
      >
        <p className="skr-module-title" style={{ margin: 0 }}>
          {title}
        </p>
        {action}
      </div>
      {isLoading ? <Spinner size="sm" /> : <div className="skr-info-list">{children}</div>}
    </div>
  );
}
