import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Round 2 (verifier #2): /app/paige-team showed a customer the PAIGE team directory. It is the owner's team;
// a customer who opens the address gets the portal's ordinary not-available state, with no PAIGE in it.
const standing = vi.hoisted(() => ({ value: { loading: false, staff: false as boolean | null } }));
vi.mock("@/lib/portal/portalStaffStanding", () => ({ usePortalStaffStanding: () => standing.value }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) } } }));
const { RequirePortalStaff } = await import("./RequirePortalStaff");
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root, host: HTMLDivElement;
beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });
async function mount() {
  await act(async () => { root.render(<MemoryRouter><RequirePortalStaff><p>Your Paige Team</p></RequirePortalStaff></MemoryRouter>); for (let i = 0; i < 10; i++) await Promise.resolve(); });
}

describe("RequirePortalStaff", () => {
  it("shows a customer the portal's not-available state, never the staff page", async () => {
    standing.value = { loading: false, staff: false };
    await mount();
    expect(host.textContent).toContain("This page isn't part of your portal");
    expect(host.textContent).not.toMatch(/paige/i);
    expect(host.querySelector('a[href="/app"]')?.textContent).toContain("Back to home");
  });
  it("shows the page to staff", async () => {
    standing.value = { loading: false, staff: true };
    await mount();
    expect(host.textContent).toContain("Your Paige Team");
  });
  it("shows neither while standing is unknown", async () => {
    standing.value = { loading: true, staff: null };
    await mount();
    expect(host.textContent).not.toContain("Your Paige Team");
    expect(host.querySelector('[role="status"]')).not.toBeNull();
  });
});
