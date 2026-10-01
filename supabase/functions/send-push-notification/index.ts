// Send web push notifications using VAPID
// Implements the Web Push Protocol (RFC 8030) with VAPID auth (RFC 8292)
// using ECDH P-256 + AES-128-GCM (aes128gcm content encoding, RFC 8188).
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { encode as encodeBase64Url } from "https://deno.land/std@0.168.0/encoding/base64url.ts";
import { isAuthorizedInternalCaller } from "../_shared/systems-check-http.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ─── Helpers ───────────────────────────────────────────────────────────────
const b64uToBytes = (s: string): Uint8Array => {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

const bytesToB64u = (b: Uint8Array): string => encodeBase64Url(b);

const concat = (...arrs: Uint8Array[]): Uint8Array => {
  const total = arrs.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrs) { out.set(a, off); off += a.length; }
  return out;
};

const u16be = (n: number): Uint8Array => new Uint8Array([(n >> 8) & 0xff, n & 0xff]);
const u32be = (n: number): Uint8Array => new Uint8Array([
  (n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff,
]);

// HKDF (RFC 5869) using SHA-256
async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", salt, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const prk = new Uint8Array(await crypto.subtle.sign("HMAC", key, ikm));
  const prkKey = await crypto.subtle.importKey("raw", prk, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const t1 = new Uint8Array(await crypto.subtle.sign("HMAC", prkKey, concat(info, new Uint8Array([1]))));
  return t1.slice(0, length);
}

// Convert raw 65-byte uncompressed P-256 public key into JWK
function rawP256ToJwk(raw: Uint8Array): JsonWebKey {
  if (raw.length !== 65 || raw[0] !== 0x04) throw new Error("Invalid raw P-256 key");
  return {
    kty: "EC",
    crv: "P-256",
    x: bytesToB64u(raw.slice(1, 33)),
    y: bytesToB64u(raw.slice(33, 65)),
    ext: true,
  };
}

// Import VAPID private key (base64url raw 32-byte d) into a CryptoKey for ECDSA signing
async function importVapidPrivateKey(privateB64u: string, publicB64u: string): Promise<CryptoKey> {
  const dBytes = b64uToBytes(privateB64u);
  const pubBytes = b64uToBytes(publicB64u);
  if (pubBytes.length !== 65) throw new Error("VAPID_PUBLIC_KEY must be uncompressed P-256 (65 bytes)");
  const jwk: JsonWebKey = {
    kty: "EC",
    crv: "P-256",
    d: bytesToB64u(dBytes),
    x: bytesToB64u(pubBytes.slice(1, 33)),
    y: bytesToB64u(pubBytes.slice(33, 65)),
    ext: true,
  };
  return await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
}

// Build VAPID JWT signed with ES256
async function buildVapidJwt(audience: string, subject: string, privateKey: CryptoKey): Promise<string> {
  const header = { typ: "JWT", alg: "ES256" };
  const payload = {
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60, // 12h
    sub: subject,
  };
  const enc = new TextEncoder();
  const headerB64 = bytesToB64u(enc.encode(JSON.stringify(header)));
  const payloadB64 = bytesToB64u(enc.encode(JSON.stringify(payload)));
  const signingInput = `${headerB64}.${payloadB64}`;
  const sig = new Uint8Array(
    await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, enc.encode(signingInput)),
  );
  return `${signingInput}.${bytesToB64u(sig)}`;
}

// Encrypt payload using aes128gcm content encoding (RFC 8188)
async function encryptPayload(
  payload: Uint8Array,
  subscriberPublicKeyRaw: Uint8Array, // 65 bytes
  authSecret: Uint8Array, // 16 bytes
): Promise<{ ciphertext: Uint8Array; salt: Uint8Array; localPublicKeyRaw: Uint8Array }> {
  // 1. Generate ephemeral ECDH key pair (P-256)
  const localKeyPair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  );
  const localPublicJwk = await crypto.subtle.exportKey("jwk", localKeyPair.publicKey);
  const localPublicRaw = new Uint8Array(65);
  localPublicRaw[0] = 0x04;
  localPublicRaw.set(b64uToBytes(localPublicJwk.x!), 1);
  localPublicRaw.set(b64uToBytes(localPublicJwk.y!), 33);

  // 2. Import subscriber's public key
  const subscriberPub = await crypto.subtle.importKey(
    "jwk",
    rawP256ToJwk(subscriberPublicKeyRaw),
    { name: "ECDH", namedCurve: "P-256" },
    true,
    [],
  );

  // 3. Derive ECDH shared secret
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: subscriberPub }, localKeyPair.privateKey, 256),
  );

  // 4. Random 16-byte salt
  const salt = crypto.getRandomValues(new Uint8Array(16));

  // 5. PRK_key = HKDF(authSecret, ecdhSecret, "WebPush: info\0" || ua_public || as_public, 32)
  const enc = new TextEncoder();
  const keyInfo = concat(
    enc.encode("WebPush: info\0"),
    subscriberPublicKeyRaw,
    localPublicRaw,
  );
  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32);

  // 6. CEK = HKDF(salt, ikm, "Content-Encoding: aes128gcm\0", 16)
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  // 7. NONCE = HKDF(salt, ikm, "Content-Encoding: nonce\0", 12)
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);

  // 8. Pad: payload || 0x02 (last record delimiter for aes128gcm)
  const padded = concat(payload, new Uint8Array([0x02]));

  // 9. Encrypt
  const cekKey = await crypto.subtle.importKey("raw", cek, { name: "AES-GCM" }, false, ["encrypt"]);
  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, cekKey, padded),
  );

  // 10. Build aes128gcm header: salt(16) | rs(4 BE) | idlen(1) | keyid(idlen)
  // For Web Push: keyid = local public key (raw 65 bytes), rs = 4096
  const header = concat(salt, u32be(4096), new Uint8Array([localPublicRaw.length]), localPublicRaw);
  const ciphertext = concat(header, encrypted);

  return { ciphertext, salt, localPublicKeyRaw: localPublicRaw };
}

