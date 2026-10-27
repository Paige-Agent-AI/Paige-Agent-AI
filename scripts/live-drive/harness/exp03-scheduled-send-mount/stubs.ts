// Deterministic data boundary for the EXP03 "approve now, send later" inbox harness. HARNESS RENDER · SYNTHETIC
// DATA · NOT LIVE: every name, address and number is fictional (Northwind Studio, its client Jordan Rivera, two
// other fictional clients). The signed-in Solo inbox is a separate, owed check (§32/§70.1).
//
// "Mock the provider, never the contract" (harness README). The row shapes mirror what the inbox selects
// (MESSAGE_COLS + GOVERNED_SEND_COLS: comms_email_send_at / comms_email_reason are the two new JSON paths) and
// what migration 20271119000000 writes:
//   - a scheduled governed email: messages.status 'queued', scheduled_for = send_at, binding state 'prepared'
//     with send_at (prepare_comms_email_send);
//   - closed (cancel, missed release, a refusal at release): binding state 'refused' + outcome_reason,
//     status 'blocked', error = the code, scheduled_for NULL (close_scheduled_comms_email).
// The comms-email-command cancel answers mirror supabase/functions/comms-email-command/index.ts at this head:
//   200 { ok:true, cancelled:true, outcome:'refused', reason:'CANCELLED_BY_OWNER' } — or a 409
//   { ok:false, cancelled:false, code:'COMMS_EMAIL_CANCEL_TOO_LATE', outcome, reason? } / a 503
//   COMMS_EMAIL_CANCEL_UNVERIFIED, delivered as a FunctionsHttpError whose context is the Response.
// The inbox's own rules (governedSendView, isScheduledMessage, scheduledForLabel, governedNotSentLine,
// cancelTooLateLine) are NOT stubbed: they run as shipped.
//   ?state=scheduled  Jordan's thread: an inbound, a Sent reply, and an approved email scheduled for tomorrow
//                     09:00 local — the newest message, so the thread list carries "Scheduled · …"
//   ?state=notsent    the same thread with two scheduled emails that did not go out: one refused at release
//                     (blocked_client_dnd) and, newest, one still 'queued'/'prepared' 20 minutes past its time
//                     (past the 15-minute release grace) — the list must NOT read "Scheduled"
//   ?cancel=ok|toolate|already|didnt|error|hang   what the door answers to Cancel (hang = never answers)

const params = new URLSearchParams(window.location.search);
const state = params.get("state") ?? "scheduled";
const cancelMode = params.get("cancel") ?? "ok";

export const TENANT = "e0300000-0000-4000-8000-00000000b003";
const OWNER = "e0300000-0000-4000-8000-00000000a003";
const JORDAN = "e0300000-0000-4000-8000-0000000c0001";
const PRIYA = "e0300000-0000-4000-8000-0000000c0002";
const SAM = "e0300000-0000-4000-8000-0000000c0003";
const OPERATION = "e0300000-0000-4000-8000-0000000d0001";
const OPERATION_DND = "e0300000-0000-4000-8000-0000000d0002";
const key = (contact: string) => `contact:${TENANT}:${contact}`;

const NOW = Date.now();
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();
// Tomorrow at 09:00 in the browser's own zone (the drive pins America/Chicago).
const tomorrowNine = (() => { const d = new Date(NOW); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d.toISOString(); })();

