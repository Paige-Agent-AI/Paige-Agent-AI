// =============================================================================
// Comms Slice C-2a — the LOCKED pre-send pipeline (steps 1–5 of SEND-MESSAGE-CONTRACT §3)
// =============================================================================
// runPreSend() is the ONE shared pre-send seam every outbound message passes through
// in send-message/index.ts, between the §5 double-submit guard and the provider send.
// It is a PURE DECISION function: it reads compliance state and returns a disposition,
// performing ZERO writes (mirrors twilio.ts — the caller owns the DB/audit row).
//
// DOCTRINE
//  §9  tenantId is passed in ALREADY server-derived + caller-tenant-gated by the fn.
//      This module never reads tenant_id from a body; it uses the resolved value and
//      pins .eq('tenant_id', tenantId) on every tenant-scoped read as defense-in-depth
//      (a spoofed cross-tenant contactId can never match a foreign row).
//  §13 Honesty: a legal gate (suppression/consent) whose DB read ERRORS fails CLOSED to
//      outcome:'error' (do not send) — never a faked pass. Soft checks fail open + log.
//  §37 Additive: the 6-way disposition lives in `outcome`; the fn's wire `status` stays
//      sent|failed. 'proceed' and 'error' are INTERNAL sentinels the caller translates —
//      they are never placed on the wire.
//  §2  Coaching-generic. Zero finance/credit wording in any reason string.
//  §32 Timezone/window logic is headless-smoke-testable via the injectable `now`.
//
// LOCKED ORDER (contract §3): 1 client-DND (block, overridable) → 2 suppression (block) →
// 3 consent (block) → 4 tenant auto-send DND (queue) → 5 TCPA quiet-hours SMS-only (queue).
// Blocks short-circuit; queues 4 & 5 both evaluate → more-restrictive-wins (max clear).
// `scheduled_for` (C-1.5) is a SEPARATE queue flavor handled at the seam BEFORE this runs
// and re-runs this pipeline on drain re-entry — it is intentionally not known here (§18).
// =============================================================================

import type { SupabaseAdminLike } from "./twilio.ts";
import type { ChannelType } from "./channel-adapters.ts";

// --- Tunable compliance constants (named so they are auditable / adjustable) ---
const QUIET_HOURS_START = "20:00"; // TCPA quiet window begins (local, 8pm)
const QUIET_HOURS_END = "08:00"; // TCPA quiet window ends (local, 8am)
// Conservative default when a recipient's IANA tz is unknown: Eastern reaches the
// 20:00 boundary first, so an unknown-tz recipient is the earliest-protected. A
// follow-up (area-code inference / timezone_verified) can tighten this.
const DEFAULT_QUIET_HOURS_TZ = "America/New_York";

// D-1 LIVE-SAFETY GATE (owner/compliance decision, see PR + SEND-MESSAGE-CONTRACT §3):
// Consent is default-deny per the LOCKED contract, but paige_consent_events is brand-new
// and EMPTY. Enforcing default-deny for EMAIL today would block 100% of existing email
// (no `granted` rows seeded yet). So enforcement is scoped to the channels listed here.
// SMS ONLY for now: TCPA legally requires PRIOR EXPRESS consent for SMS, and SMS is a
// net-new channel with zero existing volume — so default-deny is both safe AND legally
// correct there. EMAIL keeps its current behavior (NO regression) until the owner makes
// the compliance call to seed email consent (a prior-relationship backfill) and adds
// "email" here — a reversible one-line flip. Suppression (STOP/unsub/bounce/complaint,
// step 2) STILL applies to email; only the default-deny *consent* gate is SMS-scoped.
const CONSENT_ENFORCED_CHANNELS: ChannelType[] = ["sms"];

export type PreSendOutcome =
  | "proceed" // internal: fall through to the provider send (never on the wire)
  | "blocked_client_dnd"
  | "blocked_suppressed"
  | "blocked_no_consent"
  | "queued_tenant_dnd"
  | "queued_quiet_hours"
  | "error"; // internal: a legal gate could not be verified → caller maps to status:'failed'

export interface PreSendInput {
  tenantId: string | null;
  channel: ChannelType;
  to: string;
  contactId?: string | null;
  overrideClientDnd?: boolean;
  now?: Date;
}

