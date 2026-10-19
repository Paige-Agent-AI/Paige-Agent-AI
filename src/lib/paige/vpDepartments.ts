/**
 * VP ↔ 10-department map — the ONE seam that reconciles the 7-member VP_ROSTER
 * (#243: PAIGE + 6 VPs) with the §16 10-department org model (paige_departments).
 *
 * WHY THIS EXISTS (§18 one home). Two surfaces need the same answer to "which VP
 * owns this department's work?": the Command Center department-status tiles
 * (usePaigeDeptStatus / PaigeDepartmentStatus) and the draft byline on ApprovalRow.
 * Rather than each re-deriving the mapping (a second taxonomy — §12/§18 violation),
 * both import it from here.
 *
 * INVENTS NO NAMES (§12/§243). VP identities come ONLY from the exported
 * {@link VP_ROSTER}; department slugs + display names come ONLY from the DB
 * (`paige_departments`, seeded by the §16 migrations). This module holds neither —
 * it is purely the *edges* between the two existing vocabularies. A VP is the
 * C-Suite officer; the departments are the desks that officer runs.
 *
 * SEAM RESOLUTION (§16). The 6 VPs OWN the 10 canonical departments (+ the active
 * `owner_ops` general desk — it still routes real kinds like `client.at_risk` /
 * `owner.*`, so it is folded under PAIGE rather than dropped). Each department maps
 * to exactly ONE VP so a department's work has an unambiguous owner:
 *
 *   PAIGE  (Orchestrator)            → executive_office, people_talent, owner_ops
 *   NEXUS  (Marketing & growth)      → marketing
 *   MERIT  (Sales & revenue)         → sales, finance
 *   CURA   (Client success)          → client_experience
 *   MENTOR (Discovery & education)   → product_curriculum
 *   ZION   (Operations & automation) → technology_automation, operations_pmo
 *   VERA   (Quality & standards)     → legal_compliance
 *
 * COMPILE-SAFE BOTH WAYS (§12). {@link DEPT_VP} is `Record<DeptSlug, VP>` (every
 * department must name an owner) and {@link VP_DEPARTMENTS} is
 * `Record<VP, DeptSlug[]>` (every roster member is accounted for) — so adding a
 * department OR changing the VP roster is a TypeScript error here, never silent drift.
 */
import type { VP } from "@/components/ui/page";

/** The canonical department slugs from `paige_departments` (§16 seed migrations):
 *  10 canonical desks + the still-active `owner_ops` general desk. */
export type DeptSlug =
  | "executive_office"
  | "marketing"
  | "sales"
  | "client_experience"
  | "product_curriculum"
  | "technology_automation"
  | "finance"
  | "people_talent"
  | "legal_compliance"
  | "operations_pmo"
  | "owner_ops";

/**
 * Which departments each VP owns. Explicit `Record<VP, …>` so a roster change
 * (a VP added or removed from VP_ROSTER) is a compile error, forcing an ownership
 * decision instead of a silent gap. This is the documentation/inverse view;
 * {@link DEPT_VP} is the runtime lookup.
 */
export const VP_DEPARTMENTS: Record<VP, DeptSlug[]> = {
  PAIGE: ["executive_office", "people_talent", "owner_ops"],
  NEXUS: ["marketing"],
  MERIT: ["sales", "finance"],
  CURA: ["client_experience"],
  MENTOR: ["product_curriculum"],
  ZION: ["technology_automation", "operations_pmo"],
  VERA: ["legal_compliance"],
};

/**
 * Runtime lookup: department slug → owning VP. Explicit `Record<DeptSlug, VP>` so a
 * new department is a compile error until it names an owner (§12). Kept in lockstep
 * with {@link VP_DEPARTMENTS} — the unit test asserts the two are mutually exact.
 */
export const DEPT_VP: Record<DeptSlug, VP> = {
  executive_office: "PAIGE",
  people_talent: "PAIGE",
  owner_ops: "PAIGE",
  marketing: "NEXUS",
  sales: "MERIT",
  finance: "MERIT",
  client_experience: "CURA",
  product_curriculum: "MENTOR",
  technology_automation: "ZION",
  operations_pmo: "ZION",
  legal_compliance: "VERA",
};

const KNOWN_DEPT = new Set<string>(Object.keys(DEPT_VP));

/**
 * Resolve the owning VP for a department slug, for the always-visible status tiles.
 *
 * Fallback to PAIGE (the orchestrator) on an UNKNOWN slug — a department the DB has
 * but this map hasn't caught up to must still render a live tile with a plausible
 * owner rather than crash or drop (§32: degrade visibly, never blank). This differs
 * deliberately from {@link resolveVpForActionKind}, which returns `null` (a draft
 * credit must never be fabricated — §13).
 */
export function resolveVpForDept(slug: string | null | undefined): VP {
  if (slug && KNOWN_DEPT.has(slug)) return DEPT_VP[slug as DeptSlug];
  return "PAIGE";
}

/**
 * Map an action-kind namespace (the token before the first `.`) onto a department.
 * The §16 seeded kinds are namespaced by desk (`marketing.*`, `sales.*`, `tech.*`,
 * …); this table maps those namespaces to the canonical slug. It maps EXISTING
 * vocabularies onto each other — it introduces no new kind or department.
 */
const NAMESPACE_DEPT: Record<string, DeptSlug> = {
  exec: "executive_office",
  executive: "executive_office",
  marketing: "marketing",
  sales: "sales",
  finance: "finance",
  curriculum: "product_curriculum",
  product: "product_curriculum",
  tech: "technology_automation",
  technology: "technology_automation",
  ops: "operations_pmo",
  operations: "operations_pmo",
  talent: "people_talent",
  people: "people_talent",
  legal: "legal_compliance",
  client: "client_experience",
  owner: "owner_ops",
};

/**
 * Resolve the owning VP for a draft/action, keyed off its `action_kind` slug (the
 * `category` on the approval queue row). Namespaced kinds (`marketing.draft_campaign`)
 * resolve via their namespace; a bare non-namespaced legacy category (`email`,
 * `follow_up`) that maps to no department resolves to `null`.
 *
 * §13 HONESTY: returns `null` — NOT a fallback VP — whenever the kind doesn't map to
 * a real department, so {@link PaigeAttribution} renders nothing rather than crediting
 * a VP that didn't do the work. A draft's byline is a factual claim; the status tiles
 * are an always-on roster, so only the tiles fall back.
 */
export function resolveVpForActionKind(actionKind: string | null | undefined): VP | null {
  if (!actionKind) return null;
  // A fully-qualified dept slug passed directly (e.g. from a linked action's
  // to_department) resolves exactly.
  if (KNOWN_DEPT.has(actionKind)) return DEPT_VP[actionKind as DeptSlug];
  const ns = actionKind.split(".")[0]?.toLowerCase();
  if (!ns) return null;
  const dept = NAMESPACE_DEPT[ns];
  return dept ? DEPT_VP[dept] : null;
}
