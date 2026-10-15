import type { SpineEvidenceRpcClient } from "../resolveEvidence.ts";

/**
 * Chat's adapter onto the `social.presence` capability (see ./social.ts).
 *
 * Deliberately NOT routed through resolveSpineEvidence/mindEvidence.ts, for the same reason
 * businessContextChatEvidence.ts is not: that machinery projects Rail SIGNAL rows — a durable
 * evidence table with a citation, an outcome ref and a stored history — and
 * public.get_social_presence_evidence is a live, stateless read straight over the workspace's own
 * current record. There is no signal to resolve, and building on the Rail resolver would invent a
 * row this capability was scoped not to need.
 *
 * WHAT THIS RENDERS: for each of the six networks, whether an account is on record and the handle
 * if it is. Nothing else exists to render — a declared handle carries no audience, no performance,
 * no queue and no placement, and the block says so in words so the model cannot fill the gap.
 */

export type SocialPresenceStatus = "on_record" | "not_recorded" | "unavailable";

type PresenceRow = {
  network: string;
  status: SocialPresenceStatus;
  handle: string | null;
  as_of: string | null;
  reason: string | null;
  tenant_id: string | null;
};

export type SocialPresenceEvidence =
  | { readonly status: "available"; readonly rows: readonly PresenceRow[] }
  | { readonly status: "unavailable"; readonly reason: string }
  /** The contract refused this caller (a non-staff role — see the role gate in
   *  20261210000000_a_business_can_record_the_accounts_it_posts_from.sql). Renders NOTHING, on
   *  purpose: a client chatting with their coach's PAIGE should not be told the coach's account
   *  setup is unreadable — that is not their conversation. A genuine read FAILURE still renders the
   *  honest block, so PAIGE says "I can't check" rather than guessing. */
  | { readonly status: "not_permitted" }
  /** The read resolved a DIFFERENT workspace than the conversation is scoped to. Renders nothing —
   *  get_paige_persona_context() resolves a conversation's tenant client-link-first, so a user who
   *  is a linked CLIENT of workspace B and a member of workspace A holds a B-scoped conversation
   *  while this read resolves A (§9). Same arm as businessContextChatEvidence.ts. */
  | { readonly status: "wrong_workspace" };

const NETWORK_LABEL: Record<string, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  linkedin: "LinkedIn",
  youtube: "YouTube",
  tiktok: "TikTok",
  x: "X",
};

/** The exact reason string the SQL role gate returns on a refusal. Matched, not guessed — if the
 *  migration's wording ever changes without this constant, the refusal degrades to the honest
 *  UNAVAILABLE block, which is noisy but never a leak. */
const REFUSED_REASON = "not permitted for this account";

export async function loadSocialPresenceForChat(
  client: SpineEvidenceRpcClient,
  /** The workspace THIS CONVERSATION is scoped to (personaCtx.tenant_id). See the binding below. */
  expectedTenantId: string | null,
): Promise<SocialPresenceEvidence> {
  try {
    const { data, error } = await client.rpc("get_social_presence_evidence", {});
    if (error) return { status: "unavailable", reason: "read_failed" };
    const rows = (Array.isArray(data) ? data : []) as PresenceRow[];
    if (!rows.length) return { status: "unavailable", reason: "no_rows" };
    // BIND FIRST — a row naming another workspace is not evidence about this conversation.
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

const HEADER = "=== SOCIAL ACCOUNTS ON RECORD (Marketing › Social) ===";
const FOOTER = "=== END SOCIAL ACCOUNTS ON RECORD ===";

const UNAVAILABLE = [
  HEADER,
  "Status: UNAVAILABLE",
  "This workspace's recorded social accounts could not be read for this turn. Do not say an account is missing or on record — say you can't check right now.",
  FOOTER,
].join("\n");

/**
 * Render the evidence for the model.
 *
 * The closing paragraph is the load-bearing half. The rows alone would let a model infer that an
 * account on record is an account it can post to — which is the single wrong conclusion available
 * here, and the one a business owner would act on. So the boundary is stated, not implied.
 */
export function renderSocialPresenceForChat(evidence: SocialPresenceEvidence): string {
  if (evidence.status === "not_permitted" || evidence.status === "wrong_workspace") return "";
  if (evidence.status === "unavailable") return UNAVAILABLE;

  const onRecord = evidence.rows.filter((row) => row.status === "on_record" && row.handle);
  const missing = evidence.rows.filter((row) => row.status === "not_recorded");
  const unreadable = evidence.rows.filter((row) => row.status === "unavailable");

  const lines: string[] = [];
  if (onRecord.length) {
    for (const row of onRecord) {
      lines.push(`- ${NETWORK_LABEL[row.network] ?? row.network}: ${row.handle} — on record.`);
    }
  } else {
    lines.push("- No social account has been recorded for this workspace yet.");
  }
  if (missing.length) {
    lines.push(
      `- Not recorded: ${missing.map((row) => NETWORK_LABEL[row.network] ?? row.network).join(", ")}.`,
    );
  }
  for (const row of unreadable) {
    lines.push(
      `- ${NETWORK_LABEL[row.network] ?? row.network}: could not be read${row.reason ? ` (${row.reason})` : ""} — say it is unknown rather than missing.`,
    );
  }

  const asOf = evidence.rows.find((row) => row.as_of)?.as_of ?? null;

  return [
    HEADER,
    ...lines,
    // The one wrong inference available from the rows above, closed explicitly.
    "These are DECLARED accounts — what the business says it posts from. No account is connected: nothing here is authorised to publish, schedule, read comments, or report followers, reach or engagement, and no such figure exists anywhere for you to cite. If asked how a post performed, say the platform does not have that.",
    `The owner changes these in Marketing › Social${asOf ? `; this workspace record last changed ${asOf}` : ""}. You can record or update them yourself with the record_social_accounts tool, which writes the same field.`,
    FOOTER,
  ].join("\n");
}

export async function buildSocialPresenceBlock(
  client: SpineEvidenceRpcClient,
  expectedTenantId: string | null,
): Promise<string> {
  return renderSocialPresenceForChat(await loadSocialPresenceForChat(client, expectedTenantId));
}
