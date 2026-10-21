/**
 * useSoloSkills — the Solo Paige-Hub › Skills adapter (§18: reads the EXISTING
 * `paige_skills` registry, never a new table/RPC).
 *
 * TIER-GATED via `@/lib/tier/tierFeatures` (§60/§61 — the ONE home for "which tier
 * gets which feature"), TWO layers so a Solo tenant sees only its ENTITLED skills,
 * never the admin-global list:
 *   1. FEATURE gate — `useTierFeatures().has("skills")`. Solo/sub_account/enterprise/
 *      god get the skills engine; an AGENCY does NOT self-use skills (its §61 right is
 *      Marketplace RESELL, not a tier Set bit), so an agency resolves to an empty list.
 *   2. ROW gate — each `paige_skills` row carries a `tier_availability` jsonb of the
 *      §61 Standing Tier Distribution Default ({god,solo,sub_account,agency,enterprise}
 *      → yes|resell|yes+resell|no). We keep only rows whose value for the CURRENT
 *      tierKey is self-use ('yes' or 'yes+resell'), so a skill distributed as 'resell'/
 *      'no' for this tier is filtered out even though RLS returned it.
 *
 * §9/§51 TENANT ISOLATION: no client-supplied tenant_id. The read is RLS-scoped
 * server-side (a tenant sees the platform defaults + its OWN tenant-authored rows;
 * a sub-account never sees a sibling's). The tier filter above is the FEATURE-scope
 * layer on top of that data-scope floor.
 *
 * §13/§31 HONESTY — REAL vs PREVIEW (mirrors the fixture shape in src/solo/paigehub.tsx
 * `PT.skills = {i, n, slug, ro, cat, on, runs, ok, d, trig}`):
 *   • n    — REAL (paige_skills.name).
 *   • slug — REAL (paige_skills.slug).
 *   • ro   — REAL (risk_level === 'read_only').
 *   • cat  — REAL (category).
 *   • on   — REAL (status === 'active'). We read only active rows, so all true — the
 *            callable skills, honestly (a de-activated platform skill is not surfaced).
 *   • runs — REAL (run_count).
 *   • ok   — REAL (success_count).
 *   • d    — REAL (description; present-guarded to '' when null — never invented copy).
 *   • trig — REAL (trigger_phrases; [] when null).
 *   • i    — DERIVED display index ('01','02',…) off list position — a presentation
 *            ordinal, not a backend field.
 *
 * The Skills component's four stat tiles ("117 / 114 / 86 / 2") are HARDCODED in the
 * JSX (not read from PT), so this adapter does not drive them — they stay PREVIEW
 * until a separate slice rewires those tiles. This adapter DOES expose `stats` with
 * the honestly-derivable aggregates (total, active) for that future slice; the two
 * with no cheap source (`runsThisWeek`, `proposals`) are marked PREVIEW (null).
 *
 * DROP-IN: `skills` returns the EXACT PT.skills shape; the rewire replaces the fixture
 * const with this array. UI is preserved verbatim (§28 owner-locked design).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTierFeatures } from "@/hooks/useTierFeatures";
import type { TierKey } from "@/lib/tier/tierFeatures";

/** One skill in the EXACT `PT.skills[]` shape the solo UI already renders. */
export interface SoloSkill {
  /** Display ordinal ('01','02',…) — DERIVED off position, not a backend field. */
  i: string;
  /** Name (REAL). */
  n: string;
  /** Slug (REAL). */
  slug: string;
  /** Read-only (REAL — risk_level === 'read_only'). */
  ro: boolean;
  /** Category (REAL). */
  cat: string;
  /** Active/callable (REAL — status === 'active'). */
  on: boolean;
  /** Run count (REAL). */
  runs: number;
  /** Success count (REAL). */
  ok: number;
  /** Description (REAL, present-guarded). */
  d: string;
  /** Trigger phrases (REAL, [] when null). */
  trig: string[];
  /** Public declared release coverage only; not runtime permission or connection state. */
  catalogueCoverage?: unknown;
}

