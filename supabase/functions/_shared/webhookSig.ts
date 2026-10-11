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
