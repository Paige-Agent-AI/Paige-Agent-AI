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
  it("keeps unsaved contact edits when the work details are saved and the roster reloads", async () => {
    let reads = 0;
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === "get_solo_team_workspace") {
        reads += 1;
        if (reads > 1) await new Promise((r) => setTimeout(r, 60));
        return { data: { tenant_id: "tenant-1", tenant_name: "Example Team", viewer_permission: "owner", can_manage_profiles: true, can_manage_invitations: true, can_change_permissions: true, total_members: 1, members: [dana], invitations: [] }, error: null };
      }
      if (name === "set_solo_team_member_work_profile") return { data: { job_title: "Delivery Lead", responsibilities: "Runs onboarding." }, error: null };
      return { data: null, error: { message: `unexpected ${name}` } };
    });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(<SoloTeamWorkspace />));
    await wait(250);
    await act(async () => (Array.from(host.querySelectorAll("button.stw-row")).find((b) => b.textContent?.includes("Dana Reyes")) as HTMLButtonElement).click());
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
