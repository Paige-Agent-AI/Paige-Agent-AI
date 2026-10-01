// Scheduled-send worker: booking reminders + post-meeting follow-ups.
// Invoked by pg_cron every ~5 min (guarded by a shared token). Reads each
// calendar-backed booking's notify_config, and for every due reminder offset
// or follow-up window sends a branded email from calendar@ — claimed in
// booking_notifications_sent first so nothing is ever sent twice.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// Shared sender + templating (§12): the Twilio path and merge-field renderer
// live in one place, reused by public-booking and booking-manage too.
import { renderTemplate, sendSms } from "../_shared/bookingNotify.ts";
import { primaryPhonesForUsers } from "../_shared/user-contact-methods.ts";

// The pg_cron trigger token lives ONLY in Supabase Vault (task #145) — never in
// source or env. The request handler authorizes each trigger by calling the
// service-role RPC public.verify_cron_token against the x-cron-token header the
// cron job builds via public.cron_token_header(); no literal token exists here.
const RESEND_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const EMAIL_FROM = Deno.env.get("CALENDAR_EMAIL_FROM") ?? Deno.env.get("PLATFORM_DEFAULT_EMAIL_FROM") ?? "Paige Agent AI <calendar@paigeagent.ai>";
// SMS (Twilio) reminders fire on 'sms'/'both' via the shared sender
// (_shared/bookingNotify.ts), which owns the Twilio credential env.
// Signed self-serve manage link — matches booking-manage's verifier (HMAC over
// the base64url payload, keyed by the service-role key) and public-booking's
// {b, iat, exp, ver} payload so the same link reschedules/cancels this booking.
const SIGN_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const PUBLIC_BASE = (Deno.env.get("PUBLIC_SITE_URL") ?? "https://paigeagent.ai").replace(/\/$/, "");
const MANAGE_TOKEN_TTL_DAYS = 30;

const MIN = 60_000;
const DAY = 86_400_000;

function esc(s: string): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function locationLabel(type: string, value: string | null): string {
  switch (type) {
    case "google_meet": return "Google Meet — link to follow";
    case "zoom": return "Zoom — link to follow";
    case "phone": return value ? `Phone call: ${value}` : "Phone call";
    case "in_person": return value ? `In person: ${value}` : "In person";
    case "custom": return value || "Details to follow";
    default: return "To be confirmed";
  }
}
function shell(brandName: string, accent: string, heading: string, lead: string, rows: [string, string][], footer: string, manageLink?: string): string {
  const rowHtml = rows.map(([k, v]) =>
    `<tr><td style="padding:6px 0;color:#98a0ae;width:88px;">${esc(k)}</td><td style="padding:6px 0;font-weight:600;color:#101828;">${esc(v)}</td></tr>`).join("");
  // A signed reschedule/cancel link renders above the footer line, styled the
  // same as public-booking's confirmation email so the guest sees one system.
  const footerHtml = manageLink
    ? `<p style="color:#667085;font-size:13px;margin:0 0 4px;">Need to make a change? <a href="${esc(manageLink)}" style="color:#7A67E8;font-weight:600;text-decoration:none;">Reschedule or cancel</a>.</p>
       <p style="color:#98a0ae;font-size:12px;margin:0;">${esc(footer)}</p>`
    : `<p style="color:#98a0ae;font-size:12px;margin:0;">${esc(footer)}</p>`;
  return `<!doctype html><html><body style="margin:0;background:#f4f5f7;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:28px 0;"><tr><td align="center">
    <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;background:#fff;border:1px solid #e7e8ec;border-radius:14px;overflow:hidden;">
      <tr><td style="height:5px;background:${esc(accent)};"></td></tr>
      <tr><td style="padding:28px 32px 8px;">
        <div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#98a0ae;font-weight:bold;">${esc(brandName)}</div>
        <h1 style="color:#101828;font-size:20px;margin:10px 0 4px;">${esc(heading)}</h1>
        <p style="color:#667085;font-size:14px;margin:0 0 18px;">${esc(lead)}</p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;">${rowHtml}</table>
      </td></tr>
      <tr><td style="padding:18px 32px 26px;border-top:1px solid #eef0f3;">
        ${footerHtml}
      </td></tr>
    </table></td></tr></table></body></html>`;
}

