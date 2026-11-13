// EXP07: the existing governed door for one saved piece, one approved social destination
// and one durable publication receipt. Reconciliation reads Zernio without sending again.

import {
  SOCIAL_POST_PLATFORMS,
  SocialProviderError,
  type SocialPostAccount,
  type SocialPostInput,
  type SocialProviderAdapter,
  type SocialProviderPostOutcome,
} from "../social-provider/mod.ts";
import { governSocialMutation } from "../social-provider/governance.ts";
import { resolveStudioCaller } from "../studio-caller.ts";
import { recordCapabilityRun, stableRunId, type CapabilityOutcome } from "../capability-record.ts";

// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- The existing Edge wrapper injects the two Supabase clients.
type Client = any;

export interface SocialPublishDeps {
  /** The caller's own client (anon key + their JWT). Never runs a write — writes are service-role. */
  caller: Client;
  /** Service-role client: the connection read, the approval store, the
   *  publication record, and the capability receipt. */
  admin: Client;
  adapter: Pick<SocialProviderAdapter, "key" | "isConfigured" | "readPostDestination" | "createPost" | "readPost">;
}

const HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};
const respond = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), { status, headers: HEADERS });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PLATFORMS = new Set<string>(SOCIAL_POST_PLATFORMS);
const CAPABILITY = "social.post_publish";
const RAIL_CAPABILITY = "social_post_publish";
const NOTHING_CHANGED = "Nothing was published.";
const UNCONFIRMED = "The post may have gone out. Check the original attempt before trying again.";

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function rows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(object).filter((row) => row !== null) : [];
}

async function publishAccount(deps: SocialPublishDeps, tenantId: string, platform: string): Promise<
  (SocialPostAccount & { connectionId: string; accountId: string }) | { code: keyof typeof DESTINATION_ERROR }
> {
  const connections = await deps.admin.from("paige_social_connections")
    .select("id,provider_profile_key,status")
    .eq("tenant_id", tenantId).eq("requested_platform", platform)
    .eq("provider_key", deps.adapter.key).eq("provided_by_platform", false);
  if (connections.error) return { code: "DESTINATION_READ_FAILED" } as const;
  const connected = rows(connections.data).filter((row) => row.status === "connected");
  if (!connected.length) {
    return { code: rows(connections.data).some((row) => row.status === "needs_reauth") ? "NEEDS_REAUTH" : "NO_CONNECTION" } as const;
  }
  const accounts = await deps.admin.from("paige_social_accounts")
    .select("id,connection_id,account_id,selected")
    .eq("tenant_id", tenantId).eq("platform", platform)
    .eq("provider_key", deps.adapter.key).eq("status", "connected")
    .in("connection_id", connected.map((row) => row.id));
  if (accounts.error) return { code: "DESTINATION_READ_FAILED" } as const;
  const candidates = rows(accounts.data);
  const selected = candidates.filter((row) => row.selected === true);
  const account = selected.length === 1 ? selected[0] : candidates.length === 1 ? candidates[0] : null;
  const connection = connected.find((row) => row.id === account?.connection_id);
  if (!account || !connection || typeof connection.id !== "string"
      || typeof connection.provider_profile_key !== "string" || typeof account.account_id !== "string"
      || typeof account.id !== "string") {
    return { code: candidates.length > 1 ? "DESTINATION_AMBIGUOUS" : "NO_CONNECTION" } as const;
  }
  return {
    connectionId: connection.id,
    accountId: account.id,
    providerProfileKey: connection.provider_profile_key,
    providerAccountId: account.account_id,
    platform,
  } as const;
}

const DESTINATION_ERROR = {
  NO_CONNECTION: "Connect this channel in Settings → Integrations before posting.",
  NEEDS_REAUTH: "Sign in to this channel again in Settings → Integrations before posting.",
  DESTINATION_AMBIGUOUS: "Choose the account for this channel in Settings → Integrations before posting.",
  DESTINATION_READ_FAILED: "The connected accounts could not be read. Nothing was published.",
};

