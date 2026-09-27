import type { SpineCapability } from "../contracts.ts";

/**
 * Team Authority — the two Team-owned authority facts about the CALLER that PAIGE cannot get today:
 * their raw seat role, and whether they are the legal owner of this workspace.
 *
 * Deliberately narrow. PAIGE already receives a Team block every turn (get_paige_team_context() ->
 * _shared/team-context.ts) carrying the roster, member_count, and the invitation list. Projecting
 * any of those again would be a second, separately-computed answer to a question already answered.
 * What that block does NOT carry is these two facts kept apart: it computes each person's
 * permission as `is_owner OR role = 'owner' -> 'owner'`, which is wider than the canonical
 * ownership predicate (is_tenant_owner keys on is_owner alone), so a single string ends up meaning
 * membership and ownership at once.
 *
 * Billing-notice eligibility is NOT here. It is a Platform Billing fact that happens to be about a
 * team member, and Billing publishes its own Spine read (public.get_billing_spine_evidence, live on
 * production as of migration 20261140000000). A capability whose facts came from tenant_members AND
 * platform_billing_contacts would blur the ownership line in the registry entry itself.
 *
 * See supabase/migrations/20261150000000_team_authority_readiness.sql for the full trace, and
 * docs/delivery/spine-integration-packet-team.md for the source-to-Spine packet this shipped under.
 */
export const TEAM_AUTHORITY = {
  key: "team.authority",
  domain: "team",
  owner: "solo-team",
  humanSurface: "/solo/:account/settings/team",
  evidence: {
    signalKinds: ["team.authority_fact"],
    adapter: "public.get_team_authority_readiness",
    audience: "owner_internal",
    freshness: "live read of the caller's current seat on every call; there is no cached snapshot",
    staleAfterDays: 1,
    projectionWindowDays: 1,
    sourceSystem: "solo_team",
    sourceActorTypes: ["person"],
    classification: "operational",
    lifecycle: "current",
    safeSummary: "The caller's own role and ownership in this workspace.",
    referencePrefix: "team_authority:",
    factValues: {
      // Every seat a row may hold. The retired title seat is not one (20270508000000 refuses it).
      fact_key: ["viewer_permission", "viewer_is_legal_owner"],
      value: ["owner", "admin", "member", "true", "false"],
      status: ["available", "unavailable"],
      source: ["team"],
    },
  },
  action: {
    classification: "read",
    executor: "public.get_team_authority_readiness",
    idempotency: "read-only resolver; no rows are written",
    riskPolicyKey: "read_only",
    approvalAuthority: "none",
  },
  chatBinding: "PARTIAL",
  // PARTIAL, not LIVE: paige-ai-chat injects the block into every tenant turn's system context
  // (teamAuthorityChatEvidence.ts), so no separate tool call is needed. Covered by focused unit
  // tests and a pgTAP contract proof, but no authenticated end-to-end drive exists yet. LIVE
  // requires that drive.
  mindBinding: "PARTIAL",
  sharedPrimitiveChange: "NONE",
  maturity: "PARTIAL",
} as const satisfies SpineCapability;
