// @vitest-environment node
// Auto model selection (owner ask 2026-10-03): most owners do not know which model suits the job,
// so Paige reads the brief and picks — cheapest model that fits, premium only when the brief asks
// for what premium is for — and says why in one plain line. An explicit choice always wins.
import { describe, expect, it } from "vitest";
import { selectMediaModel } from "../../supabase/functions/_shared/media-provider/auto-select.ts";
import type { MediaModelInfo } from "../../supabase/functions/_shared/media-provider/mod.ts";

const CATALOG: MediaModelInfo[] = [
  { id: "img-std", label: "Nano Banana", mode: "image", tier: "standard", estCostPerUnitUsd: 0.039, unit: "image" },
  { id: "img-pro", label: "Flux Pro 1.1", mode: "image", tier: "premium", estCostPerUnitUsd: 0.04, unit: "image" },
  { id: "img-edit", label: "Nano Banana Edit", mode: "image_edit", tier: "standard", estCostPerUnitUsd: 0.039, unit: "image" },
  { id: "vid-std", label: "Veo 3.1 Fast", mode: "video", tier: "standard", estCostPerUnitUsd: 0.15, unit: "second" },
  { id: "vid-pro", label: "Veo 3.1", mode: "video", tier: "premium", estCostPerUnitUsd: 0.4, unit: "second" },
];

const pick = (prompt: string, extra: Partial<Parameters<typeof selectMediaModel>[0]> = {}) =>
  selectMediaModel({ prompt, catalog: CATALOG, hasReferences: false, videoAvailable: true, ...extra });

describe("Paige picks the model from the brief", () => {
  it("uses the everyday image model for an ordinary social image", () => {
    const r = pick("Square social image announcing my spring strategy workshop, calm and confident");
    expect(r.model).toBe("img-std");
    expect(r.reason).toMatch(/everyday image model/i);
  });

  it("uses the premium image model when the brief asks for a photo-real look", () => {
    for (const brief of [
      "A photorealistic headshot-style image of a consultant at a desk",
      "Realistic product photo of our workbook on a wooden table",
      "High-detail cinematic image for the homepage hero",
    ]) {
      const r = pick(brief);
      expect(r.model, brief).toBe("img-pro");
      expect(r.reason, brief).toMatch(/Flux Pro 1\.1/);
    }
  });

  it("edits when there is an image to work from", () => {
    const r = pick("Make the background warmer", { hasReferences: true });
    expect(r.model).toBe("img-edit");
    expect(r.reason).toMatch(/edit/i);
  });

  it("makes video when the brief asks for motion", () => {
    expect(pick("A 6 second reel teasing the workshop").model).toBe("vid-std");
    expect(pick("Short animated clip of our logo").model).toBe("vid-std");
    expect(pick("Cinematic video for the launch, premium quality").model).toBe("vid-pro");
  });

  it("falls back to an image, and says so, when video is switched off", () => {
    const r = pick("A short video for Instagram", { videoAvailable: false });
    expect(r.model).toBe("img-std");
    expect(r.reason).toMatch(/video is switched off/i);
  });

  it("does not mistake an ordinary word for a video request", () => {
    expect(pick("An image for my video course landing page").model).toBe("img-std");
  });

  it("an explicit choice always wins over the pick", () => {
    const r = pick("A photorealistic portrait", { requested: "img-std" });
    expect(r.model).toBe("img-std");
    expect(r.auto).toBe(false);
  });

  it("an unknown explicit choice is refused, not silently replaced", () => {
    expect(() => pick("Anything", { requested: "made-up-model" })).toThrow(/Unknown media model/);
  });

  it("returns null when nothing suitable is configured", () => {
    const r = selectMediaModel({ prompt: "an image", catalog: [], hasReferences: false, videoAvailable: false });
    expect(r).toBeNull();
  });
});
