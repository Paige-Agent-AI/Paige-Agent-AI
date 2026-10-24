// growth-process-submission — the lead-reply step (Experience 03 · S3 "PAIGE works your leads").
//
// When someone fills in a business's form and that business has turned on reply drafts, PAIGE drafts
// a personal reply for the owner to review and send. This module decides WHETHER to file the draft
// request and files it; it never writes the email and never sends anything:
//
//   processor (here) → file_action(owner.lead_followup, {submission_id, form_id, source, draft_input})
//   → paige-action-worker drafts it and stores draft_content (subject + plain-text body)
//   → the owner reviews (and may edit) it and sends it through the ONE governed email door,
//     comms-email-command (comms.email_send): server-resolved recipient + sender, readiness,
//     single-use fingerprint approval, idempotent operation. There is no second sender path:
//     execute-approval refuses send kinds, and nothing here can send.
//
// A submitted inquiry is not marketing consent. A direct reply to it is permitted, but it must honour
// suppression / withdrawal / preferences — so the draft is filed only when the same readiness the
// email door applies says this reply could go out (or is merely held by a quiet window), and the door
// re-checks all of it again at send time.
//
// THE PLAN DECISION (appendLeadReply, no I/O): the step is added only when the form itself opted in
// (growth_forms.lead_reply_enabled = true; default false, so a form that never chose it gets nothing),
// the business is a tier that answers its own lead book (account_type standalone, sub_account or
// enterprise — never a pure agency, which manages accounts rather than a lead book; see
// LEAD_REPLY_ACCOUNT_TYPES and tierFeatures.ts 'lead_reply'), and the form has no automation of
// its own that already files owner.lead_followup (that one is routed through fileLeadReply instead —
// never a second draft). The step is unledgered (no automation row, like applyIntakeSettings'
// email_alert): adding a growth_form_automations row would switch the form off the legacy column
// fallback and silently drop its auto_create_contact step (§58).
//
// THE RUN DECISION (fileLeadReply): nothing is filed unless the form opted in (lead_reply_enabled is
// the ONE switch — a form's own legacy paige_follow_up automation for owner.lead_followup is held to
// it too, so no second way to turn drafting on exists), the business tier qualifies, the business is
// open (tenants.status trial/active/past_due and not archived — no model spend for a closed business),
// the intake produced a contact, the email the visitor TYPED is that contact's email (see IDENTITY
// below), the business has EXACTLY ONE usable email sender
// (resolveCommsEmailParties → 'resolved', then the door's own readiness: emailSenderReadiness null and
// the recipient is not suppressed / opted out), and drafting is within the per-business and
// per-recipient caps. Several senders → no draft (no screen can send it yet), reason recorded. Every
// reason a draft is not filed is reported as it is and recorded on the submission
// (lead_reply_skipped_reason) — never presented as a draft that was made.
//
// IDENTITY (security): the intake resolves an existing contact by email, then by PHONE. So a visitor can
// type a fresh email plus an existing client's phone number and be matched to that client — and a
// draft would then be addressed to the client, about a request the client never made. The draft is
// filed only when the normalized (trim, lowercase) email typed into the form equals the server-
// resolved recipient email; otherwise it is skipped with 'submitted_email_not_contact_email'. The
// draft's title and the composer brief name the STORED contact, never the typed name.
//
// CAPS ARE BOUNDED, NOT SERIALIZED (§13): the cap check reads counts, then file_action inserts — two
// separate PostgREST calls, so two concurrent submissions can both pass the check. After filing, the
// count is taken again over the rows created at or before ours; if ours is over a cap it is dismissed
// (advance_action 'dismissed', before the */2 drafting worker claims it, so no model call is spent in
// the normal case) and the reason recorded. Residual window: a row created earlier but committed after
// our recount is invisible to it, so a burst of truly simultaneous submissions can overshoot a cap by
// the number in flight at once. Airtight serialization needs a database-side lock inside one filing
// function (e.g. pg_advisory_xact_lock on the tenant within file_action or a lead-reply wrapper RPC),
// which is not in this module's reach.
//
// UNTRUSTED DATA: the visitor's answers become the draft brief's key_points. They are DATA for the
// composer, never instructions: labelled, whitespace-collapsed, bounded in count and length, with
// identity-number fields already filtered out by the processor (SENSITIVE_FIELD_TYPES). No recipient
// address, sender or tenant is ever taken from them, from a request body, or from model output.
//
// AUTHORITY (§9/§59): the tenant is the CLAIMED submission's tenant, passed in by the processor; the
// contact is the intake's contact. The action is filed at the kind's default lane (p_autonomy_lane
// null → confirm); owner.lead_followup is a send_via_approval kind, so it always needs the owner.
//
// NEVER FAILS A LEAD THAT USED TO PROCESS (§58): only a failure that never reached a database answer
// (connection, pool, stale claim) is returned as an error for the sweeper to retry — safe, because the
// existing-action check and the unique index (20271030000000) make a retry file at most one draft. A
// lost race (23505) is success. Every other refusal is "done" with its reason.
//
// Pure TypeScript with erasable syntax only (no Deno globals): the processor injects the environment
// reader and the pre-send check, so node --test and Deno both load this module.

