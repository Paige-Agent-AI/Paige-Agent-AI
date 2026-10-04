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
import type { ProjectedCapability } from "./projection.ts";

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
  not_for_tier: "NOT AVAILABLE TO THIS PERSON HERE (account type or workspace role):",
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
      "unless it appears under CAN DO NOW or CAN PREPARE FOR YOUR APPROVAL below. For anything under " +
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

// ── C0a: the projected manifest (docs/delivery/paige-conversational-loop-r0.md §20) ──────────────
//
// The projection covers every tool emitted this turn (~160), not 21 hand-picked families, so the
// rows are grouped by availability and then by domain and name the TOOL — the model already holds
// each tool's description, so repeating it would only cost tokens. The person never hears tool
// names; the directive tells PAIGE to speak in business terms.


export interface SpecialistSummary {
  name: string;
  domain: string | null;
}

const PROJECTED_GROUP_ORDER: readonly CapabilityAvailability[] = [
  "live", "needs_approval", "needs_setup", "proof_owed", "not_for_tier", "unavailable", "planned",
];

export function renderProjectedCapabilityBlock(
  rows: readonly ProjectedCapability[],
  specialists: readonly SpecialistSummary[] = [],
): string {
  if (!rows.length) return "";
  const lines: string[] = [];
  lines.push("=============================================================");
  lines.push("WHAT YOU CAN ACTUALLY DO HERE — derived from the tools you hold this turn (authoritative)");
  lines.push("=============================================================");
  lines.push(
    "This is resolved by the server for THIS workspace and THIS person right now, from the exact tools " +
      "you were given, their governance, the workspace's approval settings, connections, and this person's " +
      "role. When asked what you can do, or whether you can do something, answer ONLY from this — it " +
      "OVERRIDES any broader impression. Speak in the person's business terms: never read out tool names. " +
      "CAN DO NOW: offer freely. CAN PREPARE FOR APPROVAL: say you'll prepare it for them to approve. NEEDS " +
      "SETUP: say what to connect first. NOT AVAILABLE TO THIS PERSON: say who can do it (the owner or an " +
      "admin). NOT SOMETHING YOU CAN DO YET: say so plainly, and offer what you CAN do instead. If a request " +
      "matches none of this, say you don't have a capability for that here — never invent one. Keep a " +
      "capability answer short and pointed at what you'd do next, not a recited inventory.",
  );

  for (const group of PROJECTED_GROUP_ORDER) {
    const inGroup = rows.filter((r) => r.availability === group);
    if (!inGroup.length) continue;
    lines.push("");
    lines.push(GROUP_HEADING[group]);
    if (group === "planned") {
      for (const r of inGroup) lines.push(`- ${r.label}${r.reason ? ` — ${r.reason}` : ""}`);
      continue;
    }
    // Rows sharing a family AND a reason collapse to one line; the reason is printed once.
    const buckets = new Map<string, { family: string; reason: string | null; tools: string[] }>();
    for (const r of inGroup) {
      // The default approval reason is the heading itself; only a MANUAL lane says something more.
      const reason = group === "live" || (group === "needs_approval" && r.lane !== "off") ? null : r.reason;
      const k = `${r.family}\u0000${reason ?? ""}`;
      const b = buckets.get(k) ?? { family: r.family, reason, tools: [] };
      b.tools.push(r.tool ?? r.key);
      buckets.set(k, b);
    }
    const sorted = [...buckets.values()].sort((a, b) => a.family.localeCompare(b.family));
    for (const b of sorted) {
      lines.push(`- ${b.family}: ${b.tools.sort().join(", ")}${b.reason ? ` — ${b.reason}` : ""}`);
    }
  }

  if (specialists.length) {
    lines.push("");
    lines.push(
      "YOUR SPECIALISTS (consult them through your delegation tools; you stay the one voice the person hears):",
    );
    const byDomain = new Map<string, string[]>();
    for (const s of specialists) {
      const d = s.domain || "general";
      byDomain.set(d, [...(byDomain.get(d) ?? []), s.name]);
    }
    for (const [d, names] of [...byDomain.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      lines.push(`- ${d}: ${names.sort().join(", ")}`);
    }
  }
  return lines.join("\n");
}
