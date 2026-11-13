// EXP07: the existing governed door for one saved piece, one approved social destination
// and one durable publication receipt. Reconciliation reads Zernio without sending again.

import {
  SOCIAL_POST_PLATFORMS,
  SocialProviderError,
  socialPostMediaIssue,
  type SocialPostAccount,
  type SocialPostInput,
  type SocialProviderAdapter,
  type SocialProviderPostOutcome,
  type SocialScheduledMedia,
} from "../social-provider/mod.ts";
import { governSocialMutation } from "../social-provider/governance.ts";
import { resolveStudioCaller } from "../studio-caller.ts";
import { recordCapabilityRun, stableRunId, type CapabilityOutcome } from "../capability-record.ts";
import { resolveSavedPublicationMedia, readResolvedPublicationAsset, type PublicationMediaResolution, type SavedPublicationAsset } from "./media.ts";
import { readSocialSource } from "./read.ts";
import { confirmFingerprint } from "../confirm-fingerprint.ts";
import { readSocialPublicationReference } from "./reference.ts";
import { readSocialSchedule, storedSocialSchedule, socialScheduleLabel, type SocialSchedule } from "./schedule.ts";

// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- The existing Edge wrapper injects the two Supabase clients.
type Client = any;

export interface SocialPublishDeps {
  /** The caller's own client (anon key + their JWT). Never runs a write — writes are service-role. */
  caller: Client;
  /** Service-role client: the connection read, the approval store, the
   *  publication record, and the capability receipt. */
  admin: Client;
  adapter: Pick<SocialProviderAdapter, "key" | "isConfigured" | "readPostDestination" | "createPost" | "readPost" | "readPerformance" | "updateSchedule">;
  storageOrigin?: string;
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
  (SocialPostAccount & { connectionId: string; accountId: string; connectionGeneration: string }) | { code: keyof typeof DESTINATION_ERROR }
> {
  const connections = await deps.admin.from("paige_social_connections")
    .select("id,provider_profile_key,status,updated_at")
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
      || typeof account.id !== "string" || typeof connection.updated_at !== "string" || !Number.isFinite(Date.parse(connection.updated_at))) {
    return { code: candidates.length > 1 ? "DESTINATION_AMBIGUOUS" : "NO_CONNECTION" } as const;
  }
  return {
    connectionId: connection.id,
    connectionGeneration: connection.updated_at,
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

/** Historical reads use the receipt's exact still-connected rows, never today's publish selection. */
async function recordedAccount(deps: SocialPublishDeps, tenantId: string, platform: string, connectionId: unknown, accountId: unknown): Promise<(SocialPostAccount & { connectionId: string; accountId: string; connectionGeneration: string | null }) | null> {
  if (typeof connectionId !== "string" || !UUID.test(connectionId) || typeof accountId !== "string" || !UUID.test(accountId)) return null;
  const [connection, account] = await Promise.all([
    deps.admin.from("paige_social_connections").select("provider_profile_key,updated_at").eq("tenant_id",tenantId).eq("id",connectionId)
      .eq("requested_platform",platform).eq("provider_key",deps.adapter.key).eq("provided_by_platform",false).eq("status","connected").maybeSingle(),
    deps.admin.from("paige_social_accounts").select("account_id").eq("tenant_id",tenantId).eq("id",accountId).eq("connection_id",connectionId)
      .eq("platform",platform).eq("provider_key",deps.adapter.key).eq("status","connected").maybeSingle(),
  ]);
  const profile = object(connection.data)?.provider_profile_key, providerId = object(account.data)?.account_id;
  return !connection.error && !account.error && typeof profile === "string" && typeof providerId === "string"
    ? { platform, connectionId, accountId, providerProfileKey:profile, providerAccountId:providerId, connectionGeneration: typeof object(connection.data)?.updated_at === "string" ? object(connection.data)!.updated_at as string : null } : null;
}

function savedMediaIds(piece: Record<string, unknown>, contentId: string): unknown {
  if (piece.kind === "image" || piece.kind === "video") return [contentId];
  const meta = object(piece.meta);
  return meta && Object.prototype.hasOwnProperty.call(meta, "media_content_ids") ? meta.media_content_ids : [];
}

async function resolveMedia(deps: SocialPublishDeps, tenantId: string, contentId: string, piece: Record<string, unknown>): Promise<PublicationMediaResolution> {
  return resolveSavedPublicationMedia({ tenantId, mediaContentIds: savedMediaIds(piece, contentId), storageOrigin: deps.storageOrigin ?? "", reader: {
    async readAssets(ids) {
      const read = await deps.caller.from("marketing_content")
        .select("id,tenant_id,kind,status,updated_at,image_path,image_url,meta")
        .eq("tenant_id", tenantId).in("id", [...ids]);
      return { rows: Array.isArray(read.data) ? read.data as SavedPublicationAsset[] : null, error: Boolean(read.error) };
    },
    async readObject(path) {
      const result = await deps.admin.storage.from("paige-generated").info(path);
      const facts = object(result.data);
      if (result.error || !facts) return null;
      return { contentType: facts.contentType as string, size: facts.size as number,
        etag: facts.etag as string, lastModified: facts.lastModified as string };
    },
  } });
}

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

  if (action === "inspect") {
    const source = await readSocialSource(deps.caller, tenantId, body);
    const fresh = await resolveStudioCaller(deps.caller, tenantId);
    if (!fresh.ok) return respond(403, {ok:false,code:"SOCIAL_SOURCE_SCOPE_CHANGED"});
    return respond(source.state === "available" ? 200 : 404, {ok:source.state === "available",...source});
  }
  // Rehydrate an original proposal for its current actor. This is a read: no new
  // proposal, provider call, approval claim, publication or receipt is created.
  if (action === "approval_read") return await readApproval(deps, tenantId, user.id, body);

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
  if (action === "performance") return await performance(deps, tenantId, body);
  if (action === "reschedule" || action === "cancel_schedule") return await changeSchedule(deps, tenantId, user.id, body, action, approvedFingerprint);
  if (action !== "publish") return respond(400, { ok: false, code: "ACTION_INVALID", error: NOTHING_CHANGED });

  // The request names a saved piece and a platform; the caption defaults to the piece's title.
  const contentId = typeof body.content_id === "string" && UUID.test(body.content_id) ? body.content_id : "";
  const platform = typeof body.platform === "string" && PLATFORMS.has(body.platform) ? body.platform : "";
  if (!contentId || !platform) return respond(400, { ok: false, code: "REQUEST_INVALID", error: "Name the saved piece and the channel to publish to." });
  const caption = typeof body.caption === "string" && body.caption.trim() ? body.caption.trim().slice(0, 2200) : null;
  const schedule = body.schedule === undefined ? undefined : readSocialSchedule(body.schedule, Date.now());
  if (schedule === null) return respond(409, { ok: false, state: "refused", code: "SCHEDULE_INVALID", error: "Choose a valid future time and exact time zone, then review the schedule again. Nothing was scheduled." });

  // The piece must be THIS workspace's own — a foreign piece is not found, never adopted.
  // The protected library grants SELECT to the signed-in caller, not service_role.
  // Keep the verified active workspace and explicit row predicates on this read.
  const pieceRead = await deps.caller.from("marketing_content")
    .select("id,title,kind,meta,updated_at,status").eq("id", contentId).eq("tenant_id", tenantId).maybeSingle();
  const piece = object(pieceRead.data);
  if (pieceRead.error || !piece || typeof piece.updated_at !== "string" || piece.status === "archived") return respond(404, { ok: false, code: "CONTENT_NOT_FOUND", error: "That piece is not in this workspace." });
  if (body.expected_content_revision != null && body.expected_content_revision !== piece.updated_at) {
    return respond(409, { ok: false, state: "refused", code: "CONTENT_REVISION_CHANGED", error: "This piece changed. Reload Content to review the latest saved version." });
  }
  const pieceTitle = typeof piece.title === "string" && piece.title.trim() ? piece.title.trim().slice(0, 120) : "Untitled piece";
  const text = caption ?? pieceTitle;

  // The saved post owns media order; unsaved caller lists cannot substitute other assets.
  if (body.media_content_ids !== undefined && JSON.stringify(body.media_content_ids) !== JSON.stringify(savedMediaIds(piece, contentId))) {
    return respond(409, { ok: false, state: "refused", code: "MEDIA_SELECTION_CHANGED", error: "Save this media selection before reviewing the post." });
  }
  const media = await resolveMedia(deps, tenantId, contentId, piece);
  if (media.status === "refused") return respond(409, { ok: false, state: "refused", code: media.code, error: "The saved media could not be verified. Reload the original content before reviewing this post." });
  const formatIssue = socialPostMediaIssue(platform, text, media.assets);
  if (formatIssue) return respond(409, { ok: false, state: "refused", code: formatIssue.code.toUpperCase(), error: formatIssue.message });

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
  if (pending.data === true) return await retryBlocked(deps,tenantId,contentId,platform);
  const inFlight = await deps.admin.from("content_publications").select("id")
    .eq("tenant_id", tenantId).eq("content_id", contentId).eq("platform", platform)
    .in("status", ["approved", "publishing", "scheduled", "schedule_changing"]).limit(1);
  if (inFlight.error) return respond(500, { ok: false, code: "RECONCILE_CHECK_FAILED", error: NOTHING_CHANGED });
  if (rows(inFlight.data).length) return await retryBlocked(deps,tenantId,contentId,platform);

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
    ...(schedule ? { connection_generation: account.connectionGeneration } : {}),
    channel_id: destination.channelId, channel_label: destination.label,
    ...(media.assets.length ? { media_snapshot: media.snapshot } : {}),
    ...(schedule ? { schedule: JSON.stringify(schedule), schedule_version: 1 } : {}),
  };

