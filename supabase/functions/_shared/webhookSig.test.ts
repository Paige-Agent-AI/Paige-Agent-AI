// Canonical Svix verification tests (webhookSig.ts — verifySvix + sha256Hex).
// The signing side is computed locally from the SAME documented protocol
// (HMAC-SHA256 over `${id}.${timestamp}.${body}` with a whsec_-prefixed
// base64 key, base64 v1 signature parts) so the tests oracle the protocol,
// not the implementation.
import { assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { sha256Hex, verifySendgridEvent, verifySvix } from "./webhookSig.ts";

const encoder = new TextEncoder();

function b64(secretKeyMaterial: string): string {
  return btoa(secretKeyMaterial);
}

async function svixSign(
  id: string,
  timestamp: number,
  body: string,
  keyMaterial: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(keyMaterial),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(`${id}.${timestamp}.${body}`));
  const b64mac = btoa(String.fromCharCode(...new Uint8Array(mac)));
  return `v1,${b64mac}`;
}

const NOW = 1_800_000_000_000; // fixed injectable clock (ms)
const NOW_SEC = Math.floor(NOW / 1000);
const KEY = "0123456789abcdef0123456789abcdef"; // raw key material (32 bytes)
const SECRET = `whsec_${btoa(KEY)}`;
const BODY = JSON.stringify({ type: "email.inbound", data: { from: "a@b.test" } });
const ID = "msg_pZxL2Y8aQb3";

Deno.test("verifySvix accepts a validly signed fresh request", async () => {
  const sig = await svixSign(ID, NOW_SEC, BODY, KEY);
  const v = await verifySvix({
    secrets: [SECRET],
    svixId: ID,
    svixTimestamp: String(NOW_SEC),
    svixSignature: sig,
    body: BODY,
    nowMs: NOW,
  });
  assertEquals(v, { ok: true });
});

Deno.test("verifySvix tolerates skew inside the window (default 300s)", async () => {
  const ts = NOW_SEC - 290;
  const sig = await svixSign(ID, ts, BODY, KEY);
  const v = await verifySvix({
    secrets: [SECRET], svixId: ID, svixTimestamp: String(ts), svixSignature: sig, body: BODY, nowMs: NOW,
  });
  assertEquals(v, { ok: true });
});

Deno.test("verifySvix rejects an expired timestamp (replay bound)", async () => {
  const ts = NOW_SEC - 3600;
  const sig = await svixSign(ID, ts, BODY, KEY);
  const v = await verifySvix({
    secrets: [SECRET], svixId: ID, svixTimestamp: String(ts), svixSignature: sig, body: BODY, nowMs: NOW,
  });
  assertEquals(v, { ok: false, reason: "timestamp_out_of_tolerance" });
});

Deno.test("verifySvix rejects a future timestamp (clock-skew bound)", async () => {
  const ts = NOW_SEC + 3600;
  const sig = await svixSign(ID, ts, BODY, KEY);
  const v = await verifySvix({
    secrets: [SECRET], svixId: ID, svixTimestamp: String(ts), svixSignature: sig, body: BODY, nowMs: NOW,
  });
  assertEquals(v, { ok: false, reason: "timestamp_out_of_tolerance" });
});

Deno.test("verifySvix honors a custom tolerance", async () => {
  const ts = NOW_SEC - 60;
  const sig = await svixSign(ID, ts, BODY, KEY);
  const strict = await verifySvix({
    secrets: [SECRET], svixId: ID, svixTimestamp: String(ts), svixSignature: sig, body: BODY,
    toleranceSeconds: 10, nowMs: NOW,
  });
  assertEquals(strict, { ok: false, reason: "timestamp_out_of_tolerance" });
});

Deno.test("verifySvix: any one of several configured secrets verifies", async () => {
  const otherKey = "ffffffffffffffffffffffffffffffff";
  const sig = await svixSign(ID, NOW_SEC, BODY, KEY);
  const v = await verifySvix({
    secrets: [`whsec_${btoa(otherKey)}`, SECRET],
    svixId: ID, svixTimestamp: String(NOW_SEC), svixSignature: sig, body: BODY, nowMs: NOW,
  });
  assertEquals(v, { ok: true });
});

Deno.test("verifySvix: secret rotation — the second v1 part matching passes", async () => {
  const newKey = "99999999999999999999999999999999";
  const oldPart = await svixSign(ID, NOW_SEC, BODY, KEY);
  const newPart = await svixSign(ID, NOW_SEC, BODY, newKey);
  const v = await verifySvix({
    secrets: [`whsec_${btoa(newKey)}`],
    svixId: ID, svixTimestamp: String(NOW_SEC), svixSignature: `${oldPart} ${newPart}`, body: BODY, nowMs: NOW,
  });
  assertEquals(v, { ok: true });
});

Deno.test("verifySvix rejects a wrong signature", async () => {
  const wrongKey = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const sig = await svixSign(ID, NOW_SEC, BODY, wrongKey);
  const v = await verifySvix({
    secrets: [SECRET], svixId: ID, svixTimestamp: String(NOW_SEC), svixSignature: sig, body: BODY, nowMs: NOW,
  });
  assertEquals(v, { ok: false, reason: "signature_invalid" });
});

Deno.test("verifySvix: non-v1 parts are ignored, never guessed at", async () => {
  const good = await svixSign(ID, NOW_SEC, BODY, KEY);
  const v = await verifySvix({
    secrets: [SECRET], svixId: ID, svixTimestamp: String(NOW_SEC),
    svixSignature: `v2,Zm9v ${good}`, body: BODY, nowMs: NOW,
  });
  assertEquals(v, { ok: true });
  const none = await verifySvix({
    secrets: [SECRET], svixId: ID, svixTimestamp: String(NOW_SEC),
    svixSignature: "v2,Zm9v", body: BODY, nowMs: NOW,
  });
  assertEquals(none, { ok: false, reason: "signature_invalid" });
});

