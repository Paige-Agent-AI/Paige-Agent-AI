// THE SOCIAL PUBLISH DOOR — the one governed way a saved piece ships to a connected channel.
//
// EXP07 row 10. Every publish of marketing content to a social channel goes through THIS handler:
// the Studio's saved pieces (and later PAIGE's chat) reach it and nothing else. It composes only
// existing canonical machinery — no new approval channel, scheduler or registry:
//
//   authenticated user → server-derived workspace (resolveStudioCaller: owner, admin or managing
//   agency) → the piece must be THIS workspace's (cross-account refused) → the channel's connection
//   must be `connected` in EXP10's lifecycle (needs_reauth/disconnected say so; none says connect) →
//   reconcile-before-retry (an outcome_unknown attempt for the same piece+platform blocks a new one)
//   → governSocialMutation on the REGISTERED Spine action social.post_publish (external_effect,
//   confirm): a server-issued proposal in paige_pending_confirmations with the exact preview, and
//   on the second call a single-use claim bound to this user, workspace, act and args → authority +
//   connection RECHECKED after the claim → the provider execution runs ONCE through the claimed
//   args (upload-post adapter's createPost — synchronous text post, external_id = the publication
//   row) → the truthful receipt: the provider's own post id/url read back into
//   content_publications (published | partial | failed | outcome_unknown), the capability receipt
//   recorded, and the response states exactly what happened — an outcome_unknown answer says the
//   post MAY exist and names the reconciliation handle, never "failed".
//
// Retry safety is structural: the claim is single-use (CAS on consumed_at), so replaying a
// fingerprint refuses; a retry is a NEW proposal and a NEW publication row; and while an
// outcome_unknown row stands for the same piece+platform the door refuses a new attempt entirely.
// A duplicate publish from this door is impossible, not merely discouraged.

import { governSocialMutation } from "../social-provider/governance.ts";
import { resolveStudioCaller } from "../studio-caller.ts";
import { recordCapabilityRun, stableRunId, type CapabilityOutcome } from "../capability-record.ts";

// deno-lint-ignore no-explicit-any
type Client = any;

export interface SocialPublishDeps {
  /** The caller's own client (anon key + their JWT). Never runs a write — writes are service-role. */
  caller: Client;
  /** Service-role client: the piece read, the connection read, the approval store, the
   *  publication record, and the capability receipt. */
  admin: Client;
  /** The provider adapter's publish arm, injected so tests drive the REAL door with a double. */
  adapter: {
    isConfigured(): boolean;
    createPost(input: { providerProfileKey: string; platform: string; text: string; externalId: string }): Promise<
      | { kind: "published"; results: Array<{ platform: string; success: boolean; postId: string | null; postUrl: string | null; error: string | null }> }
      | { kind: "processing"; requestId: string }
      | { kind: "unknown"; requestId: string | null; reason: string }
    >;
  };
}

export interface SocialPublishProviderError extends Error { code: string; }

const HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};
const respond = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), { status, headers: HEADERS });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PLATFORMS = new Set(["tiktok", "instagram", "facebook", "linkedin", "youtube", "x", "threads", "pinterest", "google_business", "snapchat"]);
const CAPABILITY = "social.post_publish";
const NOTHING_CHANGED = "Nothing was published.";

