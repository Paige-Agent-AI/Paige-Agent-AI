import { commsProviderExecutionAllowed, COMMS_PROVIDER_EXECUTION_DISABLED } from "../_shared/comms-provider-boundary.ts";
// deno-lint-ignore-file no-explicit-any
// EXECUTES a `paige_skills` recipe (concept 1 in docs/doctrine/skills-vocabulary.md) — NOT
// a `paige_subagents` specialist (that's `delegate_to_subagent`) and NOT a `marketplace_items`
// add-on (that's the Marketplace). Dispatch is currently a switch(skill.slug); the S1b
// steps-interpreter generalizes it. See docs/doctrine/skills-vocabulary.md before editing.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

import { gatewayCompat } from "../_shared/claude.ts";
import { platformOperatorTenantId } from "../_shared/platform-operator-tenant.ts";
import { forge } from "../_shared/prompt-forge.ts";
import { interpretSkill } from "../_shared/skill-interpreter.ts";
import { shouldUseInterpreter, browserToolAllowed, type SkillRow, type CallerTier, type BrowseResult, type PublicBrowseResult } from "../_shared/skill-interpreter-core.ts";
import {
  resolveSecureBrowserAuthority,
  secureBrowserNeedsAdminConfirmation,
  type SecureBrowserAuthority,
} from "../_shared/secure-browser-authority.ts";
// THE ONE GOVERNED PATHWAY — the direct Edge route enforces the governed truth ITSELF, never trusting
// an upstream caller (Chat/MCP). decideSkillRun re-resolves authority/tenancy/access/classification
// server-side and refuses a spoofed or cross-tenant or unattended-service attempt (§9/§14/§59/§67).
import {
  decideSkillRun,
  skillGovernedAuditRow,
  SKILL_DEFAULT_LANE,
} from "../_shared/paige-skill/governed-adapter.ts";
// The external-SEND skill (draft_and_email_document) additionally requires a durable, single-use,
// fingerprint-bound approval — reusing the canonical paige_pending_confirmations table + the
// confirm-fingerprint pattern (§18), never a parallel approval system.
import {
  governedDraftAndEmail,
  type EmailProposalArgs,
} from "../_shared/paige-skill/email-approval.ts";
import { confirmFingerprint } from "../_shared/confirm-fingerprint.ts";
import { classifyBusinessVerifyResponse } from "../_shared/business-verify-outcome.ts";
import { CLIENT_CONTACT_METHODS_EMBED, withPrimaryAddresses } from "../_shared/contact-methods.ts";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

/**
 * S1b — the HOST implementation of the interpreter's injected `browse` seam (§18: the core stays pure;
 * the outbound fetch lives here, in the host that already does outbound fetches). Calls the paige-browser
 * /self-verify contract. §34 — references ONLY the env NAMES; when either is unset it degrades honestly
 * to { needs_config:true } (§13), never a fabricated observation. paige-browser always answers HTTP 200
 * with a structured observation (ok:false on failure), so a non-ok body is passed through as an honest
 * failed observation, not swallowed.
 */
