// Legacy capability classification — the C0b worklist (docs/delivery/paige-conversational-loop-r0.md §24).
//
// Every chat tool that is on PAIGE's model surface but NOT yet registered in the Spine registry, one row
// each, classified by the C0a crew on main 0065fa74 (owner rulings 2026-10-04 §9: classify first, then
// migrate by bounded domain, and delete dead debt instead of formalising it). The projection reads a row
// ONLY while its tool is unregistered; registering a tool in the Spine makes the row unreachable and
// capability-discovery-lint requires it to be deleted in the same change.
//
// This file and scripts/ci/capability-declaration-baseline.json must name exactly the same tools —
// both may only shrink. A NEW tool can therefore never land here: it must be Spine-registered, which is
// what makes it discoverable with no conversation-layer change.
//
// gapClass (owner's six): missing_spine_registration · missing_kit_metadata · registered_missing_readiness
//   · obsolete_dead_path (delete) · duplicate_superseded (delete) · internal_only_not_self_described
// readiness: only resolvers that exist in C0a are named; every other dependency is "none" here and is
//   modelled when its domain batch registers the tool (C0b) — "none" never claims setup either way.

import type { LegacyDeclarationLike } from "./projection.ts";

export type LegacyGapClass =
  | "missing_spine_registration"
  | "missing_kit_metadata"
  | "registered_missing_readiness"
  | "obsolete_dead_path"
  | "duplicate_superseded"
  | "internal_only_not_self_described";

export interface LegacyCapabilityRow extends LegacyDeclarationLike {
  gapClass: LegacyGapClass;
  /** Does the CHAT gate require this workspace's owner or an admin? (the C0b batch needs it) */
  workspaceAdmin: boolean;
}

export const LEGACY_CAPABILITIES: Readonly<Record<string, LegacyCapabilityRow>> = Object.freeze({
  propose_action: { domain: "action_bus", effect: "mutate", selfDescribe: true, readiness: "none", gapClass: "missing_spine_registration", workspaceAdmin: true },
  // INT-345 K-3: the governed calling-setup act (main retired the bulk of the legacy
  // rows; this one is newly live, not legacy residue).
  comms_setup_calling: { domain: "communications", effect: "external_effect", selfDescribe: true, readiness: "none", gapClass: "missing_spine_registration", workspaceAdmin: true },
});
