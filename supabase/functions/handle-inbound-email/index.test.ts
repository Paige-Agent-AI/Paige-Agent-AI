// handle-inbound-email — the SendGrid Inbound Parse arm, and the Resend arm left as it was.
//
// Runs the REAL Deno entry point (transpiled) with the REAL channel-adapters registry, SendGrid
// adapter, shared signature helpers and contact-methods helpers. Only the module boundary is
// replaced: the Supabase client is an in-memory fake holding channel_connectors / messages /
// paige_actions / paige_conversations, with the global unique index on messages.provider_message_id
// that production has; the n8n bridge and the model-backed classifier are no-ops. Requests are real
// multipart/form-data bodies built by FormData, exactly what SendGrid posts. No network, no database.
//
// Run: node --import ./scripts/client-memory-authz/register.mjs --test \
//        supabase/functions/handle-inbound-email/index.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import ts from "typescript";

type Row = Record<string, unknown>;
const SECRET = "sg-inbound-test-secret-0123456789";
const TENANT_A = "10000000-0000-4000-8000-00000000000a";
const TENANT_B = "10000000-0000-4000-8000-00000000000b";
const OWNER = "20000000-0000-4000-8000-000000000001";

function transpile(path: string): string {
  return ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}

/** LIKE/ILIKE semantics (with PostgREST's `*`), so an unescaped wildcard really does match anything. */
function ilikeMatches(value: unknown, pattern: string): boolean {
  if (typeof value !== "string") return false;
  let re = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "\\" && i + 1 < pattern.length) { re += pattern[++i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); continue; }
    if (c === "%" || c === "*") { re += ".*"; continue; }
    if (c === "_") { re += "."; continue; }
    re += c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`, "is").test(value);
}

interface Db {
  channel_connectors: Row[];
  messages: Row[];
  paige_actions: Row[];
  paige_conversations: Row[];
  clients: Row[];
  admin_app_settings: Row[];
  tenants: Row[];
}

type Faults = {
  /** A read error on this channel_connectors ilike column. */
  connectorLookup?: "inbound_address" | "inbound_domain";
  /** The next N messages inserts for this connector fail with a non-unique error. */
  failMessageInsert?: { connector_id: string; times: number; code?: string };
  /** The next N paige_actions inserts fail. */
  failActionInsertTimes?: number;
  /** This RPC returns an error. */
  failRpc?: string;
};

const pathValue = (r: Row, c: string): unknown => {
  const m = /^(\w+)->>(\w+)$/.exec(c);
  return m ? ((r[m[1]] ?? {}) as Row)[m[2]] : r[c];
};

function fakeAdmin(db: Db, faults: Faults = {}) {
  let seq = 0;
  const table = (name: keyof Db | string) => {
    const filters: Array<(r: Row) => boolean> = [];
    let pendingInsert: Row | null = null;
    let limitN = Infinity;
    let ilikeCol = "";
    const rows = () => ((db as unknown as Record<string, Row[]>)[name] ?? []).filter((r) => filters.every((f) => f(r)));
    const settle = (single: boolean) => {
      if (pendingInsert) {
        const row = pendingInsert;
        // Production's GLOBAL unique indexes: messages(provider_message_id), paige_conversations(channel, source_message_id).
        if (name === "messages" && row.provider_message_id != null &&
            db.messages.some((m) => m.provider_message_id === row.provider_message_id)) {
          return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } };
        }
        if (name === "paige_conversations" && row.source_message_id != null &&
            db.paige_conversations.some((c) => c.channel === row.channel && c.source_message_id === row.source_message_id)) {
          return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } };
        }
        if (name === "messages" && faults.failMessageInsert && faults.failMessageInsert.times > 0 &&
            row.connector_id === faults.failMessageInsert.connector_id) {
          faults.failMessageInsert.times -= 1;
          return { data: null, error: { code: faults.failMessageInsert.code ?? "08006", message: "insert failed" } };
        }
        if (name === "paige_actions" && (faults.failActionInsertTimes ?? 0) > 0) {
          faults.failActionInsertTimes = (faults.failActionInsertTimes ?? 0) - 1;
          return { data: null, error: { code: "08006", message: "connection failure" } };
        }
        const stored = { id: `${String(name)}-${++seq}`, ...row };
        ((db as unknown as Record<string, Row[]>)[name] ??= []).push(stored);
        return { data: { id: stored.id }, error: null };
      }
      if (name === "channel_connectors" && faults.connectorLookup && ilikeCol === faults.connectorLookup) {
        return { data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } };
      }
      const found = rows().slice(0, limitN);
      return single ? { data: found[0] ?? null, error: null } : { data: found, error: null };
    };
    const q = {
      select: () => q,
      eq: (c: string, v: unknown) => { filters.push((r) => pathValue(r, c) === v); return q; },
      in: (c: string, vs: unknown[]) => { filters.push((r) => vs.includes(r[c])); return q; },
      ilike: (c: string, p: string) => { ilikeCol = c; filters.push((r) => ilikeMatches(r[c], p)); return q; },
      order: () => q,
      limit: (n: number) => { limitN = n; return q; },
      insert: (row: Row) => { pendingInsert = row; return q; },
      maybeSingle: () => Promise.resolve(settle(true)),
      single: () => Promise.resolve(settle(true)),
      then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(settle(false)).then(ok, bad),
    };
    return q;
  };
  const rpcCalls: Array<{ fn: string; args: Row }> = [];
  return {
    rpcCalls,
    client: {
      from: table,
      rpc: (fn: string, args: Row) => {
        rpcCalls.push({ fn, args });
        if (faults.failRpc === fn) return Promise.resolve({ data: null, error: { code: "57014", message: "statement timeout" } });
        if (fn === "client_id_for_address") {
          const hit = db.clients.find((c) => c.tenant_id === args._tenant_id && c.email === args._value);
          return Promise.resolve({ data: hit ? hit.id : null, error: null });
        }
        if (fn === "_create_client_with_contact_methods") {
          const id = `client-${db.clients.length + 1}`;
          const methods = args._methods as Array<{ value: string }>;
          db.clients.push({ id, tenant_id: args._tenant_id, email: methods[0]?.value, ...(args._client as Row) });
          return Promise.resolve({ data: id, error: null });
        }
        return Promise.resolve({ data: {}, error: null });
      },
      auth: { admin: { listUsers: () => Promise.resolve({ data: { users: [] } }) } },
    },
  };
}

function freshDb(): Db {
  return {
    channel_connectors: [
      { id: "conn-a", tenant_id: TENANT_A, channel_type: "email", provider: "resend", active: true,
        inbound_address: "acme@mail.paigeagent.ai", inbound_domain: null, from_address: "acme@mail.paigeagent.ai",
        from_name: "Acme", reply_to: "support@paigeagent.ai", mailbox_class: null },
      { id: "conn-b", tenant_id: TENANT_B, channel_type: "email", provider: "resend", active: true,
        inbound_address: "beta-co@mail.paigeagent.ai", inbound_domain: null, from_address: "beta-co@mail.paigeagent.ai",
        from_name: "Beta", reply_to: "support@paigeagent.ai", mailbox_class: null },
      { id: "conn-off", tenant_id: TENANT_B, channel_type: "email", provider: "resend", active: false,
        inbound_address: "retired@mail.paigeagent.ai", inbound_domain: null, from_address: null,
        from_name: null, reply_to: null, mailbox_class: null },
    ],
    messages: [], paige_actions: [], paige_conversations: [], clients: [], admin_app_settings: [],
    tenants: [{ id: TENANT_A, owner_user_id: OWNER }, { id: TENANT_B, owner_user_id: OWNER }],
  };
}

function harness(env: Record<string, string | undefined>, db: Db = freshDb(), faults: Faults = {}) {
  const fake = fakeAdmin(db, faults);
  let handle!: (req: Request) => Promise<Response>;
  const logs: string[] = [];
  const record = (...a: unknown[]) => { logs.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ")); };
  const quiet = { error: record, warn: record, log: record };
  const modules = new Map<string, Row>();
  const load = (path: string): Row => {
    const hit = modules.get(path);
    if (hit) return hit;
    const exports: Row = {};
    modules.set(path, exports);
    new Function("require", "exports", "console", transpile(path))(requireShim(path), exports, quiet);
    return exports;
  };
  const requireShim = (from: string) => (name: string): unknown => {
    if (name === "https://esm.sh/@supabase/supabase-js@2") return { createClient: () => fake.client };
    if (name === "../_shared/mmaOsBridge.ts") return { fireAndForgetBridge: () => {} };
    if (name === "../_shared/inbox-intelligence/classify-message.ts") return { classifyAndRecordMessage: async () => {} };
    const local: Record<string, string> = {
      "../_shared/webhookSig.ts": "supabase/functions/_shared/webhookSig.ts",
      "../_shared/channel-adapters.ts": "supabase/functions/_shared/channel-adapters.ts",
      "../_shared/contact-methods.ts": "supabase/functions/_shared/contact-methods.ts",
      "../_shared/service-role-bearer.ts": "supabase/functions/_shared/service-role-bearer.ts",
      "./sendgrid-inbound.ts": "supabase/functions/handle-inbound-email/sendgrid-inbound.ts",
    };
    if (local[name]) return load(local[name]);
    throw new Error(`unexpected import in test from ${from}: ${name}`);
  };
  const handlerPath = "supabase/functions/handle-inbound-email/index.ts";
  new Function("require", "exports", "Deno", "console", transpile(handlerPath))(
    requireShim(handlerPath), {},
    { env: { get: (n: string) => env[n] }, serve: (cb: typeof handle) => { handle = cb; } },
    quiet,
  );
  return { handle: (req: Request) => handle(req), db, logs, rpcCalls: fake.rpcCalls };
}

const ENV = { SUPABASE_URL: "https://example.invalid", SUPABASE_SERVICE_ROLE_KEY: "service-role-test", SENDGRID_INBOUND_PARSE_SECRET: SECRET };

interface FormOpts {
  to?: string;
  envelopeTo?: string[] | null;
  /** null = no Message-ID header; a string = used verbatim inside the header (so "" gives `<>`). */
  messageId?: string | null;
  text?: string;
  html?: string;
  subject?: string;
  attachments?: number;
  from?: string;
  envelopeFrom?: string;
  dkim?: string;
  spf?: string;
}

function parseForm(opts: FormOpts = {}): FormData {
  const to = opts.to ?? "acme@mail.paigeagent.ai";
  const envelopeTo = opts.envelopeTo === undefined ? [to] : opts.envelopeTo;
  const from = opts.from ?? "Ada Client <ada@client.example>";
  const headerLines = [
    "Received: by mx0047p1mdw1.sendgrid.net with SMTP id n02SRiHsLZ Tue, 27 Oct 2026 15:53:29 +0000 (UTC)",
    "MIME-Version: 1.0",
    `From: ${from}`,
    "Date: Tue, 27 Oct 2026 15:53:29 +0000",
    ...(opts.messageId === null ? [] : [`Message-ID: <${opts.messageId ?? "CABQbZK-reply-1@mail.gmail.com"}>`]),
    "In-Reply-To: <sent-1@mail.paigeagent.ai>",
    `Subject: ${opts.subject ?? "Re: your proposal"}`,
    `To: ${to}`,
  ];
  const f = new FormData();
  f.set("headers", headerLines.join("\n"));
  f.set("dkim", opts.dkim ?? "{@client.example : pass}");
  f.set("to", to);
  f.set("from", from);
  f.set("subject", opts.subject ?? "Re: your proposal");
  f.set("text", opts.text ?? "Yes — Thursday works for me.");
  f.set("html", opts.html ?? "<p>Yes — Thursday works for me.</p>");
  f.set("sender_ip", "209.85.223.169");
  if (envelopeTo !== null) f.set("envelope", JSON.stringify({ to: envelopeTo, from: opts.envelopeFrom ?? "ada@client.example" }));
  f.set("charsets", JSON.stringify({ to: "UTF-8", from: "UTF-8", subject: "UTF-8", text: "UTF-8", html: "UTF-8" }));
  f.set("SPF", opts.spf ?? "pass");
  f.set("spam_score", "0.011");
  const n = opts.attachments ?? 0;
  f.set("attachments", String(n));
  const info: Row = {};
  for (let i = 1; i <= n; i++) {
    info[`attachment${i}`] = { filename: `doc${i}.pdf`, name: `doc${i}.pdf`, type: "application/pdf" };
    f.set(`attachment${i}`, new Blob([`%PDF-${i}`], { type: "application/pdf" }), `doc${i}.pdf`);
  }
  if (n) f.set("attachment-info", JSON.stringify(info));
  return f;
}

function parseRequest(form: FormData, auth: "basic" | "query" | "wrong" | "none" = "basic"): Request {
  const headers: Record<string, string> = {};
  let url = "https://example.invalid/functions/v1/handle-inbound-email";
  if (auth === "basic") headers.authorization = `Basic ${Buffer.from(`inbound:${SECRET}`).toString("base64")}`;
  if (auth === "wrong") headers.authorization = `Basic ${Buffer.from("inbound:not-the-secret").toString("base64")}`;
  if (auth === "query") url += `?t=${encodeURIComponent(SECRET)}`;
  return new Request(url, { method: "POST", headers, body: form });
}

test("SendGrid arm: secret unset → 503, nothing persisted", async () => {
  const h = harness({ ...ENV, SENDGRID_INBOUND_PARSE_SECRET: undefined });
  const res = await h.handle(parseRequest(parseForm()));
  assert.equal(res.status, 503);
  assert.equal((await res.json()).reason, "inbound_parse_not_configured");
  assert.equal(h.db.messages.length, 0);
  assert.equal(h.db.paige_actions.length, 0);
  assert.equal(h.db.clients.length, 0);
});

test("SendGrid arm: wrong secret → 401, missing proof → 401, nothing persisted, secret never logged", async () => {
  const h = harness(ENV);
  const wrong = await h.handle(parseRequest(parseForm(), "wrong"));
  assert.equal(wrong.status, 401);
  assert.equal((await wrong.json()).reason, "bad_secret");
  const none = await h.handle(parseRequest(parseForm(), "none"));
  assert.equal(none.status, 401);
  assert.equal((await none.json()).reason, "no_proof_offered");
  assert.equal(h.db.messages.length, 0);
  assert.ok(!h.logs.join("\n").includes(SECRET));
  assert.ok(!h.logs.join("\n").includes("not-the-secret"));
});

test("SendGrid arm: a valid reply lands as ONE inbound message for the tenant that owns the address", async () => {
  const h = harness(ENV);
  const res = await h.handle(parseRequest(parseForm()));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.deepEqual(body.results.map((r: Row) => [r.tenant_id, r.outcome]), [[TENANT_A, "persisted"]]);
  assert.equal(h.db.messages.length, 1);
  const m = h.db.messages[0];
  assert.equal(m.connector_id, "conn-a");
  assert.equal(m.channel_type, "email");
  assert.equal(m.direction, "inbound");
  assert.equal(m.status, "received");
  assert.equal(m.provider_message_id, `sendgrid-inbound:${TENANT_A}:CABQbZK-reply-1@mail.gmail.com`);
  assert.equal(m.in_reply_to_provider_id, "sent-1@mail.paigeagent.ai");
  assert.deepEqual(m.sender, { address: "ada@client.example", display_name: "Ada Client" });
  assert.deepEqual(m.recipients, [{ address: "acme@mail.paigeagent.ai" }]);
  assert.equal(m.subject, "Re: your proposal");
  assert.equal(m.body_text, "Yes — Thursday works for me.");
  assert.equal(m.sent_at, "2026-10-27T15:53:29.000Z");
  assert.equal((m.meta as Row).provider, "sendgrid_inbound_parse");
  assert.equal((m.meta as Row).spf, "pass");
  assert.equal(m.thread_key, `contact:${TENANT_A}:client-1`);
  // The contact is created in the RESOLVED tenant, and the reply draft is filed for that tenant.
  assert.equal(h.db.clients.length, 1);
  assert.equal(h.db.clients[0].tenant_id, TENANT_A);
  assert.equal(h.db.paige_actions.length, 1);
  assert.equal(h.db.paige_actions[0].tenant_id, TENANT_A);
  assert.equal(h.db.paige_actions[0].action_kind, "comms-draft-reply");
});

test("SendGrid arm: the ?t= URL token is accepted as the proof too", async () => {
  const h = harness(ENV);
  const res = await h.handle(parseRequest(parseForm(), "query"));
  assert.equal(res.status, 200);
  assert.equal(h.db.messages.length, 1);
});

test("SendGrid arm: the same Message-ID delivered twice → one row (the retry is acknowledged 200)", async () => {
  const h = harness(ENV);
  assert.equal((await h.handle(parseRequest(parseForm()))).status, 200);
  const again = await h.handle(parseRequest(parseForm()));
  assert.equal(again.status, 200);
  assert.equal((await again.json()).results[0].outcome, "deduped");
  assert.equal(h.db.messages.length, 1);
  assert.equal(h.db.paige_actions.length, 1);
});

test("SendGrid arm: one email CC'd to two businesses lands once in EACH (the global unique index is tenant-scoped)", async () => {
  const h = harness(ENV);
  assert.equal((await h.handle(parseRequest(parseForm({ to: "acme@mail.paigeagent.ai" })))).status, 200);
  const second = await h.handle(parseRequest(parseForm({ to: "beta-co@mail.paigeagent.ai" })));
  assert.equal(second.status, 200);
  assert.equal((await second.json()).results[0].tenant_id, TENANT_B);
  assert.deepEqual(h.db.messages.map((m) => m.connector_id).sort(), ["conn-a", "conn-b"]);
});

test("SendGrid arm: no Message-ID → a stable derived identity, so a retry still dedups", async () => {
  const h = harness(ENV);
  assert.equal((await h.handle(parseRequest(parseForm({ messageId: null })))).status, 200);
  assert.equal((await h.handle(parseRequest(parseForm({ messageId: null })))).status, 200);
  assert.equal(h.db.messages.length, 1);
  const m = h.db.messages[0];
  assert.match(String(m.provider_message_id), new RegExp(`^sendgrid-inbound:${TENANT_A}:derived:[0-9a-f]{64}$`));
  assert.equal((m.meta as Row).provider_message_id_derived, true);
  // A different email without a Message-ID is a different message.
  assert.equal((await h.handle(parseRequest(parseForm({ messageId: null, text: "A second note." })))).status, 200);
  assert.equal(h.db.messages.length, 2);
});

test("SendGrid arm: unknown recipient → skipped 200, nothing persisted, never a guessed tenant", async () => {
  const h = harness(ENV);
  for (const to of ["nobody@mail.paigeagent.ai", "retired@mail.paigeagent.ai", "%@mail.paigeagent.ai", "acm_@mail.paigeagent.ai", "*@mail.paigeagent.ai"]) {
    const res = await h.handle(parseRequest(parseForm({ to })));
    assert.equal(res.status, 200, to);
    assert.equal((await res.json()).reason, "no_connector", to);
  }
  assert.equal(h.db.messages.length, 0);
  assert.equal(h.db.clients.length, 0);
  assert.equal(h.db.paige_actions.length, 0);
});

test("SendGrid arm: routing is on the SMTP envelope, never on the header To a sender wrote", async () => {
  const h = harness(ENV);
  const noEnvelope = await h.handle(parseRequest(parseForm({ envelopeTo: null })));
  assert.equal(noEnvelope.status, 200);
  assert.equal((await noEnvelope.json()).reason, "no_envelope_recipient");
  // Header To names business A, but the MX accepted it for an address nobody owns.
  const spoof = await h.handle(parseRequest(parseForm({ to: "acme@mail.paigeagent.ai", envelopeTo: ["nobody@mail.paigeagent.ai"] })));
  assert.equal((await spoof.json()).reason, "no_connector");
  assert.equal(h.db.messages.length, 0);
});

for (const failing of ["inbound_address", "inbound_domain"] as const) {
  test(`SendGrid arm: a connector read failure (${failing}) is 503 (SendGrid retries), not a silent skip`, async () => {
    // inbound_domain is only consulted when no address matched, and never for a PAIGE domain,
    // so the domain case addresses nobody at a business's own domain.
    const to = failing === "inbound_address" ? "acme@mail.paigeagent.ai" : "nobody@acme-custom.example";
    const h = harness(ENV, freshDb(), { connectorLookup: failing });
    const res = await h.handle(parseRequest(parseForm({ to })));
    assert.equal(res.status, 503);
    assert.equal((await res.json()).reason, "connector_lookup_failed");
    assert.equal(h.db.messages.length, 0);
  });
}

test("SendGrid arm: an over-limit body is 413 before it is parsed", async () => {
  const h = harness(ENV);
  const req = new Request("https://example.invalid/functions/v1/handle-inbound-email", {
    method: "POST",
    headers: {
      authorization: `Basic ${Buffer.from(`inbound:${SECRET}`).toString("base64")}`,
      "content-type": "multipart/form-data; boundary=x",
      "content-length": String(33 * 1024 * 1024),
    },
    body: "--x--",
  });
  const res = await h.handle(req);
  assert.equal(res.status, 413);
  assert.equal(h.db.messages.length, 0);
});

test("SendGrid arm: attachments are counted and described, their bytes are not stored", async () => {
  const h = harness(ENV);
  assert.equal((await h.handle(parseRequest(parseForm({ attachments: 2 })))).status, 200);
  const m = h.db.messages[0];
  assert.deepEqual(m.attachments, []);
  const meta = m.meta as Row;
  assert.equal(meta.raw_attachment_count, 2);
  assert.deepEqual((meta.attachments_not_stored as Row[]).map((a) => [a.filename, a.type]), [
    ["doc1.pdf", "application/pdf"], ["doc2.pdf", "application/pdf"],
  ]);
});

// ── Review fixes (H1, M1–M4, L1–L6) ──────────────────────────────────────────────────────────
const TENANT_C = "10000000-0000-4000-8000-00000000000c";

test("H1: an admin-written inbound_domain on mail.paigeagent.ai captures nothing; a business's own domain still routes", async () => {
  const db = freshDb();
  db.channel_connectors.push(
    { id: "conn-attacker", tenant_id: TENANT_C, channel_type: "email", provider: "resend", active: true,
      inbound_address: null, inbound_domain: "mail.paigeagent.ai", from_address: null, from_name: null, reply_to: null, mailbox_class: null },
    { id: "conn-custom", tenant_id: TENANT_A, channel_type: "email", provider: "resend", active: true,
      inbound_address: null, inbound_domain: "acme-custom.example", from_address: null, from_name: null, reply_to: null, mailbox_class: null },
  );
  db.tenants.push({ id: TENANT_C, owner_user_id: OWNER });
  const h = harness(ENV, db);
  for (const to of ["nobody@mail.paigeagent.ai", "retired@mail.paigeagent.ai"]) {
    const res = await h.handle(parseRequest(parseForm({ to })));
    assert.equal((await res.json()).reason, "no_connector", to);
  }
  assert.equal(h.db.messages.length, 0);
  const own = await h.handle(parseRequest(parseForm({ to: "anyone@acme-custom.example" })));
  assert.equal(own.status, 200);
  assert.equal(h.db.messages.length, 1);
  assert.equal(h.db.messages[0].connector_id, "conn-custom");
});

test("M1: one post addressed to two businesses lands in BOTH, each row holding only its own recipient", async () => {
  const h = harness(ENV);
  const res = await h.handle(parseRequest(parseForm({
    to: "acme@mail.paigeagent.ai", envelopeTo: ["acme@mail.paigeagent.ai", "beta-co@mail.paigeagent.ai"],
  })));
  assert.equal(res.status, 200);
  assert.equal(h.db.messages.length, 2);
  const byConn = Object.fromEntries(h.db.messages.map((m) => [m.connector_id as string, m]));
  assert.deepEqual(byConn["conn-a"].recipients, [{ address: "acme@mail.paigeagent.ai" }]);
  assert.deepEqual(byConn["conn-b"].recipients, [{ address: "beta-co@mail.paigeagent.ai" }]);
  assert.deepEqual((byConn["conn-a"].meta as Row).to, ["acme@mail.paigeagent.ai"]);
  assert.deepEqual((byConn["conn-b"].meta as Row).to, ["beta-co@mail.paigeagent.ai"]);
  assert.equal(byConn["conn-a"].provider_message_id, `sendgrid-inbound:${TENANT_A}:CABQbZK-reply-1@mail.gmail.com`);
  assert.equal(byConn["conn-b"].provider_message_id, `sendgrid-inbound:${TENANT_B}:CABQbZK-reply-1@mail.gmail.com`);
  assert.deepEqual(h.db.paige_actions.map((a) => a.tenant_id).sort(), [TENANT_A, TENANT_B]);
});

test("M1: one business failing transiently does not lose the other; 503, and the redelivery completes it", async () => {
  const faults: Faults = { failMessageInsert: { connector_id: "conn-b", times: 1 } };
  const h = harness(ENV, freshDb(), faults);
  const form = () => parseForm({ envelopeTo: ["acme@mail.paigeagent.ai", "beta-co@mail.paigeagent.ai"] });
  const first = await h.handle(parseRequest(form()));
  assert.equal(first.status, 503);
  assert.deepEqual(h.db.messages.map((m) => m.connector_id), ["conn-a"]);
  const retry = await h.handle(parseRequest(form()));
  assert.equal(retry.status, 200);
  assert.deepEqual(h.db.messages.map((m) => m.connector_id).sort(), ["conn-a", "conn-b"]);
  assert.equal(h.db.paige_actions.length, 2);
});

test("M2: a From that neither SPF nor DKIM authenticates is kept, but not linked to the real contact and not auto-drafted", async () => {
  const db = freshDb();
  db.clients.push({ id: "client-real", tenant_id: TENANT_A, email: "ada@client.example" });
  const h = harness(ENV, db);
  const res = await h.handle(parseRequest(parseForm({
    dkim: "{@attacker.example : pass}", spf: "fail", envelopeFrom: "bounce@attacker.example",
  })));
  assert.equal(res.status, 200);
  assert.equal(h.db.messages.length, 1);
  const m = h.db.messages[0];
  assert.equal(m.contact_id, null);
  assert.equal(m.thread_key, `email-unverified:${TENANT_A}:ada@client.example`);
  assert.equal((m.meta as Row).sender_unauthenticated, true);
  assert.equal(h.db.paige_actions.length, 0);
  assert.equal(h.db.paige_conversations.length, 0);
  assert.deepEqual(h.db.clients.map((c) => c.id), ["client-real"]);
  assert.ok(!h.rpcCalls.some((c) => c.fn === "client_id_for_address"));
});

test("M2: an aligned SPF pass alone (no DKIM) authenticates; a DKIM pass for another domain does not", async () => {
  const db = freshDb();
  db.clients.push({ id: "client-real", tenant_id: TENANT_A, email: "ada@client.example" });
  const h = harness(ENV, db);
  await h.handle(parseRequest(parseForm({ dkim: "none", spf: "pass", envelopeFrom: "bounces@mail.client.example" })));
  assert.equal(h.db.messages[0].contact_id, "client-real");
  assert.equal(((h.db.messages[0].meta as Row).sender_unauthenticated), undefined);
  await h.handle(parseRequest(parseForm({ messageId: "other-1@x", dkim: "{@sendgrid.net : pass}", spf: "softfail" })));
  assert.equal((h.db.messages[1].meta as Row).sender_unauthenticated, true);
  assert.equal(h.db.messages[1].contact_id, null);
});

test("N3: a sibling-subdomain DKIM signer and an SPF result with a trailing comment both authenticate", async () => {
  const db = freshDb();
  db.clients.push({ id: "client-real", tenant_id: TENANT_A, email: "ada@corp.client.example" });
  const h = harness(ENV, db);
  await h.handle(parseRequest(parseForm({
    from: "Ada <ada@corp.client.example>", dkim: "{@em.client.example : pass}", spf: "none",
  })));
  assert.equal((h.db.messages[0].meta as Row).sender_unauthenticated, undefined);
  assert.equal(h.db.messages[0].contact_id, "client-real");
  await h.handle(parseRequest(parseForm({
    messageId: "spf-comment@x", from: "Ada <ada@corp.client.example>", dkim: "none",
    spf: "pass (sender SPF authorized)", envelopeFrom: "bounce@client.example",
  })));
  assert.equal((h.db.messages[1].meta as Row).sender_unauthenticated, undefined);
  // A signer whose organizational domain differs still does not authenticate, under a country suffix too.
  await h.handle(parseRequest(parseForm({
    messageId: "cc-tld@x", from: "Ada <ada@firm.co.uk>", dkim: "{@attacker.co.uk : pass}", spf: "none",
  })));
  assert.equal((h.db.messages[2].meta as Row).sender_unauthenticated, true);
});

test("N5: a permanent integrity violation on one business is acknowledged (no retry storm); a transient one is still 503", async () => {
  const permanent: Faults = { failMessageInsert: { connector_id: "conn-b", times: 1, code: "23514" } };
  const h = harness(ENV, freshDb(), permanent);
  const res = await h.handle(parseRequest(parseForm({ envelopeTo: ["acme@mail.paigeagent.ai", "beta-co@mail.paigeagent.ai"] })));
  assert.equal(res.status, 200);
  const body = await res.json() as { results: Array<{ outcome: string }> };
  assert.deepEqual(body.results.map((r) => r.outcome).sort(), ["persisted", "rejected"]);
  const transient: Faults = { failMessageInsert: { connector_id: "conn-b", times: 1 } };
  const h2 = harness(ENV, freshDb(), transient);
  const res2 = await h2.handle(parseRequest(parseForm({ envelopeTo: ["acme@mail.paigeagent.ai", "beta-co@mail.paigeagent.ai"] })));
  assert.equal(res2.status, 503);
});

test("M3: an attachment-only reply (empty body) is persisted, not dropped", async () => {
  const h = harness(ENV);
  const res = await h.handle(parseRequest(parseForm({ text: "", html: "", attachments: 1 })));
  assert.equal(res.status, 200);
  assert.equal(h.db.messages.length, 1);
  assert.equal(h.db.messages[0].body_text, null);
  assert.equal((h.db.messages[0].meta as Row).raw_attachment_count, 1);
  // Still nothing to keep when there is no body AND no attachment.
  const empty = await h.handle(parseRequest(parseForm({ messageId: "empty-1@x", text: "", html: "" })));
  assert.equal((await empty.json()).reason, "missing_fields");
  assert.equal(h.db.messages.length, 1);
});

test("M4a: a contact-lookup error is 503 with nothing misfiled", async () => {
  const h = harness(ENV, freshDb(), { failRpc: "client_id_for_address" });
  const res = await h.handle(parseRequest(parseForm()));
  assert.equal(res.status, 503);
  assert.equal(h.db.messages.length, 0);
  assert.equal(h.db.clients.length, 0);
});

test("M4b: a failed draft-reply insert is 503, and the redelivery dedups AND files the draft exactly once", async () => {
  const faults: Faults = { failActionInsertTimes: 1 };
  const h = harness(ENV, freshDb(), faults);
  const first = await h.handle(parseRequest(parseForm()));
  assert.equal(first.status, 503);
  assert.equal(h.db.messages.length, 1);
  assert.equal(h.db.paige_actions.length, 0);
  const retry = await h.handle(parseRequest(parseForm()));
  assert.equal(retry.status, 200);
  assert.equal((await retry.json()).results[0].outcome, "deduped");
  assert.equal(h.db.paige_actions.length, 1);
  assert.equal((h.db.paige_actions[0].payload as Row).message_id, h.db.messages[0].id);
  // A further redelivery files nothing more.
  assert.equal((await h.handle(parseRequest(parseForm()))).status, 200);
  assert.equal(h.db.paige_actions.length, 1);
});

test("M4b: a message that landed before a crash (no draft yet) gets its draft on redelivery", async () => {
  const db = freshDb();
  db.clients.push({ id: "client-real", tenant_id: TENANT_A, email: "ada@client.example" });
  db.messages.push({
    id: "messages-pre", connector_id: "conn-a", contact_id: "client-real", thread_key: `contact:${TENANT_A}:client-real`,
    provider_message_id: `sendgrid-inbound:${TENANT_A}:CABQbZK-reply-1@mail.gmail.com`,
  });
  const h = harness(ENV, db);
  assert.equal((await h.handle(parseRequest(parseForm()))).status, 200);
  assert.equal(h.db.paige_actions.length, 1);
  assert.equal((h.db.paige_actions[0].payload as Row).message_id, "messages-pre");
  assert.equal(h.db.paige_actions[0].contact_id, "client-real");
});

test("L1: the legacy mirror is keyed per business, so both businesses' copies are mirrored", async () => {
  const h = harness(ENV);
  await h.handle(parseRequest(parseForm({ envelopeTo: ["acme@mail.paigeagent.ai", "beta-co@mail.paigeagent.ai"] })));
  assert.deepEqual(h.db.paige_conversations.map((c) => c.source_message_id).sort(), [
    `sendgrid-inbound:${TENANT_A}:CABQbZK-reply-1@mail.gmail.com`,
    `sendgrid-inbound:${TENANT_B}:CABQbZK-reply-1@mail.gmail.com`,
  ]);
});

test("L2: an empty Message-ID `<>` is treated as absent (derived identity), not as the id `<>`", async () => {
  const h = harness(ENV);
  await h.handle(parseRequest(parseForm({ messageId: "" })));
  assert.match(String(h.db.messages[0].provider_message_id), new RegExp(`^sendgrid-inbound:${TENANT_A}:derived:[0-9a-f]{64}$`));
  // A different email with the same empty id is a different message, not a "duplicate".
  await h.handle(parseRequest(parseForm({ messageId: "", text: "Another." })));
  assert.equal(h.db.messages.length, 2);
});

test("L4: a body cut at the field cap is flagged body_truncated", async () => {
  const h = harness(ENV);
  await h.handle(parseRequest(parseForm({ text: "x".repeat(1_000_001) })));
  const m = h.db.messages[0];
  assert.equal(String(m.body_text).length, 1_000_000);
  assert.equal((m.meta as Row).body_truncated, true);
  await h.handle(parseRequest(parseForm({ messageId: "short-1@x" })));
  assert.equal((h.db.messages[1].meta as Row).body_truncated, undefined);
});

test("L6: the comment-form From `addr (Name)` is parsed", async () => {
  const h = harness(ENV);
  await h.handle(parseRequest(parseForm({ from: "ada@client.example (Ada Client)" })));
  assert.deepEqual(h.db.messages[0].sender, { address: "ada@client.example", display_name: "Ada Client" });
});

test("a chunked body over 32 MiB with no Content-Length is 413, cut off while streaming", async () => {
  const h = harness(ENV);
  const chunk = new Uint8Array(1024 * 1024);
  let sent = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= 33) { controller.close(); return; }
      sent += 1;
      controller.enqueue(chunk);
    },
  });
  const req = new Request("https://example.invalid/functions/v1/handle-inbound-email", {
    method: "POST",
    headers: {
      authorization: `Basic ${Buffer.from(`inbound:${SECRET}`).toString("base64")}`,
      "content-type": "multipart/form-data; boundary=x",
    },
    body,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
  assert.equal(req.headers.get("content-length"), null);
  const res = await h.handle(req);
  assert.equal(res.status, 413);
  assert.ok(sent <= 33);
  assert.equal(h.db.messages.length, 0);
});

// ── The Resend arm, unchanged ────────────────────────────────────────────────────────────────
const SVIX_KEY = Buffer.from("resend-svix-test-key-material-32b");
const SVIX_SECRET = `whsec_${SVIX_KEY.toString("base64")}`;

function svixRequest(payload: unknown, opts: { tamper?: boolean } = {}): Request {
  const body = JSON.stringify(payload);
  const id = "msg_2abc";
  const timestamp = String(Math.floor(Date.now() / 1000));
  const sig = createHmac("sha256", SVIX_KEY).update(`${id}.${timestamp}.${body}`).digest("base64");
  return new Request("https://example.invalid/functions/v1/handle-inbound-email", {
    method: "POST",
    headers: { "content-type": "application/json", "svix-id": id, "svix-timestamp": timestamp, "svix-signature": `v1,${sig}` },
    body: opts.tamper ? body.replace("Thursday", "Friday") : body,
  });
}
const resendEvent = {
  type: "email.received",
  data: {
    message_id: "resend-msg-1",
    from: { email: "Ada@Client.example", name: "Ada Client" },
    to: ["acme@mail.paigeagent.ai"],
    subject: "Re: your proposal",
    text: "Yes — Thursday works for me.",
    created_at: "2026-10-27T15:53:29.000Z",
  },
};

test("Resend arm unchanged: a Svix-signed JSON event still lands with Resend's own message id", async () => {
  const h = harness({ ...ENV, RESEND_WEBHOOK_SECRET: SVIX_SECRET });
  const res = await h.handle(svixRequest(resendEvent));
  assert.equal(res.status, 200);
  assert.equal(h.db.messages.length, 1);
  const m = h.db.messages[0];
  assert.equal(m.provider_message_id, "resend-msg-1");
  assert.equal(m.connector_id, "conn-a");
  assert.equal((m.meta as Row).provider, "resend");
  assert.deepEqual(m.sender, { address: "ada@client.example", display_name: "Ada Client" });
});

test("Resend arm unchanged: no secret → 500, bad signature → 401 (the SendGrid secret is not a Resend proof)", async () => {
  const noSecret = harness(ENV);
  assert.equal((await noSecret.handle(svixRequest(resendEvent))).status, 500);
  const h = harness({ ...ENV, RESEND_WEBHOOK_SECRET: SVIX_SECRET });
  assert.equal((await h.handle(svixRequest(resendEvent, { tamper: true }))).status, 401);
  assert.equal(h.db.messages.length + noSecret.db.messages.length, 0);
});
