// Deterministic data boundary for the customer portal Sessions harness (E09 Slice 2).
// HARNESS RENDER · SYNTHETIC DATA · NOT LIVE. Every name is fictional ("Northwind Studio", "Jordan Rivera");
// the signed-in customer portal on the deployed app is a separate, owed check (§32/§70.1).
//
// Only the transport is stubbed. The REAL useClientPortalSessions hook, the REAL brand/config readers, the
// REAL playbook resolver and the REAL NotificationBell all run against this client, so the page, the chrome
// and the state machine are the shipped code. The payloads follow the contracts as they stand in the worktree:
//
//   client_portal_sessions(p_tenant_id, p_window, p_before, p_limit)       — 20271110020000_e09_customer_portal_sessions.sql
//     -> { tenant_id, server_now, sessions: [...], next_before } | null
//     each session has EXACTLY: id, title, start_at, end_at, timezone, status, kind,
//       location {type, label, join_url}, location_kind (video|phone|in_person|tbd), calendar {slug, duration_min, appointment_type_id, accent} | null,
//       change {can_cancel, can_reschedule, deadline, reason}
//     upcoming = status 'scheduled' AND end_at >= now (oldest first); past = everything else (newest first).
//     deadline = start_at - calendars.min_notice_min; can_cancel = scheduled AND calendar AND now <= deadline;
//     can_reschedule = can_cancel AND calendar enabled; reason NOT_SCHEDULED|NO_CALENDAR|WINDOW_CLOSED|CALENDAR_UNAVAILABLE|null.
//     The location label is _portal_session_location_label()'s wording, including its "settled" branch.
//   functions.invoke("booking-manage", {mode:'customer', ...})              — supabase/functions/booking-manage/index.ts
//     2xx -> { ok: true, ... }; a refusal is a non-2xx whose JSON body is { ok:false, error, code } (FunctionsHttpError.context).
//   functions.invoke("public-booking", {action:'availability', slug, appointmentTypeId?})
//     -> { durationMin, timezone, branding, slots: [ISO...] }
//
//   ?state=upcoming|empty|reschedule|cancel|failed|unavailable|multiple|loading|home|home-empty
//   (home / home-empty mount the customer home's ClientHomeTiles at /app, with and without an upcoming session)
const params = new URLSearchParams(window.location.search);
const state = params.get("state") ?? "upcoming";

export const TENANT = "e0900000-0000-4000-8000-00000000b001";
const USER = { id: "e0900000-0000-4000-8000-00000000c001", email: "jordan.rivera@example.test" };
const BRAND = { tenant_id: TENANT, tenant_name: "Northwind Studio", tenant_slug: "northwind-studio", logo_url: null, primary_color: "#26483e" };
const MULTI = { code: "42501", message: "select an authorized customer relationship" };

const MIN = 60_000;
const NOTICE_MIN = 60; // calendars.min_notice_min on the synthetic "Northwind consultations" calendar
const CAL = { slug: "northwind-consultations", accent: null as string | null };

/** A local (viewer, America/Chicago in the drive) wall-clock time `days` from the (Playwright-fixed) now. */
function at(days: number, h: number, m = 0) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(h, m, 0, 0);
  return d;
}

type Row = {
  id: string; title: string; start: Date; durationMin: number; timezone: string; status: string;
  kind: "single" | "collective" | "class_seat"; locType: string; locValue: string | null; join: string | null;
  apptType: string | null; calendar: boolean; calEnabled?: boolean;
};

// _portal_session_location_label(type, value, has_join, settled): a session still ahead keeps the
// "to follow" wording; a settled one (cancelled, done, no-show, or scheduled but already over) names the place only.
const LABEL = (t: string, v: string | null, hasJoin: boolean, settled: boolean) =>
  settled
    ? (t === "google_meet" ? "Google Meet"
      : t === "zoom" ? "Zoom"
      : t === "phone" ? "Phone call"
      : t === "in_person" ? (v?.trim() || "In person")
      : t === "custom" ? (v?.trim() || "Location not recorded")
      : "Location not recorded")
  : t === "google_meet" ? (hasJoin ? "Google Meet" : "Google Meet — link to follow")
  : t === "zoom" ? (hasJoin ? "Zoom" : "Zoom — link to follow")
  : t === "phone" ? (v?.trim() ? `Phone call: ${v.trim()}` : "Phone call")
  : t === "in_person" ? (v?.trim() ? `In person: ${v.trim()}` : "In person")
  : t === "custom" ? (v?.trim() || "Details to follow")
  : "To be confirmed";

/** location_kind: decided by the kind of place, never by whether a link exists (custom counts as video only with an https link). */
const KIND = (t: string, join: string | null) =>
  t === "zoom" || t === "google_meet" ? "video"
  : t === "custom" && join && /^https:\/\/\S+$/i.test(join) ? "video"
  : t === "phone" ? "phone"
  : t === "in_person" ? "in_person"
  : "tbd";

