import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TeamMemberContact } from "./team-member-contact";
import { contactAccess, type TeamMemberRecord, type TeamWorkspaceRecord } from "./team-workspace-contract";

const mocks = vi.hoisted(() => ({
  viewer: "viewer-1" as string | null,
  rows: [] as unknown[],
  readError: null as { message: string } | null,
  rpc: vi.fn(),
  eq: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: mocks.viewer ? { id: mocks.viewer } : null } }) },
    from: (table: string) => ({ select: () => ({ eq: async (column: string, value: string) => { mocks.eq(table, column, value); return { data: mocks.readError ? null : mocks.rows, error: mocks.readError }; } }) }),
    rpc: mocks.rpc,
  },
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const person = (over: Partial<TeamMemberRecord> = {}): TeamMemberRecord => ({
  membership_id: "m-1", user_id: "member-1", full_name: "Sam Okafor", email: "sam@example.com", avatar_url: null,
  status: "active", permission: "member", is_owner: false, job_title: null, responsibilities: null, last_sign_in_at: null, ...over,
});
const space = (viewer_permission: TeamWorkspaceRecord["viewer_permission"]): TeamWorkspaceRecord => ({
  tenant_id: "t-1", tenant_name: "Example Team", viewer_permission, can_manage_profiles: viewer_permission !== "member",
  can_manage_invitations: true, can_change_permissions: true, total_members: 2, members: [], invitations: [],
});
const row = (id: string, kind: "email" | "phone", value: string, is_primary: boolean, position: number, label: string | null = null) =>
  ({ id, user_id: "member-1", kind, value, label, is_primary, position });

