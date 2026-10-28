#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const SECRET = "tenant-proof-" + "s".repeat(48);
const TENANT = "11111111-1111-4111-8111-111111111111";
const updates = [];
const updateTables = [];
let failLookup = false;
let currentStatus = "queued";
let operatorMode = false;
// The voice row is STATEFUL so callback ORDER is real: an applied update changes what the next
// callback reads, and a conditional update (`.eq("status", …)`) applies only when it still matches.
let currentDirection = "outbound";
let currentMeta = {};
let currentError = null;
let currentDuration = null;
// Off for the original assertions above the ordering section, which were written against a row that
// never changes; on inside it.
let stateful = false;
// When set, the next voice-row read returns this status instead of the stored one: the row as it was
// read just before another callback committed (review MAJOR-1, read → other write → write).
let staleReadStatus = null;
const resetRow = (direction) => {
  stateful = true;
  currentStatus = "queued"; currentDirection = direction; currentMeta = {}; currentError = null; currentDuration = null;
};

function makeAdmin() {
  return {
    from(table) {
      const filters = {};
      let pending = null;
      const q = {
        select: () => q,
        eq: (key, value) => { filters[key] = value; return q; },
        in: () => q,
        update: (payload) => { updates.push(payload); updateTables.push(table); pending = payload; return q; },
        maybeSingle: async () => {
          if (table === "tenant_twilio_subaccounts") {
            return filters.inbound_webhook_secret === SECRET
              ? { data: { tenant_id: TENANT, inbound_webhook_secret: SECRET }, error: null }
              : { data: null, error: null };
          }
          if (table === "messages") {
            if (operatorMode) return { data: null, error: null };
            return failLookup
              ? { data: null, error: { code: "transient" } }
              : (() => { const status = staleReadStatus ?? currentStatus; staleReadStatus = null; return { data: { id: "voice-row", status, direction: currentDirection, meta: currentMeta }, error: null }; })();
          }
          if (table === "operator_messages" && operatorMode) {
            return { data: { id: "operator-voice-row", status: currentStatus, direction: currentDirection, metadata: currentMeta }, error: null };
          }
          return { data: null, error: null };
        },
        then(resolve) {
          if (stateful && pending && (filters.status === undefined || filters.status === currentStatus)) {
            if ("status" in pending) currentStatus = pending.status;
            if ("error" in pending) currentError = pending.error;
            if ("call_duration_seconds" in pending) currentDuration = pending.call_duration_seconds;
            if (pending.meta) currentMeta = pending.meta;
            if (pending.metadata) currentMeta = pending.metadata;
          }
          resolve({ data: null, error: null });
        },
      };
      return q;
    },
  };
}

const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "voice-status-callback-"));
const outFile = path.join(outDir, "index.mjs");
await build({
  entryPoints: ["supabase/functions/twilio-status-callback/index.ts"],
  outfile: outFile,
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  plugins: [{
    name: "remote-stub",
    setup(b) {
      b.onResolve({ filter: /^https:\/\// }, (a) => ({ path: a.path, namespace: "remote-stub" }));
      b.onLoad({ filter: /.*/, namespace: "remote-stub" }, () => ({
        contents: "export function createClient(){ return globalThis.__ADMIN__; }",
        loader: "js",
      }));
    },
  }],
});

let handler;
const ENV = {
  SUPABASE_URL: "https://ref.functions.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service",
  TWILIO_ACCOUNT_SID: "ACmaster0000000000000000000000000",
  TWILIO_API_KEY_SID: "SKmaster0000000000000000000000000",
  TWILIO_API_KEY_SECRET: "master-api-key-secret",
};
globalThis.Deno = {
  env: { get: (key) => ENV[key] },
  serve: (fn) => { handler = fn; },
};
globalThis.__ADMIN__ = makeAdmin();
await import(pathToFileURL(outFile).href);

const invoke = () => handler(new Request(
  `https://ref.functions.supabase.co/functions/v1/twilio-status-callback?t=${encodeURIComponent(SECRET)}`,
  {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "CallSid=CAchild&ParentCallSid=CAparent&CallStatus=busy&ErrorCode=486",
  },
));

failLookup = true;
assert.equal((await invoke()).status, 503, "transient callback persistence failure must ask Twilio to retry");

failLookup = false;
updates.length = 0;
assert.equal((await invoke()).status, 200);
assert.equal(updates.length, 1);
assert.equal(updates[0].status, "failed");
// A busy line is not a provider rejection (owner report 2026-10-28): the status stays 'failed',
// the wording says what actually happened.
assert.equal(updates[0].error, "The line was busy.");
assert.equal(updates[0].meta.call.error_code, "486");

// Provider retry/duplicate: the same callback is idempotent at the owning row.
assert.equal((await invoke()).status, 200);
assert.equal(updates.length, 2);
assert.equal(updates[1].status, "failed");

// The other unsuccessful terminals, through the REAL handler. Prod carried a no-answer call
// written as "The provider rejected this call." — the exact defect these pin.
const invokeBody = (body) => handler(new Request(
  `https://ref.functions.supabase.co/functions/v1/twilio-status-callback?t=${encodeURIComponent(SECRET)}`,
  { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body },
));
for (const [body, expected] of [
  ["CallSid=CAchild&ParentCallSid=CAparent&CallStatus=no-answer", "No answer."],
  ["CallSid=CAchild&ParentCallSid=CAparent&CallStatus=canceled", "The call was cancelled."],
  ["CallSid=CAchild&ParentCallSid=CAparent&CallStatus=failed&ErrorCode=13224", "The provider rejected this call (error 13224)."],
]) {
  currentStatus = "queued";
  updates.length = 0;
  assert.equal((await invokeBody(body)).status, 200);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].status, "failed", "the stored status is unchanged: still 'failed'");
  assert.equal(updates[0].error, expected, body);
}
currentStatus = "queued";