async function sendWebPush(
  endpoint: string,
  p256dh: string,
  auth: string,
  payload: object,
  vapidPublicKey: string,
  vapidPrivateKey: string,
  vapidSubject: string,
): Promise<{ ok: boolean; status: number; statusText: string; body?: string }> {
  const url = new URL(endpoint);
  const audience = `${url.protocol}//${url.host}`;

  const privateKey = await importVapidPrivateKey(vapidPrivateKey, vapidPublicKey);
  const jwt = await buildVapidJwt(audience, vapidSubject, privateKey);

  const subscriberPublicKey = b64uToBytes(p256dh);
  const authSecret = b64uToBytes(auth);
  const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));

  const { ciphertext } = await encryptPayload(payloadBytes, subscriberPublicKey, authSecret);

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Authorization": `vapid t=${jwt}, k=${vapidPublicKey}`,
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      "TTL": "86400",
      "Urgency": "normal",
    },
    body: ciphertext,
  });

  let body: string | undefined;
  if (!res.ok) {
    try { body = await res.text(); } catch { /* noop */ }
  }
  return { ok: res.ok, status: res.status, statusText: res.statusText, body };
}

// ─── Comms C-1.5 (E3): inbox quiet-hours READ-GATE ──────────────────────────
// Consults the reserved public.notification_preferences row
// (user_id, 'app', 'comms_inbox'). Returns a skip reason when the user is inside
// their quiet window. This gates ONLY whether the USER is PINGED — it NEVER gates
// message delivery/sending (§13). Overnight-aware (start > end wraps midnight);
// IANA-tz-aware via Intl; day-of-week scoped; fails OPEN (pings) on any bad input.
// deno-lint-ignore no-explicit-any
async function isWithinQuietHours(
  db: any,
  userId: string,
): Promise<{ skip: boolean; reason?: string }> {
  const { data: pref } = await db
    .from("notification_preferences")
    .select("enabled, metadata")
    .eq("user_id", userId)
    .eq("channel", "app")
    .eq("alert_type", "comms_inbox")
    .maybeSingle();

  if (!pref) return { skip: false };                        // no prefs row → ping normally
  if (pref.enabled === false) return { skip: true, reason: "comms_inbox_pings_off" };

  const m = (pref.metadata ?? {}) as {
    dnd?: boolean; quiet_start?: string; quiet_end?: string; tz?: string; days?: number[];
  };
  if (!m.dnd || !m.quiet_start || !m.quiet_end) return { skip: false };

  const tz = m.tz || "UTC";
  let hh = 0, mm = 0, dow = 0;
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hour12: false, hour: "2-digit", minute: "2-digit", weekday: "short",
    }).formatToParts(new Date());
    hh = Number(parts.find((p) => p.type === "hour")?.value ?? "0") % 24;
    mm = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
    const wd = parts.find((p) => p.type === "weekday")?.value ?? "Sun";
    dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(wd);
  } catch {
    return { skip: false };                                 // bad tz → fail open (ping)
  }

  const days = Array.isArray(m.days) && m.days.length ? m.days : [0, 1, 2, 3, 4, 5, 6];
  if (!days.includes(dow)) return { skip: false };          // DND doesn't apply today

  const nowMin = hh * 60 + mm;
  const [sH, sM] = m.quiet_start.split(":").map(Number);
  const [eH, eM] = m.quiet_end.split(":").map(Number);
  if ([sH, sM, eH, eM].some((n) => Number.isNaN(n))) return { skip: false };
  const startMin = sH * 60 + sM;
  const endMin = eH * 60 + eM;

  const inWindow = startMin <= endMin
    ? nowMin >= startMin && nowMin < endMin                 // same-day window
    : nowMin >= startMin || nowMin < endMin;                // overnight window (start > end)

  return inWindow ? { skip: true, reason: "comms_inbox_quiet_hours" } : { skip: false };
}

