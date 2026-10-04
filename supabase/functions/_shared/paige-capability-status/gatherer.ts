// Server-side capability-status resolver (Main Paige Operational Chat · P3c) — the ASYNC gatherer.
//
// STATE AFTER C0a (2026-10-04) — read this first. The chat no longer uses this path: paige-ai-chat
// projects its whole manifest from the tools it emits (projection.ts). What remains here is the hand-
// written signals.ts manifest + resolver.ts, used for exactly ONE native binding below. That is a second
// capability-status engine (§18) and it is known: C0b retires it by resolving Layer C's binding through
// the projection, then deletes signals.ts, the resolver's manifest path and renderCapabilityStatusBlock.
// Tenant authority is NOT composed here — it comes from _shared/workspace-authority.ts, the one module
// the chat gate also uses.
//
// This module is the server-side entry for ONE capability from a NON-JWT caller — the native-event engine
// (Layer C), which holds a service-role client + the authorizing person's user id + the authoritative
// tenant id, but no JWT. It exists so Layer C resolves a native act's availability THROUGH this canonical
// Gateway seam (owner correction, 2026-09-13) — never a Layer-C inline `availability` literal, and never a
// second/parallel availability rule. It composes the EXISTING ingredients (getActorTier / user_roles role
// read / resolve_tool_autonomy + clampLaneByRisk) and the EXISTING pure resolver — nothing is reinvented.
//
// FAIL-CLOSED, honest (§13): every resolution ingredient is service-role callable with an EXPLICIT actor +
// tenant (proven: get_actor_access(_actor) and resolve_tool_autonomy(_tenant_id,_tool_key) both read the
// passed args, not auth.uid()). A resolution that ERRORS returns `{ ok:false }` — an INFRA signal the caller
// RETRIES, never a false "available" and never a false refusal baked as a settled outcome (§32).

import { getActorTier, type Tier } from "../actorTier.ts";
import { clampLaneByRisk } from "../action-risk.ts";
import { resolveWorkspaceAuthorityAs } from "../workspace-authority.ts";
import { buildCapabilitySignals, type CapabilityFacts } from "./signals.ts";
import { resolveCapabilityStatus, type CapabilityStatus } from "./resolver.ts";

/** The minimal service-role client surface this needs (RPC + a user_roles read). */
type GathererDb = {
  from: (t: string) => any;
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: any; error: any }>;
};

type Lane = "auto" | "confirm" | "off";

/**
 * The Gateway's binding of a native `action_kind` to (a) its declared capability-status manifest key and
 * (b) the tool_key whose ceiling-clamped lane governs it. This is a GATEWAY concern — the binding of an
 * action to its DECLARED capability — and it lives in the Gateway seam, not Layer C. Extend it here as
 * native capabilities are declared in signals.ts. `crm_advance_journey_stage` is the C2 vertical.
 */
// Keyed by the act's `action_kind` — the DOTTED action-bus slug. statusKey is the capability-status
// manifest key (equal to the slug); toolKey is the UNDERSCORE tool key resolve_tool_autonomy expects.
const NATIVE_CAPABILITY_BINDINGS: Readonly<Record<string, { statusKey: string; toolKey: string }>> = {
  "crm.advance_journey_stage": { statusKey: "crm.advance_journey_stage", toolKey: "crm_advance_journey_stage" },
};

/** Whether an action_kind has a declared native capability binding (so it can be resolved through here). */
export function hasNativeCapabilityBinding(actionKind: string | null | undefined): boolean {
  return !!actionKind && Object.prototype.hasOwnProperty.call(NATIVE_CAPABILITY_BINDINGS, actionKind);
}

/** The action_kinds with a declared native capability binding. Exported so a test can assert the two native
 *  registries stay in sync — an executor (native-adapter) without a Gateway binding would dispatch with an
 *  UNRESOLVED availability; a binding without an executor would resolve a status the engine can never run
 *  (§39 F5). Both are latent dark-in-prod bugs; the keys must match exactly. */
export function nativeCapabilityBindingKeys(): readonly string[] {
  return Object.keys(NATIVE_CAPABILITY_BINDINGS);
}

/**
 * A neutral CapabilityFacts: every field at its most-restrictive / irrelevant default. The requested
 * capability's status depends ONLY on its own signal's fields (which the resolver sets to the REAL values),
 * so the neutral defaults for other capabilities never influence the answer — this lets us reuse the whole
 * canonical manifest to resolve ONE capability without assembling facts irrelevant to it. `callerTier`,
 * `ownerOpsEligible`, and the resolved lane are overridden by the caller with real values.
 */
