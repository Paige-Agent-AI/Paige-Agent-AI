// Auto model selection for Vibe Studio media (owner ask 2026-10-03: "most people don't know which
// model is the best-case model for the job"). Paige reads the brief and picks the cheapest model
// that fits; premium only when the brief asks for what premium is for. The pick always carries a
// one-line reason the owner sees, and an explicit choice always wins. Pure: no env, no I/O.
import type { MediaModelInfo } from "./mod.ts";

export interface AutoSelectInput {
  prompt: string;
  catalog: readonly MediaModelInfo[];
  /** The brief names existing images to work from (an edit). */
  hasReferences: boolean;
  /** Video is switched on for this workspace. */
  videoAvailable: boolean;
  /** The owner picked a model themselves; "auto" or empty means let Paige pick. */
  requested?: string | null;
}

export interface AutoSelectResult {
  model: string;
  label: string;
  /** True when Paige picked; false when the owner's own choice was used. */
  auto: boolean;
  /** One plain sentence, shown in the Studio. */
  reason: string;
}

const VIDEO = /\b(video|videos|clip|clips|reel|reels|animate|animated|animation|motion|footage|b-roll)\b/i;
// "video" inside a phrase about something else ("my video course", "video call") is not a request
// for motion.
const VIDEO_NOUN_USE = /\bvideo\s+(course|call|calls|series|library|lesson|lessons|training|program|programme|tutorial|tutorials)\b/i;
const PREMIUM = /\b(photo-?real(istic)?|realistic|lifelike|product (photo|shot)|headshot|portrait|cinematic|high[- ]detail|highly detailed|premium|studio[- ]quality|print[- ]ready|magazine|editorial photo)\b/i;

function byMode(catalog: readonly MediaModelInfo[], mode: MediaModelInfo["mode"], tier?: MediaModelInfo["tier"]) {
  return catalog.find((m) => m.mode === mode && (tier ? m.tier === tier : true))
    ?? (tier ? catalog.find((m) => m.mode === mode) : undefined);
}

export function selectMediaModel(input: AutoSelectInput): AutoSelectResult | null {
  const { prompt, catalog, hasReferences, videoAvailable } = input;
  const requested = (input.requested ?? "").trim();

  if (requested && requested !== "auto") {
    const entry = catalog.find((m) => m.id === requested);
    if (!entry) throw new Error(`Unknown media model "${requested}".`);
    return { model: entry.id, label: entry.label, auto: false, reason: `Using ${entry.label}, as you chose.` };
  }

  const wantsVideo = VIDEO.test(prompt) && !VIDEO_NOUN_USE.test(prompt);
  const wantsPremium = PREMIUM.test(prompt);

  if (hasReferences) {
    const edit = byMode(catalog, "image_edit");
    if (edit) return { model: edit.id, label: edit.label, auto: true, reason: `Using ${edit.label} to edit the image you picked.` };
  }

  if (wantsVideo && videoAvailable) {
    const video = byMode(catalog, "video", wantsPremium ? "premium" : "standard");
    if (video) {
      return {
        model: video.id, label: video.label, auto: true,
        reason: video.tier === "premium"
          ? `Using ${video.label}: you asked for a cinematic, high-quality video.`
          : `Using ${video.label}: it makes short clips quickly at the lowest cost.`,
      };
    }
  }

  const image = byMode(catalog, "image", wantsPremium ? "premium" : "standard");
  if (!image) return null;
  const videoNote = wantsVideo && !videoAvailable ? " Video is switched off for this workspace, so this is a still image." : "";
  return {
    model: image.id, label: image.label, auto: true,
    reason: (image.tier === "premium"
      ? `Using ${image.label}: you asked for a photo-real, detailed look.`
      : `Using ${image.label}, the everyday image model: fast and lowest cost.`) + videoNote,
  };
}
