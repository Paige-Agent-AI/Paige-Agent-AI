import { objectInputSchema } from "../capability-kit/schema.ts";
import { parseWeeklyControlIntent, uuid, uuidPattern, WEEKLY_CONTROL_INTENT_KEYS, type WeeklyControlOperation } from "./weekly-commitment-control-intent.ts";
export { parseWeeklyControlIntent } from "./weekly-commitment-control-intent.ts";
export type { WeeklyControlOperation, WeeklyControlIntent } from "./weekly-commitment-control-intent.ts";

/** Preparation only: no declaration, approval issuance/claim, dispatcher or RPC invocation.
 * Review inputs are intent. Canonical server facts and stored RPC arguments are separate.
 * Execution must adopt the existing canonical confirmation and permission contracts,
 * with security/admission review before any schema is offered to Chat/Live.
 */
export type WeeklyBindingFacts = Readonly<{ requestId?: string; process?: { id: string; revision: number } }>;
export type WeeklyRpcBinding = Readonly<{ rpc: "draft_weekly_commitment_check" | "configure_weekly_commitment_check" | "control_weekly_commitment_check"; args: Readonly<Record<string, string | number>> }>;

const scheduleProperties = {
  weekday: { type: "integer", minimum: 1, maximum: 7, description: "ISO weekday, Monday=1." },
  local_time: { type: "string", pattern: "^([01][0-9]|2[0-3]):[0-5][0-9]$", description: "Exact local civil time, HH:mm." },
  timezone: { type: "string", minLength: 1, maxLength: 128, pattern: "^[A-Za-z0-9_+./:-]+$", description: "Requested canonical PostgreSQL time zone. Server validation remains authoritative." },
} as const;
const targetProperties = { automation_id: { type: "string", format: "uuid", pattern: uuidPattern, description: "Target address only; server must prove current tenant, owner and revision." } } as const;
const targetInput = () => objectInputSchema({ properties: targetProperties, required: WEEKLY_CONTROL_INTENT_KEYS.authorize });

/** Six provider-safe intent schemas; no model-supplied action enum or authority fields.
 * This is a schema collection, not a capability registry. Nothing imports it into admission.
 */
export const WEEKLY_CONTROL_REVIEW_INPUTS = Object.freeze({
  draft: objectInputSchema({ properties: { name: { type: "string", minLength: 1, maxLength: 120 }, ...scheduleProperties }, required: WEEKLY_CONTROL_INTENT_KEYS.draft }),
  configure: objectInputSchema({ properties: { ...targetProperties, ...scheduleProperties }, required: WEEKLY_CONTROL_INTENT_KEYS.configure }),
  authorize: targetInput(), pause: targetInput(), resume: targetInput(), cancel: targetInput(),
});

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
