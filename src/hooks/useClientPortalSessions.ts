import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * The signed-in customer's sessions with their business (E09 Slice 2).
 *
 * Reads go through client_portal_sessions(), which resolves the customer relationship from the
 * auth subject server-side (§9) and returns an allowlisted projection: never host identity,
 * guest details, notes or provider ids. Customers cannot read public.internal_bookings, so there
 * is no realtime: the list refreshes after a change, on window focus / when the tab becomes
 * visible, and on a modest interval while visible.
 *
 * Changes go through the one booking engine, booking-manage, in its signed-in customer mode. That
 * engine admits the change against the calendar's notice window, re-checks the slot rules, writes,
 * and sends the business's notifications. Nothing here writes a booking itself, and nothing here
 * claims a change happened until the engine answered ok. A change whose outcome is unknown keeps
 * its request id, so a retry replays instead of cancelling or moving the session twice.
 *
 * An account linked to more than one business is refused by the relationship resolver (42501)
 * until multi-business membership ships. That is reported as its own state and polling stops,
 * because asking again cannot change the answer.
 */

export type PortalSessionStatus = "scheduled" | "cancelled" | "done" | "no_show" | string;
export type PortalSessionKind = "single" | "collective" | "class_seat";
export type SessionChangeReason = "WINDOW_CLOSED" | "NOT_SCHEDULED" | "NO_CALENDAR" | "CALENDAR_UNAVAILABLE" | null;
/** How the customer reaches the session; null when the server did not say. */
export type PortalLocationKind = "video" | "phone" | "in_person" | "tbd";

export interface PortalSession {
  id: string;
  title: string;
  start_at: string;
  end_at: string;
  /** The booking's own timezone (IANA). */
  timezone: string;
  status: PortalSessionStatus;
  kind: PortalSessionKind;
  location: { type: string; label: string; join_url: string | null; kind: PortalLocationKind | null };
  calendar: { slug: string; duration_min: number | null; appointment_type_id: string | null; accent: string | null } | null;
  change: { can_cancel: boolean; can_reschedule: boolean; deadline: string | null; reason: SessionChangeReason };
}

export type SessionChangeAction = "cancel" | "reschedule";
export type SessionChangeStatus = "sending" | "failed" | "unconfirmed";

export interface SessionChange {
  sessionId: string;
  action: SessionChangeAction;
  /** The new start for a reschedule (ISO). */
  start: string | null;
  requestId: string;
  status: SessionChangeStatus;
  /** Server code for a definite refusal; null when the outcome is unknown. */
  error: string | null;
  /**
   * A refusal whose way out is a message to the business: the session's own Reschedule/Cancel stay
   * hidden until the refusal is dismissed or a fresh read of the list lands.
   */
  actionsHeld?: boolean;
}

export type SessionChangeErrorCode =
  | "SESSION_NOT_FOUND" | "SESSION_NOT_CHANGEABLE" | "SESSION_CHANGE_UNAVAILABLE" | "SESSION_CHANGE_WINDOW_CLOSED"
  | "SLOT_UNAVAILABLE" | "COMMS_PROVIDER_EXECUTION_DISABLED" | "RATE_LIMITED" | "AUTH_REQUIRED"
  | "MULTIPLE_RELATIONSHIPS" | "REQUEST_ID_CONFLICT" | "NEW_TIME_REQUIRED"
  /** Client-side: the engine refused because the session is still scheduled but at another time than this page loaded. */
  | "SESSION_MOVED";

