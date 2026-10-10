#!/usr/bin/env node
/**
 * voice-twiml — the REQUEST HANDLER, driven end to end.
 *
 * WHY THIS EXISTS SEPARATELY FROM voice-twiml-callback-smoke.mjs
 *
 * That suite covers `twiml.ts` only. An independent adversarial review of the
 * first fix pointed out — correctly — that it therefore could not fail for the
 * defect it claimed to guard: the original bug lived in `index.ts`, and all of
 * its assertions still pass if `index.ts` sets `signatureVerified = true`, drops
 * the guard on the credential read, or hardcodes the argument. A proof that
 * cannot fail for its own defect is not a proof.
 *
 * So this drives the REAL `Deno.serve` handler from `index.ts` — the real
 * routing, the real tenant resolution, the real co-pilot fork decision — with a
 * real `Request` in and the real TwiML out. Only two things are substituted:
 * the Supabase client (canned rows) and the `Deno` global (env + serve capture).
 *
 * The class of defect under guard, stated once: this endpoint is
 * `verify_jwt = false`, and in the production credential model the master
 * TWILIO_AUTH_TOKEN is absent, so its signature check does not run. Everything it
 * returns therefore goes to an UNAUTHENTICATED caller, and every field it reads
 * from the body is attacker-supplied. Nothing secret or capability-bearing may
 * leave in a response to a request we did not authenticate. Two things have now
 * violated that rule — the stamped `?t=` webhook secret, and the co-pilot stream
 * token — so it is asserted here against the response body itself rather than
 * against any one expression.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

// ── Fixtures ────────────────────────────────────────────────────────────────
const TENANT = "7f3d2c11-1111-4111-8111-111111111111";
const SEAT = "22222222-2222-4222-8222-222222222222";
const CONTACT = "c0ffee00-3333-4333-8333-333333333333";
const OPERATOR_SEAT = "44444444-4444-4444-8444-444444444444";
const OTHER_TENANT = "9999aaaa-5555-4555-8555-555555555555";
const OTHER_SECRET = "OTHER-TENANT-SECRET-" + "x".repeat(30);
const SUBACCOUNT = "subaccount-row-1";
const OPERATOR_NUMBER = "+14700009999";
const TENANT_NUMBER = "+15550001111";
const WEBHOOK_SECRET = "WEBHOOK-SECRET-" + "s".repeat(40);
const STREAM_SECRET = "STREAM-SECRET-" + "z".repeat(40);
const CALLBACK_BASE = "https://ref.functions.supabase.co/functions/v1/twilio-status-callback";
const STREAM_URL = "wss://ref.functions.supabase.co/functions/v1/paige-stt";

const ENV = {
  SUPABASE_URL: "https://ref.functions.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  TWILIO_STATUS_CALLBACK_URL: CALLBACK_BASE,
  // The co-pilot is ACTIVATED in this harness on purpose. With it off the fork
  // returns "" for an unrelated reason and the token assertions would pass
  // vacuously — the exact failure mode this file exists to stop.
  VOICE_STT_STREAM_URL: STREAM_URL,
  VOICE_STREAM_SECRET: STREAM_SECRET,
  TWILIO_OPERATOR_CALLER_ID: OPERATOR_NUMBER,
  TWILIO_AUTH_TOKEN: undefined, // the production posture: no master token
};
let failWriteTable = null;

// ── Supabase stub. Chainable, returns canned rows by table. ─────────────────
//
// TENANT-AWARE ON PURPOSE. An earlier revision returned its canned row for ANY
// `tenant_id` on tenant_twilio_subaccounts / tenant_members / clients, which meant
// no assertion in this file could tell "the right tenant's secret" from "a secret" —
// a cross-tenant stamp passed the whole suite green. Every table that has a tenant
// scope now honours it and returns [] on a mismatch, so a §9 scoping error surfaces
// as a missing value rather than as silence. OTHER_TENANT exists to be a wrong
// answer that is nonetheless a well-formed one.
function makeAdmin({ providerAllowed = true } = {}) {
  const reads = [];
  const rowsFor = (table, filters, inFilter) => {
    if (table === "tenant_phone_numbers") {
      if (filters.phone_number && filters.phone_number !== TENANT_NUMBER) return [];
      if (filters.tenant_id && filters.tenant_id !== TENANT) return [];
      return [{
        tenant_id: TENANT, phone_number: TENANT_NUMBER, is_primary: true,
        subaccount_id: SUBACCOUNT, twilio_sid: "PNprovider", capabilities: { voice: true },
      }];
    }
    if (table === "tenant_members") {
      if (filters.tenant_id !== TENANT) return [];
      return [{ user_id: SEAT, role: "owner" }];
    }
    if (table === "user_roles") {
      // Honour the role filter. With a no-op `in()`, a predicate widened to admit
      // tenant-tier roles was indistinguishable from the correct operator-only one.
      if (inFilter && inFilter.k === "role") {
        const vals = inFilter.vals ?? [];
        if (!vals.every((v) => v === "super_admin" || v === "platform_admin")) {
          return [{ user_id: SEAT, role: "admin" }]; // a TENANT member, wrongly admitted
        }
      }
      return [{ user_id: OPERATOR_SEAT, role: "super_admin" }];
    }
    if (table === "clients") {
      if (filters.tenant_id !== TENANT) return [];
      return [{ id: CONTACT }];
    }
    if (table === "tenant_twilio_subaccounts") {
      // The distinguishing fixture: each tenant has its OWN secret, so stamping the
      // wrong tenant's is observable instead of indistinguishable.
      if (filters.inbound_webhook_secret === WEBHOOK_SECRET || filters.tenant_id === TENANT) {
        return [{ id: SUBACCOUNT, tenant_id: TENANT, inbound_webhook_secret: WEBHOOK_SECRET, active: true, status: "active" }];
      }
      if (filters.inbound_webhook_secret === OTHER_SECRET || filters.tenant_id === OTHER_TENANT) {
        return [{ id: "subaccount-row-2", tenant_id: OTHER_TENANT, inbound_webhook_secret: OTHER_SECRET, active: true, status: "active" }];
      }
      return [];
    }
    return [];
  };
  const writes = [];  // every table the handler WROTE to, with its payload
  const rpcs = [];    // every rpc call, with its arguments

  const builder = (table) => {
    const filters = {};
    let inFilter = null;
    let operation = "read";
    const q = {
      select: () => q,
      eq: (k, v) => { filters[k] = v; return q; },
      // `in` was a no-op, so role scoping could not be asserted at all: widening the
      // operator-seat role list to admit tenant-tier roles passed the suite green.
      in: (k, vals) => { inFilter = { k, vals }; return q; },
      or: () => q,
      order: () => q,
      limit: () => q,
      maybeSingle: async () => { reads.push(table); const r = rowsFor(table, filters, inFilter); return { data: r[0] ?? null, error: null }; },
      // `.insert().select().single()` must return the inserted row the way real
      // PostgREST does. Returning null made the operator writer throw on `created.id`,
      // which the handler caught and logged — so the ENTIRE operator persistence path
      // was dead in the harness, and read as ordinary log noise.
      single: async () => {
        reads.push(table);
        const r = rowsFor(table, filters, inFilter);
        return { data: r[0] ?? { id: `${table}-row-1` }, error: null };
      },
      insert: (payload) => { operation = "insert"; writes.push({ table, op: "insert", payload }); return q; },
      update: (payload) => { operation = "update"; writes.push({ table, op: "update", payload }); return q; },
      upsert: (payload) => { writes.push({ table, op: "upsert", payload }); return q; },
      then: (res) => {
        reads.push(table);
        const error = operation !== "read" && table === failWriteTable ? { code: "transient_write_failure" } : null;
        res({ data: rowsFor(table, filters, inFilter), error });
      },
    };
    return q;
  };
  return {
    reads,
    writes,
    rpcs,
    touched: () => [...new Set([...reads, ...writes.map((w) => w.table)])],
    from: (t) => builder(t),
    rpc: async (name, args) => {
      // The args were discarded, which left the ONE tenant stamp on the write path
      // unassertable: create_and_attach_conversation's p_tenant_id is, by this
      // function's own comments, "the ONLY way to stamp the correct tenant".
      rpcs.push({ name, args });
      if (name === "comms_provider_execution_allowed") return { data: providerAllowed, error: null };
      if (name === "create_and_attach_conversation") {
        return { data: { contact_id: CONTACT, conversation_id: "conv-1" }, error: null };
      }
      return { data: null, error: null };
    },
  };
}

/**
 * Tenant DATA stores. An operator call must never read or write one (§9/§53).
 *
 * `tenant_phone_numbers` is deliberately NOT here: resolving who owns a dialed
 * number is how the handler DISCOVERS that a call is the operator's, so reading it
 * on the operator path is required rather than a leak. Scope is about whose rows
 * you touch, not whose table name you match.
 */
