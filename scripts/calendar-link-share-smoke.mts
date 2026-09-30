// =============================================================================
// E7 — calendar-link sharing adapter: headless adversarial smoke (§32/§39).
//
// Proves the REAL adapter (_shared/calendar-link-tenant-brain.ts) end to end with
// injected fakes for the caller-JWT rpc port, the service-role admin query builder,
// and the send-message fn — no network, no DB. Runs under Node 22:
//   node --experimental-strip-types scripts/calendar-link-share-smoke.mts
//
// The HEADLINE guard (§13): the readback-truth map keys on send-message `outcome`,
// never its wire `status`. A queued/blocked send returns status:"failed" and MUST NOT
// be reported as sent — and MUST NOT be reported as a plain failure either (queued will
// still send). failed/needs_config is never a success. There is no false success.
// =============================================================================
import assert from "node:assert/strict";
import {
  mapSendOutcome,
  verdictFromPreSend,
  prepareCalendarLinkShare,
  sendCalendarLink,
  calendarLinkSocialCopy,
} from "../supabase/functions/_shared/calendar-link-tenant-brain.ts";

const TENANT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_TENANT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CAL = "c1111111-1111-4111-8111-111111111111";
const CONTACT = "d1111111-1111-4111-8111-111111111111";
const SITE = "https://paigeagent.ai";

let passed = 0;
function ok(cond: unknown, msg: string) { assert.ok(cond, msg); passed++; console.log("ok -", msg); }
function eq(a: unknown, b: unknown, msg: string) { assert.deepEqual(a, b, msg); passed++; console.log("ok -", msg); }

// ── Fakes ────────────────────────────────────────────────────────────────────
type RpcResp = { data: unknown; error: { message?: string } | null };
function makeCaller(opts: {
  tenant?: string | null;
  shareable?: { shareable: boolean; reason: string | null; slug: string | null; title: string | null };
  shareableError?: string;
  social?: Array<Record<string, unknown>>;
}) {
  return {
    rpc(name: string, _args?: Record<string, unknown>): Promise<RpcResp> {
      if (name === "current_user_tenant_id") return Promise.resolve({ data: opts.tenant ?? TENANT, error: null });
      if (name === "calendar_link_shareable") {
        if (opts.shareableError) return Promise.resolve({ data: null, error: { message: opts.shareableError } });
        return Promise.resolve({ data: [opts.shareable ?? { shareable: true, reason: null, slug: "cal-live", title: "Live Cal" }], error: null });
      }
      if (name === "social_account_status") return Promise.resolve({ data: opts.social ?? [], error: null });
      return Promise.resolve({ data: null, error: { message: `unexpected rpc ${name}` } });
    },
  };
}

// Minimal chainable service-role admin: resolves per-table configured data at the terminal.
function makeAdmin(tables: Record<string, { data: unknown; error: { message?: string } | null }>) {
  function builder(table: string) {
    const result = tables[table] ?? { data: null, error: null };
    const chain: any = {
      select() { return chain; },
      eq() { return chain; },
      or() { return chain; },
      order() { return chain; },
      // terminals (awaited)
      maybeSingle() { return Promise.resolve(result); },
      limit() { return Promise.resolve(Array.isArray(result.data) ? result : { data: result.data == null ? [] : [result.data], error: result.error }); },
      then(res: (v: any) => unknown) { return Promise.resolve(result).then(res); },
    };
    return chain;
  }
  return { from(table: string) { return builder(table); } } as any;
}

// A clean admin: contact present (email only), no suppression, no consent (SMS blocks), no prefs.
function cleanAdmin(over: Partial<{ email: string | null; phone: string | null; suppress: unknown[]; consent: unknown[] }> = {}) {
  return makeAdmin({
    // A contact's addresses are its contact methods; the share reads the primary of each kind.
    clients: { data: { client_contact_methods: [
      ...((over.email === undefined ? "guest@example.com" : over.email) ? [{ kind: "email", value: over.email === undefined ? "guest@example.com" : over.email, is_primary: true }] : []),
      ...(over.phone ? [{ kind: "phone", value: over.phone, is_primary: true }] : []),
    ], dnd_active: false, dnd_until: null, dnd_reason: null, timezone: null }, error: null },
    paige_suppressions: { data: over.suppress ?? [], error: null },
    paige_consent_events: { data: over.consent ?? [], error: null },
    tenant_comms_preferences: { data: null, error: null },
  });
}

