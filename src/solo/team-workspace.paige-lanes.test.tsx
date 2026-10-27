/**
 * Settings → Team, "Paige team context": what the screen says PAIGE can do must be what she can do.
 *
 * EXP08 PAIGE team-lifecycle tools put suspend/reinstate, remove-and-hand-over and the Team
 * conversations switch into PAIGE's chat. The approved, frozen panel (§28) listed those three as
 * "Coming to Paige, not yet available" and told the person to do them here "until then". Once the
 * tools ship that copy is false (§13), so only its list membership and that one sentence change; this
 * suite pins the result. jsdom against the real component, Supabase mocked: it proves the copy a
 * person reads, not the tools themselves.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SoloTeamWorkspace } from "./team-workspace";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), invoke: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getUser: async () => ({ data: { user: { id: "viewer-under-test" } } }) }, from: () => ({ select: () => ({ eq: async () => ({ data: [], error: null }) }) }), rpc: mocks.rpc, functions: { invoke: mocks.invoke } },
}));
vi.mock("@/hooks/useTenantContext", () => ({
  useTenantContext: () => ({ activeTenantId: "tenant-1", loading: false }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const member = (user_id: string, full_name: string, permission: string) => ({
  membership_id: `m-${user_id}`, user_id, full_name, email: `${user_id}@example.com`, avatar_url: null,
  status: "active", permission, is_owner: permission === "owner", job_title: null, responsibilities: null,
  last_sign_in_at: null,
});
const TEAM = {
  tenant_id: "tenant-1", tenant_name: "Example Team", viewer_permission: "owner",
  can_manage_profiles: true, can_manage_invitations: true, can_change_permissions: true, total_members: 2,
  members: [member("owner-1", "Morgan Lee", "owner"), member("sam-1", "Sam Rivera", "member")],
  invitations: [],
};

async function mountScreen() {
  mocks.rpc.mockImplementation(async (name: string) =>
    name === "get_solo_team_workspace" ? { data: TEAM, error: null } : { data: null, error: { message: "not in this test" } });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<SoloTeamWorkspace />));
  for (let i = 0; i < 50 && !(host.textContent ?? "").includes("Paige team context"); i++) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
  }
  expect(host.textContent, "the Paige panel rendered").toContain("Paige team context");
  return host.querySelector(".stw-paige") as HTMLElement;
}

beforeEach(() => {
  document.body.innerHTML = "";
  mocks.rpc.mockReset();
  mocks.invoke.mockReset();
});

describe("Settings → Team says what PAIGE can do with the team today", () => {
  it("lists the lifecycle acts with the others she can do today, in the approved list", async () => {
    const panel = await mountScreen();
    const today = panel.querySelector(".stw-now");
    expect(today?.querySelector("h3")?.textContent).toBe("She can do this for you today");
    expect(Array.from(today?.querySelectorAll("li") ?? []).map((li) => li.textContent)).toEqual([
      "Invite someone",
      "Resend or withdraw an invitation",
      "Edit someone's title and responsibilities",
      "Change a permission (owner only)",
      "Suspend or reinstate someone",
      "Remove someone and hand over their work",
      "Turn someone's team conversations on or off",
    ]);
    // Each carries the "can do" mark, not the waiting one.
    expect(today?.querySelectorAll("li svg").length).toBe(7);
  });

  it("no longer says any of them is coming, or that the person must do them here until then", async () => {
    const panel = await mountScreen();
    expect(panel.querySelector(".stw-soon")).toBeNull();
    expect(panel.textContent).not.toMatch(/Coming to Paige|not yet available|still coming|Until then, do them here/);
  });

  it("keeps the true limits: approvals and mailboxes are never handed over, and work only on a standalone business", async () => {
    const panel = await mountScreen();
    const rule = panel.querySelector(".stw-rule")?.textContent ?? "";
    expect(rule).toContain("She's held to the same rules you are, and nobody can be made an owner from a conversation.");
    expect(rule).toContain("Approvals assigned to someone and a mailbox they connected can't be handed over, by her or anyone, and open work can be handed over only on a standalone business account.");
  });
});
