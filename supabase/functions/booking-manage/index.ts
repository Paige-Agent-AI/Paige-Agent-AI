import { commsProviderExecutionAllowed } from "../_shared/comms-provider-boundary.ts";
// Guest self-serve: view / cancel / reschedule a booking via a signed link.
// No login — the link carries an HMAC token (signed with the service-role key)
// that resolves to exactly one booking. Slot logic lives in one shared place
// (_shared/slotRules.ts, the same rules the public booking engine enforces), so
// a stale or hand-crafted reschedule time can't bypass date overrides, the
// booking horizon, minimum notice, or buffer-padded conflicts on this path.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  type Busy,
  type DateOverride,
  type DayWindow,
  isFree,
  isValidSlotStart,
  type SlotRules,
} from "../_shared/slotRules.ts";
// Shared notification primitives (§12): Twilio sender, merge-field renderer, and
// opt-in lifecycle-trigger parsing/rendering — the same code the create path and
// the scheduled worker use, so cancel/reschedule messages match one system.
import {
  channelsOf, type Lifecycle, lifecycleEmailHtml, parseLifecycle, renderTemplate, sendSms, targetsOf,
} from "../_shared/bookingNotify.ts";
// Anon abuse control (§13): a leaked/valid manage token could be replayed to
// hammer view/reschedule/cancel, and invalid tokens brute-forced — throttle
// per-IP (guards both) and per-token (guards a single leaked link). Fail-open on
// the limiter's own error so a hiccup never blocks a legit change.
import { clientIp, overRateLimit } from "../_shared/rateLimit.ts";
// Per-host Zoom (§9): keep the host's Zoom meeting in sync with the booking —
// move it on reschedule, delete it on cancel. Best-effort (§13): a Zoom failure
// never fails a change that's already committed.
import { deleteZoomMeeting, updateZoomMeeting } from "../_shared/zoomMeetings.ts";
import { primaryPhonesForUsers } from "../_shared/user-contact-methods.ts";

// Per-window ceilings (60s). A real guest managing one booking makes a handful of
// calls; these sit well above that but stop a replay/brute-force flood.
const RL_MANAGE_PER_IP = 30;
const RL_MANAGE_PER_TOKEN = 20;
const TOO_MANY = "Too many requests — please try again shortly.";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const SECRET = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const enc = new TextEncoder();

function b64urlFromBytes(bytes: Uint8Array): string {
  let bin = ""; for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function b64urlToStr(s: string): string {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
}
async function hmac(data: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64urlFromBytes(new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data))));
}

// --- Signed self-serve token ------------------------------------------------
// Payload: JSON{ b: bookingId, iat, exp, ver } (iat/exp in seconds).
//   iat/exp — issued-at + expiry, so a leaked link can't live forever.
//   ver     — the booking's manage_token_version at issuance; cancelling bumps
//             the version so a cancelled booking's old link stops resolving.
// Legacy tokens (payload{b} only, minted before this hardening — e.g. by
// public-booking) carry no exp/ver: they don't expire here and skip the version
// check, staying governed by the status gate. token = b64url(payload).b64url(HMAC).
type TokenResult =
  | { ok: true; bookingId: string; ver: number | null }
  | { ok: false; reason: "invalid" | "expired" };
async function verifyToken(token: string): Promise<TokenResult> {
  const [payload, sig] = (token || "").split(".");
  if (!payload || !sig) return { ok: false, reason: "invalid" };
  if ((await hmac(payload)) !== sig) return { ok: false, reason: "invalid" };
  try {
    const o = JSON.parse(b64urlToStr(payload));
    if (typeof o.b !== "string") return { ok: false, reason: "invalid" };
    if (typeof o.exp === "number" && Math.floor(Date.now() / 1000) > o.exp) return { ok: false, reason: "expired" };
    return { ok: true, bookingId: o.b, ver: typeof o.ver === "number" ? o.ver : null };
  } catch {
    return { ok: false, reason: "invalid" };
  }
}
const PUBLIC_BASE = (Deno.env.get("PUBLIC_SITE_URL") ?? "https://paigeagent.ai").replace(/\/$/, "");
/** A fresh, version-stamped manage link (valid ~400 days — comfortably past any
 *  booking horizon). Same signer/secret as the verifier above. */
async function manageUrl(bookingId: string, ver: number): Promise<string> {
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + 400 * 86_400;
  const payload = b64urlFromBytes(enc.encode(JSON.stringify({ b: bookingId, iat, exp, ver })));
  const sig = await hmac(payload);
  return `${PUBLIC_BASE}/booking/manage?token=${payload}.${sig}`;
}

