// Render the resolved capability manifest into the system block Paige answers "what can you do
// here?" from (Main Paige Operational Chat · P3b, the P0 Defect-1 grounding) — PURE.
//
// The resolver turns server-resolved signals into one honest availability per capability. This
// turns that list into the authoritative system block the model reads. It decides nothing about
// the UI (§00) and imports ONLY the type (erased at transpile) so it is unit-testable through the
// port. It is the WORDS; the truth is the resolved statuses it is handed.
//
// WHY IT IS AUTHORITATIVE (the P0 Defect-1 fix): Paige's tool list and persona make her SOUND able
// to post, text, run workflows and manage a team the instant she is asked "what can you do?". Left
// to the general impression she over-claims — the live defect. This block is injected per turn with
// the workspace's REAL statuses and a directive that it OVERRIDES any general impression: capability
// questions are answered ONLY from here, grouped by what she can do now / prepare for approval /
// that needs setup / that is not built yet — and she never claims an action the block does not mark
// available (§13/§36/§70).

import type { CapabilityStatus, CapabilityAvailability } from "./resolver.ts";

const GROUP_ORDER: readonly CapabilityAvailability[] = [
  "live",
  "needs_approval",
  "needs_setup",
  "proof_owed",
  "planned",
  "unavailable",
  "not_for_tier",
];

const GROUP_HEADING: Record<CapabilityAvailability, string> = {
  live: "CAN DO NOW (no approval needed):",
  needs_approval: "CAN PREPARE FOR YOUR APPROVAL (you run it):",
  needs_setup: "NEEDS A CONNECTION OR SETUP FIRST (tell them what to connect):",
  proof_owed: "CAN ATTEMPT, BUT NOT PROVEN HERE YET — offer it, never promise the result:",
  planned: "NOT SOMETHING YOU CAN DO HERE YET — do NOT offer or claim these:",
  unavailable: "CANNOT CONFIRM FOR THIS WORKSPACE — do NOT claim these:",
  not_for_tier: "NOT AVAILABLE FOR THIS ACCOUNT TYPE:",
  // `no_applicable_capability` is never a per-capability row (it is the answer when a request matches
  // none of the list); it is named as an explicit resolution in the directive below, not a group.
  no_applicable_capability: "",
};

/**
 * The per-turn, workspace-specific capability block. Returns "" when there is nothing to report
 * (an empty manifest), so the caller can skip injecting an empty system message.
 */
export function renderCapabilityStatusBlock(capabilities: readonly CapabilityStatus[]): string {
  if (!capabilities.length) return "";

  const lines: string[] = [];
  lines.push("=============================================================");
  lines.push("WHAT YOU CAN ACTUALLY DO HERE — live capability status (authoritative)");
  lines.push("=============================================================");
  lines.push(
    "This is the SERVER-RESOLVED truth of what you can do for THIS workspace right now. When the " +
      "person asks what you can do, what you can help with, or whether you can do a specific thing, " +
      "answer ONLY from this list — it OVERRIDES any broader impression from your tools or persona. " +
      "NEVER say you can post to social, send a text/SMS, run an automation, or manage the team " +
      "unless it appears under CAN DO NOW or CAN PREPARE FOR YOUR APPROVAL below. If the person " +
      "names a specific outside app, tool, or data source — a CRM, GHL/GoHighLevel, HubSpot, " +
      "Salesforce, Zapier, n8n, Meta/Facebook, Instagram, Google Calendar, QuickBooks, or any other " +
      "named product — never imply you currently connect to it or can read, pull, or sync its data " +
      "now unless a group below names it. If a group describes a matching kind of capability " +
      "without naming the product (for example, \"Run one of your automations\"), describe what " +
      "you can do in that group's own words and neither assert nor deny that it is that specific " +
      "product. Discussing the tool, planning around it, or framing what you'll do once " +
      "it's connected is fine — just never imply it's connected now when it isn't. For anything under " +
      "NEEDS A CONNECTION, say what to connect first; for anything you CAN'T DO HERE YET, say plainly " +
      "it's not something you can do for them yet — never imply otherwise, and never claim it simply " +
      "doesn't exist. For anything you CAN ATTEMPT BUT ISN'T PROVEN, offer to try and say you'll " +
      "report honestly what came back — never promise the outcome. And if what they ask for matches " +
      "NONE of the capabilities below, say plainly you don't have a capability for that here — do NOT " +
      "invent one or imply a tool you don't have. Keep the answer short and action-oriented (what " +
      "you'd actually help with next), not a recited inventory.",
  );

  for (const group of GROUP_ORDER) {
    const inGroup = capabilities.filter((c) => c.availability === group);
    if (!inGroup.length) continue;
    lines.push("");
    lines.push(GROUP_HEADING[group]);
    for (const c of inGroup) {
      // The reason is only meaningful when it's not "live"; for live items the label stands alone.
      const suffix = c.availability === "live" || !c.reason ? "" : ` — ${c.reason}`;
      lines.push(`- ${c.label}${suffix}`);
    }
  }

  return lines.join("\n");
}