export async function handleSocialPublishCommand(req: Request, deps: SocialPublishDeps): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: HEADERS });
  if (req.method !== "POST") return respond(405, { ok: false, code: "METHOD_NOT_ALLOWED", error: NOTHING_CHANGED });

  let body: Record<string, unknown> = {};
  try { body = object(await req.json()) ?? {}; } catch { return respond(400, { ok: false, code: "REQUEST_INVALID", error: NOTHING_CHANGED }); }
  const action = typeof body.action === "string" ? body.action : "";
  const approvedFingerprint = typeof body.approved_fingerprint === "string" ? body.approved_fingerprint : null;

  // Who is calling — the door never trusts a named tenant or user.
  const { data: userData, error: userErr } = await deps.caller.auth.getUser();
  const user = object(userData)?.user as { id?: string } | undefined;
  if (userErr || !user?.id || typeof user.id !== "string") {
    return respond(401, { ok: false, code: "NOT_AUTHENTICATED", error: "Sign in, then try again." });
  }
  const caller = await resolveStudioCaller(deps.caller, body.expected_tenant_id);
  if (!caller.ok) {
    const refused = caller as unknown as { status: number; reason: string; error: string };
    return respond(refused.status, { ok: false, code: `CALLER_${refused.reason.toUpperCase()}`, error: refused.error });
  }
  const tenantId = (caller as unknown as { tenantId: string }).tenantId;

  // decline: consume the outstanding proposal, exactly like paige-social's decline.
  if (action === "decline") {
    const fingerprint = typeof body.fingerprint === "string" ? body.fingerprint : "";
    if (!/^[0-9a-f]{16}$/.test(fingerprint)) return respond(400, { ok: false, code: "DECLINE_INVALID", error: NOTHING_CHANGED });
    const declined = await deps.admin.from("paige_pending_confirmations")
      .update({ consumed_at: new Date().toISOString() })
      .eq("user_id", user.id).eq("tenant_id", tenantId).eq("tool_name", CAPABILITY)
      .eq("fingerprint", fingerprint).is("thread_id", null).is("scoped_client_id", null)
      .is("consumed_at", null).not("server_issued_at", "is", null)
      .select("id").maybeSingle();
    if (declined.error || !object(declined.data)) return respond(409, { ok: false, code: "DECLINE_NOT_RECORDED", error: NOTHING_CHANGED });
    return respond(200, { ok: true, state: "declined" });
  }
  if (action === "reconcile") return await reconcile(deps, tenantId, body);
  if (action !== "publish") return respond(400, { ok: false, code: "ACTION_INVALID", error: NOTHING_CHANGED });

  // The request names a saved piece and a platform; the caption defaults to the piece's title.
  const contentId = typeof body.content_id === "string" && UUID.test(body.content_id) ? body.content_id : "";
  const platform = typeof body.platform === "string" && PLATFORMS.has(body.platform) ? body.platform : "";
  if (!contentId || !platform) return respond(400, { ok: false, code: "REQUEST_INVALID", error: "Name the saved piece and the channel to publish to." });
  const caption = typeof body.caption === "string" && body.caption.trim() ? body.caption.trim().slice(0, 2200) : null;

  // The piece must be THIS workspace's own — a foreign piece is not found, never adopted.
  // The protected library grants SELECT to the signed-in caller, not service_role.
  // Keep the verified active workspace and explicit row predicates on this read.
  const pieceRead = await deps.caller.from("marketing_content")
    .select("id,title,updated_at,status").eq("id", contentId).eq("tenant_id", tenantId).maybeSingle();
  const piece = object(pieceRead.data);
  if (pieceRead.error || !piece || typeof piece.updated_at !== "string" || piece.status === "archived") return respond(404, { ok: false, code: "CONTENT_NOT_FOUND", error: "That piece is not in this workspace." });
  if (body.expected_content_revision != null && body.expected_content_revision !== piece.updated_at) {
    return respond(409, { ok: false, state: "refused", code: "CONTENT_REVISION_CHANGED", error: "This piece changed. Reload Content to review the latest saved version." });
  }
  const pieceTitle = typeof piece.title === "string" && piece.title.trim() ? piece.title.trim().slice(0, 120) : "Untitled piece";
  const text = caption ?? pieceTitle;

  const account = await publishAccount(deps, tenantId, platform);
  if ("code" in account) {
    return respond(account.code === "DESTINATION_READ_FAILED" ? 503 : 409, {
      ok: false, code: account.code, error: DESTINATION_ERROR[account.code],
    });
  }
  if (!deps.adapter.isConfigured()) {
    return respond(503, { ok: false, code: "PUBLISHING_NOT_CONFIGURED", error: "Publishing is unavailable right now. Nothing was published." });
  }

  // This gate is advisory for the preview. The native bind serializes attempts.
  const pending = await deps.admin.rpc("content_publication_pending_reconcile", {
    p_content_id: contentId, p_platform: platform, p_tenant_id: tenantId,
  });
  if (pending.error) return respond(500, { ok: false, code: "RECONCILE_CHECK_FAILED", error: NOTHING_CHANGED });
  if (pending.data === true) return retryBlocked();
  const inFlight = await deps.admin.from("content_publications").select("id")
    .eq("tenant_id", tenantId).eq("content_id", contentId).eq("platform", platform)
    .in("status", ["approved", "publishing"]).limit(1);
  if (inFlight.error) return respond(500, { ok: false, code: "RECONCILE_CHECK_FAILED", error: NOTHING_CHANGED });
  if (rows(inFlight.data).length) return retryBlocked();

  let destination;
  try {
    destination = await deps.adapter.readPostDestination(account);
  } catch (error) {
    if (error instanceof SocialProviderError && error.code === "destination_selection_unavailable") {
      return respond(409, { ok: false, code: "DESTINATION_SELECTION_UNAVAILABLE", error: error.message });
    }
    return respond(409, { ok: false, code: "DESTINATION_UNVERIFIED", error: "The connected destination could not be verified. Nothing was published." });
  }
  const requestArgs = {
    content_id: contentId, content_revision: piece.updated_at, platform, caption: text,
    connection_id: account.connectionId, account_id: account.accountId,
    channel_id: destination.channelId, channel_label: destination.label,
  };

  // The governed decision: proposal on first call, single-use claim on the second.
  const governed = await governSocialMutation({
    callerDb: deps.caller, adminDb: deps.admin,
    userId: user.id, tenantId, accessAllowed: true,
    capability: CAPABILITY, availability: "needs_approval",
    requestArgs: { ...requestArgs, provider_account_id: account.providerAccountId, profile_key: account.providerProfileKey },
    summary: `Publish “${pieceTitle}” to ${destination.label} (${platform}) now.`,
    approvedFingerprint,
  });
  if (governed.kind === "approval_required") {
    return respond(202, {
      ok: false, state: "approval_required",
      approval: { fingerprint: governed.fingerprint, summary: governed.summary, expires_at: governed.expiresAt },
      preview: { piece_id: contentId, piece_title: pieceTitle, platform, channel_label: destination.label, caption: text },
    });
  }
  if (governed.kind === "refuse") {
    const status = governed.code === "access_denied" ? 403 : governed.code === "capability_unavailable" ? 503 : 409;
    return respond(status, { ok: false, state: "refused", code: governed.code, message: governed.message });
  }

  const confirmationId = governed.confirmationId;
  if (Object.entries(requestArgs).some(([key, value]) => governed.args[key] !== value)
      || governed.args.provider_account_id !== account.providerAccountId
      || governed.args.profile_key !== account.providerProfileKey) {
    return respond(409, { ok: false, state: "refused", code: "CLAIM_MISMATCH", error: "The saved piece or destination changed. Review the current post and approve again. Nothing was published." });
  }

  const bound = await deps.admin.rpc("content_publication_bind", {
    p_id: null, p_tenant_id: tenantId, p_content_id: contentId, p_platform: platform,
    p_connection_id: account.connectionId, p_confirmation_id: confirmationId,
    p_request_args: { ...requestArgs, approved_by: user.id },
  });
  if (bound.error?.code === "PT409") return retryBlocked();
  const publicationId = object(bound.data)?.id;
  if (bound.error || typeof publicationId !== "string") return respond(500, { ok: false, code: "RECORD_FAILED", error: NOTHING_CHANGED });

  const [currentCaller, currentAccount, currentPiece] = await Promise.all([
    resolveStudioCaller(deps.caller, tenantId),
    publishAccount(deps, tenantId, platform),
    deps.caller.from("marketing_content").select("id,updated_at,status").eq("tenant_id", tenantId).eq("id", contentId).maybeSingle(),
  ]);
  if (!currentCaller.ok || "code" in currentAccount || currentAccount.connectionId !== account.connectionId
      || currentAccount.accountId !== account.accountId || currentAccount.providerAccountId !== account.providerAccountId
      || currentAccount.providerProfileKey !== account.providerProfileKey
      || currentPiece.error || object(currentPiece.data)?.updated_at !== piece.updated_at
      || object(currentPiece.data)?.status === "archived") {
    await deps.admin.rpc("content_publication_record", {
      p_id: publicationId, p_tenant_id: tenantId, p_status: "refused", p_error_code: "approval_context_changed",
    });
    await record(deps.admin, tenantId, user.id, confirmationId, "refused", { platform, code: "approval_context_changed", publication_id: publicationId });
    return respond(409, { ok: false, state: "refused", code: "CONNECTION_REVOKED", error: "Access, the saved piece or the connected destination changed. Nothing was published.", publication_id: publicationId });
  }

  const publishing = await deps.admin.rpc("content_publication_record", { p_id: publicationId, p_tenant_id: tenantId, p_status: "publishing" });
  if (publishing.error || !object(publishing.data)?.id) {
    return respond(500, { ok: false, code: "RECORD_FAILED", error: NOTHING_CHANGED, publication_id: publicationId });
  }

  let outcome: SocialProviderPostOutcome;
  try {
    outcome = await deps.adapter.createPost({ ...account, channelId: destination.channelId, text, externalId: publicationId });
  } catch (error) {
    if (!(error instanceof SocialProviderError)) {
      outcome = { kind: "unknown", requestId: null, reason: "provider_dispatch_unconfirmed" };
    } else {
      outcome = { kind: "published", results: [{ platform, success: false, postId: null, postUrl: null, error: error.code }] };
    }
  }
  return await finish(deps, { tenantId, platform, publicationId, confirmationId, actorId: user.id }, outcome);
}

