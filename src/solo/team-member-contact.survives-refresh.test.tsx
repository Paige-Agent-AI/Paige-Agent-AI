import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { SoloTeamWorkspace } from "./team-workspace";

// Found by the adversarial read of the pushed diff: saving work details reloads the roster, and a
// reload slow enough to show an empty roster for one frame unmounted the dialog, taking unsaved
// contact edits with it. jsdom only shows it with a realistic delay, so the reload here waits.
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: "owner-1" } } }) },
    from: () => ({ select: () => ({ eq: async () => ({ data: [{ id: "p1", user_id: "member-1", kind: "phone", value: "+15125550100", label: null, is_primary: true, position: 0 }], error: null }) }) }),
    rpc: mocks.rpc,
    functions: { invoke: vi.fn() },
  },
}));
vi.mock("@/hooks/useTenantContext", () => ({ useTenantContext: () => ({ activeTenantId: "tenant-1", loading: false }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const dana = { membership_id: "m1", user_id: "member-1", full_name: "Dana Reyes", email: "dana@example.com", avatar_url: null, status: "active", permission: "member", is_owner: false, job_title: "Coordinator", responsibilities: "Runs onboarding.", last_sign_in_at: null };
const set = (el: HTMLInputElement, v: string) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, v); el.dispatchEvent(new Event("input", { bubbles: true })); };
const byText = (h: ParentNode, t: string) => Array.from(h.querySelectorAll("button")).find((b) => b.textContent?.trim() === t);
const wait = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

describe("Team → a person's contact details", () => {

  it("reopens from a fresh original roster when native details arrive after the web release", async () => {
    let reads = 0; let title = dana.job_title; mocks.rpc.mockReset();
    mocks.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
      if (name === "get_solo_team_workspace") {
        reads += 1;
        return { data: { tenant_id: "tenant-1", tenant_name: "Example Team", viewer_permission: "owner", can_manage_profiles: true, can_manage_invitations: true, can_change_permissions: true, ...(reads > 1 ? { viewer_is_account_holder: false } : {}), total_members: 1, members: [{ ...dana, job_title: title }], invitations: [] }, error: null };
      }
      if (name === "set_solo_team_member_work_profile") { title = String(args._job_title); return { data: { membership_id: dana.membership_id, job_title: title, responsibilities: dana.responsibilities }, error: null }; }
      return { data: null, error: null };
    });
    const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
    try {
      await act(async () => root.render(<SoloTeamWorkspace />)); await wait(250);
      const open = () => Array.from(host.querySelectorAll<HTMLButtonElement>('button.stw-namebtn')).find(b => b.textContent?.includes('Dana Reyes'))!;
      await act(async () => open().click()); await wait(50);
      expect(host.querySelector<HTMLInputElement>('input[placeholder="e.g. Client Success Manager"]')!.disabled).toBe(true);
      expect(document.querySelector<HTMLInputElement>('.stw-contact input[type="tel"]')!.disabled).toBe(false);
      expect(host.querySelector('button[role="radio"]')).toBeNull(); expect(byText(host, 'Save work details')).toBeUndefined();
      const firstReads = reads;
      await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Close"]')!.click()); await wait(100);
      expect(reads).toBeGreaterThan(firstReads); expect(mocks.rpc.mock.calls.filter(([name]) => String(name).startsWith('set_'))).toHaveLength(0);
      await act(async () => open().click()); await wait(50);
      const input = host.querySelector<HTMLInputElement>('input[placeholder="e.g. Client Success Manager"]')!; expect(input.disabled).toBe(false);
      await act(async () => set(input, 'Ready delivery lead')); await act(async () => byText(host, 'Save work details')!.click()); await wait(50);
      expect(mocks.rpc).toHaveBeenCalledWith('set_solo_team_member_work_profile', { _member_user_id: dana.user_id, _job_title: 'Ready delivery lead', _responsibilities: dana.responsibilities, _expected_tenant_id: 'tenant-1', _expected_membership_id: dana.membership_id });
      expect(mocks.rpc.mock.calls.filter(([name]) => String(name).startsWith('set_'))).toHaveLength(1);
      expect(host.querySelector<HTMLInputElement>('input[placeholder="e.g. Client Success Manager"]')?.value).toBe('Ready delivery lead');
    } finally { await act(async () => root.unmount()); host.remove(); }
  });

  it("retains unsaved contact and work drafts after a verified access change in the mounted Team workspace", async () => {
    let reads = 0;
    mocks.rpc.mockReset();
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === "get_solo_team_workspace") {
        reads += 1;
        return { data: { tenant_id: "tenant-1", tenant_name: "Example Team", viewer_permission: "owner", viewer_is_account_holder: false, can_manage_profiles: true, can_manage_invitations: true, can_change_permissions: true, total_members: 1, members: [dana], invitations: [] }, error: null };
      }
      if (name === "set_solo_team_member_permission") return { data: { membership_id: "m1", permission: "admin" }, error: null };
      return { data: null, error: { message: `unexpected ${name}` } };
    });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    try {
      await act(async () => root.render(<SoloTeamWorkspace />));
      await wait(250);
      await act(async () => (Array.from(host.querySelectorAll("button.stw-namebtn")).find((b) => b.textContent?.includes("Dana Reyes")) as HTMLButtonElement).click());
      await wait(50);
      await act(async () => set(document.querySelector<HTMLInputElement>('.stw-contact input[type="tel"]')!, "+15125550199"));
      await act(async () => set(host.querySelector<HTMLInputElement>('input[placeholder="e.g. Client Success Manager"]')!, "Unsent work title"));
      const readsBefore = reads;
      await act(async () => (Array.from(host.querySelectorAll<HTMLButtonElement>('.stw-permission-change [role="radio"]')).find(b => b.textContent?.includes("Admin"))!).click());
      await act(async () => byText(host, "Confirm access change")!.click());
      await wait(100);
      expect(mocks.rpc).toHaveBeenCalledWith("set_solo_team_member_permission", { _member_user_id: "member-1", _new_permission: "admin", _expected_tenant_id: "tenant-1", _expected_membership_id: "m1" });
      expect(host.querySelector('[role="dialog"]')).not.toBeNull();
      expect(document.querySelector<HTMLInputElement>('.stw-contact input[type="tel"]')?.value).toBe("+15125550199");
      expect(host.querySelector<HTMLInputElement>('input[placeholder="e.g. Client Success Manager"]')?.value).toBe("Unsent work title");
      expect(host.querySelector('.stw-permission-change [role="radio"][aria-checked="true"]')?.textContent).toContain("Admin");
      expect(reads).toBe(readsBefore);
      expect(mocks.rpc.mock.calls.filter(([name]) => String(name).startsWith("set_")).map(([name]) => name)).toEqual(["set_solo_team_member_permission"]);
      await act(async () => byText(host, "Cancel")!.click());
      await wait(100);
      expect(host.querySelector('[role="dialog"]')).toBeNull();
      expect(reads).toBeGreaterThan(readsBefore);
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it("keeps unsaved contact edits when the work details are saved and the roster reloads", async () => {
    let reads = 0;
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === "get_solo_team_workspace") {
        reads += 1;
        if (reads > 1) await new Promise((r) => setTimeout(r, 60));
        return { data: { tenant_id: "tenant-1", tenant_name: "Example Team", viewer_permission: "owner", viewer_is_account_holder: false, can_manage_profiles: true, can_manage_invitations: true, can_change_permissions: true, total_members: 1, members: [dana], invitations: [] }, error: null };
      }
      if (name === "set_solo_team_member_work_profile") return { data: { membership_id: dana.membership_id, job_title: "Delivery Lead", responsibilities: "Runs onboarding." }, error: null };
      return { data: null, error: { message: `unexpected ${name}` } };
    });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(<SoloTeamWorkspace />));
    await wait(250);
    await act(async () => (Array.from(host.querySelectorAll("button.stw-namebtn")).find((b) => b.textContent?.includes("Dana Reyes")) as HTMLButtonElement).click());
    await wait(50);

    const phone = document.querySelector<HTMLInputElement>('.stw-contact input[type="tel"]')!;
    expect(phone.value).toBe("+15125550100");
    await act(async () => set(phone, "+15125550199"));
    await act(async () => set(host.querySelector<HTMLInputElement>('input[placeholder="e.g. Client Success Manager"]')!, "Delivery Lead"));
    await act(async () => byText(host, "Save work details")!.click());
    await wait(300);

    expect(host.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.querySelector<HTMLInputElement>('.stw-contact input[type="tel"]')?.value).toBe("+15125550199");
    expect(byText(host, "Save contact details")).toBeTruthy();
    await act(async () => root.unmount());
    host.remove();
  });
});
