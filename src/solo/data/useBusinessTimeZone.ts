import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { localDateInZone } from "../../../supabase/functions/_shared/paige-context/snapshot";

/**
 * Experience 04 E4-S2 — the business time zone, the one setting that decides which payment dates are
 * due or overdue (owner ruling 2026-10-12). One store: public.tenant_business_time_zones, read through
 * public.read_business_time_zone (owner/admin of the active workspace) and written only through
 * public.set_business_time_zone (active owner). Both run on the signed-in person's own session.
 *
 * A save is not reported until the value is READ BACK from the database and equals what the owner
 * chose. Customer contact timing never reads this value; it uses each customer's verified zone.
 */
export type BusinessTimeZoneState = "configured" | "missing" | "invalid";
export type BusinessTimeZone = {
  state: BusinessTimeZoneState;
  zone: string | null;
  setAt: string | null;
  localDate: string | null;
  canSet: boolean;
};
export type BusinessTimeZoneLoad =
  | { status: "loading" }
  | { status: "ready"; value: BusinessTimeZone }
  | { status: "refused" }
  | { status: "no_workspace" }
  | { status: "error" };
export type BusinessTimeZoneSave =
  | { ok: true; value: BusinessTimeZone }
  | { ok: false; kind: "refused" | "invalid" | "failed" | "unconfirmed" }
  /** The person left this workspace before the save answered: say nothing about it in the new one. */
  | { ok: false; kind: "stale" };

/** The database's own accepted shape (the writer and the table CHECK use the same pattern). */
export const BUSINESS_ZONE_PATTERN = /^(UTC|(Africa|America|Antarctica|Arctic|Asia|Atlantic|Australia|Europe|Indian|Pacific)\/[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z][A-Za-z0-9_+-]*)?)$/;

const code = (error: unknown) => (error as { code?: string } | null)?.code;

export function parseBusinessTimeZone(data: unknown): BusinessTimeZone | null {
  const v = data as Record<string, unknown> | null;
  if (!v || typeof v !== "object") return null;
  if (v.state !== "configured" && v.state !== "missing" && v.state !== "invalid") return null;
  const zone = typeof v.zone === "string" ? v.zone : null;
  if (v.state === "configured" && !zone) return null;
  return {
    state: v.state,
    zone: v.state === "configured" ? zone : null,
    setAt: typeof v.set_at === "string" ? v.set_at : null,
    localDate: typeof v.local_date === "string" ? v.local_date : null,
    canSet: v.can_set === true,
  };
}

export async function readBusinessTimeZone(tenantId: string): Promise<BusinessTimeZoneLoad> {
  const { data, error } = await supabase.rpc("read_business_time_zone" as never, { _expected_tenant_id: tenantId } as never);
  if (error) return code(error) === "42501" ? { status: "refused" } : { status: "error" };
  const value = parseBusinessTimeZone(data);
  return value ? { status: "ready", value } : { status: "error" };
}

export async function saveBusinessTimeZone(tenantId: string, zone: string): Promise<BusinessTimeZoneSave> {
  if (!BUSINESS_ZONE_PATTERN.test(zone)) return { ok: false, kind: "invalid" };
  const { error } = await supabase.rpc("set_business_time_zone" as never, { _expected_tenant_id: tenantId, _time_zone: zone } as never);
  if (error) {
    const c = code(error);
    return { ok: false, kind: c === "42501" ? "refused" : c === "22023" ? "invalid" : "failed" };
  }
  // The write said yes; the database's own read decides whether it holds.
  const read = await readBusinessTimeZone(tenantId);
  if (read.status !== "ready" || read.value.state !== "configured" || read.value.zone !== zone) return { ok: false, kind: "unconfirmed" };
  return { ok: true, value: read.value };
}

export function useBusinessTimeZone(tenantId: string | null, read: (tenantId: string) => Promise<BusinessTimeZoneLoad> = readBusinessTimeZone) {
  const [load, setLoad] = useState<BusinessTimeZoneLoad>({ status: "loading" });
  const [saving, setSaving] = useState(false);
  // A response for a workspace the person has since left is dropped, never shown.
  const current = useRef(tenantId);
  current.current = tenantId;

  const refresh = useCallback(async () => {
    if (!tenantId) { setLoad({ status: "no_workspace" }); return; }
    setLoad({ status: "loading" });
    const next = await read(tenantId);
    if (current.current === tenantId) setLoad(next);
  }, [tenantId, read]);

  useEffect(() => { void refresh(); }, [refresh]);

  const save = useCallback(async (zone: string): Promise<BusinessTimeZoneSave> => {
    if (!tenantId) return { ok: false, kind: "refused" };
    setSaving(true);
    try {
      const result = await saveBusinessTimeZone(tenantId, zone);
      if (current.current !== tenantId) return { ok: false, kind: "stale" };
      if (result.ok) setLoad({ status: "ready", value: result.value });
      return result;
    } finally {
      setSaving(false);
    }
  }, [tenantId]);

  return { load, saving, refresh, save };
}

