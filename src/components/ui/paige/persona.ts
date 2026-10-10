import type { VP } from "@/components/ui/page";

/**
 * Agent-presence persona seam (Wave 4 Slice 4a.1).
 *
 * The right-rail + ⌘K launcher are CHROME, not a chat design (agent-ui-placement
 * spec §11 non-goal). This file is the ONE seam where "which Paige persona speaks
 * on this surface" is decided — kept deliberately thin and prop-driven so the real
 * binding can be wired later WITHOUT a refactor of the rail.
 *
 * ── WHY THIS IS A SEAM, NOT A HARDCODED ROSTER (open owner decision) ────────────
 * The VP-remit authority is UNRESOLVED: the frozen `VP_ROSTER` (7 ids —
 * PAIGE + 6 VPs, see `@/components/ui/page` PaigeAttribution) and the broader
 * "roster doctrine" disagree on which VP owns which surface/remit. Binding a VP
 * here now would bake that conflict into shared chrome. So {@link AgentPersona.vp}
 * stays OPTIONAL and defaults `undefined`; the rail renders the neutral
 * orchestrator identity ("Paige" / "Paige Operator") until the owner rules and a
 * later slice fills the binding in — a one-line change in {@link resolveAgentPersona}.
 *
 * §2/§9-clean: labels here are coaching-generic and platform-vs-tenant aware — no
 * finance/credit wording, no vertical copy. A tenant's ACTUAL persona name/voice is
 * tenant-authored per Playbook (§7) and layers on top via the `persona` prop the
 * host passes in; this only supplies the platform default when none is provided.
 */

/**
 * Presentation-only account classification the rail adapts to (spec §5a). This is
 * NEVER an authorization signal — the real tenant/operator boundary is server-side
 * (RLS + PlatformStaffOnly, §9). It only picks which chrome/identity the rail shows.
 */
export type AgentAccountType = "solo" | "sub_account" | "agency" | "platform_operator";

/** A resolved persona identity for the rail header + launcher. Pure display data. */
export interface AgentPersona {
  /** Stable id for the resolved identity (not a VP id). */
  id: "paige" | "paige-operator";
  /** Display name shown in the rail header + launcher (tenant persona overrides this). */
  label: string;
  /** One-line remit shown under the name; 5-second-legible (§36). */
  tagline: string;
  /**
   * Optional VP binding — INTENTIONALLY undefined by default (see file header:
   * VP_ROSTER-vs-roster authority is an open owner decision). Wired in a later slice.
   */
  vp?: VP;
  /**
   * When true the rail applies the distinct operator visual hint (spec §5a Super
   * Admin: "never confused with the tenant experience"). Gold stays reserved for the
   * act moment (§11) — this is an accent-tinted mark + label chip, not a gold fill.
   */
  operator?: boolean;
}

/**
 * The platform-default persona for a given account type. A host may pass its own
 * `persona` (e.g. a tenant-authored Playbook persona, §7) to override this entirely;
 * this is only the fallback so the rail is never identity-less.
 *
 * A platform operator at rest (either tier) → "Paige Operator" (spec §5a): terser, fleet-framed, visually
 * differentiated. Every tenant-facing type → the neutral "Paige" orchestrator
 * identity; the tenant's real name/voice arrives via the `persona` prop.
 */
export function resolveAgentPersona(accountType: AgentAccountType): AgentPersona {
  if (accountType === "platform_operator") {
    return {
      id: "paige-operator",
      label: "Paige Operator",
      tagline: "Fleet-wide operations",
      operator: true,
    };
  }
  return {
    id: "paige",
    label: "Paige",
    tagline: "Your team, on call",
  };
}
