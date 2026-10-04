// The published landing page's presentation, with NO data loading: brand floor + the ONE block
// renderer + the page footer. Two callers share it so a screenshot of a draft is the page a visitor
// would see (§18 one home, no fork of the renderer):
//   • GrowthPageRenderer (/p/:tenant/:page) — loads a published row, then renders this.
//   • RenderFrame (/render-frame) — reads an injected payload (paige-browser /render), renders this.
import type { GrowthBlock, GrowthPageTheme } from "@/lib/growth";
import { GrowthBlocks } from "@/components/growth/GrowthBlocks";
import { buildGrowthBrandFloor, type GrowthBrandRow } from "@/components/growth/growth-theme";

export interface GrowthPageViewProps {
  blocks: GrowthBlock[] | null | undefined;
  theme?: GrowthPageTheme | null;
  /** The tenant brand. It becomes the FLOOR; the page's own theme overrides it. */
  brand?: GrowthBrandRow | null;
  /** Lets an embedded form resolve live. Absent → the form renders as a non-submitting preview. */
  tenantId?: string;
}

export function GrowthPageView({ blocks, theme, brand, tenantId }: GrowthPageViewProps) {
  // The floor is built by the ONE shared builder, which the Studio canvas also calls — that shared
  // call is what makes preview == published == screenshot true.
  const brandFloor: GrowthPageTheme = buildGrowthBrandFloor(brand ?? null);
  return (
    <GrowthBlocks blocks={blocks ?? []} theme={theme} brandFloor={brandFloor} tenantId={tenantId}>
      <footer className="py-10 text-center text-xs" style={{ color: "var(--gp-muted)" }}>
        © {new Date().getFullYear()}
      </footer>
    </GrowthBlocks>
  );
}

export default GrowthPageView;