/**
 * Experience 04 E4-S3 (cross-track contract §2.6) — the BUSINESS's calendar day, the only "today" a
 * due or overdue judgement may use (owner ruling 2026-10-12). Computed from the saved zone with the
 * SAME function PAIGE's composer uses (`localDateInZone`, status.ts), so the page and PAIGE can never
 * disagree about what day it is. There is no UTC and no browser-zone fallback: without a usable zone
 * the day is WITHHELD and every judgement that needs it is "On hold".
 *
 * The read's own `local_date` is deliberately not used: it is the date at read time and goes stale on
 * a page left open across the business's midnight.
 */
export type BusinessCalendarWithheld = "loading" | "missing" | "invalid" | "refused" | "unreadable" | "no_workspace";
export type BusinessCalendarDay =
  | { kind: "configured"; zone: string; date: string }
  | { kind: "withheld"; reason: BusinessCalendarWithheld; canSet: boolean };

export function businessCalendarDay(load: BusinessTimeZoneLoad, nowMs: number): BusinessCalendarDay {
  switch (load.status) {
    case "loading": return { kind: "withheld", reason: "loading", canSet: false };
    case "refused": return { kind: "withheld", reason: "refused", canSet: false };
    case "error": return { kind: "withheld", reason: "unreadable", canSet: false };
    case "no_workspace": return { kind: "withheld", reason: "no_workspace", canSet: false };
  }
  const { state, zone, canSet } = load.value;
  if (state === "missing") return { kind: "withheld", reason: "missing", canSet };
  if (state !== "configured" || !zone) return { kind: "withheld", reason: "invalid", canSet };
  const date = localDateInZone(nowMs, zone);
  // The database accepted the zone but this browser cannot resolve it: invalid here, never guessed.
  return date ? { kind: "configured", zone, date } : { kind: "withheld", reason: "invalid", canSet };
}

/** Re-judge at least once a minute and whenever the page becomes visible again. */
const CALENDAR_TICK_MS = 60_000;

export function useBusinessCalendarDay(tenantId: string | null, read?: (tenantId: string) => Promise<BusinessTimeZoneLoad>) {
  const { load, refresh } = useBusinessTimeZone(tenantId, read);
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const tick = () => setNowMs(Date.now());
    const id = window.setInterval(tick, CALENDAR_TICK_MS);
    const onVisible = () => { if (document.visibilityState === "visible") tick(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { window.clearInterval(id); document.removeEventListener("visibilitychange", onVisible); };
  }, []);
  return { day: businessCalendarDay(load, nowMs), refresh };
}

/**
 * The ONE home for the words a surface uses about the business calendar (E4-S3 PR beta), so Setup,
 * Collections and the client record name the zone, the day and a held judgement the same way.
 */

/** "Central Time" — the name people use for the zone; falls back to the zone id. */
export function genericName(zone: string): string {
  try {
    const part = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "longGeneric" })
      .formatToParts(new Date()).find((p) => p.type === "timeZoneName")?.value;
    return part && !/^GMT[+-]/.test(part) ? part : zone;
  } catch {
    return zone;
  }
}

/** "Chicago" or "Buenos Aires, Argentina" — the place part of the id, readable. */
export function placeName(zone: string): string {
  if (zone === "UTC") return "Coordinated Universal Time";
  const parts = zone.split("/").slice(1).reverse().map((p) => p.replace(/_/g, " "));
  return parts.join(", ");
}

/** "Central Time (Chicago)". */
export function businessZoneLabel(zone: string): string {
  const generic = genericName(zone), place = placeName(zone);
  return generic === place ? generic : `${generic} (${place})`;
}

/** "Oct 13, 2026" for a business calendar date (YYYY-MM-DD). It is already the business's own day, so
 *  it is formatted as a calendar date and never shifted through any zone. */
export function businessDateLabel(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(Date.UTC(y, m - 1, d));
}

/**
 * Why a due/overdue judgement is held, in the frozen words (cross-track contract §2.4). A MISSING zone and
 * a saved zone that is NOT RECOGNISED are different facts and get different sentences. `tile` is a
 * Collections fact tile (it knows whether this person may set the zone); `record` is the client record
 * (it cannot know, so it stays neutral and leads with "On hold").
 *
 * PAIGE's own sentence (`ATTENTION_TEXT.business_time_zone_unset` in _shared/client-engagement/labels.ts)
 * still says "not set" for both cases; that is a recorded follow-up, not changed here.
 */
export function businessCalendarHeldNote(reason: BusinessCalendarWithheld, place: "tile" | "record", canSet = false): string {
  if (reason === "loading") return "";
  if (reason === "missing") {
    if (place === "record") return "On hold until the business time zone is set";
    return canSet ? "Set your business time zone" : "Until the business owner sets the business time zone";
  }
  const why = reason === "invalid" ? "the saved business time zone isn’t recognised"
    : reason === "unreadable" ? "the business calendar couldn’t be read"
    : "the business calendar isn’t available here";
  return place === "record" ? `On hold: ${why}` : why.charAt(0).toUpperCase() + why.slice(1);
}
