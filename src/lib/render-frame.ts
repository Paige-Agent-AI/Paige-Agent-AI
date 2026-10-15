// The non-React half of /render-frame (src/pages/public/RenderFrame.tsx): reading the payload
// paige-browser injects, and deciding when the frame has settled enough to be captured. Kept apart
// from the component so Fast Refresh keeps working and the logic is testable on its own.
import type { GrowthBlock, GrowthPageTheme } from "@/lib/growth";
import type { GrowthBrandRow } from "@/components/growth/growth-theme";
import { brandFontsSettled } from "@/lib/brand-fonts";

declare global {
  interface Window {
    __PAIGE_RENDER_PAYLOAD__?: unknown;
  }
}

export interface RenderPayload {
  blocks: GrowthBlock[];
  theme: GrowthPageTheme | null;
  brand: GrowthBrandRow | null;
  tenantName: string | null;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  v != null && typeof v === "object" && !Array.isArray(v);

/** Read and shape-check the injected payload. Anything malformed is treated as no payload. */
export function readRenderPayload(raw: unknown = typeof window !== "undefined" ? window.__PAIGE_RENDER_PAYLOAD__ : undefined): RenderPayload | null {
  if (!isPlainObject(raw) || !Array.isArray(raw.blocks)) return null;
  const blocks = raw.blocks.filter(
    (b): b is GrowthBlock => isPlainObject(b) && typeof (b as { type?: unknown }).type === "string",
  );
  return {
    blocks,
    theme: isPlainObject(raw.theme) ? (raw.theme as GrowthPageTheme) : null,
    brand: isPlainObject(raw.brand) ? (raw.brand as GrowthBrandRow) : null,
    tenantName: typeof raw.tenant_name === "string" ? raw.tenant_name.slice(0, 200) : null,
  };
}

// How long the frame waits for fonts + images before it signals ready anyway. A broken image must not
// stall the capture forever; /render's own ready timeout is longer than this.
export const RENDER_SETTLE_CAP_MS = 8000;

function imageSettled(img: HTMLImageElement): Promise<void> {
  if (img.complete) return Promise.resolve();
  return new Promise((resolve) => {
    img.addEventListener("load", () => resolve(), { once: true });
    img.addEventListener("error", () => resolve(), { once: true });
  });
}

const nextFrame = () => new Promise<void>((resolve) => {
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => resolve());
  else setTimeout(resolve, 16);
});

// An iframe fires load (also for most failures); there is no reliable error event, so the cap bounds it.
function embedSettled(frame: HTMLIFrameElement): Promise<void> {
  return new Promise((resolve) => { frame.addEventListener("load", () => resolve(), { once: true }); });
}

/** Resolve once fonts, every image and every embed under `root` have loaded or failed, capped at `capMs`. */
export async function settleRenderFrame(root: HTMLElement, capMs = RENDER_SETTLE_CAP_MS): Promise<void> {
  // Render-only: a full-page capture never scrolls, so anything marked loading="lazy" below the fold
  // would never be requested. Today that is the media block's <iframe> (GrowthBlocks MediaBlock); an
  // <img> may carry it too. Upgrading to eager changes nothing a visitor sees once it has loaded.
  const images = Array.from(root.querySelectorAll("img"));
  const embeds = Array.from(root.querySelectorAll("iframe"));
  for (const el of [...images, ...embeds]) if (el.getAttribute("loading") === "lazy") el.setAttribute("loading", "eager");
  // Wait one frame before reading any font state: GrowthBlocks registers its brand-face loads in a
  // layout effect of the same commit, so they exist by now — but a frame also absorbs any face a later
  // commit injects, rather than trusting effect order alone. Then force style + layout so every face
  // the rendered text needs is already a pending load when fonts.ready is read (a face first needed by
  // the next recalc is not pending yet, and ready would resolve early). The brand faces are awaited
  // explicitly as well.
  await nextFrame();
  void root.offsetHeight;
  const doc = root.ownerDocument ?? (typeof document !== "undefined" ? document : null);
  const fonts = Promise.all([
    doc?.fonts ? doc.fonts.ready.then(() => undefined) : Promise.resolve(),
    brandFontsSettled(doc),
  ]).then(() => undefined);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cap = new Promise<void>((resolve) => { timer = setTimeout(resolve, capMs); });
  await Promise.race([Promise.all([fonts, ...images.map(imageSettled), ...embeds.map(embedSettled)]).then(() => undefined), cap]);
  if (timer) clearTimeout(timer);
  // Two frames so layout and paint of the settled content have happened before the marker flips.
  await nextFrame();
  await nextFrame();
}
