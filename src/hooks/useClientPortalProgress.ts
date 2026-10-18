import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * The work a business has explicitly shared with the signed-in customer (E09 Slice 3).
 *
 * Reads go through client_portal_progress(), which resolves the customer relationship from the
 * auth subject server-side (§9) and returns only items the business shared, item by item: never a
 * note, a priority, who the work is assigned to, or anyone's identity. Customers cannot read
 * plan_items, so there is no realtime: the list refreshes on window focus / when the tab becomes
 * visible, and on a modest interval while visible.
 *
 * This is read-only by design. Customers cannot mark progress items done; the business updates
 * them. (Customer action items have their own completion, on /app/actions.)
 *
 * Every row is checked against the exact key allowlist the server promises. A row carrying any
 * other key is refused, so a widened projection fails closed instead of being shown.
 *
 * An account linked to more than one business is refused by the relationship resolver (42501)
 * until multi-business membership ships. That is reported as its own state and polling stops,
 * because asking again cannot change the answer.
 */

export type PortalProgressKind = "milestone" | "task";
/** blocked work reads as in_progress (owner decision D3); cancelled work is never returned. */
export type PortalProgressState = "not_started" | "in_progress" | "done";

export interface PortalProgressItem {
  id: string;
  kind: PortalProgressKind;
  title: string;
  state: PortalProgressState;
  due_at: string | null;
  completed_at: string | null;
  shared_at: string;
  /** A shared milestone this item sits under; null when it has none the customer can see. */
  parent_id: string | null;
}

export interface PortalProgressSummary {
  shared: number;
  done: number;
  open: number;
  overdue: number;
}

export interface PortalProgressPage {
  tenant_id: string;
  server_now: string;
  summary: PortalProgressSummary;
  items: PortalProgressItem[];
  has_more: boolean;
}

/** One shared milestone and the open work under it. */
export interface PortalProgressGroup { milestone: PortalProgressItem; open: PortalProgressItem[] }

/**
 * Open work grouped under the shared milestone it belongs to, in the server's order (soonest due
 * first). A milestone heads a group when it is open itself or has open work under it; nested
 * milestones fold into their top-level one. Everything else is "Other work".
 */
export function groupOpenWork(items: PortalProgressItem[]): { groups: PortalProgressGroup[]; other: PortalProgressItem[] } {
  const byId = new Map(items.map((i) => [i.id, i]));
  const rootOf = (item: PortalProgressItem): PortalProgressItem => {
    let at = item;
    for (let hops = 0; hops < 32 && at.parent_id; hops++) {
      const parent = byId.get(at.parent_id);
      if (!parent || parent.kind !== "milestone" || parent.id === item.id) break;
      at = parent;
    }
    return at;
  };
  const groups = new Map<string, PortalProgressGroup>();
  const other: PortalProgressItem[] = [];
  const groupFor = (m: PortalProgressItem) => {
    let g = groups.get(m.id);
    if (!g) { g = { milestone: m, open: [] }; groups.set(m.id, g); }
    return g;
  };
  for (const item of items) {
    if (item.state === "done") continue;
    const root = rootOf(item);
    if (root.id !== item.id) groupFor(root).open.push(item);
    else if (item.kind === "milestone") groupFor(item);
    else other.push(item);
  }
  return { groups: [...groups.values()], other };
}

/**
 * The open items worth naming first: anything past due, then due today, then the soonest due —
 * which is ascending due date. Undated work is never "next": nothing says when it comes.
 */
export function nextUpWork(items: PortalProgressItem[], max = 3): PortalProgressItem[] {
  return items
    .filter((i) => i.state !== "done" && !!i.due_at)
    .map((i, at) => ({ i, at, due: Date.parse(i.due_at as string) }))
    .sort((a, b) => a.due - b.due || a.at - b.at)
    .slice(0, max)
    .map((x) => x.i);
}

/** The viewer's own zone; every date on the customer side reads in it. */
export function viewerTimeZone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; }
}

/** The calendar day of an instant in a zone, for "today" comparisons. */
export function progressDayKey(ms: number, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
}

/** "Mon, Nov 3" in the viewer's zone; the year only when it is not this year. */
export function progressDayLabel(iso: string, tz: string, nowMs: number): string {
  const d = new Date(iso);
  const sameYear = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric" }).format(d)
    === new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric" }).format(new Date(nowMs));
  return new Intl.DateTimeFormat(undefined, {
    timeZone: tz, weekday: "short", month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }),
  }).format(d);
}

export const isProgressPastDue = (i: PortalProgressItem, nowMs: number) =>
  i.state !== "done" && !!i.due_at && Date.parse(i.due_at) < nowMs;

export const PORTAL_PROGRESS_LIMIT = 100;
export const PORTAL_PROGRESS_POLL_MS = 60_000;

