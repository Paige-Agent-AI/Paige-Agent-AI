// detect-credit-alerts — who may raise a credit alert, and for whom (E09 H0).
//
// Drives the REAL handler against a recording fake of the service-role client: every table read,
// every insert/update, every function invoke (push, email) and every auth-admin lookup is captured,
// so "nothing was written, pushed or emailed" is an assertion over the actual calls, not a reading.
//
// Run: deno test --allow-read=supabase/functions,supabase/migrations --node-modules-dir=none \
//        --deny-net --deny-env --deny-write --deny-run --deny-ffi --deny-sys \
//        supabase/functions/detect-credit-alerts/handler.test.ts

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handleDetectCreditAlerts } from "./handler.ts";
import { constantTimeEquals, isServiceRoleBearer } from "../_shared/service-role-bearer.ts";

const SERVICE_KEY = "service-role-key-for-tests-0123456789";
const ANON_KEY = "anon-publishable-key-for-tests-0123456789";
const USER_JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.signature";

const ENTITLED = "11111111-1111-4111-8111-111111111111";
const PLAIN = "22222222-2222-4222-8222-222222222222";
const FINANCE_ITEM = "33333333-3333-4333-8333-333333333333";
const STAFF = "44444444-4444-4444-8444-444444444444";
const CUSTOMER = "55555555-5555-4555-8555-555555555555";
const ORPHAN = "66666666-6666-4666-8666-666666666666";
const TWO_BUSINESSES = "77777777-7777-4777-8777-777777777777";
const PLAIN_STAFF = "88888888-8888-4888-8888-888888888888";

type Row = Record<string, unknown>;
interface World {
  clients: Row[];
  tenant_members: Row[];
  marketplace_installs: Row[];
  marketplace_items: Row[];
  tenants: Row[];
  profiles: Row[];
  credit_alerts: Row[];
  coach_clients: Row[];
}

function world(): World {
  return {
    clients: [
      { tenant_id: ENTITLED, linked_user_id: STAFF },
      { tenant_id: ENTITLED, linked_user_id: CUSTOMER },
      { tenant_id: ENTITLED, linked_user_id: TWO_BUSINESSES },
      { tenant_id: PLAIN, linked_user_id: TWO_BUSINESSES },
      { tenant_id: PLAIN, linked_user_id: PLAIN_STAFF },
    ],
    tenant_members: [
      { id: "m1", tenant_id: ENTITLED, user_id: STAFF, status: "active" },
      { id: "m2", tenant_id: PLAIN, user_id: PLAIN_STAFF, status: "active" },
      // A member of ANOTHER business who is only a customer of the entitled one.
      { id: "m3", tenant_id: PLAIN, user_id: CUSTOMER, status: "active" },
    ],
    marketplace_installs: [{ tenant_id: ENTITLED, item_id: FINANCE_ITEM, status: "active" }],
    marketplace_items: [{ id: FINANCE_ITEM, is_finance: true }],
    tenants: [{ id: ENTITLED, features: {} }, { id: PLAIN, features: {} }],
    profiles: [
      { user_id: STAFF, full_name: "Sam Staff" },
      { user_id: CUSTOMER, full_name: "Casey Customer" },
    ],
    credit_alerts: [],
    coach_clients: [],
  };
}

interface Recorder {
  clientsBuilt: number;
  reads: string[];
  writes: { table: string; op: "insert" | "update"; row: Row }[];
  invokes: { name: string; body: Row }[];
  authLookups: string[];
}

function fakeClient(w: World, rec: Recorder) {
  function builder(table: keyof World) {
    const filters: [string, string, unknown][] = [];
    let op: "select" | "insert" | "update" = "select";
    let payload: Row | null = null;
    let single = false;
    let maybe = false;
    let limitN: number | null = null;
    const b: Record<string, unknown> = {
      select: () => b,
      insert: (row: Row) => { op = "insert"; payload = row; return b; },
      update: (row: Row) => { op = "update"; payload = row; return b; },
      eq: (c: string, v: unknown) => { filters.push(["eq", c, v]); return b; },
      gte: (c: string, v: unknown) => { filters.push(["gte", c, v]); return b; },
      in: (c: string, v: unknown) => { filters.push(["in", c, v]); return b; },
      limit: (n: number) => { limitN = n; return b; },
      single: () => { single = true; return b; },
      maybeSingle: () => { maybe = true; return b; },
      then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(run()).then(ok, bad),
    };
    function matches(r: Row) {
      return filters.every(([k, c, v]) =>
        k === "eq" ? r[c] === v : k === "in" ? (v as unknown[]).includes(r[c]) : k === "gte" ? String(r[c] ?? "") >= String(v) : true
      );
    }
    function run() {
      if (op === "insert") {
        const row = { id: crypto.randomUUID(), ...(payload as Row) };
        rec.writes.push({ table, op, row });
        w[table].push(row);
        return { data: single ? { id: row.id } : [row], error: null };
      }
      if (op === "update") {
        rec.writes.push({ table, op, row: payload as Row });
        return { data: null, error: null };
      }
      rec.reads.push(table);
      let rows = w[table].filter(matches);
      if (limitN !== null) rows = rows.slice(0, limitN);
      if (maybe) return { data: rows[0] ?? null, error: null };
      if (single) return { data: rows[0] ?? null, error: rows[0] ? null : { message: "no rows" } };
      return { data: rows, error: null };
    }
    return b;
  }
  return {
    from: (t: string) => builder(t as keyof World),
    functions: {
      invoke: (name: string, opts: { body: Row }) => {
        rec.invokes.push({ name, body: opts.body });
        return Promise.resolve({ data: null, error: null });
      },
    },
    auth: {
      admin: {
        getUserById: (id: string) => {
          rec.authLookups.push(id);
          return Promise.resolve({ data: { user: { id, email: `${id.slice(0, 4)}@example.test` } }, error: null });
        },
      },
    },
  };
}

