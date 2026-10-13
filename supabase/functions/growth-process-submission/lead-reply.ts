// growth-process-submission — the lead-reply step (Experience 03 · S3 "PAIGE works your leads").
//
// When someone fills in a Solo business's form, PAIGE drafts a personal reply to them for the owner
// to approve. This module decides WHETHER to file that draft and files it; it never writes the email
// and never sends anything:
//
//   processor (here) → file_action(owner.lead_followup, {submission_id, form_id, source, draft_input})
//   → paige-action-worker asks email-composer for the draft and stores draft_content
//   → advance_action mints the paige_pending_approvals row (owner.lead_followup requires approval)
//   → the owner approves in the existing approvals queue → execute-approval sends via send-message.
//
// THE PLAN DECISION (appendLeadReply, no I/O): the step is added only for a Solo business
// (parent_tenant_id IS NULL and account_type = 'standalone'), and only when the form has no enabled
// paige_action automation of its own — a business that already configured "Draft Paige's follow-up"
// keeps exactly what it configured, never a second draft. The step is unledgered (no automation row,
// like applyIntakeSettings' email_alert): adding a growth_form_automations row would switch the form
// off the legacy column fallback and silently drop its auto_create_contact step (§58).
//
// THE RUN DECISION (fileLeadReply): the step files nothing unless the intake produced a contact, that
// contact has an email on file, and the business has an active email sender — resolved by the one
// comms-email resolver, so nothing is drafted for an email that cannot go out. A per-business hourly
// and daily cap bounds drafting cost. Every reason a draft is not filed is reported as it is and
// recorded on the submission (lead_reply_skipped_reason) — never presented as a draft that was made.
//
// AUTHORITY (§9/§59): the tenant is the CLAIMED submission's tenant, passed in by the processor; the
// contact is the intake's contact. Nothing here reads a tenant, contact or recipient from a request
// body or from model output. The action is filed at the kind's default lane (p_autonomy_lane null →
// confirm); owner.lead_followup is a send_via_approval kind, so advance_action always routes it to the
// owner's approval regardless of lane.
//
// NEVER FAILS A LEAD THAT USED TO PROCESS (§58): this step was added to forms that already processed
// cleanly. Only a failure that never reached a database answer (connection, pool, stale claim) is
// returned as an error for the sweeper to retry — safe, because the existing-action check and the
// unique index (20271030000000) make a retry file at most one draft. Every other refusal is "done"
// with its reason.
//
// Pure TypeScript with erasable syntax only (no Deno globals), so node --test and Deno both load it.

import { resolveCommsEmailParties, type CommsEmailAdmin, type CommsEmailParties } from "../_shared/comms-email/readiness.ts";

export const LEAD_REPLY_ACTION_KIND = "owner.lead_followup";
export const LEAD_REPLY_STEP = "lead_reply_draft";

// Drafting cost caps, per business — the drafting twin of the processor's alert caps.
export const LEAD_REPLIES_PER_BUSINESS_PER_HOUR = 20;
export const LEAD_REPLIES_PER_BUSINESS_PER_DAY = 100;

// Bounds on what one draft carries to the composer (tokens are money).
const MAX_KEY_POINTS = 20;
const MAX_KEY_POINT_CHARS = 500;

export const LEAD_REPLY_INTENT =
  "Reply personally to someone who just asked about the business through its website form; thank them, answer what they asked if possible from their answers, and propose one clear next step";

type Obj = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

export type ExecOutcome = { status: "done" | "error"; result: Obj; error?: string };
export type PlanStep = {
  automationId: string | null; slug: string; executor: string; lane: string | null;
  config: Obj; targetConfig: Obj;
};

/** Solo = a top-level standalone business. A sub-account (parented) or an agency never qualifies. */
export function isSoloBusiness(tenant: unknown): boolean {
  if (!tenant || typeof tenant !== "object") return false;
  const t = tenant as Obj;
  return (t.parent_tenant_id === null || t.parent_tenant_id === undefined) && t.account_type === "standalone";
}

/**
 * Add the unledgered lead-reply step to a submission's plan, after every other step (so the intake's
 * contact exists when it runs). No step for a non-Solo business, for a form with an enabled
 * paige_action automation of its own, or when the step is already planned.
 */
export function appendLeadReply(plan: PlanStep[], form: unknown, tenant: unknown): void {
  if (!form || typeof form !== "object") return;
  if (!isSoloBusiness(tenant)) return;
  if (plan.some((p) => p.executor === "paige_action" || p.executor === LEAD_REPLY_STEP)) return;
  plan.push({ automationId: null, slug: "lead_reply", executor: LEAD_REPLY_STEP, lane: null, config: {}, targetConfig: {} });
}