function neutralFacts(callerTier: Tier, ownerOpsEligible: boolean): CapabilityFacts {
  const off: Lane = "off";
  return {
    callerTier,
    ownerOpsEligible,
    contactCreateLane: off,
    journeyAdvanceLane: off,
    campaignCreateLane: off,
    workflowsLane: off,
    documentCreateLane: off,
    knowledgeSaveLane: off,
    planningCreateLane: off,
    delegateLane: off,
    integrationsListMaturity: null,
    pipelineEvidenceMaturity: null,
    commsReadMaturity: null,
    commsSendMaturity: null,
    socialPresenceMaturity: null,
    socialPublishMaturity: null,
    teamAuthorityMaturity: null,
    teamManageMaturity: null,
    campaignListMaturity: null,
    campaignCreateMaturity: null,
    workflowsMaturity: null,
    workflowsConnected: false,
    researchProviderConfigured: false,
  };
}

export type GatewayResolution =
  | { ok: true; status: CapabilityStatus }
  | { ok: false; error: string };   // INFRA / unbound — the caller RETRIES, never refuses on this

/**
 * Resolve ONE native capability's honest availability for (actor, tenant) through the canonical Gateway.
 * Composes the real facts server-side, runs the SAME pure manifest + resolver the chat cockpit runs, and
 * returns the status for the bound capability key. Every ingredient is service-role callable with the
 * explicit actor/tenant (no JWT). Errors return `{ ok:false }` (retryable), never a fabricated verdict.
 */
export async function resolveNativeCapabilityStatus(
  db: GathererDb,
  opts: { actorUserId: string; tenantId: string; actionKind: string },
): Promise<GatewayResolution> {
  const binding = NATIVE_CAPABILITY_BINDINGS[opts.actionKind];
  if (!binding) return { ok: false, error: `no native capability binding for '${opts.actionKind}'` };
  if (!opts.actorUserId) return { ok: false, error: "no actor to resolve capability status for" };

  try {
    // Tier — reuses the shared getActorTier (§18), which FAILS CLOSED to "client" on any get_actor_access
    // error (its deliberate design: a transient tier-read can never WIDEN access). So a transient tier-read
    // error resolves the capability to `not_for_tier` — a fail-closed REFUSAL, not a retry. That is the safe
    // direction for an access decision (refuse, never wrongly allow); the role/lane reads below DO return
    // {ok:false} (retryable) on error, because they cannot fail closed to a safe value the same way.
    const callerTier = await getActorTier(db, { actorUserId: opts.actorUserId, isPlatform: false, scopes: [] });

    // owner-ops authority — the SAME tenant question the chat gate asks (C0a, owner ruling 2026-10-04
    // "ADMIN IS A TENANT ROLE"), in its actor-EXPLICIT form because this path has no JWT. One module
    // composes it for both (§18); never the tenant-agnostic global `admin` row.
    const resolved = await resolveWorkspaceAuthorityAs(db, opts.actorUserId, opts.tenantId);
    if (!resolved.ok) return { ok: false, error: resolved.error };
    const ownerOpsEligible = resolved.authority.workspaceAdmin || resolved.authority.platformOperator;

    // Effective lane = ceiling clamp (resolve_tool_autonomy) THEN action-class clamp (clampLaneByRisk),
    // exactly as the chat manifest computes it. Service branch trusts the passed tenant (auth.uid() NULL).
    const { data: laneData, error: laneErr } = await db.rpc("resolve_tool_autonomy", {
      _tenant_id: opts.tenantId, _tool_key: binding.toolKey,
    });
    if (laneErr) return { ok: false, error: `lane resolve failed: ${laneErr.message ?? String(laneErr)}` };
    const rawLane: Lane = (typeof laneData === "string" && (laneData === "auto" || laneData === "confirm" || laneData === "off"))
      ? laneData : "confirm"; // safe default, matching the chat helper
    const lane = clampLaneByRisk(rawLane, binding.toolKey);

    const facts: CapabilityFacts = { ...neutralFacts(callerTier, ownerOpsEligible), journeyAdvanceLane: lane };
    const status = resolveCapabilityStatus(buildCapabilitySignals(facts)).find((s) => s.key === binding.statusKey);
    if (!status) return { ok: false, error: `capability '${binding.statusKey}' not produced by the manifest` };
    return { ok: true, status };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
