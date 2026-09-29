import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemberEditor } from "./team-workspace";
import type { TeamMemberRecord, TeamWorkspaceRecord } from "./team-workspace-contract";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getUser: async () => ({ data: { user: { id: "viewer-under-test" } } }) }, from: () => ({ select: () => ({ eq: async () => ({ data: [], error: null }) }) }), rpc: mocks.rpc, functions: { invoke: vi.fn() } },
}));

vi.mock("@/hooks/useTenantContext", () => ({
  useTenantContext: () => ({ activeTenantId: "tenant-1", loading: false }),
}));

vi.mock("sonner", () => ({
  toast: { success: mocks.success, error: mocks.error, warning: vi.fn() },
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const member: TeamMemberRecord = {
  membership_id: "membership-1",
  user_id: "member-1",
  full_name: null,
  email: "member@example.com",
  avatar_url: null,
  status: "active",
  permission: "member",
  is_owner: false,
  job_title: "Client Coordinator",
  responsibilities: "Owns client handoffs.",
  last_sign_in_at: null,
};

const workspace: TeamWorkspaceRecord = {
  tenant_id: "tenant-1",
  tenant_name: "Example Team",
  viewer_permission: "owner",
  can_manage_profiles: true,
  can_manage_invitations: true,
  can_change_permissions: true,
  total_members: 1,
  members: [member],
  invitations: [],
};

function setValue(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("Solo Team member work-details dialog", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    mocks.rpc.mockReset();
    mocks.success.mockReset();
    mocks.error.mockReset();
  });

  it("shows email for a member without a verified name and opens in a truthful Save state", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);

    await act(async () => root.render(<MemberEditor member={member} workspace={workspace} onClose={vi.fn()} onSaved={vi.fn()} />));

    expect(host.textContent).toContain("member@example.com");
    expect(host.textContent).not.toContain("Name not provided");
    expect(host.textContent).not.toContain("Edit work details");
    expect(Array.from(host.querySelectorAll("button")).some((button) => button.textContent?.trim() === "Save work details")).toBe(true);
    expect(host.querySelector<HTMLInputElement>('input[placeholder="e.g. Client Success Manager"]')?.disabled).toBe(false);
    expect(host.querySelector<HTMLTextAreaElement>('textarea[placeholder="What this person owns, decides, and hands off."]')?.disabled).toBe(false);

    await act(async () => root.unmount());
  });

  it("labels unsaved work-details abandonment as Cancel and performs no write", async () => {
    const onClose = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(<MemberEditor member={member} workspace={workspace} onClose={onClose} onSaved={vi.fn()} />));

    const title = host.querySelector<HTMLInputElement>('input[placeholder="e.g. Client Success Manager"]')!;
    expect(Array.from(host.querySelectorAll("button")).some((button) => button.textContent?.trim() === "Close")).toBe(true);
    await act(async () => setValue(title, "Delivery Lead"));
    const cancel = Array.from(host.querySelectorAll("button")).find((button) => button.textContent?.trim() === "Cancel") as HTMLButtonElement;
    expect(cancel).toBeTruthy();
    await act(async () => cancel.click());

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).not.toHaveBeenCalled();
    await act(async () => root.unmount());
  });

  it("labels abandoning unsaved contact edits as Cancel too, not Close", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(<MemberEditor member={member} workspace={workspace} onClose={vi.fn()} onSaved={vi.fn()} />));
    await act(async () => { for (let i = 0; i < 4; i++) await Promise.resolve(); });
    const footer = () => host.querySelector(".stw-modal-actions button")?.textContent?.trim();
    expect(footer()).toBe("Close");
    await act(async () => (host.querySelector('[data-ctm-add="email"]') as HTMLButtonElement).click());
    await act(async () => setValue(host.querySelector<HTMLInputElement>('.stw-contact input[type="email"]')!, "member.two@example.com"));
    expect(footer()).toBe("Cancel");
    await act(async () => root.unmount());
  });

  it("keeps saved values visible and never changes permission during a work-details save", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: { membership_id: member.membership_id, job_title: "Operations Lead", responsibilities: "Owns delivery and weekly planning." },
      error: null,
    });
    const onSaved = vi.fn().mockResolvedValue(undefined);
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(<MemberEditor member={member} workspace={workspace} onClose={vi.fn()} onSaved={onSaved} />));

    const title = host.querySelector<HTMLInputElement>('input[placeholder="e.g. Client Success Manager"]')!;
    const responsibilities = host.querySelector<HTMLTextAreaElement>('textarea[placeholder="What this person owns, decides, and hands off."]')!;
    const save = Array.from(host.querySelectorAll("button")).find((button) => button.textContent?.trim() === "Save work details") as HTMLButtonElement;
    expect(save.disabled).toBe(true);

    await act(async () => {
      setValue(title, "Operations Lead");
      setValue(responsibilities, "Owns delivery and weekly planning.");
    });
    expect(save.disabled).toBe(false);
    await act(async () => save.click());

    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith("set_solo_team_member_work_profile", {
      _member_user_id: member.user_id,
      _job_title: "Operations Lead",
      _responsibilities: "Owns delivery and weekly planning.",
    });
    expect(mocks.rpc).not.toHaveBeenCalledWith("set_solo_team_member_permission", expect.anything());
    expect(title.value).toBe("Operations Lead");
    expect(responsibilities.value).toBe("Owns delivery and weekly planning.");
    expect(save.disabled).toBe(true);
    expect(host.querySelector('[role="status"]')?.textContent).toContain("Work details saved");
    expect(host.textContent).not.toContain("Edit work details");
    expect(onSaved).toHaveBeenCalledTimes(1);

    await act(async () => root.unmount());

    const reopenedHost = document.createElement("div");
    document.body.append(reopenedHost);
    const reopenedRoot = createRoot(reopenedHost);
    const persistedMember = {
      ...member,
      job_title: "Operations Lead",
      responsibilities: "Owns delivery and weekly planning.",
    };
    await act(async () => reopenedRoot.render(<MemberEditor member={persistedMember} workspace={{ ...workspace, members: [persistedMember] }} onClose={vi.fn()} onSaved={vi.fn()} />));

    expect(reopenedHost.querySelector<HTMLInputElement>('input[placeholder="e.g. Client Success Manager"]')?.value).toBe("Operations Lead");
    expect(reopenedHost.querySelector<HTMLTextAreaElement>('textarea[placeholder="What this person owns, decides, and hands off."]')?.value).toBe("Owns delivery and weekly planning.");
    expect(reopenedHost.querySelector<HTMLSelectElement>(".stw-permission-change select")?.value).toBe("member");
    expect(mocks.rpc).toHaveBeenCalledTimes(1);

    await act(async () => reopenedRoot.unmount());
  });
  it("keeps unsaved values visible and reports the error when the save fails", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: "Work details could not be saved." } });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(<MemberEditor member={member} workspace={workspace} onClose={vi.fn()} onSaved={vi.fn()} />));

    const title = host.querySelector<HTMLInputElement>('input[placeholder="e.g. Client Success Manager"]')!;
    await act(async () => setValue(title, "Delivery Lead"));
    const save = Array.from(host.querySelectorAll("button")).find((button) => button.textContent?.trim() === "Save work details") as HTMLButtonElement;
    await act(async () => save.click());

    expect(title.value).toBe("Delivery Lead");
    expect(host.querySelector('[role="status"]')).toBeNull();
    expect(mocks.error).toHaveBeenCalledWith("Work details could not be saved.");
    expect(mocks.success).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledTimes(1);

    await act(async () => root.unmount());
  });
});