/** The visitor's labelled answers as composer key points ("Label: value"), bounded. */
export function leadReplyKeyPoints(answers: Array<{ label: string; value: string }>): string[] {
  return answers.slice(0, MAX_KEY_POINTS).map((a) => `${a.label}: ${a.value}`.slice(0, MAX_KEY_POINT_CHARS));
}

/** The paige_actions.payload this step files. */
export function leadReplyPayload(input: {
  submissionId: string; formId: string; keyPoints: string[]; recipientName: string | null;
}): Obj {
  return {
    submission_id: input.submissionId,
    form_id: input.formId,
    source: "growth_form",
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

// The service client: supabase-js in the processor, an in-memory double in the tests. Its `from` also
// satisfies CommsEmailAdmin, which is how the readiness resolver reads through it.
// deno-lint-ignore no-explicit-any
export type LeadReplyAdmin = { rpc: (fn: string, args: Obj) => PromiseLike<{ data: any; error: any }>; from: (table: string) => any };

export type LeadReplyInput = {
  tenantId: string;
  submissionId: string;
  formId: string;
  formName: string | null;
  contactId: string | null;
  answers: Array<{ label: string; value: string }>;
  visitorName: string | null;
  now?: Date;
};

export type LeadReplyDeps = {
  resolveParties?: (admin: CommsEmailAdmin, input: { tenantId: string; contactId: string; connectorId: string | null }) => Promise<CommsEmailParties>;
};

/** File one reply draft for this lead, or report — and record — why not. */
export async function fileLeadReply(admin: LeadReplyAdmin, input: LeadReplyInput, deps: LeadReplyDeps = {}): Promise<ExecOutcome> {
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

  // 2. Can an email to this person actually go out? Recipient = the contact's primary email; sender =
  //    an active email connector of this business. Resolved server-side, never from model output.
  let parties: CommsEmailParties;
  try {
    parties = await resolveParties(admin, { tenantId: input.tenantId, contactId: input.contactId, connectorId: null });
  } catch {
    return notDrafted("email_readiness_unreadable");
  }
  if (parties.kind === "contact_not_in_workspace") return notDrafted("contact_not_in_workspace");
  if (parties.kind === "recipient_missing") return notDrafted("no_contact_email");
  if (parties.kind === "sender_missing") return notDrafted("no_email_sender");
  // "resolved" (one sender) and "sender_choice_required" (several) can both send.

  // 3. Cost cap: reply drafts this business filed in the last hour / day. Unreadable → no draft.
  const filedSince = async (hours: number) => {
    const { count, error } = await admin.from("paige_actions")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", input.tenantId)
      .eq("action_kind", LEAD_REPLY_ACTION_KIND)
      .gte("created_at", new Date(now.getTime() - hours * 3600_000).toISOString());
    return { count: error ? null : (count ?? 0), error };
  };
  const hour = await filedSince(1);
  const day = await filedSince(24);
  if (hour.count === null || day.count === null) {
    const error = hour.error ?? day.error;
    if (isTransientDbError(error)) return retry("cap_read_failed", error);
    return notDrafted("cap_unreadable");
  }
  if (hour.count >= LEAD_REPLIES_PER_BUSINESS_PER_HOUR || day.count >= LEAD_REPLIES_PER_BUSINESS_PER_DAY) {
    const reason = hour.count >= LEAD_REPLIES_PER_BUSINESS_PER_HOUR ? "business_hourly_cap" : "business_daily_cap";
    return notDrafted(reason, { business_last_hour: hour.count, business_last_day: day.count });
  }

  // 4. File the draft request. The kind's default lane (confirm) applies; it always needs approval.
  const contactName = parties.contactName && parties.contactName !== "this contact" ? parties.contactName : null;
  const recipientName = str(input.visitorName) ?? contactName;
  const { data: filed, error: fileErr } = await admin.rpc("file_action", {
    p_action_kind: LEAD_REPLY_ACTION_KIND,
    p_title: `Reply to ${recipientName ?? "a new lead"} - ${input.formName ?? "form"}`,
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
  const result: Obj = { action_id: filed.action_id, action_kind: LEAD_REPLY_ACTION_KIND, status: filed.status ?? "filed" };
  // A retry that now drafted clears an earlier attempt's reason (e.g. no_contact before the contact
  // step succeeded). The draft is filed either way; a failed clear is reported, not retried.
  const { error: clearErr } = await admin.from("growth_form_submissions")
    .update({ lead_reply_skipped_reason: null })
    .eq("id", input.submissionId).eq("tenant_id", input.tenantId)
    .not("lead_reply_skipped_reason", "is", null);
  if (clearErr) result.mark_error = String(clearErr.message ?? clearErr.code ?? "unknown").slice(0, 200);
  return { status: "done", result };
}
