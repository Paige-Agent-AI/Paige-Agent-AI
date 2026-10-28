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

function makeAdmin() {
  return {
    from(table) {
      const filters = {};
      const q = {
        select: () => q,
        eq: (key, value) => { filters[key] = value; return q; },
        in: () => q,
        update: (payload) => { updates.push(payload); updateTables.push(table); return q; },
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
              : { data: { id: "voice-row", status: currentStatus, meta: {} }, error: null };
          }
          if (table === "operator_messages" && operatorMode) {
            return { data: { id: "operator-voice-row", status: currentStatus, metadata: {} }, error: null };
          }
          return { data: null, error: null };
        },
        then(resolve) { resolve({ data: null, error: null }); },
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

console.log("PASS — callback retry/terminal state, duplicate handling, and operator proof isolation");
