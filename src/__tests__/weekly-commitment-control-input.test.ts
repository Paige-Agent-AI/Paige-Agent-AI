import { describe, expect, it } from "vitest";
import { isCapabilityInputSchema } from "../../supabase/functions/_shared/capability-kit/schema";
import { bindWeeklyControlForReview, parseWeeklyControlIntent, WEEKLY_CONTROL_REVIEW_INPUTS,
  type WeeklyControlOperation } from "../../supabase/functions/_shared/paige-orchestration/weekly-commitment-control-input";

const processId = "20000000-0000-4000-8000-000000000001";
const requestId = "10000000-0000-4000-8000-000000000001";
const schedule = { weekday: 1, local_time: "09:00", timezone: "America/New_York" };
const operations: WeeklyControlOperation[] = ["draft", "configure", "authorize", "pause", "resume", "cancel"];
const intent = (operation: WeeklyControlOperation) => operation === "draft" ? { name: "Weekly commitment check", ...schedule }
  : operation === "configure" ? { automation_id: processId, ...schedule } : { automation_id: processId };
const facts = { requestId, process: { id: processId, revision: 3 } };

describe("unregistered weekly review inputs and canonical RPC bindings", () => {
  it.each(operations)("%s uses the existing closed Kit schema without authority fields", operation => {
    const schema = WEEKLY_CONTROL_REVIEW_INPUTS[operation];
    expect(isCapabilityInputSchema(schema)).toBe(true);
    expect(schema.additionalProperties).toBe(false);
    expect(Object.isFrozen(schema)).toBe(true);
    expect(schema.required).toEqual(Object.keys(schema.properties));
    expect(Object.keys(schema.properties)).not.toEqual(expect.arrayContaining(["revision", "tenant_id", "actor_id", "confirm"]));
    expect(parseWeeklyControlIntent(operation, intent(operation))).not.toBeNull();
  });
  it.each(operations)("%s refuses browser/model-supplied authority, action and confirmation selectors", operation => {
    for (const field of ["tenant_id", "actor_id", "expected_revision", "permission", "autonomy_lane", "action", "confirm", "confirmation_id", "fingerprint", "request_id"]) {
      expect(parseWeeklyControlIntent(operation, { ...intent(operation), [field]: "forged" })).toBeNull();
    }
  });
  it.each(operations)("%s rejects missing fields, prototype values and getters", operation => {
    expect(parseWeeklyControlIntent(operation, {})).toBeNull();
    expect(parseWeeklyControlIntent(operation, Object.create(intent(operation)))).toBeNull();
    const getter = { ...intent(operation) };
    Object.defineProperty(getter, Object.keys(getter)[0], { enumerable: true, get() { throw new Error("untrusted getter was executed"); } });
    expect(parseWeeklyControlIntent(operation, getter)).toBeNull();
    expect(parseWeeklyControlIntent(operation, [intent(operation)])).toBeNull();
  });
  it("binds the canonical draft request ID only from server facts, without claiming persistence", () => {
    expect(bindWeeklyControlForReview("draft", intent("draft"), {})).toBeNull();
    expect(bindWeeklyControlForReview("draft", intent("draft"), { requestId: "invented" })).toBeNull();
    expect(bindWeeklyControlForReview("draft", intent("draft"), facts)).toEqual({ rpc: "draft_weekly_commitment_check", args: {
      _request_id: requestId, _name: "Weekly commitment check", _weekday: 1, _local_time: "09:00", _timezone: "America/New_York",
    } });
  });
  it("binds configure to the exact addressed canonical process and server revision", () => {
    expect(bindWeeklyControlForReview("configure", intent("configure"), facts)).toEqual({ rpc: "configure_weekly_commitment_check", args: {
      _automation_id: processId, _weekday: 1, _local_time: "09:00", _timezone: "America/New_York", _expected_revision: 3,
    } });
    expect(bindWeeklyControlForReview("configure", { ...intent("configure"), expected_revision: 99 }, facts)).toBeNull();
  });
  it.each(["authorize", "pause", "resume", "cancel"] as const)("%s fixes the RPC action rather than consuming an action enum", operation => {
    expect(bindWeeklyControlForReview(operation, intent(operation), facts)).toEqual({ rpc: "control_weekly_commitment_check", args: {
      _automation_id: processId, _action: operation, _expected_revision: 3,
    } });
    expect(bindWeeklyControlForReview(operation, { ...intent(operation), action: "authorize" }, facts)).toBeNull();
  });
  it.each(["configure", "authorize", "pause", "resume", "cancel"] as const)("%s refuses missing, mismatched or unsafe canonical revisions", operation => {
    expect(bindWeeklyControlForReview(operation, intent(operation), {})).toBeNull();
    expect(bindWeeklyControlForReview(operation, intent(operation), { process: { id: requestId, revision: 3 } })).toBeNull();
    for (const revision of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
      expect(bindWeeklyControlForReview(operation, intent(operation), { process: { id: processId, revision } })).toBeNull();
    }
  });
  it("keeps civil time and canonical zone names exact without browser recurrence or ICU assumptions", () => {
    for (const timezone of ["CET", "EST", "UTC", "America/New_York", "Pacific/Auckland"]) {
      const binding = bindWeeklyControlForReview("draft", { ...intent("draft"), timezone }, facts);
      expect(binding?.args._timezone).toBe(timezone);
      expect(binding?.args._local_time).toBe("09:00");
      expect(binding?.args).not.toHaveProperty("next_run_at");
    }
    for (const patch of [{ weekday: 0 }, { weekday: 8 }, { weekday: "1" }, { local_time: "9:00" }, { local_time: "24:00" }, { timezone: "posix/UTC" }, { timezone: "right/UTC" }, { timezone: "<script>" }]) {
      expect(parseWeeklyControlIntent("draft", { ...intent("draft"), ...patch })).toBeNull();
    }
  });
  it("does not mutate proposal/server facts or return mutable RPC argument objects", () => {
    const raw = intent("configure");
    const before = JSON.stringify({ raw, facts });
    const binding = bindWeeklyControlForReview("configure", raw, facts);
    expect(JSON.stringify({ raw, facts })).toBe(before);
    expect(Object.isFrozen(binding)).toBe(true);
    expect(Object.isFrozen(binding?.args)).toBe(true);
  });
  it("refuses unknown operations and malformed target addresses", () => {
    for (const operation of ["run_now", "constructor", "__proto__"]) expect(parseWeeklyControlIntent(operation as WeeklyControlOperation, {})).toBeNull();
    expect(parseWeeklyControlIntent("pause", { automation_id: "javascript:alert(1)" })).toBeNull();
    expect(parseWeeklyControlIntent("draft", { ...intent("draft"), name: "   " })).toBeNull();
  });
});
