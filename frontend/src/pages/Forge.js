import React from "react";
import { useSearchParams } from "react-router-dom";
import Whisk from "./Whisk";
import WhiskVideos from "./WhiskVideos";
import ModeToggle from "../components/sakura/agent/ModeToggle";

export default function Forge() {
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "videos" ? "videos" : "images";
  const prefilledPrompt = params.get("prompt") || "";
  const prefilledStyle = params.get("style") || "";
  const prefilledAspect = params.get("aspect") || "";
  const prefilledSeed = params.get("seed") || "";
  const prefilledWidth = params.get("width") || "";
  const prefilledHeight = params.get("height") || "";

  // The top-right ModeToggle flips the Atelier between the form-based Dashboard
  // and the Live2D-central Companion drive surface (CompanionStage takes over
  // the viewport). There is no separate in-page "agent" stage anymore — see
  // ADR-009.
  return (
    <div className="skr-forge-dashboard-shell">
      <div className="skr-forge-mode-slot">
        <ModeToggle />
      </div>
      <div className="skr-page-header" style={{ marginBottom: 12 }}>
        <h2 className="skr-page-title">Atelier</h2>
        <p className="skr-page-subtitle">Generate images and animate videos</p>
      </div>
      <div className="skr-tab-bar" style={{ marginBottom: 16 }}>
        <button
          type="button"
          className={`skr-tab${tab === "images" ? " is-active" : ""}`}
          onClick={() => setParams({ tab: "images" })}
        >
          ◈ Images
        </button>
        <button
          type="button"
          className={`skr-tab${tab === "videos" ? " is-active" : ""}`}
          onClick={() => setParams({ tab: "videos" })}
        >
          ▶ Videos
        </button>
      </div>
      {tab === "videos" ? (
        <WhiskVideos />
      ) : (
        <Whisk
          prefilledPrompt={prefilledPrompt}
          prefilledStyle={prefilledStyle}
          prefilledAspect={prefilledAspect}
          prefilledSeed={prefilledSeed}
          prefilledWidth={prefilledWidth}
          prefilledHeight={prefilledHeight}
        />
      )}
    </div>
  );
}
