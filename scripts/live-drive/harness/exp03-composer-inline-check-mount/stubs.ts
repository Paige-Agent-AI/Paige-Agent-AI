// Deterministic data boundary for the EXP03 composer inline-check harness. HARNESS RENDER · SYNTHETIC DATA · NOT
// LIVE: every name, address and number is fictional (Northwind Studio, its clients Jordan Rivera and Priya Okafor).
// The signed-in Solo inbox is a separate, owed check (§32/§70.1).
//
// "Mock the provider, never the contract" (harness README). Rows mirror what the inbox selects (MESSAGE_COLS +
// GOVERNED_SEND_COLS); ids are UUIDs, as every production row is (the door's parser refuses anything else).
// comms-email-command answers mirror supabase/functions/comms-email-command/index.ts at this head:
//   check (no fingerprint)  202 { ok:false, outcome:'approval_required', fingerprint, operation_id, expires_at,
//                           preview:{ kind:'email', to_name, to_address, from_address, subject, body_text, send_at? } }
//                           — or a refusal: 422 needs_setup / refused / held with its reason, delivered as a
//                           FunctionsHttpError whose context is the Response
//   confirm (fingerprint)   200 { ok:true, outcome:'provider_accepted' | 'scheduled', … } and the row prepare +
//                           send-message write; or 503 { ok:false, outcome:'outcome_unknown' } with the row left
//                           'unknown'; or (door=hang) no answer at all
// The inbox's own rules (classifyDoorAnswer, useGovernedEmailReply, governedSendView) are NOT stubbed.
//   ?door=ok        a 202 check, then the confirm is accepted (or scheduled when a send time was picked)
//   ?door=hang      a 202 check, then the confirm never answers (Sending…)
//   ?door=unknown   a 202 check, then the confirm's answer is unknown (503 outcome_unknown)
//   ?door=expire    a 202 check that the door holds for only ~6.5 seconds (to render the expired face)
//   ?door=suppressed|noconsent|clientdnd|tenantdnd|nosender|noemail   the check is refused with that reason;
//                   noemail also removes the main email from Jordan's contact card

const params = new URLSearchParams(window.location.search);
const door = params.get("door") ?? "ok";

export const TENANT = "e0300000-0000-4000-8000-00000000b003";
const OWNER = "e0300000-0000-4000-8000-00000000a003";
const JORDAN = "e0300000-0000-4000-8000-0000000c0001";
const PRIYA = "e0300000-0000-4000-8000-0000000c0002";
const CONNECTOR = "e0300000-0000-4000-8000-0000000e0001";
const MESSAGE = "e0300000-0000-4000-8000-0000000f0001";
const key = (contact: string) => `contact:${TENANT}:${contact}`;

const NOW = Date.now();
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();

const STUDIO = "studio@northwindstudio.example";
const JORDAN_EMAIL = "jordan.rivera@example.com";
const jordanCardEmail = door === "noemail" ? null : JORDAN_EMAIL;
const methodsOf = (email: string | null) => (email ? [{ id: `${email}-m`, kind: "email", value: email, label: "Work", is_primary: true, position: 0 }] : []);
const clientRow = (id: string, first: string, last: string, email: string | null) => ({
  id, first_name: first, last_name: last, entity_name: null, entity_type: null, title: null,
  status: "active", lifecycle_stage: "client_active", source: "referral", tags: null, last_contacted_at: null,
  assigned_coach_user_id: null, linked_user_id: null, timezone: "America/Chicago", created_at: ago(60 * 24 * 40), created_by: null,
  created_by_channel_type: null, dnd_active: false, dnd_reason: null, dnd_until: null, portal_access_state: "open",
  client_contact_methods: methodsOf(email),
});
const msgBase = (contact: string, first: string, last: string, email: string | null) => ({
  thread_key: key(contact), contact_id: contact, connector_id: CONNECTOR, body_html: null, attachments: null,
  provider_message_id: null, in_reply_to_provider_id: null, action_id: null, error: null as string | null, scheduled_for: null as string | null,
  call_duration_seconds: null, recording_url: null, transcript: null,
  clients: { first_name: first, last_name: last, entity_name: null, client_contact_methods: methodsOf(email) },
  comms_email_operation: null as string | null, comms_email_state: null as string | null, comms_email_prepared_at: null as string | null,
  comms_email_claimed_at: null as string | null, comms_email_send_at: null as string | null, comms_email_reason: null as string | null,
  sales_invoice_operation: null, sales_invoice_state: null,
});
const J = msgBase(JORDAN, "Jordan", "Rivera", jordanCardEmail);
const jordanIn = {
  ...J, id: "e0300000-0000-4000-8000-0000000a0001", channel_type: "email", direction: "inbound", status: "received",
  sender: { address: JORDAN_EMAIL, display_name: "Jordan Rivera" }, recipients: [{ address: STUDIO }],
  subject: "Kitchen refresh — scope questions",
  body_text: "Hi! Before we sign off on phase two, can you confirm whether the cabinet hardware is in the quote?",
  sent_at: ago(60 * 26), created_at: ago(60 * 26),
};
const jordanMessages: Array<Record<string, unknown>> = [jordanIn];

