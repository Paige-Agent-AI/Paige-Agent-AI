/** Pure shared intent validation: no Kit, server runtime, authority, RPC or persistence. */
export type WeeklyControlOperation = "draft" | "configure" | "authorize" | "pause" | "resume" | "cancel";
type ScheduleIntent = { weekday: number; local_time: string; timezone: string };
export type WeeklyControlIntent = ScheduleIntent & { name: string } | ScheduleIntent & { automation_id: string } | { automation_id: string };

export const WEEKLY_CONTROL_INTENT_KEYS = Object.freeze({
  draft: Object.freeze(['name', 'weekday', 'local_time', 'timezone'] as const),
  configure: Object.freeze(['automation_id', 'weekday', 'local_time', 'timezone'] as const),
  authorize: Object.freeze(['automation_id'] as const), pause: Object.freeze(['automation_id'] as const),
  resume: Object.freeze(['automation_id'] as const), cancel: Object.freeze(['automation_id'] as const),
});

export const uuidPattern = "^[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$";
export const uuid = (value: unknown): value is string => typeof value === "string" && new RegExp(uuidPattern).test(value);

function plainData(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  if (Reflect.ownKeys(value).some(key => typeof key !== "string")) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.values(descriptors).some(descriptor => !("value" in descriptor) || !descriptor.enumerable)) return null;
  return value as Record<string, unknown>;
}
function exactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  const keys = Object.keys(value);
  return keys.length === expected.length && keys.every(key => expected.includes(key));
}
function parseSchedule(value: Record<string, unknown>): ScheduleIntent | null {
  if (typeof value.weekday !== "number" || !Number.isInteger(value.weekday) || value.weekday < 1 || value.weekday > 7 ||
    typeof value.local_time !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value.local_time) ||
    typeof value.timezone !== "string" || value.timezone.length < 1 || value.timezone.length > 128 ||
    !/^[A-Za-z0-9_+./:-]+$/.test(value.timezone) || /^(posix|right)\//.test(value.timezone)) return null;
  // Do not use browser ICU to overrule PostgreSQL, normalize the approved zone, or calculate next.
  return { weekday: value.weekday, local_time: value.local_time, timezone: value.timezone };
}
export function parseWeeklyControlIntent(operation: WeeklyControlOperation, raw: unknown): Readonly<WeeklyControlIntent> | null {
  if (!Object.prototype.hasOwnProperty.call(WEEKLY_CONTROL_INTENT_KEYS, operation)) return null;
  const value = plainData(raw);
  if (!value || !exactKeys(value, WEEKLY_CONTROL_INTENT_KEYS[operation])) return null;
  if (operation === "draft") {
    const schedule = parseSchedule(value);
    if (!schedule || typeof value.name !== "string" || value.name.length > 120 || value.name.trim().length < 1) return null;
    return Object.freeze({ name: value.name.trim(), ...schedule });
  }
  if (!uuid(value.automation_id)) return null;
  if (operation === "configure") {
    const schedule = parseSchedule(value);
    return schedule ? Object.freeze({ automation_id: value.automation_id, ...schedule }) : null;
  }
  return Object.freeze({ automation_id: value.automation_id });
}
