import { localDateInZone, localMinutesInZone, nextLocalTimeInZone, parseIsoInstant } from "../../supabase/functions/_shared/paige-context/snapshot";
import type { MissionTarget } from "../../supabase/functions/_shared/business-mission-targets/contract";

/** Native input adaptation only, reusing the platform's existing civil-calendar functions. */
export function targetPeriod(startDate: string, throughDate: string, zone: string): MissionTarget["period"] | null {
  const civil = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) ? parseIsoInstant(value + "T12:00:00Z") : null;
  const start = civil(startDate), through = civil(throughDate);
  if (start === null || through === null || start > through || through - start > 3650 * 86400000) return null;
  const next = new Date(through); next.setUTCDate(next.getUTCDate() + 1);
  const midnight = (date: string): string | null => {
    let cursor = Date.parse(date + "T12:00:00Z") - 36 * 3600000;
    for (let i = 0; i < 4; i++) {
      const instant = nextLocalTimeInZone(cursor, zone, 0);
      if (instant === null) return null;
      const day = localDateInZone(instant, zone);
      if (day === date) return localMinutesInZone(instant, zone) === 0 ? new Date(instant).toISOString() : null;
      if (day === null || day > date) return null;
      cursor = instant + 1;
    }
    return null;
  };
  const from = midnight(startDate), until = midnight(next.toISOString().slice(0, 10));
  return from && until && Date.parse(from) < Date.parse(until) ? { start: from, end: until, time_zone: zone } : null;
}

function currencyDigits(currency: string | null): number | null {
  if (!currency || !/^[a-z]{3}$/.test(currency)) return null;
  try { return new Intl.NumberFormat("en-US", { style: "currency", currency }).resolvedOptions().maximumFractionDigits; }
  catch { return null; }
}

/** Decimal strings throughout: input/display conversion cannot round an authoritative target. */
export function targetValue(raw: string, kind: MissionTarget["metric"]["value_kind"], currency: string | null): string | null {
  const value = raw.trim();
  if (!/^-?(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(value) || value.length > 64) return null;
  if (kind === "count") return /^(0|[1-9][0-9]*)$/.test(value) ? value : null;
  if (kind === "decimal") return value;
  const digits = currencyDigits(currency); if (digits === null) return null;
  const negative = value.startsWith("-"), [whole, fraction = ""] = (negative ? value.slice(1) : value).split(".");
  if (fraction.length > digits) return null;
  const minor = (BigInt(whole + fraction.padEnd(digits, "0")) * (negative ? -1n : 1n)).toString();
  return minor.length <= 64 ? minor : null;
}

export function formatTargetValue(value: string, kind: MissionTarget["metric"]["value_kind"], currency: string | null): string {
  if (kind !== "currency_totals") return value;
  const digits = currencyDigits(currency);
  if (digits === null || !/^-?(0|[1-9][0-9]*)$/.test(value)) return "Unavailable";
  const negative = value.startsWith("-"), padded = (negative ? value.slice(1) : value).padStart(digits + 1, "0");
  const amount = digits ? padded.slice(0, -digits) + "." + padded.slice(-digits) : padded;
  return `${currency!.toUpperCase()} ${negative ? "-" : ""}${amount}`;
}