function harness(w: World = world()) {
  const rec: Recorder = { clientsBuilt: 0, reads: [], writes: [], invokes: [], authLookups: [] };
  const deps = {
    serviceKey: SERVICE_KEY,
    serviceClient: () => { rec.clientsBuilt++; return fakeClient(w, rec); },
    resolveOperatorIdentity: () =>
      Promise.resolve({ from_name: "Example Studio", product_name: null, sender: { domain: "example.test" } }) as never,
  };
  return { w, rec, deps };
}

/** A body that yields one CRITICAL alert (a new collection) plus a score drop. */
function criticalBody(subject: string): Row {
  return {
    client_id: subject,
    new_scores: { experian: 600 },
    previous_scores: { experian: 650 },
    new_accounts: [],
    previous_accounts: [{ creditor: "Prior Bank", account_number: "1", is_open: true }],
    new_negatives: [{ creditor_name: "Collector Co", account_number: "9", item_type: "collection", amount: 120, bureau: "experian" }],
    previous_negatives: [],
    bureau_source: "all",
  };
}

function req(body: Row, authorization?: string): Request {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (authorization !== undefined) headers.set("Authorization", authorization);
  return new Request("http://local/detect-credit-alerts", { method: "POST", headers, body: JSON.stringify(body) });
}

function assertNothingDone(rec: Recorder) {
  assertEquals(rec.writes, [], "no insert or update");
  assertEquals(rec.invokes, [], "no push and no email");
  assertEquals(rec.authLookups, [], "no recipient address looked up");
}

// --- 1. Bearer: only the service-role key -----------------------------------------------------

for (const [label, auth] of [
  ["no Authorization header", undefined],
  ["the anon (publishable) key", `Bearer ${ANON_KEY}`],
  ["a signed-in user's JWT", `Bearer ${USER_JWT}`],
  ["a non-Bearer scheme carrying the service key", `Basic ${SERVICE_KEY}`],
  ["a prefix of the service key", `Bearer ${SERVICE_KEY.slice(0, -1)}`],
] as const) {
  Deno.test(`401 and no DB client for ${label}`, async () => {
    const { rec, deps } = harness();
    const res = await handleDetectCreditAlerts(req(criticalBody(STAFF), auth), deps);
    assertEquals(res.status, 401);
    assertEquals(await res.json(), { error: "unauthorized", reason: "service_role_required" });
    assertEquals(rec.clientsBuilt, 0, "the service-role client is never built");
    assertEquals(rec.reads, []);
    assertNothingDone(rec);
  });
}

Deno.test("401 when the service key is unset, even for an empty bearer", async () => {
  const { rec, deps } = harness();
  const res = await handleDetectCreditAlerts(req(criticalBody(STAFF), "Bearer "), { ...deps, serviceKey: undefined });
  assertEquals(res.status, 401);
  assertEquals(rec.clientsBuilt, 0);
});

Deno.test("constant-time compare: equal, unequal, and different lengths", () => {
  assert(constantTimeEquals("abc", "abc"));
  assert(!constantTimeEquals("abc", "abd"));
  assert(!constantTimeEquals("abc", "abcd"));
  assert(!constantTimeEquals("", "a"));
  assert(isServiceRoleBearer(`bearer   ${SERVICE_KEY}  `, SERVICE_KEY), "scheme is case-insensitive, whitespace trimmed");
  assert(!isServiceRoleBearer(`Bearer ${SERVICE_KEY}`, ""), "an empty key never matches");
});

// --- 2. Subject: one business, entitled, staff ------------------------------------------------