// ── INBOUND: every seat rings at once; callbacks arrive in ANY order (review M1). ─────────────────
// The row stores the PARENT CallSid. A <Client> leg posts CallSid=child + ParentCallSid=parent; the
// number-level StatusCallback posts the parent's own end with NO ParentCallSid.
const PARENT = "CallSid=CAparent";
const leg = (sid, status, dur) => `CallSid=${sid}&ParentCallSid=CAparent&CallStatus=${status}${dur === undefined ? "" : `&CallDuration=${dur}`}`;
const inboundFinal = async (bodies) => {
  resetRow("inbound");
  for (const b of bodies) assert.equal((await invokeBody(b)).status, 200, b);
  return { status: currentStatus, error: currentError, duration: currentDuration };
};

// (a) Parent completed first, then the child no-answer: an unanswered call must NEVER read connected.
{
  const r = await inboundFinal([`${PARENT}&CallStatus=completed&CallDuration=31`, leg("CAseat1", "no-answer", 0)]);
  assert.equal(r.status, "failed", "parent completed + child no-answer is a missed call, not delivered");
  assert.equal(r.error, "No answer.");
  assert.equal(r.duration, null, "a missed call carries no talk time — the parent's ring time is not one");
}
// Same call, child first.
{
  const r = await inboundFinal([leg("CAseat1", "no-answer", 0), `${PARENT}&CallStatus=completed&CallDuration=31`]);
  assert.equal(r.status, "failed");
  assert.equal(r.error, "No answer.");
}
// (b) Several seats: the loser's canceled arrives FIRST, then the winner's completed. Answered wins.
{
  const r = await inboundFinal([leg("CAseat2", "canceled", 0), leg("CAseat1", "completed", 75), `${PARENT}&CallStatus=completed&CallDuration=80`]);
  assert.equal(r.status, "delivered", "a loser's cancel must never override the seat that answered");
  assert.equal(r.error, null);
  assert.equal(r.duration, 75, "talk time comes from the answered leg");
}
// Winner first, then a late loser and the parent: nothing moves it off delivered or its duration.
{
  const r = await inboundFinal([leg("CAseat1", "completed", 75), leg("CAseat2", "canceled", 0), `${PARENT}&CallStatus=completed&CallDuration=80`]);
  assert.equal(r.status, "delivered");
  assert.equal(r.duration, 75, "a loser's 0 seconds must not overwrite the answered leg's talk time");
}
// Parent first while the winner's callback is still in flight: settles "No answer.", then the
// answered leg corrects it to delivered and clears the error.
{
  const r = await inboundFinal([`${PARENT}&CallStatus=completed&CallDuration=80`, leg("CAseat2", "canceled", 0), leg("CAseat1", "completed", 75)]);
  assert.equal(r.status, "delivered", "an answered leg arriving after the parent still wins");
  assert.equal(r.error, null, "the provisional 'No answer.' is cleared once a leg is known to have answered");
  assert.equal(r.duration, 75);
}
// Interleaved (review MAJOR-1): the winner's callback READ the row while it was still queued, then the
// parent settled "No answer.", then the winner wrote. It must not leave delivered with "No answer.".
{
  const r = await inboundFinal([`${PARENT}&CallStatus=completed&CallDuration=80`]);
  assert.equal(r.status, "failed");
  staleReadStatus = "queued";
  assert.equal((await invokeBody(leg("CAseat1", "completed", 75))).status, 200);
  assert.equal(currentStatus, "delivered", "the answered leg still wins after an interleaved settle");
  assert.equal(currentError, null, "an answered call never keeps the parent's provisional 'No answer.'");
  assert.equal(currentDuration, 75);
}
// All legs no-answer, then the parent: a missed call.
{
  const r = await inboundFinal([leg("CAseat1", "no-answer", 0), leg("CAseat2", "no-answer", 0), `${PARENT}&CallStatus=completed&CallDuration=30`]);
  assert.equal(r.status, "failed");
  assert.equal(r.error, "No answer.");
}
// Child legs alone never settle the call: another seat may still answer.
{
  const r = await inboundFinal([leg("CAseat1", "no-answer", 0), leg("CAseat2", "canceled", 0)]);
  assert.equal(r.status, "queued", "until the parent ends or a leg answers, the call is not decided");
}
// OUTBOUND is unchanged: first terminal wins, duration stamped from whichever callback reports it.
{
  resetRow("outbound");
  assert.equal((await invokeBody("CallSid=CAnum&ParentCallSid=CAparent&CallStatus=completed&CallDuration=12")).status, 200);
  assert.equal(currentStatus, "delivered");
  assert.equal(currentDuration, 12);
  resetRow("outbound");
  assert.equal((await invokeBody("CallSid=CAnum&ParentCallSid=CAparent&CallStatus=no-answer&CallDuration=0")).status, 200);
  assert.equal(currentStatus, "failed");
  assert.equal(currentError, "No answer.");
  assert.equal((await invokeBody("CallSid=CAnum&ParentCallSid=CAparent&CallStatus=completed&CallDuration=12")).status, 200);
  assert.equal(currentStatus, "failed", "outbound failed stays terminal, exactly as before");
}
resetRow("outbound");
stateful = false;