const P = msgBase(PRIYA, "Priya", "Okafor", "priya.okafor@example.com");
const priyaEmail = {
  ...P, id: "e0300000-0000-4000-8000-0000000a0002", channel_type: "email", direction: "inbound", status: "received",
  sender: { address: "priya.okafor@example.com", display_name: "Priya Okafor" }, recipients: [{ address: STUDIO }],
  subject: "Invoice question", body_text: "Quick one — is the deposit refundable if we push the start date?", sent_at: ago(60 * 5), created_at: ago(60 * 5),
};
const messages = () => [...jordanMessages, priyaEmail];
const jordanLast = () => jordanMessages[jordanMessages.length - 1] as { created_at: string };
const threads = () => [
  {
    id: "t-jordan", thread_key: key(JORDAN), contact_id: JORDAN, snoozed_until: null, archived_at: null, labels: [],
    unread_count: 0, last_message_at: jordanLast().created_at, last_direction: "inbound",
    clients: clientRow(JORDAN, "Jordan", "Rivera", jordanCardEmail),
  },
  {
    id: "t-priya", thread_key: key(PRIYA), contact_id: PRIYA, snoozed_until: null, archived_at: null, labels: [],
    unread_count: 0, last_message_at: priyaEmail.sent_at, last_direction: "inbound",
    clients: clientRow(PRIYA, "Priya", "Okafor", "priya.okafor@example.com"),
  },
];
const connectors = [
  { id: CONNECTOR, channel_type: "email", provider: "sendgrid", display_name: "Northwind Studio", from_address: STUDIO, from_name: "Northwind Studio", inbound_address: null, status: "active", active: true, created_at: ago(60 * 24 * 90) },
];

/** Every call is recorded so the drive can assert what the inbox actually invoked. */
export const harnessLog: { rpc: Array<{ name: string; args: unknown }>; tables: string[] } = { rpc: [], tables: [] };
(window as unknown as { __harness: typeof harnessLog }).__harness = harnessLog;

const tableRows = (table: string): unknown[] =>
  table === "messages" ? messages() : table === "threads" ? threads() : table === "channel_connectors" ? connectors : [];

// ?supp=bounce|complaint|optout — EXP03 20271120120003: Jordan's do-not-send rows. A governed email's hard bounce is
// this business's row for the normalised ADDRESS (no contact); a spam report and an opt-out are on the contact.
// The paige_suppressions stub honours the filters the inbox sends (eq / is), so each read gets only its rows.
const supp = params.get("supp");
const suppressionRows = supp === "bounce"
  ? [{ tenant_id: TENANT, contact_id: null, address_normalized: JORDAN_EMAIL, channel: "email", reason: "bounce_hard" }]
  : supp === "complaint" ? [{ tenant_id: TENANT, contact_id: JORDAN, address_normalized: null, channel: "email", reason: "complaint" }]
  : supp === "optout" ? [{ tenant_id: TENANT, contact_id: JORDAN, address_normalized: null, channel: "email", reason: "unsubscribe_link" }]
  : [];

