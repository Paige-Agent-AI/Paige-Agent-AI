/**
 * The Team screen says "title", never "job title".
 *
 * Owner ruling: owner, admin and member are the only roles; everything else people call each other
 * is a title. The screen is where an owner reads and sets it, so every state that shows the word is
 * mounted here: the roster (including a person with no title), the member editor, the invitation
 * form and its review step, and Roles & access. jsdom against the real components, Supabase mocked;
 * it proves the copy a person reads, not the database.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SoloTeamWorkspace } from "./team-workspace";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), invoke: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: mocks.rpc, functions: { invoke: mocks.invoke } },
}));
vi.mock("@/hooks/useTenantContext", () => ({
  useTenantContext: () => ({ activeTenantId: "tenant-1", loading: false }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const member = (user_id: string, full_name: string, permission: string, job_title: string | null) => ({
  membership_id: `m-${user_id}`, user_id, full_name, email: `${user_id}@example.com`, avatar_url: null,
  status: "active", permission, is_owner: permission === "owner", job_title, responsibilities: null,
  last_sign_in_at: null,
});

const WORKSPACE = {
  tenant_id: "tenant-1", tenant_name: "Example Team", viewer_permission: "owner",
  can_manage_profiles: true, can_manage_invitations: true, can_change_permissions: true, total_members: 3,
  members: [
    member("owner-1", "Morgan Lee", "owner", "Founder"),
    member("trainer-1", "Sam Rivera", "member", "Head Trainer"),
    member("new-1", "Alex Kim", "member", null),
  ],
  invitations: [],
};

async function mountScreen() {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<SoloTeamWorkspace />));
  // The roster arrives from an asynchronous read. Wait for a person to be on screen, bounded, so a
  // screen that never loads fails here rather than passing on an empty page.
  for (let i = 0; i < 50 && !(host.textContent ?? "").includes("Sam Rivera"); i++) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
  }
  expect(host.textContent, "the roster loaded").toContain("Sam Rivera");
  return host;
}

const text = () => document.body.textContent ?? "";
const labels = () => Array.from(document.querySelectorAll("label, dt")).map((n) => n.firstChild?.textContent?.trim() ?? "");
const clickText = async (value: string) => {
  const target = Array.from(document.querySelectorAll("button, [role='tab'], a"))
    .find((n) => n.textContent?.trim() === value || n.textContent?.includes(value));
  expect(target, `a control reading "${value}"`).toBeTruthy();
  await act(async () => (target as HTMLElement).click());
};

beforeEach(() => {
  document.body.innerHTML = "";
  mocks.rpc.mockReset();
  mocks.invoke.mockReset();
  mocks.rpc.mockImplementation(async (name: string) =>
    name === "get_solo_team_workspace" ? { data: WORKSPACE, error: null } : { data: null, error: { message: "not in this test" } });
});

describe("the Team screen's word for what someone is called", () => {
  it("the roster says Title not set for a person without one, and never job title", async () => {
    await mountScreen();
    expect(text()).toContain("Head Trainer");
    expect(text()).toContain("Title not set");
    expect(text()).toContain("enforced permission, title, and responsibilities");
    expect(text()).not.toMatch(/job title/i);
  });

  it("the member editor labels the field Title and keeps title separate from access", async () => {
    await mountScreen();
    await clickText("Sam Rivera");
    expect(document.querySelector("[role='dialog']")).toBeTruthy();
    expect(labels()).toContain("Title");
    expect(text()).toContain("Permission and title are separate.");
    expect(text()).toContain("Changing someone’s title never changes their access.");
    expect(text()).not.toMatch(/job title|renaming this person/i);
  });

  it("the invitation form and its review step both say Title", async () => {
    await mountScreen();
    await clickText("Invite someone");
    expect(labels()).toContain("Title");
    expect(text()).not.toMatch(/job title/i);

    // Type an address the way a person does, so React sees the change, then open the review step.
    const email = document.querySelector("input[type='email']") as HTMLInputElement;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    await act(async () => {
      setValue.call(email, "desk@example.com");
      email.dispatchEvent(new Event("input", { bubbles: true }));
    });
    // Inside the dialog: the page behind it has its own "Review roles" button.
    const dialog = document.querySelector("[role='dialog']")!;
    const review = Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent?.trim().startsWith("Review"));
    expect(review, "the review button").toBeTruthy();
    await act(async () => review!.click());
    expect(text()).toContain("Confirm invitation");
    expect(Array.from(document.querySelectorAll("dt")).map((n) => n.textContent?.trim())).toContain("Title");
    expect(text()).not.toMatch(/job title/i);
  });

  it("Roles & access says titles describe work", async () => {
    await mountScreen();
    await clickText("Roles & access");
    expect(text()).toContain("Titles and responsibilities only describe work.");
    expect(text()).not.toMatch(/job title/i);
  });
});