function retryBlocked() {
  return respond(409, { ok: false, code: "RETRY_PENDING_RECONCILIATION", error: "An attempt already exists for this post. Check the original receipt before trying again." });
}

type Attempt = { tenantId: string; platform: string; publicationId: string; confirmationId: string; actorId: string };

async function finish(deps: SocialPublishDeps, attempt: Attempt, outcome: SocialProviderPostOutcome, reconciled = false) {
  const { tenantId, platform, publicationId, confirmationId, actorId } = attempt;
  const result = outcome.kind === "published" && outcome.results.length === 1
    && outcome.results[0].platform === platform ? outcome.results[0] : null;
  const status = result && !result.success ? "failed"
    : result?.postUrl && result.postId ? "published" : "outcome_unknown";
  const requestId = outcome.kind === "published" ? outcome.requestId ?? null : outcome.requestId;
  const pending = status === "outcome_unknown";
  const code = pending ? outcome.kind === "processing" ? "provider_processing" : "provider_dispatch_unconfirmed"
    : status === "failed" ? result?.error ?? "provider_rejected" : null;
  const saved = reconciled && pending ? null : await deps.admin.rpc("content_publication_record", {
    p_id: publicationId, p_tenant_id: tenantId, p_status: status,
    p_provider_post_id: result?.postId ?? null, p_provider_post_url: result?.postUrl ?? null,
    p_provider_request_id: requestId, p_error_code: code,
    p_provider_response: { ...(result ? { results: [result] } : {}), ...(reconciled ? { reconciled: true } : {}) },
  });

  // A confirmed result is shown only once the original durable receipt records it.
  if (saved && (saved.error || !object(saved.data)?.id)) {
    return respond(200, { ok: false, state: "outcome_unknown", publication_id: publicationId, error: UNCONFIRMED });
  }
  if (!reconciled || !pending) {
    await record(deps.admin, tenantId, actorId, confirmationId, pending ? "outcome_unknown" : status === "failed" ? "failed" : "succeeded",
      { platform, code, publication_id: publicationId, reconciled });
  }
  if (pending) {
    return respond(200, {
      ok: false, state: "outcome_unknown", publication_id: publicationId,
      error: outcome.kind === "processing" ? "The channel is still processing this post. Check the original attempt again for its result." : UNCONFIRMED,
    });
  }
  if (status === "failed") {
    const error = code === "provider_duplicate_content"
      ? "This account already has the same post or is processing it. Check the channel before trying again."
      : "The channel refused the post. Nothing was published.";
    return respond(code === "provider_duplicate_content" ? 409 : 502, { ok: false, state: "failed", code, publication_id: publicationId, error });
  }
  return respond(200, { ok: true, state: "published", platform, post_url: result?.postUrl, post_id: result?.postId, publication_id: publicationId });
}