// --- Confirmation emails (guest + host) + .ics invite -----------------------
// Mirrors public-booking's mail/ICS/tenant-sender pattern; kept self-contained
// here so this function owns its notifications without importing that engine.
const RESEND_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const EMAIL_FROM = Deno.env.get("CALENDAR_EMAIL_FROM") ?? Deno.env.get("PLATFORM_DEFAULT_EMAIL_FROM") ?? "Paige Agent AI <calendar@paigeagent.ai>";
// btoa() only accepts Latin1 — any em dash / curly quote / non-ASCII content
// throws InvalidCharacterError. Encode as UTF-8 bytes first.
function b64utf8(s: string): string {
  let bin = ""; for (const b of enc.encode(s)) bin += String.fromCharCode(b);
  return btoa(bin);
}
function esc(s: string): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function textOn(hex: string): string {
  const h = (hex || "").replace("#", "");
  if (h.length < 6) return "#1B1230";
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? "#1B1230" : "#FFFFFF";
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
function icsStamp(ms: number): string {
  return new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}
/** Build a VEVENT for an update (METHOD:REQUEST) or a withdrawal
 *  (METHOD:CANCEL). The UID matches the original invite so a calendar client
 *  updates/removes the existing event instead of adding a duplicate; SEQUENCE
 *  is a monotonic unix timestamp so a later message always supersedes. */
function buildIcs(o: {
  uid: string; startMs: number; endMs: number; title: string; desc: string; location: string;
  organizer: string; attendee: string; attendeeName: string; method: "REQUEST" | "CANCEL";
}): string {
  const clean = (s: string) => String(s ?? "").replace(/([,;\\])/g, "\\$1").replace(/\r?\n/g, "\\n");
  const cancelled = o.method === "CANCEL";
  return [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Paige Agent AI//Booking//EN", "CALSCALE:GREGORIAN", `METHOD:${o.method}`,
    "BEGIN:VEVENT", `UID:${o.uid}`, `SEQUENCE:${Math.floor(Date.now() / 1000)}`, `DTSTAMP:${icsStamp(Date.now())}`,
    `DTSTART:${icsStamp(o.startMs)}`, `DTEND:${icsStamp(o.endMs)}`,
    `STATUS:${cancelled ? "CANCELLED" : "CONFIRMED"}`,
    `SUMMARY:${clean(o.title)}`, `DESCRIPTION:${clean(o.desc)}`, `LOCATION:${clean(o.location)}`,
    `ORGANIZER;CN=${clean(o.organizer)}:mailto:noreply@paigeagent.ai`,
    `ATTENDEE;CN=${clean(o.attendeeName)};RSVP=TRUE:mailto:${o.attendee}`,
    "END:VEVENT", "END:VCALENDAR",
  ].join("\r\n");
}
async function sendEmail(to: string, subject: string, html: string, ics?: { name: string; content: string }, opts?: { from?: string; replyTo?: string }): Promise<boolean> {
  if (!RESEND_KEY) return false;
  const body: Record<string, unknown> = { from: opts?.from || EMAIL_FROM, to: [to], subject, html };
  if (opts?.replyTo) body.reply_to = opts.replyTo;
  if (ics) body.attachments = [{ filename: ics.name, content: b64utf8(ics.content) }];
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return res.ok;
  } catch { return false; }
}
function shell(accent: string, inner: string): string {
  return `<!doctype html><html><body style="margin:0;background:#f4f5f7;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:28px 0;"><tr><td align="center">
    <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;background:#fff;border:1px solid #e7e8ec;border-radius:14px;overflow:hidden;">
      <tr><td style="height:5px;background:${esc(accent)};"></td></tr>
      ${inner}
    </table></td></tr></table></body></html>`;
}
function detailRows(rows: { label: string; value: string; bold?: boolean }[]): string {
  return rows.map((r) =>
    `<tr><td style="padding:6px 0;color:#98a0ae;width:88px;">${esc(r.label)}</td><td style="padding:6px 0;${r.bold ? "font-weight:600;" : ""}">${esc(r.value)}</td></tr>`
  ).join("");
}
function guestRescheduledHtml(brandName: string, accent: string, title: string, whenLabel: string, location: string, host: string | null, manageLink: string): string {
  return shell(accent, `
    <tr><td style="padding:28px 32px 8px;">
      <div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#98a0ae;font-weight:bold;">${esc(brandName)}</div>
      <h1 style="color:#101828;font-size:20px;margin:10px 0 4px;">Your time's been moved</h1>
      <p style="color:#667085;font-size:14px;margin:0 0 18px;">Here's the new time. An updated invite is attached.</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;color:#101828;">
        ${detailRows([
          { label: "Session", value: title, bold: true },
          { label: "New time", value: whenLabel, bold: true },
          { label: "Where", value: location },
          ...(host ? [{ label: "With", value: host }] : []),
        ])}
      </table>
    </td></tr>
    <tr><td style="padding:18px 32px 26px;border-top:1px solid #eef0f3;">
      <p style="color:#667085;font-size:13px;margin:0 0 4px;">Need another change? <a href="${esc(manageLink)}" style="color:#7A67E8;font-weight:600;text-decoration:none;">Reschedule or cancel</a>.</p>
      <p style="color:#98a0ae;font-size:12px;margin:0;">Or just reply to this email.</p>
    </td></tr>`);
}
function guestCancelledHtml(brandName: string, accent: string, title: string, whenLabel: string): string {
  return shell(accent, `
    <tr><td style="padding:28px 32px 26px;">
      <div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#98a0ae;font-weight:bold;">${esc(brandName)}</div>
      <h1 style="color:#101828;font-size:20px;margin:10px 0 4px;">Your booking's cancelled</h1>
      <p style="color:#667085;font-size:14px;margin:0 0 18px;">This time is no longer held. The calendar invite has been withdrawn.</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;color:#101828;">
        ${detailRows([
          { label: "Session", value: title, bold: true },
          { label: "Was", value: whenLabel },
        ])}
      </table>
      <p style="color:#98a0ae;font-size:12px;margin:18px 0 0;">Changed your mind? Just reply and we'll help you find a new time.</p>
    </td></tr>`);
}
function hostAlertHtml(accent: string, heading: string, title: string, whenLabel: string, guestName: string, guestEmail: string, extra: { label: string; value: string }[]): string {
  return shell(accent, `
    <tr><td style="padding:28px 32px;">
      <h1 style="color:#101828;font-size:19px;margin:0 0 14px;">${esc(heading)}</h1>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;color:#101828;">
        ${detailRows([
          { label: "Session", value: title, bold: true },
          ...extra,
          { label: "Guest", value: `${guestName} <${guestEmail}>` },
        ])}
      </table>
    </td></tr>`);
}

