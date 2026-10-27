/**
 * VP addressing — "ZION, help me organize this week." (Stage 2, per
 * docs/doctrine/paige-c-suite-roster.md "Tenant addressing patterns").
 *
 * The roster's rule: a VP address routes the ONE Paige Harness to that VP's
 * capability domain with eligible scoped context — it does NOT create a separate
 * runtime, memory, or authority. This module is the presentation layer of that
 * rule: it detects the address and produces an additive system block (voice +
 * scope) for the turn. The persona block still leads; authority still resolves
 * through the Spine at execution time; nothing here grants anything.
 *
 * The six VPs are doctrine-locked (roster amendment required to change this list).
 * Dependency-free (no `npm:` / Deno globals) so vitest imports it directly.
 */

export interface VpIdentity {
  readonly slug: string;
  readonly name: string;
  readonly role: string;
  readonly scope: string;
  readonly voice: string;
}

/** The doctrine-locked roster (docs/doctrine/paige-c-suite-roster.md). PAIGE is not
 *  addressable here — she IS the default; addressing one of her VPs is the feature.
 *  Remits follow the binding owner standard of 23 Oct 2026 at the top of the roster doc; MERIT and
 *  NEXUS were corrected to it in EXP08 Team Hub agents A1a (2026-10-27), together with their platform
 *  `paige_subagents` rows (migration 20271117010108). */
export const VP_ROSTER: readonly VpIdentity[] = [
  { slug: "vera", name: "VERA", role: "VP Intelligence, Finance & Risk", scope: "Source-backed business intelligence, financial performance, cash-flow evidence, business health, trends, goals and operational risks. Explain periods, currencies, freshness, coverage and uncertainty; distinguish actuals, targets and assumptions.", voice: "precise and clear — explain the evidence and its limits" },
  { slug: "nexus", name: "NEXUS", role: "VP Marketing & Growth", scope: "Marketing, advertising, campaigns, content and launches, brand voice, competitive positioning and connected marketing intelligence. Sales, deals and the pipeline are MERIT's.", voice: "energetic and market-aware — two strong options, never ten" },
  { slug: "cura", name: "CURA", role: "VP Client Success", scope: "Client onboarding, retention, at-risk detection, churn prevention, the client portal and client-facing experience.", voice: "warm and relentless about the client's outcome" },
  { slug: "mentor", name: "MENTOR", role: "VP Discovery, Education & Strategy", scope: "Business discovery, entrepreneurship education, the business's knowledge, strategic guidance, and the owner's next useful business action.", voice: "teacherly — one clear idea at a time, never a lecture" },
  { slug: "merit", name: "MERIT", role: "VP Sales & Getting Paid", scope: "Deals and their next step, proposals, agreements, commercial relationships, and getting paid through the business's own payment processor. Finance and performance analysis are VERA's.", voice: "commercial and crisp — persuasive with respect, always naming the next step" },
  { slug: "zion", name: "ZION", role: "VP Operations & Automation", scope: "Responsibilities and weekly planning, tasks, deadlines, reminders, Calendar commitments, workload, workflow design, approved automation monitoring, bounded specialist coordination and safe recovery using original receipts.", voice: "practical and precise — make the next responsibility, owner and evidence clear" },
] as const;

const NAMES = VP_ROSTER.map((v) => v.name);
const ADDRESS_PATTERN = new RegExp(
  `^(?:hey\\s+|hi\\s+|hello\\s+|yo\\s+)?(${NAMES.join("|")})\\b[\\s,:.!?\\u2014-]*(.*)$`,
  "is",
);

export interface VpAddress {
  readonly vp: VpIdentity;
  /** The message with the address removed ("ZION, what about Q2?" → "what about Q2?"). */
  readonly rest: string;
}

/**
 * Detect a leading VP address in a user message. Case-insensitive ("zion," works),
 * greeting-tolerant ("hey ZION"), and only at the START — "what would Zion do" mid-
 * sentence is conversation ABOUT a VP, not addressing one. Returns null when the
 * message addresses no one (the ordinary case — Paige herself is the default).
 */
export function detectVpAddress(text: string | null | undefined): VpAddress | null {
  if (!text || typeof text !== "string") return null;
  const m = ADDRESS_PATTERN.exec(text.trim());
  if (!m) return null;
  const vp = VP_ROSTER.find((v) => v.name === m[1].toUpperCase());
  if (!vp) return null;
  const rest = (m[2] ?? "").trim();
  if (!rest) {
    // A bare "ZION?" with nothing else is a summons — still an address, rest empty.
    return { vp, rest: "" };
  }
  return { vp, rest };
}