/** Shape a row EXACTLY as client_portal_sessions does (keys, title fallbacks, change maths). */
function project(r: Row, now: number) {
  const end = new Date(r.start.getTime() + r.durationMin * MIN);
  const deadline = r.calendar ? new Date(r.start.getTime() - NOTICE_MIN * MIN) : null;
  const enabled = r.calEnabled !== false;
  const scheduled = r.status === "scheduled";
  const open = scheduled && r.calendar && deadline !== null && now <= deadline.getTime();
  return {
    id: r.id,
    title: r.title,
    start_at: r.start.toISOString(),
    end_at: end.toISOString(),
    timezone: r.timezone,
    status: r.status,
    kind: r.kind,
    location: { type: r.locType, label: LABEL(r.locType, r.locValue, !!r.join, !scheduled || end.getTime() < now), join_url: r.join },
    location_kind: KIND(r.locType, r.join),
    calendar: r.calendar ? { slug: CAL.slug, duration_min: r.durationMin, appointment_type_id: r.apptType, accent: CAL.accent } : null,
    change: {
      can_cancel: open,
      can_reschedule: open && enabled,
      deadline: deadline ? deadline.toISOString() : null,
      reason: !scheduled ? "NOT_SCHEDULED" : !r.calendar ? "NO_CALENDAR" : deadline && now > deadline.getTime() ? "WINDOW_CLOSED" : !enabled ? "CALENDAR_UNAVAILABLE" : null,
    },
  };
}

