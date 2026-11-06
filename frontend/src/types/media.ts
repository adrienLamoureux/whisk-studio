/** Shared shapes for gallery media and character selection used by the shared components. */

/** An image or video tile as the gallery components read it. Extra API fields pass through. */
export interface GalleryImage {
  key?: string;
  url?: string;
  prompt?: string;
  favorite?: boolean;
  [field: string]: unknown;
}

/** A character from `GET /characters`. */
export interface CharacterSummary {
  id: string;
  name?: string;
  source?: string;
  defaultLoraProfileId?: string | null;
  [field: string]: unknown;
}

/** A LoRA profile from `GET /lora/profiles`. */
export interface LoraProfileSummary {
  id: string;
  name?: string;
  displayName?: string;
  [field: string]: unknown;
}
