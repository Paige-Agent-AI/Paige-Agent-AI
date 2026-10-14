import { objectInputSchema } from "../capability-kit/schema.ts";

/** Preparation only: no declaration, approval issuance/claim, dispatcher or RPC invocation.
 * Review inputs are intent. Canonical server facts and stored RPC arguments are separate.
 * Execution must adopt the existing canonical confirmation and permission contracts,
 * with security/admission review before any schema is offered to Chat/Live.
 */
export type WeeklyControlOperation = "draft" | "configure" | "authorize" | "pause" | "resume" | "cancel";
type ScheduleIntent = { weekday: number; local_time: string; timezone: string };
export type WeeklyControlIntent = ScheduleIntent & { name: string } | ScheduleIntent & { automation_id: string } | { automation_id: string };
export type WeeklyBindingFacts = Readonly<{ requestId?: string; process?: { id: string; revision: number } }>;
export type WeeklyRpcBinding = Readonly<{ rpc: "draft_weekly_commitment_check" | "configure_weekly_commitment_check" | "control_weekly_commitment_check"; args: Readonly<Record<string, string | number>> }>;

const uuidPattern = "^[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$";
const uuid = (value: unknown): value is string => typeof value === "string" && new RegExp(uuidPattern).test(value);
const scheduleProperties = {
  weekday: { type: "integer", minimum: 1, maximum: 7, description: "ISO weekday, Monday=1." },
  local_time: { type: "string", pattern: "^([01][0-9]|2[0-3]):[0-5][0-9]$", description: "Exact local civil time, HH:mm." },
  timezone: { type: "string", minLength: 1, maxLength: 128, pattern: "^[A-Za-z0-9_+./:-]+$", description: "Requested canonical PostgreSQL time zone. Server validation remains authoritative." },
} as const;
const targetProperties = { automation_id: { type: "string", format: "uuid", pattern: uuidPattern, description: "Target address only; server must prove current tenant, owner and revision." } } as const;
const targetInput = () => objectInputSchema({ properties: targetProperties, required: ["automation_id"] });

/** Six provider-safe intent schemas; no model-supplied action enum or authority fields.
 * This is a schema collection, not a capability registry. Nothing imports it into admission.
 */
export const WEEKLY_CONTROL_REVIEW_INPUTS = Object.freeze({
  draft: objectInputSchema({ properties: { name: { type: "string", minLength: 1, maxLength: 120 }, ...scheduleProperties }, required: ["name", "weekday", "local_time", "timezone"] }),
  configure: objectInputSchema({ properties: { ...targetProperties, ...scheduleProperties }, required: ["automation_id", "weekday", "local_time", "timezone"] }),
  authorize: targetInput(), pause: targetInput(), resume: targetInput(), cancel: targetInput(),
});

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
  if (!Object.prototype.hasOwnProperty.call(WEEKLY_CONTROL_REVIEW_INPUTS, operation)) return null;
  const value = plainData(raw);
  if (!value || !exactKeys(value, WEEKLY_CONTROL_REVIEW_INPUTS[operation].required)) return null;
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

/** Produces the exact RPC arguments for future trusted issuance, not permission to call it.
 * Facts must come from the authenticated server. No receipt, execution or next run is inferred.
 */
export function bindWeeklyControlForReview(operation: WeeklyControlOperation, raw: unknown, facts: WeeklyBindingFacts): WeeklyRpcBinding | null {
  const intent = parseWeeklyControlIntent(operation, raw);
  if (!intent) return null;
  if (operation === "draft") {
    if (!uuid(facts.requestId) || !("name" in intent) || !("weekday" in intent)) return null;
    return Object.freeze({ rpc: "draft_weekly_commitment_check", args: Object.freeze({ _request_id: facts.requestId,
      _name: intent.name, _weekday: intent.weekday, _local_time: intent.local_time, _timezone: intent.timezone }) });
  }
  const process = facts.process;
  if (!process || !uuid(process.id) || !Number.isSafeInteger(process.revision) || process.revision < 1 ||
    !("automation_id" in intent) || intent.automation_id !== process.id) return null;
  if (operation === "configure" && "weekday" in intent) {
    return Object.freeze({ rpc: "configure_weekly_commitment_check", args: Object.freeze({ _automation_id: process.id,
      _weekday: intent.weekday, _local_time: intent.local_time, _timezone: intent.timezone, _expected_revision: process.revision }) });
  }
  return Object.freeze({ rpc: "control_weekly_commitment_check", args: Object.freeze({ _automation_id: process.id,
    _action: operation, _expected_revision: process.revision }) });
}
