// handle-sendgrid-webhook — what the door now passes to ingest_sendgrid_receipt (Experience 03).
// Runs the REAL Deno entry point (transpiled) with isolated IO: a fake RPC client records every call,
// the shared signature verifier is the real one, and requests are signed with a throwaway P-256 key
// exactly as SendGrid signs them (ES256 over timestamp + raw body). No network, no database.
//
// Run: node --import ./scripts/client-memory-authz/register.mjs --test \
//        supabase/functions/handle-sendgrid-webhook/index.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createSign, generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import ts from "typescript";

const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const PEM = publicKey.export({ type: "spki", format: "pem" }).toString();
const NOW = 1793440000;
type Row = Record<string, unknown>;

function transpile(path: string): string {
  return ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}

function harness(
  env: Record<string, string> = { SENDGRID_WEBHOOK_PUBLIC_KEY: PEM },
  answer: string | ((args: Row) => string) = "processed",
) {
  const calls: { fn: string; args: Row }[] = [];
  let handle!: (req: Request) => Promise<Response>;
  const frozenDate = class extends Date { static now() { return NOW * 1000; } };
  const sigExports: Row = {};
  const handlerExports: Row = {};
  const requireShim = (name: string) => {
    if (name === "npm:@supabase/supabase-js@2") {
      return { createClient: () => ({ rpc: (fn: string, args: Row) => { calls.push({ fn, args }); return Promise.resolve({ data: typeof answer === "function" ? answer(args) : answer, error: null }); } }) };
    }
    if (name === "../_shared/webhookSig.ts") return sigExports;
    throw new Error("unexpected import in test: " + name);
  };
  new Function("require", "exports", "Date", transpile("supabase/functions/_shared/webhookSig.ts"))(requireShim, sigExports, frozenDate);
  const quiet = { error: () => {}, warn: () => {}, log: () => {} };
  new Function("require", "exports", "Deno", "Date", "console", transpile("supabase/functions/handle-sendgrid-webhook/index.ts"))(
    requireShim, handlerExports,
    { env: { get: (n: string) => env[n] }, serve: (cb: typeof handle) => { handle = cb; } },
    frozenDate, quiet,
  );
  return { handle: (req: Request) => handle(req), calls, exports: handlerExports };
}

function signed(events: unknown[], tamper = false): Request {
  const body = JSON.stringify(events);
  const sig = createSign("sha256").update(String(NOW)).update(body).sign(privateKey).toString("base64");
  return new Request("https://example.invalid/sg", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-twilio-email-event-webhook-signature": sig,
      "x-twilio-email-event-webhook-timestamp": String(NOW),
    },
    body: tamper ? body.replace("lead", "LEAD") : body,
  });
}

const ev = (event: string, id: string, extra: Row = {}): Row => ({
  event, sg_event_id: id, sg_message_id: "sgMsgAbc.filterdrecv-1", email: "lead@example.invalid", timestamp: NOW, ...extra,
});
const T = "10000000-0000-4000-8000-000000000001", OP = "20000000-0000-4000-8000-000000000002", M = "30000000-0000-4000-8000-000000000003";

test("a blocked bounce reaches the database AS blocked, with its reason", async () => {
  const h = harness();
  const res = await h.handle(signed([ev("bounce", "e1", { type: "blocked", reason: "554 5.7.1 blocked by policy", status: "5.7.1" })]));
  assert.equal(res.status, 200);
  assert.equal(h.calls.length, 1);
  const a = h.calls[0].args;
  assert.equal(h.calls[0].fn, "ingest_sendgrid_receipt");
  assert.equal(a._status, "bounced");
  assert.equal(a._bounce_type, "blocked");
  assert.equal(a._reason, "554 5.7.1 blocked by policy");
  assert.equal(a._message_id, "sgMsgAbc");
  assert.equal(a._receipt_id, "sg:e1");
});

