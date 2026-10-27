// The section band rhythm — ONE implementation shared by the React renderer and the portable
// export, so a downloaded page carries the same tonal cadence the live page shows. Pure data:
// no React here.
import type { GrowthBlock } from "./growth";

export type GpBand = "brand" | "contrast" | "deep";

const BAND_CYCLE: GpBand[] = ["brand", "contrast", "deep", "contrast"];

export function assignBands(blocks: GrowthBlock[]): GpBand[] {
  const out: GpBand[] = [];
  let contentIdx = 0;
  let prev: GpBand | null = null;
  for (const b of blocks) {
    let band: GpBand;
    if (b.type === "hero" || b.type === "hero_scene") band = "brand"; // heroes own the brand tone (their own scrim/scene)
    else if (b.type === "stats") band = "deep"; // a proof band reads best as a dark strip
    else {
      band = BAND_CYCLE[contentIdx % BAND_CYCLE.length];
      contentIdx++;
    }
    if (band === prev) band = band === "contrast" ? "brand" : "contrast"; // never two same tones touching
    out.push(band);
    prev = band;
  }
  return out;
}
