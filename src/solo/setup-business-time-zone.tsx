import { useEffect, useMemo, useRef, useState } from "react";
import { useTheme } from "next-themes";
import { CheckCircle2, ChevronsUpDown, CircleHelp, Clock3, RefreshCw, ShieldCheck } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { BUSINESS_ZONE_PATTERN, useBusinessTimeZone } from "./data/useBusinessTimeZone";

/**
 * Setup › Business profile › Business time zone (Experience 04 E4-S2).
 *
 * The owner picks the zone, sees exactly what will be saved, confirms, and the value is read back from
 * the database before it is called saved. PAIGE can resolve a place to a zone in chat and point here;
 * she never saves it herself. An admin sees the setting but cannot change it. This zone decides which
 * payment dates are due or overdue; it never decides when a customer is contacted.
 */

const US_COMMON = ["America/New_York", "America/Chicago", "America/Denver", "America/Phoenix", "America/Los_Angeles", "America/Anchorage", "Pacific/Honolulu"];

function supportedZones(): string[] {
  // Not in this TypeScript lib yet; present in every browser the Solo app supports.
  const supported = (Intl as unknown as { supportedValuesOf?: (key: "timeZone") => string[] }).supportedValuesOf;
  const all = typeof supported === "function" ? supported("timeZone") : US_COMMON;
  const zones = all.filter((zone) => BUSINESS_ZONE_PATTERN.test(zone));
  return zones.includes("UTC") ? zones : [...zones, "UTC"];
}

/** "Central Time" — the name people use; falls back to the zone id. */
function genericName(zone: string): string {
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

function nowIn(zone: string, now = new Date()): string | null {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: zone, weekday: "long", hour: "numeric", minute: "2-digit" }).format(now);
  } catch {
    return null;
  }
}

function deviceZone(): string | null {
  try {
    const zone = new Intl.DateTimeFormat().resolvedOptions().timeZone;
    return zone && BUSINESS_ZONE_PATTERN.test(zone) ? zone : null;
  } catch {
    return null;
  }
}

/**
 * Word matching, not the list's default fuzzy match: fuzzy scoring finds "Denver" inside "Coordinated
 * Universal Time" (its letters occur in order) and keeps that earlier row highlighted, so Enter would
 * pick the wrong zone. A place that starts with the search ranks first, then any word that does, then
 * any substring; everything else is hidden.
 */
export function zoneMatch(value: string, search: string): number {
  const query = search.trim().toLowerCase().replace(/_/g, " ");
  if (!query) return 1;
  const text = value.toLowerCase().replace(/[_/]/g, " ");
  const [, place = ""] = value.split("|");
  if (place.toLowerCase().startsWith(query)) return 1;
  if (text.split(/[\s,·|]+/).some((word) => word.startsWith(query))) return 0.8;
  return text.includes(query) ? 0.4 : 0;
}

function ZoneOption({ zone, onPick, hint }: { zone: string; onPick: (zone: string) => void; hint?: string }) {
  return <CommandItem value={`${zone}|${placeName(zone)}|${genericName(zone)}`} onSelect={() => onPick(zone)} className="setup-tz__option">
    <span><strong>{placeName(zone)}</strong><small>{hint ? `${hint} · ` : ""}{genericName(zone)} · {zone}</small></span>
  </CommandItem>;
}