const STUDIO = "studio@northwindstudio.example";
const JORDAN_EMAIL = "jordan.rivera@example.com";
const methodsOf = (email: string | null, phone: string | null) => [
  ...(email ? [{ id: `${email}-m`, kind: "email", value: email, label: "Work", is_primary: true, position: 0 }] : []),
  ...(phone ? [{ id: `${phone}-m`, kind: "phone", value: phone, label: "Mobile", is_primary: true, position: 1 }] : []),
];
const clientRow = (id: string, first: string, last: string, email: string | null, phone: string | null) => ({
  id, first_name: first, last_name: last, entity_name: null, entity_type: null, title: null,
  status: "active", lifecycle_stage: "client_active", source: "referral", tags: null, last_contacted_at: null,
  assigned_coach_user_id: null, linked_user_id: null, timezone: "America/Chicago", created_at: ago(60 * 24 * 40), created_by: null,
  created_by_channel_type: null, dnd_active: false, dnd_reason: null, dnd_until: null, portal_access_state: "open",
  client_contact_methods: methodsOf(email, phone),
});
const msgBase = (contact: string, first: string, last: string, email: string | null, phone: string | null) => ({
  thread_key: key(contact), contact_id: contact, connector_id: "conn-email", body_html: null, attachments: null,
  provider_message_id: null, in_reply_to_provider_id: null, action_id: null, error: null as string | null, scheduled_for: null as string | null,
  call_duration_seconds: null, recording_url: null, transcript: null,
  clients: { first_name: first, last_name: last, entity_name: null, client_contact_methods: methodsOf(email, phone) },
  comms_email_operation: null as string | null, comms_email_state: null as string | null, comms_email_prepared_at: null as string | null,
  comms_email_claimed_at: null as string | null, comms_email_send_at: null as string | null, comms_email_reason: null as string | null,
  sales_invoice_operation: null, sales_invoice_state: null,
});
const J = msgBase(JORDAN, "Jordan", "Rivera", JORDAN_EMAIL, null);
const out = (id: string, min: number, subject: string, body: string, status: string) => ({
  ...J, id, channel_type: "email", direction: "outbound", status,
  sender: { address: STUDIO }, recipients: [{ address: JORDAN_EMAIL }], subject, body_text: body,
  sent_at: status === "sent" ? ago(min) : null as string | null, created_at: ago(min),
});

const jordanIn = {
  ...J, id: "m-j-in", channel_type: "email", direction: "inbound", status: "received",
  sender: { address: JORDAN_EMAIL, display_name: "Jordan Rivera" }, recipients: [{ address: STUDIO }],
  subject: "Kitchen refresh — scope questions",
  body_text: "Hi! Before we sign off on phase two, can you confirm whether the cabinet hardware is in the quote?",
  sent_at: ago(60 * 26), created_at: ago(60 * 26),
};
const sent = out("m-j-sent", 60 * 25, "Re: Kitchen refresh — scope questions", "Hardware is included in the quote. I'll bring samples to Thursday's walkthrough.", "sent");

/** An approved governed email set to go out at `sendAt` (prepare_comms_email_send's row). */
const scheduledRow = (id: string, op: string, min: number, sendAt: string, subject: string, body: string) => ({
  ...out(id, min, subject, body, "queued"),
  scheduled_for: sendAt as string | null,
  comms_email_operation: op as string | null, comms_email_state: "prepared" as string | null, comms_email_prepared_at: ago(min) as string | null,
  comms_email_claimed_at: null as string | null, comms_email_send_at: sendAt as string | null, comms_email_reason: null as string | null,
});
/** close_scheduled_comms_email's writes: refused + reason, status 'blocked', error = the code, time cleared. */
const close = (row: ReturnType<typeof scheduledRow>, reason: string) => {
  row.comms_email_state = "refused"; row.comms_email_reason = reason; row.status = "blocked"; row.error = reason; row.scheduled_for = null;
};

const scheduled = scheduledRow("m-j-scheduled", OPERATION, 12, tomorrowNine, "Walkthrough reminder",
  "A reminder that our walkthrough is Thursday at 10. I'll bring the hardware samples — reply if the time no longer works.");
// Refused at release time: the recipient was in do-not-disturb when its time came.
const dnd = scheduledRow("m-j-dnd", OPERATION_DND, 60 * 3, ago(60 * 2), "Phase two start date",
  "Phase two starts on the 14th. The crew arrives at 8.");
close(dnd, "blocked_client_dnd");
// Past its time by 20 minutes (the release grace is 15) and never claimed: still 'queued' + 'prepared' on the row.
const missed = scheduledRow("m-j-missed", OPERATION, 60, ago(20), "Walkthrough reminder",
  "A reminder that our walkthrough is Thursday at 10. I'll bring the hardware samples — reply if the time no longer works.");

const jordanMessages: Array<Record<string, unknown>> = state === "notsent" ? [jordanIn, sent, dnd, missed] : [jordanIn, sent, scheduled];

