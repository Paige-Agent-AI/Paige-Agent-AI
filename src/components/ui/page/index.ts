/**
 * Paige Admin — shared premium primitive layer.
 *
 * The Marketplace bar (SkillCard + hero masthead), generalized: hero masthead,
 * numbered rails, embossed glyph-plates, an elevation ladder, word-pills that
 * carry state, gold reserved for the on-moment, motion guarded by
 * useReducedMotion. Every admin page should be:
 *
 *   <PageShell width="…">
 *     <PageHeader … />          // variant="hero" on hubs, "plain" on leaves
 *     <StatRow><StatTile … /></StatRow>
 *     <SectionCard …>…</SectionCard>
 *     <DataTableShell …>…</DataTableShell>  // EmptyState in its `empty` slot
 *   </PageShell>
 *
 * GOLD DISCIPLINE (§6): gold is spent ONLY on the act/approve/on moment —
 * `<Button variant="gold">` for Approve / Send / Run / Enable / the single
 * primary act, and `<StatePill state="on">` for the live state. Never a resting
 * border, decorative icon, selected row, or focus ring (rings are --ring indigo).
 * Gold-as-text uses --gold-dark; gold-as-fill pairs --accent-foreground.
 *
 * TENANT-GENERIC (§2/§9): these are neutral primitives — no vertical/finance
 * content. Copy passed in stays mogul-founder voice and never leaks backend
 * table/function names (that's what EmptyState is for).
 */
export { GlyphPlate } from "./GlyphPlate";
export {
  ArtifactPreview,
  type ArtifactPreviewKind,
  type ArtifactPreviewProps,
  type FormFieldPreview,
  type FormSectionPreview,
} from "./ArtifactPreview";
export { PageShell } from "./PageShell";
export { PageHeader, type PageHeaderProps } from "./PageHeader";
export { PageSkeleton } from "./PageSkeleton";
export { SectionCard } from "./SectionCard";
export { SectionNote } from "./SectionNote";
export { StatTile, StatRow } from "./StatTile";
export { StatPill, type StatPillProps, type StatPillTone } from "./StatPill";
export { Sparkline, type SparklineProps, type SparklineTone } from "./Sparkline";
export { DrillContainer, type DrillContainerProps } from "./DrillContainer";
export { MetricEntityCard, type MetricEntityCardProps } from "./MetricEntityCard";
export { ExploreChart, type ExploreChartProps } from "./ExploreChart";
export {
  TrendLineCard,
  DonutCard,
  BarCard,
  KpiPillRow,
  type TrendLineCardProps,
  type DonutCardProps,
  type BarCardProps,
  type KpiPillRowProps,
  type KpiPillItem,
  type ChartSeriesDef,
  type ChartEmpty,
  type DonutDatum,
} from "./ChartCards";
export {
  DateRangePicker,
  rangeToDates,
  type RangeKey,
  type DateRangeValue,
  type DateRangePickerProps,
} from "./DateRangePicker";
export { DataTableShell, type Column } from "./DataTableShell";
export { EmptyState } from "./EmptyState";
export { Toolbar, FilterChip } from "./Toolbar";
export { StatePill, type PillState } from "./StatePill";
export { ColorField, LogoUploader, BrandFontPicker, BRAND_IMG_TYPES, FONT_OPTIONS } from "./BrandControls";
export * from "./PresenceDot";
export {
  PaigeAttribution,
  VP_ROSTER,
  type VP,
  type PaigeContributor,
  type AttributionScope,
  type PaigeAttributionProps,
} from "./PaigeAttribution";
