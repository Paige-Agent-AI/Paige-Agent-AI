// The capability PROJECTION (C0a) — what PAIGE can do on THIS turn, derived, never listed by hand.
//
// docs/delivery/paige-conversational-loop-r0.md §20. The previous manifest was a hand-written array
// of families (signals.ts). It was correct the day it was written and wrong the day the next tool
// shipped — R0 found team management, deal moves and sends reading "planned" while governed chat tools
// for them were live, and an offer for a journey-stage tool that did not exist. A list maintained by
// hand cannot stay true; this module therefore enumerates NOTHING. It projects:
//
//   the tools ACTUALLY emitted to the model this turn (post Studio scope, funding, marketplace)
//     × their canonical declaration (Spine registry; legacy classification while C0b converges)
//     × action-risk (is it a write)
//     × the effective autonomy lane (Trust ceiling + risk clamp, resolved server-side)
//     × tenant authority (workspace owner/admin, from the canonical tenant role seam)
//     × readiness (the closed resolver set in readiness.ts)
//
// so "what she believes she can do" and "what she can call" are the same set by construction. A new
// capability that is registered (CI already forces registration) and emitted appears here with NO
// change to this file or to the conversation layer.
//
// PURE: every input is injected, so it is unit-testable and mutation-testable. It decides nothing about
// the UI (§00) and grants nothing — every act still re-resolves authority at dispatch (§9/§67).

import type { CapabilityActionKind, CapabilityStatus, PerCapabilityAvailability } from "./resolver.ts";
import type { ReadinessResolverId, ReadinessState } from "./readiness.ts";
import { READINESS_SETUP_HINT } from "./readiness.ts";

export type Lane = "auto" | "confirm" | "off";

/** A tool as offered to the model this turn. */
export interface EmittedTool {
  name: string;
  description: string;
}

/** The slice of a Spine capability the projection reads (structural, so tests can pass fixtures). */
export interface SpineDeclarationLike {
  key: string;
  domain: string;
  readiness?: ReadinessResolverId;
  action?: { classification: "read" | "mutate" | "external_effect"; chatTool?: string };
}

/** A legacy (not yet Spine-registered) tool's classification — the C0b worklist row. */
export interface LegacyDeclarationLike {
  domain: string;
  effect: "read" | "mutate" | "external_effect";
  selfDescribe: boolean;
  readiness: ReadinessResolverId;
}

/** A capability PAIGE honestly cannot do yet, and the gate that will change that. Not a tool. */
export interface PlannedCapability {
  key: string;
  label: string;
  family: string;
  reason: string;
}

export interface ProjectionInput {
  tools: readonly EmittedTool[];
  spine: readonly SpineDeclarationLike[];
  legacy: Readonly<Record<string, LegacyDeclarationLike>>;
  /** Is this write? (action-risk). Reads and drafts return false. */
  isMutating: (tool: string) => boolean;
  /** Effective lane per tool (Trust ceiling + risk clamp). Missing → "confirm" (never over-claim auto). */
  lanes: ReadonlyMap<string, Lane>;
  /** Tools whose dispatch requires this workspace's owner or an admin (the shared gate set). */
  workspaceAdminTools: ReadonlySet<string>;
  /**
   * The caller's canonical tenant authority for those tools — the SAME resolver the dispatch gate uses
   * (_shared/workspace-authority.ts). A function when the answer differs by tool (Studio build tools
   * keep the stricter workspace-seat rule).
   */
  isWorkspaceAdmin: boolean | ((tool: string) => boolean);
  readiness: ReadonlyMap<ReadinessResolverId, ReadinessState>;
  planned?: readonly PlannedCapability[];
}

export interface ProjectedCapability extends CapabilityStatus {
  /** The tool PAIGE would call; null for a planned (non-tool) row. */
  tool: string | null;
  /** Domain grouping, from the declaration — never a hard-coded render order. */
  family: string;
  /** How the row was found: canonical Spine, the legacy classification, or neither (CI-blocked). */
  source: "spine" | "legacy" | "undeclared" | "planned";
  /** The effective lane, on write rows only (a read has no lane). */
  lane?: Lane;
}

const FIRST_SENTENCE = /^(.+?[.!?])(\s|$)/;

/** The per-row reasons the projection writes (exported so the render can group them, and tests pin them). */
export const PROJECTION_REASON = Object.freeze({
  role: "Needs this workspace's owner or an admin.",
  confirm: "PAIGE drafts it and you approve before it runs.",
  manual: "Set to manual — PAIGE prepares it, you run it.",
  unconfirmedConnection: "The connection behind this isn't confirmed for this workspace — check it before promising a result.",
});