function builder(table: string) {
  harnessLog.tables.push(table);
  const filters: Array<[string, unknown]> = [];
  const rowsFor = () => table === "paige_suppressions"
    ? suppressionRows.filter((r) => filters.every(([col, v]) => (r as Record<string, unknown>)[col] === v)).map(({ channel: ch, reason }) => ({ channel: ch, reason }))
    : tableRows(table);
  const result = () => ({ data: rowsFor(), error: null, count: rowsFor().length });
  const proxy: Record<string, unknown> = new Proxy({}, {
    get(_t, prop) {
      if (prop === "then") return (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(result()).then(ok, bad);
      if (prop === "single" || prop === "maybeSingle") return () => Promise.resolve({ data: null, error: null });
      if (table === "paige_suppressions" && (prop === "eq" || prop === "is")) return (col: string, v: unknown) => { filters.push([col, v]); return proxy; };
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

const httpError = (status: number, body: Record<string, unknown>) => ({
  data: null,
  error: { name: "FunctionsHttpError", message: "Edge Function returned a non-2xx status code", context: { status, json: async () => body } },
});
const REFUSALS: Record<string, [number, Record<string, unknown>]> = {
  suppressed: [422, { ok: false, outcome: "refused", reason: "BLOCKED_SUPPRESSED" }],
  noconsent: [422, { ok: false, outcome: "refused", reason: "BLOCKED_NO_CONSENT" }],
  clientdnd: [422, { ok: false, outcome: "refused", reason: "BLOCKED_CLIENT_DND" }],
  tenantdnd: [422, { ok: false, outcome: "held", reason: "QUEUED_TENANT_DND" }],
  nosender: [422, { ok: false, outcome: "needs_setup", reason: "TENANT_EMAIL_SENDER_MISSING" }],
  noemail: [422, { ok: false, outcome: "needs_setup", reason: "RECIPIENT_EMAIL_MISSING" }],
};

/** What prepare_comms_email_send + send-message leave on the row for a confirmed send. */
function recordRow(body: Record<string, unknown>, state: "provider_accepted" | "unknown" | "prepared") {
  const command = body.command as { subject: string; body: string };
  const sendAt = typeof body.send_at === "string" ? body.send_at : null;
  jordanMessages.push({
    ...J, id: MESSAGE, channel_type: "email", direction: "outbound",
    status: state === "provider_accepted" ? "sent" : state === "prepared" ? "queued" : "draft",
    sender: { address: STUDIO }, recipients: [{ address: JORDAN_EMAIL }], subject: command.subject, body_text: command.body,
    sent_at: state === "provider_accepted" ? new Date().toISOString() : null, created_at: new Date().toISOString(),
    scheduled_for: sendAt, comms_email_operation: String(body.operation_id), comms_email_state: state,
    comms_email_prepared_at: new Date().toISOString(), comms_email_claimed_at: state === "unknown" ? new Date(Date.now() - 5 * 60_000).toISOString() : null,
    comms_email_send_at: sendAt,
  });
}

async function invoke(name: string, opts?: { body?: Record<string, unknown> }) {
  harnessLog.rpc.push({ name: `functions:${name}`, args: opts?.body ?? null });
  if (name !== "comms-email-command" || !opts?.body) return { data: null, error: { message: "harness: no such edge function" } };
  const body = opts.body;
  const command = body.command as { subject: string; body: string } | undefined;
  if (!command) return httpError(400, { ok: false, outcome: "refused", code: "COMMS_EMAIL_COMMAND_INVALID" });
  if (body.approved_fingerprint === undefined) {
    const refusal = REFUSALS[door];
    if (refusal) return httpError(refusal[0], refusal[1]);
    return {
      data: {
        ok: false, outcome: "approval_required", capability: "comms_send_email", fingerprint: "0123456789abcdef", operation_id: body.operation_id,
        summary: `Email Jordan Rivera at ${JORDAN_EMAIL} from ${STUDIO}: "${command.subject}"`,
        expires_at: new Date(Date.now() + (door === "expire" ? 6_500 : 10 * 60_000)).toISOString(),
        preview: { kind: "email", to_name: "Jordan Rivera", to_address: JORDAN_EMAIL, from_address: STUDIO, subject: command.subject, body_text: command.body,
          ...(typeof body.send_at === "string" ? { send_at: body.send_at } : {}) },
      },
      error: null,
    };
  }
  if (door === "hang") return new Promise(() => undefined);
  if (door === "unknown") { recordRow(body, "unknown"); return httpError(503, { ok: false, outcome: "outcome_unknown", code: "COMMS_EMAIL_RECONCILIATION_REQUIRED", operation_id: body.operation_id }); }
  if (typeof body.send_at === "string") {
    recordRow(body, "prepared");
    return { data: { ok: true, outcome: "scheduled", send_at: body.send_at, operation_id: body.operation_id, message_id: MESSAGE, delivery_confirmed: false }, error: null };
  }
  recordRow(body, "provider_accepted");
  return { data: { ok: true, outcome: "provider_accepted", operation_id: body.operation_id, message_id: MESSAGE, provider_receipt_available: true, delivery_confirmed: false }, error: null };
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