// ─── Main handler ──────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY") || "";
    const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY") || "";
    const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") || "mailto:support@paigeagent.ai";

    const body = await req.json().catch(() => ({}));
    const action = body.action;

    // Public key endpoint — used by client to subscribe
    if (action === "get_public_key") {
      return new Response(JSON.stringify({ publicKey: VAPID_PUBLIC_KEY }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
      return new Response(JSON.stringify({
        error: "VAPID keys not configured",
        hint: "Set VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT in Edge Function secrets",
      }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Sending is internal-only: a service-role bearer or a valid cron token. The public key above is
    // the one open action; nothing a browser holds may push to a person's devices.
    if (!(await isAuthorizedInternalCaller(req, supabase))) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Required: tenant_id (the sending business), user_id, category, title, body
    const {
      tenant_id,
      user_id,
      category, // 'dispute_updates' | 'funding_matches' | 'credit_score_changes' | 'task_reminders' | 'general'
      title,
      body: msgBody,
      url: clickUrl,
      data: extraData,
      tag,
    } = body;

    if (!tenant_id || !user_id || !category || !title || !msgBody) {
      return new Response(JSON.stringify({ error: "Missing required fields: tenant_id, user_id, category, title, body" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check user preferences
    const { data: prefs } = await supabase
      .from("push_notification_preferences")
      .select("*")
      .eq("user_id", user_id)
      .maybeSingle();

    if (prefs && prefs.push_enabled === false) {
      return new Response(JSON.stringify({ skipped: true, reason: "push disabled by user" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Comms C-1.5 (E3): inbox quiet-hours read-gate. ONLY inbox-activity pings
    // consult it; every other category is unaffected. This suppresses the PING,
    // NEVER the send/delivery of the message itself (§13).
    if (category === "comms_inbox") {
      const quiet = await isWithinQuietHours(supabase, user_id);
      if (quiet.skip) {
        // §13: log the skip reason honestly — never a silent drop.
        console.log(`[send-push] quiet-hours skip user=${user_id} reason=${quiet.reason}`);
        // TODO(C-1.5 follow-up): enqueue a digest to fire at the quiet-window end so
        // the user gets one roll-up of what they missed instead of losing the pings.
        return new Response(JSON.stringify({ skipped: true, reason: quiet.reason }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const categoryFlagMap: Record<string, keyof typeof prefs> = {
      dispute_updates: "notify_dispute_updates",
      funding_matches: "notify_funding_matches",
      credit_score_changes: "notify_credit_score_changes",
      task_reminders: "notify_task_reminders",
    };
    const flag = categoryFlagMap[category];
    if (prefs && flag && (prefs as any)[flag] === false) {
      return new Response(JSON.stringify({ skipped: true, reason: `category ${category} disabled` }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // A notification belongs to exactly one business and reaches only the devices registered for it.
    // A subscription with no business matches no sender.
    const { data: subs } = await supabase
      .from("push_subscriptions")
      .select("id, endpoint, p256dh_key, auth_key")
      .eq("user_id", user_id)
      .eq("tenant_id", tenant_id)
      .eq("is_active", true);

    if (!subs || subs.length === 0) {
      return new Response(JSON.stringify({ skipped: true, reason: "no active subscriptions" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const payload = {
      title,
      body: msgBody,
      url: clickUrl || "/app",
      category,
      tag: tag || category,
      data: extraData || {},
    };

    const results = [];
    for (const sub of subs) {
      try {
        const result = await sendWebPush(
          sub.endpoint,
          sub.p256dh_key,
          sub.auth_key,
          payload,
          VAPID_PUBLIC_KEY,
          VAPID_PRIVATE_KEY,
          VAPID_SUBJECT,
        );

        await supabase.from("push_notification_log").insert({
          user_id,
          subscription_id: sub.id,
          category,
          title,
          body: msgBody,
          url: clickUrl,
          data: extraData || null,
          status: result.ok ? "sent" : "failed",
          error_message: result.ok ? null : `${result.status} ${result.statusText}: ${result.body || ""}`.slice(0, 500),
          sent_at: result.ok ? new Date().toISOString() : null,
        });

        // Disable subscription on permanent failures
        if ([404, 410].includes(result.status)) {
          await supabase
            .from("push_subscriptions")
            .update({ is_active: false })
            .eq("id", sub.id);
        }

        results.push({ subscription_id: sub.id, ok: result.ok, status: result.status });
      } catch (e: any) {
        console.error("[push] send error", e);
        await supabase.from("push_notification_log").insert({
          user_id,
          subscription_id: sub.id,
          category,
          title,
          body: msgBody,
          status: "failed",
          error_message: String(e?.message || e).slice(0, 500),
        });
        results.push({ subscription_id: sub.id, ok: false, error: String(e?.message || e) });
      }
    }

    return new Response(JSON.stringify({ success: true, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("[send-push-notification] fatal", e);
    return new Response(JSON.stringify({ error: String(e?.message || e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