/** Header stat tiles — total/active are REAL-derivable; the other two are PREVIEW. */
export interface SoloSkillsStats {
  /** Total entitled skills in the catalog (REAL — derived from the list). */
  total: number;
  /** Active + callable (REAL — same list; all are active by the read filter). */
  active: number;
  /** "Runs this week" — PREVIEW (no cheap windowed telemetry composed). */
  runsThisWeek: number | null;
  /** Open proposals — PREVIEW (no tenant-scoped proposal seam composed here). */
  proposals: number | null;
}

export interface SoloSkillsData {
  skills: SoloSkill[];
  stats: SoloSkillsStats;
  loading: boolean;
  error: string | null;
  /** True only when the tenant is genuinely entitled to none (empty catalog / agency). */
  empty: boolean;
  refresh: () => void;
}

/** The subset of `paige_skills` columns this adapter reads (S1a cols absent from
 *  generated types → typed locally + cast on the way out, like usePaigeDeptStatus). */
interface SkillRow {
  slug: string;
  name: string;
  description: string | null;
  category: string | null;
  risk_level: string | null;
  status: string | null;
  run_count: number | null;
  success_count: number | null;
  trigger_phrases: string[] | null;
  tier_availability: Record<string, string> | null;
  catalogue_coverage?: unknown;
}

/** Self-use entitlement for a tier: the §61 doc value contains 'yes' ('yes'/'yes+resell'). */
function isSelfUseEntitled(
  tierAvail: Record<string, string> | null | undefined,
  tierKey: TierKey,
): boolean {
  // Missing doc → treat as entitled (fail-open to the FEATURE gate above, which already
  // excluded agency); a malformed/absent map must not silently hide a legit platform skill.
  if (!tierAvail) return true;
  const v = tierAvail[tierKey];
  if (v == null) return true;
  return String(v).includes("yes"); // 'yes' | 'yes+resell'
}

const usd0 = (n: number): number => (typeof n === "number" && n > 0 ? n : 0);

export function useSoloSkills(): SoloSkillsData {
  const { has, tierKey, loading: tierLoading } = useTierFeatures();
  const [rows, setRows] = useState<SkillRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // FEATURE gate (§60/§61): agency (and any tier without 'skills') gets no self-use list.
  const skillsEntitled = has("skills");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    // Short-circuit for a non-entitled tier — no read at all (honest empty, not a fake list).
    if (!skillsEntitled) {
      setRows([]);
      setLoading(false);
      return;
    }
    try {
      const { data, error: qErr } = await supabase
        .from("paige_skills")
        .select(
          "slug,name,description,category,risk_level,status,run_count,success_count,trigger_phrases,tier_availability,catalogue_coverage:metadata->catalogue_coverage",
        )
        .eq("status", "active") // only callable skills surface to a tenant
        .order("category", { ascending: true })
        .order("name", { ascending: true })
        .limit(500);
      if (qErr) throw qErr;
      setRows((data as unknown as SkillRow[] | null) ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load your skills.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [skillsEntitled]);

  useEffect(() => {
    void load();
  }, [load]);

  const skills = useMemo<SoloSkill[]>(() => {
    if (!skillsEntitled) return [];
    return rows
      // ROW gate (§61): keep only skills self-use-entitled for the CURRENT tier.
      .filter((r) => isSelfUseEntitled(r.tier_availability, tierKey))
      .map((r, idx) => ({
        i: String(idx + 1).padStart(2, "0"), // DERIVED ordinal
        n: r.name,
        slug: r.slug,
        ro: r.risk_level === "read_only",
        cat: r.category ?? "",
        on: r.status === "active",
        runs: usd0(r.run_count ?? 0),
        ok: usd0(r.success_count ?? 0),
        d: r.description ?? "",
        trig: Array.isArray(r.trigger_phrases) ? r.trigger_phrases : [],
        catalogueCoverage: r.catalogue_coverage,
      }));
  }, [rows, skillsEntitled, tierKey]);

  const stats = useMemo<SoloSkillsStats>(
    () => ({
      total: skills.length, // REAL
      active: skills.filter((s) => s.on).length, // REAL
      runsThisWeek: null, // PREVIEW
      proposals: null, // PREVIEW
    }),
    [skills],
  );

  const empty = !loading && !tierLoading && skills.length === 0;

  return { skills, stats, loading: loading || tierLoading, error, empty, refresh: load };
}