let host: HTMLDivElement;
let root: Root;
const flush = () => act(async () => { for (let i = 0; i < 4; i++) await Promise.resolve(); });
async function mount(member: TeamMemberRecord, workspace: TeamWorkspaceRecord, onDirtyChange?: (d: boolean) => void) {
  await act(async () => { root.render(<TeamMemberContact member={member} workspace={workspace} onDirtyChange={onDirtyChange} />); });
  await flush();
}
const click = (el: Element | null) => act(async () => { (el as HTMLElement).click(); });
const button = (text: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === text) ?? null;
function type(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

beforeEach(() => {
  mocks.viewer = "viewer-1"; mocks.rows = []; mocks.readError = null; mocks.rpc.mockReset(); mocks.eq.mockReset();
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

describe("who may change a teammate's addresses", () => {
  it("mirrors set_user_contact_methods: yourself; an owner or an admin, anyone, the owner included; a member, nobody else", () => {
    expect(contactAccess(person({ user_id: "me" }), space("member"), "me")).toBe("edit");
    expect(contactAccess(person({ is_owner: true }), space("owner"), "me")).toBe("edit");
    expect(contactAccess(person(), space("admin"), "me")).toBe("edit");
    expect(contactAccess(person({ is_owner: true }), space("admin"), "me")).toBe("edit");
    expect(contactAccess(person(), space("member"), "me")).toBe("hidden");
    expect(contactAccess(person({ user_id: "me" }), space("member"), null)).toBe("hidden");
  });
});

describe("Team → how the team reaches a person", () => {
  it("an admin edits the owner's addresses like anyone's, and the sign-in address stays apart", async () => {
    mocks.rows = [row("e1", "email", "dana@example.com", true, 0), row("p1", "phone", "5125550100", true, 0)];
    await mount(person({ user_id: "owner-1", full_name: "Dana Whitfield", is_owner: true, permission: "owner" }), space("admin"));
    expect(mocks.eq).toHaveBeenCalledWith("user_contact_methods", "user_id", "owner-1");
    expect(host.textContent).toContain("Dana's contact details");
    expect(host.textContent).toContain("Used to sign in. Nothing on this screen changes it.");
    expect(host.textContent).not.toContain("Only the owner can change");
    // A team member's addresses carry no promise about what Paige sends to or recognises.
    expect(host.textContent).not.toMatch(/Paige (sends|texts|recognises)/);
    const input = host.querySelector<HTMLInputElement>('input[type="email"]')!;
    expect(input.value).toBe("dana@example.com");
    await act(async () => { type(input, "dana@brightpath.example"); });
    mocks.rpc.mockResolvedValue({ data: [row("e1", "email", "dana@brightpath.example", true, 0), row("p1", "phone", "5125550100", true, 0)], error: null });
    await click(button("Save contact details"));
    await flush();
    expect(mocks.rpc).toHaveBeenCalledWith("set_user_contact_methods", expect.objectContaining({ p_user_id: "owner-1" }));
    expect(host.textContent).toContain("Dana's contact details are saved.");
  });

  it("a member opening a teammate reads nothing and shows nothing", async () => {
    await mount(person(), space("member"));
    expect(mocks.eq).not.toHaveBeenCalled();
    expect(host.textContent).toBe("");
  });

  it("you add a second email to your own row and save the whole ordered list through set_user_contact_methods", async () => {
    mocks.rows = [row("e1", "email", "sam@example.com", true, 0, "Work")];
    const dirty = vi.fn();
    await mount(person({ user_id: "viewer-1" }), space("member"), dirty);
    expect(host.textContent).toContain("Your contact details");
    // Nothing to save yet, so no act-coloured control is offered at rest.
    expect(button("Save contact details")).toBeNull();

    await click(host.querySelector('[data-ctm-add="email"]'));
    const inputs = host.querySelectorAll<HTMLInputElement>('input[type="email"]');
    await act(async () => { type(inputs[inputs.length - 1], "sam.personal@example.com"); });
    expect(dirty).toHaveBeenLastCalledWith(true);

    mocks.rpc.mockResolvedValue({ data: [row("e1", "email", "sam@example.com", true, 0, "Work"), row("e9", "email", "sam.personal@example.com", false, 1, "Personal")], error: null });
    await click(button("Save contact details"));
    await flush();
    expect(mocks.rpc).toHaveBeenCalledWith("set_user_contact_methods", {
      p_user_id: "viewer-1",
      p_methods: [
        { kind: "email", value: "sam@example.com", label: "Work", is_primary: true },
        { kind: "email", value: "sam.personal@example.com", label: "Personal", is_primary: false },
      ],
    });
    expect(host.textContent).toContain("Your contact details are saved.");
    // The save button leaves once nothing is unsaved; focus lands on the outcome, not the page.
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(document.activeElement?.textContent).toBe("Your contact details are saved.");
    expect(dirty).toHaveBeenLastCalledWith(false);
  });

  it("does not save a list the database would refuse, and says why on the row", async () => {
    await mount(person({ user_id: "viewer-1" }), space("member"));
    await click(host.querySelector('[data-ctm-add="email"]'));
    const input = host.querySelector<HTMLInputElement>('input[type="email"]')!;
    await act(async () => { type(input, "sam@incomplete"); });
    await click(button("Save contact details"));
    await flush();
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(host.textContent).toContain("That isn't a complete email address.");
  });

  it("puts a server refusal on its row, and a refusal of authority in words", async () => {
    mocks.rows = [row("e1", "email", "sam@example.com", true, 0)];
    await mount(person(), space("owner"));
    const input = host.querySelector<HTMLInputElement>('input[type="email"]')!;
    await act(async () => { type(input, "sam@example.co"); });

    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: "CONTACT_METHOD_INVALID_EMAIL: sam@example.co" } });
    await click(button("Save contact details"));
    await flush();
    expect(host.textContent).toContain("That isn't a complete email address.");

    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: "USER_CONTACT_METHODS_FORBIDDEN" } });
    await act(async () => { type(input, "sam@example.net"); });
    await click(button("Save contact details"));
    await flush();
    expect(host.querySelector(".stw-contact-msg.is-bad")?.textContent).toBe("You can't change this person's contact details from this workspace.");
    expect(host.querySelector('[aria-live="polite"]')?.textContent).toBe("You can't change this person's contact details from this workspace.");
    expect(host.textContent).not.toContain("USER_CONTACT_METHODS_FORBIDDEN");
  });

  it("says the read failed, and retries, instead of showing an empty list as if nothing were recorded", async () => {
    mocks.readError = { message: "network down" };
    await mount(person(), space("owner"));
    expect(host.textContent).toContain("Contact details unavailable");
    expect(host.querySelector('[data-ctm-add="email"]')).toBeNull();
    mocks.readError = null; mocks.rows = [row("e1", "email", "sam@example.com", true, 0)];
    await click(button("Retry"));
    await flush();
    expect(host.querySelector<HTMLInputElement>('input[type="email"]')?.value).toBe("sam@example.com");
  });
});
