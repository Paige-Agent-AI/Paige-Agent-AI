/** Exact future instruction shared by the original door and its post editor.
 * Civil time is never silently shifted through a DST gap or fold. */
export type SocialSchedule = {
  scheduled_for: string;
  timezone: string;
  civil_time: string;
  offset_minutes: number;
  disambiguation: "unique" | "earlier" | "later";
};
export const SOCIAL_SCHEDULE_LEAD_MS = 120_000;
const KEYS = ["scheduled_for", "timezone", "civil_time", "offset_minutes", "disambiguation"].sort();
export const SOCIAL_SCHEDULE_SCHEMA = { type: "object", additionalProperties: false, properties: {
  scheduled_for: {type:"string",description:"Exact UTC instant, ISO 8601 with milliseconds and Z."}, timezone:{type:"string",description:"Chosen IANA zone."},
  civil_time:{type:"string",description:"Chosen wall-clock YYYY-MM-DDTHH:mm."},offset_minutes:{type:"integer"},disambiguation:{type:"string",enum:["unique","earlier","later"]},
},required:["scheduled_for","timezone","civil_time","offset_minutes","disambiguation"] } as const;
const CIVIL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
function formatter(zone: string) {
  if (typeof zone !== "string" || zone.length > 100 || !/^(UTC|[A-Za-z_+-]+(?:\/[A-Za-z0-9_+.-]+)+)$/.test(zone)) throw Error("Choose an IANA time zone.");
  return new Intl.DateTimeFormat("en-CA", { timeZone: zone, calendar: "iso8601", numberingSystem: "latn", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
}
function localAt(format: Intl.DateTimeFormat, instant: number) {
  const parts = format.formatToParts(instant);
  const p = (key: string) => parts.find(part => part.type === key)?.value;
  return `${p("year")}-${p("month")}-${p("day")}T${p("hour")}:${p("minute")}`;
}
export function socialScheduleChoices(civil: string, timezone: string): SocialSchedule[] {
  if (typeof civil !== "string" || !CIVIL.test(civil)) throw Error("Choose a date and time.");
  const nominal = Date.parse(`${civil}:00.000Z`);
  if (!Number.isFinite(nominal) || new Date(nominal).toISOString().slice(0, 16) !== civil) throw Error("Choose a valid date and time.");
  const format = formatter(timezone), offsets = new Set<number>();
  // Observe both sides of every contemporary IANA clock transition; verify each
  // candidate against the requested civil time rather than assuming a fixed offset.
  for (let hours = -36; hours <= 36; hours += 6) {
    const instant = nominal + hours * 3_600_000;
    offsets.add((Date.parse(`${localAt(format, instant)}:00.000Z`) - instant) / 60_000);
  }
  const candidates = [...offsets].map(offset => ({ offset, instant: nominal - offset * 60_000 }))
    .filter(x => Number.isSafeInteger(x.offset) && localAt(format, x.instant) === civil)
    .sort((a, b) => a.instant - b.instant);
  return candidates.map((x, index) => ({ scheduled_for: new Date(x.instant).toISOString(), timezone, civil_time: civil,
    offset_minutes: x.offset, disambiguation: candidates.length === 1 ? "unique" : index === 0 ? "earlier" : "later" }));
}
export function readSocialSchedule(value: unknown, now?: number): SocialSchedule | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (JSON.stringify(Object.keys(row).sort()) !== JSON.stringify(KEYS)) return null;
  try {
    const choices = socialScheduleChoices(row.civil_time as string, row.timezone as string);
    const choice = choices.find(c => KEYS.every(key => c[key as keyof SocialSchedule] === row[key]));
    return choice && (now === undefined || Date.parse(choice.scheduled_for) > now + SOCIAL_SCHEDULE_LEAD_MS) ? choice : null;
  } catch { return null; }
}
/** Native proposal args store this snapshot as a scalar so exact-argument claims
 * retain the original door's comparison contract. */
export function storedSocialSchedule(value: unknown, now?: number): SocialSchedule | null {
  if (typeof value !== "string") return null;
  try { return readSocialSchedule(JSON.parse(value), now); } catch { return null; }
}
export function socialScheduleLabel(schedule: SocialSchedule): string {
  const sign = schedule.offset_minutes >= 0 ? "+" : "-", minutes = Math.abs(schedule.offset_minutes);
  return `${schedule.civil_time.replace("T", " ")} ${schedule.timezone} (UTC${sign}${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}${schedule.disambiguation === "unique" ? "" : `, ${schedule.disambiguation} occurrence`})`;
}
