// THE HOSTING DOOR — the executor behind `growth-hosting-command` (EXP06 WEB-05, owner
// direction 2026-10-28 88b2f756: implementation within existing authority, provider
// activation HELD).
//
// It is a domain adapter built exactly like the ONE publish door (_shared/growth-publish-command):
//
//   authenticated user → server-derived workspace (resolveStudioCaller: owner, admin or managing
//   agency) → canonical autonomy lane (resolve_tool_autonomy) → readiness checks on the page →
//   the shared decision (decideDeclaredCapability over GROWTH_HOSTING_KIT_BY_ACTION) → a
//   thread-less, server-issued proposal in paige_pending_confirmations (202 + fingerprint) → on
//   the second call an atomic single-use claim of THAT proposal, bound to this user, workspace,
//   act and page → the stored call runs: the portable export of the PUBLISHED page is deployed to
//   Cloudflare Workers Static Assets with a platform-held token, the real HTTPS address is fetched
//   and compared with the exported bytes, the deployment row + the §17 usage meter are written →
//   exactly one capability receipt.
//
// DORMANT BY DESIGN: when the platform token/account configuration is absent, every path refuses
// `HOSTING_NOT_ENABLED` with the honest copy the product already shows — and NO proposal is ever
// minted while the service is off. The governance (both keys `high`) is live regardless.
//
// A hosted copy is a copy, never a move: the page's own record, its reserved address and every
// publish-door authority are untouched by this door.
import { confirmFingerprint } from "../confirm-fingerprint.ts";
import type { decideDeclaredCapability } from "../capability-kit/decision.ts";
import { resolveStudioCaller, type StudioCallerRefused } from "../studio-caller.ts";
import { recordCapabilityRun, stableRunId } from "../capability-record.ts";
import { deployStaticSite, deleteStaticSite } from "../growth-hosting/provider.ts";
import { verifyHttpsDeployment } from "../growth-hosting/verify.ts";
import { meterHostingEvent } from "../growth-hosting/meter.ts";
import {
  buildHostingPreview, classifyHostingOutcome, deploymentName, HOSTING_KEYS, HOSTING_REFUSALS, pageIsPublished, previewReady, previewSummary,
  UUID, type HostingCommand, type HostingExport, type HostingProviderConfig, type HostingReadinessFacts, type HostingReceiptOutcome,
} from "./contract.ts";

// deno-lint-ignore no-explicit-any
type Client = any;
type DecisionInput = Parameters<typeof decideDeclaredCapability>[1];
export type HostingDecision = ReturnType<typeof decideDeclaredCapability>;
export interface HostingDoorDeps {
  /** The caller's own client (anon key + their JWT). Never runs a write. */
  caller: Client;
  /** Service-role client: the approval store, the audit row, readiness reads, the deployment row, the receipt, the meter. */
  admin: Client;
  /** The canonical Kit gate — bound in index.ts as decideDeclaredCapability(GROWTH_HOSTING_KIT_BY_ACTION[key]). */
  decide: (key: string, input: DecisionInput) => HostingDecision;
  /** The platform's provider configuration, from environment. NULL/absent = the honest dormant state. */
  providerConfig: HostingProviderConfig | null;
  /**
   * The ONE export builder (the same pure implementation the app's export card uses), producing
   * the bytes for the page's PUBLISHED version. Injected so tests double it and index binds the
   * real shared builder; returning null = "the export couldn't be built" (an honest refusal).
   */
  buildExport: (page: Record<string, unknown>, tenantSlug: string) => Promise<HostingExport | null>;
  /** fetch for the provider + verification calls (tests inject; production uses global fetch). */
  fetchImpl?: typeof fetch;
}

const HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};
const respond = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), { status, headers: HEADERS });
const object = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

const PROPOSAL_TTL_MS = 10 * 60 * 1000;
const NOTHING_CHANGED = "Nothing was changed.";