async function main() {
  // ── 1. mapSendOutcome — THE readback trap. ─────────────────────────────────
  eq(mapSendOutcome({ httpOk: true, status: "sent", outcome: "sent", vendor_message_id: "vm_1" }),
     { success: true, outcome: "sent", reason: null, providerMessageId: "vm_1" }, "T1 outcome=sent → success + provider id");
  // queued: send-message returns wire status:"failed" but outcome:queued_* — must be queued, NOT sent, NOT failed.
  eq(mapSendOutcome({ httpOk: true, status: "failed", outcome: "queued_quiet_hours", reason: "quiet hours" }).outcome, "queued", "T2 outcome=queued_quiet_hours → queued (not sent, not failed)");
  ok(mapSendOutcome({ httpOk: true, status: "failed", outcome: "queued_quiet_hours" }).success === false, "T3 queued is NOT success");
  ok(mapSendOutcome({ httpOk: true, status: "sent", outcome: "queued_scheduled" }).outcome === "queued", "T4 scheduled send (even wire status:sent) maps by outcome → queued, not success");
  ok(mapSendOutcome({ httpOk: true, status: "sent", outcome: "queued_scheduled" }).success === false, "T4b queued_scheduled is NOT success even when wire status is 'sent'");
  eq(mapSendOutcome({ httpOk: true, status: "failed", outcome: "blocked_no_consent", reason: "no consent" }).outcome, "refused", "T5 blocked_* → refused");
  eq(mapSendOutcome({ httpOk: true, status: "failed", outcome: "failed", reason: "a2p_not_approved" }), { success: false, outcome: "failed", reason: "a2p_not_approved", providerMessageId: null }, "T6 failed(a2p_not_approved) → failed, never success");
  ok(mapSendOutcome({ httpOk: true, status: "failed", outcome: "failed", reason: "needs_config" }).success === false, "T7 needs_config → not success");
  ok(mapSendOutcome({ httpOk: false, status: "failed" }).outcome === "outcome_unknown", "T8 HTTP not ok → outcome_unknown");
  ok(mapSendOutcome({ httpOk: true, status: "sent" /* no outcome */ }).success === false, "T9 missing outcome → never success");

  // ── 2. verdictFromPreSend — quiet-hours is will_queue, not ineligible. ─────
  eq(verdictFromPreSend("proceed", null).verdict, "can_send", "T10 proceed → can_send");
  eq(verdictFromPreSend("queued_quiet_hours", "held").verdict, "will_queue", "T11 queued_quiet_hours → will_queue (not ineligible)");
  eq(verdictFromPreSend("blocked_suppressed", "stop").verdict, "blocked", "T12 blocked_* → blocked");
  eq(verdictFromPreSend("error", "read failed").verdict, "held", "T13 error → held (fail closed)");

  // ── 3. prepare — shareable, contact with email only. ───────────────────────
  {
    const r = await prepareCalendarLinkShare({
      caller: makeCaller({ shareable: { shareable: true, reason: null, slug: "cal-live", title: "Live Cal" }, social: [{ platform: "instagram", handle: "@acme", status: "connected", selected: true }, { platform: "x", handle: "@old", status: "revoked", selected: false }] }),
      admin: cleanAdmin({ email: "guest@example.com", phone: null }),
      expectedTenantId: TENANT, calendarId: CAL, contactId: CONTACT, publicSiteUrl: SITE,
    }) as any;
    ok(r.ok && r.shareable === true, "T14 prepare: shareable calendar");
    eq(r.calendar.book_url, "https://paigeagent.ai/book/cal-live", "T15 prepare: book_url composed from slug");
    eq(r.channels.email.verdict, "can_send", "T16 prepare: email on file + clear → can_send");
    eq(r.channels.sms.verdict, "ineligible", "T17 prepare: no phone → sms ineligible");
    ok(r.copy_ready && typeof r.copy_ready.text === "string" && r.copy_ready.text.includes("/book/cal-live"), "T18 prepare: copy_ready carries the link");
    eq(r.social.length, 1, "T19 prepare: only CONNECTED social accounts enumerated (revoked filtered)");
  }

  // ── 4. prepare — SMS consent block (email default-allow asymmetry). ────────
  {
    const r = await prepareCalendarLinkShare({
      caller: makeCaller({ shareable: { shareable: true, reason: null, slug: "cal-live", title: "Live Cal" } }),
      admin: cleanAdmin({ email: "guest@example.com", phone: "+15551234567", consent: [] }),
      expectedTenantId: TENANT, calendarId: CAL, contactId: CONTACT, publicSiteUrl: SITE,
    }) as any;
    eq(r.channels.email.verdict, "can_send", "T20 prepare: email NOT consent-gated (default-allow) → can_send");
    eq(r.channels.sms.verdict, "blocked", "T21 prepare: SMS with no consent row → blocked (default-deny)");
  }

  // ── 5. prepare — non-shareable calendar emits NO book_url / copy_ready. ────
  {
    const r = await prepareCalendarLinkShare({
      caller: makeCaller({ shareable: { shareable: false, reason: "CALENDAR_NOT_PUBLIC", slug: "cal-draft", title: "Draft" } }),
      admin: cleanAdmin(), expectedTenantId: TENANT, calendarId: CAL, contactId: CONTACT, publicSiteUrl: SITE,
    }) as any;
    ok(r.ok && r.shareable === false, "T22 prepare: draft is not shareable");
    ok(r.copy_ready === undefined && r.calendar.book_url === undefined, "T23 prepare: non-public → NO book_url, NO copy_ready");
  }

  // ── 6. prepare — account switch + forged calendar. ─────────────────────────
  {
    const r = await prepareCalendarLinkShare({ caller: makeCaller({ tenant: OTHER_TENANT }), admin: cleanAdmin(), expectedTenantId: TENANT, calendarId: CAL, contactId: CONTACT, publicSiteUrl: SITE }) as any;
    eq(r.code, "ACTIVE_ACCOUNT_CHANGED", "T24 prepare: tenant switch → ACTIVE_ACCOUNT_CHANGED");
  }
  {
    const r = await prepareCalendarLinkShare({ caller: makeCaller({ shareableError: "PRESET_NOT_FOUND" }), admin: cleanAdmin(), expectedTenantId: TENANT, calendarId: CAL, contactId: CONTACT, publicSiteUrl: SITE }) as any;
    eq(r.code, "CALENDAR_NOT_FOUND", "T25 prepare: forged calendar (P0002) → CALENDAR_NOT_FOUND");
  }
  {
    const r = await prepareCalendarLinkShare({ caller: makeCaller({ shareableError: "PRESET_FORBIDDEN: manage permission required" }), admin: cleanAdmin(), expectedTenantId: TENANT, calendarId: CAL, contactId: CONTACT, publicSiteUrl: SITE }) as any;
    eq(r.code, "CALENDAR_FORBIDDEN", "T26 prepare: non-manager (42501) → CALENDAR_FORBIDDEN");
  }

  // ── 7. send — happy path (email), maps outcome=sent → success. ─────────────
  {
    let calledWith: any = null;
    const r = await sendCalendarLink({
      caller: makeCaller({ shareable: { shareable: true, reason: null, slug: "cal-live", title: "Live Cal" } }),
      admin: cleanAdmin({ email: "guest@example.com" }),
      sendMessage: async (i) => { calledWith = i; return { httpOk: true, status: "sent", outcome: "sent", vendor_message_id: "vm_9" }; },
      expectedTenantId: TENANT, actorId: CONTACT, calendarId: CAL, contactId: CONTACT, channel: "email", publicSiteUrl: SITE,
    } as any) as any;
    ok(r.success === true && r.outcome === "sent", "T27 send email: outcome=sent → success");
    eq(r.provider_message_id, "vm_9", "T28 send email: provider id surfaced");
    ok(calledWith && calledWith.channel === "email" && calledWith.contact_id === CONTACT && String(calledWith.body).includes("/book/cal-live"), "T29 send: calls send-message with contact_id + the real link");
  }

  // ── 7b. send — the RAW address is passed as `to` (plus-addressed email must NOT be folded).
  //     Folding `owner+booking@x.com` → `owner@x.com` would make send-message's identity check
  //     (which does not +tag-fold) reject it as recipient_contact_mismatch. §39 MAJOR-1.
  {
    let calledWith: any = null;
    await sendCalendarLink({
      caller: makeCaller({ shareable: { shareable: true, reason: null, slug: "cal-live", title: "Live Cal" } }),
      admin: cleanAdmin({ email: "owner+booking@example.com" }),
      sendMessage: async (i) => { calledWith = i; return { httpOk: true, status: "sent", outcome: "sent", vendor_message_id: "vm_p" }; },
      expectedTenantId: TENANT, actorId: CONTACT, calendarId: CAL, contactId: CONTACT, channel: "email", publicSiteUrl: SITE,
    } as any);
    eq(calledWith?.to, "owner+booking@example.com", "T29a send: passes the RAW +tag address as `to` (no fold → no recipient_contact_mismatch)");
  }

  // ── 7c. send — a custom EMAIL message renders as well-formed HTML (escaped + <br> + clickable link),
  //     not a run-on plain line with a bare URL. §5 MINOR-2.
  {
    let calledWith: any = null;
    await sendCalendarLink({
      caller: makeCaller({ shareable: { shareable: true, reason: null, slug: "cal-live", title: "Live Cal" } }),
      admin: cleanAdmin({ email: "guest@example.com" }),
      sendMessage: async (i) => { calledWith = i; return { httpOk: true, status: "sent", outcome: "sent", vendor_message_id: "vm_c" }; },
      expectedTenantId: TENANT, actorId: CONTACT, calendarId: CAL, contactId: CONTACT, channel: "email",
      subject: "Let's meet", message: "Hi <there>\nGrab a time:", publicSiteUrl: SITE,
    } as any);
    const body = String(calledWith?.body ?? "");
    ok(body.includes("<br>") && body.includes(`<a href="${SITE}/book/cal-live">`), "T29b send email custom: HTML body with <br> + clickable link");
    ok(body.includes("Hi &lt;there&gt;") && !body.includes("Hi <there>"), "T29c send email custom: tenant text HTML-escaped (no raw <there>)");
  }

  // ── 8. send — queued send is NOT reported as sent. ─────────────────────────
  {
    const r = await sendCalendarLink({
      caller: makeCaller({ shareable: { shareable: true, reason: null, slug: "cal-live", title: "Live Cal" } }),
      admin: cleanAdmin({ email: "guest@example.com" }),
      sendMessage: async () => ({ httpOk: true, status: "failed", outcome: "queued_quiet_hours", reason: "quiet hours" }),
      expectedTenantId: TENANT, actorId: CONTACT, calendarId: CAL, contactId: CONTACT, channel: "email", publicSiteUrl: SITE,
    } as any) as any;
    ok(r.success === false && r.outcome === "queued", "T30 send: queued → not success, reported as queued");
  }

  // ── 9. send — failed (a2p_not_approved / needs_config) never a success. ────
  {
    const r = await sendCalendarLink({
      caller: makeCaller({ shareable: { shareable: true, reason: null, slug: "cal-live", title: "Live Cal" } }),
      admin: cleanAdmin({ email: null, phone: "+15551234567" }),
      sendMessage: async () => ({ httpOk: true, status: "failed", outcome: "failed", reason: "a2p_not_approved" }),
      expectedTenantId: TENANT, actorId: CONTACT, calendarId: CAL, contactId: CONTACT, channel: "sms", publicSiteUrl: SITE,
    } as any) as any;
    ok(r.success === false && r.outcome === "failed" && r.reason === "a2p_not_approved", "T31 send SMS: a2p_not_approved → failed, never success");
  }

  // ── 10. send — refusals BEFORE any provider call. ──────────────────────────
  {
    let sendCalled = false;
    const r = await sendCalendarLink({
      caller: makeCaller({ shareable: { shareable: false, reason: "CALENDAR_NOT_PUBLIC", slug: "cal-draft", title: "Draft" } }),
      admin: cleanAdmin({ email: "guest@example.com" }),
      sendMessage: async () => { sendCalled = true; return { httpOk: true, status: "sent", outcome: "sent" }; },
      expectedTenantId: TENANT, actorId: CONTACT, calendarId: CAL, contactId: CONTACT, channel: "email", publicSiteUrl: SITE,
    } as any) as any;
    ok(r.success === false && r.code === "CALENDAR_NOT_SHAREABLE" && sendCalled === false, "T32 send: non-public calendar refused, NO provider call");
  }
  {
    let sendCalled = false;
    const r = await sendCalendarLink({
      caller: makeCaller({ shareable: { shareable: true, reason: null, slug: "cal-live", title: "Live Cal" } }),
      admin: cleanAdmin({ email: null, phone: null }), // no address on file
      sendMessage: async () => { sendCalled = true; return { httpOk: true, status: "sent", outcome: "sent" }; },
      expectedTenantId: TENANT, actorId: CONTACT, calendarId: CAL, contactId: CONTACT, channel: "email", publicSiteUrl: SITE,
    } as any) as any;
    ok(r.success === false && r.code === "NO_CHANNEL_ADDRESS" && sendCalled === false, "T33 send: no email on file → refused, NO provider call");
  }
  {
    let sendCalled = false;
    const r = await sendCalendarLink({
      caller: makeCaller({ tenant: OTHER_TENANT, shareable: { shareable: true, reason: null, slug: "cal-live", title: "Live Cal" } }),
      admin: cleanAdmin({ email: "guest@example.com" }),
      sendMessage: async () => { sendCalled = true; return { httpOk: true, status: "sent", outcome: "sent" }; },
      expectedTenantId: TENANT, actorId: CONTACT, calendarId: CAL, contactId: CONTACT, channel: "email", publicSiteUrl: SITE,
    } as any) as any;
    ok(r.success === false && r.code === "ACTIVE_ACCOUNT_CHANGED" && sendCalled === false, "T34 send: account switch → refused, NO provider call");
  }
  {
    // Forged contact (no clients row in this tenant) → treated as no address, no send.
    let sendCalled = false;
    const r = await sendCalendarLink({
      caller: makeCaller({ shareable: { shareable: true, reason: null, slug: "cal-live", title: "Live Cal" } }),
      admin: makeAdmin({ clients: { data: null, error: null } }),
      sendMessage: async () => { sendCalled = true; return { httpOk: true, status: "sent", outcome: "sent" }; },
      expectedTenantId: TENANT, actorId: CONTACT, calendarId: CAL, contactId: CONTACT, channel: "email", publicSiteUrl: SITE,
    } as any) as any;
    ok(r.success === false && r.code === "NO_CHANNEL_ADDRESS" && sendCalled === false, "T35 send: forged/cross-tenant contact resolves no row → refused, NO provider call");
  }

  // ── 11. social_copy — never claims a post. ─────────────────────────────────
  {
    const r = await calendarLinkSocialCopy({
      caller: makeCaller({ shareable: { shareable: true, reason: null, slug: "cal-live", title: "Live Cal" }, social: [{ platform: "instagram", handle: "@acme", status: "connected", selected: true }] }),
      expectedTenantId: TENANT, calendarId: CAL, publicSiteUrl: SITE,
    }) as any;
    ok(r.ok && r.posted === false && r.sent === false, "T36 social_copy: posted=false, sent=false (never claims a post)");
    ok(r.connected_accounts.length === 1 && r.copy_ready.text.includes("/book/cal-live"), "T37 social_copy: connected accounts + copy-ready link");
  }
  {
    const r = await calendarLinkSocialCopy({
      caller: makeCaller({ shareable: { shareable: false, reason: "CALENDAR_NOT_PUBLIC", slug: "d", title: "Draft" } }),
      expectedTenantId: TENANT, calendarId: CAL, publicSiteUrl: SITE,
    }) as any;
    ok(r.ok && r.shareable === false && r.posted === false, "T38 social_copy: non-public → refused, nothing posted");
  }

  console.log(`\nALL ${passed} calendar-link-share smoke assertions passed.`);
}

main().catch((e) => { console.error("SMOKE FAILED:", e); process.exit(1); });