export interface PreSendResult {
  proceed: boolean;
  outcome: PreSendOutcome;
  reason: string | null;
  queueUntil: string | null; // ISO-8601 UTC, set only for queued_*
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// -----------------------------------------------------------------------------
// Address normalization — MUST match what the suppression/consent writers store:
// E.164 for phone, RFC-lowercased + plus-tag-folded for email (migration §5/§6).
// -----------------------------------------------------------------------------
export function normalizeEmail(addr: string): string {
  const lower = (addr ?? "").trim().toLowerCase();
  const at = lower.lastIndexOf("@");
  if (at <= 0) return lower;
  const local = lower.slice(0, at);
  const domain = lower.slice(at + 1);
  const bareLocal = local.split("+")[0]; // fold +tag; do NOT dot-fold (writer doesn't)
  return `${bareLocal}@${domain}`;
}

export function normalizePhone(to: string): string {
  const raw = (to ?? "").trim();
  if (raw.startsWith("+")) return "+" + raw.slice(1).replace(/\D/g, "");
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return "+1" + digits; // bare US 10-digit
  if (digits.length === 11 && digits.startsWith("1")) return "+" + digits;
  return "+" + digits; // best effort; already-normalized callers pass E.164
}

export function normalizeAddress(channel: ChannelType, to: string): string {
  return channel === "sms" ? normalizePhone(to) : normalizeEmail(to);
}

// -----------------------------------------------------------------------------
// Timezone math (Intl only — no moment.js). All helpers are pure + deterministic.
// -----------------------------------------------------------------------------
interface WallParts { y: number; mo: number; d: number; h: number; mi: number; }

function partsInTz(instant: Date, tz: string): WallParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const map: Record<string, string> = {};
  for (const p of fmt.formatToParts(instant)) {
    if (p.type !== "literal") map[p.type] = p.value;
  }
  return {
    y: Number(map.year),
    mo: Number(map.month),
    d: Number(map.day),
    h: Number(map.hour),
    mi: Number(map.minute),
  };
}

/** Offset (localWall − UTC) in ms at a given instant, for a zone. */
function tzOffsetMs(utcMs: number, tz: string): number {
  const p = partsInTz(new Date(utcMs), tz);
  const asUtc = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, 0);
  return asUtc - utcMs;
}

/** The UTC ms for a desired LOCAL wall time in a zone (DST-correct via one refine). */
function makeZonedUtc(y: number, mo: number, d: number, h: number, mi: number, tz: string): number {
  const guess = Date.UTC(y, mo - 1, d, h, mi, 0);
  const off1 = tzOffsetMs(guess, tz);
  let utc = guess - off1;
  const off2 = tzOffsetMs(utc, tz);
  if (off2 !== off1) utc = guess - off2;
  return utc;
}

function parseHm(hm: string): { h: number; mi: number } {
  const [h, mi] = hm.split(":");
  return { h: Number(h), mi: Number(mi ?? 0) };
}

/** Is `now` inside [startHM, endHM) in `tz`? Handles midnight-crossing windows. */
function inWindow(now: Date, tz: string, startHM: string, endHM: string): boolean {
  const p = partsInTz(now, tz);
  const t = p.h * 60 + p.mi;
  const s = parseHm(startHM);
  const e = parseHm(endHM);
  const start = s.h * 60 + s.mi;
  const end = e.h * 60 + e.mi;
  if (start === end) return false; // zero-width
  if (start < end) return t >= start && t < end;
  return t >= start || t < end; // wraps midnight (e.g. 20:00 → 08:00)
}

/** Next LOCAL occurrence of boundary HM after `now`, as a UTC ISO string. */
function nextLocalBoundaryUtc(now: Date, tz: string, boundaryHM: string): string {
  const b = parseHm(boundaryHM);
  const p = partsInTz(now, tz);
  let candidate = makeZonedUtc(p.y, p.mo, p.d, b.h, b.mi, tz);
  if (candidate <= now.getTime()) {
    // Advance one LOCAL day: add 24h to a local-noon instant (noon dodges DST edges),
    // then rebuild the boundary on the resulting local date.
    const noonNext = new Date(makeZonedUtc(p.y, p.mo, p.d, 12, 0, tz) + 24 * 3600 * 1000);
    const np = partsInTz(noonNext, tz);
    candidate = makeZonedUtc(np.y, np.mo, np.d, b.h, b.mi, tz);
  }
  return new Date(candidate).toISOString();
}