  // The governed decision: proposal on first call, single-use claim on the second.
  const governed = await governSocialMutation({
    callerDb: deps.caller, adminDb: deps.admin,
    userId: user.id, tenantId, accessAllowed: true,
    capability: CAPABILITY, availability: "needs_approval",
    requestArgs: { ...requestArgs, provider_account_id: account.providerAccountId, profile_key: account.providerProfileKey },
    summary: schedule ? `Schedule “${pieceTitle}” for ${socialScheduleLabel(schedule)} to ${destination.label} (${platform}).` : `Publish “${pieceTitle}” to ${destination.label} (${platform}) now.`,
    approvedFingerprint,
  });
  if (governed.kind === "approval_required") {
    return respond(202, {
      ok: false, state: "approval_required",
      approval: { fingerprint: governed.fingerprint, summary: governed.summary, expires_at: governed.expiresAt },
      preview: { piece_id: contentId, content_revision:piece.updated_at, piece_title: pieceTitle, platform, channel_label: destination.label, caption: text,
        ...(schedule ? { schedule } : {}),
        ...(media.assets.length ? { media: media.assets.map(asset => ({ content_id: asset.contentId, type: asset.type,
          url: asset.sourceUrl, mime_type: asset.contentType, size: asset.size, alt_text: asset.altText })) } : {}) },
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
  if (bound.error?.code === "PT409") return await retryBlocked(deps,tenantId,contentId,platform,requestArgs);
  const publicationId = object(bound.data)?.id;
  if (bound.error || typeof publicationId !== "string") return respond(500, { ok: false, code: "RECORD_FAILED", error: NOTHING_CHANGED });

  const checkContext = async (readProvider = false) => {
    if (schedule && !readSocialSchedule(schedule, Date.now())) return "schedule_time_expired";
    const [currentCaller, currentAccount, currentPiece] = await Promise.all([
      resolveStudioCaller(deps.caller, tenantId), publishAccount(deps, tenantId, platform),
      deps.caller.from("marketing_content").select("id,kind,meta,updated_at,status").eq("tenant_id", tenantId).eq("id", contentId).maybeSingle(),
    ]);
    if (!currentCaller.ok || "code" in currentAccount || currentAccount.connectionId !== account.connectionId
      || currentAccount.accountId !== account.accountId || currentAccount.providerAccountId !== account.providerAccountId
      || currentAccount.providerProfileKey !== account.providerProfileKey
      || (schedule && currentAccount.connectionGeneration !== account.connectionGeneration)
      || currentPiece.error || object(currentPiece.data)?.updated_at !== requestArgs.content_revision
      || object(currentPiece.data)?.status === "archived") return "authority_changed";
    const currentMedia = await resolveMedia(deps, tenantId, contentId, object(currentPiece.data)!);
    if (currentMedia.status !== "ready" || currentMedia.snapshot !== media.snapshot) return "media_changed";
    if (readProvider) {
      const currentDestination = await deps.adapter.readPostDestination(currentAccount);
      if (currentDestination.channelId !== destination.channelId || currentDestination.label !== destination.label) return "authority_changed";
    }
    return "valid";
  };
  const currentContext = await checkContext();
  if (currentContext !== "valid") {
    await deps.admin.rpc("content_publication_record", {
      p_id: publicationId, p_tenant_id: tenantId, p_status: "refused", p_error_code: "approval_context_changed",
    });
    await record(deps.admin, tenantId, user.id, confirmationId, "refused", { platform, code: "approval_context_changed", publication_id: publicationId });
    return respond(409, { ok: false, state: "refused", code: currentContext === "schedule_time_expired" ? "SCHEDULE_TIME_EXPIRED" : currentContext === "media_changed" ? "MEDIA_CONTEXT_CHANGED" : "CONNECTION_REVOKED", error: currentContext === "schedule_time_expired" ? "The approved time is too close or has passed. Choose a future time and review again. Nothing was scheduled." : "Access, the saved piece, media or connected destination changed. Nothing was published.", publication_id: publicationId });
  }

  const publishing = await deps.admin.rpc("content_publication_record", { p_id: publicationId, p_tenant_id: tenantId, p_status: "publishing" });
  if (publishing.error || !object(publishing.data)?.id) {
    return respond(500, { ok: false, code: "RECORD_FAILED", error: NOTHING_CHANGED, publication_id: publicationId });
  }

  let outcome: SocialProviderPostOutcome;
  try {
    outcome = await deps.adapter.createPost({ ...account, channelId: destination.channelId, text, externalId: publicationId,
      ...(schedule ? { schedule, scheduleVersion: 1 } : {}), beforePublish: async () => {
        if (await checkContext(true) !== "valid") throw new SocialProviderError("approval_context_changed", 409, "The approved publication context changed.");
      }, ...(media.assets.length ? { media: media.assets.map(asset => ({ type: asset.type, contentType: asset.contentType,
        size: asset.size, altText: asset.altText, readBytes: async () => {
          const bytes = await readResolvedPublicationAsset({ tenantId, storageOrigin: deps.storageOrigin ?? "", asset });
          if (!bytes) throw new SocialProviderError("media_source_changed", 409, "The saved media no longer matches the reviewed file.");
          return bytes;
        } })) } : {}) });
  } catch (error) {
    if (error instanceof SocialProviderError && ["approval_context_changed","schedule_time_expired"].includes(error.code)) {
      const refused = await deps.admin.rpc("content_publication_record", { p_id: publicationId, p_tenant_id: tenantId, p_status: "refused", p_error_code: error.code });
      if (refused.error || !object(refused.data)?.id) return respond(500, { ok: false, state: "outcome_unknown", publication_id: publicationId, error: "Publishing stopped before the post, but the receipt update could not be confirmed. Check the original attempt." });
      await record(deps.admin, tenantId, user.id, confirmationId, "refused", { platform, code: error.code, publication_id: publicationId });
      return respond(409, { ok: false, state: "refused", code: error.code === "schedule_time_expired" ? "SCHEDULE_TIME_EXPIRED" : "PUBLICATION_CONTEXT_CHANGED", publication_id: publicationId, error: error.code === "schedule_time_expired" ? "The approved time is too close or has passed. Choose a future time and review again. Nothing was scheduled." : "Access, the saved post, media or destination changed during preparation. Nothing was published." });
    }
    if (!(error instanceof SocialProviderError)) {
      outcome = { kind: "unknown", requestId: null, reason: "provider_dispatch_unconfirmed" };
    } else {
      outcome = { kind: "published", results: [{ platform, success: false, postId: null, postUrl: null, error: error.code }] };
    }
  }
  return await finish(deps, { tenantId, platform, publicationId, confirmationId, actorId: user.id, ...(schedule ? { schedule, version: 1 } : {}) }, outcome);
}

async function readApproval(deps: SocialPublishDeps, tenantId:string, userId:string, body:Record<string,unknown>):Promise<Response> {
  const fp=body.fingerprint;
  if(typeof fp!=="string"||!/^[0-9a-f]{16}$/.test(fp)||typeof body.content_id!=="string"||!UUID.test(body.content_id))return respond(400,{ok:false,code:"SOCIAL_APPROVAL_INVALID"});
  const selected=await deps.admin.from("paige_pending_confirmations").select("fingerprint,args,summary,expires_at")
    .eq("user_id",userId).eq("tenant_id",tenantId).eq("tool_name",CAPABILITY).eq("fingerprint",fp)
    .is("thread_id",null).is("scoped_client_id",null).is("consumed_at",null)
    .not("server_issued_at","is",null).not("issued_in_request","is",null).gt("expires_at",new Date().toISOString()).maybeSingle();
  const row=object(selected.data),args=object(row?.args);
  if(selected.error||!row||!args||row.fingerprint!==fp||args.content_id!==body.content_id||args.content_revision!==body.expected_content_revision
    ||typeof args.platform!=="string"||!PLATFORMS.has(args.platform)||typeof args.caption!=="string"||args.caption.length>2200
    ||typeof args.channel_label!=="string"||typeof row.summary!=="string"||typeof row.expires_at!=="string"||Date.parse(row.expires_at)<=Date.now()
    ||await confirmFingerprint(CAPABILITY,args)!==fp)return respond(409,{ok:false,code:"SOCIAL_APPROVAL_UNAVAILABLE"});
  if (args.operation === "reschedule" || args.operation === "cancel_schedule") {
    const context = await scheduleContext(deps, tenantId, String(args.content_id), String(args.publication_id));
    if (!context || args.publication_version !== context.version || args.previous_schedule !== JSON.stringify(context.current)
        || args.provider_request_id !== context.row.provider_request_id || args.caption !== context.args.caption
        || args.connection_generation !== context.account.connectionGeneration || !storedSocialSchedule(args.schedule, Date.now())) {
      return respond(409, {ok:false,code:"SOCIAL_SCHEDULE_CHANGED"});
    }
    if (!(await resolveStudioCaller(deps.caller,tenantId)).ok) return respond(403,{ok:false,code:"SOCIAL_APPROVAL_SCOPE_CHANGED"});
    return respond(200, {ok:true,state:"approval_available",approval:{fingerprint:fp,summary:row.summary,expires_at:row.expires_at},
      preview:{piece_id:args.content_id,content_revision:args.content_revision,piece_title:"Original scheduled post",platform:args.platform,channel_label:args.channel_label,
        caption:args.caption,schedule:storedSocialSchedule(args.schedule),operation:args.operation,publication_id:args.publication_id,
        publication_version:args.publication_version,media:schedulePreviewMedia(context.args)}});
  }
  const pieceRead=await deps.caller.from("marketing_content").select("id,title,kind,meta,updated_at,status")
    .eq("tenant_id",tenantId).eq("id",args.content_id).maybeSingle();
  const piece=object(pieceRead.data);
  if(pieceRead.error||!piece||piece.status==="archived"||piece.updated_at!==args.content_revision)return respond(409,{ok:false,code:"CONTENT_REVISION_CHANGED"});
  const [media,account]=await Promise.all([resolveMedia(deps,tenantId,String(args.content_id),piece),publishAccount(deps,tenantId,args.platform)]);
  const schedule = args.schedule === undefined ? undefined : storedSocialSchedule(args.schedule, Date.now());
  if (schedule === null || (schedule && (("code" in account) || account.connectionGeneration !== args.connection_generation))) return respond(409,{ok:false,code:"SOCIAL_SCHEDULE_CHANGED"});
  if(media.status!=="ready"||("code" in account)||args.connection_id!==account.connectionId||args.account_id!==account.accountId
    ||args.provider_account_id!==account.providerAccountId||args.profile_key!==account.providerProfileKey
    ||(args.media_snapshot??null)!==(media.assets.length?media.snapshot:null))return respond(409,{ok:false,code:"SOCIAL_APPROVAL_CHANGED"});
  const fresh=await resolveStudioCaller(deps.caller,tenantId);
  if(!fresh.ok)return respond(403,{ok:false,code:"SOCIAL_APPROVAL_SCOPE_CHANGED"});
  return respond(200,{ok:true,state:"approval_available",approval:{fingerprint:fp,summary:row.summary,expires_at:row.expires_at},
    preview:{piece_id:args.content_id,content_revision:args.content_revision,piece_title:typeof piece.title==="string"?piece.title.slice(0,120):"Saved post",platform:args.platform,
      ...(schedule ? {schedule} : {}),
      channel_label:args.channel_label,caption:args.caption,media:media.assets.map(asset=>({content_id:asset.contentId,type:asset.type,url:asset.sourceUrl,
        mime_type:asset.contentType,size:asset.size,alt_text:asset.altText}))}});
}

function schedulePreviewMedia(args: Record<string,unknown>) {
  try {
    const parsed = JSON.parse(typeof args.media_snapshot === "string" ? args.media_snapshot : "[]");
    return Array.isArray(parsed) && parsed.length <= 20 ? parsed.map(asset => ({content_id:asset.content_id,type:asset.type,url:asset.source_url,
      mime_type:asset.content_type,size:asset.size,alt_text:asset.alt_text})) : [];
  } catch { return []; }
}
async function scheduleContext(deps:SocialPublishDeps,tenantId:string,contentId:string,publicationId:string) {
  if (!UUID.test(contentId) || !UUID.test(publicationId)) return null;
  const read = await deps.admin.from("content_publications").select("id,content_id,platform,status,connection_id,confirmation_id,provider_request_id,request_args,provider_response")
    .eq("tenant_id",tenantId).eq("content_id",contentId).eq("id",publicationId).maybeSingle();
  const row=object(read.data),args=object(row?.request_args),receipt=object(object(row?.provider_response)?.schedule),current=readSocialSchedule(receipt?.current);
  const version=receipt?.version;
  if(read.error||!row||row.status!=="scheduled"||!args||!current||typeof version!=="number"||!Number.isSafeInteger(version)||version<1
      ||typeof row.provider_request_id!=="string"||typeof row.platform!=="string"||!PLATFORMS.has(row.platform)
      ||args.content_id!==contentId||typeof args.caption!=="string"||typeof args.content_revision!=="string")return null;
  const account=await recordedAccount(deps,tenantId,row.platform,row.connection_id,args.account_id);
  if(!account||!account.connectionGeneration||account.connectionGeneration!==args.connection_generation)return null;
  const providerMedia=Array.isArray(receipt?.provider_media)?receipt.provider_media as SocialScheduledMedia[]:[];
  if(args.media_snapshot&&providerMedia.length===0)return null;
  return {row,args,current,version,account,providerMedia};
}
async function changeSchedule(deps:SocialPublishDeps,tenantId:string,userId:string,body:Record<string,unknown>,operation:"reschedule"|"cancel_schedule",approvedFingerprint:string|null) {
  const context=await scheduleContext(deps,tenantId,String(body.content_id),String(body.publication_id));
  if(!context||body.publication_version!==context.version)return respond(409,{ok:false,state:"refused",code:"SCHEDULE_CHANGED",error:"The original schedule changed or cannot be verified. Check its original receipt before making another change."});
  const {row,args,current,version,account,providerMedia}=context;
  const next=operation==="reschedule"?readSocialSchedule(body.schedule,Date.now()):readSocialSchedule(current,Date.now());
  if(!next)return respond(409,{ok:false,state:"refused",code:"SCHEDULE_INVALID",error:"This time is too close or has passed. Check the original post; cancellation or rescheduling cannot be assumed."});
  if(!deps.adapter.isConfigured()||!deps.adapter.updateSchedule)return respond(503,{ok:false,code:"PUBLISHING_NOT_CONFIGURED",error:"Schedule changes are unavailable. The original provider schedule has not been cancelled."});
  const requestArgs={operation,publication_id:row.id,publication_version:version,content_id:args.content_id,content_revision:args.content_revision,
    platform:row.platform,caption:args.caption,connection_id:account.connectionId,account_id:account.accountId,channel_id:args.channel_id,
    channel_label:args.channel_label,connection_generation:account.connectionGeneration,provider_request_id:row.provider_request_id,
    previous_schedule:JSON.stringify(current),schedule:JSON.stringify(next),...(args.media_snapshot?{media_snapshot:args.media_snapshot}:{}),
    provider_account_id:account.providerAccountId,profile_key:account.providerProfileKey};
  const governed=await governSocialMutation({callerDb:deps.caller,adminDb:deps.admin,userId,tenantId,accessAllowed:true,capability:CAPABILITY,
    availability:"needs_approval",requestArgs,approvedFingerprint,
    summary:operation==="reschedule"?`Move the original post to ${socialScheduleLabel(next)} at ${args.channel_label} (${row.platform}).`:`Stop the original schedule for ${socialScheduleLabel(current)} at ${args.channel_label} (${row.platform}).`});
  if(governed.kind==="approval_required")return respond(202,{ok:false,state:"approval_required",publication_id:row.id,approval:{fingerprint:governed.fingerprint,summary:governed.summary,expires_at:governed.expiresAt},
    preview:{piece_id:args.content_id,content_revision:args.content_revision,piece_title:"Original scheduled post",platform:row.platform,channel_label:args.channel_label,caption:args.caption,
      schedule:next,operation,publication_id:row.id,publication_version:version,media:schedulePreviewMedia(args)}});
  if(governed.kind==="refuse")return respond(409,{ok:false,state:"refused",code:governed.code,error:governed.message});
  if(Object.entries(requestArgs).some(([key,value])=>governed.args[key]!==value))return respond(409,{ok:false,state:"refused",code:"CLAIM_MISMATCH",error:"The exact schedule change no longer matches this approval."});
  const mutation={confirmation_id:governed.confirmationId,expected_version:version,operation,previous_schedule:current,next_schedule:next,approved_by:userId};
  const claim=await deps.admin.rpc("content_publication_record",{p_id:row.id,p_tenant_id:tenantId,p_status:"schedule_changing",
    p_provider_request_id:row.provider_request_id,p_provider_response:{schedule_claim:mutation}});
  if(claim.error||!object(claim.data)?.id)return respond(409,{ok:false,code:"SCHEDULE_CHANGED",error:"Another change may already be in progress. Check the same original receipt.",publication_id:row.id});
  const input:SocialPostInput={...account,channelId:typeof args.channel_id==="string"?args.channel_id:null,text:String(args.caption),externalId:String(row.id),
    schedule:next,scheduleVersion:version+1,scheduledMedia:providerMedia,cancelSchedule:operation==="cancel_schedule",beforePublish:async()=>{
      const [fresh,stillAccount]=await Promise.all([resolveStudioCaller(deps.caller,tenantId),recordedAccount(deps,tenantId,String(row.platform),row.connection_id,args.account_id)]);
      if(!fresh.ok||!stillAccount||stillAccount.connectionGeneration!==account.connectionGeneration||stillAccount.providerAccountId!==account.providerAccountId
          ||stillAccount.providerProfileKey!==account.providerProfileKey)throw new SocialProviderError("approval_context_changed",409,"Access or the original connection changed before the schedule update.");
    }};
  let outcome:SocialProviderPostOutcome;
  try{outcome=await deps.adapter.updateSchedule(input,String(row.provider_request_id),version,governed.confirmationId,current);}
  catch{outcome={kind:"unknown",requestId:String(row.provider_request_id),reason:"provider_schedule_change_unconfirmed"};}
  return await finish(deps,{tenantId,platform:String(row.platform),publicationId:String(row.id),confirmationId:governed.confirmationId,actorId:userId,
    schedule:next,version:version+1,providerMedia,mutation,cancel:operation==="cancel_schedule"},outcome);
}

async function retryBlocked(deps:SocialPublishDeps,tenantId:string,contentId:string,platform:string,duplicateArgs?:Record<string,unknown>) {
  const read=await deps.caller.rpc("content_publication_list",{p_content_id:contentId,p_tenant_id:tenantId});
  const original=read.error?[]:rows(read.data).filter(row=>{
    if(row.tenant_id!==tenantId||row.content_id!==contentId||row.platform!==platform)return false;
    if(["approved","publishing","outcome_unknown","scheduled","schedule_changing"].includes(String(row.status)))return true;
    const saved=object(row.request_args);
    return !!duplicateArgs&&!!saved&&["published","partial"].includes(String(row.status))
      &&["content_revision","account_id","channel_id","caption","media_snapshot"].every(key=>(saved[key]??null)===(duplicateArgs[key]??null));
  }).flatMap(row=>{
      const reference=readSocialPublicationReference({schema:1,tenant_id:tenantId,content_id:contentId,content_revision:object(row.request_args)?.content_revision,publication_id:row.id});
      return reference?[reference]:[];
    });
  const current=await resolveStudioCaller(deps.caller,tenantId);
  return respond(409, { ok: false, code: "RETRY_PENDING_RECONCILIATION", recovery_required:true,
    ...(current.ok?{original_attempts:original.slice(0,6),original_attempts_omitted:Math.max(0,original.length-6)}:{}),
    error: "An attempt already exists for this post. Check the original receipt before trying again." });
}

type Attempt = { tenantId: string; platform: string; publicationId: string; confirmationId: string; actorId: string; schedule?: SocialSchedule; version?: number; mutation?: Record<string,unknown>; cancel?: boolean;providerMedia?:SocialScheduledMedia[] };

async function finish(deps: SocialPublishDeps, attempt: Attempt, outcome: SocialProviderPostOutcome, reconciled = false) {
  const { tenantId, platform, publicationId, confirmationId, actorId } = attempt;
  const providerMedia=outcome.scheduledMedia??attempt.providerMedia??[];
  if ((outcome.kind === "scheduled" && attempt.schedule && outcome.version === attempt.version
       && outcome.scheduledFor === attempt.schedule.scheduled_for && outcome.timezone === attempt.schedule.timezone)
      || (outcome.kind === "cancelled" && attempt.cancel && outcome.version === attempt.version)) {
    const status = outcome.kind === "scheduled" ? "scheduled" : "cancelled";
    const saved = await deps.admin.rpc("content_publication_record", { p_id: publicationId, p_tenant_id: tenantId, p_status: status,
      p_provider_request_id: outcome.requestId, p_error_code: null, p_provider_response: {
        ...(reconciled ? { reconciled: true } : {}), schedule: { current: attempt.schedule, version: attempt.version, state: status,provider_media:providerMedia,
          ...(attempt.mutation ? { mutation: attempt.mutation } : {}) },
      } });
    if (saved.error || !object(saved.data)?.id) return respond(200, { ok: false, state: "outcome_unknown", publication_id: publicationId, error: "The provider result could not be saved. Check this original receipt; do not create another schedule." });
    await record(deps.admin, tenantId, actorId, confirmationId, "succeeded", { platform, publication_id: publicationId, scheduled: status === "scheduled", cancelled: status === "cancelled", reconciled });
    return respond(200, { ok: true, state: status, publication_id: publicationId, schedule: attempt.schedule, schedule_version: attempt.version });
  }
  const result = outcome.kind === "published" && outcome.results.length === 1
    && outcome.results[0].platform === platform ? outcome.results[0] : null;
  const status = result && !result.success ? "failed"
    : result?.postUrl && result.postId ? "published" : "outcome_unknown";
  const requestId = outcome.requestId ?? null;
  const pending = status === "outcome_unknown";
  const scheduleChangeUnconfirmed=!reconciled&&!!attempt.mutation&&status==="published";
  const code = pending ? outcome.kind === "processing" ? "provider_processing" : "provider_dispatch_unconfirmed"
    : status === "failed" ? result?.error ?? "provider_rejected" : null;
  const saved = reconciled && pending && !attempt.schedule ? null : await deps.admin.rpc("content_publication_record", {
    p_id: publicationId, p_tenant_id: tenantId, p_status: status,
    p_provider_post_id: result?.postId ?? null, p_provider_post_url: result?.postUrl ?? null,
    p_provider_request_id: requestId, p_error_code: code,
    p_provider_response: { ...(result ? { results: [result] } : {}), ...(reconciled ? { reconciled: true } : {}),
      ...(attempt.schedule ? { schedule: { current: attempt.schedule, version: attempt.version ?? 1, state: status,provider_media:providerMedia,
        ...(attempt.mutation ? { mutation: attempt.mutation } : {}) } } : {}) },
  });

  // A confirmed result is shown only once the original durable receipt records it.
  if (saved && (saved.error || !object(saved.data)?.id)) {
    return respond(200, { ok: false, state: "outcome_unknown", publication_id: publicationId, error: UNCONFIRMED });
  }
  if (!reconciled || !pending) {
    await record(deps.admin, tenantId, actorId, confirmationId, pending||scheduleChangeUnconfirmed ? "outcome_unknown" : status === "failed" ? "failed" : "succeeded",
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
  return respond(200, { ok: !scheduleChangeUnconfirmed, state: "published", platform, post_url: result?.postUrl, post_id: result?.postId, publication_id: publicationId,
    ...(scheduleChangeUnconfirmed?{schedule_change_applied:false,error:"The original post is already published. This schedule change was not confirmed."}:{}) });
}

async function reconcile(deps: SocialPublishDeps, tenantId: string, body: Record<string, unknown>): Promise<Response> {
  const publicationId = typeof body.publication_id === "string" && UUID.test(body.publication_id) ? body.publication_id : "";
  const contentId = typeof body.content_id === "string" && UUID.test(body.content_id) ? body.content_id : "";
  if (!publicationId || !contentId) return respond(400, { ok: false, code: "REQUEST_INVALID", error: "Choose the original publication attempt." });
  const read = await deps.admin.from("content_publications")
    .select("id,platform,status,connection_id,confirmation_id,provider_request_id,provider_post_id,provider_post_url,request_args,provider_response")
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
  if (!args || !["outcome_unknown","publishing","scheduled","schedule_changing","cancelled"].includes(String(row.status))
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
  const scheduleReceipt=object(object(row.provider_response)?.schedule),mutation=object(scheduleReceipt?.mutation);
  const schedule=readSocialSchedule(scheduleReceipt?.current)??storedSocialSchedule(args.schedule);
  const expectedVersion=mutation?Number(mutation.expected_version)+1:Number(scheduleReceipt?.version??args.schedule_version);
  if(schedule){input.schedule=schedule;input.scheduleVersion=expectedVersion;input.cancelSchedule=mutation?.operation==="cancel_schedule"||row.status==="cancelled";}
  const providerMedia=Array.isArray(scheduleReceipt?.provider_media)?scheduleReceipt.provider_media as SocialScheduledMedia[]:[];
  if(schedule)input.scheduledMedia=providerMedia;
  let outcome: SocialProviderPostOutcome;
  try {
    outcome = await deps.adapter.readPost(input, typeof row.provider_request_id === "string" ? row.provider_request_id : null);
  } catch {
    return respond(200, { ok: false, state: "outcome_unknown", publication_id: publicationId, error: UNCONFIRMED });
  }
  return await finish(deps, { tenantId, platform: row.platform, publicationId,
    confirmationId:typeof mutation?.confirmation_id==="string"?mutation.confirmation_id:row.confirmation_id,
    actorId:typeof mutation?.approved_by==="string"?mutation.approved_by:args.approved_by,
    ...(schedule?{schedule,version:expectedVersion,providerMedia,...(mutation?{mutation}:{}),cancel:input.cancelSchedule}:{}), }, outcome, true);
}

/** A manual read of the original account/post, cached in that same original receipt. */
async function performance(deps: SocialPublishDeps, tenantId: string, body: Record<string, unknown>): Promise<Response> {
  const id = typeof body.publication_id === "string" && UUID.test(body.publication_id) ? body.publication_id : "";
  const contentId = typeof body.content_id === "string" && UUID.test(body.content_id) ? body.content_id : "";
  if (!id || !contentId) return respond(400, { ok: false, code: "REQUEST_INVALID", error: "Choose the original published post." });
  const result = await deps.admin.from("content_publications")
    .select("id,platform,status,connection_id,provider_request_id,provider_post_id,provider_post_url,request_args,provider_response")
    .eq("tenant_id", tenantId).eq("content_id", contentId).eq("id", id).maybeSingle();
  const row = object(result.data), args = object(row?.request_args);
  if (result.error || !row) return respond(404, { ok: false, code: "PUBLICATION_NOT_FOUND", error: "That original post is not in this workspace." });
  if (row.status !== "published" || typeof row.platform !== "string" || !args || typeof row.provider_post_id !== "string" || typeof row.provider_request_id !== "string") {
    return respond(409, { ok: false, code: "PERFORMANCE_NOT_READY", error: "Check the original publication result before its performance." });
  }
  const account = await recordedAccount(deps, tenantId, row.platform, row.connection_id, args.account_id);
  if (!account) {
    return respond(409, { ok: false, code: "PERFORMANCE_SOURCE_UNAVAILABLE", error: "The original connected account is unavailable. Existing recorded results remain in Social." });
  }
  const cached = object(object(row.provider_response)?.analytics), checked = typeof cached?.checked_at === "string" ? Date.parse(cached.checked_at) : NaN;
  if (cached && Number.isFinite(checked) && checked <= Date.now() && Date.now() - checked < 60 * 60 * 1000) {
    return respond(200, { ok: true, state: "performance", publication_id: id, cached: true, analytics: cached });
  }
  if (!deps.adapter.isConfigured() || !deps.adapter.readPerformance) return respond(503, { ok: false, code: "PERFORMANCE_UNAVAILABLE", error: "Performance cannot be checked right now." });
  let analytics;
  try {
    analytics = await deps.adapter.readPerformance({ ...account, requestId: row.provider_request_id, postId: row.provider_post_id });
  } catch { analytics = { state: "error", metrics: {}, measured_at: null }; }
  // A provider read does not authorize a write after the actor or account has changed.
  const [caller, currentAccount] = await Promise.all([resolveStudioCaller(deps.caller, tenantId), recordedAccount(deps, tenantId, row.platform, row.connection_id, args.account_id)]);
  if (!caller.ok || !currentAccount || currentAccount.accountId !== account.accountId
      || currentAccount.connectionId !== account.connectionId || currentAccount.providerAccountId !== account.providerAccountId
      || currentAccount.providerProfileKey !== account.providerProfileKey) return respond(403, { ok: false, code: "PERFORMANCE_CONTEXT_CHANGED", error: "Workspace access or the original account changed. Reopen this post to check it." });
  const saved = await deps.admin.rpc("content_publication_record", { p_id: id, p_tenant_id: tenantId, p_status: "published",
    p_provider_post_id: row.provider_post_id, p_provider_post_url: row.provider_post_url, p_provider_request_id: row.provider_request_id,
    p_provider_response: { analytics: { ...analytics, checked_at: new Date().toISOString() } },
  });
  const stored = object(object(saved.data)?.provider_response)?.analytics;
  if (saved.error || !object(stored)) return respond(500, { ok: false, code: "PERFORMANCE_RECEIPT_UNCONFIRMED", error: "The performance read could not be saved to the original receipt. Check again later." });
  return respond(200, { ok: true, state: "performance", publication_id: id, cached: false, analytics: stored });
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