import {
  emailProvidersFor, readCommsEmailReadiness, resolveCommsEmailParties,
  type CommsEmailAdmin, type CommsEmailParties, type CommsEmailPreSendCheck, type CommsEmailReadiness,
} from "../_shared/comms-email/readiness.ts";

export const LEAD_REPLY_ACTION_KIND = "owner.lead_followup";
export const LEAD_REPLY_STEP = "lead_reply_draft";
export const LEAD_REPLY_SOURCE = "growth_form";

// Drafting cost caps, per business — the drafting twin of the processor's alert caps.
export const LEAD_REPLIES_PER_BUSINESS_PER_HOUR = 20;
export const LEAD_REPLIES_PER_BUSINESS_PER_DAY = 100;
// Spam protection: the form is public, so anyone can type someone else's address into it. At most one
// reply draft per recipient per day stops the form being used to make a business email a stranger
// over and over, and stops a bot re-submitting one address from burning drafting cost.
export const LEAD_REPLIES_PER_CONTACT_PER_DAY = 1;

// Bounds on what one draft carries to the composer (tokens are money; the text is untrusted).
const MAX_KEY_POINTS = 20;
const MAX_KEY_POINT_CHARS = 500;
const MAX_NAME_CHARS = 120;

// The tenants.account_type values that get reply drafts. MUST equal the 'lead_reply' declaration in
// src/lib/tier/tierFeatures.ts (§60 one home; §61 default): Solo ('standalone', which also covers a
// legacy parented sub-account still typed 'standalone'), Sub-account ('sub_account') and Enterprise
// (the hybrid tier, Solo ∪ Agency) — YES; a pure Agency — NO (it manages sub-accounts, not a lead book;
// reselling is a separate Marketplace mechanism). God is the operator, not a tenant row. Pinned by
// src/lib/tier/tierFeatures.test.ts, which reads this line.
export const LEAD_REPLY_ACCOUNT_TYPES: ReadonlySet<string> = new Set(["standalone", "sub_account", "enterprise"]);

// A business that is open (the platform's own live-business set, owner ruling 2026-09-29 — the same
// set growth-public-submit accepts submissions for). Anything else (canceled, suspended) or an
// archived business spends no drafting.
export const LEAD_REPLY_BUSINESS_STATUSES: ReadonlySet<string> = new Set(["trial", "active", "past_due"]);

export const LEAD_REPLY_INTENT =
  "Reply personally to someone who just asked about the business through its website form; thank them, answer what they asked if possible from their answers, and propose one clear next step";

type Obj = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
/** One line of untrusted text: control characters and line breaks collapse to single spaces. */
const oneLine = (v: string, max: number): string =>
  // deno-lint-ignore no-control-regex
  v.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

export type ExecOutcome = { status: "done" | "error"; result: Obj; error?: string };
export type PlanStep = {
  automationId: string | null; slug: string; executor: string; lane: string | null;
  config: Obj; targetConfig: Obj;
};

/** A business that answers its own leads: standalone (Solo), sub_account or enterprise. Never agency. */
export function isLeadReplyBusiness(tenant: unknown): boolean {
  if (!tenant || typeof tenant !== "object") return false;
  return LEAD_REPLY_ACCOUNT_TYPES.has(String((tenant as Obj).account_type ?? ""));
}