/** Customer-facing copy for a definite refusal. Unknown codes fall back to a plain "not changed". */
export const PORTAL_SESSION_CHANGE_COPY: Record<SessionChangeErrorCode, string> = {
  SESSION_NOT_FOUND: "This session isn't on your account anymore, so nothing was changed.",
  SESSION_NOT_CHANGEABLE: "This session has already been cancelled or completed, so nothing was changed.",
  SESSION_CHANGE_UNAVAILABLE: "This session can't be changed here. Send a message instead.",
  SESSION_CHANGE_WINDOW_CLOSED: "Changes to this session have closed, so nothing was changed. Send a message instead.",
  SLOT_UNAVAILABLE: "That time was just taken. Pick another one.",
  COMMS_PROVIDER_EXECUTION_DISABLED: "Changes can't be made online right now. Send a message instead.",
  RATE_LIMITED: "Too many changes in a short time. Wait a minute, then try again.",
  AUTH_REQUIRED: "Your sign-in has expired. Sign in again, then try once more.",
  MULTIPLE_RELATIONSHIPS: "Your account is connected to more than one business, so this can't be changed here yet.",
  REQUEST_ID_CONFLICT: "This change wasn't made. Start it again.",
  NEW_TIME_REQUIRED: "Pick a new time first.",
  SESSION_MOVED: "This session was moved before your change went through, so nothing was changed. Its current time is shown here.",
};

export function portalSessionChangeCopy(code: string | null): string {
  return (code && (PORTAL_SESSION_CHANGE_COPY as Record<string, string>)[code]) || "This session wasn't changed. Try again.";
}

/**
 * What the customer can do after a definite refusal:
 *  - "retry": the same change may work in a moment (Try again).
 *  - "pick": the time was taken; choose another one.
 *  - "message": it cannot be done here; the way out is a message to the business.
 *  - "again": start the change over (expired sign-in, a request mix-up, an unknown code).
 */
export type RefusalWayOut = "retry" | "pick" | "message" | "again";
const MESSAGE_AFTER = new Set([
  "SESSION_NOT_FOUND", "SESSION_NOT_CHANGEABLE", "SESSION_CHANGE_UNAVAILABLE", "SESSION_CHANGE_WINDOW_CLOSED",
  "COMMS_PROVIDER_EXECUTION_DISABLED", "MULTIPLE_RELATIONSHIPS",
]);
export function refusalWayOut(code: string | null): RefusalWayOut {
  if (code === "RATE_LIMITED") return "retry";
  if (code === "SLOT_UNAVAILABLE") return "pick";
  if (code && MESSAGE_AFTER.has(code)) return "message";
  return "again";
}

const LOCATION_KINDS = new Set<PortalLocationKind>(["video", "phone", "in_person", "tbd"]);
function locationKind(v: unknown): PortalLocationKind | null {
  return typeof v === "string" && LOCATION_KINDS.has(v as PortalLocationKind) ? v as PortalLocationKind : null;
}

/**
 * Refusals after which the server's own view of the session is worth re-reading. A taken time and a
 * session that changed elsewhere are both here: the engine answers those (never a replay) when the
 * booking is no longer in the state this page loaded, so the list on screen is stale.
 */
const STALE_AFTER = new Set([
  "SESSION_NOT_FOUND", "SESSION_NOT_CHANGEABLE", "SESSION_CHANGE_UNAVAILABLE", "SESSION_CHANGE_WINDOW_CLOSED",
  "SLOT_UNAVAILABLE", "SESSION_MOVED",
]);

/** A zone Intl accepts; an unknown one reads as UTC rather than throwing. */
function zoneOrUtc(tz: string): string {
  try { new Intl.DateTimeFormat(undefined, { timeZone: tz }); return tz; } catch { return "UTC"; }
}

export const DAY_MS = 86_400_000;

/** The calendar day of an instant in a zone, as a comparable key. */
export function dayKeyIn(ms: number, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: zoneOrUtc(tz), year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date(ms));
}

/** "45 min" / "1 hr" / "3 hrs", rounded down, never below a minute. */
export function untilLabel(ms: number): string {
  const min = Math.max(1, Math.floor(ms / 60_000));
  if (min < 60) return `${min} min`;
  const hrs = Math.floor(min / 60);
  return `${hrs} hr${hrs === 1 ? "" : "s"}`;
}

export type SessionTiming = { label: string; tone: "live" | "plain" };

