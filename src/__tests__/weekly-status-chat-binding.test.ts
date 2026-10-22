import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as automation from "../../supabase/functions/_shared/paige-spine/domains/automations";
import { interactiveEffect, interactiveRecoveryReadAllowed } from "../../supabase/functions/_shared/paige-turn/interactive";
import { PAIGE_SPINE_CAPABILITIES } from "../../supabase/functions/_shared/paige-spine/registry";

const chat = readFileSync("supabase/functions/paige-ai-chat/index.ts", "utf8");
type Offer = (context: { callerTier: string; accountShape: string | null; role: string | null;
  scopedClientId: string | null; customerPortal: boolean }) => readonly { function: { name: string; parameters: unknown } }[];
const owner = { callerTier: "tenant", accountShape: "solo", role: "owner", scopedClientId: null, customerPortal: false };
function offer() {
  const value = (automation as Record<string, unknown>).weeklyCommitmentStatusToolsForContext;
  expect(typeof value, "the original domain must own the offer boundary").toBe("function");
  return value as Offer;
}

describe("original owner-private weekly status Chat binding", () => {
  it("reuses closed-read recovery admission without granting actions or undeclared tools", () => {
    const tool = automation.WEEKLY_COMMITMENT_STATUS_TOOL_NAME;
    expect(interactiveRecoveryReadAllowed(tool, new Set([tool]), PAIGE_SPINE_CAPABILITIES)).toBe(true);
    expect(interactiveRecoveryReadAllowed(tool, new Set(), PAIGE_SPINE_CAPABILITIES)).toBe(false);
    expect(interactiveRecoveryReadAllowed(tool, new Set([tool]), [])).toBe(false);
    expect(interactiveRecoveryReadAllowed("weekly_commitment_draft", new Set(["weekly_commitment_draft"]), PAIGE_SPINE_CAPABILITIES)).toBe(false);
  });

  it("retains uncertainty for contradictory weekly results and preserves no private payload", () => {
    const tool = automation.WEEKLY_COMMITMENT_STATUS_TOOL_NAME;
    expect(interactiveEffect(tool, { status: "available", message: "PRIVATE", outcome_unknown: true }, PAIGE_SPINE_CAPABILITIES))
      .toEqual({ tool, outcome: "outcome_unknown" });
    expect(interactiveEffect(tool, { status: "available", message: "PRIVATE" }, []))
      .toEqual({ tool, outcome: "outcome_unknown" });
  });

  it("offers exactly the existing declared read with no model scope or action input", () => {
    const tools = offer()(owner);
    expect(tools).toHaveLength(1);
    expect(tools[0].function).toMatchObject({ name: "read_weekly_commitment_status",
      parameters: automation.WEEKLY_COMMITMENT_STATUS_READ_CAPABILITY.input });
    expect(tools[0].function.parameters).toMatchObject({ type: "object", properties: {}, additionalProperties: false });
    expect(automation.WEEKLY_COMMITMENT_STATUS.action).toMatchObject({ classification: "read",
      chatTool: "read_weekly_commitment_status", executor: "public.get_weekly_commitment_checks" });
  });

  it.each([
    { role: "admin" }, { role: "member" }, { role: "platform_operator" }, { role: null },
    { accountShape: "agency_parent" }, { accountShape: "subaccount" }, { accountShape: "platform" }, { accountShape: null },
    { callerTier: "operator" }, { callerTier: "client" },
    { scopedClientId: "11111111-1111-4111-8111-111111111111" }, { customerPortal: true },
  ])("withholds private weekly records for ineligible server context %j", patch => {
    expect(offer()({ ...owner, ...patch })).toEqual([]);
  });

  it("uses server facts and the original caller-JWT reader behind normal read admission", () => {
    for (const contract of [
      "weeklyCommitmentStatusToolsForContext({ callerTier, accountShape: calendarBookingAccountShape, role: taskReadRole, scopedClientId: scopedClientId ?? null, customerPortal })",
      "tc.function.name === WEEKLY_COMMITMENT_STATUS_TOOL_NAME",
      "prepareWeeklyCommitmentChatResponse(weeklyIdentity",
      "caller: supabaseClient",
    ]) expect(chat.includes(contract), contract).toBe(true);
    const readSet = chat.match(/const CONVERSATIONAL_ADMITTED_READ_TOOLS[^;]+;/)?.[0] ?? "";
    expect(readSet.includes("WEEKLY_COMMITMENT_STATUS_TOOL_NAME")).toBe(true);
    expect(/name:\s*["']read_weekly_commitment_status["']/.test(chat)).toBe(false);
    expect(chat.includes("const MAX_ROUNDS = 5, MAX_TOTAL_TOOL_CALLS = 12;")).toBe(true);
  });
});