// Comma-joined display names for a host roster — so the guest response / email names
// who they're meeting. Uses the profile `full_name` ONLY; a host with no display name
// is OMITTED, never identified by their auth email: this string is returned to an
// external manage-link holder (the `manage` details response + the reschedule/cancel
// emails), so leaking a staff email here is an anon PII disclosure (E6 §39 MED-2 sibling
// of the public-booking fix, 2026-09-13). The separate resolveHostEmails() below still
// fetches host emails as SEND recipients (staff-facing) — that is not a leak.
async function resolveHostNames(admin: ReturnType<typeof createClient>, hostIds: string[]): Promise<string | null> {
  if (!hostIds.length) return null;
  const { data: profs } = await admin.from("profiles").select("user_id, full_name").in("user_id", hostIds);
  const nameByUid = new Map((profs ?? []).map((p) => [p.user_id as string, p.full_name as string | null]));
  const names = hostIds
    .map((uid) => nameByUid.get(uid) || null)
    .filter((n): n is string => !!n);
  return names.length ? names.join(", ") : null;
}
async function resolveHostEmails(admin: ReturnType<typeof createClient>, hostIds: string[]): Promise<string[]> {
  const out = await Promise.all(hostIds.map(async (uid) => {
    const { data: u } = await admin.auth.admin.getUserById(uid);
    return (u as { user?: { email?: string } } | null)?.user?.email ?? null;
  }));
  return out.filter((e): e is string => !!e);
}

/** Each host's primary phone. An unreadable list skips SMS-to-host, loudly — never the change. */
async function resolveHostPhones(admin: ReturnType<typeof createClient>, hostIds: string[]): Promise<string[]> {
  if (!hostIds.length) return [];
  try {
    const phones = await primaryPhonesForUsers(admin, hostIds);
    return hostIds.map((uid) => phones.get(uid) ?? "").filter(Boolean);
  } catch (e) {
    console.error("[booking-manage] host_phone_read_failed", (e as Error).message);
    return [];
  }
}

/** Best-effort Zoom sync on reschedule/cancel. The meeting lives on ONE host
 *  (the primary, for a collective booking); a non-owner host's token 404s and
 *  no-ops inside the helpers, so trying every attending host is safe and needs
 *  no stored owner. Never throws — a Zoom hiccup must not fail a change that's
 *  already committed (§13); the failure is logged, not swallowed. */
async function syncZoom(
  admin: ReturnType<typeof createClient>,
  action: "update" | "delete",
  hostIds: string[],
  meetingId: string | null,
  opts?: { topic?: string; startISO?: string; durationMin?: number; timezone?: string },
): Promise<void> {
  if (!meetingId) return;
  for (const uid of hostIds) {
    try {
      if (action === "delete") await deleteZoomMeeting(admin, uid, meetingId);
      else await updateZoomMeeting(admin, uid, meetingId, opts ?? {});
    } catch (e) {
      console.error("booking-manage: zoom sync failed", { action, host: uid, meetingId, err: (e as Error)?.message });
    }
  }
}

interface BookingCtx {
  id: string; tenant_id: string | null; host_user_id: string; guest_name: string | null;
  guest_email: string | null; guest_phone: string | null; timezone: string | null; location_type: string | null;
  location_value: string | null; collective_group_id: string | null;
}
interface CalCtx { title: string | null; description: string | null; accent: string | null }

/** Best-effort guest + host notifications on a successful cancel / reschedule.
 *  Never throws — a mail hiccup must not fail a change that's already committed
 *  (§13: report what actually happened; the failure is logged, not swallowed). */
