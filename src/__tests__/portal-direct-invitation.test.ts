import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { isLegacyInviteHeld, legacyInviteHeldText, readLegacyInviteSend } from "@/lib/portal/legacyInviteSend";

// Execute the actual legacy caller closure, with no UI/network or replacement writer.
const file = ts.createSourceFile("ClientManagementDashboard.tsx", readFileSync("src/components/dashboard/ClientManagementDashboard.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let action: ts.ArrowFunction | undefined;
function visit(node: ts.Node) { if (ts.isVariableDeclaration(node) && node.name.getText(file) === "sendInvite" && node.initializer && ts.isArrowFunction(node.initializer)) action = node.initializer; ts.forEachChild(node, visit); }
visit(file);
if (!action) throw Error("Review the changed direct invitation caller boundary");
const js = ts.transpileModule(`const sendInvite=${action.getText(file)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
type Options = { email?: string; role?: string; allowed?: boolean; tenant?: string | null; preparationError?: boolean; missingContact?: boolean; foreignContact?: boolean; readError?: boolean; mintError?: boolean; missingToken?: boolean; sendError?: boolean; emailed?: boolean; held?: boolean };
async function drive(options: Options = {}) {
  const calls: { name: string; args?: unknown }[] = [], notices: { level: string; message: string }[] = [];
  const tenant = options.tenant === undefined ? "test-business-a" : options.tenant;
  const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: { id: "test-client", tenant_id: options.foreignContact ? "test-business-b" : tenant }, error: options.readError ? Error("Client read unavailable") : null }) };
  const supabase = {
    from: (table: string) => { expect(table).toBe("clients"); return q; },
    rpc: async function (name: string, args: unknown) {
      // The installed SDK's rpc method dispatches through this.rest.rpc.
      // A detached typed method must not pass this fixture as a valid caller.
      expect(this).toBe(supabase);
      calls.push({ name, args });
      if (name === "create_contact_v2") return { data: options.missingContact ? [] : [{ contact_id: "test-client" }], error: options.preparationError ? Error("Contact refused") : null };
      if (name === "create_tenant_invite_token") return { data: options.missingToken ? [] : [{ token: "synthetic-token" }], error: options.mintError ? Error("Mint refused") : null };
      throw Error("Unexpected RPC");
    },
    functions: { invoke: async (name: string, args: unknown) => { calls.push({ name, args }); if (options.held) return { data: null, error: Object.assign(Error("Edge Function returned a non-2xx status code"), { context: { status: 409, json: async () => ({ ok: false, emailed: false, status: "held", code: "INVITATION_POLICY_HELD", hold: "contact" }) } }) }; return { data: options.emailed === undefined ? {} : { emailed: options.emailed }, error: options.sendError ? Error("Delivery unavailable") : null }; } },
    auth: { getSession: async () => ({ data: { session: { access_token: "synthetic-only" } } }) },
  };
  const toast = Object.fromEntries(["error", "warning", "success"].map(level => [level, (message: string) => notices.push({ level, message })]));
  const run = new Function("supabase", "toast", "inviteEmail", "inviteRole", "canInvitePortal", "activeTenantId", "setInviteSending", "setInviteOpen", "setInviteEmail", "setInviteRole", "console", "readLegacyInviteSend", "legacyInviteHeldText", "isLegacyInviteHeld", js + ";return sendInvite;")(
    supabase, toast, options.email ?? " Client@tests.invalid ", options.role ?? "user", options.allowed !== false, tenant, () => {}, () => {}, () => {}, () => {}, { error() {} }, readLegacyInviteSend, legacyInviteHeldText, isLegacyInviteHeld);
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
    const r = await drive({ emailed }); expect(r.notices.at(-1)?.level).toBe("warning"); expect(r.notices.at(-1)?.message).toContain("delivery is unconfirmed"); expect(r.notices.some(n => n.level === "success")).toBe(false);
  });
  it("treats an invocation error as a failure, without retrying an unknown send", async () => {
    const r = await drive({ sendError: true }); expect(r.notices.at(-1)?.level).toBe("error"); expect(r.calls.filter(c => c.name === "send-portal-invite")).toHaveLength(1);
  });
  it("a held invitation (409 INVITATION_POLICY_HELD) says so, offers no hand-off, and is not retried (E09 Slice 6, §37)", async () => {
    const r = await drive({ held: true });
    expect(r.notices.at(-1)).toEqual({ level: "error", message: "client@tests.invalid has email turned off or on hold, so Paige didn't send the invitation." });
    expect(r.notices.some(n => n.level === "success" || /delivery|resend/i.test(n.message))).toBe(false);
    expect(r.calls.filter(c => c.name === "send-portal-invite")).toHaveLength(1);
  });
  it("keeps the existing staff invitation path separate", async () => {
    const r = await drive({ role: "moderator" }); expect(r.calls.map(c => c.name)).toEqual(["send-admin-invitation"]);
  });
});

// E09 Slice 6 round 4 (verifier MINOR 2): the shared reader names only the cause the server reported.
describe("legacy invitation reader", () => {
  const refused = (status: number, body: Record<string, unknown>) => ({ message: "non-2xx", context: { status, json: async () => body } });
  it.each([
    [{ status: "held", code: "INVITATION_POLICY_HELD", hold: "contact" }, 409, "held", "Sam Lee has email turned off or on hold, so Paige didn't send the invitation."],
    [{ status: "held", code: "INVITATION_POLICY_HELD", hold: "business_quiet_hours" }, 409, "held_business_quiet_hours", "Paige held this invitation because your business's email quiet hours are on. Send it again after they end."],
    [{ status: "held", code: "INVITATION_POLICY_HELD" }, 409, "held_unspecified", "Paige held this invitation because of an email hold (the client's preference or your quiet hours)."],
    [{ status: "unavailable", code: "INVITATION_POLICY_UNAVAILABLE" }, 503, "check_unavailable", "Paige couldn't check Sam Lee's email preferences, so she didn't send the invitation. Try again in a few minutes."],
  ])("%j reads as a hold with its own words", async (body, status, outcome, text) => {
    const read = await readLegacyInviteSend(null, refused(status, { ok: false, emailed: false, ...body }));
    expect(read).toBe(outcome);
    expect(isLegacyInviteHeld(read)).toBe(true);
    if (isLegacyInviteHeld(read)) expect(legacyInviteHeldText("Sam Lee", read)).toBe(text);
  });
  it("the business's quiet hours and an unrun check never blame the client", async () => {
    for (const body of [{ code: "INVITATION_POLICY_HELD", hold: "business_quiet_hours" }, { code: "INVITATION_POLICY_UNAVAILABLE" }]) {
      const read = await readLegacyInviteSend(null, refused(409, body));
      expect(isLegacyInviteHeld(read) && legacyInviteHeldText("Sam Lee", read)).not.toMatch(/turned off/);
    }
  });
  it("an ordinary failure or delivery is not a hold", async () => {
    expect(isLegacyInviteHeld(await readLegacyInviteSend({ ok: true, emailed: true }, null))).toBe(false);
    expect(isLegacyInviteHeld(await readLegacyInviteSend(null, refused(500, { error: "x" })))).toBe(false);
  });
  it("the dashboard does not hand off a link when the check could not run", async () => {
    // A 503 that is not a hold used to fall through to "Invite prepared … delivery is unconfirmed".
    expect(await readLegacyInviteSend(null, refused(503, { code: "INVITATION_POLICY_UNAVAILABLE" }))).toBe("check_unavailable");
  });
});