// ACTIVATED 2026-08-12: the Fly host is live (paige-browser.fly.dev) and PAIGE_BROWSER_URL /
// PAIGE_BROWSER_SECRET are set as edge secrets. This redeploy is what makes skill-runner read them —
// the seam transitions from needs_config → live calling the host on the next self-verify skill run.
async function browseViaHost(args: { url: string; steps?: unknown[]; waitForSelector?: string; waitMs?: number }): Promise<BrowseResult> {
  const base = Deno.env.get("PAIGE_BROWSER_URL");
  const secret = Deno.env.get("PAIGE_BROWSER_SECRET");
  if (!base || !secret) return { needs_config: true };
  try {
    const res = await fetch(`${base.replace(/\/+$/, "")}/self-verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Browser-Secret": secret },
      body: JSON.stringify({
        url: args.url,
        steps: args.steps ?? undefined,
        waitForSelector: args.waitForSelector,
        waitMs: args.waitMs,
      }),
    });
    // paige-browser answers 200 with { ok, ... } even on failure; return the parsed observation as-is.
    return await res.json();
  } catch (e) {
    // A network throw is an HONEST failed observation (§13) — never a fabricated success.
    return { ok: false, url: args.url, error: (e as Error)?.message ?? "browse fetch failed" };
  }
}

/**
 * S3b — the HOST implementation of the interpreter's injected `browsePublic` seam (§18: a SECOND browse
 * contract distinct from browseViaHost). Calls paige-browser's /browse-public-url (arbitrary public-URL
 * research). §34 — references ONLY the env NAMES; when either is unset it degrades honestly to
 * { needs_config:true } (§13). D4 — a HARD 30s per-call timeout (AbortController) with a SINGLE retry on
 * a 5xx or a timeout/network throw (short backoff), so a transient host hiccup doesn't fail a legit
 * research call while a real block/failure still returns its honest structured body. paige-browser
 * answers HTTP 200 with { ok, blocked_reason, ... } even on a guarded/failed fetch, so a non-ok body is
 * passed through as an honest observation, never swallowed. The audit row is written by the CALLER
 * (interpretSkill via service_role) — this host holds no DB creds and writes nothing (§9/§34).
 */
const PUBLIC_BROWSE_TIMEOUT_MS = 30_000; // D4 — hard per-call ceiling
async function browsePublicViaHost(args: { url: string; waitForSelector?: string; maxContentBytes?: number }): Promise<PublicBrowseResult> {
  const base = Deno.env.get("PAIGE_BROWSER_URL");
  const secret = Deno.env.get("PAIGE_BROWSER_SECRET");
  if (!base || !secret) return { needs_config: true };
  const endpoint = `${base.replace(/\/+$/, "")}/browse-public-url`;
  const payload = JSON.stringify({
    url: args.url,
    waitForSelector: args.waitForSelector,
    maxContentBytes: args.maxContentBytes,
  });

  const attempt = async (): Promise<{ status: number; body: any } | { throwErr: Error }> => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), PUBLIC_BROWSE_TIMEOUT_MS);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Browser-Secret": secret },
        body: payload,
        signal: ctrl.signal,
      });
      const body = await res.json().catch(() => ({}));
      return { status: res.status, body };
    } catch (e) {
      return { throwErr: e as Error };
    } finally {
      clearTimeout(timer);
    }
  };

  // First try; retry ONCE on a 5xx, a 429 busy (§39 peer-gate L1 — a MAX_CONCURRENT spike is transient,
  // not a real block), or a timeout/network throw (§13 — a transient hiccup, not a real block).
  let r = await attempt();
  const transient = "throwErr" in r || (r as { status: number }).status >= 500 || (r as { status: number }).status === 429;
  if (transient) {
    await new Promise((res) => setTimeout(res, 400)); // short backoff
    r = await attempt();
  }
  if ("throwErr" in r) {
    // Both attempts threw/timed out — an HONEST failed observation (§13), never a fabricated success.
    const msg = r.throwErr?.name === "AbortError" ? `public-browse timed out after ${PUBLIC_BROWSE_TIMEOUT_MS}ms` : (r.throwErr?.message ?? "public-browse fetch failed");
    return { ok: false, url: args.url, error: msg };
  }
  if (r.status >= 500) {
    return { ok: false, url: args.url, http_status: r.status, error: `public-browse host ${r.status}` };
  }
  // 200 (allowed OR blocked) — pass the structured body through as-is (it already carries ok/blocked_reason).
  return r.body as PublicBrowseResult;
}

interface RunRequest {
  skill_slug: string;
  contact_id?: string;
  inputs?: Record<string, unknown>;
  invoker_kind?: "admin" | "coach" | "paige" | "system" | "mcp";
  invoker_user_id?: string;
  confirm_token?: string;
  // ── S1b interpreter fields (all OPTIONAL → backward-compatible with every existing caller, §37) ──
  /** Server-resolved tenant for the interpreter's forge (never a body-trusted auth claim, §9). */
  tenant_id?: string;
  /** Caller's §51/§60 tier, when the caller resolved it — enables the interpreter's server-side tier belt. */
  caller_tier?: CallerTier;
  /** Route a KNOWN (bespoke) slug through the interpreter too — ONLY for Slice 3's diff proof. Default false. */
  force_interpreter?: boolean;
}

async function resolveBrowserAuthority(req: Request, body: RunRequest, admin: any): Promise<SecureBrowserAuthority> {
  const authHeader = req.headers.get("Authorization") ?? "";
  const presented = authHeader.replace(/^Bearer\s+/i, "").trim();
  return await resolveSecureBrowserAuthority(
    {
      bearerToken: presented,
      serviceKey: SERVICE_KEY,
      contactId: body.contact_id,
      tenantHint: body.tenant_id,
      invokerUserId: body.invoker_user_id,
    },
    {
      authenticate: async (token) => {
        const { data, error } = await admin.auth.getUser(token);
        return error || !data.user ? null : data.user.id;
      },
      resolveActiveTenant: async (actorUserId) => {
        const { data, error } = await admin.from("profiles").select("active_tenant_id").eq("user_id", actorUserId).maybeSingle();
        return error || !data?.active_tenant_id ? null : String(data.active_tenant_id);
      },
      resolveContactTenant: async (contactId, tenantId) => {
        let query = admin.from("clients").select("tenant_id").eq("id", contactId);
        if (tenantId) query = query.eq("tenant_id", tenantId);
        const { data, error } = await query.maybeSingle();
        return error || !data?.tenant_id ? null : String(data.tenant_id);
      },
      isPlatformOwner: async (actorUserId) => {
        const { data, error } = await admin.rpc("is_platform_owner", { _user_id: actorUserId });
        return !error && data === true;
      },
      resolvePlatformOperatorTenant: async () => await platformOperatorTenantId(admin),
      isTenantAdmin: async (actorUserId, tenantId) => {
        const { data, error } = await admin.rpc("is_tenant_admin_as", { _actor: actorUserId, _tenant: tenantId });
        return !error && data === true;
      },
      canAgencyManage: async (actorUserId, tenantId) => {
        const { data, error } = await admin.rpc("agency_can_manage_child", { _child: tenantId, _actor: actorUserId });
        return !error && data === true;
      },
    },
  );
}

/**
 * The CALLER of a skill run, resolved SERVER-SIDE — this route never trusts an upstream caller to have
 * governed the call. The acting tenant, the actor, and the authority all come from the verified JWT
 * (or an explicitly-trusted internal service credential), NEVER from `body.tenant_id`, `body.contact_id`,
 * or `body.invoker_kind`.
 */
interface SkillCaller {
  authenticated: boolean;
  principal: "person" | "service";
  userId: string | null;
  tenantId: string | null;
  access: { allowed: boolean; reason?: string };
  /** JWT-derived: platform owner / tenant admin / agency manager of the RESOLVED tenant. This — never
   *  `body.invoker_kind` — is what lets a caller skip the first-run admin-confirmation gate. */
  isApprovingAuthority: boolean;
  /** A provenance label for the run row / interpreter actorRole. Not an authority. */
  actorRole: string | null;
}

async function resolveSkillCaller(
  req: Request,
  body: RunRequest,
  admin: any,
  browserAuthority: SecureBrowserAuthority | null,
): Promise<SkillCaller> {
  // A browser skill already resolved a HUMAN owner/admin/agency actor + tenant server-side
  // (resolveSecureBrowserAuthority threw otherwise). Reuse it verbatim — do NOT re-derive #1046's
  // browser-authority logic.
  if (browserAuthority) {
    return {
      authenticated: true,
      principal: "person",
      userId: browserAuthority.actorUserId,
      tenantId: browserAuthority.tenantId,
      access: { allowed: true },
      isApprovingAuthority: true,
      actorRole: browserAuthority.actorRole,
    };
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const presented = authHeader.replace(/^Bearer\s+/i, "").trim();

  // A TRUSTED INTERNAL caller (paige-mcp, a sibling edge fn, a CI harness) authenticates with the
  // platform service-role key — infrastructure, not a person. principal:"service"; the governed seam
  // then refuses it from making this `high` change on its own (§14/§67 — a machine credential is
  // nobody's yes), which is also what stops an unattended run impersonating a person. Its
  // already-resolved tenant is honored for SCOPING only. A JWT caller cannot reach this branch: they
  // do not hold the service-role key.
  if (SERVICE_KEY.length > 0 && presented === SERVICE_KEY) {
    return {
      authenticated: true,
      principal: "service",
      userId: body.invoker_user_id ?? null,
      tenantId: body.tenant_id ?? null,
      access: { allowed: true },
      isApprovingAuthority: false,
      actorRole: body.invoker_kind ?? "system",
    };
  }

  // A real JWT. Derive the acting identity + tenant SERVER-SIDE. Never the body, never the contact.
  let actorUserId: string | null = null;
  try {
    const { data } = await admin.auth.getUser(presented);
    actorUserId = data?.user?.id ?? null;
  } catch { actorUserId = null; }
  if (!actorUserId) {
    return {
      authenticated: false, principal: "person", userId: null, tenantId: null,
      access: { allowed: false, reason: "No verified session behind this request." },
      isApprovingAuthority: false, actorRole: null,
    };
  }

  // Active tenant from the caller's OWN profile (mirrors current_user_tenant_id()); a platform owner
  // with no active tenant falls back to the operator workspace, exactly as the browser path does.
  let tenantId: string | null = null;
  try {
    const { data: prof } = await admin.from("profiles").select("active_tenant_id").eq("user_id", actorUserId).maybeSingle();
    tenantId = prof?.active_tenant_id ? String(prof.active_tenant_id) : null;
  } catch { /* resolved below / left null */ }
  let platformOwner = false;
  try {
    const { data } = await admin.rpc("is_platform_owner", { _user_id: actorUserId });
    platformOwner = data === true;
  } catch { platformOwner = false; }
  if (!tenantId && platformOwner) tenantId = await platformOperatorTenantId(admin);
  if (!tenantId) {
    return {
      authenticated: true, principal: "person", userId: actorUserId, tenantId: null,
      access: { allowed: false, reason: "No workspace resolved for this account." },
      isApprovingAuthority: false, actorRole: null,
    };
  }

  // Is the caller an APPROVING AUTHORITY for THIS resolved tenant? This — not body.invoker_kind — is
  // the first-run confirm-bypass authority.
  let tenantAdmin = false;
  let agencyManager = false;
  try {
    const [a, b] = await Promise.all([
      admin.rpc("is_tenant_admin_as", { _actor: actorUserId, _tenant: tenantId }),
      admin.rpc("agency_can_manage_child", { _child: tenantId, _actor: actorUserId }),
    ]);
    tenantAdmin = a?.data === true;
    agencyManager = b?.data === true;
  } catch { /* default false — a failed authority check never grants authority */ }
  const isApprovingAuthority = platformOwner || tenantAdmin || agencyManager;
  return {
    authenticated: true,
    principal: "person",
    userId: actorUserId,
    tenantId,
    // An authenticated member of their OWN resolved tenant may run skills — the pre-existing posture
    // (any authenticated tenant user could invoke), now with the acting tenant server-derived. The
    // governed gate + the §9 contact/business scoping + the per-skill approval provide the real
    // protection; a stricter staff-only access policy is a separate §51 decision, out of this slice.
    access: { allowed: true },
    isApprovingAuthority,
    // 'admin' | 'member' — both non-operator, which the interpreter's provenance gate requires.
    actorRole: isApprovingAuthority ? "admin" : "member",
  };
}

/** Write ONE governed-decision row to paige_audit_log (service-role). The only trace of a refused
 *  run, since a refusal writes NO paige_skill_runs row. Non-fatal — a logging failure never changes
 *  the decision. */
async function writeGovernedSkillAudit(
  admin: any, caller: SkillCaller, audit: ReturnType<typeof decideSkillRun>["audit"],
): Promise<void> {
  try {
    const row = skillGovernedAuditRow(audit);
    await admin.from("paige_audit_log").insert({
      actor_user_id: caller.userId,
      actor_role: `skill:${caller.principal}`,
      ...row,
    });
  } catch (e) {
    console.error("skill-runner governed audit not recorded", String(e));
  }
}

/** SHA-256 hex — binds an approval to the EXACT drafted bytes. */
async function sha256Hex(s: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * THE HOST WIRING for the external-SEND skill. Resolves the contact SCOPED to the caller's tenant,
 * then drives the pure `governedDraftAndEmail` flow with real deps (LLM draft, get_tenant_sender, the
 * canonical confirm fingerprint, a single-use claim against paige_pending_confirmations, Resend, and
 * the durable receipt). Every branch below is one of the pure module's outcomes — the I/O lives here,
 * the decision lives there, so the whole matrix is unit-tested without this runtime.
 */
async function runDraftAndEmailDocument(
  body: RunRequest,
  admin: any,
  skill: any,
  callerTenantId: string,
  skillCaller: SkillCaller,
  requestNonce: string,
): Promise<Response> {
  const json = (status: number, payload: Record<string, unknown>) =>
    new Response(JSON.stringify(payload), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const contactId = body.contact_id ?? null;
  if (!contactId) return json(400, { status: "failed", error: "contact_id required" });
  if (!skillCaller.userId) return json(403, { status: "refused", code: "unauthenticated", error: "This action needs a signed-in person behind it." });
  if (!await commsProviderExecutionAllowed(admin, { tenantId: callerTenantId, actorUserId: skillCaller.userId })) return json(403, { status: "refused", code: COMMS_PROVIDER_EXECUTION_DISABLED });

  // §9 — look up the contact SCOPED to the caller's resolved tenant. A cross-tenant contact_id returns
  // nothing, which the pure flow then denies before any draft or send.
  // The draft goes to the contact's PRIMARY email.
  const { data: contactRow } = await admin
    .from("clients").select(`id, first_name, last_name, tenant_id, ${CLIENT_CONTACT_METHODS_EMBED}`)
    .eq("id", contactId).eq("tenant_id", callerTenantId).maybeSingle();
  const contact = withPrimaryAddresses(contactRow);

  const docType = (body.inputs?.doc_type as string) ?? "summary";
  const prompt = (body.inputs?.prompt as string) ?? "";

  let sentRunId: string | null = null;
  // Whether the durable run receipt actually persisted. A successful SEND whose receipt write fails
  // must not be reported as a clean success (§13/§32/AGENTS.md — no completed action without its receipt).
  let receiptPersisted = false;

  const outcome = await governedDraftAndEmail(
    {
      tenantId: callerTenantId,
      userId: skillCaller.userId,
      contactId,
      recipientEmail: (contact?.email as string) ?? null,
      contactTenantId: (contact?.tenant_id as string) ?? null,
      recipientName: contact ? `${contact.first_name ?? ""} ${contact.last_name ?? ""}`.trim() : undefined,
      docType,
      prompt,
      confirmToken: body.confirm_token,
      requestNonce,
    },
    {
      draft: async ({ docType, prompt, recipientName }) => {
        const ai = await gatewayCompat("anthropic", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "google/gemini-2.5-flash",
            messages: [
              { role: "system", content: `You are Paige. Draft a professional client ${docType} in HTML (no <html>/<body> wrapper). Keep tone confident, plainspoken, compliance-safe.` },
              { role: "user", content: `Client: ${recipientName ?? ""}\n\nRequest:\n${prompt}` },
            ],
          }),
        });
        const aiData = await ai.json();
        const inner = aiData?.choices?.[0]?.message?.content ?? "";
        // Return the FINAL bytes that will be sent, so the fingerprint binds exactly what ships.
        return `<div style="font-family:Inter,sans-serif;max-width:640px;margin:0 auto;padding:24px">${inner}</div>`;
      },
      resolveSender: async (tenantId) => {
        const { data: senderRow } = await admin.rpc("get_tenant_sender", { _tenant_id: tenantId });
        const sRow = Array.isArray(senderRow) ? senderRow[0] : senderRow;
        return {
          fromName: sRow?.from_name || "Paige",
          fromEmail: sRow?.from_email || "notify@mail.paigeagent.ai",
        };
      },
      fingerprint: confirmFingerprint,
      sha256Hex,
      recordProposal: async (row) => {
        try {
          const { error } = await admin.from("paige_pending_confirmations").insert({
            user_id: row.userId,
            tenant_id: row.tenantId,
            thread_id: null,
            scoped_client_id: row.contactId,
            tool_name: "draft_and_email_document",
            fingerprint: row.fingerprint,
            issued_in_request: row.requestNonce,
            server_issued_at: new Date().toISOString(),
            args: row.args,
            summary: row.summary,
          });
          if (error) return error.code === "23505" ? "exists" : "failed";
          return "created";
        } catch (e) {
          console.error("skill-runner draft_and_email proposal not recorded", String(e));
          return "failed";
        }
      },
      claimProposal: async ({ userId, tenantId, fingerprint, requestNonce }) => {
        try {
          // ATOMIC single-use: the compare-and-set on consumed_at is the replay/forge guard. A
          // second claim of the same fingerprint after consumption matches nothing → null → denied.
          // The minting-request exclusion mirrors the canonical mechanism (20261026000000).
          const { data, error } = await admin.from("paige_pending_confirmations")
            .update({ consumed_at: new Date().toISOString() })
            .eq("user_id", userId)
            .eq("tenant_id", tenantId)
            .eq("fingerprint", fingerprint)
            .eq("tool_name", "draft_and_email_document")
            .is("consumed_at", null)
            .gt("expires_at", new Date().toISOString())
            .not("server_issued_at", "is", null)
            .neq("issued_in_request", requestNonce)
            .not("issued_in_request", "is", null)
            .select("args")
            .maybeSingle();
          if (error) {
            console.error("skill-runner draft_and_email claim failed", String(error.code ?? error));
            return null;
          }
          const args = (data as { args?: unknown } | null)?.args;
          return args && typeof args === "object" && !Array.isArray(args) ? args as EmailProposalArgs : null;
        } catch (e) {
          console.error("skill-runner draft_and_email claim threw", String(e));
          return null;
        }
      },
      send: async ({ fromHeader, to, subject, html }) => {
        const resendKey = Deno.env.get("RESEND_API_KEY");
        if (!resendKey) return { ok: false, id: null };
        try {
          const emailRes = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: { "Authorization": `Bearer ${resendKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({ from: fromHeader, to: [to], subject, html }),
          });
          const emailData = await emailRes.json().catch(() => ({}));
          return { ok: emailRes.ok, id: (emailData as { id?: string })?.id ?? null };
        } catch (e) {
          console.error("skill-runner draft_and_email send threw", String(e));
          return { ok: false, id: null };
        }
      },
      recordReceipt: async (r) => {
        // The durable, readable execution receipt — written at most once per approval (only after a
        // successful single-use claim). communication_log is the client-facing send record; the
        // paige_skill_runs row is the run receipt.
        const status = r.ok ? "succeeded" : "failed";
        const { data: runRow, error: runErr } = await admin.from("paige_skill_runs").insert({
          skill_id: skill.id,
          skill_slug: "draft_and_email_document",
          contact_id: r.contact_id,
          invoker_kind: body.invoker_kind ?? "admin",
          invoker_user_id: skillCaller.userId,
          // §13 — record the APPROVED inputs from the claimed proposal, NOT `body.inputs` (the redemption
          // request). A phase-2 caller can redeem a valid token with altered/empty doc_type/prompt; the
          // email is sent from the stored claim, so the receipt must describe the claim, not the redemption.
          inputs: { doc_type: r.doc_type, contact_id: r.contact_id, content_sha256: r.content_sha256 },
          status,
          steps_log: [{ step: "draft", ok: true }, { step: "send", ok: r.ok, id: r.resendId }],
          outputs: { resend_id: r.resendId, recipient: r.recipient },
          completed_at: new Date().toISOString(),
        }).select("id").maybeSingle();
        sentRunId = (runRow as { id?: string } | null)?.id ?? null;
        // §13/§32/AGENTS.md — the receipt write is CHECKED, not swallowed. The email already went out
        // (consume-then-execute), so we cannot un-send; but a failed receipt write must surface (the
        // caller is told the send is unrecorded), never a clean success with a null run id.
        receiptPersisted = !runErr && sentRunId !== null;
        if (!receiptPersisted) {
          // Honest about whether the send actually happened — this runs for BOTH a successful send
          // (sent-but-unrecorded) and a failed send (failed-and-unrecorded); never claim "sent".
          console.error(
            `skill-runner draft_and_email receipt NOT persisted (send ok=${r.ok})`,
            String(runErr?.code ?? runErr ?? "no row returned"),
          );
        }
        // §13 — only record a client-facing OUTBOUND communication when the send actually succeeded.
        // A failed/never-sent email (e.g. no RESEND_API_KEY) must NOT appear in the client's comm
        // history as though it went out; the failed run is still recorded on paige_skill_runs above.
        if (r.ok) {
          const { error: commErr } = await admin.from("communication_log").insert({
            client_id: r.contact_id,
            channel: "email",
            direction: "outbound",
            subject: r.subject,
            body: r.html,
            metadata: { source: "skill:draft_and_email_document", resend_id: r.resendId, run_id: sentRunId },
          });
          // Secondary record; a failure is logged, never swallowed (Codex P1) — the primary receipt is
          // paige_skill_runs above.
          if (commErr) console.error("skill-runner draft_and_email communication_log not recorded", String(commErr.code ?? commErr));
        }
        await admin.from("paige_skills")
          .update({ run_count: skill.run_count + 1, success_count: skill.success_count + (r.ok ? 1 : 0) })
          .eq("id", skill.id);
      },
    },
  );

  if (outcome.kind === "denied") {
    // No run row, no send, no success receipt. Audited for forensics (non-fatal).
    admin.from("paige_audit_log").insert({
      actor_user_id: skillCaller.userId,
      actor_role: `skill:${skillCaller.principal}`,
      action: "skill_run_email_denied",
      tenant_id: callerTenantId,
      target_type: "paige_skill",
      target_id: null,
      payload: { skill_slug: "draft_and_email_document", code: outcome.code, contact_id: contactId },
    }).then(() => {}).catch(() => {});
    return json(403, { status: "refused", code: outcome.code, error: outcome.message });
  }

  if (outcome.kind === "awaiting_confirm") {
    const { data: run } = await admin.from("paige_skill_runs").insert({
      skill_id: skill.id,
      skill_slug: "draft_and_email_document",
      contact_id: contactId,
      invoker_kind: body.invoker_kind ?? "admin",
      invoker_user_id: skillCaller.userId,
      inputs: body.inputs ?? {},
      status: "awaiting_confirm",
      outputs: { confirm_fingerprint: outcome.confirm_fingerprint },
    }).select("id").maybeSingle();
    return json(200, {
      run_id: (run as { id?: string } | null)?.id ?? null,
      status: "awaiting_confirm",
      requires_operator_approval: true,
      confirm_fingerprint: outcome.confirm_fingerprint,
      confirm_summary: outcome.summary,
      message: "Drafted. Re-run this skill with this confirm_token to send it once; the approval is single-use.",
    });
  }

  if (outcome.kind === "send_failed") {
    // §13 — the approval was consumed but the email did NOT go out. Never a 200/"succeeded": the
    // durable paige_skill_runs row was written `failed` and no communication_log outbound record was
    // created, and the caller must hear the same truth. 502 (the upstream send / sender identity
    // failed, not a client error) so a caller checking HTTP status also sees the failure — matching
    // the old inline handler, which threw on a failed send. The one-time approval is spent.
    // If the FAILURE receipt ALSO could not persist (§13/§32/AGENTS.md), say so in the same breath —
    // the caller must know the audit row is missing whichever way the send went (Codex P2).
    return json(502, {
      run_id: sentRunId,
      status: "failed",
      code: receiptPersisted ? "send_failed" : "send_failed_unrecorded",
      error: receiptPersisted
        ? "The document was drafted and approved, but the email send failed. The one-time approval has been used — re-draft to send again."
        : "The email send failed AND its failure receipt could not be recorded (the audit row is missing). The one-time approval has been used — re-draft to send again.",
      outputs: { resend_id: outcome.resend_id, recipient: outcome.recipient },
    });
  }

  // sent — but if the durable receipt did not persist (§13/§32/AGENTS.md), say so rather than report a
  // clean success. The email is already out (consume-then-execute), so this is not a send failure; it is
  // an honest "sent, receipt unrecorded" so the operator knows the audit row is missing and can follow up.
  if (!receiptPersisted) {
    return json(200, {
      run_id: null,
      status: "succeeded_unrecorded",
      code: "receipt_not_persisted",
      warning: "The email was sent, but its durable run receipt could not be recorded. The send is not reversible; the audit row is missing.",
      outputs: { resend_id: outcome.resend_id, recipient: outcome.recipient },
    });
  }

  // sent
  return json(200, {
    run_id: sentRunId,
    status: "succeeded",
    outputs: { resend_id: outcome.resend_id, recipient: outcome.recipient },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body: RunRequest = await req.json();
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    const { data: skill, error: skillErr } = await admin
      .from("paige_skills")
      .select("*")
      .eq("slug", body.skill_slug)
      .maybeSingle();
    if (skillErr || !skill) {
      return new Response(JSON.stringify({ error: `Unknown skill: ${body.skill_slug}` }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (skill.status !== "active") {
      return new Response(JSON.stringify({ error: `Skill is ${skill.status}` }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const hasBrowserStep = browserToolAllowed(skill as SkillRow);
    // Resolve and authorize before any run/activity row is written. A refused browser request leaves
    // no fabricated or caller-attributed execution trace.
    const browserAuthority = hasBrowserStep
      ? await resolveBrowserAuthority(req, body, admin)
      : null;

    // ── THE GOVERNED GATE (§9/§59) — the direct Edge route enforces the governed truth ITSELF. ──
    // Resolve the caller SERVER-SIDE (JWT actor + tenant + authority, or a trusted internal service
    // credential). Then run the ONE governed pathway. A refusal (unauthenticated, request-supplied
    // tenant, access-denied, service principal acting alone, owner-only) leaves NO run row and NO
    // side effect — the attempt is recorded only on paige_audit_log.
    const skillCaller = await resolveSkillCaller(req, body, admin, browserAuthority);
    const callerTenantId = skillCaller.tenantId;
    const requestNonce = crypto.randomUUID();
    const governed = decideSkillRun({
      skillSlug: skill.slug,
      authenticated: skillCaller.authenticated,
      userId: skillCaller.userId,
      principal: skillCaller.principal,
      tenantId: skillCaller.tenantId,
      access: skillCaller.access,
      autonomyLane: SKILL_DEFAULT_LANE,
      args: body.inputs ?? {},
      startedAtMs: Date.now(),
      nowIso: new Date().toISOString(),
    });
    if (governed.outcome.kind === "refuse") {
      await writeGovernedSkillAudit(admin, skillCaller, governed.audit);
      return new Response(
        JSON.stringify({ status: "refused", code: governed.outcome.code, error: governed.outcome.message }),
        { status: governed.outcome.status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── EXTERNAL SEND — draft_and_email_document requires a durable, single-use, fingerprint-bound
    // approval (reusing paige_pending_confirmations + confirm-fingerprint, §18). Its flow is two-phase,
    // so it is handled here rather than through the generic run-row-then-dispatch path below. ──
    if (skill.slug === "draft_and_email_document") {
      return await runDraftAndEmailDocument(body, admin, skill, callerTenantId!, skillCaller, requestNonce);
    }

    // First-N admin confirmation gate — now driven by the JWT-DERIVED authority (never body.invoker_kind).
    // The governed gate returns `propose` for a `high` skill, which this honors through skill-runner's
    // existing first-run admin-confirmation mechanism; after the first N runs a skill proceeds as before.
    let needsConfirm = false;
    if (governed.outcome.kind === "propose"
      && skill.require_admin_confirm_first_n > 0
      && skill.run_count < skill.require_admin_confirm_first_n) {
      needsConfirm = browserAuthority
        ? secureBrowserNeedsAdminConfirmation(
          skill.require_admin_confirm_first_n,
          skill.run_count,
          browserAuthority.invocationKind,
          body.confirm_token,
        )
        : !skillCaller.isApprovingAuthority && !body.confirm_token;
    }

    const { data: run, error: runErr } = await admin
      .from("paige_skill_runs")
      .insert({
        skill_id: skill.id,
        skill_slug: skill.slug,
        contact_id: body.contact_id ?? null,
        // `invoker_kind` is a non-authoritative LABEL only; the authority above is JWT-derived. The
        // recorded actor is the server-resolved one, never a body-trusted id.
        invoker_kind: browserAuthority?.invocationKind ?? (body.invoker_kind ?? "admin"),
        invoker_user_id: skillCaller.userId,
        inputs: body.inputs ?? {},
        status: needsConfirm ? "awaiting_confirm" : "running",
      })
      .select()
      .single();
    if (runErr || !run) throw runErr ?? new Error("failed to create run");

    if (needsConfirm) {
      return new Response(
        JSON.stringify({ run_id: run.id, status: "awaiting_confirm", message: `First-${skill.require_admin_confirm_first_n} runs require admin confirmation.` }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const start = Date.now();
    const stepsLog: Array<Record<string, unknown>> = [];
    let outputs: Record<string, unknown> = {};
    let runStatus: "succeeded" | "failed" | "cancelled" | "awaiting_confirm" = "succeeded";
    let runError: string | null = null;

    try {
      // Dispatch. Non-bespoke slugs (and force_interpreter) flow through the generic S1b interpreter;
      // the 4 shipped slugs stay on their bespoke handlers below — byte-identical (§58 by construction),
      // since force_interpreter defaults false and only NON-bespoke slugs otherwise take this path.
      if (shouldUseInterpreter(skill.slug, body.force_interpreter)) {
        // §9/§59 — the acting tenant is the CALLER's, resolved server-side above, NEVER the contact's
        // tenant and NEVER body.tenant_id. interpretSkill already scopes its OWN contact lookup to this
        // tenant (`.eq("tenant_id", tenantId)`), so a cross-tenant contact_id simply resolves to no
        // context ("not found in your workspace") instead of leaking tenant B's record under tenant B's
        // identity. The previous derivation (`contactTenantId ?? body.tenant_id`) is exactly the leak.
        const resolvedTenantId = callerTenantId;
        const resolvedActorId = skillCaller.userId;
        const resolvedActorRole = browserAuthority?.actorRole ?? skillCaller.actorRole;

        const interp = await interpretSkill(
          { forge, admin, browse: browseViaHost, browsePublic: browsePublicViaHost },
          {
            skill: skill as unknown as SkillRow,
            inputs: body.inputs ?? {},
            contactId: body.contact_id ?? null,
            tenantId: resolvedTenantId,
            callerTier: body.caller_tier ?? null,
            actorUserId: resolvedActorId,
            actorRole: resolvedActorRole,
            runId: run.id,
          },
        );
        stepsLog.push(...interp.steps_log);
        // Surface the interpreter's richer outcome honestly (§13) and map it onto the run-table's
        // CHECK-constrained status vocabulary (queued|running|succeeded|failed|cancelled|awaiting_confirm).
        // Only a genuine completion (succeeded/awaiting_approval/brief) counts as success below — a
        // policy stop (denied), an honest degrade (needs_config), or a paused input request (needs_input)
        // must NOT inflate success_count.
        outputs = { ...interp.outputs, interpreter_status: interp.status };
        switch (interp.status) {
          case "failed":
            runStatus = "failed";
            break;
          case "succeeded":
          case "awaiting_approval":
          case "brief":
            runStatus = "succeeded"; // a real completion
            break;
          case "needs_input":
            runStatus = "awaiting_confirm"; // paused for the user's format choice (Slice 4)
            break;
          case "denied":
          case "needs_config":
          default:
            runStatus = "cancelled"; // stopped before a deliverable — honest, does not count as success
            break;
        }
        runError = interp.error ?? null;
      } else {
      // Dispatch by slug. Each branch invokes specialized tools.
      switch (skill.slug) {
        case "verify_business_sos": {
          const business_id = (body.inputs?.business_id as string) ?? null;
          if (!business_id) throw new Error("business_id required");
          // §9 — the business must belong to the CALLER's resolved tenant. A cross-tenant business_id
          // returns nothing here and is refused BEFORE any outbound verification is triggered.
          const { data: ownedBiz } = await admin
            .from("businesses").select("id").eq("id", business_id).eq("tenant_id", callerTenantId).maybeSingle();
          if (!ownedBiz) throw new Error("business not found in your workspace");
          const res = await fetch(`${SUPABASE_URL}/functions/v1/business-verifier`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SERVICE_KEY}` },
            body: JSON.stringify({ business_id, triggered_by: "skill" }),
          });
          outputs = await res.json();
          // A refused/errored verification is NOT a skill success. Read the OUTCOME through the shared
          // classifier (§18/§37), never the HTTP status alone: a run that happened (`ok:true`, incl. a
          // `status:"failed"` no-match) is the only success; the Funding & Coaching Tools gate's HTTP-200
          // policy refusal is `cancelled` (stopped before a deliverable, like the interpreter's
          // needs_config/denied); an operational failure (authz 403, 4xx/5xx, or a 200 `ok:false` service
          // error like BUSINESS_LOOKUP_FAILED) is `failed` so status-based monitoring/retry sees it
          // (§13 "a fire is not a delivery"; Codex #1228 P2 — never bury a real failure as a policy cancel).
          const bvOutcome = classifyBusinessVerifyResponse(res.ok, outputs as { ok?: unknown; result?: unknown });
          stepsLog.push({ step: "business-verifier", ok: bvOutcome === "ran" });
          if (bvOutcome !== "ran") {
            runStatus = bvOutcome === "policy_refusal" ? "cancelled" : "failed";
            runError = (outputs as { reason?: string; message?: string; error?: string })?.reason
              ?? (outputs as { message?: string })?.message
              ?? (outputs as { error?: string })?.error
              ?? "business verification did not run";
          }
          break;
        }
        case "research_to_concept_brief": {
          const topic = (body.inputs?.topic as string) ?? "";
          if (!topic) throw new Error("topic required");
          // Firecrawl search
          const fcKey = Deno.env.get("FIRECRAWL_API_KEY");
          let sources: any[] = [];
          if (fcKey) {
            const fc = await fetch("https://api.firecrawl.dev/v2/search", {
              method: "POST",
              headers: { "Authorization": `Bearer ${fcKey}`, "Content-Type": "application/json" },
              body: JSON.stringify({ query: topic, limit: 5, scrapeOptions: { formats: ["markdown"] } }),
            });
            const fcData = await fc.json();
            sources = fcData?.web ?? fcData?.data ?? [];
            stepsLog.push({ step: "firecrawl", count: sources.length });
          }
          // LLM synthesize
          {
            const summary = sources.map((s: any, i: number) => `[${i + 1}] ${s.title ?? s.url}\n${(s.markdown ?? "").slice(0, 1500)}`).join("\n\n");
            const ai = await gatewayCompat("anthropic", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                model: "google/gemini-2.5-flash",
                messages: [
                  { role: "system", content: "You produce structured concept briefs. Output sections: Problem, Approach, Risks, Next Steps. Cite sources with [n]." },
                  { role: "user", content: `Topic: ${topic}\n\nSources:\n${summary}` },
                ],
              }),
            });
            const aiData = await ai.json();
            outputs = { brief: aiData?.choices?.[0]?.message?.content ?? "", sources };
            stepsLog.push({ step: "synthesize", ok: ai.ok });
          }
          break;
        }
        case "build_game_plan": {
          const contact_id = body.contact_id;
          if (!contact_id) throw new Error("contact_id required");
          // §9 — scope the contact to the CALLER's resolved tenant. A cross-tenant contact_id returns
          // nothing and is refused BEFORE any memory is read or written under another tenant's client.
          // The contact's PRIMARY email and phone ride along as `email` / `phone`, read from its
          // contact methods (the clients row holds no address).
          const { data: contactRow } = await admin.from("clients").select(`*, ${CLIENT_CONTACT_METHODS_EMBED}`).eq("id", contact_id).eq("tenant_id", callerTenantId).maybeSingle();
          const contact = withPrimaryAddresses(contactRow);
          if (!contact) throw new Error("contact not found in your workspace");
          // client_memory carries no tenant_id; the contact above is already proven to be the caller's,
          // so its memory (keyed by client_id) is in-tenant by construction.
          const { data: memory } = await admin.from("client_memory").select("*").eq("client_id", contact_id).order("created_at", { ascending: false }).limit(10);
          stepsLog.push({ step: "context", memory_count: memory?.length ?? 0 });
          {
            const ai = await gatewayCompat("anthropic", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                model: "google/gemini-2.5-flash",
                messages: [
                  { role: "system", content: "You are Paige. Produce a personalized step-by-step game plan for this client. Use ACCEL/BUILD/FUND frameworks. Numbered steps, with owner + timeline per step. End with a 'next 7 days' checklist." },
                  { role: "user", content: `Client: ${JSON.stringify(contact)}\n\nRecent memory:\n${JSON.stringify(memory)}` },
                ],
              }),
            });
            const aiData = await ai.json();
            const plan = aiData?.choices?.[0]?.message?.content ?? "";
            outputs = { game_plan: plan };
            await admin.from("client_memory").insert({
              client_id: contact_id,
              memory_type: "game_plan",
              content: plan,
              metadata: { source: "skill:build_game_plan", run_id: run.id },
            });
            stepsLog.push({ step: "save_memory", ok: true });
          }
          break;
        }
        // NOTE: `draft_and_email_document` is NOT dispatched here. As the one EXTERNAL-SEND skill it is
        // handled before this switch by `runDraftAndEmailDocument`, which binds a durable, single-use,
        // fingerprint-bound approval to the exact send (tenant + contact + recipient + sender + doc +
        // content) and only then calls Resend. Leaving a case here would be a second, un-gated send path.
        default:
          // Unreachable in practice: a non-bespoke slug is handled by the interpreter above. Kept as a
          // defensive guard in case BESPOKE_SKILL_SLUGS and the switch ever drift.
          throw new Error(`Skill '${skill.slug}' is registered but has no runtime handler. Use skill-forge to scaffold one.`);
      }
      }
    } catch (err) {
      runStatus = "failed";
      runError = (err as Error).message;
    }

    const duration_ms = Date.now() - start;
    await admin.from("paige_skill_runs")
      .update({
        status: runStatus,
        steps_log: stepsLog,
        outputs,
        duration_ms,
        error: runError,
        completed_at: new Date().toISOString(),
      })
      .eq("id", run.id);

    await admin.from("paige_skills")
      .update({
        run_count: skill.run_count + 1,
        success_count: skill.success_count + (runStatus === "succeeded" ? 1 : 0),
      })
      .eq("id", skill.id);

    return new Response(
      JSON.stringify({ run_id: run.id, status: runStatus, outputs, error: runError }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("skill-runner error", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
