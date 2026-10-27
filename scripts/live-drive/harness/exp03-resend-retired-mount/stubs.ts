// Deterministic data boundary for the EXP03 (Resend retired) inbox harness. HARNESS RENDER · SYNTHETIC DATA ·
// NOT LIVE: every name, address and number is fictional (Northwind Studio, its client Jordan Rivera, two other
// fictional clients). The signed-in Solo inbox is a separate, owed check (§32/§70.1).
//
// "Mock the provider, never the contract" (harness README): the shapes mirror what the inbox selects
// (MESSAGE_COLS / THREAD_COLS in inbox-shared.ts) and the send-message answer mirrors
// supabase/functions/send-message/index.ts at this commit — when SendGrid's answer could not be read it
// answers { status:"failed", outcome:"outcome_unknown", unconfirmed:true, message_id } and patches the draft
// row to status 'failed', error 'delivery_unconfirmed' (messageRowError, ~L1794/L1890). The inbox's own
// parsing (readSendResult, isUnconfirmedMessage, GOVERNED_SEND_COPY) is NOT stubbed: it runs as shipped.
//   ?state=thread   three outbound emails, one in each end state: Sent · Failed (a definitive SendGrid 400) ·
//                   Couldn't confirm (a lost answer, row error 'delivery_unconfirmed')
//   ?state=approve  Sent · Failed · a Paige draft. Approve & send → send-message answers unconfirmed → the
//                   draft row becomes 'failed' + 'delivery_unconfirmed' and the inbox reloads it

const params = new URLSearchParams(window.location.search);
const state = params.get("state") ?? "thread";

export const TENANT = "e0300000-0000-4000-8000-00000000b003";
const OWNER = "e0300000-0000-4000-8000-00000000a003";
const JORDAN = "e0300000-0000-4000-8000-0000000c0001";
const PRIYA = "e0300000-0000-4000-8000-0000000c0002";
const SAM = "e0300000-0000-4000-8000-0000000c0003";
const key = (contact: string) => `contact:${TENANT}:${contact}`;

const NOW = Date.now();
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();

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
  provider_message_id: null, in_reply_to_provider_id: null, action_id: null, error: null as string | null, scheduled_for: null,
  call_duration_seconds: null, recording_url: null, transcript: null,
  clients: { first_name: first, last_name: last, entity_name: null, client_contact_methods: methodsOf(email, phone) },
  comms_email_operation: null, comms_email_state: null, comms_email_prepared_at: null, comms_email_claimed_at: null,
  sales_invoice_operation: null, sales_invoice_state: null,
});
const J = msgBase(JORDAN, "Jordan", "Rivera", JORDAN_EMAIL, null);
const out = (id: string, min: number, subject: string, body: string, status: string, error: string | null) => ({
  ...J, id, channel_type: "email", direction: "outbound", status, error,
  sender: { address: STUDIO }, recipients: [{ address: JORDAN_EMAIL }], subject, body_text: body,
  sent_at: status === "draft" ? null : ago(min), created_at: ago(min),
});

const jordanIn = {
  ...J, id: "m-j-in", channel_type: "email", direction: "inbound", status: "received",
  sender: { address: JORDAN_EMAIL, display_name: "Jordan Rivera" }, recipients: [{ address: STUDIO }],
  subject: "Kitchen refresh — scope questions",
  body_text: "Hi! Before we sign off on phase two, can you confirm whether the cabinet hardware is in the quote?",
  sent_at: ago(60 * 26), created_at: ago(60 * 26),
};
const sent = out("m-j-sent", 60 * 25, "Re: Kitchen refresh — scope questions", "Hardware is included in the quote. I'll bring samples to Thursday's walkthrough.", "sent", null);
// A definitive refusal: the exact error string send-message's SendGrid arm writes for a 4xx (`sendgrid_${status}: ${body}`).
const failed = out("m-j-failed", 60 * 4, "Revised timeline", "Here is the revised timeline for phase two — the cabinet install moves to the week of the 14th.", "failed",
  'sendgrid_400: {"errors":[{"message":"Does not contain a valid address.","field":"personalizations.0.to.0.email"}]}');
const unconfirmed = out("m-j-unconfirmed", 50, "Walkthrough Thursday at 10", "Confirming our walkthrough Thursday at 10. I'll bring the hardware samples.", "failed", "delivery_unconfirmed");
const draft = out("m-j-draft", 8, "Photos received", "Thanks for the photos — the north wall is the one I'll measure on Thursday.", "draft", null);

const jordanMessages: Array<Record<string, unknown>> = state === "approve"
  ? [jordanIn, sent, failed, draft]
  : [jordanIn, sent, failed, unconfirmed];

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

// The stored label stays 'resend' (migration 20271116200000: "no data is rewritten"); send-message now hands it to SendGrid.
const connectors = [
  { id: "conn-email", channel_type: "email", provider: "resend", display_name: "Northwind Studio", from_address: STUDIO, from_name: "Northwind Studio", inbound_address: null, status: "active", active: true, created_at: ago(60 * 24 * 90) },
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

/** send-message: SendGrid's answer to this email was lost (5xx / timeout). Mirrors the function's response + row write. */
async function invoke(name: string, opts?: { body?: { message_id?: string } }) {
  harnessLog.rpc.push({ name: `functions:${name}`, args: opts?.body ?? null });
  if (name !== "send-message") return { data: null, error: { message: "harness: no such edge function" } };
  const id = opts?.body?.message_id ?? null;
  const row = id ? jordanMessages.find((m) => m.id === id) : null;
  if (row) { row.status = "failed"; row.error = "delivery_unconfirmed"; row.sent_at = null; }
  return {
    data: { audit_id: "harness-audit", vendor_message_id: null, pipe_used: "sendgrid", status: "failed", error: "sendgrid_503: Service Unavailable", message_id: id, outcome: "outcome_unknown", reason: "sendgrid_503: Service Unavailable", unconfirmed: true, scheduled_for: null },
    error: null,
  };
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
// The real module also exports the optional reader; the harness has one context, so both return it.
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