async function reconcile(deps: SocialPublishDeps, tenantId: string, body: Record<string, unknown>): Promise<Response> {
  const publicationId = typeof body.publication_id === "string" && UUID.test(body.publication_id) ? body.publication_id : "";
  const contentId = typeof body.content_id === "string" && UUID.test(body.content_id) ? body.content_id : "";
  if (!publicationId || !contentId) return respond(400, { ok: false, code: "REQUEST_INVALID", error: "Choose the original publication attempt." });
  const read = await deps.admin.from("content_publications")
    .select("id,platform,status,connection_id,confirmation_id,provider_request_id,provider_post_id,provider_post_url,request_args")
    .eq("tenant_id", tenantId).eq("content_id", contentId).eq("id", publicationId).maybeSingle();
  const row = object(read.data);
  if (read.error || !row) return respond(404, { ok: false, code: "PUBLICATION_NOT_FOUND", error: "That attempt could not be found in this workspace." });
  if (row.status === "published") {
    return respond(200, { ok: true, state: "published", publication_id: publicationId, post_url: row.provider_post_url, post_id: row.provider_post_id });
  }
  if (row.status === "failed" || row.status === "refused") {
    return respond(200, { ok: false, state: row.status, publication_id: publicationId, error: NOTHING_CHANGED });
  }
  if (row.status === "approved") {
    // Only an expired pre-dispatch approval can close here. The native CAS excludes publishing.
    const expired = await deps.admin.rpc("content_publication_record", {
      p_id: publicationId, p_tenant_id: tenantId, p_status: "refused", p_error_code: "approval_abandoned",
    });
    return object(expired.data)?.id && !expired.error
      ? respond(200, { ok: false, state: "refused", publication_id: publicationId, error: "This attempt expired before dispatch. Nothing was published." })
      : respond(200, { ok: false, state: "outcome_unknown", publication_id: publicationId, error: "This attempt is still being prepared. Check it again before trying another." });
  }

  const args = object(row.request_args);
  if (!args || (row.status !== "outcome_unknown" && row.status !== "publishing")
      || typeof row.platform !== "string" || !PLATFORMS.has(row.platform)
      || args.content_id !== contentId || args.platform !== row.platform || typeof args.account_id !== "string"
      || typeof row.connection_id !== "string" || typeof args.caption !== "string"
      || typeof row.confirmation_id !== "string" || typeof args.approved_by !== "string"
      || !deps.adapter.isConfigured()) {
    return respond(200, { ok: false, state: "outcome_unknown", publication_id: publicationId, error: UNCONFIRMED });
  }
  const [connectionRead, accountRead] = await Promise.all([
    deps.admin.from("paige_social_connections").select("provider_profile_key")
      .eq("tenant_id", tenantId).eq("id", row.connection_id).eq("requested_platform", row.platform)
      .eq("provider_key", deps.adapter.key).eq("provided_by_platform", false).maybeSingle(),
    deps.admin.from("paige_social_accounts").select("account_id")
      .eq("tenant_id", tenantId).eq("id", args.account_id).eq("connection_id", row.connection_id)
      .eq("platform", row.platform).eq("provider_key", deps.adapter.key).maybeSingle(),
  ]);
  const providerProfileKey = object(connectionRead.data)?.provider_profile_key;
  const providerAccountId = object(accountRead.data)?.account_id;
  if (connectionRead.error || accountRead.error || typeof providerProfileKey !== "string" || typeof providerAccountId !== "string") {
    return respond(200, { ok: false, state: "outcome_unknown", publication_id: publicationId, error: UNCONFIRMED });
  }
  const input: SocialPostInput = {
    providerProfileKey, platform: row.platform, providerAccountId,
    channelId: typeof args.channel_id === "string" ? args.channel_id : null, text: args.caption, externalId: publicationId,
  };
  let outcome: SocialProviderPostOutcome;
  try {
    outcome = await deps.adapter.readPost(input, typeof row.provider_request_id === "string" ? row.provider_request_id : null);
  } catch {
    return respond(200, { ok: false, state: "outcome_unknown", publication_id: publicationId, error: UNCONFIRMED });
  }
  return await finish(deps, { tenantId, platform: row.platform, publicationId, confirmationId: row.confirmation_id, actorId: args.approved_by }, outcome, true);
}

/** The receipt's own vocabulary: the door's states map 1:1 onto the capability outcomes. */
const RECEIPT_OUTCOME: Record<string, CapabilityOutcome> = {
  succeeded: "capability_succeeded",
  failed: "capability_failed",
  refused: "capability_refused",
  outcome_unknown: "capability_outcome_unknown",
};

async function record(admin: Client, tenantId: string, actorId: string, confirmationId: string, outcome: keyof typeof RECEIPT_OUTCOME, detail: Record<string, unknown>) {
  try {
    await recordCapabilityRun(admin, {
      tenantId, actorId, capabilityKey: RAIL_CAPABILITY,
      outcome: RECEIPT_OUTCOME[outcome], runId: await stableRunId(["social", CAPABILITY, tenantId, confirmationId]),
      detail,
    });
  } catch { /* the receipt row in content_publications is the durable record; the Rail row is best-effort here */ }
}