/**
 * How near an upcoming session is, when that is worth reading: "Happening now", "Today · in 45 min",
 * "Tomorrow", or "Ended". Null for anything later (the date says it). One wording for Sessions and
 * the home tile.
 */
export function sessionTiming(s: Pick<PortalSession, "start_at" | "end_at">, nowMs: number, tz: string): SessionTiming | null {
  const start = Date.parse(s.start_at), end = Date.parse(s.end_at);
  if (end < nowMs) return { label: "Ended", tone: "plain" };
  if (start <= nowMs) return { label: "Happening now", tone: "live" };
  const day = dayKeyIn(start, tz);
  if (day === dayKeyIn(nowMs, tz)) return { label: `Today · in ${untilLabel(start - nowMs)}`, tone: "plain" };
  if (day === dayKeyIn(nowMs + DAY_MS, tz)) return { label: "Tomorrow", tone: "plain" };
  return null;
}

export const PORTAL_SESSIONS_PAGE = 20;
export const PORTAL_SESSIONS_POLL_MS = 60_000;

export interface SessionsPage {
  tenant_id: string | null;
  server_now: string | null;
  sessions: PortalSession[];
  next_before: string | null;
}

type RpcResult = { data: unknown; error: unknown };
/** The E09 RPCs are newer than the generated Database types; keep the call shape typed locally. */
function portalRpc(name: "client_portal_sessions", args: Record<string, unknown>) {
  return supabase.rpc(name as never, args as never) as unknown as PromiseLike<RpcResult>;
}

/**
 * The relationship resolver raises 42501 when the account is linked to more than one business.
 * 42501 is also "not signed in"; that case is handled by the auth scope, so only the relationship
 * refusal is classified here.
 */
export function isMultipleRelationships(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: unknown; message?: unknown };
  if (e.code !== "42501") return false;
  return !(typeof e.message === "string" && /authentication required/i.test(e.message));
}

function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  // RFC 4122 v4 fallback for old runtimes; the server requires a uuid.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

function parseSession(raw: unknown): PortalSession | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id), start = str(r.start_at), end = str(r.end_at);
  if (!id || !start || !end || !Number.isFinite(Date.parse(start)) || !Number.isFinite(Date.parse(end))) return null;
  const loc = (r.location && typeof r.location === "object" ? r.location : {}) as Record<string, unknown>;
  const cal = (r.calendar && typeof r.calendar === "object" ? r.calendar : null) as Record<string, unknown> | null;
  const ch = (r.change && typeof r.change === "object" ? r.change : {}) as Record<string, unknown>;
  const reason = ch.reason;
  const kind = r.kind === "collective" || r.kind === "class_seat" ? r.kind : "single";
  return {
    id,
    title: str(r.title) ?? "Session",
    start_at: start,
    end_at: end,
    timezone: str(r.timezone) ?? "UTC",
    status: str(r.status) ?? "scheduled",
    kind,
    location: {
      type: str(loc.type) ?? "unknown",
      label: str(loc.label) ?? "To be confirmed",
      // Only an https link is ever offered as a way in; anything else is shown as text, never a link.
      join_url: typeof loc.join_url === "string" && /^https:\/\/\S+$/i.test(loc.join_url) ? loc.join_url : null,
      // The server's location_kind (top level or inside location); anything unrecognised is "not said".
      kind: locationKind(r.location_kind ?? loc.kind),
    },
    calendar: cal && str(cal.slug)
      ? {
        slug: str(cal.slug)!,
        duration_min: typeof cal.duration_min === "number" ? cal.duration_min : null,
        appointment_type_id: str(cal.appointment_type_id),
        accent: str(cal.accent),
      }
      : null,
    change: {
      can_cancel: ch.can_cancel === true,
      can_reschedule: ch.can_reschedule === true,
      deadline: str(ch.deadline),
      reason: reason === "WINDOW_CLOSED" || reason === "NOT_SCHEDULED" || reason === "NO_CALENDAR" || reason === "CALENDAR_UNAVAILABLE"
        ? reason : null,
    },
  };
}

