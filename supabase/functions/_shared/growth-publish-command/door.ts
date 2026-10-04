// THE ONE PUBLISH DOOR — the executor behind `growth-publish-command`.
//
// The Studio Publish panel and Paige's chat both reach a page, form, funnel or image going live (or
// coming down) through THIS handler and nothing else. It is a domain adapter to the existing approval
// gate, built exactly like sales-invoice-command and crm-command:
//
//   authenticated user → server-derived workspace (resolveStudioCaller: owner, admin or managing
//   agency) → canonical autonomy lane (resolve_tool_autonomy) → server readiness checks → the shared
//   decision (decideDeclaredCapability) → a thread-less, server-issued proposal in
//   paige_pending_confirmations (202 + fingerprint + preview) → on the second call, an atomic
//   single-use claim of THAT proposal, bound to this user, workspace, act and artifact → the STORED
//   call runs through the existing RPC with the caller's own JWT (so _growth_admin_tenant still
//   decides authority) → a readback that proves the result → exactly one capability receipt.
//
// It invents no approval channel: the only thing that turns a confirm lane into an execution is a
// claim of a proposal this door issued. The request names an artifact; it never names a tenant that
// is honoured, an approval that is trusted, or arguments that run after approval.
//
// Dependencies are injected so the REAL handler is driven by tests with in-memory doubles: the two
// Supabase clients, and the authority decision. index.ts binds that decision exactly once —
// `decideDeclaredCapability(STUDIO_PUBLISH_KIT_BY_ACTION[key], input)`, the Spine's declaration map
// for this door, the way sales-invoice-command binds SALES_INVOICE_KIT_BY_ACTION — and
// scripts/ci/action-risk-lint.mjs refuses a door that does not. The door makes no other decision.
import { confirmFingerprint } from "../confirm-fingerprint.ts";
import type { decideDeclaredCapability } from "../capability-kit/decision.ts";
import { resolveStudioCaller, type StudioCallerRefused } from "../studio-caller.ts";
import { recordCapabilityRun, stableRunId } from "../capability-record.ts";
import { classifyStudioRun, studioReceiptDetail } from "../studio-run-outcome.ts";
import { publishVerified, PUBLISH_UNVERIFIED_ERROR } from "../artifact-receipt.ts";
import {
  buildPublishPreview, pageFormSlugsNeeded, parsePublishCommand, plainRefusal, previewReady, previewSummary,
  publishRpc, PUBLISH_KEYS, REFUSAL_CODES, UNPUBLISH_UNVERIFIED_ERROR, unpublishVerified, UUID,
  type PublishCommand, type PublishKind, type ReadinessFacts,
} from "./contract.ts";

