// HMAC-SHA256 signature verification helpers using Web Crypto.

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/^sha256=/i, "").trim();
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function hmacSha256(secret: string, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return new Uint8Array(sig);
}

/** Verify "sha256=<hex>" signature header (Meta, Cal.com, generic). */
export async function verifyHmacSha256Hex(
  secret: string,
  body: string,
  headerValue: string | null,
): Promise<boolean> {
  if (!headerValue) return false;
  const expected = await hmacSha256(secret, body);
  const provided = hexToBytes(headerValue);
  return constantTimeEqual(expected, provided);
}

/** Verify DocuSign Connect HMAC1 (base64 of HMAC-SHA256). */
export async function verifyDocuSignHmac(
  secret: string,
  body: string,
  headerValue: string | null,
): Promise<boolean> {
  if (!headerValue) return false;
  const expected = await hmacSha256(secret, body);
  const expectedB64 = btoa(String.fromCharCode(...expected));
  // constant-time compare on equal-length strings
  if (expectedB64.length !== headerValue.length) return false;
  let diff = 0;
  for (let i = 0; i < expectedB64.length; i++) diff |= expectedB64.charCodeAt(i) ^ headerValue.charCodeAt(i);
  return diff === 0;
}

// ─── Svix (Resend) webhook verification ──────────────────────────────────────
// One canonical verifier for every Svix-signed door. Any ONE configured secret
// matching ANY v1 signature part passes (Svix rotates secrets by appending).
// The signed content is `${svix-id}.${svix-timestamp}.${body}` with the secret
// being `whsec_` + base64 key material. A timestamp tolerance window bounds
// replay of old validly-signed events; Svix's own receiver default is 5 minutes.

function b64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export type SvixVerdict = { ok: true } | { ok: false; reason: string };

/** Header shape + tolerance checks shared by every failure mode below. */
export async function verifySvix(opts: {
  secrets: string[];
  svixId: string | null;
  svixTimestamp: string | null;
  svixSignature: string | null;
  body: string;
  /** Max age/skew of svix-timestamp in seconds (default 300, Svix convention). */
  toleranceSeconds?: number;
  /** Injectable clock for tests (ms since epoch). */
  nowMs?: number;
}): Promise<SvixVerdict> {
  const { secrets, body } = opts;
  const id = opts.svixId ?? "";
  const timestamp = opts.svixTimestamp ?? "";
  const signature = opts.svixSignature ?? "";
  if (!id || !timestamp || !signature) return { ok: false, reason: "missing_headers" };
  // Length caps: a hostile header must not be able to make the HMAC or the
  // signature parse do unbounded work.
  if (id.length > 200 || signature.length > 2048 || timestamp.length > 13) {
    return { ok: false, reason: "header_too_large" };
  }
  if (!/^\d+$/.test(timestamp)) return { ok: false, reason: "timestamp_malformed" };
  const tolerance = opts.toleranceSeconds ?? 300;
  const nowSec = Math.floor((opts.nowMs ?? Date.now()) / 1000);
  const ts = Number(timestamp);
  if (Math.abs(nowSec - ts) > tolerance) return { ok: false, reason: "timestamp_out_of_tolerance" };

  const usable = secrets.filter((s) => s.length > 0);
  if (!usable.length) return { ok: false, reason: "no_secrets" };

  const signed = new TextEncoder().encode(`${id}.${timestamp}.${body}`);
  for (const secret of usable) {
    const raw = secret.startsWith("whsec_") ? secret.slice(6) : secret;
    let keyBytes: Uint8Array<ArrayBuffer>;
    try { keyBytes = b64ToBytes(raw); } catch { continue; /* try next secret */ }
    // A stripped/decoded secret of zero bytes makes importKey throw (DataError).
    // Treat a non-usable secret as absent — the verdict is a clean rejection,
    // never an unhandled throw at the door.
    if (keyBytes.length === 0) continue;
    const key = await crypto.subtle.importKey(
      "raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
    );
    const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, signed));
    for (const part of signature.split(" ")) {
      // Each part is `v1,<base64>`. Versions other than v1 are not understood
      // and are not guessed at.
      const [version, value] = part.split(",");
      if (version !== "v1" || !value) continue;
      try { if (timingSafeEqual(mac, b64ToBytes(value))) return { ok: true }; } catch { /* malformed part */ }
    }
  }
  return { ok: false, reason: "signature_invalid" };
}