const PAGE_KEYS = ["tenant_id", "server_now", "summary", "items", "has_more"];
const SUMMARY_KEYS = ["shared", "done", "open", "overdue"];
const ITEM_KEYS = ["id", "kind", "title", "state", "due_at", "completed_at", "shared_at", "parent_id"];
const STATES = new Set<PortalProgressState>(["not_started", "in_progress", "done"]);

type RpcResult = { data: unknown; error: unknown };
/** The E09 RPCs are newer than the generated Database types; keep the call shape typed locally. */
function portalRpc(name: "client_portal_progress", args: Record<string, unknown>) {
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

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
/** Exactly these keys: nothing missing, nothing extra. */
const exactKeys = (o: Record<string, unknown>, keys: string[]) =>
  Object.keys(o).length === keys.length && keys.every((k) => Object.prototype.hasOwnProperty.call(o, k));
const isDate = (v: unknown): v is string => typeof v === "string" && Number.isFinite(Date.parse(v));
const isDateOrNull = (v: unknown): v is string | null => v === null || isDate(v);
const isCount = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;

function parseItem(raw: unknown): PortalProgressItem {
  if (!isObject(raw) || !exactKeys(raw, ITEM_KEYS)) throw new Error("Unexpected progress item");
  const { id, kind, title, state, due_at, completed_at, shared_at, parent_id } = raw;
  if (typeof id !== "string" || !id || (kind !== "milestone" && kind !== "task") || typeof title !== "string"
    || typeof state !== "string" || !STATES.has(state as PortalProgressState)
    || !isDateOrNull(due_at) || !isDateOrNull(completed_at) || !isDate(shared_at)
    || (parent_id !== null && (typeof parent_id !== "string" || !parent_id))) {
    throw new Error("Unexpected progress item");
  }
  return {
    id, kind, title: title.trim() || "Untitled", state: state as PortalProgressState,
    due_at, completed_at, shared_at, parent_id: typeof parent_id === "string" && parent_id !== id ? parent_id : null,
  };
}

/** Null = no customer relationship. Throws on any payload outside the promised shape. */
export function parseProgressPage(data: unknown): PortalProgressPage | null {
  if (data === null || data === undefined) return null;
  if (!isObject(data) || !exactKeys(data, PAGE_KEYS)) throw new Error("Unexpected progress response");
  const { tenant_id, server_now, summary, items, has_more } = data;
  if (typeof tenant_id !== "string" || !tenant_id || !isDate(server_now) || typeof has_more !== "boolean"
    || !Array.isArray(items) || items.length > PORTAL_PROGRESS_LIMIT
    || !isObject(summary) || !exactKeys(summary, SUMMARY_KEYS) || !SUMMARY_KEYS.every((k) => isCount(summary[k]))) {
    throw new Error("Unexpected progress response");
  }
  const parsed = items.map(parseItem);
  if (new Set(parsed.map((i) => i.id)).size !== parsed.length) throw new Error("Unexpected progress response");
  return {
    tenant_id, server_now, has_more,
    summary: { shared: summary.shared as number, done: summary.done as number, open: summary.open as number, overdue: summary.overdue as number },
    items: parsed,
  };
}

/** One read of the caller's shared progress. Null = no customer relationship. Throws on a failed read. */
export async function readPortalProgress(args: { tenantId?: string | null; limit?: number } = {}): Promise<PortalProgressPage | null> {
  const { data, error } = await portalRpc("client_portal_progress", {
    p_tenant_id: args.tenantId ?? null,
    p_limit: args.limit ?? PORTAL_PROGRESS_LIMIT,
  });
  if (error) throw error;
  return parseProgressPage(data);
}

export interface ClientPortalProgressState {
  /** Shared items in the server's order: open first (soonest due), then done (newest first). */
  items: PortalProgressItem[];
  summary: PortalProgressSummary | null;
  /** More shared items exist than this page holds. */
  hasMore: boolean;
  /** The server's clock at the last read (ISO), for past-due marks. */
  serverNow: string | null;
  /** First read in flight with nothing loaded yet. */
  loading: boolean;
  /** The last read failed; loaded items (if any) are kept but may be stale. */
  error: string | null;
  /** Resolved: the caller has no customer relationship (the read returned null). */
  unavailable: boolean;
  /** Resolved: the account is linked to more than one business, which progress doesn't support yet. */
  multipleBusinesses: boolean;
  /** Tenant of the loaded progress (server-resolved), or null before the first read. */
  tenantId: string | null;
  /** Bumped whenever the signed-in identity changes. */
  scopeEpoch: number;
  refresh: () => Promise<void>;
}

export const PORTAL_PROGRESS_LOAD_ERROR = "We couldn't load your progress. Check your connection and try again.";
/** A failed re-read while the last list is still on screen: the list is there, it may just be behind. */
export const PORTAL_PROGRESS_REFRESH_ERROR = "We couldn't refresh this list, so it may be out of date.";

export function useClientPortalProgress(): ClientPortalProgressState {
  const [items, setItems] = useState<PortalProgressItem[]>([]);
  const [summary, setSummary] = useState<PortalProgressSummary | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [serverNow, setServerNow] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [multipleBusinesses, setMultipleBusinesses] = useState(false);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [scopeEpoch, setScopeEpoch] = useState(0);

  // Mirrors for async callbacks; each async result is applied only if its epoch is current.
  const epoch = useRef(0);
  const actor = useRef<string | null>(null);
  const tenantRef = useRef<string | null>(null);
  const readSeq = useRef(0);
  const alive = useRef(true);
  /** Set once the server refused for multiple relationships: no further polling for this identity. */
  const halted = useRef(false);
  /** A list for this identity is on screen, so a failed read is a failed refresh, not a failed load. */
  const shown = useRef(false);

  const clearData = useCallback(() => {
    shown.current = false;
    setItems([]);
    setSummary(null);
    setHasMore(false);
    setServerNow(null);
  }, []);

  const resetScope = useCallback(() => {
    epoch.current += 1;
    readSeq.current += 1;
    tenantRef.current = null;
    halted.current = false;
    clearData();
    setError(null);
    setUnavailable(false);
    setMultipleBusinesses(false);
    setLoading(true);
    setTenantId(null);
    setScopeEpoch(epoch.current);
  }, [clearData]);

  const refresh = useCallback(async () => {
    if (halted.current) return;
    const myEpoch = epoch.current;
    const seq = ++readSeq.current;
    const current = () => alive.current && myEpoch === epoch.current && seq === readSeq.current;
    const pinned = tenantRef.current;
    try {
      const page = await readPortalProgress({ tenantId: pinned });
      if (!current()) return;
      if (!page) {
        clearData();
        setUnavailable(true);
      } else {
        // The first read pins the business; a later answer for another one is never shown.
        if (pinned && page.tenant_id !== pinned) throw new Error("Progress business changed");
        tenantRef.current = page.tenant_id;
        setTenantId(page.tenant_id);
        setUnavailable(false);
        setItems(page.items);
        setSummary(page.summary);
        setHasMore(page.has_more);
        setServerNow(page.server_now);
        shown.current = true;
      }
      setError(null);
    } catch (err) {
      if (!current()) return;
      if (isMultipleRelationships(err)) {
        halted.current = true;
        clearData();
        setError(null);
        setMultipleBusinesses(true);
      } else {
        setError(shown.current ? PORTAL_PROGRESS_REFRESH_ERROR : PORTAL_PROGRESS_LOAD_ERROR);
      }
    } finally {
      if (current()) setLoading(false);
    }
  }, [clearData]);

  // Identity scope + initial read.
  useEffect(() => {
    alive.current = true;
    let cancelled = false;
    const start = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (cancelled) return;
      actor.current = user?.id ?? null;
      if (!user) { setLoading(false); setUnavailable(true); return; }
      await refresh();
    };
    void start();
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
    const timer = window.setInterval(() => { if (visible() && live()) void refresh(); }, PORTAL_PROGRESS_POLL_MS);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
      window.clearInterval(timer);
    };
  }, [refresh]);

  return { items, summary, hasMore, serverNow, loading, error, unavailable, multipleBusinesses, tenantId, scopeEpoch, refresh };
}

