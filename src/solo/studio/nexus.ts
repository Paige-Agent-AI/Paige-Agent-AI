// NEXUS in Vibe Studio — truthful departmental attribution for brand/website work (EXP06, ANT-162).
//
// The roster doctrine (docs/doctrine/paige-c-suite-roster.md#specialist-identity-and-department-attribution,
// owner standard Oct 23 2026) names NEXUS the Marketing & growth specialist and EXP06 an adoption
// owner. These helpers put a contextual "Plan with NEXUS" / "Review with NEXUS" entry at the
// Studio's brand/website points WITHOUT relabeling the Studio's design conversation: the handoff
// addresses NEXUS in the owner's existing global PAIGE chat through the paigePromptHandoff seam,
// which PREFILLS the composer and never sends. Every prompt states PAIGE remains the COO and that
// no action or publication follows. A responsibility label is not evidence NEXUS generated an
// artifact; artifact bylines stay exactly what they already are.
import { VP_ROSTER } from "@/components/ui/page/PaigeAttribution";
import { DEPT_VP } from "@/lib/paige/vpDepartments";

/** "Nexus" — resolved from the roster, never a local string, so a roster rename follows through. */
export function nexusDisplayName(): string {
  return VP_ROSTER.NEXUS.name;
}

/** The department remit the labels state ("Marketing & growth"), from the same roster row. */
export function nexusDepartmentRemit(): string {
  return VP_ROSTER.NEXUS.remit;
}

/** The department tie itself: the typed edges are the one seam that says marketing → NEXUS.
 * Compile-time truth; the test asserts it so a re-org cannot silently strand the Studio label. */
export const STUDIO_DEPARTMENT_OWNING_VP: "NEXUS" = (() => {
  const vp = DEPT_VP.marketing;
  if (vp !== "NEXUS") throw new Error(`marketing is ${vp}'s department now; re-ground the Studio NEXUS adoption before shipping`);
  return vp;
})();

const KIND_WORD: Record<string, string> = { form: "form", page: "page", funnel: "funnel", content: "image" };

/** "Plan with NEXUS" — the brand/website planning entry. Editable in PAIGE's composer; never sent. */
export function planWithNexusPrompt(): string {
  return `${nexusDisplayName()}, help me plan this business's brand and public presence — what my website and pages need to say, for whom, and what should happen next. Work from my confirmed business details and brand, and tell me what's missing or conflicting. PAIGE remains my COO. Do not take an action.`;
}

/** "Review with NEXUS" — the pre-approval review entry, citing the door's own prepared facts. */
export function reviewWithNexusPrompt(kind: string, title: string | null, address?: string | null): string {
  const what = title ? `${KIND_WORD[kind] ?? "piece"} "${title}"` : `${KIND_WORD[kind] ?? "piece"} I'm about to publish`;
  const where = address ? ` at ${address}` : "";
  return `${nexusDisplayName()}, review the ${what} before I publish it${where}. Check the wording and the offer against my confirmed brand and business details, and tell me anything a visitor would find confusing or missing. PAIGE remains my COO. Do not publish anything — the approval stays mine.`;
}