/** The business is open: a live status and not archived. An unread status is closed (fail-closed). */
export function isLeadReplyBusinessOpen(tenant: unknown): boolean {
  if (!tenant || typeof tenant !== "object") return false;
  const t = tenant as Obj;
  return LEAD_REPLY_BUSINESS_STATUSES.has(String(t.status ?? "")) && (t.archived_at === null || t.archived_at === undefined);
}

/** Trim + lowercase, the comparison the identity gate uses. Non-strings are "". */
export function normalizeTypedEmail(v: unknown): string {
  return typeof v === "string" ? v.trim().toLowerCase() : "";
}

/** The form opted in to reply drafts. Strictly `true`: absent, null or anything else is off. */
export function leadReplyEnabled(form: unknown): boolean {
  return !!form && typeof form === "object" && (form as Obj).lead_reply_enabled === true;
}

/** The action kind a planned step files, if it is an action-bus step. */
function plannedActionKind(p: PlanStep): string | null {
  if (p.executor !== "paige_action" && p.executor !== "surface_to_client") return null;
  return str(p.config?.action_kind) ?? str(p.targetConfig?.action_kind);
}

/** True when this planned step files a reply draft (the synthesized step, or a form's own automation). */
export function filesLeadReply(p: PlanStep): boolean {
  return p.executor === LEAD_REPLY_STEP || plannedActionKind(p) === LEAD_REPLY_ACTION_KIND;
}

/**
 * Add the unledgered lead-reply step to a submission's plan, after every other step (so the intake's
 * contact exists when it runs). No step unless the form opted in and the business's tier answers its
 * own leads; no step when one is already planned (the form's own owner.lead_followup automation runs
 * through fileLeadReply itself).
 */
export function appendLeadReply(plan: PlanStep[], form: unknown, tenant: unknown): void {
  if (!leadReplyEnabled(form)) return;
  if (!isLeadReplyBusiness(tenant)) return;
  // Opting in to a personal lead reply also needs the existing contact resolver. A
  // form without pipeline routing must not silently create a no_contact dead end.
  if (!plan.some((step) => step.executor === "contact_upsert")) {
    plan.unshift({ automationId: null, slug: "contact_upsert", executor: "contact_upsert", lane: null, config: {}, targetConfig: {} });
  }
  if (plan.some(filesLeadReply)) return;
  plan.push({ automationId: null, slug: "lead_reply", executor: LEAD_REPLY_STEP, lane: null, config: {}, targetConfig: {} });
}

/** The visitor's labelled answers as composer key points ("Label: value") — one line each, bounded. */
export function leadReplyKeyPoints(answers: Array<{ label: string; value: string }>): string[] {
  return answers
    .map((a) => oneLine(`${oneLine(String(a.label ?? ""), 200)}: ${String(a.value ?? "")}`, MAX_KEY_POINT_CHARS))
    .filter((p) => p.length > 0)
    .slice(0, MAX_KEY_POINTS);
}

/** The paige_actions.payload this step files. No recipient address, sender or tenant — ever. */
export function leadReplyPayload(input: {
  submissionId: string; formId: string; keyPoints: string[]; recipientName: string | null;
}): Obj {
  return {
    submission_id: input.submissionId,
    form_id: input.formId,
    source: LEAD_REPLY_SOURCE,
    draft_input: {
      intent: LEAD_REPLY_INTENT,
      key_points: input.keyPoints,
      tone: "warm",
      length: "short",
      ...(input.recipientName ? { recipient_name: input.recipientName } : {}),
    },
  };
}

type DbError = { code?: unknown; message?: unknown } | null | undefined;

/**
 * A failure that never reached a database answer: retried, because nothing was refused. No code (the
 * request itself failed), PostgREST connection/schema-cache/pool codes PGRST000-003, Postgres
 * connection 08*, resources 53*, operator intervention 57*, serialization 40001 and deadlock 40P01.
 * The same rule as the processor's pipeline_attach_default step.
 */
export function isTransientDbError(error: DbError): boolean {
  if (!error) return false;
  const code = error.code ? String(error.code) : "";
  return code === "" || code === "40001" || code === "40P01" || /^PGRST00[0-3]$/.test(code) || /^(08|53|57)/.test(code);
}

/**
 * Whether the email door's readiness lets a reply to this recipient be drafted. Ready → yes. Held by a
 * quiet window (tenant DND / quiet hours) → yes: the door holds the send, not the draft. Anything else
 * → no, with the reason: a sender that is not usable, a recipient who is suppressed / opted out / on
 * do-not-disturb, or preferences that could not be verified.
 */
