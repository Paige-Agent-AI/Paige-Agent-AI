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

// ─── SendGrid (Twilio) signed Event Webhook verification ─────────────────────
// Oracle: the official protocol signs timestamp + raw body (timestamp first,
// no separator) with ES256, delivered DER-encoded.
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
async function sgSign(kp: CryptoKey, timestamp: string, body: string): Promise<string> {
  const p1363 = new Uint8Array(await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" }, kp, new TextEncoder().encode(`${timestamp}${body}`)));
  return toB64(p1363ToDer(p1363));
}
async function sgPem(publicKey: CryptoKey): Promise<string> {
  const spki = new Uint8Array(await crypto.subtle.exportKey("spki", publicKey));
  return `-----BEGIN PUBLIC KEY-----
${toB64(spki)}
-----END PUBLIC KEY-----`;
}

Deno.test("verifySendgridEvent accepts a correctly signed timestamp+body request", async () => {
  const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const pem = await sgPem(kp.publicKey);
  const body = JSON.stringify([{ event: "delivered", sg_message_id: "abc.def" }]);
  const ts = "1788480000";
  const sig = await sgSign(kp.privateKey, ts, body);
  const v = await verifySendgridEvent({ publicKeyPem: pem, signatureB64: sig, timestamp: ts, body });
  assertEquals(v, { ok: true });
});

Deno.test("verifySendgridEvent rejects a tampered body (signature covers body)", async () => {
  const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const pem = await sgPem(kp.publicKey);
  const body = JSON.stringify([{ event: "delivered" }]);
  const ts = "1788480000";
  const sig = await sgSign(kp.privateKey, ts, body);
  const v = await verifySendgridEvent({ publicKeyPem: pem, signatureB64: sig, timestamp: ts, body: body + " " });
  assertEquals(v.ok, false);
});

Deno.test("verifySendgridEvent rejects a tampered timestamp (signature covers timestamp)", async () => {
  const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const pem = await sgPem(kp.publicKey);
  const body = JSON.stringify([{ event: "delivered" }]);
  const sig = await sgSign(kp.privateKey, "1788480000", body);
  // The PRE-CORRECTION defect: body-only verification accepted this replay.
  const v = await verifySendgridEvent({ publicKeyPem: pem, signatureB64: sig, timestamp: "1788480099", body });
  assertEquals(v.ok, false);
});

Deno.test("verifySendgridEvent rejects an absent timestamp and an invalid signature", async () => {
  const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const pem = await sgPem(kp.publicKey);
  const body = JSON.stringify([{ event: "delivered" }]);
  const ts = "1788480000";
  const sig = await sgSign(kp.privateKey, ts, body);
  const absentTs = await verifySendgridEvent({ publicKeyPem: pem, signatureB64: sig, timestamp: null, body });
  assertEquals(absentTs.ok === false && (absentTs as { reason?: string }).reason === "timestamp_missing", true);
  const other = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const wrongSig = await sgSign(other.privateKey, ts, body);
  const invalid = await verifySendgridEvent({ publicKeyPem: pem, signatureB64: wrongSig, timestamp: ts, body });
  assertEquals(invalid.ok === false && (invalid as { reason?: string }).reason === "signature_invalid", true);
  assertEquals(((await verifySendgridEvent({ publicKeyPem: pem, signatureB64: "!!!", timestamp: ts, body })) as { reason?: string }).reason, "signature_malformed");
  assertEquals(((await verifySendgridEvent({ publicKeyPem: pem, signatureB64: toB64(new Uint8Array([1, 2, 3])), timestamp: ts, body })) as { reason?: string }).reason, "signature_der_malformed");
});