export function BusinessTimeZoneSetting({ tenantId }: { tenantId: string | null }) {
  const { load, saving, refresh, save } = useBusinessTimeZone(tenantId);
  const [picking, setPicking] = useState(false);
  const [chosen, setChosen] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const zones = useMemo(supportedZones, []);
  const device = useMemo(deviceZone, []);
  // The picker is portaled to <body>, outside the themed shell: carry the theme with it, exactly as
  // Setup's Paige brief drawer does.
  const { resolvedTheme } = useTheme();
  const theme = resolvedTheme === "light" ? "light" : "dark";

  // A different workspace is a different business: drop any half-made choice.
  useEffect(() => { setChosen(null); setPicking(false); setNotice(null); }, [tenantId]);
  // The control that was pressed disappears on pick and on save; keyboard focus follows the task
  // instead of falling to the page: to the confirmation, then to the result.
  const confirmTitle = useRef<HTMLElement>(null);
  const noticeRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (chosen) confirmTitle.current?.focus(); }, [chosen]);
  useEffect(() => { if (notice) noticeRef.current?.focus(); }, [notice]);

  if (load.status === "loading") return <div className="setup-tz" aria-busy="true"><div className="setup-tz__state" role="status"><RefreshCw aria-hidden/>Reading this business’s time zone…</div></div>;
  if (load.status === "no_workspace") return <div className="setup-tz"><div className="setup-tz__state" role="status"><ShieldCheck aria-hidden/>Open this business’s workspace to see its time zone.</div></div>;
  if (load.status === "refused") return <div className="setup-tz"><div className="setup-tz__state" role="status"><ShieldCheck aria-hidden/>Only the business owner or an admin can see the business time zone.</div></div>;
  if (load.status === "error") return <div className="setup-tz"><div className="setup-notice" data-tone="bad" role="alert"><CircleHelp aria-hidden/><span>The business time zone could not be read. Nothing was changed.</span><button type="button" className="setup-button" onClick={() => void refresh()}>Retry</button></div></div>;

  const value = load.value;
  const set = value.state === "configured" && value.zone;
  const now = set ? nowIn(value.zone!) : null;

  const pick = (zone: string) => { setChosen(zone); setPicking(false); setNotice(null); };
  const confirm = async () => {
    if (!chosen) return;
    const result = await save(chosen);
    // A save that answered after the person switched workspace belongs to the other business.
    if ("kind" in result && result.kind === "stale") return;
    // `in` narrows under both the strict and the app tsconfig.
    if (!("kind" in result)) {
      setChosen(null);
      setNotice({ tone: "ok", text: `Saved and read back from your business record: ${result.value.zone}. Payment due dates now follow this calendar.` });
      return;
    }
    setNotice({ tone: "bad", text: result.kind === "refused" ? "Only the business owner can change the business time zone, in their active workspace. Nothing was changed."
      : result.kind === "invalid" ? "That time zone isn’t one this business can use. Choose a city from the list. Nothing was changed."
      : result.kind === "unconfirmed" ? "The save could not be confirmed by reading it back. Check the value shown below before relying on it."
      : "The time zone could not be saved. Nothing was changed. Try again." });
    if (result.kind === "unconfirmed") void refresh();
  };

  return <div className="setup-tz">
    <div className="setup-tz__current">
      <Clock3 aria-hidden/>
      <div>
        {set
          ? <><strong>{genericName(value.zone!)} · {placeName(value.zone!)}</strong><span>{value.zone}{now ? ` · ${now} there now` : ""}</span></>
          : <><strong>{value.state === "invalid" ? "Saved time zone not recognised" : "Not set"}</strong><span>Due and overdue payment dates are on hold until it is set. Paige won’t call anything late without it.</span></>}
      </div>
      {value.canSet && !chosen && <Popover open={picking} onOpenChange={setPicking}>
        <PopoverTrigger asChild>
          <button type="button" className={`setup-button setup-tz__trigger${set ? "" : " setup-button--primary"}`} aria-haspopup="listbox" disabled={saving}>
            {set ? "Change" : "Set time zone"}<ChevronsUpDown aria-hidden/>
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="setup-tz__picker" data-pg={theme}>
          <Command filter={zoneMatch}>
            <CommandInput placeholder="Find a city or time zone"/>
            <CommandList>
              <CommandEmpty>No city or time zone matches. Try the nearest large city.</CommandEmpty>
              {/* Each zone appears exactly once: a repeated option would be two rows highlighted at once. */}
              {device && <CommandGroup heading="This device"><ZoneOption zone={device} onPick={pick} hint="This device"/></CommandGroup>}
              <CommandGroup heading="United States">{US_COMMON.filter((z) => z !== device && zones.includes(z)).map((zone) => <ZoneOption key={zone} zone={zone} onPick={pick}/>)}</CommandGroup>
              <CommandGroup heading="All time zones">{zones.filter((z) => z !== device && !US_COMMON.includes(z)).map((zone) => <ZoneOption key={zone} zone={zone} onPick={pick}/>)}</CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>}
    </div>

    {chosen && <div className="setup-tz__confirm" role="group" aria-labelledby="setup-tz-confirm-title">
      <div>
        <strong id="setup-tz-confirm-title" ref={confirmTitle} tabIndex={-1}>Save {genericName(chosen)} — {chosen}?</strong>
        <span>{nowIn(chosen) ? `It’s ${nowIn(chosen)} in ${placeName(chosen)} now. ` : ""}Paige will judge which payments are due and overdue on this calendar. Messages to customers keep following each customer’s own verified time zone.</span>
      </div>
      <div className="setup-tz__actions">
        <button type="button" className="setup-button setup-button--quiet" onClick={() => setChosen(null)} disabled={saving}>Cancel</button>
        <button type="button" className="setup-button setup-button--primary" onClick={() => void confirm()} disabled={saving}>{saving ? "Saving…" : "Save time zone"}</button>
      </div>
    </div>}

    {!value.canSet && <p className="setup-tz__note"><ShieldCheck aria-hidden/>Only the business owner can change this.</p>}
    {notice && <div ref={noticeRef} tabIndex={-1} className="setup-notice" data-tone={notice.tone} role={notice.tone === "bad" ? "alert" : "status"}>{notice.tone === "ok" ? <CheckCircle2 aria-hidden/> : <CircleHelp aria-hidden/>}<span>{notice.text}</span></div>}
  </div>;
}
