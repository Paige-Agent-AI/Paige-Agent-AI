import type { SpineEvidenceRpcClient } from "../resolveEvidence.ts";

/**
 * Chat's adapter onto the `team.authority` capability (see ./team.ts).
 *
 * Deliberately NOT routed through resolveSpineEvidence/mindEvidence.ts, for the same reason
 * businessContextChatEvidence.ts is not: that machinery projects durable Rail SIGNAL rows keyed by
 * a client reference, and public.get_team_authority_readiness is a live, stateless read of the
 * caller's own seat. There is no signal to resolve, and the two shapes cannot meet — the resolver
 * sends { p_client_ref, p_limit } and requires subject_type 'client'.
 *
 * WHAT THIS RENDERS: the caller's raw seat role and their legal ownership of this workspace, kept
 * as two facts. Never a name, an email, a user id, a member count, or an invitation count — the RPC
 * itself returns none of those (see the migration header for why each was left out).
 */

export type TeamAuthorityFactKey = "viewer_permission" | "viewer_is_legal_owner";

type AuthorityRow = {
  readonly fact_key: string;
  readonly value: string | null;
  readonly status: string;
  readonly source: string | null;
  readonly reason: string | null;
  readonly tenant_id: string | null;
};

export type TeamAuthorityEvidence =
  | { readonly status: "available"; readonly rows: readonly AuthorityRow[] }
  | { readonly status: "unavailable"; readonly reason: string }
  /** The contract refused this caller — they hold no active seat in the resolved workspace. Renders
   *  NOTHING, exactly as the readiness block does: someone with no seat here should not be told
   *  anything about this workspace's shape, including that it declined to answer. A genuine read
   *  failure still renders the honest block, so PAIGE says "I can't check" rather than guessing. */
  | { readonly status: "not_permitted" }
  /** The read resolved a DIFFERENT workspace than the conversation is scoped to. Renders nothing.
   *  get_paige_persona_context() resolves a linked CLIENT's workspace ahead of
   *  current_user_tenant_id(), so a user who is a client of B and a team member of A holds a
   *  conversation scoped to B while this read resolves A. Saying "you ARE the legal owner of this
   *  workspace" from A's seat inside B's conversation is a cross-workspace claim, so the block is
   *  suppressed entirely rather than hedged (§9). Mirrors _shared/team-context.ts, which returns
   *  null on the same mismatch. */
  | { readonly status: "wrong_workspace" };

const REFUSED_REASON = "not permitted for this account";

const HEADER = "=== YOUR AUTHORITY IN THIS WORKSPACE (Team) ===";
const FOOTER = "=== END YOUR AUTHORITY IN THIS WORKSPACE ===";

const UNAVAILABLE = [
  HEADER,
  "Status: UNAVAILABLE",
  "This person's role and ownership could not be read right now. Say so plainly if it comes up; do not infer either from anything else in your context.",
  FOOTER,
].join("\n");

function permissionSentence(value: string | null): string {
  switch (value) {
    case "owner":
      return "their seat role is Owner.";
    case "admin":
      return "their seat role is Admin.";
    case "member":
      return "their seat role is Member.";
    default:
      return "their seat role is not readable.";
  }
}

function ownershipSentence(value: string | null): string {
  if (value === "true") return "they ARE the legal owner of this workspace.";
  if (value === "false") return "they are NOT the legal owner of this workspace.";
  return "their ownership of this workspace is not readable.";
}

export async function loadTeamAuthorityForChat(
  client: SpineEvidenceRpcClient,
  /** The workspace THIS CONVERSATION is scoped to (personaCtx.tenant_id). Required: without it the
   *  binding below cannot be performed, and an unbound block is the defect this parameter exists to
   *  close. A null here means the caller could not establish a conversation workspace, which is
   *  itself a reason to say nothing. */
  expectedTenantId: string | null,
): Promise<TeamAuthorityEvidence> {
  try {
    const { data, error } = await client.rpc("get_team_authority_readiness", {});
    if (error) return { status: "unavailable", reason: "read_failed" };
    const rows = (Array.isArray(data) ? data : []) as AuthorityRow[];
    if (!rows.length) return { status: "unavailable", reason: "no_rows" };
    // Every row refused ⇒ no active seat. A PARTIAL refusal is not a refusal.
    // BIND FIRST, before any row is read for content. A row that names a workspace other than this
    // conversation's is not evidence about this conversation, whatever its status says. Rows whose
    // tenant is null resolved no workspace at all and cannot be bound either.
    if (!expectedTenantId || !rows.every((row) => row.tenant_id === expectedTenantId)) {
      return { status: "wrong_workspace" };
    }
    if (rows.every((row) => row.status === "unavailable" && row.reason === REFUSED_REASON)) {
      return { status: "not_permitted" };
    }
    return { status: "available", rows };
  } catch {
    return { status: "unavailable", reason: "read_failed" };
  }
}

export function renderTeamAuthorityForChat(evidence: TeamAuthorityEvidence): string {
  if (evidence.status === "not_permitted" || evidence.status === "wrong_workspace") return "";
  if (evidence.status === "unavailable") return UNAVAILABLE;

  const permission = evidence.rows.find((row) => row.fact_key === "viewer_permission");
  const ownership = evidence.rows.find((row) => row.fact_key === "viewer_is_legal_owner");

  return [
    HEADER,
    `- Seat role: ${permissionSentence(permission?.status === "available" ? permission.value : null)}`,
    `- Legal ownership: ${ownershipSentence(ownership?.status === "available" ? ownership.value : null)}`,
    "These are TWO SEPARATE facts and you must not merge them. A seat role of Owner is not proof of legal ownership, and legal ownership is not a billing permission — whether this person may manage billing is a Platform Billing fact with its own source, never inferred from either line above. If the team roster elsewhere in your context labels someone an owner, THIS is the authoritative answer for the person you are talking to.",
    "Read-only. Changing anyone's access runs through the Team tools and their own approval; nothing here is permission to skip one.",
    FOOTER,
  ].join("\n");
}

export async function buildTeamAuthorityBlock(
  client: SpineEvidenceRpcClient,
  expectedTenantId: string | null,
): Promise<string> {
  return renderTeamAuthorityForChat(await loadTeamAuthorityForChat(client, expectedTenantId));
}