Deno.test("service role + non-entitled business → skipped, nothing inserted, pushed or emailed", async () => {
  const { rec, deps } = harness();
  const res = await handleDetectCreditAlerts(req(criticalBody(PLAIN_STAFF), `Bearer ${SERVICE_KEY}`), deps);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { skipped: "business_not_finance_entitled", alerts_generated: 0 });
  assertNothingDone(rec);
});

Deno.test("service role + non-entitled business, FIRST upload path → skipped, no baseline alert", async () => {
  const { rec, deps } = harness();
  const body = { client_id: PLAIN_STAFF, new_accounts: [{ creditor: "A", bureau_source: "experian" }] };
  const res = await handleDetectCreditAlerts(req(body, `Bearer ${SERVICE_KEY}`), deps);
  assertEquals((await res.json()).skipped, "business_not_finance_entitled");
  assertNothingDone(rec);
});

Deno.test("service role + portal-customer subject of the entitled business → skipped", async () => {
  const { rec, deps } = harness();
  const res = await handleDetectCreditAlerts(req(criticalBody(CUSTOMER), `Bearer ${SERVICE_KEY}`), deps);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { skipped: "subject_is_portal_customer", alerts_generated: 0 });
  assertNothingDone(rec);
});

Deno.test("service role + subject with no business → skipped", async () => {
  const { rec, deps } = harness();
  const res = await handleDetectCreditAlerts(req(criticalBody(ORPHAN), `Bearer ${SERVICE_KEY}`), deps);
  assertEquals(await res.json(), { skipped: "no_single_business", alerts_generated: 0 });
  assertNothingDone(rec);
});

Deno.test("service role + subject linked to two businesses → skipped", async () => {
  const { rec, deps } = harness();
  const res = await handleDetectCreditAlerts(req(criticalBody(TWO_BUSINESSES), `Bearer ${SERVICE_KEY}`), deps);
  assertEquals(await res.json(), { skipped: "no_single_business", alerts_generated: 0 });
  assertNothingDone(rec);
});

Deno.test("entitlement through the finance_in_scope flag alone also authorizes (both legs of the expression)", async () => {
  const { w, rec, deps } = harness();
  w.marketplace_installs = [];
  w.tenants = [{ id: ENTITLED, features: { finance_in_scope: true } }, { id: PLAIN, features: {} }];
  const res = await handleDetectCreditAlerts(req(criticalBody(STAFF), `Bearer ${SERVICE_KEY}`), deps);
  assertEquals(res.status, 200);
  assert(rec.writes.some((x) => x.table === "credit_alerts" && x.op === "insert"));
});

Deno.test("an inactive (uninstalled) finance install does not entitle → skipped", async () => {
  const { w, rec, deps } = harness();
  w.marketplace_installs = [{ tenant_id: ENTITLED, item_id: FINANCE_ITEM, status: "uninstalled" }];
  const res = await handleDetectCreditAlerts(req(criticalBody(STAFF), `Bearer ${SERVICE_KEY}`), deps);
  assertEquals((await res.json()).skipped, "business_not_finance_entitled");
  assertNothingDone(rec);
});

// --- 3. The authorized path is unchanged ------------------------------------------------------

Deno.test("service role + entitled business + staff subject → alerts inserted, pushed and emailed as before", async () => {
  const { rec, deps } = harness();
  const res = await handleDetectCreditAlerts(req(criticalBody(STAFF), `Bearer ${SERVICE_KEY}`), deps);
  assertEquals(res.status, 200);
  const out = await res.json();
  assertEquals(out.success, true);
  assertEquals(out.critical, 2, "the score drop and the new collection are both critical");
  const inserts = rec.writes.filter((x) => x.table === "credit_alerts" && x.op === "insert");
  assertEquals(inserts.length, out.alerts_generated);
  assert(inserts.every((x) => x.row.client_id === STAFF));
  const pushes = rec.invokes.filter((i) => i.name === "send-push-notification");
  assertEquals(pushes.length, 2);
  assert(pushes.every((p) => p.body.tenant_id === ENTITLED && p.body.user_id === STAFF), "push names the one resolved business");
  const emails = rec.invokes.filter((i) => i.name === "send-support-request");
  assertEquals(emails.length, 2);
  assert(String(emails[0].body.message).includes("The Example Studio Team"), "signed with the business's brand");
});

Deno.test("first upload for an entitled staff subject → the one baseline alert, as before", async () => {
  const { rec, deps } = harness();
  const body = { client_id: STAFF, new_accounts: [{ creditor: "A", bureau_source: "experian" }] };
  const res = await handleDetectCreditAlerts(req(body, `Bearer ${SERVICE_KEY}`), deps);
  const out = await res.json();
  assertEquals(out.first_upload, true);
  assertEquals(rec.writes.filter((x) => x.op === "insert").map((x) => x.row.alert_type), ["file_established"]);
});
