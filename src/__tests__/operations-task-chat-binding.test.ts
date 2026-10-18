// @vitest-environment node
import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { PAIGE_SPINE_CAPABILITIES } from "../../supabase/functions/_shared/paige-spine/registry";
import { readRecordLinks } from "../../supabase/functions/_shared/paige-turn/record-links";
import { workspaceLinkTarget } from "../lib/links/workspaceLinks";

const source = readFileSync("supabase/functions/paige-ai-chat/index.ts", "utf8");
const ast = ts.createSourceFile("chat.ts", source, ts.ScriptTarget.Latest, true);
const selected: ts.IfStatement[] = [];
function visit(node: ts.Node) {
  if (ts.isIfStatement(node) && node.expression.getText(ast) === 'tc.function.name === "crm_get_task"' && ts.isBlock(node.thenStatement)) selected.push(node);
  ts.forEachChild(node, visit);
}
visit(ast);

describe("exact Task shared Chat binding", () => {
  it("registers exactly one native caller-RLS read and no alternate Task executor", () => {
    const capabilities = PAIGE_SPINE_CAPABILITIES.filter(c => c.key === "crm_clients.task_read");
    expect(capabilities).toHaveLength(1);
    expect(capabilities[0]).toMatchObject({ domain: "crm_clients", action: { chatTool: "crm_get_task", classification: "read", executor: "public.operations_crm_work_read", seatAuthority: "member", approvalAuthority: "none", riskPolicyKey: "read_only" } });
  });
  it("binds exactly one dispatch to the existing original-JWT adapter and mandatory live scope check", () => {
    expect(selected).toHaveLength(1);
    const branch = selected[0].thenStatement.getText(ast);
    expect(branch).toContain("await readOperationsTask(taskIdentity,");
    expect(branch).toContain("caller: supabaseClient as unknown as OperationsTaskReadCaller");
    expect(branch).toContain("revalidateScope: async (signal)");
    expect(branch).toContain("revalidateTenantKnowledgeScope(true)");
    expect(branch).toContain("loadTeamAuthorityForChat(");
    expect(branch).toContain("readCalendarAccountShape(");
    expect(branch).not.toMatch(/\.from\("tasks"\)|crm_list_tasks|execute_crm_command|functions\.invoke/);
    const serviceSet = ast.statements.find(n => ts.isVariableStatement(n) && n.getText(ast).includes("const CRM_SERVICE_TOOLS"));
    expect(serviceSet?.getText(ast)).not.toContain("crm_get_task");
  });
  it("reuses the incumbent exact Task consumer and strips any injected address", () => {
    const links = readRecordLinks([{ destination: "operations_work", record_id: "00000000-0000-4000-8000-000000000003", url: "https://foreign.invalid" }]);
    expect(links).toEqual([{ destination: "operations_work", record_id: "00000000-0000-4000-8000-000000000003" }]);
    expect(workspaceLinkTarget(links[0], { account_type: "standalone", parent_tenant_id: null, account_number: "7001" })).toEqual({ label: "Open task", to: "/solo/7001/operations/work?task=00000000-0000-4000-8000-000000000003", status: "exact" });
  });
  it("persisted reference survives the actual shared decoder without claiming Task detail focus", () => {
    const historical = JSON.parse(JSON.stringify({ paige_record_links: [{ destination: "operations_work", record_id: null }] }));
    expect(readRecordLinks(historical.paige_record_links)).toEqual([{ destination: "operations_work", record_id: null }]);
    expect(readRecordLinks([{ destination: "operations_work", record_id: "foreign-data", subject: { secret: "no" } }])).toEqual([{ destination: "operations_work", record_id: null }]);
  });
});