Deno.test("verifySvix: tampered body fails", async () => {
  const sig = await svixSign(ID, NOW_SEC, BODY, KEY);
  const v = await verifySvix({
    secrets: [SECRET], svixId: ID, svixTimestamp: String(NOW_SEC), svixSignature: sig,
    body: BODY + " ", nowMs: NOW,
  });
  assertEquals(v, { ok: false, reason: "signature_invalid" });
});

Deno.test("verifySvix shape guards: missing headers, oversize headers, malformed ts, no secrets", async () => {
  const sig = await svixSign(ID, NOW_SEC, BODY, KEY);
  const missing = await verifySvix({
    secrets: [SECRET], svixId: null, svixTimestamp: String(NOW_SEC), svixSignature: sig, body: BODY, nowMs: NOW,
  });
  assertEquals(missing, { ok: false, reason: "missing_headers" });

  const huge = await verifySvix({
    secrets: [SECRET], svixId: "x".repeat(201), svixTimestamp: String(NOW_SEC), svixSignature: sig,
    body: BODY, nowMs: NOW,
  });
  assertEquals(huge, { ok: false, reason: "header_too_large" });

  const malformed = await verifySvix({
    secrets: [SECRET], svixId: ID, svixTimestamp: "now", svixSignature: sig, body: BODY, nowMs: NOW,
  });
  assertEquals(malformed, { ok: false, reason: "timestamp_malformed" });

  const empty = await verifySvix({
    secrets: [], svixId: ID, svixTimestamp: String(NOW_SEC), svixSignature: sig, body: BODY, nowMs: NOW,
  });
  assertEquals(empty, { ok: false, reason: "no_secrets" });
});

Deno.test("verifySvix accepts a non-whsec_-prefixed base64 secret", async () => {
  const sig = await svixSign(ID, NOW_SEC, BODY, KEY);
  const v = await verifySvix({
    secrets: [btoa(KEY)], svixId: ID, svixTimestamp: String(NOW_SEC), svixSignature: sig, body: BODY, nowMs: NOW,
  });
  assertEquals(v, { ok: true });
});

Deno.test("sha256Hex matches the known digest of 'abc'", async () => {
  const d = await sha256Hex("abc");
  assertEquals(
    d,
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
});

// ─── SendGrid (Twilio) signed Event Webhook verification ──────────────────────
function p1363ToDer(raw: Uint8Array): Uint8Array {
  const trim = (n: Uint8Array) => {
    let s = 0;
    while (s < n.length - 1 && n[s] === 0) s += 1;
    let v = n.subarray(s);
    if (v[0] > 0x7f) v = new Uint8Array([0, ...v]);
    return v;
  };
  const r = trim(raw.subarray(0, 32));
  const s = trim(raw.subarray(32));
  const body = new Uint8Array(2 + r.length + 2 + s.length);
  let p = 0;
  body[p++] = 0x02; body[p++] = r.length; body.set(r, p); p += r.length;
  body[p++] = 0x02; body[p++] = s.length; body.set(s, p);
  return new Uint8Array([0x30, body.length, ...body]);
}
function toB64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

Deno.test("verifySendgridEvent accepts a correctly signed ES256 (DER) request", async () => {
  const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const spki = new Uint8Array(await crypto.subtle.exportKey("spki", kp.publicKey));
  const pem = `-----BEGIN PUBLIC KEY-----\n${toB64(spki).replace(/(.{64})/g, "$1\n").trim()}\n-----END PUBLIC KEY-----`;
  const body = JSON.stringify([{ event: "delivered", sg_message_id: "abc.def" }]);
  const p1363 = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, kp.privateKey, new TextEncoder().encode(body)));
  const sig = toB64(p1363ToDer(p1363));
  const v = await verifySendgridEvent({ publicKeyPem: pem, signatureB64: sig, body });
  assertEquals(v, { ok: true });
});

Deno.test("verifySendgridEvent rejects a tampered body, wrong key, and malformed input", async () => {
  const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const other = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const spki = new Uint8Array(await crypto.subtle.exportKey("spki", other.publicKey));
  const pem = `-----BEGIN PUBLIC KEY-----\n${toB64(spki)}\n-----END PUBLIC KEY-----`;
  const body = JSON.stringify([{ event: "delivered" }]);
  const p1363 = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, kp.privateKey, new TextEncoder().encode(body)));
  const sig = toB64(p1363ToDer(p1363));
  assertEquals((await verifySendgridEvent({ publicKeyPem: pem, signatureB64: sig, body: body + " " })).ok, false);
  const wrongKey = await verifySendgridEvent({ publicKeyPem: pem, signatureB64: sig, body });
  assertEquals(wrongKey.ok === false && wrongKey.reason, "signature_invalid");
  const v_unset = (await verifySendgridEvent({ publicKeyPem: null, signatureB64: sig, body })); assertEquals(v_unset.ok === false && v_unset.reason, "unconfigured_or_unsigned");
  const v_badb64 = (await verifySendgridEvent({ publicKeyPem: pem, signatureB64: "!!!not-b64!!!", body })); assertEquals(v_badb64.ok === false && v_badb64.reason, "signature_malformed");
  const v_badder = (await verifySendgridEvent({ publicKeyPem: pem, signatureB64: toB64(new Uint8Array([1, 2, 3])), body })); assertEquals(v_badder.ok === false && v_badder.reason, "signature_der_malformed");
});
