import { confirmFingerprint } from "../confirm-fingerprint.ts";
import {
  decideGovernedExecution,
  type GovernedDecision,
} from "../paige-spine/governedExecution.ts";

const SOCIAL_PUBLICATION_ACTION_RISK_KEY = "social_post_publish";

type Query = {
  select(...args: unknown[]): Query;
  insert(...args: unknown[]): Query;
  update(...args: unknown[]): Query;
  eq(...args: unknown[]): Query;
  is(...args: unknown[]): Query;
  not(...args: unknown[]): Query;
  gt(...args: unknown[]): Query;
  neq(...args: unknown[]): Query;
  maybeSingle(): PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>;
};

export type SocialGovernanceDb = {
  from(name: string): Query;
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message?: string } | null }>;
};

export type SocialGovernanceResult =
  | { kind: "execute"; args: Record<string, unknown>; confirmationId: string; decision: GovernedDecision }
  | { kind: "approval_required"; fingerprint: string; summary: string; expiresAt: string | null; revalidate: boolean; decision: GovernedDecision }
  | { kind: "refuse"; code: string; message: string; decision: GovernedDecision };

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/**
 * Adopts the canonical proposal store and shared governed decision seam for a
 * Social mutation. It never treats a request boolean or request arguments as
 * approval: only the exact stored args returned by a single-use CAS may run.
 */
export async function governSocialMutation(input: {
  callerDb: SocialGovernanceDb;
  adminDb: SocialGovernanceDb;
  userId: string;
  tenantId: string;
  accessAllowed: boolean;
  capability: string;
  availability: "live" | "needs_approval" | "needs_setup" | "unavailable";
  requestArgs: Record<string, unknown>;
  summary: string;
  approvedFingerprint?: string | null;
}): Promise<SocialGovernanceResult> {
  // The proposal identity stays namespaced. The shared decision API requires the
  // canonical action-risk key, as Capability Kit does. This server-owned mapping
  // grants no claim: the original stored-identity CAS below must still succeed.
  const actionRiskKey = input.capability === "social.post_publish"
    ? SOCIAL_PUBLICATION_ACTION_RISK_KEY : input.capability;
  const requestNonce = crypto.randomUUID();
  let lane = "unresolved";
  try {
    // The visible canonical control and any existing proposal-identity control
    // are both brakes. A rename must never bypass an operator's stored off mode.
    const keys = actionRiskKey === input.capability ? [input.capability] : [input.capability, actionRiskKey];
    const resolved = await Promise.all(keys.map(_tool_key => input.callerDb.rpc("resolve_tool_autonomy", {
      _tenant_id: input.tenantId, _tool_key,
    })));
    if (resolved.every(({ data, error }) => !error && typeof data === "string" && ["auto", "confirm", "off"].includes(data))) {
      lane = resolved.some(({ data }) => data === "off") ? "off"
        : resolved.some(({ data }) => data === "confirm") ? "confirm" : "auto";
    }
  } catch {
    // The shared seam refuses an unrecognized lane. Never guess a permissive one.
  }

  let claimedArgs: Record<string, unknown> | null | undefined;
  let confirmationId: string | null = null;
  if (input.approvedFingerprint !== undefined && input.approvedFingerprint !== null) {
    claimedArgs = null;
    if (/^[0-9a-f]{16}$/.test(input.approvedFingerprint)) {
      try {
        const claim = await input.adminDb.from("paige_pending_confirmations")
          .update({ consumed_at: new Date().toISOString() })
          .eq("user_id", input.userId)
          .eq("tenant_id", input.tenantId)
          .eq("tool_name", input.capability)
          .eq("fingerprint", input.approvedFingerprint)
          .is("thread_id", null)
          .is("scoped_client_id", null)
          .is("consumed_at", null)
          .not("server_issued_at", "is", null)
          .not("issued_in_request", "is", null)
          .neq("issued_in_request", requestNonce)
          .gt("expires_at", new Date().toISOString())
          .select("id,args")
          .maybeSingle();
        const row = object(claim.data);
        const args = object(row?.args);
        if (!claim.error && row && typeof row.id === "string" && args) {
          claimedArgs = args;
          confirmationId = row.id;
        }
      } catch {
        claimedArgs = null;
      }
    }
  }

  const decision = decideGovernedExecution({
    caller: {
      authenticated: true,
      userId: input.userId,
      principal: "person",
      tenantId: input.tenantId,
      tenantSource: "server",
      door: "other",
      access: { allowed: input.accessAllowed, reason: "A workspace owner or admin is required." },
    },
    capability: {
      id: actionRiskKey,
      effect: "mutate",
      outcomeChannel: "record_capability_run",
      availability: input.availability,
    },
    approval: {
      autonomyLane: lane,
      ...(claimedArgs !== undefined ? { claimedArgs, claimedFor: actionRiskKey } : {}),
    },
    requestArgs: input.requestArgs,
  });

  if (decision.kind === "refuse") {
    return { kind: "refuse", code: decision.code, message: decision.message, decision };
  }
  if (decision.kind === "execute") {
    const args = object(decision.args);
    if (!args || !confirmationId) {
      return { kind: "refuse", code: "approval_claim_missing", message: "The approval could not be verified, so nothing was run.", decision };
    }
    return { kind: "execute", args, confirmationId, decision };
  }

  const fingerprint = await confirmFingerprint(input.capability, input.requestArgs);
  let summary = input.summary;
  let expiresAt: string | null = null;
  try {
    const created = await input.adminDb.from("paige_pending_confirmations").insert({
      user_id: input.userId,
      tenant_id: input.tenantId,
      thread_id: null,
      scoped_client_id: null,
      tool_name: input.capability,
      fingerprint,
      issued_in_request: requestNonce,
      server_issued_at: new Date().toISOString(),
      args: input.requestArgs,
      summary,
    }).select("summary,expires_at").maybeSingle();
    const row = object(created.data);
    if (!created.error && row) {
      if (typeof row.summary === "string") summary = row.summary;
      if (typeof row.expires_at === "string") expiresAt = row.expires_at;
    } else if (created.error?.code === "23505") {
      const existing = await input.adminDb.from("paige_pending_confirmations")
        .select("summary,expires_at")
        .eq("user_id", input.userId)
        .eq("tenant_id", input.tenantId)
        .eq("tool_name", input.capability)
        .eq("fingerprint", fingerprint)
        .is("thread_id", null)
        .is("scoped_client_id", null)
        .is("consumed_at", null)
        .not("server_issued_at", "is", null)
        .gt("expires_at", new Date().toISOString())
        .maybeSingle();
      const stored = object(existing.data);
      if (existing.error || !stored || typeof stored.summary !== "string") {
        return { kind: "refuse", code: "approval_store_unavailable", message: "Approval could not be recorded, so nothing was run.", decision };
      }
      summary = stored.summary;
      expiresAt = typeof stored.expires_at === "string" ? stored.expires_at : null;
    } else {
      return { kind: "refuse", code: "approval_store_unavailable", message: "Approval could not be recorded, so nothing was run.", decision };
    }
  } catch {
    return { kind: "refuse", code: "approval_store_unavailable", message: "Approval could not be recorded, so nothing was run.", decision };
  }

  return { kind: "approval_required", fingerprint, summary, expiresAt, revalidate: decision.revalidate, decision };
}