export function leadReplyReadinessBlock(r: CommsEmailReadiness): string | null {
  if (r.state === "ready") return null;
  if (r.state === "held" && r.reason.startsWith("QUEUED_")) return null;
  if (r.state === "needs_setup") return `email_sender_not_ready:${r.reason}`;
  if (r.state === "unavailable") return "email_readiness_unreadable";
  if (r.reason.startsWith("BLOCKED_")) return `recipient_blocked:${r.reason}`;
  return "recipient_preferences_unverified";
}

// The service client: supabase-js in the processor, an in-memory double in the tests. Its `from` also
// satisfies CommsEmailAdmin, which is how the readiness resolver reads through it.
// deno-lint-ignore no-explicit-any
export type LeadReplyAdmin = { rpc: (fn: string, args: Obj) => PromiseLike<{ data: any; error: any }>; from: (table: string) => any };

export type LeadReplyInput = {
  tenantId: string;
  /** The claimed submission's business row (account_type, status, archived_at). Checked here. */
  business: unknown;
  /** growth_forms.lead_reply_enabled === true — the ONE opt-in, for the synthesized step AND a form's
   *  own owner.lead_followup automation. */
  formOptedIn: boolean;
  /** The email address the visitor typed into the form (as extracted by the processor), or null. */
  submittedEmail: string | null;
  submissionId: string;
  formId: string;
  formName: string | null;
  contactId: string | null;
  answers: Array<{ label: string; value: string }>;
  visitorName: string | null;
  now?: Date;
};

export type LeadReplyDeps = {
  /** Environment reader for provider configuration (Deno.env.get in the processor). */
  env: (key: string) => string | undefined;
  /** The recipient pre-send check (_shared/pre-send-pipeline.ts runPreSend), injected. */
  preSendCheck: CommsEmailPreSendCheck;
  resolveParties?: (admin: CommsEmailAdmin, input: { tenantId: string; contactId: string; connectorId: string | null }, providers: readonly string[]) => Promise<CommsEmailParties>;
};

