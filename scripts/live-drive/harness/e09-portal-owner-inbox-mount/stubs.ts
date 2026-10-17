// Deterministic data boundary for the E09 owner-inbox harness. HARNESS RENDER · SYNTHETIC DATA · NOT LIVE:
// every name, address and number is fictional (Northwind Studio, its customer Jordan Rivera, two other
// fictional clients). The signed-in Solo inbox is a separate, owed check (§32/§70.1).
//
// The shapes mirror what the inbox actually selects (MESSAGE_COLS / THREAD_COLS in inbox-shared.ts) and what
// portalInbox.render.test.tsx stubs; the RPC answers mirror migration 20271110010000 (comms_portal_reply).
//   ?state=thread     a portal-joined client; email + SMS + portal + one help request; latest is a portal reply
//   ?state=help       the help request is the newest, unread message in the thread
//   ?state=notjoined  portal rows in the thread but no linked portal login: the composer opens on email; picking
//                     Portal shows the not-connected notice and holds Send (the RPC answer below stays as the
//                     server backstop, PORTAL_NOT_CONNECTED)
//   ?state=error      the reply call fails at the transport → UNCONFIRMED; the draft is kept

const params = new URLSearchParams(window.location.search);
const state = params.get("state") ?? "thread";

export const TENANT = "e0900000-0000-4000-8000-00000000b001";
const OWNER = "e0900000-0000-4000-8000-00000000a001";
const JORDAN = "e0900000-0000-4000-8000-0000000c0001";
const PRIYA = "e0900000-0000-4000-8000-0000000c0002";
const SAM = "e0900000-0000-4000-8000-0000000c0003";
const key = (contact: string) => `contact:${TENANT}:${contact}`;

// Fixed clock offsets from load, so relative times read naturally ("2h", "35m") in every frame.
const NOW = Date.now();
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();

const JORDAN_EMAIL = "jordan.rivera@example.com";
const JORDAN_PHONE = "+15550100187";
const methodsOf = (email: string | null, phone: string | null) => [
  ...(email ? [{ id: `${email}-m`, kind: "email", value: email, label: "Work", is_primary: true, position: 0 }] : []),
  ...(phone ? [{ id: `${phone}-m`, kind: "phone", value: phone, label: "Mobile", is_primary: true, position: 1 }] : []),
];

const clientRow = (id: string, first: string, last: string, email: string | null, phone: string | null, linked: string | null) => ({
  id, first_name: first, last_name: last, entity_name: null, entity_type: null, title: null,
  status: "active", lifecycle_stage: "client_active", source: "referral", tags: null, last_contacted_at: null,
  assigned_coach_user_id: null, linked_user_id: linked, timezone: "America/Chicago", created_at: ago(60 * 24 * 40), created_by: null,
  created_by_channel_type: null, dnd_active: false, dnd_reason: null, dnd_until: null,
  client_contact_methods: methodsOf(email, phone),
});

const msgBase = (contact: string, first: string, last: string, email: string | null, phone: string | null) => ({
  thread_key: key(contact), contact_id: contact, connector_id: null, body_html: null, attachments: null,
  provider_message_id: null, in_reply_to_provider_id: null, action_id: null, error: null, scheduled_for: null,
  call_duration_seconds: null, recording_url: null, transcript: null,
  clients: { first_name: first, last_name: last, entity_name: null, client_contact_methods: methodsOf(email, phone) },
  comms_email_operation: null, comms_email_state: null, comms_email_prepared_at: null, comms_email_claimed_at: null,
  sales_invoice_operation: null, sales_invoice_state: null,
});
const J = msgBase(JORDAN, "Jordan", "Rivera", JORDAN_EMAIL, JORDAN_PHONE);

const jordanEmailIn = {
  ...J, id: "m-j-email", connector_id: "conn-email", channel_type: "email", direction: "inbound", status: "received",
  sender: { address: JORDAN_EMAIL, display_name: "Jordan Rivera" }, recipients: [{ address: "studio@northwindstudio.example" }],
  subject: "Kitchen refresh — scope questions", body_text: "Hi! Before we sign off on phase two, can you confirm whether the cabinet hardware is in the quote?",
  sent_at: ago(60 * 26), created_at: ago(60 * 26),
};
const jordanSmsOut = {
  ...J, id: "m-j-sms-out", connector_id: "conn-sms", channel_type: "sms", direction: "outbound", status: "delivered",
  sender: { address: "+15550100142" }, recipients: [{ address: JORDAN_PHONE }], subject: null,
  body_text: "Hardware is included. Walkthrough Thursday at 10 still good?", sent_at: ago(60 * 20), created_at: ago(60 * 20),
};
const jordanSmsIn = {
  ...J, id: "m-j-sms-in", connector_id: "conn-sms", channel_type: "sms", direction: "inbound", status: "received",
  sender: { address: JORDAN_PHONE }, recipients: [{ address: "+15550100142" }], subject: null,
  body_text: "Thursday works. I'll post the photos in the portal.", sent_at: ago(60 * 19), created_at: ago(60 * 19),
};
const jordanPortalIn = {
  ...J, id: "m-j-portal-in", channel_type: "portal", direction: "inbound", status: "received",
  sender: { kind: "customer", name: "Jordan Rivera" }, recipients: [], subject: null,
  body_text: "Photos are up in the portal — the north wall is the one I meant.", sent_at: ago(60 * 3), created_at: ago(60 * 3),
};
const jordanHelp = {
  ...J, id: "m-j-help", channel_type: "portal", direction: "inbound", status: "received",
  sender: { kind: "customer", name: "Jordan Rivera" }, recipients: [], subject: "Help request",
  body_text: "I can't find the revised timeline you mentioned. Where should I look?", sent_at: ago(95), created_at: ago(95),
};
const jordanPortalOut = {
  ...J, id: "m-j-portal-out", channel_type: "portal", direction: "outbound", status: "delivered",
  sender: { kind: "business", user_id: OWNER }, recipients: [], subject: null,
  body_text: "It's under Documents → Timeline. I'll add a note to the top of it too.", sent_at: ago(35), created_at: ago(35),
};

