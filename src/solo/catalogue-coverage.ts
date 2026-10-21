/**
 * Public registry coverage, presented with the existing catalogue TruthPill.
 * This is not runtime availability: permissions/connections are rechecked by the
 * canonical capability pathway when used. Metadata alone can never assert Live.
 */
export interface CatalogueCoverageView {
  label: "Limited" | "Coming Soon" | "Unverified";
  tone: "partial" | "proposed" | "neutral";
}

export function presentCatalogueCoverage(skill: { on: boolean; catalogueCoverage?: unknown }): CatalogueCoverageView | null {
  const value = skill.catalogueCoverage;
  if (!skill.on || !value || typeof value !== "object" || Array.isArray(value)) return null;
  const declared = value as Record<string, unknown>;
  if (!Object.prototype.hasOwnProperty.call(declared, "version") || declared.version !== 1
    || !Object.prototype.hasOwnProperty.call(declared, "state")) return null;
  switch (declared.state) {
    case "limited": return { label: "Limited", tone: "partial" };
    case "coming_soon": return { label: "Coming Soon", tone: "proposed" };
    case "unverified": return { label: "Unverified", tone: "neutral" };
    default: return null;
  }
}