/** Validate a tz string; fall back to the conservative default (loud, never silent). */
function safeTz(tz: string | null | undefined): string {
  const candidate = (tz ?? "").trim();
  if (!candidate) return DEFAULT_QUIET_HOURS_TZ;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidate });
    return candidate;
  } catch {
    console.warn(`[pre-send] invalid timezone '${candidate}', falling back to ${DEFAULT_QUIET_HOURS_TZ}`);
    return DEFAULT_QUIET_HOURS_TZ;
  }
}

// -----------------------------------------------------------------------------
// Human-readable reason strings — jargon-free (§3/§11), no table/enum leakage.
// -----------------------------------------------------------------------------
function suppressionReason(code: string | null | undefined): string {
  switch (code) {
    case "user_stop": return "This contact replied STOP and can't be messaged.";
    case "unsubscribe_link": return "This contact unsubscribed and can't be messaged.";
    case "complaint": return "This contact reported a previous message, so we won't message them.";
    case "bounce_hard": return "This address is undeliverable, so we won't retry it.";
    case "manual": return "This contact is on the do-not-message list.";
    default: return "This contact is on the do-not-message list.";
  }
}

// -----------------------------------------------------------------------------
// The pipeline.
// -----------------------------------------------------------------------------
export async function runPreSend(
  admin: SupabaseAdminLike,
  input: PreSendInput,
): Promise<PreSendResult> {
  const now = input.now ?? new Date();
  const { tenantId, channel, to, contactId = null, overrideClientDnd = false } = input;

  const pass: PreSendResult = { proceed: true, outcome: "proceed", reason: null, queueUntil: null };

  // Platform-owner / context-free send (send-message L209 keeps tenantId null only for the
  // owner). Every step here is tenant-scoped, so there is nothing to check — proceed. The
  // +1 470 super-admin master path is not a tenant→client send.
  if (!tenantId) return { ...pass, reason: "platform_owner_context" };

  const cid = contactId && UUID_RE.test(contactId) ? contactId : null;
  const normalized = normalizeAddress(channel, to);

  // --- One up-front read of the client row (DND fields + timezone) — powers 1 & 5. ---
  let clientDndActive = false;
  let clientDndUntil: string | null = null;
  let clientDndReason: string | null = null;
  let clientTz: string | null = null;
  if (cid) {
    const { data: client, error } = await admin
      .from("clients")
      .select("dnd_active, dnd_until, dnd_reason, timezone")
      .eq("id", cid)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (error) {
      // Soft hold: a client-row read fault must not wedge all sends — fail open, log.
      console.warn(`[pre-send] client read failed (step1/5 soft): ${String(error.message ?? error)}`);
    } else if (client) {
      clientDndActive = client.dnd_active === true;
      clientDndUntil = client.dnd_until ?? null;
      clientDndReason = client.dnd_reason ?? null;
      clientTz = client.timezone ?? null;
    }
  }

  // ─── STEP 1 — Client DND (block, overridable) ──────────────────────────────
  if (cid && clientDndActive) {
    const holdLive = !clientDndUntil || new Date(clientDndUntil).getTime() > now.getTime();
    if (holdLive && overrideClientDnd !== true) {
      return {
        proceed: false,
        outcome: "blocked_client_dnd",
        reason: clientDndReason || "This contact is on a do-not-disturb hold.",
        queueUntil: null,
      };
    }
  }

  // ─── STEP 2 — Suppression (block, NOT overridable) — applies to EVERY channel ──
  {
    let q = admin
      .from("paige_suppressions")
      .select("id, reason")
      .eq("tenant_id", tenantId)
      .eq("channel", channel);
    q = cid
      ? q.or(`contact_id.eq.${cid},address_normalized.eq.${normalized}`)
      : q.eq("address_normalized", normalized);
    const { data, error } = await q.limit(1);
    if (error) {
      // Legal gate — a read we can't complete must NOT let a suppressed send through (§13).
      console.error(`[pre-send] suppression check failed — failing closed: ${String(error.message ?? error)}`);
      return {
        proceed: false,
        outcome: "error",
        reason: "Couldn't verify this contact's message preferences, so the send was held.",
        queueUntil: null,
      };
    }
    if (data && data.length > 0) {
      return {
        proceed: false,
        outcome: "blocked_suppressed",
        reason: suppressionReason(data[0].reason),
        queueUntil: null,
      };
    }
  }

  // ─── STEP 3 — Consent (block, NOT overridable, default-deny) — ENFORCED per-channel ──
  // See CONSENT_ENFORCED_CHANNELS (D-1): default-deny consent is enforced only for the
  // listed channels (SMS today). For channels NOT listed (email today), we skip this gate
  // so existing traffic is not blocked by an empty consent ledger. Suppression (step 2)
  // already ran for every channel, so an email STOP/unsub/bounce is still honored.
  if (CONSENT_ENFORCED_CHANNELS.includes(channel)) {
    let q = admin
      .from("paige_consent_events")
      .select("action, created_at")
      .eq("tenant_id", tenantId)
      .eq("channel", channel);
    q = cid
      ? q.or(`contact_id.eq.${cid},address_normalized.eq.${normalized}`)
      : q.eq("address_normalized", normalized);
    const { data, error } = await q.order("created_at", { ascending: false }).limit(1);
    if (error) {
      console.error(`[pre-send] consent check failed — failing closed: ${String(error.message ?? error)}`);
      return {
        proceed: false,
        outcome: "error",
        reason: "Couldn't verify this contact's consent, so the send was held.",
        queueUntil: null,
      };
    }
    const latest = data && data.length > 0 ? data[0] : null;
    if (!latest || latest.action !== "granted") {
      return {
        proceed: false,
        outcome: "blocked_no_consent",
        reason: latest?.action === "revoked"
          ? "This contact opted out of messages on this channel."
          : "No messaging consent on record for this contact.",
        queueUntil: null,
      };
    }
  }

  // ─── STEPS 4 & 5 — queue checks (both evaluated; more-restrictive-wins) ─────
  // We need tenant preferences for step 4 AND for the step-5 tz fallback.
  let prefsTz: string | null = null;
  const queueCandidates: { outcome: "queued_tenant_dnd" | "queued_quiet_hours"; untilMs: number; reason: string }[] = [];

  {
    const { data: prefs, error } = await admin
      .from("tenant_comms_preferences")
      .select("autosend_dnd_enabled, autosend_dnd_start, autosend_dnd_end, autosend_dnd_timezone, autosend_dnd_channels")
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (error) {
      console.warn(`[pre-send] tenant prefs read failed (step4 soft): ${String(error.message ?? error)}`);
    } else if (prefs) {
      prefsTz = prefs.autosend_dnd_timezone ?? null;
      const channels = prefs.autosend_dnd_channels;
      const gated = Array.isArray(channels) && channels.includes(channel);
      if (prefs.autosend_dnd_enabled === true && gated) {
        const tz = safeTz(prefs.autosend_dnd_timezone);
        const start = String(prefs.autosend_dnd_start ?? QUIET_HOURS_START).slice(0, 5); // 'HH:MM' from 'HH:MM:SS'
        const end = String(prefs.autosend_dnd_end ?? QUIET_HOURS_END).slice(0, 5);
        if (inWindow(now, tz, start, end)) {
          const untilIso = nextLocalBoundaryUtc(now, tz, end);
          queueCandidates.push({
            outcome: "queued_tenant_dnd",
            untilMs: new Date(untilIso).getTime(),
            reason: "Held until your team's quiet hours end.",
          });
        }
      }
    }
  }

  // STEP 5 — TCPA quiet-hours, SMS ONLY.
  if (channel === "sms") {
    const tz = safeTz(clientTz ?? prefsTz);
    if (inWindow(now, tz, QUIET_HOURS_START, QUIET_HOURS_END)) {
      const untilIso = nextLocalBoundaryUtc(now, tz, QUIET_HOURS_END);
      queueCandidates.push({
        outcome: "queued_quiet_hours",
        untilMs: new Date(untilIso).getTime(),
        reason: "Held for quiet hours; it'll send in the morning in the contact's local time.",
      });
    }
  }

  if (queueCandidates.length > 0) {
    // more-restrictive-wins: release at the LATER window-clear. Tie → quiet_hours (legal) label.
    let chosen = queueCandidates[0];
    for (const c of queueCandidates) {
      if (c.untilMs > chosen.untilMs) chosen = c;
      else if (c.untilMs === chosen.untilMs && c.outcome === "queued_quiet_hours") chosen = c;
    }
    return {
      proceed: false,
      outcome: chosen.outcome,
      reason: chosen.reason,
      queueUntil: new Date(chosen.untilMs).toISOString(),
    };
  }

  // ─── All clear ─────────────────────────────────────────────────────────────
  return pass;
}