test("a plain bounce carries type 'bounce'; dropped carries its reason; deferred carries the response", async () => {
  const h = harness();
  await h.handle(signed([
    ev("bounce", "e2", { type: "bounce", reason: "550 mailbox unavailable" }),
    ev("dropped", "e3", { reason: "Unsubscribed Address" }),
    ev("deferred", "e4", { response: "421 try again later", attempt: "2" }),
  ]));
  const [b, d, f] = h.calls.map((c) => c.args);
  assert.deepEqual([b._status, b._bounce_type, b._reason], ["bounced", "bounce", "550 mailbox unavailable"]);
  assert.deepEqual([d._status, d._bounce_type, d._reason], ["dropped", null, "Unsubscribed Address"]);
  assert.deepEqual([f._status, f._bounce_type, f._reason], ["delivery_delayed", null, "421 try again later"]);
});

test("delivered / open / click pass no reason and no bounce type", async () => {
  const h = harness();
  await h.handle(signed([ev("delivered", "e5", { reason: "ignored", type: "blocked" }), ev("open", "e6"), ev("click", "e7")]));
  for (const c of h.calls) {
    assert.equal(c.args._reason, null);
    assert.equal(c.args._bounce_type, null);
  }
  assert.deepEqual(h.calls.map((c) => c.args._status), ["delivered", "opened", "clicked"]);
});

test("the send's custom_args claims are passed through; absent claims are null", async () => {
  const h = harness();
  await h.handle(signed([
    ev("delivered", "e8", { paige_tenant_id: ` ${T} `, paige_operation_id: OP, paige_message_id: M }),
    ev("delivered", "e9"),
  ]));
  const [withClaims, without] = h.calls.map((c) => c.args);
  assert.deepEqual([withClaims._tenant_id, withClaims._operation_id, withClaims._paige_message_id], [T, OP, M]);
  assert.deepEqual([without._tenant_id, without._operation_id, without._paige_message_id], [null, null, null]);
});

test("a malformed claim is passed as a claim (so it fails correlation), never dropped", async () => {
  const h = harness();
  await h.handle(signed([ev("delivered", "e10", { paige_tenant_id: 12345, paige_operation_id: { x: 1 } })]));
  const a = h.calls[0].args;
  assert.equal(a._tenant_id, "12345");
  assert.equal(a._operation_id, '{"x":1}');
});

test("a long provider reason is capped before it leaves the door", async () => {
  const h = harness();
  await h.handle(signed([ev("bounce", "e11", { type: "bounce", reason: "x".repeat(5000) })]));
  assert.equal((h.calls[0].args._reason as string).length, 1000);
});

test("unchanged: 503 until the public key is set, 401 on a bad signature, nothing persisted", async () => {
  const noKey = harness({});
  assert.equal((await noKey.handle(signed([ev("bounce", "e12", { type: "blocked" })]))).status, 503);
  assert.equal(noKey.calls.length, 0);
  const h = harness();
  assert.equal((await h.handle(signed([ev("bounce", "e13", { type: "blocked" })], true))).status, 401);
  assert.equal(h.calls.length, 0);
});

test("unchanged: an unpersisted event is never acknowledged", async () => {
  const h = harness(undefined, "pending");
  assert.equal((await h.handle(signed([ev("bounce", "e14", { type: "blocked" })]))).status, 503);
});

test("an EARLY event (the send is still being handed over: 'pending') makes the whole batch 503, so SendGrid redelivers it", async () => {
  // ingest_sendgrid_receipt answers 'pending' for an event whose three claims name a governed send that is
  // still prepared/dispatching (20271031000200); the processed event beside it dedups on redelivery.
  const h = harness(undefined, (args) => (args._receipt_id === "sg:e16" ? "pending" : "processed"));
  const res = await h.handle(signed([
    ev("delivered", "e15", { paige_tenant_id: T, paige_operation_id: OP, paige_message_id: M }),
    ev("delivered", "e16", { paige_tenant_id: T, paige_operation_id: OP, paige_message_id: M }),
  ]));
  assert.equal(res.status, 503);
  assert.equal(h.calls.length, 2, "every event is still offered to the database");
  const body = await res.json();
  assert.equal(body.retriable, true);
  assert.equal(body.pending, 1);
  assert.equal(body.processed, 1);
});
