/**
 * The Team screen says "title", never "job title".
 *
 * Owner ruling: owner, admin and member are the only roles; everything else people call each other
 * is a title. The screen is where an owner reads and sets it, so each state that shows the word is
 * mounted here: the roster (including a person with no title), the first-use callout, the member
 * editor, the permission-change confirmation, the invitation form and its review step, and Roles &
 * access. jsdom against the real components, Supabase mocked; it proves the copy a person reads, not
 * the database.
 *
 * The screen writes the word in its own sentences; the chat side reads it from one constant. Every
 * assertion here is built from that constant, so changing the word turns this suite red until the
 * screen says the new word too. That is the tie between the two.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SoloTeamWorkspace } from "./team-workspace";
import { TITLE_WORD } from "../../supabase/functions/_shared/team-vocabulary";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), invoke: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getUser: async () => ({ data: { user: { id: "viewer-under-test" } } }) }, from: () => ({ select: () => ({ eq: async () => ({ data: [], error: null }) }) }), rpc: mocks.rpc, functions: { invoke: mocks.invoke } },
}));
vi.mock("@/hooks/useTenantContext", () => ({
  useTenantContext: () => ({ activeTenantId: "tenant-1", loading: false }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const word = TITLE_WORD;
const Word = TITLE_WORD[0].toUpperCase() + TITLE_WORD.slice(1);

const member = (user_id: string, full_name: string, permission: string, job_title: string | null) => ({
  membership_id: `m-${user_id}`, user_id, full_name, email: `${user_id}@example.com`, avatar_url: null,
  status: "active", permission, is_owner: permission === "owner", job_title, responsibilities: null,
  last_sign_in_at: null,
});

const OWNER = member("owner-1", "Morgan Lee", "owner", "Founder");
const TEAM = {
  tenant_id: "tenant-1", tenant_name: "Example Team", viewer_permission: "owner",
  can_manage_profiles: true, can_manage_invitations: true, can_change_permissions: true, total_members: 3,
  members: [OWNER, member("trainer-1", "Sam Rivera", "member", "Head Trainer"), member("new-1", "Alex Kim", "member", null)],
  invitations: [],
};
// A workspace that is just its owner: the only state in which the first-use callout appears.
const JUST_THE_OWNER = { ...TEAM, total_members: 1, members: [OWNER] };

async function mountScreen(workspace = TEAM, waitFor = "Sam Rivera") {
  mocks.rpc.mockImplementation(async (name: string) =>
    name === "get_solo_team_workspace" ? { data: workspace, error: null } : { data: null, error: { message: "not in this test" } });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<SoloTeamWorkspace />));
  // The roster arrives from an asynchronous read. Wait for a person to be on screen, bounded, so a
  // screen that never loads fails here rather than passing on an empty page.
  for (let i = 0; i < 50 && !(host.textContent ?? "").includes(waitFor); i++) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
  }
  expect(host.textContent, "the roster loaded").toContain(waitFor);
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
// Set a controlled field the way a person does, so React sees the change.
async function choose(el: HTMLInputElement | HTMLSelectElement, value: string, event: "input" | "change") {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event(event, { bubbles: true }));
  });
}

beforeEach(() => {
  document.body.innerHTML = "";
  mocks.rpc.mockReset();
  mocks.invoke.mockReset();
});

describe("the Team screen's word for what someone is called", () => {
  it(`the roster says ${Word} not set for a person without one, and never job title`, async () => {
    await mountScreen();
    expect(text()).toContain("Head Trainer");
    expect(text()).toContain(`${Word} not set`);
    expect(text()).toContain(`enforced permission, ${word}, and responsibilities`);
    expect(text()).not.toMatch(/job title/i);
  });

  it("the first-use callout tells a new owner to give their first teammate a title", async () => {
    await mountScreen(JUST_THE_OWNER, "Morgan Lee");
    expect(text()).toContain(`Invite the first teammate, then give them a ${word} and clear responsibilities.`);
    expect(text()).not.toMatch(/job title/i);
  });

  it(`the member editor labels the field ${Word} and keeps it separate from access`, async () => {
    await mountScreen();
    await clickText("Sam Rivera");
    expect(document.querySelector("[role='dialog']")).toBeTruthy();
    expect(labels()).toContain(Word);
    expect(text()).toContain(`Permission and ${word} are separate.`);
    expect(text()).toContain(`Changing someone’s ${word} never changes their access.`);
    expect(text()).not.toMatch(/job title|renaming this person/i);
  });

  it(`the permission-change confirmation says it changes authorization, not the ${word}`, async () => {
    await mountScreen();
    await clickText("Sam Rivera");
    const select = document.querySelector("[role='dialog'] .stw-permission-change select") as HTMLSelectElement;
    expect(select, "the owner is offered the permission control").toBeTruthy();
    await choose(select, "admin", "change");
    expect(text()).toContain(`This changes authorization, not the ${word}.`);
    expect(text()).not.toMatch(/job title/i);
  });

  it(`the invitation form and its review step both say ${Word}`, async () => {
    await mountScreen();
    await clickText("Invite someone");
    expect(labels()).toContain(Word);
    expect(text()).not.toMatch(/job title/i);

    await choose(document.querySelector("input[type='email']") as HTMLInputElement, "desk@example.com", "input");
    // Inside the dialog: the page behind it has its own "Review roles" button.
    const dialog = document.querySelector("[role='dialog']")!;
    const review = Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent?.trim().startsWith("Review"));
    expect(review, "the review button").toBeTruthy();
    await act(async () => review!.click());
    expect(text()).toContain("Confirm invitation");
    expect(Array.from(document.querySelectorAll("dt")).map((n) => n.textContent?.trim())).toContain(Word);
    expect(text()).not.toMatch(/job title/i);
  });

  it(`Roles & access says ${word}s describe work`, async () => {
    await mountScreen();
    await clickText("Roles & access");
    expect(text()).toContain(`${Word}s and responsibilities only describe work.`);
    expect(text()).not.toMatch(/job title/i);
  });
});