export type PortalProgressGlance =
  | { state: "loading" }
  /** `next` is the first open item when it has a due date: the server lists open work soonest-due first. */
  | { state: "ready"; summary: PortalProgressSummary; next: PortalProgressItem | null }
  | { state: "unavailable" }
  | { state: "error" };

/**
 * The home tile's glance: the summary counts from a one-item read, plus that one item when it is the
 * next dated piece of open work. The counts cover every shared item regardless of the limit.
 */
export function usePortalProgressGlance(enabled = true): PortalProgressGlance {
  const [glance, setGlance] = useState<PortalProgressGlance>({ state: "loading" });
  useEffect(() => {
    if (!enabled) { setGlance({ state: "unavailable" }); return; }
    let cancelled = false;
    setGlance({ state: "loading" });
    readPortalProgress({ limit: 1 })
      .then((page) => {
        if (cancelled) return;
        if (!page) { setGlance({ state: "unavailable" }); return; }
        const first = page.items[0];
        setGlance({ state: "ready", summary: page.summary, next: first && first.state !== "done" && first.due_at ? first : null });
      })
      .catch((err) => {
        if (cancelled) return;
        setGlance(isMultipleRelationships(err) ? { state: "unavailable" } : { state: "error" });
      });
    return () => { cancelled = true; };
  }, [enabled]);
  return glance;
}