let seq = 0;
const id = () => `e0900000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;
const KICKOFF_TYPE = "e0900000-0000-4000-a000-000000000001";
const STRATEGY_TYPE = "e0900000-0000-4000-a000-000000000002";
const REVIEW_TYPE = "e0900000-0000-4000-a000-000000000003";

// The customer's book with Northwind Studio. Three upcoming (one already inside the notice window, one online
// with a join link and booked in another zone, one in person) and four past (two completed, one cancelled, one missed).
function book(): Row[] {
  if (state === "empty" || state === "home-empty") return [];
  const nowD = new Date();
  // Starts 45 minutes from now: the 60-minute notice window has already closed.
  const soon = new Date(nowD.getTime() + 45 * MIN); soon.setSeconds(0, 0);
  return [
    { id: id(), title: "Brand strategy session", start: soon, durationMin: 60, timezone: "America/Chicago", status: "scheduled", kind: "single",
      locType: "phone", locValue: null, join: null, apptType: STRATEGY_TYPE, calendar: true },
    // Booked in the business's New York zone; the viewer is in Chicago, so the row labels both.
    { id: id(), title: "Kickoff call", start: at(3, 9), durationMin: 45, timezone: "America/New_York", status: "scheduled", kind: "single",
      locType: "zoom", locValue: null, join: "https://meet.example.test/northwind/kickoff-4821", apptType: KICKOFF_TYPE, calendar: true },
    { id: id(), title: "Quarterly review", start: at(11, 14), durationMin: 90, timezone: "America/Chicago", status: "scheduled", kind: "collective",
      locType: "in_person", locValue: "14 Harbour Lane, Suite 3", join: null, apptType: REVIEW_TYPE, calendar: true },
    { id: id(), title: "Brand strategy session", start: at(-7, 10), durationMin: 60, timezone: "America/Chicago", status: "done", kind: "single",
      locType: "zoom", locValue: null, join: "https://meet.example.test/northwind/strategy-1180", apptType: STRATEGY_TYPE, calendar: true },
    { id: id(), title: "Brand strategy session", start: at(-14, 10), durationMin: 60, timezone: "America/Chicago", status: "cancelled", kind: "single",
      locType: "zoom", locValue: null, join: null, apptType: STRATEGY_TYPE, calendar: true },
    { id: id(), title: "Kickoff call", start: at(-21, 9, 30), durationMin: 45, timezone: "America/Chicago", status: "no_show", kind: "single",
      locType: "phone", locValue: null, join: null, apptType: KICKOFF_TYPE, calendar: true },
    { id: id(), title: "Intro consultation", start: at(-28, 16), durationMin: 30, timezone: "America/Chicago", status: "done", kind: "single",
      locType: "custom", locValue: null, join: null, apptType: null, calendar: false },
  ];
}

const store: Row[] = book();
let changes = 0;
export const harnessCalls = { get changes() { return changes; } };

function sessions(args: Record<string, unknown>) {
  if (state === "loading") return new Promise(() => {});
  if (state === "unavailable") return Promise.resolve({ data: null, error: null });
  if (state === "multiple") return Promise.resolve({ data: null, error: MULTI });
  const now = Date.now();
  const upcoming = (args.p_window ?? "upcoming") !== "past";
  const limit = Math.min(Math.max(typeof args.p_limit === "number" ? args.p_limit : 20, 1), 50);
  const before = typeof args.p_before === "string" ? Date.parse(args.p_before) : null;
  const end = (r: Row) => r.start.getTime() + r.durationMin * MIN;
  const inWin = store
    .filter((r) => (r.status === "scheduled" && end(r) >= now) === upcoming)
    .filter((r) => before === null || (upcoming ? r.start.getTime() > before : r.start.getTime() < before))
    .sort((a, b) => (upcoming ? 1 : -1) * (a.start.getTime() - b.start.getTime()) || (a.id < b.id ? -1 : 1));
  const page = inWin.slice(0, limit);
  const last = page[page.length - 1];
  const more = last ? inWin.length > page.length : false;
  return Promise.resolve({
    data: { tenant_id: TENANT, server_now: new Date(now).toISOString(), sessions: page.map((r) => project(r, now)), next_before: more ? last.start.toISOString() : null },
    error: null,
  });
}

/** A FunctionsHttpError as supabase-js raises it: the engine's JSON body rides on error.context (a Response). */
function httpError(status: number, body: Record<string, unknown>) {
  const err = new Error("Edge Function returned a non-2xx status code") as Error & { context: unknown };
  err.name = "FunctionsHttpError";
  err.context = { status, json: async () => body };
  return { data: null, error: err };
}

/** Open times the calendar's public booking page would offer, over the next five weekdays. */
function availability() {
  const slots: string[] = [];
  for (let d = 1, days = 0; days < 5 && d < 14; d += 1) {
    const day = at(d, 0);
    if (day.getDay() === 0 || day.getDay() === 6) continue;
    days += 1;
    for (const [h, m] of [[9, 0], [10, 0], [11, 30], [13, 0], [14, 30], [16, 0]]) {
      if (days === 2 && h === 11) continue; // a realistic gap: one taken
      slots.push(at(d, h, m).toISOString());
    }
  }
  return { durationMin: 45, timezone: "America/Chicago", branding: null, slots };
}

function bookingManage(body: Record<string, unknown>) {
  changes += 1;
  if (body.mode !== "customer") return Promise.resolve(httpError(400, { ok: false, error: "harness: guest mode not stubbed", code: "BAD_REQUEST" }));
  if (state === "failed") {
    // D3: the business's messaging is switched off, so the engine refuses before any write.
    return Promise.resolve(httpError(403, { ok: false, status: "blocked", code: "COMMS_PROVIDER_EXECUTION_DISABLED" }));
  }
  const row = store.find((r) => r.id === body.booking_id);
  if (!row) return Promise.resolve(httpError(403, { ok: false, error: "Session not found.", code: "SESSION_NOT_FOUND" }));
  if (body.action === "cancel") row.status = "cancelled";
  else if (body.action === "reschedule" && typeof body.start === "string") row.start = new Date(body.start);
  return Promise.resolve({ data: { ok: true }, error: null });
}

function brand() {
  if (state === "unavailable") return Promise.resolve({ data: [], error: null });
  if (state === "multiple") return Promise.resolve({ data: null, error: MULTI });
  return Promise.resolve({ data: [BRAND], error: null });
}

/** Every table read resolves empty (no notifications, no avatar, no authored playbook). */
function chain(): unknown {
  const result = { data: [], error: null, count: 0 };
  const single = { data: null, error: null };
  const target: Record<string, unknown> = {};
  const proxy: unknown = new Proxy(target, {
    get(_t, key) {
      if (key === "then") return (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve);
      if (key === "maybeSingle" || key === "single") return () => Promise.resolve(single);
      return () => proxy;
    },
  });
  return proxy;
}

export const supabase = {
  rpc: (name: string, args: Record<string, unknown> = {}) => {
    if (name === "client_portal_sessions") return sessions(args);
    if (name === "get_client_portal_brand") return brand();
    if (name === "get_client_portal_config") return Promise.resolve({ data: null, error: null });
    return Promise.resolve({ data: null, error: { message: `harness: unstubbed rpc ${name}` } });
  },
  from: () => chain(),
  auth: {
    getUser: async () => ({ data: { user: USER }, error: null }),
    getSession: async () => ({ data: { session: { user: USER, access_token: "harness" } }, error: null }),
    onAuthStateChange: (cb: (event: string, session: unknown) => void) => {
      queueMicrotask(() => cb("INITIAL_SESSION", { user: USER }));
      return { data: { subscription: { unsubscribe() {} } } };
    },
    signOut: async () => ({ error: null }),
  },
  channel: () => { const c = { on: () => c, subscribe: () => c, unsubscribe: () => undefined }; return c; },
  removeChannel: () => undefined,
  functions: {
    invoke: async (name: string, opts: { body?: Record<string, unknown> } = {}) => {
      const body = opts.body ?? {};
      if (name === "public-booking" && body.action === "availability") return { data: availability(), error: null };
      if (name === "booking-manage") return bookingManage(body);
      return { data: null, error: { message: `harness: unstubbed function ${name}` } };
    },
  },
  storage: { from: () => ({ getPublicUrl: () => ({ data: { publicUrl: "" } }), createSignedUrl: async () => ({ data: null, error: null }) }) },
};

export const harnessUser = USER;

// DashboardModeContext: a customer, never staff.
export const useDashboardMode = () => ({ isAdmin: false, mode: "client", setMode: () => undefined, loading: false });
export function DashboardModeProvider({ children }: { children: unknown }) { return children; }