const TENANT_DATA_TABLES = (t) =>
  t === "messages" || t === "clients" || t === "paige_conversations" ||
  t === "tenant_members" || t === "tenant_twilio_subaccounts";

// ── Bundle index.ts, stubbing its remote import, and capture the handler. ────
const stubSrc = `export function createClient(){ return globalThis.__ADMIN__; }`;
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "voice-twiml-handler-"));
const outFile = path.join(outDir, "index.mjs");
await build({
  entryPoints: ["supabase/functions/voice-twiml/index.ts"],
  outfile: outFile,
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  plugins: [{
    name: "remote-stub",
    setup(b) {
      b.onResolve({ filter: /^https:\/\// }, (a) => ({ path: a.path, namespace: "remote-stub" }));
      b.onLoad({ filter: /.*/, namespace: "remote-stub" }, () => ({ contents: stubSrc, loader: "js" }));
    },
  }],
});

let handler = null;
globalThis.Deno = {
  env: { get: (k) => ENV[k] },
  serve: (h) => { handler = h; },
};
await import(pathToFileURL(outFile).href);
assert.ok(typeof handler === "function", "FAILED: did not capture the Deno.serve handler");

const post = async (body, { admin, secret = null } = {}) => {
  globalThis.__ADMIN__ = admin ?? makeAdmin();
  const url = "https://ref.functions.supabase.co/functions/v1/voice-twiml" +
    (secret ? `?t=${encodeURIComponent(secret)}` : "");
  const res = await handler(new Request(url, {
    method: "POST", body, headers: { "content-type": "application/x-www-form-urlencoded" },
  }));
  return { status: res.status, xml: await res.text(), admin: globalThis.__ADMIN__ };
};

let n = 0;
const check = (label, cond) => { n++; assert.ok(cond, `FAILED: ${label}`); console.log(`  ok  ${label}`); };

console.log("voice-twiml handler smoke (real handler, fail-closed tenant auth)\n");
{
  const r = await post(new URLSearchParams({ From: `client:${TENANT}.${SEAT}`, To: "+15559990000", CallSid: "CArestricted" }), { admin: makeAdmin({ providerAllowed: false }), secret: WEBHOOK_SECRET });
  check("restricted workspace gets a hangup", r.status === 200 && r.xml.includes("<Hangup"));
  check("restricted workspace grants no dial or media stream", !r.xml.includes("<Dial") && !r.xml.includes("<Stream") && !r.xml.includes("statusCallback"));
  check("restricted workspace creates no call history", r.admin.writes.length === 0 && !r.admin.rpcs.some(x => x.name === "create_and_attach_conversation"));
}


// ── 1. INBOUND, unsigned. The cheap attack: the dialed number is PUBLIC. ─────
{
  const { status, xml, admin } = await post(
    `To=${encodeURIComponent(TENANT_NUMBER)}&From=%2B15559998888&CallSid=CAattackerchosen`);
  check("inbound request without tenant proof is refused", status === 401);
  check("inbound unsigned leaks NO webhook secret", !xml.includes(WEBHOOK_SECRET));
  check("inbound unsigned emits NO statusCallback", !xml.includes("statusCallback"));
  check("inbound unsigned mints NO co-pilot stream token", !xml.includes("streamToken"));
  check("inbound unsigned opens NO media stream at all", !xml.includes("<Stream"));
  check("inbound unsigned resolves only the dialed tenant's proof/credentials",
    admin.reads.includes("tenant_twilio_subaccounts"));
  check("inbound unsigned creates no tenant history", admin.writes.length === 0 && admin.rpcs.length === 0);
}

// ── 2. OUTBOUND, unsigned, naming a tenant in From. The original attack. ─────
{
  const { status, xml, admin } = await post(
    `From=${encodeURIComponent(`client:${TENANT}.${SEAT}`)}&To=%2B15559998888&CallSid=CAx`);
  check("outbound request without tenant proof is refused", status === 401);
  check("outbound unsigned leaks NO webhook secret", !xml.includes(WEBHOOK_SECRET));
  check("outbound unsigned emits NO statusCallback", !xml.includes("statusCallback"));
  check("outbound unsigned mints NO co-pilot stream token", !xml.includes("streamToken"));
  check("outbound unsigned resolves only the claimed tenant's proof/credentials",
    admin.reads.includes("tenant_twilio_subaccounts"));
  check("outbound unsigned creates no tenant history", admin.writes.length === 0 && admin.rpcs.length === 0);
}

// A tenant-stamped VoiceUrl proves which tenant owns the TwiML Application. The
// request body must resolve to that SAME tenant before any caller ID, seat, or
// history operation is allowed.
{
  const outbound = await post(
    `From=${encodeURIComponent(`client:${TENANT}.${SEAT}`)}&To=%2B15559998888&CallSid=CAtenant`,
    { secret: WEBHOOK_SECRET },
  );
  check("tenant-secret outbound request is accepted", outbound.status === 200 && outbound.xml.includes("<Dial"));
  check("tenant-secret outbound request emits a terminal callback", outbound.xml.includes("statusCallback"));
  check("tenant-secret outbound writes only the proven tenant", outbound.admin.rpcs.some((r) =>
    r.name === "create_and_attach_conversation" && r.args?.p_tenant_id === TENANT));

  const forged = await post(
    `From=${encodeURIComponent(`client:${OTHER_TENANT}.${SEAT}`)}&To=%2B15559998888&CallSid=CAforged`,
    { secret: WEBHOOK_SECRET },
  );
  check("tenant A proof cannot authorize tenant B identity", forged.status === 403);
  check("cross-tenant refusal creates no history", forged.admin.writes.length === 0 && forged.admin.rpcs.length === 0);

  const inbound = await post(
    `To=${encodeURIComponent(TENANT_NUMBER)}&From=%2B15559998888&CallSid=CAtenantinbound`,
    { secret: WEBHOOK_SECRET },
  );
  check("tenant-secret inbound request is accepted", inbound.status === 200 && inbound.xml.includes("<Dial"));
  check("tenant-secret inbound stamps the terminal callback", inbound.xml.includes(`?t=${encodeURIComponent(WEBHOOK_SECRET)}`));
  check("tenant-secret inbound mints a tenant-bound co-pilot token", inbound.xml.includes("streamToken"));

  failWriteTable = "messages";
  const unaudited = await post(
    `From=${encodeURIComponent(`client:${TENANT}.${SEAT}`)}&To=%2B15559998888&CallSid=CAauditfailure`,
    { secret: WEBHOOK_SECRET },
  );
  failWriteTable = null;
  check("history persistence failure returns a spoken unavailable response", unaudited.xml.includes("<Say"));
  check("history persistence failure never emits a dial bridge", !unaudited.xml.includes("<Dial"));
}

// ── 3. MASTER SIGNATURES ARE OPERATOR-ONLY. A valid master-account signature
//       must not authorize a tenant caller ID, tenant history, or tenant secret.
{
  const { computeTwilioSignature } = await (async () => {
    const f = path.join(outDir, "sig.mjs");
    await build({ entryPoints: ["supabase/functions/_shared/twilio-webhook-auth.ts"], outfile: f,
      bundle: true, format: "esm", platform: "neutral", target: "es2022", external: ["https://*"] });
    return import(pathToFileURL(f).href);
  })();

  const TOKEN = "master-auth-token";
  ENV.TWILIO_AUTH_TOKEN = TOKEN;
  const url = "https://ref.functions.supabase.co/functions/v1/voice-twiml";
  const body = `To=${encodeURIComponent(TENANT_NUMBER)}&From=%2B15559998888&CallSid=CAsigned`;
  const sig = await computeTwilioSignature(TOKEN, url, body);

  globalThis.__ADMIN__ = makeAdmin();
  const res = await handler(new Request(url, {
    method: "POST", body,
    headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": sig },
  }));
  const xml = await res.text();
  check("master-signed tenant inbound is rejected", res.status === 403);
  check("master-signed tenant inbound exposes no tenant secret", !xml.includes(WEBHOOK_SECRET));
  check("master-signed tenant inbound creates no history", globalThis.__ADMIN__.writes.length === 0);

  // A bad signature is a hard refusal, not a silent unsigned accept.
  globalThis.__ADMIN__ = makeAdmin();
  const bad = await handler(new Request(url, {
    method: "POST", body,
    headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": "AAAA" },
  }));
  check("a BAD signature is rejected 403", bad.status === 403);

  // ── 4. SIGNED BRANCH BINDING. ───────────────────────────────────────────
  const signedPost = async (b) => {
    const sg = await computeTwilioSignature(TOKEN, url, b);
    globalThis.__ADMIN__ = makeAdmin();
    const r = await handler(new Request(url, {
      method: "POST", body: b,
      headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": sg },
    }));
    return { status: r.status, xml: await r.text(), admin: globalThis.__ADMIN__ };
  };

  // 4a. A master signature cannot unlock tenant outbound.
  {
    const r = await signedPost(
      `From=${encodeURIComponent(`client:${TENANT}.${SEAT}`)}&To=%2B15559998888&CallSid=CAob`);
    check("master-signed tenant outbound is rejected", r.status === 403);
    check("...exposes no tenant callback secret", !r.xml.includes(WEBHOOK_SECRET));
    check("...and creates no tenant history", r.admin.writes.length === 0 && r.admin.rpcs.length === 0);
  }

  // 4b. Operator OUTBOUND. Tenant-less by construction (§9/§53): the master leg
  //     must carry NO tenant credential and NO tenant co-pilot fork.
  {
    const r = await signedPost(
      `From=${encodeURIComponent(`client:operator.${OPERATOR_SEAT}`)}&To=%2B15559998888&CallSid=CAop`);
    check("signed OPERATOR outbound carries NO tenant secret",
      !r.xml.includes(WEBHOOK_SECRET) && !r.xml.includes(OTHER_SECRET));
    check("...and never reads the credential table at all",
      !r.admin.reads.includes("tenant_twilio_subaccounts"));
    check("...and mints NO co-pilot token (co-pilot is tenant STT)", !r.xml.includes("streamToken"));
    check("...but does keep the bare callback (master signature authenticates it)",
      r.xml.includes(`statusCallback="${CALLBACK_BASE}"`));
    check("...touches NO tenant data store (§9/§53)", !r.admin.touched().some(TENANT_DATA_TABLES));
    check("...and its row went to the OPERATOR store",
      r.admin.writes.some((w) => w.table.startsWith("operator_")));
  }

  // 4c. Operator INBOUND — the dialed number is the platform master number, owned
  //     by no tenant. Same §9/§53 rule as 4b.
  {
    const r = await signedPost(
      `To=${encodeURIComponent(OPERATOR_NUMBER)}&From=%2B15559998888&CallSid=CAopin`);
    check("signed OPERATOR inbound carries NO tenant secret",
      !r.xml.includes(WEBHOOK_SECRET) && !r.xml.includes(OTHER_SECRET));
    check("...and mints NO co-pilot token", !r.xml.includes("streamToken"));
    check("...and rang an OPERATOR seat, not a tenant seat",
      r.xml.includes(`operator.${OPERATOR_SEAT}`) && !r.xml.includes(`${TENANT}.${SEAT}`));
    check("...touches NO tenant data store (§9/§53)", !r.admin.touched().some(TENANT_DATA_TABLES));
    check("...and its row went to the OPERATOR store",
      r.admin.writes.some((w) => w.table.startsWith("operator_")));
  }

  // ── 4d. A number NO tenant owns that is ALSO not the operator number must
  //        DEGRADE, never ring the operator seats. Untested until now, so relaxing
  //        the operator predicate to `if (opNumber)` let every stray or hostile
  //        number reach the platform operators' browsers.
  {
    const r = await signedPost(`To=%2B15550009999&From=%2B15559998888&CallSid=CAstray`);
    check("an unowned, non-operator number does NOT ring operator seats",
      !r.xml.includes(`operator.${OPERATOR_SEAT}`) && !r.xml.includes("<Client"));
    check("...and is refused before any TwiML is returned", r.status === 403 && !r.xml.includes("<Say"));
    check("...and rings no tenant seat either", !r.xml.includes(`${TENANT}.${SEAT}`));
  }

  ENV.TWILIO_AUTH_TOKEN = undefined;
}

// ── 5. OPERATOR HMAC PROOF. Production intentionally has no master Auth Token,
// so the purpose-bound proof must authenticate both the call and its callback URL.
{
  ENV.TWILIO_ACCOUNT_SID = "ACmaster0000000000000000000000000";
  ENV.TWILIO_API_KEY_SID = "SKmaster0000000000000000000000000";
  ENV.TWILIO_API_KEY_SECRET = "master-api-key-secret";
  const helperFile = path.join(outDir, "operator-proof.mjs");
  await build({
    entryPoints: ["supabase/functions/_shared/operator-twilio.ts"],
    outfile: helperFile, bundle: true, format: "esm", platform: "neutral", target: "es2022",
  });
  const { deriveOperatorVoiceWebhookSecret } = await import(pathToFileURL(helperFile).href);
  const proof = await deriveOperatorVoiceWebhookSecret();
  ENV.TWILIO_API_KEY_SECRET = "rotated-master-api-key-secret";
  const proofAfterApiKeyRotation = await deriveOperatorVoiceWebhookSecret();
  check("operator proof survives Twilio API-key rotation", proofAfterApiKeyRotation === proof);
  const r = await post(
    `From=${encodeURIComponent(`client:operator.${OPERATOR_SEAT}`)}&To=%2B15559998888&CallSid=CAoperatorproof`,
    { secret: proof },
  );
  check("derived operator proof authenticates without a master Auth Token", r.status === 200 && r.xml.includes("<Dial"));
  check("derived operator proof is retained on the child callback", r.xml.includes(`?t=${encodeURIComponent(proof)}`));
  check("derived operator proof touches no tenant data store", !r.admin.touched().some(TENANT_DATA_TABLES));

  const bad = await post(
    `From=${encodeURIComponent(`client:operator.${OPERATOR_SEAT}`)}&To=%2B15559998888&CallSid=CAoperatorbad`,
    { secret: `${proof}x` },
  );
  check("wrong operator proof is refused", bad.status === 403 && bad.admin.writes.length === 0);
  ENV.TWILIO_ACCOUNT_SID = undefined;
  ENV.TWILIO_API_KEY_SID = undefined;
  ENV.TWILIO_API_KEY_SECRET = undefined;
}

console.log(`\n${n} assertions passed.`);