const P = msgBase(PRIYA, "Priya", "Okafor", "priya.okafor@example.com", null);
const priyaEmail = {
  ...P, id: "m-p-email", channel_type: "email", direction: "inbound", status: "received",
  sender: { address: "priya.okafor@example.com", display_name: "Priya Okafor" }, recipients: [{ address: STUDIO }],
  subject: "Invoice question", body_text: "Quick one — is the deposit refundable if we push the start date?", sent_at: ago(60 * 5), created_at: ago(60 * 5),
};
const S = msgBase(SAM, "Sam", "Delgado", "sam.delgado@example.com", null);
const samEmail = {
  ...S, id: "m-s-email", channel_type: "email", direction: "outbound", status: "sent",
  sender: { address: STUDIO }, recipients: [{ address: "sam.delgado@example.com" }], subject: "See you Monday",
  body_text: "Thanks Sam — see you Monday.", sent_at: ago(60 * 30), created_at: ago(60 * 30),
};

const messages = () => [...jordanMessages, priyaEmail, samEmail];
const jordanLast = () => jordanMessages[jordanMessages.length - 1] as { created_at: string };

const threads = () => [
  {
    id: "t-jordan", thread_key: key(JORDAN), contact_id: JORDAN, snoozed_until: null, archived_at: null, labels: [],
    unread_count: 0, last_message_at: jordanLast().created_at, last_direction: "outbound",
    clients: clientRow(JORDAN, "Jordan", "Rivera", JORDAN_EMAIL, null),
  },
  {
    id: "t-priya", thread_key: key(PRIYA), contact_id: PRIYA, snoozed_until: null, archived_at: null, labels: [],
    unread_count: 1, last_message_at: priyaEmail.sent_at, last_direction: "inbound",
    clients: clientRow(PRIYA, "Priya", "Okafor", "priya.okafor@example.com", null),
  },
  {
    id: "t-sam", thread_key: key(SAM), contact_id: SAM, snoozed_until: null, archived_at: null, labels: [],
    unread_count: 0, last_message_at: samEmail.sent_at, last_direction: "outbound",
    clients: clientRow(SAM, "Sam", "Delgado", "sam.delgado@example.com", null),
  },
];

const connectors = [
  { id: "conn-email", channel_type: "email", provider: "sendgrid", display_name: "Northwind Studio", from_address: STUDIO, from_name: "Northwind Studio", inbound_address: null, status: "active", active: true, created_at: ago(60 * 24 * 90) },
];

/** Every call is recorded so the drive can assert what the inbox actually invoked. */
export const harnessLog: { rpc: Array<{ name: string; args: unknown }>; tables: string[] } = { rpc: [], tables: [] };
(window as unknown as { __harness: typeof harnessLog }).__harness = harnessLog;

const tableRows = (table: string): unknown[] =>
  table === "messages" ? messages()
  : table === "threads" ? threads()
  : table === "channel_connectors" ? connectors
  : [];

