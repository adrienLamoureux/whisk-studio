import React, { useMemo } from "react";
import { useTheme } from "../contexts/ThemeContext";
import SOL_MASONRY_DEFAULTS from "../data/skr-masonry-defaults.json";
import OBSCURA_MASONRY_DEFAULTS from "../data/skr-masonry-obscura-defaults.json";

const COLUMNS = [
  { id: "col-a", durationSeconds: 86, startOffset: "0%" },
  { id: "col-b", durationSeconds: 94, startOffset: "-11%" },
  { id: "col-c", durationSeconds: 102, startOffset: "-22%" },
];

const REPEAT_COUNT = 3;

function buildLoopedImages(base, repeat) {
  const out = [];
  for (let r = 0; r < repeat; r++) {
    for (const img of base) {
      out.push({ ...img, loopId: `${img.id}-${r}` });
    }
  }
  return out;
}

/**
 * Animated vertical-scrolling masonry hero.
 * Props:
 *   images  – array of { id, src }  (falls back to bundled defaults when empty)
 *   title   – headline text
 *   subtitle – sub-headline text
 *
 * Defaults are aesthetic-aware (ADR-010): Sakura shows anime art, Obscura
 * shows public-domain chiaroscuro/Belle Époque paintings (self-hosted under
 * public/masonry/obscura/). The `--painted` modifier lets obscura CSS skip
 * the sepia mute that is meant for anime community images.
 */
export default function SolarisMasonry({ images = [], title, subtitle }) {
  const { aesthetic } = useTheme() || {};
  const usingDefaults = images.length === 0;
  const isPainted = usingDefaults && aesthetic === "obscura";
  const base = !usingDefaults
    ? images
    : isPainted
      ? OBSCURA_MASONRY_DEFAULTS
      : SOL_MASONRY_DEFAULTS;
  const looped = useMemo(() => buildLoopedImages(base, REPEAT_COUNT), [base]);

  return (
    <div
      className={`skr-masonry-hero${isPainted ? " skr-masonry-hero--painted" : ""}`}
      aria-hidden="true"
    >
      <div className="skr-masonry-grid">
        {COLUMNS.map((col) => (
          <div
            key={col.id}
            className="skr-masonry-column"
            style={{
              "--skr-masonry-duration": `${col.durationSeconds}s`,
              "--skr-masonry-start": col.startOffset,
            }}
          >
            {looped.map((img) => (
              <figure key={`${col.id}-${img.loopId}`} className="skr-masonry-card">
                <img src={img.src} alt="" loading="lazy" decoding="async" />
              </figure>
            ))}
          </div>
        ))}
      </div>

      {(title || subtitle) && (
        <div className="skr-masonry-overlay">
          {title && <p className="skr-masonry-title">{title}</p>}
          {subtitle && <p className="skr-masonry-subtitle">{subtitle}</p>}
        </div>
      )}
    </div>
  );
}
