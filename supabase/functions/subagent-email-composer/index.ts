// Sub-Agent: Email Composer
// Dedicated free-form email composition with tone control. Paige delegates
// here so she doesn't burn cycles hand-writing every email. Returns a
// structured draft (subject + HTML + text + compliance flags). Does NOT send —
// caller pairs this with `send_transactional_email` after review.
//
// Doctrine §116: never name another specific client, coach, or customer of
// the platform. Archetype phrasing only ("a client", "the contact").
import { createClient } from "npm:@supabase/supabase-js@2";
import { gatewayCompat } from "../_shared/claude.ts";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
// #176 — pure document-extraction primitives (shared so the headless §32 smoke exercises
// the SAME code that ships). The model call is injected; no second model client (§18/§34).
import {
  ATTACHMENT_SOURCE_INSTRUCTION,
  bytesToBase64,
  extractAttachmentText,
  type ModelInvoker,
} from "../_shared/attachment-extract.ts";
import { CLIENT_CONTACT_METHODS_EMBED, withPrimaryAddresses } from "../_shared/contact-methods.ts";
import { adminClient, isAuthorizedInternalCaller } from "../_shared/systems-check-http.ts";
import { bindContactToTenant, collectContactSelectors } from "../_shared/paige-orchestration/resource-binder.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

// #176 — Conversations attachments → draft-with-Paige. A coach can stage document(s)
// into the reply composer and have Paige READ them so the drafted reply can reference
// their contents. Attachments live in the private "comms-attachments" bucket, namespaced
// `${tenantId}/${uuid}-${name}` (useCommsAttachments, inbox-shared.ts). §9: the caller's
// tenant is resolved SERVER-SIDE from the JWT and each path's first segment MUST equal it
// or the object is refused (never trust a body-supplied tenant/path).
const COMMS_ATTACH_BUCKET = "comms-attachments";
const MAX_ATTACHMENTS = 3;                        // bound: a few files, never a flood
const MAX_ATTACH_BYTES = 10 * 1024 * 1024;        // 10MB/file — matches the bucket ceiling

type Tone =
  | "professional"
  | "warm"
  | "welcoming"
  | "stern"
  | "friendly"
  | "executive"
  | "apologetic"
  | "celebratory"
  | "direct"
  | "empathetic"
  | "urgent";

interface Input {
  // Recipient context
  contact_id?: string;
  recipient_name?: string;
  recipient_email?: string;
  // Composition inputs
  intent: string;                 // "what should this email accomplish"
  key_points?: string[];          // bullet points to include
  tone?: Tone | string;           // freeform accepted; validated below
  length?: "short" | "medium" | "long";
  cta?: string;                   // desired call-to-action
  subject_hint?: string;          // optional preferred subject
  sender_name?: string;           // signature name (defaults to tenant)
  sender_title?: string;
  format?: "html" | "plain";      // default html
  // #176 — OPTIONAL comms-attachments object paths the coach staged for Paige to READ
  // and reference in the draft. Each is `${tenantId}/${uuid}-${name}`; §9-guarded below.
  attachment_paths?: string[];
}

function ok(d: unknown, status = 200) {
  return new Response(JSON.stringify(d), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });
}

const ALLOWED_TONES = new Set<string>([
  "professional", "warm", "welcoming", "stern", "friendly",
  "executive", "apologetic", "celebratory", "direct", "empathetic", "urgent",
]);

const FORBIDDEN_CLAIMS = [
  /guarantee(d)? (approval|funding|results)/i,
  /remove (all|any) negative/i,
  /erase your debt/i,
  /no risk/i,
  /100% approval/i,
  /credit repair/i,
];

function complianceScan(text: string) {
  const hits: string[] = [];
  for (const rx of FORBIDDEN_CLAIMS) if (rx.test(text)) hits.push(rx.source);
  return hits;
}