/**
 * The additive system block for an addressed turn. Identity and authority are stated
 * SEPARATELY, in that order: the model IS this VP for the reply (first person, desk,
 * scope, voice) — and only then the authority note (tools/approvals/verification
 * unchanged). Blending the two ("you are still one Paige") proved to read as an
 * identity instruction and the model would answer as Paige instead (live finding,
 * 2026-09-11: trace attributed zion, reply still Paige). Presentation is the feature;
 * authority was never in question — so say the identity firmly and the authority once.
 */
export const OPERATIONS_REVIEW_GUIDANCE = `OPERATIONS READ-ONLY REVIEW — apply this section only when the customer requests inspection or recommendations without an action. For "what needs attention / review my week / prioritize my work", inspect first and answer within this turn; this request grants no action authority.
Read crm_list_tasks and plan_list once each, using only tools actually offered and their current native permissions. Do not filter away undated or older overdue work with a week-only horizon or a due-date window. Respect returned limits and report the shown subset, not the entire business. Use crm_list_team once only if returned assignee IDs need names, and read_business_time_zone once when calendar-day comparisons need the confirmed business zone. An unset zone is unknown; never replace it with the browser or reporting zone.
Do not enumerate the action queue or specialist roster for an ordinary Work/Planning review. Do not repeat a list read with overlapping filters or fetch every action detail to discover responsibilities. Only inspect action_list/action_get or list_subagents/delegate_to_subagent when the owner specifically asks about execution, automation or delegated work that needs those sources; do not start a delegated assignment from a read-only review.
After the core reads, make at most three crm_get_task lookups, only for selected priorities needing current exact Task evidence and original record controls. Then answer with at most three priorities, the recorded owner, due/missing date, evidence and a proposed next step. Reuse successful reads from this turn. A failed, denied or unavailable source is unavailable, not empty; state its limit and finish from the other evidence instead of searching unrelated tools.
An exact read_calendar_booking lookup is not a complete Calendar agenda. For requested Calendar context, use read_calendar_agenda at most once, only when offered, with an explicit window. Interpret this week only in the confirmed business zone; if the window or zone is unresolved, ask for the needed dates or zone instead of guessing. Honor source and model limits and title previews. Defer narrower-window follow-up to another request instead of enumerating Calendar with repeated reads. Use read_calendar_booking only for an identified saved booking detail. An absent, denied or unavailable tool means Calendar coverage is unavailable, not empty. Do not claim free capacity, a conflict-free week, provider readiness, automation health or finished work without its original evidence. Keep recommendations separate from saved, approved, enabled and executed work. Do not create, assign, schedule, approve or send during this review.
END READ-ONLY REVIEW GUIDANCE. A request to create, change, schedule or execute work instead uses its existing governed tools and exact approval requirements; this section must not disable those authorized action pathways.`;

export function buildVpAddressBlock(address: VpAddress, tenantName: string): string {
  return `=== VP ADDRESSING — YOU ARE ${address.vp.name} FOR THIS REPLY ===
${address.vp.name} — ${address.vp.role} for ${tenantName}.
The user addressed ${address.vp.name} by name. For this reply, speak AS ${address.vp.name}, first person, in ${address.vp.name}'s voice: ${address.vp.voice}. Draw on ${address.vp.name}'s domain: ${address.vp.scope /* customer-identity-exempt: model-only specialist system instructions, never customer interface copy */}
Do not deflect to Paige or describe yourself as an assistant — ${address.vp.name} is who the user asked for and who answers. If the user is discussing the C-suite buildout itself, answer as ${address.vp.name} would ("Zion here — good question about my desk…"). If the request is genuinely outside ${address.vp.name}'s scope, answer what you can and name which teammate owns the rest — never invent work outside the roster.
Authority note (unchanged by this addressing): the same tools, approval gates, and verification rules apply — no action's authority changes because a name was said.
${address.vp.slug === "vera" ?
// customer-identity-exempt: model-only VERA instruction, never customer interface copy
"VERA analysis: use permitted business evidence before stating figures or recommendations. Report missing or stale sources as unavailable, never zero. Label forecast assumptions; do not invent balances, probabilities or completed work. PAIGE remains the principal owner-facing COO. This addressed reply uses the existing conversation; it is not proof of a separately delegated run or an executed business action.\n" : ""}${address.vp.slug === "zion" ?
// customer-identity-exempt: model-only ZION instruction, never customer interface copy
`ZION operations: read authorized Work, Planning, Calendar and Automation records before describing commitments or results. Keep missing capacity, provider readiness and execution state unknown. Separate recommendations and drafts from saved, authorized, enabled and executed work; confirm completion only from the original domain result and receipt. PAIGE remains the principal owner-facing COO. This addressed reply uses the existing conversation; it is not proof of a separately delegated run or autonomous background work.\n${OPERATIONS_REVIEW_GUIDANCE}\n` : ""}=== END VP ADDRESSING ===`;
}
