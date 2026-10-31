import { describe, expect, it } from "vitest";
import {
  canActOn,
  isMissingFunction,
  lifecycleRefusal,
  normalizeHoldings,
  normalizeTeamWorkspace,
  inviteLifecycle,
  memberVisibleIdentity,
  permissionPresentation,
  validateWorkProfile,
} from "./team-workspace-contract";

describe("Solo Team workspace contract", () => {
  it('retains only named server ownership metadata for the existing Team consumer', () => {
    const id='e8000000-0000-4000-8000-000000060001';
    const business={id,kind:'company',display_name:'Test entity',ownership_interest:73,legal_name:'PRIVATE'};
    const result=normalizeTeamWorkspace({tenant_id:'test-tenant',members:[],invitations:[],viewer_permission:'owner',viewer_is_account_holder:true,account_holder_state:'working',
      owner_seats_held:[{...business,vacant_since:'2026-10-29T00:00:00Z'}],business_owner_options:[{...business,seat_state:'held',representative:null,pending_invitation:null}]})!;
    expect(result.viewer_is_account_holder).toBe(true);
    expect(result.account_holder_state).toBe('working');
    expect(result.owner_seats_held).toEqual([{id,kind:'company',display_name:'Test entity',vacant_since:'2026-10-29T00:00:00Z'}]);
    expect(result.business_owner_options).toEqual([{id,kind:'company',display_name:'Test entity',seat_state:'held',representative:null,pending_invitation:null}]);
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
    expect(JSON.stringify(result)).not.toContain('ownership_interest');
  });

  it('keeps missing or malformed ownership unknown and never infers holder from Owner permission', () => {
    const result=normalizeTeamWorkspace({tenant_id:'test-tenant',members:[],invitations:[],viewer_permission:'owner',viewer_is_account_holder:'true',account_holder_state:['working'],business_owner_options:[{id:'not-an-id',kind:'company'}]})!;
    expect(result.viewer_is_account_holder).toBeNull();
    expect(result.account_holder_state).toBeNull();
    expect(result.business_owner_options).toEqual([]);
    expect(result.owner_seats_held).toEqual([]);
  });
  it("uses a verified stored name and otherwise identifies the real member by email", () => {
    expect(memberVisibleIdentity({ full_name: "  Avery Brooks  ", email: "avery@example.com" })).toEqual({
      primary: "Avery Brooks",
      secondary: "avery@example.com",
    });
    expect(memberVisibleIdentity({ full_name: "   ", email: "member@example.com" })).toEqual({
      primary: "member@example.com",
      secondary: null,
    });
    expect(memberVisibleIdentity({ full_name: null, email: "  member@example.com  " })).toEqual({
      primary: "member@example.com",
      secondary: null,
    });
  });
  it("keeps custom work identity separate from enforced permission", () => {
    expect(permissionPresentation("admin", false)).toEqual({ label: "Admin", mutable: true });
    expect(permissionPresentation("member", false)).toEqual({ label: "Member", mutable: true });
    expect(permissionPresentation("owner", true)).toEqual({ label: "Owner", mutable: false });
    expect(permissionPresentation("coach", false)).toEqual({ label: "Coach", mutable: false });
  });

  it("validates title and responsibilities without treating either as authority", () => {
    expect(validateWorkProfile("Operations Lead", "Owns delivery quality and weekly planning.")).toEqual({});
    expect(validateWorkProfile("x".repeat(121), "Clear work")).toEqual({ title: "Keep the title to 120 characters or fewer." });
    expect(validateWorkProfile("Client Success", "x".repeat(2001))).toEqual({ responsibilities: "Keep responsibilities to 2,000 characters or fewer." });
  });

  it("derives every invitation lifecycle state deterministically", () => {
    const now = new Date("2026-08-31T12:00:00Z");
    expect(inviteLifecycle({ uses: 1, revoked_at: null, expires_at: "2026-09-01T12:00:00Z" }, now)).toBe("accepted");
    expect(inviteLifecycle({ uses: 0, revoked_at: "2026-08-30T12:00:00Z", expires_at: "2026-09-01T12:00:00Z" }, now)).toBe("revoked");
    expect(inviteLifecycle({ uses: 0, revoked_at: null, expires_at: "2026-08-30T12:00:00Z" }, now)).toBe("expired");
    expect(inviteLifecycle({ uses: 0, revoked_at: null, expires_at: "2026-09-01T12:00:00Z" }, now)).toBe("pending");
  });
});