// deno-lint-ignore no-explicit-any
type Client = any;
type DecisionInput = Parameters<typeof decideDeclaredCapability>[1];
export type PublishDecision = ReturnType<typeof decideDeclaredCapability>;
export interface PublishDoorDeps {
  /** The caller's own client (anon key + their JWT). Every RPC that decides authority runs on it. */
  caller: Client;
  /** Service-role client: the approval store, the audit row, readiness reads (tenant-filtered) and the receipt. */
  admin: Client;
  /**
   * The canonical Kit gate for one publish-door key — bound in index.ts as
   * `decideDeclaredCapability(STUDIO_PUBLISH_KIT_BY_ACTION[key], input)`. It throws for a key with no
   * declaration (or a declaration that contradicts the risk policy); the door refuses on a throw.
   */
  decide: (key: string, input: DecisionInput) => PublishDecision;
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
const NOTHING_CHANGED = "Nothing changed.";

/** The id field a Studio receipt carries for each kind (studioReceiptDetail reads these). */
const RECEIPT_ID_KEY: Readonly<Record<PublishKind, string>> = { page: "page_id", form: "form_id", funnel: "funnel_id", image: "content_id" };

async function loadFacts(admin: Client, tenantId: string, cmd: PublishCommand): Promise<ReadinessFacts> {
  const one = async (table: string, columns: string) => {
    const { data, error } = await admin.from(table).select(columns).eq("id", cmd.id).eq("tenant_id", tenantId).maybeSingle();
    if (error) throw new Error("readiness_read_failed");
    return object(data);
  };
  const facts: ReadinessFacts = { tenantSlug: null };
  if (cmd.kind !== "image") {
    const { data, error } = await admin.from("tenants").select("slug").eq("id", tenantId).maybeSingle();
    if (error) throw new Error("readiness_read_failed");
    facts.tenantSlug = typeof object(data)?.slug === "string" ? String(object(data)!.slug) : null;
  }
  if (cmd.kind === "page") {
    facts.page = await one("growth_pages", "id,tenant_id,title,slug,status,blocks_json,draft_blocks_json,draft_seo_json");
    const slugs = pageFormSlugsNeeded(facts.page);
    if (slugs.length) {
      const { data, error } = await admin.from("growth_forms").select("slug,status").eq("tenant_id", tenantId).in("slug", slugs);
      if (error) throw new Error("readiness_read_failed");
      facts.pageFormSlugs = new Set(((data ?? []) as Array<Record<string, unknown>>)
        .filter((r) => r.status !== "archived" && typeof r.slug === "string").map((r) => String(r.slug)));
    } else facts.pageFormSlugs = new Set();
  } else if (cmd.kind === "form") {
    facts.form = await one("growth_forms", "id,tenant_id,name,slug,status,schema_json,draft_schema_json,success_action_json,draft_success_action_json,auto_create_deal,pipeline_id,notify_email");
  } else if (cmd.kind === "funnel") {
    facts.funnel = await one("growth_funnels", "id,tenant_id,name,slug,status");
    if (facts.funnel) {
      const { data, error } = await admin.from("growth_funnel_steps").select("step_type,page_id,form_id").eq("funnel_id", cmd.id).eq("tenant_id", tenantId);
      if (error) throw new Error("readiness_read_failed");
      facts.funnelSteps = (data ?? []) as Array<Record<string, unknown>>;
    }
  } else {
    facts.image = await one("marketing_content", "id,tenant_id,title,kind,image_url,status");
  }
  if (cmd.action === "unpublish") facts.liveDependents = await loadLiveDependents(admin, tenantId, cmd, facts);
  return facts;
}

const named = (value: unknown, fallback: string) => typeof value === "string" && value.trim() ? value.trim().slice(0, 120) : fallback;

/** What is live and would break if this page or form came down — the unpublish RPC's own refusals. */
async function loadLiveDependents(admin: Client, tenantId: string, cmd: PublishCommand, facts: ReadinessFacts): Promise<Array<{ kind: "page" | "funnel"; name: string }>> {
  const row = cmd.kind === "page" ? facts.page : cmd.kind === "form" ? facts.form : null;
  if (!row || row.status !== (cmd.kind === "page" ? "published" : "active")) return [];
  const read = async (q: PromiseLike<{ data: unknown; error: unknown }>) => {
    const { data, error } = await q;
    if (error) throw new Error("readiness_read_failed");
    return (data ?? []) as Array<Record<string, unknown>>;
  };
  const out: Array<{ kind: "page" | "funnel"; name: string }> = [];
  const stepFunnels = new Set((await read(admin.from("growth_funnel_steps").select("funnel_id")
    .eq("tenant_id", tenantId).eq(cmd.kind === "page" ? "page_id" : "form_id", cmd.id))).map((s) => String(s.funnel_id)));
  const funnels = await read(admin.from("growth_funnels").select("id,name,entry_page_id,success_page_id").eq("tenant_id", tenantId).eq("status", "active"));
  for (const f of funnels) {
    const uses = stepFunnels.has(String(f.id)) || (cmd.kind === "page" && (f.entry_page_id === cmd.id || f.success_page_id === cmd.id));
    if (uses) out.push({ kind: "funnel", name: named(f.name, "a funnel") });
  }
  if (cmd.kind === "form" && typeof row.slug === "string" && row.slug) {
    const pages = await read(admin.from("growth_pages").select("title,blocks_json").eq("tenant_id", tenantId).eq("status", "published"));
    for (const p of pages) {
      const blocks = Array.isArray(p.blocks_json) ? p.blocks_json : [];
      if (blocks.some((b) => b && typeof b === "object" && (b as Record<string, unknown>).type === "embedded_form"
        && typeof (b as Record<string, unknown>).form_slug === "string" && String((b as Record<string, unknown>).form_slug).trim() === row.slug)) {
        out.unshift({ kind: "page", name: named(p.title, "a page") });
      }
    }
  }
  return out;
}

/** The door. Never throws: every path answers with a status and a plain sentence. */
export async function handleGrowthPublishCommand(req: Request, deps: PublishDoorDeps): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: HEADERS });
  if (req.method !== "POST") return respond(405, { ok: false, code: "METHOD_NOT_ALLOWED", error: "Use POST." });
  const { caller, admin } = deps;
  try {
    let userId: string | null = null;
    try {
      const { data, error } = await caller.auth.getUser();
      userId = !error && typeof data?.user?.id === "string" ? data.user.id : null;
    } catch { userId = null; }
    if (!userId) return respond(401, { ok: false, code: "UNAUTHENTICATED", error: "Sign in to publish. Nothing changed." });

    let cmd: PublishCommand;
    try {
      const raw = await req.text();
      if (raw.length > 4000) throw new TypeError("BODY_TOO_LARGE");
      cmd = parsePublishCommand(JSON.parse(raw));
    } catch {
      return respond(400, { ok: false, code: "GROWTH_PUBLISH_COMMAND_INVALID", error: "That publish request isn't one I can read. Nothing changed." });
    }
    const key = PUBLISH_KEYS[cmd.action][cmd.kind];

    // WHO and WHERE: the workspace the session is in, as its owner, admin or managing agency. A body
    // tenant naming any other workspace is refused, never swapped.
    const who = await resolveStudioCaller(caller, cmd.expected_tenant_id ?? null);
    if (!who.ok) {
      const refused = who as StudioCallerRefused;
      return respond(refused.status, { ok: false, refused: true, forbidden: refused.status === 403, code: refused.reason.toUpperCase(), error: refused.error.replace("Nothing was created.", NOTHING_CHANGED) });
    }
    const tenantId = who.tenantId;
    const stillCurrent = async (): Promise<boolean> => {
      const { data, error } = await caller.rpc("current_user_tenant_id");
      return !error && typeof data === "string" && data.toLowerCase() === tenantId;
    };
    const requestNonce = crypto.randomUUID();
    const idDetail = { [RECEIPT_ID_KEY[cmd.kind]]: cmd.id };
    // One receipt per executed or refused act. A proposal files none — its card is its record — and
    // neither does a stale-approval redemption, which never reached the act (and whose fingerprint
    // may already carry the original run's receipt).
    const fileReceipt = async (
      input: { result?: unknown; thrown?: unknown; threw?: boolean },
      anchor: string, approval: string | null, extra: Record<string, unknown> = {},
    ): Promise<boolean> => {
      const receipt = classifyStudioRun({ capability: key, ...input });
      if (!receipt) return false;
      return await recordCapabilityRun(admin, {
        tenantId, actorId: userId, capabilityKey: receipt.key, outcome: receipt.outcome,
        runId: await stableRunId([receipt.key, tenantId, anchor]),
        detail: { ...studioReceiptDetail({ ...idDetail, ...extra }, approval), door: "growth-publish-command", action: cmd.action, kind: cmd.kind, ...(input.threw ? {} : object(input.result)?.refused_reason ? { refused: object(input.result)!.refused_reason } : {}) },
      });
    };

    const { data: resolvedLane, error: laneError } = await caller.rpc("resolve_tool_autonomy", { _tenant_id: tenantId, _tool_key: key });
    const lane = !laneError && typeof resolvedLane === "string" && ["auto", "confirm", "off"].includes(resolvedLane) ? resolvedLane : "unresolved";
    const requestArgs: Record<string, unknown> = { action: cmd.action, kind: cmd.kind, id: cmd.id, expected_tenant_id: tenantId, approval_subject: `${cmd.action}:${cmd.kind}:${cmd.id}` };
    const decide = (claimedArgs: Record<string, unknown> | null | undefined) => deps.decide(key, {
      caller: { authenticated: true, userId, principal: "person", tenantId, tenantSource: "server", door: "other",
        access: { allowed: true, reason: "The workspace's owner, an admin, or its managing agency." } },
      capability: { id: key, effect: "mutate", outcomeChannel: "record_capability_run", availability: "needs_approval" },
      approval: { autonomyLane: lane, ...(claimedArgs !== undefined ? { claimedArgs, claimedFor: key } : {}) },
      requestArgs,
    });
    type Decision = PublishDecision;
    const audit = async (decision: Decision): Promise<boolean> => {
      const { error } = await admin.from("paige_audit_log").insert({
        actor_user_id: userId, actor_role: "studio:workspace_admin", tenant_id: tenantId,
        action: "studio.publish_governed_decision", target_type: cmd.kind, target_id: cmd.id,
        payload: { capability: key, action: cmd.action, decision: decision.kind, risk: decision.risk,
          lane_requested: decision.audit.laneRequested, lane_effective: decision.audit.laneEffective, clamped: decision.audit.clamped,
          ...(decision.kind === "refuse" ? { refusal: decision.code } : {}) },
      });
      return !error;
    };
    // A key the Kit gate cannot decide — no declaration, or one that contradicts the risk policy —
    // refuses that act, loudly, and never runs it ungoverned.
    const notGoverned = async (e: unknown): Promise<Response> => {
      console.error("[growth-publish-command] the Kit gate refused to decide", JSON.stringify({ key, reason: e instanceof Error ? e.message : String(e) }));
      const recorded = await fileReceipt({ result: { success: false, refused_reason: "capability_not_governed" } }, `refused:${requestNonce}`, null);
      return respond(503, { ok: false, refused: true, code: "CAPABILITY_NOT_GOVERNED", error: `This can't be done from here yet. ${NOTHING_CHANGED}`, receipt_recorded: recorded });
    };
    const refusedByDecision = async (decision: Extract<Decision, { kind: "refuse" }>): Promise<Response> => {
      const audited = await audit(decision);
      const recorded = await fileReceipt({ result: { success: false, refused_reason: decision.code } }, `refused:${requestNonce}`, null);
      if (decision.code === "autonomy_off") {
        return respond(403, { ok: false, refused: true, disabled: true, code: decision.code, capability: key,
          error: `${cmd.action === "publish" ? "Publishing" : "Unpublishing"} is switched off for this workspace in your autonomy settings. ${NOTHING_CHANGED}`,
          audit_recorded: audited, receipt_recorded: recorded });
      }
      return respond(403, { ok: false, refused: true, code: decision.code, capability: key, error: `${decision.message} ${NOTHING_CHANGED}`.replace(/\s+/g, " ").trim(), audit_recorded: audited, receipt_recorded: recorded });
    };

    // A brake needs no readiness read and no claim: an `off` lane refuses before either, and an
    // approval offered against it is left unspent.
    if (lane === "off") {
      let decision: Decision;
      try { decision = decide(undefined); } catch (e) { return notGoverned(e); }
      if (decision.kind === "refuse") return await refusedByDecision(decision);
      return respond(503, { ok: false, refused: true, code: "DECISION_INCONSISTENT", error: `This couldn't be checked just now. ${NOTHING_CHANGED}` });
    }

    // READINESS, from rows selected by id AND the server-derived workspace. Re-run on the approving
    // call too, before anything is claimed: if the work changed so it can no longer go live, the
    // approval is left unspent and the person sees why.
    let facts: ReadinessFacts;
    try { facts = await loadFacts(admin, tenantId, cmd); } catch {
      return respond(503, { ok: false, code: "READINESS_UNAVAILABLE", error: `I couldn't check whether it's ready just now. ${NOTHING_CHANGED} Try again.` });
    }
    const preview = buildPublishPreview(cmd.action, cmd.kind, cmd.id, facts);
    if (!preview) {
      return respond(404, { ok: false, refused: true, code: "ARTIFACT_NOT_FOUND", error: `That ${cmd.kind} isn't in this workspace. ${NOTHING_CHANGED}` });
    }
    // Nothing to approve: the same 202 approval shape the Studio panel and chat read, with the preview
    // and NO fingerprint. A blocked act never mints a proposal.
    if (!previewReady(preview)) {
      return respond(202, { ok: false, outcome: "not_ready", approval_required: true, capability: key, preview,
        error: `It isn't ready yet: ${preview.checks.filter((c) => c.blocking && !c.ok).map((c) => c.label).join("; ")}. ${NOTHING_CHANGED}` });
    }

    // THE CLAIM — single use, bound to this user, this workspace, this act (the tool key names action
    // and kind) and this artifact, and never a proposal this same request issued.
    // Only a lane that could execute spends an approval; an unreadable lane is refused below with the
    // approval left unspent.
    let claimedArgs: Record<string, unknown> | null | undefined;
    if (cmd.approved_fingerprint && (lane === "confirm" || lane === "auto")) {
      if (!(await stillCurrent())) return respond(409, { ok: false, refused: true, code: "WORKSPACE_CHANGED", error: `Your workspace changed. ${NOTHING_CHANGED}` });
      const now = new Date().toISOString();
      const { data: claimed, error: claimError } = await admin.from("paige_pending_confirmations")
        .update({ consumed_at: now }).eq("user_id", userId).eq("tenant_id", tenantId).eq("tool_name", key)
        .eq("fingerprint", cmd.approved_fingerprint)
        .is("thread_id", null).is("scoped_client_id", null).is("consumed_at", null)
        .not("server_issued_at", "is", null).not("issued_in_request", "is", null)
        .neq("issued_in_request", requestNonce).gt("expires_at", now)
        .contains("args", { id: cmd.id }).select("args").maybeSingle();
      if (claimError) return respond(503, { ok: false, code: "APPROVAL_STORE_UNAVAILABLE", error: `I couldn't check that approval just now. ${NOTHING_CHANGED}` });
      claimedArgs = object(claimed?.args);
    }

    let decision: Decision;
    try { decision = decide(claimedArgs); } catch (e) { return notGoverned(e); }
    if (decision.kind === "refuse") return await refusedByDecision(decision);
    const audited = await audit(decision);
    if (!audited) return respond(503, { ok: false, code: "DECISION_RECEIPT_FAILED", error: `I couldn't record this decision, so I didn't go ahead. ${NOTHING_CHANGED}` });

    if (decision.kind === "propose") {
      // An approval was offered and nothing backed it: used, expired, another person's, another
      // workspace's or another artifact's. Say so; minting a fresh card on a click would turn a
      // stale approval into a new question the person never asked.
      if (cmd.approved_fingerprint) {
        return respond(409, { ok: false, refused: true, outcome: "refused", code: "APPROVAL_NOT_AVAILABLE", capability: key,
          error: `That approval was already used or has expired, so nothing ran. Review it again to ${cmd.action}.` });
      }
      if (!(await stillCurrent())) return respond(409, { ok: false, refused: true, code: "WORKSPACE_CHANGED", error: `Your workspace changed. ${NOTHING_CHANGED}` });
      const now = new Date().toISOString();
      // Reuse a live proposal for this exact act and artifact, so asking twice shows one card. A
      // consumed fingerprint can never become authority again: each cycle carries a fresh nonce.
      const { data: pending, error: pendingError } = await admin.from("paige_pending_confirmations").select("args")
        .eq("user_id", userId).eq("tenant_id", tenantId).eq("tool_name", key)
        .is("thread_id", null).is("scoped_client_id", null).is("consumed_at", null)
        .not("server_issued_at", "is", null).not("issued_in_request", "is", null)
        .gt("expires_at", now).contains("args", { id: cmd.id })
        .order("server_issued_at", { ascending: false }).limit(1).maybeSingle();
      if (pendingError) return respond(503, { ok: false, code: "APPROVAL_STORE_UNAVAILABLE", error: `I couldn't prepare the approval just now. ${NOTHING_CHANGED}` });
      const cycle = object(pending?.args);
      const reuse = cycle && cycle.approval_subject === requestArgs.approval_subject && cycle.expected_tenant_id === tenantId
        && typeof cycle.approval_cycle_nonce === "string" && UUID.test(cycle.approval_cycle_nonce);
      const proposalArgs = { ...requestArgs, approval_cycle_nonce: reuse ? String(cycle!.approval_cycle_nonce) : crypto.randomUUID() };
      const fingerprint = await confirmFingerprint(key, proposalArgs);
      const summary = previewSummary(preview);
      let { data: proposal, error: proposalError } = await admin.from("paige_pending_confirmations").insert({
        user_id: userId, tenant_id: tenantId, thread_id: null, scoped_client_id: null, tool_name: key,
        fingerprint, issued_in_request: requestNonce, server_issued_at: now, args: proposalArgs, summary,
        expires_at: new Date(Date.now() + PROPOSAL_TTL_MS).toISOString(),
      }).select("summary,expires_at").maybeSingle();
      if (proposalError?.code === "23505") {
        const existing = await admin.from("paige_pending_confirmations").select("summary,expires_at")
          .eq("user_id", userId).eq("tenant_id", tenantId).eq("tool_name", key).eq("fingerprint", fingerprint)
          .is("thread_id", null).is("scoped_client_id", null).is("consumed_at", null)
          .not("server_issued_at", "is", null).not("issued_in_request", "is", null).gt("expires_at", now).maybeSingle();
        proposal = existing.data; proposalError = existing.error;
      }
      if (proposalError || !proposal) return respond(503, { ok: false, code: "APPROVAL_STORE_UNAVAILABLE", error: `I couldn't prepare the approval just now. ${NOTHING_CHANGED}` });
      return respond(202, { ok: false, approval_required: true, outcome: "approval_required", capability: key, fingerprint,
        summary: typeof proposal.summary === "string" ? proposal.summary : summary, expires_at: proposal.expires_at, preview });
    }

    // EXECUTE — only the stored call, and only if it is exactly this act on this artifact here.
    const args = object(decision.args);
    const anchor = cmd.approved_fingerprint ?? `auto:${requestNonce}`;
    const approval = decision.audit.laneEffective === "confirm" ? "operator_card" : "standing_autonomy_setting";
    if (!args || args.action !== cmd.action || args.kind !== cmd.kind || args.id !== cmd.id || args.expected_tenant_id !== tenantId) {
      const recorded = await fileReceipt({ result: { success: false, refused_reason: "approval_claim_invalid" } }, anchor, approval);
      return respond(403, { ok: false, refused: true, code: "APPROVAL_CLAIM_INVALID", error: `That approval doesn't match this request, so nothing ran.`, receipt_recorded: recorded });
    }
    if (!(await stillCurrent())) {
      const recorded = await fileReceipt({ result: { success: false, refused_reason: "workspace_changed" } }, anchor, approval);
      return respond(409, { ok: false, refused: true, code: "WORKSPACE_CHANGED", error: `Your workspace changed. ${NOTHING_CHANGED}`, receipt_recorded: recorded });
    }
    const governance = {
      actor_user_id: userId, tenant_id: tenantId, tool: key, action: cmd.action, kind: cmd.kind,
      approval_channel: approval, approved_fingerprint: approval === "operator_card" ? cmd.approved_fingerprint ?? null : null,
      lane_effective: decision.audit.laneEffective, decision_receipt_recorded: true,
    };

    let data: unknown = null, error: { code?: unknown; message?: unknown } | null = null;
    try {
      // The caller's own client: _growth_admin_tenant inside the RPC decides authority again.
      const reply = await caller.rpc(publishRpc(cmd.action, cmd.kind), { p_tenant_id: null, p_id: String(args.id) });
      data = reply?.data ?? null; error = reply?.error ?? null;
    } catch (e) {
      error = { message: e instanceof Error ? e.message : String(e) };
    }
    if (error) {
      const code = typeof error.code === "string" ? error.code : "";
      const recorded = await fileReceipt({ thrown: error, threw: true }, anchor, approval);
      if (code && REFUSAL_CODES.has(code)) {
        return respond(code === "42501" ? 403 : 409, { ok: false, refused: true, outcome: "refused", capability: key, governance,
          error: plainRefusal(error.message, cmd.action), receipt_recorded: recorded });
      }
      if (code) {
        return respond(500, { ok: false, outcome: "failed", capability: key, governance,
          error: cmd.action === "publish" ? `It didn't go live. ${NOTHING_CHANGED}` : "It couldn't be taken down. It's still live.", receipt_recorded: recorded });
      }
      return respond(503, { ok: false, outcome: "outcome_unknown", capability: key, governance,
        error: "The answer never came back, so I can't say whether it changed. Check the project before trying again.", receipt_recorded: recorded });
    }

    const row = object(data) ?? {};
    const verified = cmd.action === "publish" ? publishVerified(cmd.kind, data) : unpublishVerified(cmd.kind, cmd.id, data);
    if (!verified) {
      const recorded = await fileReceipt({ result: { success: false, outcome: "unverified" } }, anchor, approval,
        typeof row.status === "string" ? { status: row.status } : {});
      return respond(200, { ok: false, outcome: "unverified", action: cmd.action, kind: cmd.kind, id: cmd.id, capability: key, governance,
        ...(typeof row.status === "string" ? { status: row.status } : {}),
        error: cmd.action === "publish" ? PUBLISH_UNVERIFIED_ERROR : UNPUBLISH_UNVERIFIED_ERROR, receipt_recorded: recorded });
    }
    const recorded = await fileReceipt({ result: { success: true } }, anchor, approval, { status: String(row.status) });
    return respond(200, {
      ok: true, action: cmd.action, kind: cmd.kind, id: cmd.id, status: row.status,
      ...(cmd.action === "publish" ? { published_at: row.published_at, url: row.url } : {}),
      capability: key, governance, receipt_recorded: recorded,
    });
  } catch (e) {
    console.error("[growth-publish-command] unhandled", JSON.stringify({ reason: e instanceof Error ? e.message : String(e) }));
    return respond(500, { ok: false, code: "UNEXPECTED", error: "Something went wrong on our side. Check the project before trying again." });
  }
}