function builder(table: string) {
  harnessLog.tables.push(table);
  const result = () => ({ data: tableRows(table), error: null, count: tableRows(table).length });
  const proxy: Record<string, unknown> = new Proxy({}, {
    get(_t, prop) {
      if (prop === "then") return (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(result()).then(ok, bad);
      if (prop === "single" || prop === "maybeSingle") return () => Promise.resolve({ data: null, error: null });
      return () => proxy;
    },
  });
  return proxy;
}

async function rpc(name: string, args: unknown) {
  harnessLog.rpc.push({ name, args });
  if (name === "current_user_tenant_id") return { data: TENANT, error: null };
  if (name === "tenant_comms_readiness") {
    return { data: { tenant_id: TENANT, can_send_sms: false, a2p: "not_started", number_e164: null, delivery: { state: "not_configured", last_inbound_at: null, inbound_reporting: "unavailable" } }, error: null };
  }
  if (name === "get_tenant_assignable_members") return { data: [], error: null };
  return { data: null, error: null };
}

/** A refusal arrives the way supabase-js delivers a non-2xx: FunctionsHttpError with the Response as context. */
const httpError = (status: number, body: Record<string, unknown>) => ({
  data: null,
  error: { name: "FunctionsHttpError", message: "Edge Function returned a non-2xx status code", context: { status, json: async () => body } },
});

/** comms-email-command, cancel only: answers per ?cancel=, and writes what the database would have written. */
async function invoke(name: string, opts?: { body?: Record<string, unknown> }) {
  harnessLog.rpc.push({ name: `functions:${name}`, args: opts?.body ?? null });
  if (name !== "comms-email-command" || opts?.body?.cancel !== true) return { data: null, error: { message: "harness: no such edge function" } };
  const operation = String(opts.body.operation_id);
  const row = jordanMessages.find((m) => m.comms_email_operation === operation) as ReturnType<typeof scheduledRow> | undefined;
  if (cancelMode === "hang") return new Promise(() => undefined);
  if (cancelMode === "ok") {
    if (row) close(row, "cancelled_by_owner");
    return { data: { ok: true, cancelled: true, outcome: "refused", reason: "CANCELLED_BY_OWNER", operation_id: operation, message_id: row?.id }, error: null };
  }
  if (cancelMode === "toolate") {
    // The drainer's claim took it a moment before the cancel: binding 'dispatching', claimed just now.
    if (row) { row.comms_email_state = "dispatching"; row.comms_email_claimed_at = new Date().toISOString(); }
    return httpError(409, { ok: false, cancelled: false, code: "COMMS_EMAIL_CANCEL_TOO_LATE", outcome: "outcome_unknown", operation_id: operation });
  }
  if (cancelMode === "already") {
    // A teammate's cancel landed first.
    if (row) close(row, "cancelled_by_owner");
    return httpError(409, { ok: false, cancelled: false, code: "COMMS_EMAIL_CANCEL_TOO_LATE", outcome: "refused", reason: "cancelled_by_owner", operation_id: operation });
  }
  if (cancelMode === "didnt") {
    if (row) close(row, "scheduled_release_missed");
    return httpError(409, { ok: false, cancelled: false, code: "COMMS_EMAIL_CANCEL_TOO_LATE", outcome: "refused", reason: "scheduled_release_missed", operation_id: operation });
  }
  // No readable answer from the database: the cancel may or may not have landed; the row is unchanged.
  return httpError(503, { ok: false, cancelled: false, code: "COMMS_EMAIL_CANCEL_UNVERIFIED", operation_id: operation });
}

const channel: Record<string, unknown> = { on: () => channel, subscribe: () => channel, unsubscribe: () => undefined };

export const supabase = {
  from: (table: string) => builder(table),
  rpc,
  channel: () => channel,
  removeChannel: () => undefined,
  auth: {
    getUser: async () => ({ data: { user: { id: OWNER } } }),
    getSession: async () => ({ data: { session: null } }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
  },
  functions: { invoke },
  storage: { from: () => ({ upload: async () => ({ data: null, error: null }), remove: async () => ({ data: null, error: null }), createSignedUrl: async () => ({ data: null, error: null }) }) },
};

export function useTenantContext() {
  return {
    activeTenantId: TENANT,
    activeTenant: { id: TENANT, name: "Northwind Studio", account_type: "standalone", parent_tenant_id: null, account_number: 42 },
    activeUserId: OWNER, accountContextStatus: "ready",
    accountContextLoading: false, loading: false, isPlatformStaff: false, isPlatformOwner: false, refresh: () => undefined,
  };
}
export function useOptionalTenantContext() { return useTenantContext(); }
export function TenantProvider({ children }: { children: unknown }) { return children; }
export function useUserRoles() { return { loading: false, userId: OWNER, roles: ["admin"], isAdmin: true, isClient: false, isStaff: true }; }

export function useTenantRelationshipsData() {
  return {
    people: [], peopleLoading: false, peopleError: false, retryPeople: async () => undefined, peopleAvailable: true,
    deepLinkedPerson: null, deepLinkLoading: false, deepLinkError: false, retryDeepLink: async () => undefined,
    portalConfig: {}, portalLoading: false, portalError: false, retryPortal: async () => undefined,
  };
}
export type RelationshipWorkspaceVariant = "clients" | "relationships";
