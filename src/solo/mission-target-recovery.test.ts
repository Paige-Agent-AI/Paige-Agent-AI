// @vitest-environment node
import { describe, expect, it } from "vitest";
import { retainTargetAttempt, readTargetAttempt, settleTargetAttempt, type TargetAttempt } from "./mission-target-recovery";

const scope = { actorId: "11111111-1111-4111-8111-111111111111", tenantId: "22222222-2222-4222-8222-222222222222", missionId: "33333333-3333-4333-8333-333333333333" };
const attempt: TargetAttempt = { version: 1, scope, tool: "mission_target_transition", args: {
  mission_id: scope.missionId, request_key: "44444444-4444-4444-8444-444444444444", expected_mission_revision: 2,
  target_id: "55555555-5555-4555-8555-555555555555", expected_target_revision: 3, to_state: "paused", reason: "Review strategy" } };
function storage() { const values = new Map<string, string>(); return { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v); }, removeItem: (k: string) => { values.delete(k); } }; }
describe("tab-local target intent retention, never authority or domain truth", () => {
  it("preserves the exact original request and revisions across a new reader/reload", () => {
    const s = storage(); expect(retainTargetAttempt(s, scope, attempt)).toBe(true);
    expect(readTargetAttempt(s, scope)).toEqual({ kind: "retained", attempt });
  });
  it.each(["actorId", "tenantId", "missionId"] as const)("does not reveal another %s's intent", field => {
    const s = storage(); retainTargetAttempt(s, scope, attempt);
    expect(readTargetAttempt(s, { ...scope, [field]: attempt.args.target_id as string })).toEqual({ kind: "absent" });
    expect(readTargetAttempt(s, scope)).toEqual({ kind: "retained", attempt });
  });
  it("cannot replace a pending attempt with a new key, revision or changed reason", () => {
    const s = storage(); retainTargetAttempt(s, scope, attempt);
    for (const patch of [{ request_key: scope.actorId }, { expected_target_revision: 4 }, { reason: "New intent" }]) {
      expect(retainTargetAttempt(s, scope, { ...attempt, args: { ...attempt.args, ...patch } })).toBe(false);
    }
    expect(retainTargetAttempt(s, scope, attempt)).toBe(true);
    expect(readTargetAttempt(s, scope)).toEqual({ kind: "retained", attempt });
  });
  it("clears only the original settled request, without editing any business record", () => {
    const s = storage(); retainTargetAttempt(s, scope, attempt);
    expect(settleTargetAttempt(s, scope, scope.actorId)).toBe(false);
    expect(settleTargetAttempt(s, scope, String(attempt.args.request_key))).toBe(true);
    expect(readTargetAttempt(s, scope)).toEqual({ kind: "absent" });
  });
  it("fails closed when storage cannot durably read back the intent", () => {
    const s = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
    expect(retainTargetAttempt(s, scope, attempt)).toBe(false);
  });
  it("does not overwrite corrupted or mismatched retained intent", () => {
    const s = { getItem: () => "{bad", setItem: () => { throw Error("Must not overwrite"); }, removeItem: () => { throw Error("Must not clear"); } };
    expect(readTargetAttempt(s, scope)).toEqual({ kind: "unavailable" });
    expect(retainTargetAttempt(s, scope, attempt)).toBe(false);
    expect(settleTargetAttempt(s, scope, String(attempt.args.request_key))).toBe(false);
  });
});