export async function handleSocialPublishCommand(req: Request, deps: SocialPublishDeps): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: HEADERS });
  if (req.method !== "POST") return respond(405, { ok: false, code: "METHOD_NOT_ALLOWED", error: NOTHING_CHANGED });

  let body: Record<string, unknown> = {};
  try { body = await req.json() as Record<string, unknown>; } catch { return respond(400, { ok: false, code: "REQUEST_INVALID", error: NOTHING_CHANGED }); }
  const action = typeof body.action === "string" ? body.action : "";
  const approvedFingerprint = typeof body.approved_fingerprint === "string" ? body.approved_fingerprint : null;

  const object = (v: unknown): Record<string, unknown> | null => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null;

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
  if (action !== "publish") return respond(400, { ok: false, code: "ACTION_INVALID", error: NOTHING_CHANGED });

  // The request names a saved piece and a platform; the caption defaults to the piece's title.
  const contentId = typeof body.content_id === "string" && UUID.test(body.content_id) ? body.content_id : "";
  const platform = typeof body.platform === "string" && PLATFORMS.has(body.platform) ? body.platform : "";
  if (!contentId || !platform) return respond(400, { ok: false, code: "REQUEST_INVALID", error: "Name the saved piece and the channel to publish to." });
  const caption = typeof body.caption === "string" && body.caption.trim() ? body.caption.trim().slice(0, 2200) : null;

  // The piece must be THIS workspace's own — a foreign piece is not found, never adopted.
  const pieceRead = await deps.admin.from("marketing_content")
    .select("id,title,kind,tenant_id").eq("id", contentId).eq("tenant_id", tenantId).maybeSingle();
  const piece = object(pieceRead.data);
  if (pieceRead.error || !piece) return respond(404, { ok: false, code: "CONTENT_NOT_FOUND", error: "That piece is not in this workspace." });
  const pieceTitle = typeof piece.title === "string" && piece.title.trim() ? piece.title.trim().slice(0, 120) : "Untitled piece";
  const text = caption ?? pieceTitle;

  // The channel's connection, from EXP10's lifecycle — the truthful readiness states.
  const connectionRead = await deps.admin.from("paige_social_connections")
    .select("id,provider_profile_key,status,label,requested_platform,updated_at")
    .eq("tenant_id", tenantId).eq("requested_platform", platform)
    .order("updated_at", { ascending: false });
  const connections = Array.isArray(connectionRead.data) ? connectionRead.data.map(object).filter(Boolean) as Array<Record<string, unknown>> : [];
  const connected = connections.find((c) => c.status === "connected");
  if (!connected) {
    if (connections.some((c) => c.status === "needs_reauth")) {
      return respond(409, { ok: false, code: "NEEDS_REAUTH", error: "That channel's connection needs you to sign in again before anything can post. Reconnect it in Settings → Integrations." });
    }
    return respond(409, { ok: false, code: "NO_CONNECTION", error: "That channel isn't connected yet. Connect it in Settings → Integrations first." });
  }
  const profileKey = connected.provider_profile_key;
  const channelLabel = typeof connected.label === "string" && connected.label.trim() ? connected.label.trim().slice(0, 120) : platform;
  const connectionId = typeof connected.id === "string" ? connected.id : null;
  if (typeof profileKey !== "string" || !profileKey) return respond(500, { ok: false, code: "CONNECTION_RECORD_INVALID", error: NOTHING_CHANGED });

  // Provider configured? needs_setup is the truthful state until the credential exists.
  if (!deps.adapter.isConfigured()) {
    return respond(503, { ok: false, code: "PUBLISHING_NOT_CONFIGURED", error: "Publishing isn't configured on this account yet. Nothing was published." });
  }

  // Reconcile-before-retry: an unresolved attempt for the same piece+channel blocks a new one.
  const pending = await deps.admin.rpc("content_publication_pending_reconcile", { p_content_id: contentId, p_platform: platform, p_tenant_id: tenantId });
  if (pending.error) return respond(500, { ok: false, code: "RECONCILE_CHECK_FAILED", error: NOTHING_CHANGED });
  if (pending.data === true) {
    return respond(409, {
      ok: false, code: "RETRY_PENDING_RECONCILIATION",
      error: "A previous attempt to publish this piece to that channel never reported an outcome. Check the channel before publishing again — a duplicate post is worse than a delay.",
    });
  }

  // The governed decision: proposal on first call, single-use claim on the second.
  const governed = await governSocialMutation({
    callerDb: deps.caller, adminDb: deps.admin,
    userId: user.id, tenantId, accessAllowed: true,
    capability: CAPABILITY, availability: "needs_approval",
    requestArgs: { content_id: contentId, platform, caption: text, profile_key: profileKey },
    summary: `Publish “${pieceTitle}” to ${platform}${channelLabel !== platform ? ` (${channelLabel})` : ""}. Nothing else is included, and nothing is scheduled.`,
    approvedFingerprint,
  });
  if (governed.kind === "approval_required") {
    return respond(202, {
      ok: false, state: "approval_required",
      approval: { fingerprint: governed.fingerprint, summary: governed.summary, expires_at: governed.expiresAt },
      preview: { piece_id: contentId, piece_title: pieceTitle, platform, channel_label: channelLabel, caption: text },
    });
  }
  if (governed.kind === "refuse") {
    const status = governed.code === "access_denied" ? 403 : governed.code === "capability_unavailable" ? 503 : 409;
    return respond(status, { ok: false, state: "refused", code: governed.code, message: governed.message });
  }

  // EXECUTE — under the claimed args, once. The publication row is the receipt.
  const confirmationId = governed.confirmationId;
  const claimArgs = object(governed.args) ?? {};
  const runCaption = typeof claimArgs.caption === "string" ? claimArgs.caption : text;
  const runPlatform = typeof claimArgs.platform === "string" && PLATFORMS.has(claimArgs.platform) ? claimArgs.platform : platform;
  const runProfile = typeof claimArgs.profile_key === "string" ? claimArgs.profile_key : profileKey;

  const inserted = await deps.admin.rpc("content_publication_record", { p_id: null, p_tenant_id: tenantId, p_status: "registered" });
  const publication = object(inserted.data);
  if (inserted.error || !publication?.id) return respond(500, { ok: false, code: "RECORD_FAILED", error: NOTHING_CHANGED });
  const publicationId = String(publication.id);

  const bound = await deps.admin.rpc("content_publication_bind", {
    p_id: publicationId, p_tenant_id: tenantId, p_content_id: contentId, p_platform: runPlatform,
    p_connection_id: connectionId, p_confirmation_id: confirmationId,
    p_request_args: { content_id: contentId, platform: runPlatform, caption: runCaption, profile_key: runProfile, approved_by: user.id },
  });
  if (bound.error || !object(bound.data)?.id) return respond(500, { ok: false, code: "RECORD_FAILED", error: NOTHING_CHANGED });

  // Authority + connection RECHECK after the claim: a revoked connection publishes nothing.
  const recheck = await deps.admin.from("paige_social_connections")
    .select("status").eq("id", connectionId ?? "").eq("tenant_id", tenantId).maybeSingle();
  const recheckRow = object(recheck.data);
  if (recheck.error || recheckRow?.status !== "connected") {
    await deps.admin.rpc("content_publication_record", { p_id: publicationId, p_tenant_id: tenantId, p_status: "refused", p_error_code: "connection_no_longer_connected", p_provider_response: { recheck: recheckRow ?? null } });
    await record(deps.admin, tenantId, user.id, confirmationId, "refused", { platform: runPlatform, code: "connection_no_longer_connected", publication_id: publicationId });
    return respond(409, { ok: false, state: "refused", code: "CONNECTION_REVOKED", error: "That channel's connection changed before the post could go out. Reconnect it, then approve again. Nothing was published.", publication_id: publicationId });
  }

  await deps.admin.rpc("content_publication_record", { p_id: publicationId, p_tenant_id: tenantId, p_status: "publishing" });

  // The provider execution — the one external effect, under exactly the claimed args.
  let outcome;
  try {
    outcome = await deps.adapter.createPost({ providerProfileKey: runProfile, platform: runPlatform, text: runCaption, externalId: publicationId });
  } catch (error) {
    const code = (error as SocialPublishProviderError)?.code ?? "provider_request_failed";
    await deps.admin.rpc("content_publication_record", { p_id: publicationId, p_tenant_id: tenantId, p_status: "failed", p_error_code: code, p_provider_response: {} });
    await record(deps.admin, tenantId, user.id, confirmationId, "failed", { platform: runPlatform, code, publication_id: publicationId });
    return respond(502, { ok: false, state: "failed", code, error: "The channel refused the post. Nothing was published — you can approve it again after changing the piece.", publication_id: publicationId });
  }

  if (outcome.kind === "published") {
    const first = outcome.results.find((r) => r.platform === runPlatform) ?? outcome.results[0];
    const allOk = outcome.results.length > 0 && outcome.results.every((r) => r.success);
    const someOk = outcome.results.some((r) => r.success);
    const status = allOk ? "published" : someOk ? "partial" : "failed";
    await deps.admin.rpc("content_publication_record", {
      p_id: publicationId, p_tenant_id: tenantId, p_status: status,
      p_provider_post_id: first?.postId ?? null, p_provider_post_url: first?.postUrl ?? null,
      p_error_code: allOk || someOk ? null : (first?.error ?? "provider_rejected").slice(0, 120),
      p_provider_response: { results: outcome.results },
    });
    if (status === "failed") {
      await record(deps.admin, tenantId, user.id, confirmationId, "failed", { platform: runPlatform, code: "provider_rejected", publication_id: publicationId });
      return respond(502, { ok: false, state: "failed", code: "PROVIDER_REJECTED", error: "The channel refused the post. Nothing was published.", publication_id: publicationId });
    }
    await record(deps.admin, tenantId, user.id, confirmationId, "succeeded", { platform: runPlatform, url: first?.postUrl ?? null, post_id: first?.postId ?? null, publication_id: publicationId });
    return respond(200, {
      ok: true, state: status, platform: runPlatform,
      post_url: first?.postUrl ?? null, post_id: first?.postId ?? null, publication_id: publicationId,
    });
  }

  // processing | unknown — the post MAY exist. Truthful outcome_unknown, never "failed".
  const requestId = outcome.kind === "processing" ? outcome.requestId : outcome.requestId;
  await deps.admin.rpc("content_publication_record", {
    p_id: publicationId, p_tenant_id: tenantId, p_status: "outcome_unknown",
    p_provider_request_id: requestId, p_error_code: outcome.kind === "processing" ? "provider_processing" : outcome.reason.slice(0, 120),
    p_provider_response: outcome.kind === "processing" ? { request_id: requestId } : { reason: outcome.reason },
  });
  await record(deps.admin, tenantId, user.id, confirmationId, "outcome_unknown", { platform: runPlatform, request_id: requestId, publication_id: publicationId });
  return respond(200, {
    ok: false, state: "outcome_unknown", publication_id: publicationId, request_id: requestId,
    error: "The channel accepted the post but hasn't confirmed it. It may have posted — check the channel before trying again; this door will refuse a retry until it's reconciled.",
  });
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
      tenantId, actorId, capabilityKey: CAPABILITY,
      outcome: RECEIPT_OUTCOME[outcome], runId: await stableRunId(["social", CAPABILITY, tenantId, confirmationId]),
      detail,
    });
  } catch { /* the receipt row in content_publications is the durable record; the Rail row is best-effort here */ }
}
