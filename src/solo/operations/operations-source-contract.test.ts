import { expect, it } from "vitest";
import type { Plan, PlanItem } from "@/hooks/usePlanList";
import { operationsBundleMatchesTenant, operationsAssignmentCounts } from "./operations-source-contract";

const item = (tenant_id: string, plan_id: string | null = null, status = "open") =>
  ({ tenant_id, plan_id, status, assigned_to_user_id: "test-user" } as PlanItem);
it("rejects wrong-tenant nested and loose work and mismatched project parentage", () => {
  const plan = { id: "p", tenant_id: "test-tenant", items: [item("test-tenant", "p")] } as Plan;
  expect(operationsBundleMatchesTenant([plan], [item("test-tenant")], "test-tenant")).toBe(true);
  expect(operationsBundleMatchesTenant([plan], [item("other")], "test-tenant")).toBe(false);
  expect(operationsBundleMatchesTenant([{ ...plan, items: [item("other", "p")] }], [], "test-tenant")).toBe(false);
  expect(operationsBundleMatchesTenant([{ ...plan, items: [item("test-tenant", "wrong")] }], [], "test-tenant")).toBe(false);
});
it("excludes completed/cancelled items from current assignments without inventing capacity", () => {
  const result = operationsAssignmentCounts([
    item("test-tenant"), item("test-tenant", null, "blocked"),
    item("test-tenant", null, "done"), item("test-tenant", null, "cancelled"),
  ], "test-user");
  expect(result.assigned).toHaveLength(2);
  expect(result.blocked).toBe(1);
  expect(result).not.toHaveProperty("utilization");
});