/** Hex SHA-256 of a string (used for deterministic webhook retry identities). */
export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ─── SendGrid (Twilio) signed Event Webhook verification ─────────────────────
// Twilio/SendGrid signs the raw request body with ECDSA P-256 (ES256) and the
// signature arrives DER-encoded (ASN.1 SEQUENCE of r,s). WebCrypto verifies the
// IEEE P-1363 (raw r||s) form, so the DER is converted before comparing. The
// public key is the provider console's verification key (SPKI PEM), delivered
// via env — never fetched with the admin key.

function pemToDer(pem: string): Uint8Array<ArrayBuffer> {
  const b64 = pem
    .replace(/-----BEGIN PUBLIC KEY-----/, "")
    .replace(/-----END PUBLIC KEY-----/, "")
    .replace(/\s+/g, "");
  return b64ToBytes(b64);
}

/** DER ECDSA-SigValue (SEQUENCE { r INTEGER, s INTEGER }) → P-1363 r||s (32+32). */
function derSignatureToP1363(der: Uint8Array): Uint8Array | null {
  if (der.length < 8 || der[0] !== 0x30) return null;
  if (der[1] === 0x80 || der[1] & 0x80) return null; // long-form/undefined lengths never occur for P-256
  if (2 + der[1] !== der.length) return null; // declared length must consume the input exactly
  let pos = 2; // skip SEQUENCE header
  const readInt = (): Uint8Array | null => {
    if (der[pos] !== 0x02) return null;
    const len = der[pos + 1];
    pos += 2;
    let start = pos;
    let length = len;
    if (len > 32) { // strip sign-padding byte
      start += len - 32;
      length = 32;
    }
    pos += len;
    const out = new Uint8Array(32);
    out.set(der.subarray(start, start + length), 32 - length);
    return out;
  };
  const r = readInt();
  const s = readInt();
  if (!r || !s || pos !== der.length) return null; // trailing bytes are not a signature
  const raw = new Uint8Array(64);
  raw.set(r, 0);
  raw.set(s, 32);
  return raw;
}

export type SendgridEventVerdict = { ok: true } | { ok: false; reason: string };

/**
 * Verify a Twilio/SendGrid signed Event Webhook request. Fail-closed by construction.
 *
 * ANT-148 P1: the official protocol signs `timestamp + raw request body` — the
 * timestamp carried by the X-Twilio-Email-Webhook-Event-Timestamp header is
 * PART of the signed content (Twilio's reference verification updates the
 * digest with the timestamp first, then the raw body, no separator). Verifying
 * the body alone (the pre-correction defect) accepts a replayed body under a
 * captured signature regardless of the timestamp header.
 */
export async function verifySendgridEvent(opts: {
  publicKeyPem: string | null;
  signatureB64: string | null;
  timestamp: string | null;
  body: string;
  /** Max age/skew of the timestamp in seconds (default 300, Twilio's reference). */
  toleranceSeconds?: number;
  /** Injectable clock for tests (ms since epoch). */
  nowMs?: number;
}): Promise<SendgridEventVerdict> {
  const pem = (opts.publicKeyPem ?? "").trim();
  const sigB64 = (opts.signatureB64 ?? "").trim();
  const ts = (opts.timestamp ?? "").trim();
  if (!pem || !sigB64) return { ok: false, reason: "unconfigured_or_unsigned" };
  if (!ts) return { ok: false, reason: "timestamp_missing" };
  if (ts.length > 32) return { ok: false, reason: "timestamp_too_large" };
  if (!/^\d+$/.test(ts)) return { ok: false, reason: "timestamp_malformed" };
  // Replay freshness: a captured (ts, body, signature) triple must not verify
  // forever (Twilio's reference rejects >5 min old).
  const toleranceSec = opts.toleranceSeconds ?? 300;
  const nowSec = Math.floor((opts.nowMs ?? Date.now()) / 1000);
  if (Math.abs(nowSec - Number(ts)) > toleranceSec) return { ok: false, reason: "timestamp_out_of_tolerance" };
  if (sigB64.length > 2048) return { ok: false, reason: "signature_too_large" };
  let der: Uint8Array<ArrayBuffer>;
  try { der = b64ToBytes(sigB64); } catch { return { ok: false, reason: "signature_malformed" }; }
  const p1363 = derSignatureToP1363(der);
  if (!p1363) return { ok: false, reason: "signature_der_malformed" };
  try {
    const key = await crypto.subtle.importKey(
      "spki",
      pemToDer(pem) as unknown as ArrayBuffer,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    const valid = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      p1363 as unknown as ArrayBuffer,
      // Signed content per the official protocol: timestamp THEN raw body.
      new TextEncoder().encode(`${ts}${opts.body}`),
    );
    return valid ? { ok: true } : { ok: false, reason: "signature_invalid" };
  } catch {
    return { ok: false, reason: "key_or_signature_invalid" };
  }
}
