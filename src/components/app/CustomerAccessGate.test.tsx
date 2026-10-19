import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

/**
 * E09 Slice 7 — a customer whose access was paused or ended sees that, under the business's own
 * name, and nothing of the platform shell: no Support desk, no Playbook persona, no menu (owner
 * decision 2026-10-17). The shell children are not rendered at all, so nothing in them can load.
 */
const f = vi.hoisted(() => ({
  frame: { phase: "ready", frame: null, access: null, checking: false, epoch: 0, actorId: "test-customer-a", reload: vi.fn() } as Record<string, unknown>,
  signOut: vi.fn(), target: vi.fn(), calls: [] as unknown[][],
}));
vi.mock("@/hooks/useClientPortalFrame", () => ({
  useClientPortalFrame: (...a: unknown[]) => { f.calls.push(a); return f.frame; },
  ClientPortalFrameProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/lib/auth/signOut", () => ({ performSignOut: (...a: unknown[]) => f.signOut(...a), customerSignOutTarget: (...a: unknown[]) => f.target(...a) }));
import { CustomerAccessGate } from "./CustomerAccessGate";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root;
const Shell = () => <nav data-platform-shell>Support · Platform persona</nav>;
const show = async (enabled = true) => {
  await act(async () => root.render(<CustomerAccessGate userId="test-customer-a" enabled={enabled}><Shell /></CustomerAccessGate>));
};
const withheld = (phase: "paused" | "ended") => ({ ...f.frame, phase, access: { businessName: "Test Studio", logoUrl: null, logoDarkUrl: null, since: "2026-10-18T12:00:00Z" } });
beforeEach(() => {
  vi.clearAllMocks(); f.calls = [];
  f.frame = { phase: "ready", frame: null, access: null, checking: false, epoch: 0, actorId: "test-customer-a", reload: vi.fn() };
  f.target.mockResolvedValue("/portal/test-studio"); f.signOut.mockResolvedValue(undefined);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

it.each([
  ["paused", "Your access to Test Studio is paused.", "Test Studio has paused your portal for now. Your portal messages and files are kept. If you have questions, reach out to Test Studio the way you usually do."],
  ["ended", "Your access to Test Studio has ended.", "If you’re working with them again, they can send you a new invitation."],
] as const)("a %s customer sees the business's own words and no platform shell", async (phase, title, body) => {
  f.frame = withheld(phase);
  await show();
  expect(host.querySelector("h1")?.textContent).toBe(title);
  expect(host.textContent).toContain(body);
  expect(host.querySelector("[data-platform-shell]")).toBeNull();
  expect(host.textContent).not.toMatch(/Support|persona/);
  const buttons = host.querySelectorAll("button");
  expect(buttons).toHaveLength(1);
  expect(buttons[0].textContent?.trim()).toBe("Sign out");
});

it("signing out returns them to their business's gateway", async () => {
  f.frame = withheld("paused");
  await show();
  await act(async () => host.querySelector("button")!.click());
  expect(f.target).toHaveBeenCalledWith("/");
  expect(f.signOut).toHaveBeenCalledWith("/portal/test-studio");
});

// Round 2 (compliance 6): when sign-out does not happen (an act-as check refuses or can't tell, or the
// gateway lookup fails), the page's only button must never be left disabled on "Signing out…".
it.each([
  ["sign-out reports it did not sign out", () => { f.signOut.mockResolvedValue(false); }],
  ["the gateway lookup fails", () => { f.target.mockRejectedValue(new Error("offline")); }],
] as const)("when %s, it says so and the button works again", async (_label, arrange) => {
  arrange();
  f.frame = withheld("ended");
  await show();
  await act(async () => host.querySelector("button")!.click());
  const button = host.querySelector("button")!;
  expect(button.disabled).toBe(false);
  expect(button.textContent?.trim()).toBe("Sign out");
  expect(host.querySelector('[role="alert"]')?.textContent).toBe("You’re still signed in. Try signing out again.");
  f.signOut.mockResolvedValue(undefined); f.target.mockResolvedValue("/portal/test-studio");
  await act(async () => button.click());
  expect(f.signOut).toHaveBeenLastCalledWith("/portal/test-studio");
});

it("an open customer, staff and a non-customer keep the shell exactly as before", async () => {
  for (const phase of ["ready", "not-client", "unavailable", "error"]) {
    f.frame = { ...f.frame, phase };
    await show();
    expect(host.querySelector("[data-platform-shell]"), phase).not.toBeNull();
  }
});

it("holds the shell until the first answer, so the platform desk never flashes for a paused customer", async () => {
  f.frame = { ...f.frame, phase: "loading", checking: true };
  await show();
  expect(host.querySelector("[data-platform-shell]")).toBeNull();
  expect(host.querySelector('[role="status"]')).not.toBeNull();
});

it("is not consulted while staff view as a client", async () => {
  f.frame = withheld("paused");
  await show(false);
  expect(f.calls[0]).toEqual(["test-customer-a", false]);
  expect(host.querySelector("[data-platform-shell]")).not.toBeNull();
});
