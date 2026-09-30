#!/usr/bin/env node
/**
 * The §9/§53 tenant-scope guards on the two comms webhooks — armed.
 *
 * WHY THIS EXISTS
 *
 * `twilio-status-callback` and `handle-inbound-sms` are this branch's headline
 * repairs: a delivery receipt must only advance the authenticated tenant's own
 * message, a tenant-authenticated callback must never reach the platform-tier
 * operator store, and an inbound text must only resolve a contact inside the
 * tenant that owns the receiving number.
 *
 * All three were enforced in code and covered by NOTHING. `vitest.config.ts` is
 * `include: ["src/**"]`, so no edge function is reachable by the unit suite, and
 * the existing smokes cover `voice-twiml` plus the pure auth module only. An
 * independent review demonstrated that deleting any one of these three guards
 * left every gate green — the branch's own §9 fixes could be reverted by a later
 * refactor without a single red check.
 *
 * So this drives the REAL handlers and asserts on what they actually READ and
 * WRITE, not on their prose. Only the Supabase client and the Deno global are
 * substituted; routing, authentication and scoping are the shipped code.
 *
 * READS ARE NOT WRITES. The recorder tags each recorded query with the verb that
 * built it, because the scope assertions are about the LOOKUP that selects a row.
 * A follow-up `update(...).eq("id", row.id)` is correctly keyed on the primary key
 * and carries no tenant_id; folding it into the same bucket would have made the
 * scope assertion fail for a reason that is not a defect.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const TENANT_A = "aaaaaaaa-1111-4111-8111-111111111111";
const TENANT_B = "bbbbbbbb-2222-4222-8222-222222222222";
const SECRET_A = "SECRET-A-" + "a".repeat(48);
const NUMBER_A = "+15550001111";
const MASTER_TOKEN = "master-auth-token-for-the-signature-path";

/** Mutable so a single case can adopt the "master token IS set" posture. */
let env = {};
const baseEnv = {
  SUPABASE_URL: "https://ref.functions.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
};
const setEnv = (extra = {}) => { env = { ...baseEnv, ...extra }; };

/**
 * A query recorder. Every `.eq()` is captured so a MISSING tenant predicate is
 * observable — the defect class here is an absent filter, which a stub that only
 * returns rows can never reveal.
 */
function makeAdmin(rows) {
  const queries = [];
  const rpcs = [];
  const builder = (table) => {
    const filters = {};
    let verb = "select";
    let payload = null;
    const q = {
      // A chained `.select(...)` after a write must NOT re-tag it as a read.
      // `insert(...).select("id").single()` is a real write, and this used to
      // record it as a select — so `wrote()` was false for a genuine write while
      // `reads()` counted it, and any future write assertion built that way would
      // have miscategorised silently. `verb` already starts as "select", so the
      // correct behaviour is simply to leave it alone here. (Written first as
      // `if (verb === "select") verb = "select"`, which behaves correctly and
      // reads like a line that does nothing.)
      select: () => q,
      // The PAYLOAD is captured, not just the verb. A compliance write carries
      // its tenant in the ROW, never in a filter, so a recorder that keeps only
      // filters cannot see the one value that makes the write correct.
      update: (row) => { verb = "update"; payload = row; return q; },
      insert: (row) => { verb = "insert"; payload = row; return q; },
      upsert: (row) => { verb = "upsert"; payload = row; return q; },
      // A DELETE is scoped by FILTERS, not by a payload — so it needs its own
      // helper. Its tenant predicate is the only thing stopping a lift on one
      // tenant's number from clearing suppressions on every other tenant.
      delete: () => { verb = "delete"; return q; },
      eq: (k, v) => { filters[k] = v; return q; },
      in: (k, v) => { filters[k] = v; return q; },
      or: (expr) => { filters.or = expr; return q; },
      order: () => q, limit: () => q, not: () => q,
      maybeSingle: async () => {
        queries.push({ table, verb, filters: { ...filters }, payload });
        return { data: rows(table, filters) ?? null, error: null };
      },
      single: async () => {
        queries.push({ table, verb, filters: { ...filters }, payload });
        return { data: rows(table, filters) ?? { id: `${table}-1` }, error: null };
      },
      then: (res) => {
        queries.push({ table, verb, filters: { ...filters }, payload });
        const r = rows(table, filters);
        res({ data: r ? [r] : [], error: null });
      },
    };
    return q;
  };
  return {
    queries,
    rpcs,
    /** Every DELETE against `t` is filtered by `key === val`. */
    deletesScoped(t, key, val) {
      const ds = queries.filter((q) => q.table === t && q.verb === "delete");
      return ds.length > 0 && ds.every((d) => d.filters[key] === val);
    },
    deleted: (t) => queries.some((q) => q.table === t && q.verb === "delete"),
    /** Every write to `t` carries `key === val` in its ROW. */
    writesCarry(t, key, val) {
      const ws = queries.filter((q) => q.table === t && q.verb !== "select");
      return ws.length > 0 && ws.every((w) => w.payload && w.payload[key] === val);
    },
    wrote: (t) => queries.some((q) => q.table === t && q.verb !== "select"),
    /** Any query at all against the table — reads or writes. */
    touched: (t) => queries.some((q) => q.table === t),
    /** Every row-SELECTING query on `t` carries `key === val`. */
    reads: (t) => queries.filter((q) => q.table === t && q.verb === "select"),
    scoped(t, key, val) {
      const rs = this.reads(t);
      return rs.length > 0 && rs.every((r) => r.filters[key] === val);
    },
    from: (t) => builder(t),
    /** RPC arguments are recorded too — `record_rail_event` carries its tenant
     *  as an argument, so an unrecorded call is an unobservable §9 decision. */
    rpc: async (name, args) => {
      rpcs.push({ name, args: args ?? null });
      // The contact an address names inside one workspace (20270515000000). Answered like a
      // `clients` read, so a lookup that reaches it resolves a contact exactly as before.
      if (name === "client_id_for_address") return { data: rows("client_id_for_address", args ?? {})?.id ?? null, error: null };
      return { data: null, error: null };
    },
  };
}