const P = msgBase(PRIYA, "Priya", "Okafor", "priya.okafor@example.com", null);
const priyaEmail = {
  ...P, id: "m-p-email", connector_id: "conn-email", channel_type: "email", direction: "inbound", status: "received",
  sender: { address: "priya.okafor@example.com", display_name: "Priya Okafor" }, recipients: [{ address: "studio@northwindstudio.example" }],
  subject: "Invoice question", body_text: "Quick one — is the deposit refundable if we push the start date?", sent_at: ago(60 * 5), created_at: ago(60 * 5),
};
const S = msgBase(SAM, "Sam", "Delgado", null, "+15550100163");
const samSms = {
  ...S, id: "m-s-sms", connector_id: "conn-sms", channel_type: "sms", direction: "outbound", status: "delivered",
  sender: { address: "+15550100142" }, recipients: [{ address: "+15550100163" }], subject: null,
  body_text: "Thanks Sam — see you Monday.", sent_at: ago(60 * 30), created_at: ago(60 * 30),
};

const jordanLinked = state === "notjoined" ? null : "e0900000-0000-4000-8000-0000000f0001";
const jordanMessages = state === "help"
  ? [jordanEmailIn, jordanSmsOut, jordanSmsIn, jordanPortalIn, { ...jordanHelp, sent_at: ago(12), created_at: ago(12) }]
  : state === "notjoined"
    ? [jordanEmailIn, jordanSmsOut, jordanSmsIn, jordanPortalIn, jordanHelp]
    : [jordanEmailIn, jordanSmsOut, jordanSmsIn, jordanPortalIn, jordanHelp, jordanPortalOut];
const messages = [...jordanMessages, priyaEmail, samSms];
const jordanLast = jordanMessages[jordanMessages.length - 1];

const threads = [
  {
    id: "t-jordan", thread_key: key(JORDAN), contact_id: JORDAN, snoozed_until: null, archived_at: null, labels: [],
    unread_count: state === "help" ? 1 : 0, last_message_at: jordanLast.sent_at, last_direction: jordanLast.direction,
    clients: clientRow(JORDAN, "Jordan", "Rivera", JORDAN_EMAIL, JORDAN_PHONE, jordanLinked),
  },
  {
    id: "t-priya", thread_key: key(PRIYA), contact_id: PRIYA, snoozed_until: null, archived_at: null, labels: [],
    unread_count: 1, last_message_at: priyaEmail.sent_at, last_direction: "inbound",
    clients: clientRow(PRIYA, "Priya", "Okafor", "priya.okafor@example.com", null, null),
  },
  {
    id: "t-sam", thread_key: key(SAM), contact_id: SAM, snoozed_until: null, archived_at: null, labels: [],
    unread_count: 0, last_message_at: samSms.sent_at, last_direction: "outbound",
    clients: clientRow(SAM, "Sam", "Delgado", null, "+15550100163", null),
  },
];

const connectors = [
  { id: "conn-email", channel_type: "email", provider: "resend", display_name: "Northwind Studio", from_address: "studio@northwindstudio.example", from_name: "Northwind Studio", inbound_address: null, status: "active", active: true, created_at: ago(60 * 24 * 90) },
  { id: "conn-sms", channel_type: "sms", provider: "twilio", display_name: "Northwind Studio", from_address: "+15550100142", from_name: null, inbound_address: null, status: "active", active: true, created_at: ago(60 * 24 * 90) },
];

/** Every unstubbed call is recorded so the drive can report it rather than let it pass silently. */
export const harnessLog: { rpc: Array<{ name: string; args: unknown }>; tables: string[] } = { rpc: [], tables: [] };
(window as unknown as { __harness: typeof harnessLog }).__harness = harnessLog;

const tableRows = (table: string): unknown[] =>
  table === "messages" ? messages
  : table === "threads" ? threads
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
    return {
      data: {
        tenant_id: TENANT, can_send_sms: true, a2p: "approved", number_e164: "+15550100142",
        delivery: { state: "delivering", last_inbound_at: null, inbound_reporting: "unavailable" },
      },
      error: null,
    };
  }
  if (name === "comms_portal_reply") {
    if (state === "notjoined") return { data: { ok: false, error: "PORTAL_NOT_CONNECTED" }, error: null };
    if (state === "error") return { data: null, error: { code: "08006", message: "harness: connection failure" } };
    return { data: { ok: true, replayed: false, message_id: "m-harness-new", created_at: new Date().toISOString() }, error: null };
  }
  if (name === "get_tenant_assignable_members") return { data: [], error: null };
  return { data: null, error: null };
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
  functions: { invoke: async (name: string) => { harnessLog.rpc.push({ name: `functions:${name}`, args: null }); return { data: null, error: { message: "harness: no edge functions" } }; } },
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
export function useUserRoles() { return { loading: false, userId: OWNER, roles: ["admin"], isAdmin: true, isClient: false, isStaff: true }; }

export function useTenantRelationshipsData() {
  return {
    people: [], peopleLoading: false, peopleError: false, retryPeople: async () => undefined, peopleAvailable: true,
    deepLinkedPerson: null, deepLinkLoading: false, deepLinkError: false, retryDeepLink: async () => undefined,
    portalConfig: {}, portalLoading: false, portalError: false, retryPortal: async () => undefined,
  };
}
export type RelationshipWorkspaceVariant = "clients" | "relationships";