async function loadFacts(admin: Client, tenantId: string, pageId: string): Promise<HostingReadinessFacts> {
  const { data: tenant, error: tenantError } = await admin.from("tenants").select("slug").eq("id", tenantId).maybeSingle();
  if (tenantError) throw new Error("readiness_read_failed");
  const { data: page, error: pageError } = await admin.from("growth_pages")
    .select("id,tenant_id,title,slug,status,blocks_json,theme_json,seo_json,og_image_url,published_at")
    .eq("id", pageId).eq("tenant_id", tenantId).maybeSingle();
  if (pageError) throw new Error("readiness_read_failed");
  const { data: existing, error: existingError } = await admin.from("growth_hosted_deployments")
    .select("id,tenant_id,page_id,deployment_name,url,export_sha256,status,verified_at,last_error,created_at,updated_at")
    .eq("page_id", pageId).eq("tenant_id", tenantId).maybeSingle();
  if (existingError) throw new Error("readiness_read_failed");
  return {
    tenantSlug: typeof object(tenant)?.slug === "string" ? String(object(tenant)!.slug) : null,
    page: object(page),
    existing: object(existing),
  };
}

export async function handleGrowthHostingCommand(req: Request, deps: HostingDoorDeps): Promise<Response> {
  try {
    if (req.method === "OPTIONS") return new Response(null, { headers: HEADERS });
    if (req.method !== "POST") return respond(405, { ok: false, code: "METHOD_NOT_ALLOWED", error: "POST only." });

    const body = object(await req.json().catch(() => null));
    const cmdRaw = object(body);
    const action = typeof cmdRaw?.action === "string" && (cmdRaw.action === "deploy" || cmdRaw.action === "recover") ? cmdRaw.action : null;
    const pageId = typeof cmdRaw?.page_id === "string" ? cmdRaw.page_id : "";
    if (!action || !UUID.test(pageId)) {
      return respond(400, { ok: false, refused: true, code: "BAD_COMMAND", error: "Tell me which published page, and whether to deploy or take down its hosted copy." });
    }
    const cmd: HostingCommand = { action, page_id: pageId,
      ...(typeof cmdRaw?.approved_fingerprint === "string" ? { approved_fingerprint: cmdRaw.approved_fingerprint } : {}),
      ...(typeof cmdRaw?.expected_tenant_id === "string" ? { expected_tenant_id: cmdRaw.expected_tenant_id } : {}) };
    const key = HOSTING_KEYS[action];

    let who: Awaited<ReturnType<typeof resolveStudioCaller>>;
    try {
      who = await resolveStudioCaller(deps.caller);
    } catch (e) {
      const refused = e as StudioCallerRefused;
      const status = refused.reason === "unauthenticated" ? 401 : 403;
      return respond(status, { ok: false, refused: true, forbidden: status === 403, code: String(refused.reason ?? "forbidden").toUpperCase(),
        error: typeof refused.message === "string" && refused.message ? refused.message : "Only this workspace's owner or an admin can do that. Nothing was changed." });
    }
    const userId = who.userId;
    const tenantId = who.tenantId;
    if (cmd.expected_tenant_id && cmd.expected_tenant_id.toLowerCase() !== tenantId) {
      return respond(409, { ok: false, refused: true, code: "WORKSPACE_CHANGED", error: `Your workspace changed. ${NOTHING_CHANGED}` });
    }
    const isAttempt = cmd.approved_fingerprint !== undefined;
    const attemptAnchor = `${key}:${tenantId}:${cmd.page_id}`;

    const fileReceipt = async (
      input: { outcome: HostingReceiptOutcome; detail?: Record<string, unknown> }, anchor: string, approval: string | null,
    ): Promise<boolean> => await recordCapabilityRun(deps.admin, {
      tenantId, actorId: userId, capabilityKey: key, outcome: input.outcome,
      runId: await stableRunId([key, tenantId, anchor]),
      detail: { page_id: cmd.page_id, door: "growth-hosting-command", action: cmd.action, approval_channel: approval, ...(input.detail ?? {}) },
    });
    const fileAttemptRefusal = async (reason: string): Promise<boolean> =>
      isAttempt ? await fileReceipt({ outcome: "capability_refused", detail: { refused: reason } }, attemptAnchor, null) : false;

    const stillCurrent = async (): Promise<boolean> => {
      const { data, error } = await deps.caller.rpc("current_user_tenant_id");
      return !error && typeof data === "string" && data.toLowerCase() === tenantId;
    };

    const { data: resolvedLane, error: laneError } = await deps.caller.rpc("resolve_tool_autonomy", { _tenant_id: tenantId, _tool_key: key });
    const lane = !laneError && typeof resolvedLane === "string" && ["auto", "confirm", "off"].includes(resolvedLane) ? resolvedLane : "unresolved";
    const requestArgs: Record<string, unknown> = { action: cmd.action, page_id: cmd.page_id, expected_tenant_id: tenantId, approval_subject: `${cmd.action}:page:${cmd.page_id}` };
    const decide = (claimedArgs: Record<string, unknown> | null | undefined) => deps.decide(key, {
      caller: { authenticated: true, userId, principal: "person", tenantId, tenantSource: "server", door: "other",
        access: { allowed: true, reason: "The workspace's owner, an admin, or its managing agency." } },
      capability: { id: key, effect: "mutate", outcomeChannel: "record_capability_run", availability: "needs_approval" },
      approval: { autonomyLane: lane, ...(claimedArgs !== undefined ? { claimedArgs, claimedFor: key } : {}) },
      requestArgs,
    });
    type Decision = HostingDecision;
    const audit = async (decision: Decision): Promise<boolean> => {
      const { error } = await deps.admin.from("paige_audit_log").insert({
        actor_user_id: userId, actor_role: "studio:workspace_admin", tenant_id: tenantId,
        action: "studio.hosting_governed_decision", target_type: "page", target_id: cmd.page_id,
        payload: { capability: key, action: cmd.action, decision: decision.kind, risk: decision.risk,
          lane_requested: decision.audit.laneRequested, lane_effective: decision.audit.laneEffective, clamped: decision.audit.clamped,
          ...(decision.kind === "refuse" ? { refusal: decision.code } : {}) },
      });
      return !error;
    };
    const notGoverned = async (e: unknown): Promise<Response> => {
      console.error("[growth-hosting-command] the Kit gate refused to decide", JSON.stringify({ key, reason: e instanceof Error ? e.message : String(e) }));
      const recorded = await fileAttemptRefusal("capability_not_governed");
      return respond(503, { ok: false, refused: true, code: "CAPABILITY_NOT_GOVERNED", error: `This can't be done from here yet. ${NOTHING_CHANGED}`, receipt_recorded: recorded });
    };

    // The brake: a switched-off lane refuses before any readiness read or claim.
    if (lane === "off") {
      let decision: Decision;
      try { decision = decide(undefined); } catch (e) { return notGoverned(e); }
      if (decision.kind === "refuse" && decision.code !== "autonomy_off") return respond(403, { ok: false, refused: true, code: decision.code, capability: key, error: `${decision.message} ${NOTHING_CHANGED}` });
      return respond(403, { ok: false, refused: true, disabled: true, code: "autonomy_off", capability: key,
        error: `Hosting is switched off for this workspace in your autonomy settings. ${NOTHING_CHANGED}` });
    }

    let facts: HostingReadinessFacts;
    try { facts = await loadFacts(deps.admin, tenantId, cmd.page_id); } catch {
      return respond(503, { ok: false, code: "READINESS_UNAVAILABLE", error: `I couldn't check the page just now. ${NOTHING_CHANGED} Try again.` });
    }
    const exportBytes = action === "deploy" && pageIsPublished(facts.page) ? await deps.buildExport(facts.page ?? {}, facts.tenantSlug ?? "") : null;
    const preview = buildHostingPreview(action, facts, exportBytes);
    if (!preview) {
      const recorded = await fileAttemptRefusal("not_found");
      return respond(404, { ok: false, refused: true, code: "ARTIFACT_NOT_FOUND", error: HOSTING_REFUSALS.not_found, receipt_recorded: recorded });
    }

    // THE HONEST DORMANT STATE — before any proposal is minted. No token configuration exists
    // until the owner's service-enable decision lands (activation HELD per 88b2f756): every path
    // answers with the copy the product already shows, and no approval card is ever created while
    // the service is off.
    if (!deps.providerConfig) {
      const recorded = await fileAttemptRefusal("hosting_not_enabled");
      return respond(403, { ok: false, refused: true, disabled: true, code: "HOSTING_NOT_ENABLED", capability: key, preview,
        error: HOSTING_REFUSALS.not_enabled, receipt_recorded: recorded });
    }

    if (!previewReady(preview)) {
      const blocking = preview.checks.filter((c) => c.blocking && !c.ok).map((c) => c.label).join("; ");
      const recorded = await fileAttemptRefusal("not_ready");
      const reason = !pageIsPublished(facts.page) ? HOSTING_REFUSALS.not_published
        : action === "deploy" && !exportBytes ? HOSTING_REFUSALS.no_export
        : HOSTING_REFUSALS.nothing_to_recover;
      return respond(202, { ok: false, outcome: "not_ready", approval_required: true, capability: key, preview, error: `It isn't ready: ${blocking}. ${reason}`, receipt_recorded: recorded });
    }

    // THE CLAIM — single use, bound to this user, workspace, act and page (the publish door's
    // discipline verbatim: never a proposal this same request issued; unreadable lane never spends).
    const requestNonce = crypto.randomUUID();
    let claimedArgs: Record<string, unknown> | null | undefined;
    if (cmd.approved_fingerprint && (lane === "confirm" || lane === "auto")) {
      if (!(await stillCurrent())) {
        const recorded = await fileAttemptRefusal("workspace_changed");
        return respond(409, { ok: false, refused: true, code: "WORKSPACE_CHANGED", error: `Your workspace changed. ${NOTHING_CHANGED}`, receipt_recorded: recorded });
      }
      const now = new Date().toISOString();
      const { data: claimed, error: claimError } = await deps.admin.from("paige_pending_confirmations")
        .update({ consumed_at: now }).eq("user_id", userId).eq("tenant_id", tenantId).eq("tool_name", key)
        .eq("fingerprint", cmd.approved_fingerprint)
        .is("thread_id", null).is("scoped_client_id", null).is("consumed_at", null)
        .not("server_issued_at", "is", null).not("issued_in_request", "is", null)
        .neq("issued_in_request", requestNonce).gt("expires_at", now)
        .contains("args", { page_id: cmd.page_id }).select("args").maybeSingle();
      if (claimError) return respond(503, { ok: false, code: "APPROVAL_STORE_UNAVAILABLE", error: `I couldn't check that approval just now. ${NOTHING_CHANGED}` });
      claimedArgs = object(claimed?.args);
      if (claimedArgs) {
        const { error: retireError } = await deps.admin.from("paige_pending_confirmations")
          .update({ consumed_at: now }).eq("user_id", userId).eq("tenant_id", tenantId).eq("tool_name", key)
          .is("thread_id", null).is("scoped_client_id", null).is("consumed_at", null)
          .contains("args", { page_id: cmd.page_id });
        if (retireError) console.error("[growth-hosting-command] sibling proposals not retired", JSON.stringify({ key, reason: retireError.message ?? "unknown" }));
      }
    }

    let decision: Decision;
    try { decision = decide(claimedArgs); } catch (e) { return notGoverned(e); }
    if (decision.kind === "refuse") {
      const audited = isAttempt ? await audit(decision) : false;
      const recorded = await fileAttemptRefusal(decision.code);
      return respond(403, { ok: false, refused: true, code: decision.code, capability: key, error: `${decision.message} ${NOTHING_CHANGED}`.replace(/\s+/g, " ").trim(), audit_recorded: audited, receipt_recorded: recorded });
    }
    const audited = await audit(decision);
    if (!audited) return respond(503, { ok: false, code: "DECISION_RECEIPT_FAILED", error: `I couldn't record this decision, so I didn't go ahead. ${NOTHING_CHANGED}` });

    if (decision.kind === "propose") {
      if (cmd.approved_fingerprint) {
        return respond(409, { ok: false, refused: true, outcome: "refused", code: "APPROVAL_NOT_AVAILABLE", capability: key,
          error: `That approval was already used or has expired, so nothing ran. Review it again to ${action === "deploy" ? "put the hosted copy up" : "take it down"}.` });
      }
      if (!(await stillCurrent())) {
        const recorded = await fileAttemptRefusal("workspace_changed");
        return respond(409, { ok: false, refused: true, code: "WORKSPACE_CHANGED", error: `Your workspace changed. ${NOTHING_CHANGED}`, receipt_recorded: recorded });
      }
      const now = new Date().toISOString();
      const { data: pending, error: pendingError } = await deps.admin.from("paige_pending_confirmations").select("args")
        .eq("user_id", userId).eq("tenant_id", tenantId).eq("tool_name", key)
        .is("thread_id", null).is("scoped_client_id", null).is("consumed_at", null)
        .not("server_issued_at", "is", null).not("issued_in_request", "is", null)
        .gt("expires_at", now).contains("args", { page_id: cmd.page_id })
        .order("server_issued_at", { ascending: false }).limit(1).maybeSingle();
      if (pendingError) return respond(503, { ok: false, code: "APPROVAL_STORE_UNAVAILABLE", error: `I couldn't prepare the approval just now. ${NOTHING_CHANGED}` });
      const cycle = object(pending?.args);
      const reuse = cycle && cycle.approval_subject === requestArgs.approval_subject && cycle.expected_tenant_id === tenantId
        && typeof cycle.approval_cycle_nonce === "string" && UUID.test(cycle.approval_cycle_nonce);
      const proposalArgs = { ...requestArgs, approval_cycle_nonce: reuse ? String(cycle!.approval_cycle_nonce) : crypto.randomUUID() };
      const fingerprint = await confirmFingerprint(key, proposalArgs);
      const summary = previewSummary(preview);
      let { data: proposal, error: proposalError } = await deps.admin.from("paige_pending_confirmations").insert({
        user_id: userId, tenant_id: tenantId, thread_id: null, scoped_client_id: null, tool_name: key,
        fingerprint, issued_in_request: requestNonce, server_issued_at: now, args: proposalArgs, summary,
        expires_at: new Date(Date.now() + PROPOSAL_TTL_MS).toISOString(),
      }).select("summary,expires_at").maybeSingle();
      if (proposalError?.code === "23505") {
        const existing = await deps.admin.from("paige_pending_confirmations").select("summary,expires_at")
          .eq("user_id", userId).eq("tenant_id", tenantId).eq("tool_name", key).eq("fingerprint", fingerprint)
          .is("thread_id", null).is("scoped_client_id", null).is("consumed_at", null)
          .not("server_issued_at", "is", null).not("issued_in_request", "is", null).gt("expires_at", now).maybeSingle();
        proposal = existing.data; proposalError = existing.error;
      }
      if (proposalError || !proposal) return respond(503, { ok: false, code: "APPROVAL_STORE_UNAVAILABLE", error: `I couldn't prepare the approval just now. ${NOTHING_CHANGED}` });
      return respond(202, { ok: false, approval_required: true, outcome: "approval_required", capability: key, fingerprint,
        summary: typeof proposal.summary === "string" ? proposal.summary : summary, expires_at: proposal.expires_at, preview });
    }

    // EXECUTE — only the stored call, and only if it is exactly this act on this page here.
    const args = object(decision.args);
    const anchor = cmd.approved_fingerprint ?? `auto:${requestNonce}`;
    const approval = decision.audit.laneEffective === "confirm" ? "operator_card" : "standing_autonomy_setting";
    if (!args || args.action !== cmd.action || args.page_id !== cmd.page_id || args.expected_tenant_id !== tenantId) {
      const recorded = await fileReceipt({ outcome: "capability_refused", detail: { refused: "approval_claim_invalid" } }, anchor, approval);
      return respond(403, { ok: false, refused: true, code: "APPROVAL_CLAIM_INVALID", error: `That approval doesn't match this request, so nothing ran.`, receipt_recorded: recorded });
    }
    if (!(await stillCurrent())) {
      const recorded = await fileReceipt({ outcome: "capability_refused", detail: { refused: "workspace_changed" } }, anchor, approval);
      return respond(409, { ok: false, refused: true, code: "WORKSPACE_CHANGED", error: `Your workspace changed. ${NOTHING_CHANGED}`, receipt_recorded: recorded });
    }
    const governance = {
      actor_user_id: userId, tenant_id: tenantId, tool: key, action: cmd.action,
      approval_channel: approval, approved_fingerprint: approval === "operator_card" ? cmd.approved_fingerprint ?? null : null,
      lane_effective: decision.audit.laneEffective, decision_receipt_recorded: true,
    };
    const fetchImpl = deps.fetchImpl ?? fetch;
    const name = facts.tenantSlug && typeof facts.page?.slug === "string" ? deploymentName(facts.tenantSlug, String(facts.page.slug)) : "";

    if (action === "deploy") {
      if (!exportBytes || !name) {
        const recorded = await fileReceipt({ outcome: "capability_refused", detail: { refused: "no_export" } }, anchor, approval);
        return respond(409, { ok: false, refused: true, code: "NO_EXPORT", error: HOSTING_REFUSALS.no_export, receipt_recorded: recorded });
      }
      // The row is written BEFORE the provider call (status deploying) so an uncertain outcome is
      // always visible; it is never silently retried.
      await deps.admin.from("growth_hosted_deployments").upsert({
        tenant_id: tenantId, page_id: cmd.page_id, deployment_name: name, export_sha256: exportBytes.sha256,
        status: "deploying", url: null, verified_at: null, last_error: null, created_by: userId, updated_at: new Date().toISOString(),
      }, { onConflict: "tenant_id,page_id" });
      const result = await deployStaticSite(deps.providerConfig, {
        name, files: [{ path: "index.html", contentType: "text/html; charset=utf-8", content: exportBytes.html }],
      }, fetchImpl);
      if (!result.ok || !result.url) {
        await deps.admin.from("growth_hosted_deployments").update({ status: "failed", last_error: result.error ?? "unknown", updated_at: new Date().toISOString() })
          .eq("tenant_id", tenantId).eq("page_id", cmd.page_id);
        const recorded = await fileReceipt({ outcome: result.uncertain ? "capability_outcome_unknown" : "capability_failed", detail: { provider: result.error ?? "unknown", uncertain: result.uncertain === true } }, anchor, approval);
        await meterHostingEvent(deps.admin, tenantId, "growth_hosting_deployment", { page_id: cmd.page_id, outcome: "failed" });
        return respond(result.uncertain ? 503 : 500, { ok: false, outcome: "failed", capability: key, governance,
          error: result.uncertain ? "The provider never answered, so I can't say whether it changed. Check the page before trying again." : `It didn't deploy. ${NOTHING_CHANGED}`, receipt_recorded: recorded });
      }
      // REAL verification before any "live" claim: fetch the address, compare the bytes.
      const verification = await verifyHttpsDeployment(result.url, exportBytes.html, fetchImpl);
      const live = verification.verified;
      await deps.admin.from("growth_hosted_deployments").update({
        status: live ? "live" : "verify_failed", url: result.url,
        verified_at: live ? new Date().toISOString() : null,
        last_error: live ? null : `verify_${verification.reason ?? "failed"}`,
        updated_at: new Date().toISOString(),
      }).eq("tenant_id", tenantId).eq("page_id", cmd.page_id);
      await meterHostingEvent(deps.admin, tenantId, "growth_hosting_deployment", { page_id: cmd.page_id, outcome: live ? "deployed" : "deployed_unverified" });
      await meterHostingEvent(deps.admin, tenantId, "growth_hosting_verification", { page_id: cmd.page_id, verified: live });
      const outcome = classifyHostingOutcome("deploy", { deployed: true, verified: live });
      const recorded = await fileReceipt({ outcome, detail: { url: result.url, verified: live, reason: verification.reason ?? null } }, anchor, approval);
      return respond(200, {
        ok: true, action, page_id: cmd.page_id, capability: key, governance, receipt_recorded: recorded,
        deployed: true, verified: live, url: result.url,
        status: live ? "live" : "verify_failed",
        ...(live ? {} : { error: "It deployed, but the address didn't serve the exported bytes when checked — it is NOT called live. Re-run the check, or take it down." }),
      });
    }

    // recover
    const removed = await deleteStaticSite(deps.providerConfig, name, fetchImpl);
    const status = removed.ok && !removed.uncertain ? "removed" : "removed_unconfirmed";
    await deps.admin.from("growth_hosted_deployments").update({
      status, url: null, verified_at: null,
      last_error: removed.uncertain ? `provider_uncertain: ${removed.error ?? "unknown"}` : null,
      updated_at: new Date().toISOString(),
    }).eq("tenant_id", tenantId).eq("page_id", cmd.page_id);
    await meterHostingEvent(deps.admin, tenantId, "growth_hosting_recovery", { page_id: cmd.page_id, confirmed: !removed.uncertain });
    const outcome = classifyHostingOutcome("recover", { removed: true, uncertain: removed.uncertain === true });
    const recorded = await fileReceipt({ outcome, detail: { confirmed: !removed.uncertain, ...(removed.error ? { provider: removed.error } : {}) } }, anchor, approval);
    return respond(200, {
      ok: true, action, page_id: cmd.page_id, capability: key, governance, receipt_recorded: recorded,
      removed: true, confirmed: !removed.uncertain, status,
      ...(removed.uncertain ? { error: "The provider didn't confirm the removal — the copy is marked unconfirmed, not gone. Check before re-running." } : {}),
    });
  } catch (e) {
    console.error("[growth-hosting-command] unhandled", JSON.stringify({ reason: e instanceof Error ? e.message : String(e) }));
    return respond(500, { ok: false, code: "UNEXPECTED", error: "Something went wrong on our side. Check the page before trying again." });
  }
}