/** A short label from the model-facing description itself — the one description that already ships. */
export function labelFromDescription(name: string, description: string): string {
  const flat = (description || "").replace(/\s+/g, " ").trim();
  const sentence = (flat.match(FIRST_SENTENCE)?.[1] ?? flat).trim();
  const text = sentence || name.replace(/_/g, " ");
  return text.length > 110 ? `${text.slice(0, 107).trimEnd()}…` : text;
}

function actionKindFor(effect: "read" | "mutate" | "external_effect" | null, mutating: boolean): CapabilityActionKind {
  if (effect === "external_effect") return "external_effect";
  if (effect === "mutate" || (effect === null && mutating)) return "update";
  if (mutating) return "update";
  return "read";
}

/**
 * Project the emitted tool surface into one honest availability per tool, most-restrictive-wins:
 *   tenant authority → readiness (not ready → setup; unconfirmed → proof owed) → lane (writes) → live.
 * Tier/seat exclusion is upstream: a tool not emitted to this seat is not projected at all.
 */
export function projectCapabilities(input: ProjectionInput): ProjectedCapability[] {
  const byTool = new Map<string, SpineDeclarationLike>();
  for (const cap of input.spine) {
    const tool = cap.action?.chatTool;
    if (tool && !byTool.has(tool)) byTool.set(tool, cap);
  }

  const rows: ProjectedCapability[] = [];
  const seen = new Set<string>();
  for (const t of input.tools) {
    if (!t?.name || seen.has(t.name)) continue;
    seen.add(t.name);
    const spine = byTool.get(t.name);
    const legacy = spine ? undefined : input.legacy[t.name];
    // An internal helper (e.g. a preview step) stays callable but is not part of her self-description.
    if (legacy && !legacy.selfDescribe) continue;

    const mutating = input.isMutating(t.name);
    const effect = spine?.action?.classification ?? legacy?.effect ?? null;
    const actionKind = actionKindFor(effect, mutating);
    const family = spine?.domain ?? legacy?.domain ?? "other";
    const readinessId: ReadinessResolverId = spine?.readiness ?? legacy?.readiness ?? "none";
    const base = {
      key: spine?.key ?? `tool.${t.name}`,
      label: labelFromDescription(t.name, t.description),
      actionKind,
      tool: t.name,
      family,
      source: (spine ? "spine" : legacy ? "legacy" : "undeclared") as ProjectedCapability["source"],
    };
    const row = (availability: PerCapabilityAvailability, reason: string | null): ProjectedCapability =>
      ({ ...base, availability, reason });

    const admitted = typeof input.isWorkspaceAdmin === "function" ? input.isWorkspaceAdmin(t.name) : input.isWorkspaceAdmin;
    if (input.workspaceAdminTools.has(t.name) && !admitted) {
      rows.push(row("not_for_tier", PROJECTION_REASON.role));
      continue;
    }
    if (readinessId !== "none") {
      const state = input.readiness.get(readinessId);
      if (state === "not_ready") {
        rows.push(row("needs_setup", READINESS_SETUP_HINT[readinessId] || "Needs a connection before PAIGE can use it."));
        continue;
      }
      // Unread is not ready: a connection nobody has confirmed is offered as an attempt, never as a
      // promise ("CAN DO NOW" would be the R0 over-claim in a new domain).
      if (state !== "ready") {
        rows.push(row("proof_owed", PROJECTION_REASON.unconfirmedConnection));
        continue;
      }
    }
    const isWrite = mutating || effect === "mutate" || effect === "external_effect";
    if (isWrite) {
      const lane = input.lanes.get(t.name) ?? "confirm";
      rows.push({
        ...(lane === "auto" ? row("live", null)
          : row("needs_approval", lane === "off" ? PROJECTION_REASON.manual : PROJECTION_REASON.confirm)),
        lane,
      });
      continue;
    }
    rows.push(row("live", null));
  }

  for (const p of input.planned ?? []) {
    rows.push({
      key: p.key, label: p.label, actionKind: "external_effect", availability: "planned",
      reason: p.reason, tool: null, family: p.family, source: "planned",
    });
  }
  return rows;
}

/**
 * The honest "not yet" overlay — capabilities with NO tool on the chat surface whose absence the
 * owner is likely to ask about. Each names the real gate. This is a list of what PAIGE CANNOT do;
 * nothing she can do is ever listed by hand.
 */
export const PLANNED_CAPABILITIES: readonly PlannedCapability[] = Object.freeze([
  {
    key: "skills.run", family: "skills", label: "Run a saved skill from the skills library",
    reason: "Not wired into this chat yet — skills run from the Skills hub.",
  },
  {
    key: "browser.secure_session", family: "research", label: "Browse a site in a secure browser session",
    reason: "The secure browser isn't switched on yet.",
  },
  {
    key: "social.publish", family: "social", label: "Publish a post to your social accounts",
    reason: "There's no governed publishing path yet — PAIGE can draft the post for you.",
  },
]);