async function notifyChange(
  admin: ReturnType<typeof createClient>,
  kind: "reschedule" | "cancel",
  b: BookingCtx,
  cal: CalCtx | null,
  apptName: string | null,
  durationMin: number,
  startMs: number,
  ver: number,
  hostIdsOverride?: string[],
  lifecycle: Lifecycle[] = [],
): Promise<void> {
  try {
    const tz = b.timezone || "America/New_York";
    const endMs = startMs + durationMin * 60000;
    const accent = cal?.accent || "#EBB94C";
    const title = apptName || cal?.title || "Your session";
    // For a Zoom booking the live join URL is persisted on location_value at
    // create time and preserved across reschedule (same meeting id) — use it
    // directly instead of "link to follow", which would be misleading here since
    // no further link is coming (§13 truthful). Mirrors the create path.
    const loc = (b.location_type === "zoom" && /^https?:\/\//.test(b.location_value ?? ""))
      ? (b.location_value as string)
      : locationLabel(b.location_type || "", b.location_value ?? null);

    // Brand + tenant sending identity (§6/§9): the guest is the tenant's client,
    // so their email wears the tenant's own verified sender; host alerts stay on
    // the platform address (staff-facing).
    let brandName = "Paige Agent AI";
    let guestSender: { from?: string; replyTo?: string } | undefined;
    let guestSenderAccount = "platform";
    if (b.tenant_id) {
      const { data: t } = await admin.from("tenants").select("name, brand").eq("id", b.tenant_id).maybeSingle();
      const brand = (t?.brand ?? {}) as Record<string, string>;
      brandName = brand.brand_name ?? brand.display_name ?? brand.name ?? (t?.name as string | undefined) ?? brandName;
      try {
        const { data: ident } = await admin.rpc("tenant_sender_identity", { _tenant_id: b.tenant_id });
        const fromAddr = (ident as { from_address?: string } | null)?.from_address;
        const fromName = (ident as { from_name?: string } | null)?.from_name || brandName;
        if (fromAddr) {
          const cleanName = String(fromName).replace(/[<>",\r\n]/g, " ").replace(/\s+/g, " ").trim();
          guestSender = {
            from: cleanName ? `${cleanName} <${fromAddr}>` : fromAddr,
            replyTo: (ident as { reply_to?: string } | null)?.reply_to || undefined,
          };
          guestSenderAccount = "tenant";
        }
      } catch { /* keep platform fallback */ }
    }

    const whenLabel = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, weekday: "long", month: "long", day: "numeric", year: "numeric",
      hour: "numeric", minute: "2-digit", timeZoneName: "short",
    }).format(new Date(startMs));

    // Who's attending (for the guest's "With" line + host alerts). On cancel the
    // caller passes a roster snapshot taken BEFORE the legs were cancelled —
    // re-querying non-cancelled siblings here would return none and drop every
    // host but one (§13: "everyone was notified" must be true).
    const hostIds = hostIdsOverride?.length
      ? hostIdsOverride
      : b.collective_group_id
        ? await (async () => {
            const { data: sibs } = await admin.from("internal_bookings")
              .select("host_user_id").eq("collective_group_id", b.collective_group_id).neq("status", "cancelled");
            const ids = Array.from(new Set((sibs ?? []).map((s) => s.host_user_id as string)));
            return ids.length ? ids : [b.host_user_id];
          })()
        : [b.host_user_id];
    const withNames = hostIds.length > 1 ? await resolveHostNames(admin, hostIds) : null;

    const guestEmail = b.guest_email;
    const guestName = b.guest_name || "there";
    const results: { template: string; recipient: string; ok: boolean; account: string }[] = [];

    if (kind === "reschedule") {
      const ics = buildIcs({
        uid: `${b.id}@paigeagent.ai`, startMs, endMs, title, desc: cal?.description || "",
        location: loc, organizer: brandName, attendee: guestEmail || "", attendeeName: guestName, method: "REQUEST",
      });
      const mUrl = await manageUrl(b.id, ver);
      if (guestEmail) {
        const ok = await sendEmail(guestEmail, `Updated: ${title} · ${whenLabel}`,
          guestRescheduledHtml(brandName, accent, title, whenLabel, loc, withNames, mUrl),
          { name: "invite.ics", content: ics }, guestSender);
        results.push({ template: "booking_rescheduled_guest", recipient: guestEmail, ok, account: guestSenderAccount });
      }
      for (const hEmail of await resolveHostEmails(admin, hostIds)) {
        const ok = await sendEmail(hEmail, `Rescheduled: ${guestName} · ${whenLabel}`,
          hostAlertHtml(accent, "Booking rescheduled", title,
            whenLabel, guestName, guestEmail || "—", [{ label: "New time", value: whenLabel }]),
          { name: "invite.ics", content: ics });
        results.push({ template: "booking_rescheduled_host", recipient: hEmail, ok, account: "platform" });
      }
    } else {
      const ics = buildIcs({
        uid: `${b.id}@paigeagent.ai`, startMs, endMs, title, desc: cal?.description || "",
        location: loc, organizer: brandName, attendee: guestEmail || "", attendeeName: guestName, method: "CANCEL",
      });
      if (guestEmail) {
        const ok = await sendEmail(guestEmail, `Cancelled: ${title} · ${whenLabel}`,
          guestCancelledHtml(brandName, accent, title, whenLabel),
          { name: "invite.ics", content: ics }, guestSender);
        results.push({ template: "booking_cancelled_guest", recipient: guestEmail, ok, account: guestSenderAccount });
      }
      for (const hEmail of await resolveHostEmails(admin, hostIds)) {
        const ok = await sendEmail(hEmail, `Cancelled: ${guestName} · ${whenLabel}`,
          hostAlertHtml(accent, "Booking cancelled", title,
            whenLabel, guestName, guestEmail || "—", [{ label: "Was", value: whenLabel }]),
          { name: "invite.ics", content: ics });
        results.push({ template: "booking_cancelled_host", recipient: hEmail, ok, account: "platform" });
      }
    }

    await admin.from("email_send_log").insert(
      results.map((r) => ({
        template_name: r.template, recipient_email: r.recipient,
        status: r.ok ? "sent" : "skipped", sender_account: r.account,
        metadata: { via: "booking-manage", action: kind, booking_id: b.id },
      })),
    ).then(() => {}, () => {});

    // Opt-in lifecycle triggers (§8): fire any owner-authored on-cancelled /
    // on-rescheduled message beyond the built-in emails above. Only runs when
    // the tenant added a matching entry to notify_config.lifecycle. Each send is
    // claimed in booking_notifications_sent (same ledger the scheduled worker
    // uses), keyed per event/target/channel/recipient — plus the new start time
    // for reschedules, so a SECOND reschedule re-fires while a double-call of the
    // same one can't double-send.
    const event = kind === "cancel" ? "cancelled" : "rescheduled";
    const steps = lifecycle.filter((l) => l.event === event);
    if (steps.length) {
      const vars: Record<string, string> = {
        guest_name: b.guest_name || "there", when: whenLabel, where: loc, title, service: title,
      };
      const mUrl = await manageUrl(b.id, ver);
      const hostEmails = steps.some((l) => l.to !== "guest") ? await resolveHostEmails(admin, hostIds) : [];
      const hostPhones = steps.some((l) => l.to !== "guest") ? await resolveHostPhones(admin, hostIds) : [];
      const timeKey = event === "rescheduled" ? `:${startMs}` : "";
      const claimLc = async (key: string, rec: string) => {
        const { error } = await admin.from("booking_notifications_sent")
          .insert({ booking_id: b.id, notif_key: key, recipient_email: rec || null, status: "sending" });
        return !error;
      };
      const finishLc = async (key: string, ok: boolean) => {
        if (ok) await admin.from("booking_notifications_sent").update({ status: "sent" }).eq("booking_id", b.id).eq("notif_key", key);
        else await admin.from("booking_notifications_sent").delete().eq("booking_id", b.id).eq("notif_key", key);
      };
      // Cancelled links are dead (version bumped) — no manage link on those.
      const lcLink = event === "cancelled" ? undefined : mUrl;
      for (const lc of steps) {
        for (const who of targetsOf(lc.to)) {
          for (const ch of channelsOf(lc.channel)) {
            const recipients = ch === "email"
              ? (who === "guest" ? (guestEmail ? [guestEmail] : []) : hostEmails)
              : (who === "guest" ? (b.guest_phone ? [b.guest_phone] : []) : hostPhones);
            for (const rec of recipients) {
              const key = `lc:${event}:${who}:${ch}:${rec}${timeKey}`;
              if (!(await claimLc(key, rec))) continue;
              let ok = false;
              if (ch === "email") {
                const heading = event === "cancelled" ? "Your booking's cancelled" : "Your time's been moved";
                const subject = lc.subject
                  ? renderTemplate(lc.subject, vars)
                  : `${event === "cancelled" ? "Cancelled" : "Updated"}: ${title} · ${whenLabel}`;
                const bodyText = lc.body
                  ? renderTemplate(lc.body, vars)
                  : (event === "cancelled"
                      ? `Your booking for ${title} on ${whenLabel} is cancelled.`
                      : `Your ${title} is now on ${whenLabel}. ${loc}.`);
                ok = await sendEmail(rec, subject, lifecycleEmailHtml(brandName, accent, heading, bodyText, lcLink),
                  undefined, who === "guest" ? guestSender : undefined);
              } else {
                const line = lc.body
                  ? renderTemplate(lc.body, vars)
                  : (event === "cancelled"
                      ? `Cancelled: ${title} on ${whenLabel}.`
                      : `Updated: ${title} is now ${whenLabel}. ${loc}.`);
                ok = await sendSms(rec, lcLink ? `${line}\nReschedule or cancel: ${lcLink}` : line);
              }
              await finishLc(key, ok);
            }
          }
        }
      }
    }
  } catch (e) {
    // Best-effort: the change is already committed. Log (visible in edge logs)
    // rather than swallow — silent catches have hidden real bugs on this path.
    console.error("booking-manage: notify tail failed", {
      bookingId: b.id, action: kind, err: (e as Error)?.message, stack: (e as Error)?.stack,
    });
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    if (!SECRET) return json({ error: "server not configured" }, 500);
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    // Per-IP throttle first — bounds invalid-token brute-forcing (checked before
    // the token is even verified) and any per-IP replay flood.
    const ip = clientIp(req);
    if (await overRateLimit(admin, `bm:ip:${ip}`, RL_MANAGE_PER_IP)) {
      return json({ error: TOO_MANY }, 429);
    }
    const body = await req.json().catch(() => ({}));
    const action = body?.action;
    const tok = await verifyToken(String(body?.token ?? ""));
    if (!tok.ok) {
      // Distinct 401 for an expired link so the client can offer "get a fresh one".
      if (tok.reason === "expired") return json({ error: "This link has expired. Ask the sender for a fresh one.", code: "expired" }, 401);
      return json({ error: "This link is invalid or has expired." }, 401);
    }
    const bookingId = tok.bookingId;
    // Per-token throttle — bounds replay of one valid (possibly leaked) link
    // across view/reschedule/cancel, independent of source IP.
    if (await overRateLimit(admin, `bm:tok:${bookingId}`, RL_MANAGE_PER_TOKEN)) {
      return json({ error: TOO_MANY }, 429);
    }

    const { data: b } = await admin.from("internal_bookings")
      .select("id, tenant_id, calendar_id, host_user_id, guest_name, guest_email, guest_phone, title, start_at, end_at, timezone, status, location_type, location_value, booking_kind, collective_group_id, appointment_type, manage_token_version, zoom_meeting_id")
      .eq("id", bookingId).maybeSingle();
    if (!b) return json({ error: "Booking not found." }, 404);

    // Revocation check: a version-stamped token must match the booking's current
    // manage_token_version. Cancelling bumps it, killing the old link. Legacy
    // tokens (no ver) predate revocation and skip this — the status gate governs.
    const currentVer = (b.manage_token_version as number | null) ?? 0;
    if (tok.ver !== null && tok.ver !== currentVer) {
      return json({ error: "This link is no longer valid. Ask the sender for a fresh one.", code: "revoked" }, 401);
    }

    // Calendar backs slug/availability/branding for the manage view + reschedule.
    let slug: string | null = null, avail: DayWindow[] = [], minNotice = 60, cal: Record<string, unknown> | null = null;
    let bufferBeforeMin = 0, bufferAfterMin = 0, horizonDays = 60, dateOverrides: DateOverride[] = [], calTimezone: string | null = null;
    let calDurationMin = 30;
    if (b.calendar_id) {
      const { data: c } = await admin.from("calendars")
        .select("slug, availability_json, duration_min, buffer_before_min, buffer_after_min, min_notice_min, booking_horizon_days, date_overrides, timezone, title, description, accent, theme, notify_config")
        .eq("id", b.calendar_id).maybeSingle();
      if (c) {
        cal = c; slug = c.slug as string;
        avail = Array.isArray(c.availability_json) ? (c.availability_json as DayWindow[]) : [];
        calDurationMin = Math.max(5, (c.duration_min as number) ?? 30);
        minNotice = Math.max(0, (c.min_notice_min as number) ?? 60);
        bufferBeforeMin = Math.max(0, (c.buffer_before_min as number) ?? 0);
        bufferAfterMin = Math.max(0, (c.buffer_after_min as number) ?? 0);
        horizonDays = Math.max(1, (c.booking_horizon_days as number) ?? 60);
        dateOverrides = Array.isArray(c.date_overrides) ? (c.date_overrides as DateOverride[]) : [];
        calTimezone = (c.timezone as string) || null;
      }
    }

    // Per-host hours/timezone for the roster (NULL → inherit the calendar's). The
    // reschedule gate validates the new time against the RIGHT host's OWN windows,
    // parity with the create engine's per-host slot rules — a booked slot can't
    // violate the chosen host's real hours on either path. Only availability +
    // timezone are per-host; duration/buffers/notice/horizon/date-overrides stay
    // calendar-level.
    const hostAvailMap: Record<string, { availability: DayWindow[] | null; timezone: string | null }> = {};
    if (b.calendar_id) {
      const { data: chosts } = await admin.from("calendar_hosts")
        .select("user_id, availability_json, timezone").eq("calendar_id", b.calendar_id);
      for (const hr of chosts ?? []) {
        const raw = hr.availability_json;
        // Element-validate (parity with public-booking.parseHostAvailability): a
        // malformed window — e.g. a Paige/§10-authored write — must not flow
        // unfiltered into isValidSlotStart. NULL/non-array → inherit (null).
        const availability = Array.isArray(raw)
          ? (raw as unknown[]).filter(
              (w): w is DayWindow =>
                !!w && typeof w === "object" &&
                typeof (w as DayWindow).day === "number" &&
                /^\d{2}:\d{2}$/.test((w as DayWindow).start ?? "") &&
                /^\d{2}:\d{2}$/.test((w as DayWindow).end ?? ""),
            )
          : null;
        hostAvailMap[hr.user_id as string] = {
          availability,
          timezone: (typeof hr.timezone === "string" && hr.timezone.trim()) ? (hr.timezone as string) : null,
        };
      }
    }

    // Effective duration: the length the booking was actually made at. A booking
    // placed off an appointment-type ("service menu") stores that type's
    // duration on the row — the calendar default is the WRONG length for it, and
    // using it would move the booking to a mismatched end time and mis-validate
    // the reschedule slot. Prefer the stored type's duration; fall back to the
    // calendar default only when no type was chosen.
    const apptType = b.appointment_type as { id?: string; name?: string; duration_min?: number } | null;
    const storedDur = Number(apptType?.duration_min);
    const durationMin = Math.max(5, Number.isFinite(storedDur) && storedDur > 0 ? storedDur : calDurationMin);
    const apptName = (apptType?.name && String(apptType.name).trim()) || null;

    if (action === "manage") {
      // Collective only: tell the guest who they're actually meeting with —
      // every row in the group is a symmetric leg for one attending host.
      let withNames: string | null = null;
      if (b.collective_group_id) {
        const { data: siblings } = await admin.from("internal_bookings")
          .select("host_user_id").eq("collective_group_id", b.collective_group_id).neq("status", "cancelled");
        const hostIds = Array.from(new Set((siblings ?? []).map((s) => s.host_user_id as string)));
        if (hostIds.length > 1) withNames = await resolveHostNames(admin, hostIds);
      }
      return json({
        booking: {
          id: b.id, title: apptName || (cal?.title as string) || b.title, start_at: b.start_at, status: b.status,
          guest_name: b.guest_name, timezone: b.timezone, slug, accent: (cal?.accent as string) || "#EBB94C",
          theme: (cal?.theme as string) === "dark" ? "dark" : "light",
          durationMin, canModify: b.status === "scheduled",
          ...(withNames ? { with: withNames } : {}),
        },
      });
    }

    if (!(await commsProviderExecutionAllowed(admin, { tenantId: b.tenant_id }))) {
      return json({ ok: false, status: "blocked", code: "COMMS_PROVIDER_EXECUTION_DISABLED" }, 403);
    }
    if (b.status !== "scheduled") return json({ error: "This booking can no longer be changed." }, 409);

    const bookingCtx: BookingCtx = {
      id: b.id as string, tenant_id: (b.tenant_id as string | null) ?? null, host_user_id: b.host_user_id as string,
      guest_name: (b.guest_name as string | null) ?? null, guest_email: (b.guest_email as string | null) ?? null,
      guest_phone: (b.guest_phone as string | null) ?? null,
      timezone: (b.timezone as string | null) ?? null, location_type: (b.location_type as string | null) ?? null,
      location_value: (b.location_value as string | null) ?? null, collective_group_id: (b.collective_group_id as string | null) ?? null,
    };
    const calCtx: CalCtx | null = cal
      ? { title: (cal.title as string | null) ?? null, description: (cal.description as string | null) ?? null, accent: (cal.accent as string | null) ?? null }
      : null;
    // Opt-in owner-authored on-cancelled / on-rescheduled messages (§8).
    const calLifecycle = parseLifecycle(cal?.notify_config);

    if (action === "cancel") {
      // Snapshot the attending hosts BEFORE cancelling — otherwise notifyChange
      // re-queries non-cancelled siblings and finds none, alerting only one host.
      let cancelHostIds: string[] | undefined;
      if (b.collective_group_id) {
        const { data: sibs } = await admin.from("internal_bookings")
          .select("host_user_id").eq("collective_group_id", b.collective_group_id).neq("status", "cancelled");
        cancelHostIds = Array.from(new Set((sibs ?? []).map((s) => s.host_user_id as string)));
      }
      // Bump manage_token_version so this booking's version-stamped links die
      // (defense in depth alongside the status gate). Collective cancels every
      // symmetric leg — cancelling one row would leave the rest holding hosts'
      // time for a meeting that isn't happening.
      const nextVer = currentVer + 1;
      const patch = { status: "cancelled", manage_token_version: nextVer };
      const { error } = b.collective_group_id
        ? await admin.from("internal_bookings").update(patch).eq("collective_group_id", b.collective_group_id).neq("status", "cancelled")
        : await admin.from("internal_bookings").update(patch).eq("id", b.id);
      if (error) return json({ error: error.message }, 500);
      // Tear down the host's Zoom meeting (best-effort). For collective the
      // snapshot roster covers the primary that owns the meeting.
      await syncZoom(admin, "delete", cancelHostIds ?? [b.host_user_id as string], (b.zoom_meeting_id as string | null) ?? null);
      await notifyChange(admin, "cancel", bookingCtx, calCtx, apptName, durationMin, Date.parse(b.start_at as string), nextVer, cancelHostIds, calLifecycle);
      return json({ ok: true, status: "cancelled" });
    }

    if (action === "reschedule") {
      const newStart = Date.parse(body?.start);
      if (!Number.isFinite(newStart)) return json({ error: "Pick a new time." }, 400);
      const now = Date.now();
      const tz = calTimezone || (b.timezone as string) || "America/New_York";
      // Shared slot rules — the exact validity gate the public engine enforces
      // at create time (weekly windows, date overrides, min-notice, horizon).
      // A stale or hand-crafted `start` can't slip past overrides/horizon here.
      // Per-host window rules: build each gating host's SlotRules from THEIR own
      // hours/timezone (falling back to the calendar's), everything else shared.
      const rulesFor = (uid: string): SlotRules => {
        const ha = hostAvailMap[uid];
        return {
          availability: ha?.availability ?? avail,
          durationMin, minNoticeMin: minNotice, horizonDays, dateOverrides,
          timezone: ha?.timezone ?? tz, bufferBeforeMin, bufferAfterMin,
        };
      };
      // Base rules still drive the buffer-aware isFree conflict checks below —
      // isFree reads only duration + buffers, so per-host availability is moot there.
      const rules: SlotRules = rulesFor(b.host_user_id as string);
      // Hosts whose OWN windows gate this reschedule: collective must be valid for
      // EVERY attending host; single/round-robin/class for the booking's host.
      let gateHostIds: string[] = [b.host_user_id as string];
      if (b.collective_group_id) {
        const { data: gsibs } = await admin.from("internal_bookings")
          .select("host_user_id").eq("collective_group_id", b.collective_group_id).neq("status", "cancelled");
        const ids = Array.from(new Set((gsibs ?? []).map((s) => s.host_user_id as string)));
        if (ids.length) gateHostIds = ids;
      }
      if (!gateHostIds.every((uid) => isValidSlotStart(rulesFor(uid), newStart, now))) {
        return json({ error: "That time isn't open. Please pick another." }, 409);
      }
      const newEnd = newStart + durationMin * 60000;

      // Class: the host is SUPPOSED to be busy with other guests' seats at an
      // existing session, so the single-host "is free" check below is the
      // wrong tool entirely — this needs the same lock/find-or-create/count
      // shape create_class_booking uses, ending in a move instead of an insert.
      if (b.booking_kind === "class_seat") {
        const { data: seat, error } = await admin.rpc("reschedule_class_booking", {
          _seat_id: b.id,
          _new_start_at: new Date(newStart).toISOString(),
          _new_end_at: new Date(newEnd).toISOString(),
        });
        if (error) {
          if ((error as { message?: string }).message === "sold_out")
            return json({ error: "That class is full. Please pick another time." }, 409);
          const code = (error as { code?: string }).code;
          if (code === "23P01" || code === "23505")
            return json({ error: "That time was just taken. Please pick another." }, 409);
          return json({ error: error.message }, 500);
        }
        const startAt = (seat as { start_at: string }).start_at;
        await syncZoom(admin, "update", [b.host_user_id as string], (b.zoom_meeting_id as string | null) ?? null, {
          topic: apptName || (cal?.title as string) || (b.title as string) || "Meeting", startISO: startAt, durationMin, timezone: tz,
        });
        await notifyChange(admin, "reschedule", bookingCtx, calCtx, apptName, durationMin, Date.parse(startAt), currentVer, undefined, calLifecycle);
        return json({ ok: true, status: "scheduled", start_at: startAt });
      }

      // Collective: every attending host must be free at the new time, and
      // every symmetric leg moves together — moving only the token's own row
      // would leave the group split across two different times. Buffer-aware
      // conflict via the shared isFree (parity with the create path).
      if (b.collective_group_id) {
        const { data: siblings } = await admin.from("internal_bookings")
          .select("id, host_user_id").eq("collective_group_id", b.collective_group_id).neq("status", "cancelled");
        const group = siblings?.length ? siblings : [{ id: b.id, host_user_id: b.host_user_id }];
        const groupIds = new Set(group.map((m) => m.id as string));
        for (const member of group) {
          const { data: clash } = await admin.from("internal_bookings")
            .select("id, start_at, end_at").eq("host_user_id", member.host_user_id).neq("status", "cancelled")
            .gte("start_at", new Date(newStart - 86_400_000).toISOString()).lte("start_at", new Date(newStart + 86_400_000).toISOString());
          const busy: Busy[] = (clash ?? [])
            .filter((x) => !groupIds.has(x.id as string))
            .map((x) => ({ start: Date.parse(x.start_at as string), end: Date.parse(x.end_at as string) }));
          if (!isFree(rules, busy, newStart)) return json({ error: "That time was just taken. Please pick another." }, 409);
        }
        const { error } = await admin.from("internal_bookings")
          .update({ start_at: new Date(newStart).toISOString(), end_at: new Date(newEnd).toISOString() })
          .eq("collective_group_id", b.collective_group_id).neq("status", "cancelled");
        if (error) {
          const code = (error as { code?: string }).code;
          if (code === "23505" || code === "23P01") return json({ error: "That time was just taken. Please pick another." }, 409);
          return json({ error: error.message }, 500);
        }
        // Move the ONE Zoom meeting on the primary host (gateHostIds spans the
        // collective roster; only the owner's token matches, others 404 no-op).
        await syncZoom(admin, "update", gateHostIds, (b.zoom_meeting_id as string | null) ?? null, {
          topic: apptName || (cal?.title as string) || (b.title as string) || "Meeting", startISO: new Date(newStart).toISOString(), durationMin, timezone: tz,
        });
        await notifyChange(admin, "reschedule", bookingCtx, calCtx, apptName, durationMin, newStart, currentVer, undefined, calLifecycle);
        return json({ ok: true, status: "scheduled", start_at: new Date(newStart).toISOString() });
      }

      // Single / round-robin. Buffer-aware conflict via the shared isFree
      // (parity with the create path); 23P01 (the GiST exclusion constraint)
      // and 23505 (exact-start clash) both map to a clean 409.
      const { data: clash } = await admin.from("internal_bookings")
        .select("id, start_at, end_at").eq("host_user_id", b.host_user_id).neq("status", "cancelled").neq("id", b.id)
        .gte("start_at", new Date(newStart - 86_400_000).toISOString()).lte("start_at", new Date(newStart + 86_400_000).toISOString());
      const busy: Busy[] = (clash ?? []).map((x) => ({ start: Date.parse(x.start_at as string), end: Date.parse(x.end_at as string) }));
      if (!isFree(rules, busy, newStart)) return json({ error: "That time was just taken. Please pick another." }, 409);

      const { error } = await admin.from("internal_bookings")
        .update({ start_at: new Date(newStart).toISOString(), end_at: new Date(newEnd).toISOString() })
        .eq("id", b.id);
      if (error) {
        const code = (error as { code?: string }).code;
        if (code === "23505" || code === "23P01") return json({ error: "That time was just taken. Please pick another." }, 409);
        return json({ error: error.message }, 500);
      }
      await syncZoom(admin, "update", [b.host_user_id as string], (b.zoom_meeting_id as string | null) ?? null, {
        topic: apptName || (cal?.title as string) || (b.title as string) || "Meeting", startISO: new Date(newStart).toISOString(), durationMin, timezone: tz,
      });
      await notifyChange(admin, "reschedule", bookingCtx, calCtx, apptName, durationMin, newStart, currentVer, undefined, calLifecycle);
      return json({ ok: true, status: "scheduled", start_at: new Date(newStart).toISOString() });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
