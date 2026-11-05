import { test } from "node:test";
import assert from "node:assert/strict";
import { planningModelPlans } from "./weekly-plan-read-projection.ts";
import { readRecordLinks } from "../paige-turn/record-links.ts";
import { resolveCanonicalRecordLink } from "../canonical-app-url.ts";
const id = "e5020000-0000-4000-8000-000000000001";
test("original saved Plan projection keeps references and avoids copying internal save/review data into model context", () => {
  const raw = { id, title: "Original Plan", metadata: { existing: "preserve", weekly_plan_review_v1: { request_id: id, receipt_run_id: id, review: { v: 1, included: [`crm:${id}`], sources: [{ secret: "do not copy" }], capacity_minutes: { owner: 60 } } } } };
  const value = planningModelPlans([raw])[0] as typeof raw & { weekly_plan_review: { original_work_references: string[] } };
  assert.equal(value.id, id); assert.equal(value.metadata.existing, "preserve"); assert.deepEqual(value.weekly_plan_review.original_work_references, [`crm:${id}`]);
  assert.ok(!JSON.stringify(value).includes("do not copy")); assert.equal(raw.metadata.weekly_plan_review_v1.request_id, id);
});
test("typed Plan and review references never become CRM Task identity, foreign account or another shell", () => {
  assert.deepEqual(readRecordLinks([{ destination: "operations_work", record_id: id, record_kind: "planning_plan", subject: "ignored" }]), [{ destination: "operations_work", record_id: id, record_kind: "planning_plan" }]);
  assert.deepEqual(readRecordLinks([{ destination: "operations_work", record_id: "not-an-id", record_kind: "planning_plan" }]), []);
  assert.equal(resolveCanonicalRecordLink({ actor: "account", tier: "solo", account: "123456", destination: "operations_work", recordKind: "planning_plan", recordId: id })?.path, `/solo/123456/operations/projects?planningPlan=${id}`);
  assert.equal(resolveCanonicalRecordLink({ actor: "account", tier: "agency", account: "123456", destination: "operations_work", recordKind: "planning_plan", recordId: id }), null);
  assert.equal(resolveCanonicalRecordLink({ actor: "account", tier: "solo", account: "123456", destination: "operations_weekly_plan" })?.path, "/solo/123456/operations/overview?weeklyPlan=review");
  assert.equal(resolveCanonicalRecordLink({ actor: "operator", tier: "operator", destination: "operations_weekly_plan" }), null);
});