export function parseSessionsPage(data: unknown): SessionsPage | null {
  if (data === null || data === undefined) return null;
  if (typeof data !== "object") throw new Error("Unexpected sessions response");
  const d = data as Record<string, unknown>;
  const list = Array.isArray(d.sessions) ? d.sessions : [];
  return {
    tenant_id: str(d.tenant_id),
    server_now: str(d.server_now),
    sessions: list.map(parseSession).filter((s): s is PortalSession => s !== null),
    next_before: str(d.next_before),
  };
}

/** One page of the caller's sessions. Null = no customer relationship. Throws on a failed read. */
export async function readPortalSessions(args: {
  tenantId?: string | null; window?: "upcoming" | "past"; before?: string | null; limit?: number;
}): Promise<SessionsPage | null> {
  const { data, error } = await portalRpc("client_portal_sessions", {
    p_tenant_id: args.tenantId ?? null,
    p_window: args.window ?? "upcoming",
    p_before: args.before ?? null,
    p_limit: args.limit ?? PORTAL_SESSIONS_PAGE,
  });
  if (error) throw error;
  return parseSessionsPage(data);
}

const byStart = (dir: 1 | -1) => (a: PortalSession, b: PortalSession) =>
  dir * (Date.parse(a.start_at) - Date.parse(b.start_at)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Union by id (later lists win), in the window's order. */
function merge(dir: 1 | -1, ...lists: PortalSession[][]): PortalSession[] {
  const byId = new Map<string, PortalSession>();
  for (const list of lists) for (const s of list) byId.set(s.id, s);
  return [...byId.values()].sort(byStart(dir));
}

/** What the booking engine answered, reduced to the three outcomes the customer can act on. */
type EngineOutcome = { kind: "ok" } | { kind: "refused"; code: string } | { kind: "unknown" };

/**
 * A refusal's code as the customer should read it. When the engine says the session is still
 * scheduled but now starts at a time this page did not load (`current_start`), someone else moved it:
 * "already cancelled or completed" or "that time was just taken" would both be untrue (§13).
 */
function refusalCode(body: Record<string, unknown>): string {
  const code = str(body.code) ?? "UNKNOWN";
  if ((code === "SESSION_NOT_CHANGEABLE" || code === "SLOT_UNAVAILABLE") && str(body.current_start)) return "SESSION_MOVED";
  return code;
}

async function engineOutcome(data: unknown, error: unknown): Promise<EngineOutcome> {
  if (!error) {
    const d = (data ?? {}) as Record<string, unknown>;
    // Only an explicit ok is a change made (a replay of this same request included). Anything else is a refusal.
    if (d.ok === true) return { kind: "ok" };
    return { kind: "refused", code: refusalCode(d) };
  }
  // A non-2xx answer carries the engine's JSON body in the error's Response, not on `data`.
  const context = (error as { context?: unknown }).context as { status?: number; json?: () => Promise<unknown> } | undefined;
  if (!context || typeof context.json !== "function") return { kind: "unknown" }; // never reached the engine
  // A server failure may have happened after the write; a retry with the same request id is safe.
  if (typeof context.status === "number" && context.status >= 500) return { kind: "unknown" };
  let body: Record<string, unknown> = {};
  try { body = ((await context.json()) ?? {}) as Record<string, unknown>; } catch { /* unreadable body */ }
  return { kind: "refused", code: refusalCode(body) };
}

export interface RescheduleSlots {
  /** ISO start times the engine would accept, soonest first. The session's own start is never offered. */
  slots: string[];
  /** The calendar's own timezone, as the booking page reports it. */
  timezone: string | null;
}

/**
 * Open times for moving a session, from the same anonymous availability the business's booking page
 * uses — sized to the booked service so the new slot is the same length. Throws on a failed read.
 */
export async function fetchRescheduleSlots(session: PortalSession): Promise<RescheduleSlots> {
  if (!session.calendar) return { slots: [], timezone: null };
  const body: Record<string, unknown> = { action: "availability", slug: session.calendar.slug };
  if (session.calendar.appointment_type_id) body.appointmentTypeId = session.calendar.appointment_type_id;
  const { data, error } = await supabase.functions.invoke("public-booking", { body });
  if (error) throw error;
  const d = (data ?? {}) as Record<string, unknown>;
  if (typeof d.error === "string") throw new Error(d.error);
  const current = Date.parse(session.start_at);
  const slots = (Array.isArray(d.slots) ? d.slots : [])
    .filter((s): s is string => typeof s === "string" && Number.isFinite(Date.parse(s)) && Date.parse(s) !== current)
    .sort((a, b) => Date.parse(a) - Date.parse(b));
  return { slots, timezone: str(d.timezone) };
}

export interface ClientPortalSessionsState {
  /** Upcoming scheduled sessions, soonest first. */
  upcoming: PortalSession[];
  /** Past and cancelled sessions, most recent first (loaded on demand). */
  past: PortalSession[];
  pastLoaded: boolean;
  pastLoading: boolean;
  hasMoreUpcoming: boolean;
  hasMorePast: boolean;
  loadingMore: boolean;
  /** First read in flight with nothing loaded yet. */
  loading: boolean;
  /** The last read failed; loaded sessions (if any) are kept but may be stale. */
  error: string | null;
  /** Resolved: the caller has no customer relationship (the read returned null). */
  unavailable: boolean;
  /** Resolved: the account is linked to more than one business, which sessions don't support yet. */
  multipleBusinesses: boolean;
  /** Tenant of the loaded sessions (server-resolved), or null before the first read. */
  tenantId: string | null;
  /** Bumped whenever the signed-in identity changes. */
  scopeEpoch: number;
  /** In-flight or unresolved changes, by session id. */
  changes: Record<string, SessionChange>;
  refresh: () => Promise<void>;
  loadPast: () => Promise<void>;
  loadMore: (window: "upcoming" | "past") => Promise<void>;
  cancel: (sessionId: string) => Promise<boolean>;
  reschedule: (sessionId: string, start: string) => Promise<boolean>;
  retryChange: (sessionId: string) => Promise<boolean>;
  dismissChange: (sessionId: string) => void;
}

export function useClientPortalSessions(): ClientPortalSessionsState {
  const [upcoming, setUpcoming] = useState<PortalSession[]>([]);
  const [past, setPast] = useState<PortalSession[]>([]);
  const [pastLoaded, setPastLoaded] = useState(false);
  const [pastLoading, setPastLoading] = useState(false);
  const [nextUpcoming, setNextUpcoming] = useState<string | null>(null);
  const [nextPast, setNextPast] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [multipleBusinesses, setMultipleBusinesses] = useState(false);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [scopeEpoch, setScopeEpoch] = useState(0);
  const [changes, setChanges] = useState<Record<string, SessionChange>>({});

  // Mirrors for async callbacks; each async result is applied only if its epoch is current.
  const epoch = useRef(0);
  const actor = useRef<string | null>(null);
  const tenantRef = useRef<string | null>(null);
  const upcomingRef = useRef<PortalSession[]>([]);
  const pastRef = useRef<PortalSession[]>([]);
  const pastLoadedRef = useRef(false);
  const changesRef = useRef<Record<string, SessionChange>>({});
  const readSeq = useRef(0);
  /** For a held refusal: the last read started before it. Only a read started later releases it. */
  const heldAfterRead = useRef<Record<string, number>>({});
  const alive = useRef(true);
  /** Set once the server refused for multiple relationships: no further polling for this identity. */
  const halted = useRef(false);
  upcomingRef.current = upcoming;
  pastRef.current = past;
  changesRef.current = changes;

  const patchChange = useCallback((sessionId: string, patch: Partial<SessionChange> | null, base?: SessionChange) => {
    const next = { ...changesRef.current };
    if (patch === null || patch.actionsHeld === false) delete heldAfterRead.current[sessionId];
    if (patch === null) delete next[sessionId];
    else next[sessionId] = { ...(base ?? next[sessionId]), ...patch } as SessionChange;
    changesRef.current = next;
    setChanges(next);
  }, []);

  const resetScope = useCallback(() => {
    epoch.current += 1;
    readSeq.current += 1;
    tenantRef.current = null;
    halted.current = false;
    upcomingRef.current = [];
    pastRef.current = [];
    pastLoadedRef.current = false;
    changesRef.current = {};
    heldAfterRead.current = {};
    setUpcoming([]);
    setPast([]);
    setPastLoaded(false);
    setPastLoading(false);
    setNextUpcoming(null);
    setNextPast(null);
    setLoadingMore(false);
    setChanges({});
    setError(null);
    setUnavailable(false);
    setMultipleBusinesses(false);
    setLoading(true);
    setTenantId(null);
    setScopeEpoch(epoch.current);
  }, []);

  const haltForMultiple = useCallback(() => {
    halted.current = true;
    upcomingRef.current = [];
    pastRef.current = [];
    setUpcoming([]);
    setPast([]);
    setNextUpcoming(null);
    setNextPast(null);
    setError(null);
    setMultipleBusinesses(true);
  }, []);

  const markUnavailable = useCallback(() => {
    upcomingRef.current = [];
    pastRef.current = [];
    setUpcoming([]);
    setPast([]);
    setNextUpcoming(null);
    setNextPast(null);
    setUnavailable(true);
  }, []);

  const refresh = useCallback(async () => {
    const myEpoch = epoch.current;
    const seq = ++readSeq.current;
    const current = () => alive.current && myEpoch === epoch.current && seq === readSeq.current;
    const withPast = pastLoadedRef.current;
    try {
      const [up, pa] = await Promise.all([
        readPortalSessions({ tenantId: tenantRef.current, window: "upcoming" }),
        withPast ? readPortalSessions({ tenantId: tenantRef.current, window: "past" }) : Promise.resolve(undefined),
      ]);
      if (!current()) return;
      if (!up || pa === null) {
        markUnavailable();
      } else {
        tenantRef.current = up.tenant_id;
        setTenantId(up.tenant_id);
        setUnavailable(false);
        // The first page is authoritative for the window it covers; later pages already loaded are kept.
        const keepUp = up.next_before
          ? upcomingRef.current.filter((s) => Date.parse(s.start_at) > Date.parse(up.next_before!)) : [];
        const nextUp = merge(1, keepUp, up.sessions);
        upcomingRef.current = nextUp;
        setUpcoming(nextUp);
        if (!keepUp.length) setNextUpcoming(up.next_before);
        if (pa) {
          const keepPa = pa.next_before
            ? pastRef.current.filter((s) => Date.parse(s.start_at) < Date.parse(pa.next_before!)) : [];
          const nextPa = merge(-1, keepPa, pa.sessions);
          pastRef.current = nextPa;
          setPast(nextPa);
          if (!keepPa.length) setNextPast(pa.next_before);
        }
      }
      setError(null);
      // A fresh view of the list is the server's answer: release refusals held since before this read.
      for (const [id, after] of Object.entries(heldAfterRead.current)) {
        if (after < seq && changesRef.current[id]?.actionsHeld) patchChange(id, { actionsHeld: false });
      }
    } catch (err) {
      if (!current()) return;
      if (isMultipleRelationships(err)) haltForMultiple();
      else setError("We couldn't load your sessions. Check your connection and try again.");
    } finally {
      if (current()) setLoading(false);
    }
  }, [haltForMultiple, markUnavailable, patchChange]);

  const loadPast = useCallback(async () => {
    if (pastLoadedRef.current || halted.current) return;
    const myEpoch = epoch.current;
    setPastLoading(true);
    try {
      const page = await readPortalSessions({ tenantId: tenantRef.current, window: "past" });
      if (!alive.current || myEpoch !== epoch.current) return;
      if (!page) { markUnavailable(); return; }
      pastLoadedRef.current = true;
      setPastLoaded(true);
      const next = merge(-1, page.sessions);
      pastRef.current = next;
      setPast(next);
      setNextPast(page.next_before);
      setError(null);
    } catch (err) {
      if (!alive.current || myEpoch !== epoch.current) return;
      if (isMultipleRelationships(err)) haltForMultiple();
      else setError("We couldn't load your past sessions. Try again.");
    } finally {
      if (alive.current && myEpoch === epoch.current) setPastLoading(false);
    }
  }, [haltForMultiple, markUnavailable]);

  const loadMore = useCallback(async (which: "upcoming" | "past") => {
    const cursor = which === "upcoming" ? nextUpcoming : nextPast;
    if (!cursor || loadingMore) return;
    const myEpoch = epoch.current;
    setLoadingMore(true);
    try {
      const page = await readPortalSessions({ tenantId: tenantRef.current, window: which, before: cursor });
      if (!alive.current || myEpoch !== epoch.current) return;
      if (!page) { markUnavailable(); return; }
      if (which === "upcoming") {
        const next = merge(1, upcomingRef.current, page.sessions);
        upcomingRef.current = next;
        setUpcoming(next);
        setNextUpcoming(page.next_before);
      } else {
        const next = merge(-1, pastRef.current, page.sessions);
        pastRef.current = next;
        setPast(next);
        setNextPast(page.next_before);
      }
      setError(null);
    } catch (err) {
      if (!alive.current || myEpoch !== epoch.current) return;
      if (isMultipleRelationships(err)) haltForMultiple();
      else setError("We couldn't load more sessions. Try again.");
    } finally {
      if (alive.current && myEpoch === epoch.current) setLoadingMore(false);
    }
  }, [nextUpcoming, nextPast, loadingMore, haltForMultiple, markUnavailable]);

  const deliver = useCallback(async (entry: SessionChange): Promise<boolean> => {
    const myEpoch = epoch.current;
    const current = () => alive.current && myEpoch === epoch.current;
    patchChange(entry.sessionId, { status: "sending", error: null, actionsHeld: false }, entry);
    let data: unknown = null, invokeError: unknown = null;
    try {
      const body: Record<string, unknown> = {
        mode: "customer", action: entry.action, booking_id: entry.sessionId, request_id: entry.requestId,
      };
      if (entry.action === "reschedule") body.start = entry.start;
      if (tenantRef.current) body.tenant_id = tenantRef.current;
      ({ data, error: invokeError } = await supabase.functions.invoke("booking-manage", { body }));
    } catch (err) {
      invokeError = err ?? new Error("network");
    }
    const outcome = await engineOutcome(data, invokeError);
    if (!current()) return false;
    if (outcome.kind === "ok") {
      patchChange(entry.sessionId, null);
      void refresh();
      return true;
    }
    if (outcome.kind === "unknown") {
      // The change MAY have been made. Retrying with the same request id is safe: the engine replays.
      patchChange(entry.sessionId, { status: "unconfirmed", error: null });
      return false;
    }
    const hold = refusalWayOut(outcome.code) === "message";
    if (hold) heldAfterRead.current[entry.sessionId] = readSeq.current;
    patchChange(entry.sessionId, { status: "failed", error: outcome.code, actionsHeld: hold });
    if (outcome.code === "MULTIPLE_RELATIONSHIPS") haltForMultiple();
    else if (STALE_AFTER.has(outcome.code)) void refresh();
    return false;
  }, [refresh, haltForMultiple, patchChange]);

  const start = useCallback(async (sessionId: string, action: SessionChangeAction, newStart: string | null) => {
    if (!tenantRef.current || halted.current) return false;
    const existing = changesRef.current[sessionId];
    if (existing?.status === "sending") return false;
    // The same change asked again while its outcome is unknown keeps its request id, so it can only
    // ever happen once. Anything else is a new change with a new id.
    const sameAsked = existing && existing.status === "unconfirmed" && existing.action === action && existing.start === newStart;
    const entry: SessionChange = {
      sessionId, action, start: newStart, requestId: sameAsked ? existing.requestId : newId(), status: "sending", error: null,
    };
    return deliver(entry);
  }, [deliver]);

  const cancel = useCallback((sessionId: string) => start(sessionId, "cancel", null), [start]);
  const reschedule = useCallback((sessionId: string, newStart: string) => {
    if (!Number.isFinite(Date.parse(newStart))) return Promise.resolve(false);
    return start(sessionId, "reschedule", new Date(newStart).toISOString());
  }, [start]);

  const retryChange = useCallback(async (sessionId: string) => {
    const entry = changesRef.current[sessionId];
    if (!entry || entry.status === "sending" || halted.current) return false;
    return deliver(entry);
  }, [deliver]);

  const dismissChange = useCallback((sessionId: string) => {
    const entry = changesRef.current[sessionId];
    if (!entry || entry.status === "sending") return;
    patchChange(sessionId, null);
  }, [patchChange]);

  // Identity scope + initial read.
  useEffect(() => {
    alive.current = true;
    let cancelled = false;
    const begin = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (cancelled) return;
      actor.current = user?.id ?? null;
      if (!user) { setLoading(false); setUnavailable(true); return; }
      await refresh();
    };
    void begin();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return;
      const next = session?.user.id ?? null;
      if (event === "INITIAL_SESSION" && next === actor.current) return;
      if (next === actor.current && event !== "SIGNED_OUT") return;
      actor.current = next;
      resetScope();
      if (!next || event === "SIGNED_OUT") { setLoading(false); setUnavailable(true); return; }
      // Do not call SDK Auth/RPC methods while its Auth callback holds the lock.
      queueMicrotask(() => { if (!cancelled) void refresh(); });
    });
    return () => {
      cancelled = true;
      alive.current = false;
      subscription.unsubscribe();
    };
  }, [refresh, resetScope]);

  // Freshness without realtime: focus, becoming visible, and a modest interval while visible.
  useEffect(() => {
    const visible = () => typeof document === "undefined" || document.visibilityState !== "hidden";
    const live = () => !!actor.current && !halted.current;
    const onFocus = () => { if (live()) void refresh(); };
    const onVisibility = () => { if (visible() && live()) void refresh(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    const timer = window.setInterval(() => { if (visible() && live()) void refresh(); }, PORTAL_SESSIONS_POLL_MS);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
      window.clearInterval(timer);
    };
  }, [refresh]);

  return {
    upcoming, past, pastLoaded, pastLoading,
    hasMoreUpcoming: !!nextUpcoming, hasMorePast: !!nextPast, loadingMore,
    loading, error, unavailable, multipleBusinesses, tenantId, scopeEpoch, changes,
    refresh, loadPast, loadMore, cancel, reschedule, retryChange, dismissChange,
  };
}

export type NextPortalSession =
  | { state: "loading" }
  | { state: "session"; session: PortalSession }
  | { state: "none" }
  /** No customer relationship, more than one business, or the read failed: nothing honest to show. */
  | { state: "unavailable" };

/** The soonest upcoming session, for the customer home. One read; no polling. */
export function useNextPortalSession(enabled = true): NextPortalSession {
  const [next, setNext] = useState<NextPortalSession>({ state: "loading" });
  useEffect(() => {
    if (!enabled) { setNext({ state: "unavailable" }); return; }
    let cancelled = false;
    setNext({ state: "loading" });
    readPortalSessions({ window: "upcoming", limit: 1 })
      .then((page) => {
        if (cancelled) return;
        if (!page) setNext({ state: "unavailable" });
        else if (page.sessions[0]) setNext({ state: "session", session: page.sessions[0] });
        else setNext({ state: "none" });
      })
      .catch(() => { if (!cancelled) setNext({ state: "unavailable" }); });
    return () => { cancelled = true; };
  }, [enabled]);
  return next;
}
