/**
 * Settings → Team, "Paige team context": what the screen says PAIGE can do must be what she can do.
 *
 * EXP08 PAIGE team-lifecycle tools put suspend/reinstate, remove-and-hand-over and the Team
 * conversations switch into PAIGE's chat. The approved, frozen panel (§28) listed those three as
 * "Coming to Paige, not yet available". #2957 moved them under "She can do this for you today", but
 * the tools have never been driven through the deployed chat on a signed-in account (the evidence
 * record keeps authenticated runtime UNVERIFIED), so "today" claimed more than is proven (§13). They
 * now sit in the panel's own second lane with its waiting mark, under a label that says they are new
 * and still being checked, and the closing sentence says they can still be done here. This suite pins
 * that. jsdom against the real component, Supabase mocked: it proves the copy a person reads, not the
 * tools themselves.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

const mounted: Array<ReturnType<typeof createRoot>> = [];

async function mountScreen() {
  mocks.rpc.mockImplementation(async (name: string) =>
    name === "get_solo_team_workspace" ? { data: TEAM, error: null } : { data: null, error: { message: "not in this test" } });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  mounted.push(root);
  await act(async () => root.render(<SoloTeamWorkspace />));
  for (let i = 0; i < 50 && !(host.textContent ?? "").includes("Paige team context"); i++) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
  }
  expect(host.textContent, "the Paige panel rendered").toContain("Paige team context");
  return host.querySelector(".stw-paige") as HTMLElement;
}

// Unmount and let React's scheduler drain inside the test, so no work runs after jsdom is torn
// down (an unhandled scheduler error after teardown fails the whole vitest run).
afterEach(async () => {
  for (const root of mounted.splice(0)) await act(async () => { root.unmount(); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
});

beforeEach(() => {
  document.body.innerHTML = "";
  mocks.rpc.mockReset();
  mocks.invoke.mockReset();
});

describe("Settings → Team says what PAIGE can do with the team, and only what is proven as today", () => {
  it("lists only the proven acts under \"She can do this for you today\"", async () => {
    const panel = await mountScreen();
    const today = panel.querySelector(".stw-now");
    expect(today?.querySelector("h3")?.textContent).toBe("She can do this for you today");
    expect(Array.from(today?.querySelectorAll("li") ?? []).map((li) => li.textContent)).toEqual([
      "Invite someone",
      "Resend or withdraw an invitation",
      "Edit someone's title and responsibilities",
      "Change a permission (owner only)",
    ]);
    expect(today?.querySelectorAll("li svg").length).toBe(4);
  });

  it("puts the new lifecycle acts in the second lane, labelled new and still being checked, never \"today\"", async () => {
    const panel = await mountScreen();
    const checking = panel.querySelector(".stw-soon");
    expect(checking?.querySelector("h3")?.textContent).toBe("New to Paige, still being checked");
    expect(checking?.textContent).not.toMatch(/today/i);
    expect(Array.from(checking?.querySelectorAll("li") ?? []).map((li) => li.textContent)).toEqual([
      "Suspend or reinstate someone",
      "Remove someone and hand over their work",
      "Turn someone's team conversations on or off",
    ]);
    // Each carries the lane's waiting mark, not the "can do" one.
    expect(checking?.querySelectorAll("li svg").length).toBe(3);
    expect(checking?.querySelector("li svg")?.getAttribute("class") ?? "").toMatch(/lucide-clock/);
    // And none of them is claimed as available today anywhere in the panel.
    const todayText = panel.querySelector(".stw-now")?.textContent ?? "";
    for (const act of ["Suspend or reinstate", "Remove someone", "team conversations"]) expect(todayText).not.toContain(act);
  });

  it("keeps the true limits, and says the new acts can still be done here", async () => {
    const panel = await mountScreen();
    const rule = panel.querySelector(".stw-rule")?.textContent ?? "";
    expect(rule).toContain("She's held to the same rules you are, and nobody can be made an owner from a conversation.");
    expect(rule).toContain("Approvals assigned to someone and a mailbox they connected can't be handed over, by her or anyone, and open work can be handed over only on a standalone business account.");
    expect(rule).toContain("Until her new actions have been checked, you can always do them here.");
    expect(panel.textContent).not.toMatch(/not yet available/);
  });
});