/** File one reply draft for this lead, or report — and record — why not. */
export async function fileLeadReply(admin: LeadReplyAdmin, input: LeadReplyInput, deps: LeadReplyDeps): Promise<ExecOutcome> {
  const resolveParties = deps.resolveParties ?? resolveCommsEmailParties;
  const now = input.now ?? new Date();

  // Recorded on the submission so the account can show why this lead got no reply draft.
  const notDrafted = async (reason: string, extra: Obj = {}): Promise<ExecOutcome> => {
    const result: Obj = { note: "lead_reply_not_drafted", reason, ...extra };
    const { error } = await admin.from("growth_form_submissions")
      .update({ lead_reply_skipped_reason: reason })
      .eq("id", input.submissionId).eq("tenant_id", input.tenantId);
    if (error) result.mark_error = String(error.message ?? error.code ?? "unknown").slice(0, 200);
    return { status: "done", result };
  };
  const retry = (what: string, error: DbError): ExecOutcome =>
    ({ status: "error", result: {}, error: `lead_reply_${what}: ${String(error?.message ?? "no answer").slice(0, 200)}` });

  if (input.formOptedIn !== true) return notDrafted("form_not_opted_in");
  if (!isLeadReplyBusiness(input.business)) return notDrafted("business_not_eligible");
  if (!isLeadReplyBusinessOpen(input.business)) return notDrafted("business_not_active");
  if (!input.contactId) return notDrafted("no_contact");

  // 1. Already drafted for this submission? (A retry, or a re-claimed submission.)
  const existing = await admin.from("paige_actions")
    .select("id, status")
    .eq("tenant_id", input.tenantId)
    .eq("action_kind", LEAD_REPLY_ACTION_KIND)
    .eq("payload->>submission_id", input.submissionId)
    .limit(1).maybeSingle();
  if (existing.error) {
    if (isTransientDbError(existing.error)) return retry("existing_read_failed", existing.error);
    return notDrafted("lead_reply_unavailable");
  }
  if (existing.data?.id) {
    return { status: "done", result: { note: "lead_reply_already_drafted", action_id: existing.data.id, status: existing.data.status ?? null } };
  }

  // 2. Who would it go to, and from whom? Recipient = the contact's primary email; sender = the
  //    business's ONLY active email connector. Resolved server-side, never from form or model text.
  //    The sender list is the email door's own (comms-email-command: emailProvidersFor over the PRESENCE
  //    of the platform Mail Send key), so a business whose only sender is PAIGE Email (SendGrid) gets a
  //    draft, and a business with two senders is counted the same here as at the door.
  const providers = emailProvidersFor({ sendgridConfigured: !!deps.env("SENDGRID_MAIL_SEND_API_KEY") });
  let parties: CommsEmailParties;
  try {
    parties = await resolveParties(admin, { tenantId: input.tenantId, contactId: input.contactId, connectorId: null }, providers);
  } catch {
    return notDrafted("email_readiness_unreadable");
  }
  if (parties.kind === "contact_not_in_workspace") return notDrafted("contact_not_in_workspace");
  if (parties.kind === "recipient_missing") return notDrafted("no_contact_email");
  // The intake may have matched this contact by PHONE. Only the person whose address was typed into
  // the form gets a reply: anything else is someone else's contact record.
  const typed = normalizeTypedEmail(input.submittedEmail);
  if (!typed || typed !== normalizeTypedEmail(parties.recipient)) return notDrafted("submitted_email_not_contact_email");
  if (parties.kind === "sender_missing") return notDrafted("no_email_sender");
  // Several senders: the reply screen sends from one verified identity and cannot choose yet, so a
  // draft here would be one nobody can send. Recorded, not guessed.
  if (parties.kind === "sender_choice_required") return notDrafted("several_email_senders", { sender_count: parties.senders.length });

  // 3. Could this reply go out? The email door's own readiness: the sender is usable
  //    (emailSenderReadiness) and the recipient is not suppressed, opted out or on do-not-disturb.
  const readiness = await readCommsEmailReadiness(
    admin as unknown as CommsEmailAdmin,
    { tenantId: input.tenantId, contactId: parties.contactId, recipient: parties.recipient, connectorId: parties.connectorId },
    deps.env,
    deps.preSendCheck,
  );
  const blocked = leadReplyReadinessBlock(readiness);
  if (blocked) return notDrafted(blocked);

  // 4. Caps: this business's reply drafts in the last hour / day, and this recipient's in the last day.
  //    `upTo` (the re-count after filing): only rows created at or before ours, ours excluded.
  const filedSince = async (hours: number, contactId: string | null, upTo?: { createdAt: string; id: string }) => {
    let q = admin.from("paige_actions")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", input.tenantId)
      .eq("action_kind", LEAD_REPLY_ACTION_KIND);
    if (contactId) q = q.eq("contact_id", contactId);
    q = q.gte("created_at", new Date(now.getTime() - hours * 3600_000).toISOString());
    if (upTo) q = q.lte("created_at", upTo.createdAt).neq("id", upTo.id);
    const { count, error } = await q;
    return { count: error ? null : (count ?? 0), error };
  };
  const overCap = (hourCount: number, dayCount: number, contactCount: number): string | null =>
    contactCount >= LEAD_REPLIES_PER_CONTACT_PER_DAY ? "contact_daily_cap"
      : hourCount >= LEAD_REPLIES_PER_BUSINESS_PER_HOUR ? "business_hourly_cap"
      : dayCount >= LEAD_REPLIES_PER_BUSINESS_PER_DAY ? "business_daily_cap"
      : null;
  const hour = await filedSince(1, null);
  const day = await filedSince(24, null);
  const recipientDay = await filedSince(24, input.contactId);
  if (hour.count === null || day.count === null || recipientDay.count === null) {
    const error = hour.error ?? day.error ?? recipientDay.error;
    if (isTransientDbError(error)) return retry("cap_read_failed", error);
    return notDrafted("cap_unreadable");
  }
  if (recipientDay.count >= LEAD_REPLIES_PER_CONTACT_PER_DAY) {
    return notDrafted("contact_daily_cap", { contact_last_day: recipientDay.count });
  }
  if (hour.count >= LEAD_REPLIES_PER_BUSINESS_PER_HOUR || day.count >= LEAD_REPLIES_PER_BUSINESS_PER_DAY) {
    const reason = hour.count >= LEAD_REPLIES_PER_BUSINESS_PER_HOUR ? "business_hourly_cap" : "business_daily_cap";
    return notDrafted(reason, { business_last_hour: hour.count, business_last_day: day.count });
  }

  // 5. File the draft request. The kind's default lane (confirm) applies; it always needs the owner.
  //    The name is the STORED contact's (the record the reply goes to); the typed name only when the
  //    record has none.
  const visitor = str(input.visitorName) ? oneLine(input.visitorName as string, MAX_NAME_CHARS) : null;
  const contactName = parties.contactName && parties.contactName !== "this contact" ? oneLine(parties.contactName, MAX_NAME_CHARS) : null;
  const recipientName = contactName || visitor || null;
  const { data: filed, error: fileErr } = await admin.rpc("file_action", {
    p_action_kind: LEAD_REPLY_ACTION_KIND,
    p_title: `Reply to ${recipientName ?? "a new lead"} - ${oneLine(input.formName ?? "form", 120) || "form"}`,
    p_summary: null,
    p_contact_id: input.contactId,
    p_payload: leadReplyPayload({
      submissionId: input.submissionId, formId: input.formId,
      keyPoints: leadReplyKeyPoints(input.answers), recipientName,
    }),
    p_from_department: null,
    p_to_department: null,
    p_priority: null,
    p_due_at: null,
    p_conversation_id: null,
    p_parent_action_id: null,
    p_created_by_agent: "paige",
    p_tenant_id: input.tenantId,
    p_autonomy_lane: null,
  });
  if (fileErr) {
    // Lost a race with another attempt for the same submission: the draft exists — that is success.
    if (String(fileErr.code ?? "") === "23505") return { status: "done", result: { note: "lead_reply_already_drafted" } };
    if (isTransientDbError(fileErr)) return retry("file_failed", fileErr);
    const code = /^[A-Z][A-Z0-9_]{2,63}/.exec(String(fileErr.message ?? ""))?.[0] ?? String(fileErr.code ?? "rpc_error");
    return notDrafted(`file_refused:${code}`);
  }
  if (!filed?.ok || !str(filed?.action_id)) return notDrafted("file_refused:no_result");
  const actionId = str(filed.action_id) as string;
  const result: Obj = { action_id: actionId, action_kind: LEAD_REPLY_ACTION_KIND, status: filed.status ?? "filed" };

  // 6. The race bound (see CAPS above): count again, over the rows created at or before ours. If ours
  //    is over a cap, dismiss it before the drafting worker claims it. A re-count that cannot be read
  //    keeps the draft (the pre-check above already held) and says so.
  const mine = await admin.from("paige_actions")
    .select("id, created_at")
    .eq("id", actionId).eq("tenant_id", input.tenantId)
    .maybeSingle();
  const createdAt = mine.error ? null : str(mine.data?.created_at);
  if (!createdAt) {
    result.cap_recheck = "unreadable";
  } else {
    const upTo = { createdAt, id: actionId };
    const [h2, d2, c2] = [await filedSince(1, null, upTo), await filedSince(24, null, upTo), await filedSince(24, input.contactId, upTo)];
    if (h2.count === null || d2.count === null || c2.count === null) {
      result.cap_recheck = "unreadable";
    } else {
      const overflow = overCap(h2.count, d2.count, c2.count);
      if (overflow) {
        const { error: dismissErr } = await admin.rpc("advance_action", {
          p_action_id: actionId,
          p_to_status: "dismissed",
          p_error: `lead_reply_cap_overflow:${overflow}`,
          p_tenant_id: input.tenantId,
        });
        if (dismissErr) {
          // Not dismissed: the draft stands and is reported as over the cap, never hidden.
          result.cap_overflow = overflow;
          result.dismiss_error = String(dismissErr.message ?? dismissErr.code ?? "unknown").slice(0, 200);
        } else {
          return notDrafted(overflow, { dismissed_action_id: actionId, race: "filed_then_dismissed" });
        }
      }
    }
  }
  // A retry that now drafted clears an earlier attempt's reason (e.g. no_contact before the contact
  // step succeeded). The draft is filed either way; a failed clear is reported, not retried.
  const { error: clearErr } = await admin.from("growth_form_submissions")
    .update({ lead_reply_skipped_reason: null })
    .eq("id", input.submissionId).eq("tenant_id", input.tenantId)
    .not("lead_reply_skipped_reason", "is", null);
  if (clearErr) result.mark_error = String(clearErr.message ?? clearErr.code ?? "unknown").slice(0, 200);
  return { status: "done", result };
}