// btoa() only accepts Latin1; base64url over raw bytes is fine for the HMAC path.
function b64url(bytes: Uint8Array): string {
  let s = ""; for (const c of bytes) s += String.fromCharCode(c);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
// Same signed link public-booking mints: HMAC-SHA256 over the base64url payload
// {b, iat, exp, ver}, keyed by the service-role key. `ver` pins the booking's
// manage_token_version so a later revocation invalidates links minted before it.
async function manageUrl(bookingId: string, ver = 0): Promise<string> {
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + MANAGE_TOKEN_TTL_DAYS * 86_400;
  const payload = b64url(new TextEncoder().encode(JSON.stringify({ b: bookingId, iat, exp, ver })));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(SIGN_KEY), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = b64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload))));
  return `${PUBLIC_BASE}/booking/manage?token=${payload}.${sig}`;
}

async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  if (!RESEND_KEY) return false;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: EMAIL_FROM, to: [to], subject, html }),
    });
    return res.ok;
  } catch { return false; }
}

// to: who a reminder targets — 'guest' (default, back-compat), 'host', or 'both'.
interface Reminder { channel: string; offset_min: number; to: string; subject?: string; body?: string }
interface Notify {
  reminders: Reminder[]; followup_guest: boolean; followup_offset_min: number;
  followup_subject?: string; followup_body?: string;
}
function parseNotify(raw: unknown): Notify {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const reminders = Array.isArray(o.reminders)
    ? (o.reminders as unknown[])
        .map((r) => (r && typeof r === "object" ? r : {}) as Record<string, unknown>)
        .filter((r) => typeof r.offset_min === "number")
        .map((r) => ({
          channel: typeof r.channel === "string" ? r.channel : "email",
          offset_min: r.offset_min as number,
          // Recipient targeting — a reminder can nudge the host, not just the
          // guest. Unknown/absent => 'guest' so every existing config is unchanged.
          to: r.to === "host" || r.to === "both" ? (r.to as string) : "guest",
          // Optional per-reminder copy (config-as-data, §10) — Paige-authorable.
          subject: typeof r.subject === "string" && r.subject.trim() ? r.subject : undefined,
          body: typeof r.body === "string" && r.body.trim() ? r.body : undefined,
        }))
    : [];
  return {
    reminders,
    followup_guest: o.followup_guest === true,
    followup_offset_min: typeof o.followup_offset_min === "number" ? o.followup_offset_min : 60,
    followup_subject: typeof o.followup_subject === "string" && o.followup_subject.trim() ? o.followup_subject : undefined,
    followup_body: typeof o.followup_body === "string" && o.followup_body.trim() ? o.followup_body : undefined,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok");
  // Service-role client is built first so it can authorize the trigger below.
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  // Authorize the cron trigger against the Vault-held token via a service-role
  // RPC (task #145): the secret exists only in Vault, so we verify the received
  // header rather than compare to any local literal. verify_jwt is off, so this
  // is the ONLY gate — fail CLOSED on any RPC error or a non-true result (§13).
  const cronToken = req.headers.get("x-cron-token") ?? "";
  const { data: cronOk, error: cronErr } = await admin.rpc("verify_cron_token", { _token: cronToken });
  if (cronErr || cronOk !== true) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
  }
  const now = Date.now();

  // Candidate window: reminders up to a week ahead, follow-ups up to 2 days back.
  const { data: rows } = await admin
    .from("internal_bookings")
    .select("id, guest_email, guest_phone, guest_name, title, start_at, end_at, timezone, location_type, location_value, status, calendar_id, collective_group_id, manage_token_version, appointment_type, host_user_id")
    .not("calendar_id", "is", null)
    .neq("status", "cancelled")
    .neq("status", "no_show")
    .gte("start_at", new Date(now - 2 * DAY).toISOString())
    .lte("start_at", new Date(now + 8 * DAY).toISOString());
  const allRows = rows ?? [];
  // Collective bookings write one symmetric row per host, all sharing the same
  // guest_email/start_at/collective_group_id — without this, the shared guest
  // gets one duplicate reminder/follow-up per attending host. Keep a single
  // deterministic representative per group (lowest id) so repeated cron runs
  // always claim against the same booking_id and the unique claim table below
  // dedupes across runs, not just within one. class_seat rows need no such
  // dedup — each seat is already a different guest, by design (§ one row =
  // one person's relationship to one interval).
  const byGroupRep = new Map<string, (typeof allRows)[number]>();
  const singles: typeof allRows = [];
  for (const b of allRows) {
    const gid = b.collective_group_id as string | null;
    if (!gid) { singles.push(b); continue; }
    const cur = byGroupRep.get(gid);
    if (!cur || (b.id as string) < (cur.id as string)) byGroupRep.set(gid, b);
  }
  const bookings = [...singles, ...byGroupRep.values()];

  // Load the calendars referenced by these bookings (notify_config + branding).
  const calIds = Array.from(new Set(bookings.map((b) => b.calendar_id as string)));
  const calById = new Map<string, Record<string, unknown>>();
  const tenantIds = new Set<string>();
  if (calIds.length) {
    const { data: cals } = await admin.from("calendars")
      .select("id, tenant_id, title, description, accent, logo_url, notify_config").in("id", calIds);
    for (const c of (cals ?? [])) { calById.set(c.id as string, c); if (c.tenant_id) tenantIds.add(c.tenant_id as string); }
  }
  // Tenant brand names for the email header.
  const tenantName = new Map<string, string>();
  if (tenantIds.size) {
    const { data: ts } = await admin.from("tenants").select("id, name, brand").in("id", Array.from(tenantIds));
    for (const t of (ts ?? [])) {
      const brand = (t.brand ?? {}) as Record<string, string>;
      tenantName.set(t.id as string, brand.brand_name || brand.display_name || brand.name || (t.name as string) || "Paige Agent AI");
    }
  }

  // Claim a notification; returns true if we won the claim (idempotent gate).
  async function claim(bookingId: string, key: string, email: string): Promise<boolean> {
    const { error } = await admin.from("booking_notifications_sent")
      .insert({ booking_id: bookingId, notif_key: key, recipient_email: email, status: "sending" });
    return !error; // unique violation => already claimed
  }
  async function finish(bookingId: string, key: string, ok: boolean) {
    if (ok) await admin.from("booking_notifications_sent").update({ status: "sent" }).eq("booking_id", bookingId).eq("notif_key", key);
    else await admin.from("booking_notifications_sent").delete().eq("booking_id", bookingId).eq("notif_key", key); // let it retry
  }

  // Host contact for host-targeted reminders (email from auth, phone = the host's
  // primary phone). Memoized per run so a busy host is resolved once, not per booking.
  const hostContactCache = new Map<string, { email: string; phone: string }>();
  async function hostContact(uid: string | null): Promise<{ email: string; phone: string }> {
    if (!uid) return { email: "", phone: "" };
    const hit = hostContactCache.get(uid);
    if (hit) return hit;
    let email = "", phone = "";
    try {
      const { data: u } = await admin.auth.admin.getUserById(uid);
      email = (u as { user?: { email?: string } } | null)?.user?.email ?? "";
    } catch { /* unreachable host email — send just skips that channel */ }
    try {
      phone = (await primaryPhonesForUsers(admin, [uid])).get(uid) ?? "";
    } catch (e) {
      // An unreadable phone skips SMS-to-host for this run — loudly, never the email leg.
      console.error("[process-booking-notifications] host_phone_read_failed", (e as Error).message);
    }
    const rec = { email, phone };
    hostContactCache.set(uid, rec);
    return rec;
  }

  // Truthful, per-channel counters — an SMS send is reported separately from an
  // email send, and each counts only on an actual provider acceptance (§13).
  let reminders = 0, smsReminders = 0, followups = 0;
  for (const b of bookings) {
    const cal = calById.get(b.calendar_id as string);
    if (!cal) continue;
    const email = String(b.guest_email ?? "");
    const phone = String(b.guest_phone ?? "");
    if (!email && !phone) continue; // nobody reachable on any channel
    const notify = parseNotify(cal.notify_config);
    const startMs = Date.parse(b.start_at as string);
    const endMs = Date.parse(b.end_at as string);
    const tz = (b.timezone as string) || "America/New_York";
    const accent = (cal.accent as string) || "#EBB94C";
    const brandName = (cal.tenant_id && tenantName.get(cal.tenant_id as string)) || "Paige Agent AI";
    const title = (cal.title as string) || (b.title as string) || "Your session";
    const loc = locationLabel(String(b.location_type ?? ""), (b.location_value as string) ?? null);
    const ver = Number(b.manage_token_version ?? 0) || 0;
    const guestName = String(b.guest_name ?? "").trim();
    const apt = (b.appointment_type && typeof b.appointment_type === "object" ? b.appointment_type : null) as { name?: string } | null;
    const service = (apt?.name && String(apt.name)) || title;
    const whenLabel = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, weekday: "long", month: "long", day: "numeric",
      hour: "numeric", minute: "2-digit", timeZoneName: "short",
    }).format(new Date(startMs));
    // Merge vars for config-as-data reminder copy (§10).
    const vars: Record<string, string> = {
      guest_name: guestName || "there", when: whenLabel, where: loc, title, service,
    };

    // Reminders: due when now is at/after (start - offset) and before start.
    for (const rem of notify.reminders) {
      const dueAt = startMs - rem.offset_min * MIN;
      if (!(dueAt <= now && now < startMs)) continue;
      // Honor the reminder channel: 'both' fans out to email AND sms, each with
      // its OWN claim key so the two never collide on the shared (booking, key)
      // unique gate and one channel failing can't block the other.
      const channels = rem.channel === "both" ? ["email", "sms"] : [rem.channel === "sms" ? "sms" : "email"];
      // Recipient targeting: 'guest' (default), 'host', or 'both'. Host contact
      // is resolved lazily (email from auth, phone from profile) only when needed.
      const targets = rem.to === "both" ? ["guest", "host"] : [rem.to === "host" ? "host" : "guest"];
      for (const target of targets) {
        const contact = target === "host" ? await hostContact(b.host_user_id as string | null) : { email, phone };
        for (const ch of channels) {
          if (ch === "email" && !contact.email) continue;
          if (ch === "sms" && !contact.phone) continue;
          // start time is part of the key so a RESCHEDULED booking (new startMs)
          // gets a fresh claim and re-reminds for its moved time, instead of the
          // surviving 'sent' row from the old time silently suppressing it. The
          // guest key is UNCHANGED from before targeting existed (no 'guest'
          // segment) so already-sent guest reminders never re-fire on rollout;
          // host is a separate key namespace.
          const key = target === "host"
            ? `reminder:host:${ch}:${rem.offset_min}:${startMs}`
            : `reminder:${ch}:${rem.offset_min}:${startMs}`;
          // recipient_email is the claim's audit field; SMS-only has no email, so
          // fall back to the phone as the recorded recipient identifier.
          const recipient = ch === "email" ? contact.email : (contact.email || contact.phone);
          if (!(await claim(b.id as string, key, recipient))) continue;
          const mUrl = await manageUrl(b.id as string, ver);
          let ok = false;
          if (ch === "email") {
            const subject = rem.subject ? renderTemplate(rem.subject, vars) : `Reminder: ${title} · ${whenLabel}`;
            const lead = rem.body ? renderTemplate(rem.body, vars) : "A quick heads-up — your session is coming up.";
            const html = shell(brandName, accent, "Reminder: you're booked", lead,
              [["Session", title], ["When", whenLabel], ["Where", loc]],
              "Or just reply to this email.", mUrl);
            ok = await sendEmail(contact.email, subject, html);
          } else {
            const line = rem.body
              ? renderTemplate(rem.body, vars)
              : `Reminder: ${title} on ${whenLabel}. ${loc}.`;
            // The manage link is appended (not part of the authorable copy) so an
            // SMS reminder can still reschedule/cancel with the same signed link.
            ok = await sendSms(contact.phone, `${line}\nReschedule or cancel: ${mUrl}`);
          }
          await finish(b.id as string, key, ok);
          if (ok) { if (ch === "sms") smsReminders++; else reminders++; }
        }
      }
    }

    // Follow-up (guest email): due when now is at/after (end + offset), meeting
    // has ended. Email-only; carries the same signed manage link. Honors optional
    // owner-authored subject/body (config-as-data, §10) — empty falls back to
    // the built-in copy so existing configs are unchanged.
    if (email && notify.followup_guest && endMs <= now && endMs + notify.followup_offset_min * MIN <= now) {
      const key = `followup:${startMs}`;
      if (await claim(b.id as string, key, email)) {
        const mUrl = await manageUrl(b.id as string, ver);
        const subject = notify.followup_subject ? renderTemplate(notify.followup_subject, vars) : `Following up on ${title}`;
        const lead = notify.followup_body
          ? renderTemplate(notify.followup_body, vars)
          : `Great connecting${guestName ? `, ${esc(guestName)}` : ""}. Here's a quick follow-up.`;
        const html = shell(brandName, accent, "Thanks for the time", lead,
          [["Session", title], ["When", whenLabel]],
          "Want to book again or have a question? Just reply — we're here.", mUrl);
        const ok = await sendEmail(email, subject, html);
        await finish(b.id as string, key, ok);
        if (ok) followups++;
      }
    }
  }

  return new Response(JSON.stringify({ ok: true, scanned: bookings.length, reminders, smsReminders, followups }), {
    headers: { "Content-Type": "application/json" },
  });
});
