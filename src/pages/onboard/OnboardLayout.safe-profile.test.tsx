import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { useOnboardingClient } from "./useOnboardingClient";

type HookState = Omit<ReturnType<typeof useOnboardingClient>, "refresh">;
let current: HookState;
let setCurrent: (next: HookState) => void;
const refresh = vi.fn();
const rpc = vi.fn();
vi.mock("./useOnboardingClient", () => ({ useOnboardingClient: () => ({ ...current, refresh }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...args: unknown[]) => rpc(...args) } }));
const { default: OnboardLayout } = await import("./OnboardLayout");
let host: HTMLDivElement, root: Root;
const failure: HookState = { loading: false, error: "profile_unavailable", client: null, userEmail: "customer@tests.invalid" };
function Harness() {
  const [state, setState] = useState(failure);
  current = state; setCurrent = setState;
  return <MemoryRouter initialEntries={["/onboard/welcome"]}><OnboardLayout /></MemoryRouter>;
}
beforeEach(() => {
  refresh.mockReset(); rpc.mockReset();
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

it("an unavailable authority read reports recovery without claiming an account mismatch or self-healing", async () => {
  await act(async () => { root.render(<Harness />); });
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("couldn't load your onboarding");
  expect(host.textContent).not.toContain("doesn't match their records");
  expect(rpc).not.toHaveBeenCalled();
});

it("a failed retry restores keyboard focus to the reachable retry control", async () => {
  refresh.mockImplementation(() => { setCurrent({ ...failure, loading: true, error: null }); return Promise.resolve(); });
  await act(async () => { root.render(<Harness />); });
  const first = host.querySelector<HTMLButtonElement>("button")!;
  first.focus();
  await act(async () => { first.click(); });
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(host.textContent).toContain("Loading your onboarding");
  await act(async () => { setCurrent(failure); });
  expect(document.activeElement).toBe(host.querySelector("button"));
});