function stripToText(html: string) {
  return html.replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function paragraphsToHtml(text: string) {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return escaped
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px 0;line-height:1.55;color:#111">${p.replace(/\n/g, "<br/>")}</p>`)
    .join("\n");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // INT-310 C1 — WHO is calling, and WHICH workspace any selected contact must belong to. Both are
  // decided server-side before anything is read with the service role:
  //   • the canonical internal caller (the orchestrator, after its resource binder): the workspace is
  //     the server-resolved tenant it forwards in context.tenant_id;
  //   • a person (the two Clients-hub composers call this directly): a VERIFIED user, and the workspace
  //     is current_user_tenant_id() — never a caller-supplied tenant. The anon key resolves no user and
  //     is refused.
  // Both go through the one binder: _shared/paige-orchestration/resource-binder.ts.
  const authHeader = req.headers.get("Authorization") ?? "";
  const isInternalCall = await isAuthorizedInternalCaller(req, adminClient());
  let userClient: ReturnType<typeof createClient> | null = null;
  if (!isInternalCall) {
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    userClient = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { persistSession: false },
      global: { headers: { Authorization: authHeader } },
    });
    let userId: string | null = null;
    try {
      const { data: who } = await userClient.auth.getUser(token);
      userId = who?.user?.id ?? null;
    } catch (_e) {
      userId = null;
    }
    if (!userId) return ok({ ok: false, error: "unauthorized" }, 401);
  }

  let payload: { input?: Input; context?: { contact_id?: string; user_id?: string; tenant_id?: string } } = {};
  try { payload = await req.json(); } catch { return ok({ ok: false, error: "Invalid JSON" }, 400); }

  const input = payload.input ?? {} as Input;
  if (!input.intent || typeof input.intent !== "string") {
    return ok({ ok: false, error: "intent required (what should this email accomplish?)" }, 400);
  }

  let workspaceTenant: string | null = null;
  let workspaceResolveFailed = false;
  if (isInternalCall) {
    // The canonical internal caller (service-role bearer or a verified cron token — the same trust
    // class) forwards the tenant it already resolved; the orchestrator sets it from its own binder.
    const t = (payload.context as { tenant_id?: unknown } | undefined)?.tenant_id;
    workspaceTenant = typeof t === "string" ? t : null;
  } else if (userClient) {
    try {
      const { data: t, error: tErr } = await userClient.rpc("current_user_tenant_id");
      if (tErr) throw tErr;
      workspaceTenant = typeof t === "string" ? t : null;
    } catch (e) {
      workspaceResolveFailed = true;
      console.warn("[email-composer] tenant resolve failed:", (e as Error)?.message);
    }
  }
  // Bind the selected contact (input.contact_id / context.contact_id) to that workspace through the
  // canonical binder: a malformed, missing, foreign or disagreeing selector is one uniform refusal.
  // An infrastructure failure resolving the workspace is reported as such (503), never as a
  // not-found — the same distinction the binder draws for its own lookup error.
  if (workspaceResolveFailed && collectContactSelectors(input as unknown as Record<string, unknown>, payload.context ?? {}).length > 0) {
    return ok({ ok: false, error: "resource_verification_unavailable" }, 503);
  }
  const binding = await bindContactToTenant(
    supabase, workspaceTenant, input as unknown as Record<string, unknown>, payload.context ?? {},
  );
  if (!binding.ok) return ok({ ok: false, error: binding.error }, binding.status);

  // Resolve recipient — either explicit or via the bound contact
  const contactId = binding.contactId;
  let recipientName = input.recipient_name ?? "";
  let recipientEmail = input.recipient_email ?? "";
  let entityName = "";
  let fundingGoal = "";
  let contactTenantId: string | null = null;
  if (contactId && workspaceTenant) {
    // Addressed to the contact's PRIMARY email unless the caller named one.
    const { data: row } = await supabase
      .from("clients")
      .select(`first_name,last_name,entity_name,funding_goal,tenant_id,${CLIENT_CONTACT_METHODS_EMBED}`)
      .eq("id", contactId)
      .eq("tenant_id", workspaceTenant) // INT-310 C1: defense in depth behind the binder
      .maybeSingle();
    const c = withPrimaryAddresses(row);
    if (c) {
      recipientName ||= [c.first_name, c.last_name].filter(Boolean).join(" ").trim();
      recipientEmail ||= c.email ?? "";
      entityName = c.entity_name ?? "";
      fundingGoal = c.funding_goal ?? "";
      contactTenantId = (c as { tenant_id?: string }).tenant_id ?? null;
    }
  }

  const rawTone = (input.tone ?? "professional").toString().toLowerCase().trim();
  const tone = ALLOWED_TONES.has(rawTone) ? rawTone : "professional";
  const length = input.length ?? "medium";
  const format = input.format ?? "html";

  // Sprint C.1.6 — Loud-fail tenant branding. No hardcoded academy fallback.
  let senderName = (input.sender_name ?? "").trim();
  if (!senderName) {
    if (!contactTenantId) {
      return ok({
        ok: false,
        error: "TENANT_SENDER_IDENTITY_NOT_CONFIGURED",
        message: "Tenant sender identity not configured for this contact. Pass sender_name or link the contact to a tenant with branding set.",
      }, 424);
    }
    const { data: tenant } = await supabase
      .from("tenants")
      .select("name,brand")
      .eq("id", contactTenantId)
      .maybeSingle();
    const brand = (tenant?.brand ?? {}) as { name?: string; sender_name?: string };
    senderName = (brand.sender_name ?? brand.name ?? tenant?.name ?? "").trim();
    if (!senderName) {
      return ok({
        ok: false,
        error: "TENANT_SENDER_IDENTITY_NOT_CONFIGURED",
        message: "Tenant sender identity not configured. Set tenants.brand.name / brand.sender_name before composing tenant-branded email.",
      }, 424);
    }
  }

  const senderTitle = input.sender_title ?? "";

  // ── #176 — read staged attachment(s) so the draft can reference the document ──────────
  // §9 TENANT ISOLATION (mandatory): the caller's tenant is resolved SERVER-SIDE from the
  // JWT via current_user_tenant_id() — NEVER from the request body. Each comms-attachments
  // path is namespaced `${tenantId}/…`; a path whose first segment ≠ the caller's tenant is
  // another tenant's object and is REFUSED (skip + log), never downloaded. A failed path
  // never throws the whole draft (§13). Internal/service-role callers (the orchestrator)
  // resolve no user tenant and simply skip — they never pass attachment_paths today.
  const attachmentPaths = Array.isArray(input.attachment_paths)
    ? input.attachment_paths.filter((p): p is string => typeof p === "string" && p.length > 0)
    : [];

  const invokeModel: ModelInvoker = async (system, userParts) => {
    const res = await gatewayCompat("anthropic", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        messages: [
          { role: "system", content: system },
          { role: "user", content: userParts },
        ],
      }),
    });
    if (!res.ok) throw new Error(`attachment_extraction_gateway_${res.status}`);
    const j = await res.json();
    return j?.choices?.[0]?.message?.content ?? "";
  };

  let attachmentContext = "";
  let attachmentsRead = 0;
  let attachmentsSkipped = 0;   // §13: staged-but-not-read count, surfaced so the UI can be honest
  if (attachmentPaths.length > 0) {
    // The person's workspace, resolved above from current_user_tenant_id(); internal callers skip.
    const callerTenantId: string | null = isInternalCall ? null : workspaceTenant;
    if (!callerTenantId) {
      console.warn("[email-composer] attachment_paths present but caller tenant unresolved — skipping all (§9 fail-safe).");
    } else {
      const extracted: string[] = [];
      for (const path of attachmentPaths.slice(0, MAX_ATTACHMENTS)) {
        // §9 PATH GUARD — the object key MUST be exactly `${callerTenant}/<single filename>`.
        // Strict single-segment shape (not just first-segment equality) ALSO rejects `..`/`//`
        // traversal and any nested path, so a caller can only ever reach objects under their OWN
        // tenant prefix — defense-in-depth even though Supabase's literal-key storage would 404 a
        // traversal attempt anyway (verifier §9 hardening).
        const rest =
          path.startsWith(callerTenantId + "/") ? path.slice(callerTenantId.length + 1) : null;
        if (rest === null || rest.length === 0 || rest.includes("/") || path.includes("..")) {
          console.warn("[email-composer] rejected attachment (§9): key is not `${tenant}/<file>`.");
          attachmentsSkipped++;
          continue;
        }
        try {
          const { data: blob, error: dlErr } = await supabase.storage
            .from(COMMS_ATTACH_BUCKET).download(path);
          if (dlErr || !blob) {
            console.warn(`[email-composer] attachment download failed: ${dlErr?.message ?? "no blob"}`);
            attachmentsSkipped++;
            continue;
          }
          // Belt-and-suspenders: the comms-attachments bucket is server-enforced at file_size_limit
          // 10MB + a restricted mime allowlist (private bucket), so an oversized/disallowed object
          // can't be uploaded in the first place; this client check just double-guards.
          const bytes = new Uint8Array(await blob.arrayBuffer());
          if (bytes.length > MAX_ATTACH_BYTES) {
            console.warn(`[email-composer] attachment over ${MAX_ATTACH_BYTES}B — skipped.`);
            attachmentsSkipped++;
            continue;
          }
          const fileName = path.split("/").pop() ?? "document";
          const mimeType = blob.type || "application/octet-stream";
          const text = await extractAttachmentText(
            { base64: bytesToBase64(bytes), mimeType, fileName }, invokeModel,
          );
          if (text) {
            extracted.push(`--- ${fileName} ---\n${text.slice(0, 20_000)}`);
            attachmentsRead++;
          } else {
            attachmentsSkipped++;   // downloaded but produced no readable text
          }
        } catch (e) {
          console.warn(`[email-composer] attachment processing error: ${(e as Error)?.message}`);
          attachmentsSkipped++;
        }
      }
      if (extracted.length) attachmentContext = extracted.join("\n\n");
    }
  }

  const wordBudget = length === "short" ? "60-100" : length === "long" ? "220-320" : "130-190";

  let subject = input.subject_hint ?? "";
  let bodyPlain = "";

  {
    const system = `You are the Email Composer sub-agent for Paige Agent AI.
Draft ONE email in a "${tone}" tone. Word budget: ${wordBudget} words in the body.
Hard rules:
- Never guarantee approval, funding, or results.
- Never promise to remove negatives, erase debt, or claim "no risk".
- Never use the phrase "credit repair".
- No legal or tax advice.
- Never name another specific client, coach, admin, or customer of the platform. Use archetype phrasing only ("a client", "the contact", "their business"). Doctrine §116.
- Sign off exactly as: "${senderName}${senderTitle ? `, ${senderTitle}` : ""}".
- Do NOT invent facts about the recipient beyond what is provided.${attachmentContext ? `
- The client shared document(s); their READABLE CONTENT is provided under "ATTACHED DOCUMENT CONTENT". You MAY reference specifics from it in the reply, but ONLY facts literally present there — never invent details beyond what is written. ${ATTACHMENT_SOURCE_INSTRUCTION}` : ""}

Return STRICT JSON with this shape (no markdown, no code fences):
{"subject": "<one-line subject>", "body": "<plain-text body with \\n paragraph breaks, no HTML>"}`;

    const user = [
      `Recipient name: ${recipientName || "(unknown)"}`,
      `Recipient email: ${recipientEmail || "(unknown)"}`,
      entityName ? `Business: ${entityName}` : "",
      fundingGoal ? `Funding goal: ${fundingGoal}` : "",
      `Tone: ${tone}`,
      `Length target: ${length} (${wordBudget} words)`,
      `Intent: ${input.intent}`,
      input.key_points?.length ? `Key points to include:\n- ${input.key_points.join("\n- ")}` : "",
      input.cta ? `Call to action: ${input.cta}` : "",
      input.subject_hint ? `Preferred subject: ${input.subject_hint}` : "",
      attachmentContext
        ? `\nATTACHED DOCUMENT CONTENT (reference only what is literally written here):\n${attachmentContext}`
        : "",
    ].filter(Boolean).join("\n");

    const aiRes = await gatewayCompat("anthropic", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    if (!aiRes.ok) {
      return ok({ ok: false, error: `AI gateway ${aiRes.status}`, detail: (await aiRes.text()).slice(0, 400) }, 502);
    }
    const j = await aiRes.json();
    const raw = j?.choices?.[0]?.message?.content ?? "{}";
    try {
      const parsed = JSON.parse(raw);
      subject = String(parsed.subject ?? subject ?? "").trim() || `Following up${entityName ? ` — ${entityName}` : ""}`;
      bodyPlain = String(parsed.body ?? "").trim();
    } catch {
      // If the model didn't return clean JSON, treat the whole payload as the body.
      bodyPlain = String(raw).trim();
      subject = subject || `Following up${entityName ? ` — ${entityName}` : ""}`;
    }
  }

  if (!bodyPlain) {
    return ok({ ok: false, error: "composer_returned_empty_body" }, 502);
  }

  const bodyHtml = format === "plain" ? "" : paragraphsToHtml(bodyPlain);
  const bodyText = format === "plain" ? bodyPlain : stripToText(bodyHtml);
  const localFlags = complianceScan(bodyPlain + "\n" + subject);

  // §203 runtime enforcement: hand the composed draft to the Legal & Compliance
  // Reviewer sub-agent. Admins CANNOT override a `blocked` verdict from here —
  // the draft is refused and the caller must revise. Fail closed on 5xx.
  let complianceVerdict: "approved" | "needs_human_approval" | "blocked" = "approved";
  let complianceFindings: Array<{ severity: string; message: string }> = [];
  try {
    const reviewer = await fetch(`${SUPABASE_URL}/functions/v1/subagent-compliance`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({
        input: {
          contact_id: contactId ?? undefined,
          action_type: "email",
          draft_text: `${subject}\n\n${bodyPlain}`,
          channel: "email",
        },
        // INT-310 C1: the compliance reviewer binds its own read to the same workspace.
        context: { contact_id: contactId ?? undefined, tenant_id: workspaceTenant ?? undefined },
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!reviewer.ok) {
      return ok({
        ok: false,
        error: "compliance_reviewer_unavailable",
        detail: `HTTP ${reviewer.status}`,
        doctrine: "§203 fail-closed",
      }, 503);
    }
    const rev = await reviewer.json();
    complianceVerdict = rev?.verdict ?? "approved";
    complianceFindings = Array.isArray(rev?.findings) ? rev.findings : [];
  } catch (err) {
    return ok({
      ok: false,
      error: "compliance_reviewer_timeout",
      detail: err instanceof Error ? err.message : String(err),
      doctrine: "§203 fail-closed",
    }, 503);
  }

  if (complianceVerdict === "blocked") {
    return ok({
      ok: false,
      error: "compliance_blocked",
      doctrine: "§203",
      subagent: "email-composer",
      summary: "Draft blocked by Legal & Compliance Reviewer. Revise wording and retry.",
      compliance_verdict: complianceVerdict,
      compliance_findings: complianceFindings,
      local_flags: localFlags,
    }, 422);
  }

  const requiresApproval = complianceVerdict === "needs_human_approval" || localFlags.length > 0;

  return ok({
    ok: true,
    subagent: "email-composer",
    summary: `Composed ${tone} email (${length}) for ${recipientName || recipientEmail || "recipient"}${attachmentsRead > 0 ? ` after reading ${attachmentsRead} attachment${attachmentsRead === 1 ? "" : "s"}` : ""}${requiresApproval ? " — requires human approval" : ""}.`,
    // §13 honest: only ever the count of documents ACTUALLY downloaded + read this turn.
    attachments_read: attachmentsRead,
    attachments_skipped: attachmentsSkipped,   // §13: staged docs that could NOT be read (guard/dl/empty)
    draft: {
      subject,
      body_html: bodyHtml,
      body_text: bodyText,
      tone_used: tone,
      length,
      word_count: bodyPlain.split(/\s+/).filter(Boolean).length,
    },
    recipient: {
      contact_id: contactId ?? null,
      name: recipientName || null,
      email: recipientEmail || null,
    },
    compliance_verdict: complianceVerdict,
    compliance_findings: complianceFindings,
    compliance_flags: localFlags,
    requires_approval: requiresApproval,
    confidence: requiresApproval ? "low" : "high",
    next_action_hint: requiresApproval
      ? "Human review required before sending — see compliance_findings."
      : "Pass draft.subject + draft.body_html to the `send_composed_email` (or `send_transactional_email`) MCP tool.",
  });
});