// A provider rejection is terminal. A late/out-of-order queued or completed callback
// must never rewrite a failed call as Initiated or Completed.
currentStatus = "failed";
updates.length = 0;
assert.equal((await invoke()).status, 200);
assert.equal(updates.length, 1, "provider facts may still enrich terminal history");
assert.equal(updates[0].status, undefined, "failed voice history must never change status on later callbacks");

const key = await crypto.subtle.importKey(
  "raw", new TextEncoder().encode(ENV.SUPABASE_SERVICE_ROLE_KEY),
  { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
);
const signed = new Uint8Array(await crypto.subtle.sign(
  "HMAC", key,
  new TextEncoder().encode(`paige:operator:voice-webhook:v1:${ENV.TWILIO_ACCOUNT_SID}`),
));
const operatorProof = `ov1_${Buffer.from(signed).toString("base64url")}`;
operatorMode = true;
currentStatus = "queued";
updates.length = 0;
updateTables.length = 0;
const operatorResponse = await handler(new Request(
  `https://ref.functions.supabase.co/functions/v1/twilio-status-callback?t=${encodeURIComponent(operatorProof)}`,
  {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "CallSid=CAoperator&CallStatus=completed",
  },
));
assert.equal(operatorResponse.status, 200);
assert.deepEqual(updateTables, ["operator_messages"], "operator proof must update only operator history");

updates.length = 0;
updateTables.length = 0;
const badOperator = await handler(new Request(
  `https://ref.functions.supabase.co/functions/v1/twilio-status-callback?t=${encodeURIComponent(`${operatorProof}x`)}`,
  {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "CallSid=CAoperator&CallStatus=completed",
  },
));
assert.equal(badOperator.status, 401);
assert.equal(updates.length, 0, "wrong operator proof must write nothing");

operatorMode = false; // tenant row exists for the same attacker-supplied SID
updates.length = 0;
updateTables.length = 0;
const crossScopeVoice = await handler(new Request(
  `https://ref.functions.supabase.co/functions/v1/twilio-status-callback?t=${encodeURIComponent(operatorProof)}`,
  {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "CallSid=CAtenantrow&CallStatus=completed",
  },
));
assert.equal(crossScopeVoice.status, 200);
assert.equal(updates.length, 0, "operator proof must never update a tenant voice row");

const crossScopeSms = await handler(new Request(
  `https://ref.functions.supabase.co/functions/v1/twilio-status-callback?t=${encodeURIComponent(operatorProof)}`,
  {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "MessageSid=SMtenantrow&MessageStatus=delivered",
  },
));
assert.equal(crossScopeSms.status, 200);
assert.equal(updates.length, 0, "operator proof must never update a tenant SMS row");

// The operator's inbound line rings every operator seat the same way: same order-robust rule, and
// it still writes ONLY operator_messages.
{
  operatorMode = true;
  resetRow("inbound");
  updateTables.length = 0;
  const op = (body) => handler(new Request(
    `https://ref.functions.supabase.co/functions/v1/twilio-status-callback?t=${encodeURIComponent(operatorProof)}`,
    { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body },
  ));
  for (const b of [leg("CAop2", "canceled", 0), leg("CAop1", "completed", 40), "CallSid=CAparent&CallStatus=completed&CallDuration=44"]) {
    assert.equal((await op(b)).status, 200, b);
  }
  assert.equal(currentStatus, "delivered", "operator inbound: a loser's cancel never overrides the answer");
  assert.equal(currentDuration, 40);
  assert.ok(updateTables.every((t) => t === "operator_messages"), "operator inbound writes only operator history");
  stateful = false;
  operatorMode = false;
}

console.log("PASS — callback retry/terminal state, duplicate handling, inbound ordering, and operator proof isolation");