describe("EXP08 lifecycle contract", () => {
  const target = (over: Record<string, unknown> = {}) => ({ user_id: "u-target", permission: "member", is_owner: false, ...over });
  it("offers an act only where the server's one rule allows it", () => {
    expect(canActOn("owner", "u-me", target())).toBe(true);
    expect(canActOn("owner", "u-me", target({ permission: "admin" }))).toBe(true);
    expect(canActOn("admin", "u-me", target())).toBe(true);
    expect(canActOn("admin", "u-me", target({ permission: "admin" })), "an admin never acts on an admin").toBe(false);
    expect(canActOn("owner", "u-me", target({ is_owner: true })), "nobody acts on an owner").toBe(false);
    expect(canActOn("owner", "u-me", target({ permission: "owner" }))).toBe(false);
    expect(canActOn("owner", "u-me", target({ user_id: "u-me" })), "nobody acts on themselves").toBe(false);
    expect(canActOn("owner", null, target()), "an unknown viewer is offered nothing").toBe(false);
    expect(canActOn("member", "u-me", target())).toBe(false);
    expect(canActOn("owner", "u-me", target({ permission: "coach" })), "a legacy permission is not changed here").toBe(false);
  });

  it("tells a function that is not deployed yet apart from a refusal", () => {
    expect(isMissingFunction({ code: "PGRST202", message: "Could not find the function public.suspend_solo_team_member" })).toBe(true);
    expect(isMissingFunction({ code: "42883", message: "function public.x(uuid) does not exist" })).toBe(true);
    expect(isMissingFunction({ message: "only an owner or an admin may suspend someone in this workspace" })).toBe(false);
    const r = lifecycleRefusal({ code: "PGRST202", message: "Could not find the function public.suspend_solo_team_member(_expected_tenant_id, _member_user_id) in the schema cache" }, "suspend", "Theo Brandt", "Northstar Studio");
    expect(r).toEqual({ message: "This isn't available in Northstar Studio yet. Nothing was changed.", retryable: false, unavailable: true, reconciled: false });
  });

  it("speaks every refusal the lifecycle functions raise, without backend words", () => {
    const say = (m: string, act: "suspend" | "reinstate" | "conversations" | "review" = "suspend") => lifecycleRefusal({ message: m }, act, "Theo Brandt", "Northstar Studio");
    expect(say("only the workspace owner may suspend an admin in this workspace").message).toBe("Only the workspace owner can do this for an admin. Nothing was changed.");
    expect(say("only the workspace owner may change an admin's team conversations", "conversations").message).toContain("Only the workspace owner can do this for an admin.");
    expect(say("only the workspace owner may review what an admin holds", "review").message).toBe("Only the workspace owner can do this for an admin. Nothing was read.");
    expect(say("only the workspace owner can change a suspended teammate's role or seat; nothing was changed").message).toContain("suspended teammate's role or seat");
    expect(say("you cannot suspend yourself in this workspace").message).toBe("You can't do this for yourself. Nothing was changed.");
    expect(say("an owner cannot be suspended in this workspace").message).toContain("is an owner");
    expect(say("only an active teammate can be suspended; nothing was changed").reconciled).toBe(true);
    expect(say("only a suspended teammate can be reinstated; nothing was changed", "reinstate").message).toContain("isn't suspended");
    expect(say("that person is not on this workspace's team").reconciled).toBe(true);
    expect(say("TypeError: Failed to fetch").retryable).toBe(true);
    const unknown = say("OWNER_GUARD: tenant ownership may only be changed via grant_co_owner()");
    expect(unknown.message).not.toMatch(/OWNER_GUARD|grant_co_owner/);
    expect(unknown.retryable).toBe(false);
  });

  it("parses the departure review exactly, and drops a row its writer could not use rather than guessing", () => {
    const value = {
      ok: true,
      member: { user_id: "u-1", display_name: "Theo Brandt", role: "member", status: "active", team_hub_access: false },
      holdings: {
        work: [{ id: "w1", title: "Launch email copy", status: "open", due_at: null, updated_at: "2026-10-26T10:00:00Z", client_label: null }, { id: "w2", title: "No version", status: "open" }],
        crm_tasks: [], clients: [{ id: "c1", label: "Harbor & Pine", relation: "lead_owner", updated_at: "2026-10-25T00:00:00Z" }, { id: "c2", label: "Bad", relation: "friend", updated_at: "x" }],
        deals: [{ id: "d1", title: "Retainer", status: "open", value_cents: 480000, currency: "USD", expected_close_date: "2026-12-15", version: 3 }],
        approvals: [{ id: "a1", kind: "email", summary: "Follow-up", status: "pending", created_at: "2026-10-25T00:00:00Z" }], mailboxes: [],
      },
      counts: { work: 63, crm_tasks: 0, clients: 1, deals: 1, approvals: 1, mailboxes: 0 },
    };
    const h = normalizeHoldings(value, "u-1")!;
    expect(h.member.team_hub_access).toBe(false);
    expect(h.items.work.map((w) => w.id), "a row without its version is not offered for hand-over").toEqual(["w1"]);
    expect(h.counts.work, "counts stay the true totals").toBe(63);
    expect(h.items.clients.map((c) => c.id)).toEqual(["c1"]);
    expect(h.items.deals[0]).toMatchObject({ kind: "deals", version: 3, value_cents: 480000 });
    expect(normalizeHoldings(value, "someone-else"), "an answer about another person is not shown").toBeNull();
    expect(normalizeHoldings({ ...value, ok: false }, "u-1")).toBeNull();
  });
});
