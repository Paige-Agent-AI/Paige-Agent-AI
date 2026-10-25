// @vitest-environment node
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { OWNER_TASK_HISTORY_READ, OWNER_TASK_HISTORY_READ_CAPABILITY, OWNER_TASK_HISTORY_TOOLS, ownerTaskHistoryToolsForContext } from "../../supabase/functions/_shared/paige-spine/domains/automations";

const eligible = { callerTier: "tenant", accountShape: "solo", role: "owner", scopedClientId: null, customerPortal: false };
describe("original task-history Chat binding", () => {
  it.each(["owner", "admin"])("offers only the original read for a current eligible %s", role => {
    expect(ownerTaskHistoryToolsForContext({ ...eligible, role })).toBe(OWNER_TASK_HISTORY_TOOLS);
    expect(OWNER_TASK_HISTORY_READ).toMatchObject({ key: "automations.owner_task_history", owner: "experience-05", maturity: "PARTIAL",
      action: { classification: "read", chatTool: "read_owner_task_act", riskPolicyKey: "read_only", approvalAuthority: "none", executor: "public.read_owner_task_act" } });
    expect(OWNER_TASK_HISTORY_READ_CAPABILITY).toMatchObject({ effect: "read", governance: { approval: "none", risk: "read_only" } });
    expect(OWNER_TASK_HISTORY_TOOLS[0].function.parameters.required).toEqual(["approval_id"]);
    expect(Object.keys(OWNER_TASK_HISTORY_TOOLS[0].function.parameters.properties)).toEqual(["approval_id"]);
    expect(OWNER_TASK_HISTORY_TOOLS[0].function.parameters.additionalProperties).toBe(false);
  });
  it.each([{ role: "member" }, { role: null }, { callerTier: "operator" }, { accountShape: null },
    { accountShape: "agency" }, { scopedClientId: "foreign-client" }, { customerPortal: true }])("does not offer owner history under an ineligible context %j", change => {
    expect(ownerTaskHistoryToolsForContext({ ...eligible, ...change })).toEqual([]);
  });
  it("exercises the original full Chat handler, approvals, receipt and scope withdrawal without effects", () => {
    const keys = ["SystemRoot", "SYSTEMROOT", "WINDIR", "PATH", "Path", "PATHEXT", "COMSPEC", "TEMP", "TMP"];
    const env = Object.fromEntries(keys.filter(key => process.env[key] !== undefined).map(key => [key, process.env[key] as string]));
    const output = execFileSync(process.execPath, ["--import", "./scripts/knowledge-scope/register.mjs", "scripts/proof/owner-task-history-chat.mjs"],
      { cwd: process.cwd(), env, encoding: "utf8", windowsHide: true, timeout: 120000, stdio: ["ignore", "pipe", "pipe"] });
    expect(output).toContain("RESULT 16 PASS / 0 FAIL");
    expect(output).toContain("PASS workspace withdrawal afterReceipt suppresses original model egress");
    expect(output).toContain("PASS recorded executed state without original receipt remains unconfirmed");
  }, 130000);
});
