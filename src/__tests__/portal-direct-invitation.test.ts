import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// Execute the actual legacy caller closure, with no UI/network or replacement writer.
const file = ts.createSourceFile("ClientManagementDashboard.tsx", readFileSync("src/components/dashboard/ClientManagementDashboard.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let action: ts.ArrowFunction | undefined;
function visit(node: ts.Node) { if (ts.isVariableDeclaration(node) && node.name.getText(file) === "sendInvite" && node.initializer && ts.isArrowFunction(node.initializer)) action = node.initializer; ts.forEachChild(node, visit); }
visit(file);
if (!action) throw Error("Review the changed direct invitation caller boundary");
const js = ts.transpileModule(`const sendInvite=${action.getText(file)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
type Options = { email?: string; role?: string; allowed?: boolean; tenant?: string | null; preparationError?: boolean; missingContact?: boolean; foreignContact?: boolean; readError?: boolean; mintError?: boolean; missingToken?: boolean; sendError?: boolean; emailed?: boolean };
async function drive(options: Options = {}) {
  const calls: { name: string; args?: unknown }[] = [], notices: { level: string; message: string }[] = [];
  const tenant = options.tenant === undefined ? "test-business-a" : options.tenant;
  const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: { id: "test-client", tenant_id: options.foreignContact ? "test-business-b" : tenant }, error: options.readError ? Error("Client read unavailable") : null }) };
  const supabase = {
    from: (table: string) => { expect(table).toBe("clients"); return q; },
    rpc: async (name: string, args: unknown) => {
      calls.push({ name, args });
      if (name === "create_contact_v2") return { data: options.missingContact ? [] : [{ contact_id: "test-client" }], error: options.preparationError ? Error("Contact refused") : null };
      if (name === "create_tenant_invite_token") return { data: options.missingToken ? [] : [{ token: "synthetic-token" }], error: options.mintError ? Error("Mint refused") : null };
      throw Error("Unexpected RPC");
    },
    functions: { invoke: async (name: string, args: unknown) => { calls.push({ name, args }); return { data: options.emailed === undefined ? {} : { emailed: options.emailed }, error: options.sendError ? Error("Delivery unavailable") : null }; } },
    auth: { getSession: async () => ({ data: { session: { access_token: "synthetic-only" } } }) },
  };
  const toast = Object.fromEntries(["error", "warning", "success"].map(level => [level, (message: string) => notices.push({ level, message })]));
  const run = new Function("supabase", "toast", "inviteEmail", "inviteRole", "canInvitePortal", "activeTenantId", "setInviteSending", "setInviteOpen", "setInviteEmail", "setInviteRole", "console", js + ";return sendInvite;")(
    supabase, toast, options.email ?? " Client@tests.invalid ", options.role ?? "user", options.allowed !== false, tenant, () => {}, () => {}, () => {}, () => {}, { error() {} });
  await run(); return { calls, notices };
}
describe("Existing direct Client invitation compatibility", () => {
  it("resolves the canonical contact before minting a recipient-bound invitation", async () => {
    const r = await drive({ emailed: true });
    expect(r.calls.map(c => c.name)).toEqual(["create_contact_v2", "create_tenant_invite_token", "send-portal-invite"]);
    expect(r.calls[0].args).toMatchObject({ p_first_name: "", p_email: "client@tests.invalid", p_tenant_id: "test-business-a" });
    expect(r.calls[1].args).toMatchObject({ _contact_id: "test-client", _tenant_id: "test-business-a", _email: "client@tests.invalid", _kind: "consumer" });
    expect(r.calls[2].args).toEqual({ body: { token: "synthetic-token", email: "client@tests.invalid" } });
    expect(r.notices.at(-1)?.level).toBe("success");
  });
  for (const [label, options] of Object.entries({ empty: { email: " " }, noBusiness: { tenant: null }, tier: { allowed: false }, preparation: { preparationError: true }, missingContact: { missingContact: true }, foreignContact: { foreignContact: true }, read: { readError: true }, mint: { mintError: true }, missingToken: { missingToken: true } })) {
    it("refuses " + label + " without invoking a sender or claiming success", async () => {
      const r = await drive(options); expect(r.calls.some(c => c.name === "send-portal-invite")).toBe(false); expect(r.notices.some(n => n.level === "success")).toBe(false);
    });
  }
  it.each([false, undefined])("does not claim delivery from emailed=%s", async emailed => {
    const r = await drive({ emailed }); expect(r.notices.at(-1)?.level).toBe("warning"); expect(r.notices.some(n => n.level === "success")).toBe(false);
  });
  it("treats an invocation error as a failure, without retrying an unknown send", async () => {
    const r = await drive({ sendError: true }); expect(r.notices.at(-1)?.level).toBe("error"); expect(r.calls.filter(c => c.name === "send-portal-invite")).toHaveLength(1);
  });
  it("keeps the existing staff invitation path separate", async () => {
    const r = await drive({ role: "moderator" }); expect(r.calls.map(c => c.name)).toEqual(["send-admin-invitation"]);
  });
});
