/**
 * PAIGE's Solo Team capability — the properties that have to hold for her to touch the team.
 *
 * Two kinds of assertion live here and they are deliberately not mixed up. The first block runs
 * REAL CODE: `action-risk.ts` is imported and called, so what it says is what production says. The
 * second block reads the handler's SOURCE, because the chat handler is a Deno edge function with a
 * network-shaped entry point and no seam this suite can drive. That is a weaker class of proof and
 * it is labelled as such — it catches a call site wired to the wrong client, which is the mistake
 * that would actually be made here, and it cannot tell you the function runs.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { classifyAction, clampLaneByRisk, unclassifiedWriteReason } from "../../supabase/functions/_shared/action-risk";

const HANDLER = readFileSync("supabase/functions/paige-ai-chat/index.ts", "utf8");

const TEAM_TOOLS = [
  "team_set_work_profile",
  "team_set_permission",
  "team_invite_member",
  "team_invite_resend",
  "team_invite_revoke",
] as const;

describe("the Team actions are classified, and classified correctly", () => {
  it("puts every act that moves authority or leaves the platform behind the rendered card", () => {
    // `high` is not "a stronger word for important". It is the class whose approval fingerprint
    // travels in the request BODY, which is the one place the model cannot write — so a model
    // reporting "they said yes" cannot open any of these four.
    expect(classifyAction("team_set_permission")).toBe("high");
    expect(classifyAction("team_invite_member")).toBe("high");
    expect(classifyAction("team_invite_resend")).toBe("high");
    expect(classifyAction("team_invite_revoke")).toBe("high");
  });

  it("leaves work details ordinary, because describing a job cannot grant one", () => {
    expect(classifyAction("team_set_work_profile")).toBe("ordinary");
  });

  it("refuses a Team tool nobody classified", () => {
    // The whole point of the fail-closed default. Someone adding `team_delete_member` next month
    // gets an inert tool and a red build, not an ungoverned write. (This used `team_remove_member`
    // until EXP08 classified that one, deliberately, as `high`; see the lifecycle block below.)
    expect(classifyAction("team_delete_member")).toBe("unclassified");
    expect(unclassifiedWriteReason("team_delete_member")).toMatch(/no risk classification/);
  });

  it("does not let any Team tool slip past the runtime write backstop", () => {
    for (const tool of TEAM_TOOLS) expect(unclassifiedWriteReason(tool)).toBeNull();
  });
});

describe("the handler's Team call sites (source-level proof, not runtime proof)", () => {
  it("declares each Team tool exactly once", () => {
    for (const tool of TEAM_TOOLS) {
      const declarations = HANDLER.split(`name: "${tool}"`).length - 1;
      expect(declarations, `${tool} declaration count`).toBe(1);
    }
  });

  it("calls the Team seam through the caller's own client, never the service role", () => {
    // THE MISTAKE THIS CATCHES. Every guard on this seam — owner-only for a permission change,
    // owner-or-admin for the rest, the refusal to make anyone an owner — lives inside the SQL
    // function and derives the actor from auth.uid(). Reaching it with `admin` (the service-role
    // client) would satisfy every one of those checks vacuously and hand Paige authority no human
    // in the conversation has. So the client is asserted at the call site, by name.
    expect(HANDLER).toContain('await supabaseClient.rpc("set_solo_team_member_work_profile"');
    expect(HANDLER).toContain('await supabaseClient.rpc("set_solo_team_member_permission"');
    expect(HANDLER).toContain('await supabaseClient.functions.invoke(\n                "solo-team-invitations"');
    expect(HANDLER).not.toContain('admin.rpc("set_solo_team_member_permission"');
    expect(HANDLER).not.toContain('admin.rpc("set_solo_team_member_work_profile"');
    expect(HANDLER).not.toContain('admin.functions.invoke("solo-team-invitations"');
  });

  it("never lets the work-details write reach a permission", () => {
    // The separation the Team screen puts on the editor, asserted in code: the arguments this tool
    // accepts are two text fields and an id. If a `permission` ever appears in this call, the
    // product's central promise about titles has quietly stopped being true.
    const call = HANDLER.slice(
      HANDLER.indexOf('await supabaseClient.rpc("set_solo_team_member_work_profile"'),
    ).slice(0, 400);
    expect(call).toContain("_member_user_id");
    expect(call).toContain("_job_title");
    expect(call).toContain("_responsibilities");
    expect(call).not.toContain("permission");
  });

  it("cannot offer 'owner' as a permission from chat", () => {
    // The database refuses it too. This asserts the tool never even proposes it, so the operator is
    // not read a card describing something that will then fail.
    const decl = HANDLER.slice(HANDLER.indexOf('name: "team_set_permission"')).slice(0, 1200);
    expect(decl).toContain('enum: ["admin", "member"]');
    expect(decl).not.toContain('"owner"');
  });

  it("does not let a stored autonomy preference retire the approval a class requires", () => {
    // FOUND WHILE ADDING FOUR `high` TEAM TOOLS, and older than them. The entire risk gate sits
    // inside `if (autoMode === "confirm")`, and `set_tool_autonomy` accepts auto|confirm|off for
    // any tool key with no reference to its class. So a workspace that had put a tool on `auto`
    // skipped not only the confirmation but the `high` refusal and the `owner_only` refusal too —
    // meaning `automation_set_grant`, which is owner_only precisely because it changes how much
    // Paige may do alone, could have been switched to auto and then raised from a conversation.
    //
    // The clamp RULE now lives in the shared `clampLaneByRisk` helper (§18 one home), so the manifest
    // and the dispatch apply the identical rule and cannot diverge. Assert the rule on the REAL code
    // (the stronger proof): a stored `auto` preference on a high/owner_only tool is forced to
    // `confirm`, so the class's approval is never retired.
    expect(clampLaneByRisk("auto", "automation_set_grant")).toBe("confirm"); // owner_only
    expect(clampLaneByRisk("auto", "team_set_permission")).toBe("confirm");  // high
    // The clamp is one-directional — `off` must survive it at every class: a brake is the operator's
    // to pull, and a clamp that quietly re-enabled a disabled tool would be a worse bug than the one
    // it fixed. And it is keyed on the CLASS, not the tool family, so an ordinary tool passes through.
    expect(clampLaneByRisk("off", "automation_set_grant")).toBe("off");
    expect(clampLaneByRisk("off", "team_set_permission")).toBe("off");
    expect(clampLaneByRisk("auto", "crm_create_contact")).toBe("auto"); // ordinary — not clamped
    // The dispatch must APPLY that clamp ABOVE the branch it protects, or it protects nothing: the
    // `clampLaneByRisk(autoMode` call precedes the `if (autoMode === "confirm")` gate. (Source-level —
    // the handler is a Deno edge fn with no seam this suite can drive; the weaker class of proof.)
    const clampApplyAt = HANDLER.indexOf("clampLaneByRisk(autoMode");
    expect(clampApplyAt).toBeGreaterThan(-1);
    expect(clampApplyAt).toBeLessThan(HANDLER.indexOf('if (autoMode === "confirm") {'));
  });

  it("refuses to act when the seam's workspace is not the one this conversation is about", () => {
    // The defect this closes, found by the seam audit before it shipped: the Team functions resolve
    // their workspace with current_user_tenant_id(), while the conversation resolves its own with
    // get_paige_persona_context — which prefers a linked `clients` row. For a speaker who is a
    // member of one workspace and a client of another they are different tenants, and the READ
    // already fails closed on exactly that (buildTenantTeamContextBlock returns null). The WRITE
    // did not, and member ids for the other workspace are obtainable from crm_list_team, so an
    // action could have landed in a team whose roster this conversation was never shown.
    //
    // The check is asserted at EVERY branch, not once: a fifth Team tool added later without it
    // reopens the hole silently, and this count is what notices.
    expect(HANDLER).toContain("const teamSeamTenantMismatch = async ()");
    // DERIVED, NOT HARDCODED. An earlier revision asserted `toBe(3)`, which is a trap in the other
    // direction: a sixth Team tool added WITH the guard fails, and the cheapest green is to bump
    // the number — which is how a ratchet stops being one. Count the executor branches instead, so
    // the assertion is "every branch is guarded" rather than "there are three of them".
    const executorBranches = HANDLER.split('} else if (tc.function.name === "team_').length - 1
      + HANDLER.split('tc.function.name === "team_invite_resend" ? "resend"').length - 1
      // EXP08: the lifecycle tools share ONE dispatch branch, guarded once for all seven.
      + HANDLER.split("} else if (TEAM_LIFECYCLE_READ_TOOL_NAMES.has(tc.function.name) || TEAM_LIFECYCLE_WRITE_TOOL_NAMES.has(tc.function.name)) {").length - 1;
    const guarded = HANDLER.split("const wrongTenant = await teamSeamTenantMismatch();").length - 1;
    expect(guarded, "every Team executor branch consults the tenant guard").toBe(executorBranches);
    expect(guarded).toBeGreaterThan(0);
    // Null persona tenant is a refusal too, not a pass — "no expected tenant" is the state in which
    // a mismatch is undetectable, which is the worst moment to proceed.
    const body = HANDLER.slice(HANDLER.indexOf("const teamSeamTenantMismatch = async ()")).slice(0, 1600);
    expect(body).toContain("if (!expected)");
    expect(body).toContain("actual !== expected");
  });

  it("settles one canonical permission value before anything reads it", () => {
    // THE WORST DEFECT IN THE SLICE, caught by adversarial review. The card branched on
    // `permission === "admin"` with strict equality while both SQL functions lower() the value, so
    // a model emitting "Admin" — the capitalisation used in the card text, the Team screen's own
    // labels, and these very tool descriptions — rendered "Change Riley to Member … they will LOSE
    // the ability to invite people" and then executed a PROMOTION. The operator reads a demotion
    // and hands over administrative control.
    //
    // The stored-arguments protocol did not help and it is worth being precise about why: the
    // executed call WAS the fingerprinted call. The card and the write agreed on the argument and
    // disagreed on its meaning, so the fix is settling the value, not binding it harder.
    const gate = HANDLER.slice(HANDLER.indexOf('if (tc.function.name === "team_set_permission" || tc.function.name === "team_invite_member") {')).slice(0, 1400);
    expect(gate).toContain(".trim().toLowerCase()");
    // An unrecognised value is REFUSED, never coerced: guessing which permission somebody meant is
    // the same mistake in a quieter voice.
    expect(gate).toContain('raw !== "admin" && raw !== "member"');
    expect(gate).toContain("success: false");
    // And the canonical value is written back, so the executed arguments carry it too.
    expect(gate).toContain("gateArgs.permission = raw");
    // It must be settled BEFORE the fingerprint and the card are taken from those arguments.
    expect(HANDLER.indexOf("gateArgs.permission = raw"))
      .toBeLessThan(HANDLER.indexOf("const fp = await confirmFingerprint("));
  });

  it("checks the tenant inside the roster read, so the CARD cannot name across workspaces", () => {
    // The first version guarded only the write. The approval card is built a turn EARLIER on the
    // refusal path and read the same roster with no check, so a mismatched speaker could be shown
    // — and have persisted into paige_pending_confirmations — a name and email from a workspace
    // this conversation was deliberately never shown a roster for.
    const reader = HANDLER.slice(HANDLER.indexOf("const teamCardRoster = ()")).slice(0, 1800);
    expect(reader).toContain("rosterTenant !== expected");
    expect(reader).toContain("return null");
    // The check must be in the READER, not only beside the write — that is the whole finding.
    expect(HANDLER.indexOf("const rosterTenant = "))
      .toBeLessThan(HANDLER.indexOf("const teamSeamTenantMismatch = async ()"));
  });

  it("refuses a high-risk card whose subject it cannot name", () => {
    // "Change that teammate to Admin — they will be able to invite people, manage invitations, and
    // edit everyone's work details" is approvable prose about nobody. Degrading to less information
    // is acceptable on an ordinary action; on one that moves authority it is a yes to an unnamed
    // person's access.
    const guard = HANDLER.slice(HANDLER.indexOf("A HIGH-RISK CARD THAT CANNOT NAME ITS SUBJECT")).slice(0, 2000);
    expect(guard).toContain("await describeTeamMember(gateArgs?.member_user_id)");
    expect(guard).toContain("await describeTeamInvite(gateArgs?.invitation_id)");
    expect(guard).toContain("if (!named)");
    expect(guard).toContain("haven't asked you to approve anything");
    // The resolvers must be able to SAY they failed; a string fallback inside them would make the
    // guard unreachable.
    expect(HANDLER).toContain("const describeTeamMember = async (userId: unknown): Promise<string | null>");
    expect(HANDLER).toContain("const describeTeamInvite = async (inviteId: unknown): Promise<string | null>");
  });

  it("shows the free text on the card, because it lands in Paige's own context", () => {
    // These strings are re-injected into the model's prompt on every later turn, up to 2,000
    // characters per member. An operator shown "742 characters" has approved something nobody read.
    const card = HANDLER.slice(HANDLER.indexOf('case "team_set_work_profile": {')).slice(0, 1800);
    expect(card).toContain("responsibilities → ");
    expect(card).toContain("resp.slice(0, 200)");
    expect(card).not.toContain("responsibilities rewritten (");
  });

  it("treats an omitted work-detail field as keep, not delete", () => {
    // The RPC writes both columns unconditionally, so a model changing only a title and emitting
    // an empty responsibilities string erased someone's two thousand words — on an `ordinary`
    // action it can self-approve. The RPC is shared with the Team screen and is not changed; the
    // omitted side is carried forward from what is stored. An EXPLICIT empty string still clears,
    // because "take that off her profile" is a real request.
    const carry = HANDLER.slice(HANDLER.indexOf('AN OMITTED FIELD MEANS "LEAVE IT"')).slice(0, 1600);
    expect(carry).toContain('typeof gateArgs.job_title !== "string"');
    expect(carry).toContain('typeof gateArgs.responsibilities !== "string"');
    expect(carry).toContain("current.responsibilities ?? \"\"");
    // And the schema must permit omission, or the carry-forward is unreachable.
    const decl = HANDLER.slice(HANDLER.indexOf('name: "team_set_work_profile"')).slice(0, 1800);
    expect(decl).toContain('required: ["member_user_id"]');
  });

  it("reads the invitation seam's real refusal instead of the transport's generic one", () => {
    // `solo-team-invitations` returns every refusal as a non-2xx, and supabase-js resolves that to
    // { data: null, error } — so the previous `inv?.error` was always undefined and what surfaced
    // was the constant "Edge Function returned a non-2xx status code". The honest sentences live on
    // error.context, and readInvokeBody exists in this file for exactly that trap.
    // Sliced to the END of the branch rather than a character window — twice now a fixed window
    // has measured whatever happened to sit next to the subject instead of the subject.
    const branchStart = HANDLER.indexOf('const invokeBody = tc.function.name === "team_invite_member"');
    const branch = HANDLER.slice(branchStart, HANDLER.indexOf('} else if (tc.function.name === "member_grant_role")', branchStart));
    expect(branch).toContain("await readInvokeBody(invErr, inv)");
    expect(branch).toContain("invBody.ok === false");
    expect(branch).toContain("invBody.emailed === true");
    expect(branch).not.toContain("(inv as any)?.error");
    // And the caller's JWT is passed explicitly rather than inherited from an undocumented internal.
    expect(branch).toContain("headers: { Authorization: authHeader }");
  });

  it("names the workspace on every invitation act instead of letting the server guess one", () => {
    // WHAT THIS REPLACES. The three invitation RPCs used to read `profiles.active_tenant_id` RAW
    // while the roster used `current_user_tenant_id()`, so a sole OWNER with a null pointer read
    // their own roster and was then told "only an owner or admin may invite team members" — false,
    // about the owner of that workspace. Paige carried a `inviteSeamBlocked` pre-read so that at
    // least the reason she gave was true.
    //
    // The database repair (20261047000000) removed the cause: authority is now proved against a
    // workspace the caller NAMES. So the workaround is asserted GONE, not merely relocated — had it
    // survived, the invitation would now succeed while Paige refused it in her own voice, which is
    // the same false refusal one layer further from the truth.
    expect(HANDLER, "the workaround is deleted, not moved").not.toContain("inviteSeamBlocked");
    expect(HANDLER).not.toContain("This isn't about your permissions; you may well be its owner.");
    expect(HANDLER).not.toContain("no workspace is set as your active one");
    // Scoped to the team seam deliberately. Unrelated code (marketplace scope, trace working
    // context) reads `profiles.active_tenant_id` legitimately and is not this defect; asserting its
    // absence file-wide would be a false claim about what was repaired.
    const teamSeam = HANDLER.slice(
      HANDLER.indexOf("const teamSeamTenantMismatch = async ()"),
      HANDLER.indexOf("const describeTeamMember = async ("),
    );
    expect(teamSeam.length).toBeGreaterThan(0);
    // Comment-stripped: the paragraph recording what was removed names the column deliberately, and
    // an assertion satisfied by prose would pass while the code did the opposite.
    const teamSeamCode = teamSeam
      .split("\n")
      .filter((line) => !/^\s*(\/\/|\/?\*)/.test(line))
      .join("\n");
    expect(teamSeamCode, "the team seam no longer reads the raw pointer").not.toContain("active_tenant_id");

    // Every invitation act names the workspace this conversation is about. Derived from the branch
    // rather than counted against a hardcoded number, so adding a fourth act cannot pass silently.
    const branchStart = HANDLER.indexOf('const invokeBody = tc.function.name === "team_invite_member"');
    const branch = HANDLER.slice(branchStart, HANDLER.indexOf('} else if (tc.function.name === "member_grant_role")', branchStart));
    const actions = branch.match(/action: /g) ?? [];
    const named = branch.match(/expectedTenantId: personaCtx\?\.tenant_id \?\? null,/g) ?? [];
    expect(actions.length, "create, and the shared resend/revoke shape").toBe(2);
    expect(named.length, "each invitation shape names its workspace").toBe(actions.length);

    // The workspace it names is the one already reconciled against the roster, and that
    // reconciliation still runs ahead of every invitation act.
    // lastIndexOf, NOT indexOf. The same guard string appears in the work-profile and
    // permission branches earlier in the file, so a windowed indexOf matched one of THOSE —
    // the assertion stayed green with the invitation branch's own guard deleted. Caught by
    // adversarial review. This is the guard that makes `personaCtx.tenant_id` non-null and
    // roster-agreeing, and without it PAIGE would name a workspace nothing had reconciled.
    const guardAt = HANDLER.lastIndexOf("const wrongTenant = await teamSeamTenantMismatch();", branchStart);
    expect(guardAt, "the invitation branch has its own tenant guard").toBeGreaterThan(-1);
    expect(guardAt).toBeLessThan(branchStart);
    // Anchored to the branch OPENER, not to a character budget. Round 2 of the adversarial read
    // proved the previous backstops were decorative: with the invitation branch's own guard
    // deleted, `guardAt` fell back to the `team_set_permission` guard 1820 chars earlier — under
    // the 2000 budget — and `member_grant_role` opens AFTER the invite branch, so that check could
    // never match. All four assertions passed against the regression they were written to catch.
    // Anchored on the branch's own CONDITION rather than on brace style. Round 3: `} else if (`
    // was fragile both ways — writing the opener as `} else if(` let a deleted guard pass, and a
    // comment containing that text between the guard and the body made it fail with the guard
    // present. There is no formatter in this repo, but a semantic anchor costs nothing.
    const inviteBranchOpen = HANDLER.lastIndexOf('tc.function.name === "team_invite_member" ||', branchStart);
    expect(inviteBranchOpen, "the invitation branch's condition was located").toBeGreaterThan(-1);
    expect(guardAt, "the guard is inside the invitation branch, not the one before it")
      .toBeGreaterThan(inviteBranchOpen);
  });

  it("carries the email-delivery outcome into the result instead of assuming it", () => {
    // Creating an invitation and delivering its email are two acts and the second fails alone.
    // `emailed` is what stops "invited them" being said about somebody who was never contacted.
    const start = HANDLER.indexOf('const invokeBody = tc.function.name === "team_invite_member"');
    const branch = HANDLER.slice(start, HANDLER.indexOf('} else if (tc.function.name === "member_grant_role")', start));
    expect(branch).toContain("emailed");
    expect(branch).toContain("did NOT go out");
  });
});

// ── EXP08 team lifecycle: PAIGE suspends, reinstates, removes, switches Team conversations and hands
// work over (_shared/paige-spine/domains/team_lifecycle.ts, _shared/team-lifecycle/chat.ts). Same two
// evidence classes as above: real classification code, then the handler's source.
const LIFECYCLE_WRITES = ["team_suspend_member", "team_reinstate_member", "team_remove_member", "team_set_conversations", "team_handover_work"] as const;
const LIFECYCLE_READS = ["team_list_members", "team_member_holdings"] as const;

describe("the EXP08 lifecycle writes are classified high, and the reads are not writes", () => {
  it("puts every lifecycle write behind the rendered card on every lane", () => {
    for (const tool of LIFECYCLE_WRITES) {
      expect(classifyAction(tool), tool).toBe("high");
      expect(clampLaneByRisk("auto", tool), tool).toBe("confirm");
      expect(unclassifiedWriteReason(tool), tool).toBeNull();
    }
  });
  it("keeps the two reads out of the write gate", () => {
    for (const tool of LIFECYCLE_READS) {
      expect(classifyAction(tool), tool).toBe("unclassified");
      expect(unclassifiedWriteReason(tool), tool).toBeNull();
    }
  });
});

describe("the handler's lifecycle call sites (source-level proof, not runtime proof)", () => {
  const branchStart = HANDLER.indexOf("} else if (TEAM_LIFECYCLE_READ_TOOL_NAMES.has(tc.function.name) || TEAM_LIFECYCLE_WRITE_TOOL_NAMES.has(tc.function.name)) {");
  const branch = HANDLER.slice(branchStart, HANDLER.indexOf("error: `Unknown tool: ${tc.function.name}`", branchStart));
  it("has one dispatch branch, after every incumbent one", () => {
    expect(branchStart).toBeGreaterThan(-1);
    expect(HANDLER.split("TEAM_LIFECYCLE_READ_TOOL_NAMES.has(tc.function.name) || TEAM_LIFECYCLE_WRITE_TOOL_NAMES.has").length - 1).toBe(1);
  });
  it("runs on the caller's own client, never the service role", () => {
    expect(branch).toContain("runTeamLifecycleWrite(tc.function.name, lifecycleScope, supabaseClient, lifecycleArgs)");
    expect(branch).toContain("TEAM_LIFECYCLE_READERS[tc.function.name](lifecycleScope, supabaseClient, lifecycleArgs)");
    expect(branch).not.toMatch(/runTeamLifecycleWrite\([^)]*\bsupabase,/);
  });
  it("asks the same tenant question the other Team tools ask, before anything runs", () => {
    const guard = branch.indexOf("const wrongTenant = await teamSeamTenantMismatch();");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(branch.indexOf("runTeamLifecycleWrite("));
  });
  it("records a capability receipt in the branch", () => {
    expect(branch).toContain("await recordCapabilityRun(supabase, { tenantId: lifecycleScope.tenantId, actorId: user.id, capabilityKey: tc.function.name,");
  });
  it("refuses an unnamed person before any card, for every person-write", () => {
    const gate = HANDLER.slice(HANDLER.indexOf("// EXP08 team lifecycle — the same rule for every lifecycle write"), HANDLER.indexOf("// ── AN OMITTED FIELD MEANS"));
    expect(gate).toContain("if (TEAM_LIFECYCLE_MEMBER_TOOL_NAMES.has(tc.function.name)) {");
    expect(gate).toContain("if (!(await describeTeamMember(gateArgs?.member_user_id))) {");
  });
  it("is never added to the owner-ops branch set", async () => {
    const { OWNER_OPS_BRANCH_TOOLS } = await import("../../supabase/functions/_shared/workspace-authority");
    for (const tool of [...LIFECYCLE_WRITES, ...LIFECYCLE_READS]) expect(OWNER_OPS_BRANCH_TOOLS.has(tool), tool).toBe(false);
  });
});