async function bundle(entry, name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
  const out = path.join(dir, "mod.mjs");
  await build({
    entryPoints: [entry], outfile: out, bundle: true, format: "esm",
    platform: "neutral", target: "es2022",
    plugins: [{
      name: "remote-stub",
      setup(b) {
        b.onResolve({ filter: /^https:\/\// }, (a) => ({ path: a.path, namespace: "remote-stub" }));
        b.onLoad({ filter: /.*/, namespace: "remote-stub" }, () => ({
          contents: "export function createClient(){ return globalThis.__ADMIN__; }", loader: "js",
        }));
      },
    }],
  });
  return out;
}

/** The real signature routine, so the master-signature posture is genuinely exercised. */
const { computeTwilioSignature } = await import(
  pathToFileURL(await bundle("supabase/functions/_shared/twilio-webhook-auth.ts", "auth-mod")).href
);

let n = 0;
const check = (label, cond) => { n++; assert.ok(cond, `FAILED: ${label}`); console.log(`  ok  ${label}`); };
const form = (o) => new URLSearchParams(o).toString();

console.log("comms tenant-scope smoke\n");

// ── twilio-status-callback ──────────────────────────────────────────────────
{
  let handler = null;
  setEnv();
  globalThis.Deno = { env: { get: (k) => env[k] }, serve: (h) => { handler = h; } };
  await import(pathToFileURL(await bundle("supabase/functions/twilio-status-callback/index.ts", "status-cb")).href);
  assert.ok(typeof handler === "function", "FAILED: no status-callback handler captured");

  /** The subaccount row MUST carry the secret back: the handler reads it as
   *  `expectedSecret` and compares, so a row without it authenticates nothing. */
  const subaccount = (f) =>
    f.inbound_webhook_secret === SECRET_A ? { tenant_id: TENANT_A, inbound_webhook_secret: SECRET_A } : null;

  // ── SMS delivery receipt, authenticated as TENANT A by A's own stamped secret.
  {
    setEnv();
    globalThis.__ADMIN__ = makeAdmin((table, f) => {
      if (table === "tenant_twilio_subaccounts") return subaccount(f);
      if (table === "messages") return { id: "msg-1", status: "queued", tenant_id: TENANT_A };
      return null;
    });
    const res = await handler(new Request(`https://ref.functions.supabase.co/fn?t=${SECRET_A}`, {
      method: "POST",
      body: form({ MessageSid: "SM1", MessageStatus: "delivered" }),
      headers: { "content-type": "application/x-www-form-urlencoded" },
    }));
    const a = globalThis.__ADMIN__;
    check("a tenant-authenticated delivery receipt is accepted", res.status === 200);
    check("...and its message lookup is scoped to the AUTHENTICATED tenant (§9)",
      a.scoped("messages", "tenant_id", TENANT_A));
    // NOT asserted here: "the SMS branch never touches the operator store."
    // `operator_messages` appears only inside the VOICE handler, so on this path
    // that could not fail under any mutation — it would be decoration wearing a
    // guard's name. The §53 refusal is asserted below, on the branch that has an
    // operator path to refuse.
    check("...and the update is keyed on the row that lookup returned",
      a.queries.filter((q) => q.table === "messages" && q.verb === "update")
        .every((w) => w.filters.id === "msg-1"));
  }

  // ── VOICE completion, tenant-authenticated, with NO matching tenant row.
  //    This is the tenant→platform crossing the guard exists to refuse: the
  //    operator store holds no tenant_id, so reaching it on a tenant's secret
  //    would let that secret advance a platform-tier row.
  {
    setEnv();
    globalThis.__ADMIN__ = makeAdmin((table, f) => {
      if (table === "tenant_twilio_subaccounts") return subaccount(f);
      if (table === "messages") return null; // no tenant voice row matches
      if (table === "operator_messages") return { id: "op-1", status: "queued", metadata: {} };
      return null;
    });
    const res = await handler(new Request(`https://ref.functions.supabase.co/fn?t=${SECRET_A}`, {
      method: "POST",
      body: form({ CallSid: "CA1", CallStatus: "completed", CallDuration: "42" }),
      headers: { "content-type": "application/x-www-form-urlencoded" },
    }));
    const a = globalThis.__ADMIN__;
    check("a tenant-authenticated voice callback with no tenant row is acked", res.status === 200);
    check("...and the operator store is NOT consulted on a tenant secret (§53)",
      !a.touched("operator_messages"));
    check("...and its own voice lookup was tenant-scoped (§9)",
      a.scoped("messages", "tenant_id", TENANT_A));
  }

  // ── The TENANT voice store. No fixture reached it before, so the branch that
  //    dispatches `messages` was never executed: deleting the whole tenant voice
  //    write, or re-pointing it at the platform-tier operator store — the exact
  //    §53 crossing this suite exists to prevent — both left every assertion green.
  {
    setEnv();
    globalThis.__ADMIN__ = makeAdmin((table, f) => {
      if (table === "tenant_twilio_subaccounts") return subaccount(f);
      if (table === "messages") return { id: "msg-voice-1", status: "queued", meta: {} };
      if (table === "operator_messages") return { id: "op-1", status: "queued", metadata: {} };
      return null;
    });
    const res = await handler(new Request(`https://ref.functions.supabase.co/fn?t=${SECRET_A}`, {
      method: "POST",
      body: form({ CallSid: "CA2", CallStatus: "completed", CallDuration: "17" }),
      headers: { "content-type": "application/x-www-form-urlencoded" },
    }));
    const a = globalThis.__ADMIN__;
    const tUpdates = a.queries.filter((q) => q.table === "messages" && q.verb === "update");
    check("a tenant voice callback with a matching row is accepted", res.status === 200);
    check("...and the TENANT store is the one written (non-vacuity)", tUpdates.length > 0);
    check("...keyed on the row the lookup returned, never an unfiltered UPDATE",
      tUpdates.every((w) => w.filters.id === "msg-voice-1"));
    check("...and the platform-tier operator store is NOT written (§53)",
      !a.queries.some((q) => q.table === "operator_messages" && q.verb !== "select"));
  }

  // ── NON-VACUITY. The operator store IS reachable — but only for a callback
  //    proven by the MASTER Twilio signature, which is account-bound and carries
  //    no tenant. Without this case the two assertions above could both pass
  //    because nothing in this handler ever touches that store.
  {
    setEnv({ TWILIO_AUTH_TOKEN: MASTER_TOKEN });
    globalThis.__ADMIN__ = makeAdmin((table) => {
      if (table === "messages") return null;
      if (table === "operator_messages") return { id: "op-1", status: "queued", metadata: {} };
      return null;
    });
    const url = "https://ref.functions.supabase.co/fn";
    const body = form({ CallSid: "CA9", CallStatus: "completed" });
    const sig = await computeTwilioSignature(MASTER_TOKEN, url, body);
    const res = await handler(new Request(url, {
      method: "POST", body,
      headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": sig },
    }));
    const a = globalThis.__ADMIN__;
    check("a master-signature callback is accepted (the signature path really works)", res.status === 200);
    check("...and DOES reach the operator store, so the §53 refusal above is not vacuous",
      a.touched("operator_messages"));
    // The voice applier writes to whichever store matched — including the
    // PLATFORM-TIER one. Without its `.eq("id", row.id)` this is an unfiltered
    // UPDATE across every row of that table: status, meta, duration, recording
    // URL and transcript rewritten platform-wide. The SMS applier's equivalent
    // key was asserted three lines away in this file; this one was not.
    const opUpdates = a.queries.filter((q) => q.table === "operator_messages" && q.verb === "update");
    check("...and its voice update really ran (non-vacuity)", opUpdates.length > 0);
    check("...keyed on the row the lookup returned, never an unfiltered UPDATE",
      opUpdates.every((w) => w.filters.id === "op-1"));
    check("...and its tenant lookup carried NO tenant filter, as a signature is account-bound",
      a.reads("messages").every((r) => r.filters.tenant_id === undefined));
  }

  // ── An unstamped, unsigned callback proves nothing and is refused outright.
  {
    setEnv();
    globalThis.__ADMIN__ = makeAdmin(() => null);
    const res = await handler(new Request("https://ref.functions.supabase.co/fn", {
      method: "POST",
      body: form({ MessageSid: "SM8", MessageStatus: "delivered" }),
      headers: { "content-type": "application/x-www-form-urlencoded" },
    }));
    check("an unauthenticated callback is refused and writes nothing",
      res.status === 401 && globalThis.__ADMIN__.queries.filter((q) => q.verb !== "select").length === 0);
  }
}

// ── handle-inbound-sms ──────────────────────────────────────────────────────
{
  let handler = null;
  setEnv();
  globalThis.Deno = { env: { get: (k) => env[k] }, serve: (h) => { handler = h; } };
  await import(pathToFileURL(await bundle("supabase/functions/handle-inbound-sms/index.ts", "inbound-sms")).href);
  assert.ok(typeof handler === "function", "FAILED: no inbound-sms handler captured");

  /**
   * `opts.linkedUser` decides WHICH contact-resolution branch the handler takes.
   *
   * There are THREE sender-keyed resolution sites, not two: `linked_user_id`,
   * the phone fallback beneath it, and `resolveContactForTenant` on the STOP path
   * (both phone lookups go through client_id_for_address, by any of a contact's
   * numbers; neither reads the retired `clients.phone` column). A fixture that
   * always returns a `communication_preferences` row makes `prefs?.user_id` truthy
   * every time, so the first branch always wins and the phone fallback is DEAD in
   * every case — its tenant predicate could
   * be deleted with the whole suite still green. Returning null here reaches it.
   *
   * `opts.numberStatus` exercises the released/suspended-number guard.
   */
  const makeRows = (opts = {}) => (table, f) => {
    if (table === "tenant_twilio_subaccounts") {
      if (f.inbound_webhook_secret === SECRET_A) return { tenant_id: TENANT_A, inbound_webhook_secret: SECRET_A };
      if (f.tenant_id === TENANT_A) return { tenant_id: TENANT_A, inbound_webhook_secret: SECRET_A };
      return null;
    }
    if (table === "tenant_phone_numbers") {
      // The handler filters on status; honour it rather than returning
      // unconditionally, or a dropped `.eq("status","active")` is invisible.
      const want = opts.numberStatus ?? "active";
      if (f.status !== undefined && f.status !== want) return null;
      return { tenant_id: TENANT_A, phone_number: NUMBER_A, status: want };
    }
    if (table === "communication_preferences") return opts.linkedUser === false ? null : { user_id: "user-1" };
    if (table === "clients") return { id: "contact-1", tenant_id: TENANT_A };
    if (table === "client_id_for_address") return f._tenant_id === TENANT_A ? { id: "contact-1" } : null;
    return null;
  };
  const rows = makeRows();

  /**
   * The reads that RESOLVE a contact from the sender — the only ones a tenant
   * predicate protects. A later re-read keyed on `id` is a re-read of the contact
   * this tenant-scoped resolution already returned, so it is deliberately not in
   * this set; requiring a tenant filter there would assert something that is not
   * the guard and would fail for a reason that is not a defect.
   */
  const SENDER_KEYS = ["linked_user_id"];
  // A sender's number is matched through its contact methods (client_id_for_address, which
  // recognises ANY of a contact's phones). That lookup is a sender-keyed resolution too, and
  // its workspace is the `_tenant_id` argument, so it is held to the same tenant predicate.
  const addressLookups = (a) => a.rpcs.filter((r) => r.name === "client_id_for_address")
    .map((r) => ({ filters: { tenant_id: r.args?._tenant_id, kind: r.args?._kind } }));
  const senderResolutions = (a) => [
    ...a.reads("clients").filter((r) => SENDER_KEYS.some((k) => k in r.filters)),
    ...addressLookups(a),
  ];

  const post = (body) =>
    handler(new Request(`https://ref.functions.supabase.co/fn?t=${SECRET_A}`, {
      method: "POST", body: form(body),
      headers: { "content-type": "application/x-www-form-urlencoded" },
    }));

  // ── An ordinary inbound text: resolves a contact via the sender's number/user.
  {
    globalThis.__ADMIN__ = makeAdmin(rows);
    const res = await post({ To: NUMBER_A, From: "+15559998888", Body: "hello", MessageSid: "SM2" });
    const a = globalThis.__ADMIN__;
    check("an authenticated inbound text is accepted", res.status === 200);
    check("...and it really did resolve a contact from the sender (non-vacuity)",
      senderResolutions(a).length > 0);
    check("...and every sender-keyed contact resolution is scoped to the RECEIVING tenant (§9)",
      senderResolutions(a).every((r) => r.filters.tenant_id === TENANT_A));
    check("...and no contact is ever resolved inside another tenant",
      a.reads("clients").every((r) => r.filters.tenant_id !== TENANT_B));
  }

  // ── STOP takes a DIFFERENT resolution path (the suppression ledger's own
  //    lookup), which the case above never reaches. Both sites must be scoped.
  {
    globalThis.__ADMIN__ = makeAdmin(rows);
    const res = await post({ To: NUMBER_A, From: "+15559998888", Body: "STOP", MessageSid: "SM3" });
    const a = globalThis.__ADMIN__;
    check("an inbound STOP is accepted", res.status === 200);
    check("...and its contact resolution happened at all (non-vacuity)",
      senderResolutions(a).length > 0);
    check("...and is likewise scoped to the RECEIVING tenant (§9)",
      senderResolutions(a).every((r) => r.filters.tenant_id === TENANT_A));
  }

  // ── The SAME text, resolved through the `phone` FALLBACK branch.
  //    Without this the fallback's tenant predicate is never executed at all.
  {
    globalThis.__ADMIN__ = makeAdmin(makeRows({ linkedUser: false }));
    const res = await post({ To: NUMBER_A, From: "+15559998888", Body: "hello", MessageSid: "SM5" });
    const a = globalThis.__ADMIN__;
    check("an inbound text still resolves when the sender has no linked user", res.status === 200);
    const byPhone = addressLookups(a).filter((r) => r.filters.kind === "phone");
    check("...and the PHONE-fallback resolution really ran (non-vacuity)", byPhone.length > 0);
    check("...and it too is scoped to the RECEIVING tenant (§9)",
      byPhone.every((r) => r.filters.tenant_id === TENANT_A));
    check("...and it matches the contact's addresses, never the retired clients.phone column",
      a.reads("clients").every((r) => !("phone" in r.filters) && !("or" in r.filters)));
  }

  // ── The compliance writes carry their tenant in the ROW, not in a filter.
  //    On the service-role path `current_user_tenant_id()` is NULL, so the
  //    explicit column is the only thing scoping a contactless STOP.
  {
    globalThis.__ADMIN__ = makeAdmin(rows);
    await post({ To: NUMBER_A, From: "+15559998888", Body: "STOP", MessageSid: "SM6" });
    const a = globalThis.__ADMIN__;
    check("a STOP writes a suppression row", a.wrote("paige_suppressions"));
    check("...carrying the receiving tenant explicitly (§9)",
      a.writesCarry("paige_suppressions", "tenant_id", TENANT_A));
    check("a STOP writes a consent revocation", a.wrote("paige_consent_events"));
    check("...carrying the receiving tenant explicitly (§9)",
      a.writesCarry("paige_consent_events", "tenant_id", TENANT_A));
  }

  // ── The rail emit, asserted on the branch that REACHES it.
  //
  //    This assertion previously sat in the STOP block, where the emit is
  //    unreachable: it is gated behind `if (contactId)` AFTER the conversation
  //    insert, which a STOP never performs. `[].every()` is true, so it passed
  //    while `p_tenant_id` could be replaced with a zero UUID unnoticed — the
  //    same "assertion that cannot fail" the commit before it claimed to remove.
  {
    globalThis.__ADMIN__ = makeAdmin(rows);
    await post({ To: NUMBER_A, From: "+15559998888", Body: "hello", MessageSid: "SM8" });
    const a = globalThis.__ADMIN__;
    const rail = a.rpcs.filter((r) => r.name === "record_rail_event");
    check("a plain inbound text files a rail event (non-vacuity)", rail.length > 0);
    // Pins the recorder itself: this insert chains `.select("id").single()`, so a
    // regression that re-tags it as a read makes `wrote()` false and this fails.
    check("...and the conversation insert is recorded as a WRITE, not a read",
      a.wrote("paige_conversations"));
    // C-7. This row used to be written with NO tenant, and the restrictive RLS
    // policy admitted `tenant_id IS NULL` — so every inbound SMS was readable AND
    // writable by the admin of every other tenant. Service-role bypasses RLS, so
    // the column has to be right at the write; no policy can repair it after.
    check("...and it carries the RECEIVING tenant on the row (\u00a79, C-7)",
      a.writesCarry("paige_conversations", "tenant_id", TENANT_A));
    check("...carrying the receiving tenant explicitly (§9)",
      rail.every((r) => r.args?.p_tenant_id === TENANT_A));
  }

  // ── START / opt-in. A DIFFERENT branch again, and the only one that DELETES.
  //
  //    Nothing reached it before: the suite sent "hello" and "STOP" only. Its
  //    tenant predicate is what stops one person texting START to one tenant's
  //    number from lifting their suppression on EVERY tenant that ever
  //    suppressed that address — a cross-tenant write, not merely a read.
  {
    globalThis.__ADMIN__ = makeAdmin(rows);
    const res = await post({ To: NUMBER_A, From: "+15559998888", Body: "START", MessageSid: "SM9" });
    const a = globalThis.__ADMIN__;
    check("an inbound START is accepted", res.status === 200);
    check("...and it really lifts a suppression (non-vacuity)", a.deleted("paige_suppressions"));
    check("...scoped to the RECEIVING tenant, never every tenant (§9)",
      a.deletesScoped("paige_suppressions", "tenant_id", TENANT_A));
    check("...and the consent GRANT it records carries the tenant explicitly (§9)",
      a.writesCarry("paige_consent_events", "tenant_id", TENANT_A));
  }

  // ── A number the tenant no longer holds must not authenticate anything.
  {
    globalThis.__ADMIN__ = makeAdmin(makeRows({ numberStatus: "released" }));
    const res = await post({ To: NUMBER_A, From: "+15559998888", Body: "hello", MessageSid: "SM7" });
    check("a RELEASED number no longer resolves its tenant's secret, so the text is refused",
      res.status === 401 && !globalThis.__ADMIN__.touched("paige_conversations"));
  }

  // ── An unstamped inbound text proves nothing and must be refused.
  {
    globalThis.__ADMIN__ = makeAdmin(rows);
    const res = await handler(new Request("https://ref.functions.supabase.co/fn", {
      method: "POST", body: form({ To: NUMBER_A, From: "+15559998888", Body: "hi", MessageSid: "SM4" }),
      headers: { "content-type": "application/x-www-form-urlencoded" },
    }));
    check("an unauthenticated inbound text is refused and files nothing",
      res.status === 401 && !globalThis.__ADMIN__.touched("paige_conversations"));
  }
}

console.log(`\n${n} assertions passed.`);
