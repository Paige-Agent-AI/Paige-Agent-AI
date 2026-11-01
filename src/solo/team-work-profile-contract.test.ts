import { describe, expect, it } from "vitest";
import { canEditWorkProfile, verifiedWorkProfileReceipt, workProfileRefusal, type TeamMemberRecord, type TeamWorkspaceRecord } from "./team-workspace-contract";
const owner = { membership_id: "seat", user_id: "owner", status: "active", permission: "owner", is_owner: true } as TeamMemberRecord;
const workspace = { can_manage_profiles: true, viewer_is_account_holder: false, members: [] } as unknown as TeamWorkspaceRecord;
describe("original Team work-profile contract", () => {
  it.each([undefined, null, "false", 0])("does not offer scoped work editing through legacy or invalid native projection %s", projection => {
    expect(canEditWorkProfile({ ...owner, is_owner: false, permission: "member" }, { ...workspace, viewer_is_account_holder: projection as unknown as boolean }, "viewer")).toBe(false);
  });
  it.each([undefined, null, false, "true", 1])("does not infer holder access from %s", (holder) => {
    expect(canEditWorkProfile(owner, { ...workspace, viewer_is_account_holder: holder as boolean }, "other")).toBe(false);
  });
  it("does not reuse holder projection when actual viewer is unknown", () => expect(canEditWorkProfile(owner, {...workspace, viewer_is_account_holder:true}, null)).toBe(false));
  it("requires original profile permission even for the same owner",()=>expect(canEditWorkProfile(owner,{...workspace,can_manage_profiles:false},"owner")).toBe(false));
  it.each(["pending","archived"])("does not offer edits for a %s seat",status=>expect(canEditWorkProfile({...owner,status},workspace,"owner")).toBe(false));
  it("accepts only the original matching canonical receipt",()=>expect(verifiedWorkProfileReceipt({membership_id:"seat",job_title:"Lead",responsibilities:null},"seat"," Lead ","   ")).toEqual({job_title:"Lead",responsibilities:""}));
  it("preserves SQL's Unicode/newline content rather than inventing JavaScript-trimmed values",()=>expect(verifiedWorkProfileReceipt({membership_id:"seat",job_title:"\u00a0Lead\u00a0",responsibilities:"\nWork\n"},"seat"," \u00a0Lead\u00a0 "," \nWork\n ")).toEqual({job_title:"\u00a0Lead\u00a0",responsibilities:"\nWork\n"}));
  it.each([null,{},[],{membership_id:"seat",job_title:"Lead"},{membership_id:"foreign",job_title:"Lead",responsibilities:null},{membership_id:"seat",job_title:"Other",responsibilities:null},{membership_id:"seat",job_title:"Lead",responsibilities:null,done:true}])("refuses an absent or mismatched receipt %j",value=>expect(verifiedWorkProfileReceipt(value,"seat","Lead","")).toBeNull());
  it("maps owner/identity errors without exposing backend names",()=>{
    expect(workProfileRefusal("TEAM_OWNER_PROFILE_FORBIDDEN: internal reason","Only the account holder or this owner can edit.")).toBe("Only the account holder or this owner can edit. Reopen Team to check the current access.");
    expect(workProfileRefusal("TEAM_MEMBER_IDENTITY_UNAVAILABLE: private reason","")).not.toContain("TEAM_");
    expect(workProfileRefusal("SQL private.table detail","")).not.toContain("private.table");
  });
});
