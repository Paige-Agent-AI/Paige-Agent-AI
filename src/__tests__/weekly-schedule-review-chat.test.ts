import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import * as domain from "../../supabase/functions/_shared/paige-spine/domains/automations";
import { WEEKLY_CONTROL_REVIEW_INPUTS } from "../../supabase/functions/_shared/paige-orchestration/weekly-commitment-control-input";
import { PAIGE_SPINE_CAPABILITIES } from "../../supabase/functions/_shared/paige-spine/registry";
import { interactiveEffect } from "../../supabase/functions/_shared/paige-turn/interactive";

const owner = { callerTier: "tenant", accountShape: "solo", role: "owner", scopedClientId: null, customerPortal: false };
type Offer = (context: typeof owner | Record<string, unknown>) => { function: { name: string; parameters: unknown } }[];
function offer() {
  const fn = (domain as Record<string, unknown>).weeklyScheduleReviewToolsForContext;
  expect(typeof fn, "original domain must own current-context review admission").toBe("function");
  return fn as Offer;
}
it("offers only the original configure intent, never revision, authority, request or RPC arguments", () => {
  const tools = offer()(owner);
  expect(tools).toHaveLength(1);
  expect(tools[0].function).toMatchObject({ name: "read_weekly_schedule_review", parameters: WEEKLY_CONTROL_REVIEW_INPUTS.configure });
  expect(tools[0].function.parameters).toMatchObject({ additionalProperties: false,
    required: ["automation_id", "weekday", "local_time", "timezone"] });
  expect(PAIGE_SPINE_CAPABILITIES.find(c => c.key === "automations.weekly_schedule_review")?.action)
    .toMatchObject({ classification: "read", executor: "public.get_weekly_commitment_checks", approvalAuthority: "none" });
});
it.each([{ role: "admin" }, { role: "member" }, { role: null }, { callerTier: "operator" }, { callerTier: "client" },
  { accountShape: "agency_parent" }, { accountShape: "subaccount" }, { accountShape: "platform" }, { accountShape: null },
  { scopedClientId: "foreign-client" }, { customerPortal: true }])("withholds review for %j", patch => {
  expect(offer()({ ...owner, ...patch })).toEqual([]);
});
it("binds the original read consumer under existing server identity, budget and current scope", () => {
  const chat = readFileSync("supabase/functions/paige-ai-chat/index.ts", "utf8");
  for (const contract of ["weeklyScheduleReviewToolsForContext", "tc.function.name === WEEKLY_SCHEDULE_REVIEW_TOOL_NAME",
    "prepareWeeklyScheduleReviewChatResponse(weeklyReviewIdentity", "caller: supabaseClient",
    "weeklyDraftRuntime()?.intentId", "WALL_CLOCK_MS - (Date.now() - startedAt)"])
    expect(chat.includes(contract), contract).toBe(true);
  expect(chat).toContain('if (risk === "owner_only")');
});
it("records a completed inspection, never a changed schedule or action receipt", () => {
  expect(interactiveEffect("read_weekly_schedule_review", { status: "available", message: "Preview only", review: {} }, PAIGE_SPINE_CAPABILITIES))
    .toEqual({ tool: "read_weekly_schedule_review", outcome: "reported_success" });
  expect(interactiveEffect("read_weekly_schedule_review", { status: "unavailable", message: "Not verified" }, PAIGE_SPINE_CAPABILITIES))
    .toEqual({ tool: "read_weekly_schedule_review", outcome: "reported_failure" });
});
