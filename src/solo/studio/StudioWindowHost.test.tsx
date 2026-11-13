// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const h = vi.hoisted(() => ({ tenant: "test-tenant-a", actor: "test-user-a", mounts: 0 }));
vi.mock("@/hooks/useTenantContext", () => ({ useTenantContext: () => ({ activeTenantId: h.tenant, activeUserId: h.actor }) }));
vi.mock("../vibe", () => ({ VibeStudio: ({ minimized, launch, onMinimize, onBack, onStartPending }: { minimized: boolean; launch: { sessionId?: string; pendingStartId?: string }; onMinimize: () => void; onBack: () => void; onStartPending: (id: string) => void }) => {
  React.useEffect(() => { h.mounts++; }, []);
  return <div data-studio hidden={minimized}><span>{launch.sessionId}</span><span data-pending>{launch.pendingStartId}</span><input aria-label="Unsent change" /><button onClick={() => onStartPending(ID)}>Uncertain start</button><button onClick={onMinimize}>Minimize</button><button onClick={onBack}>Close</button></div>;
} }));
const { StudioWindowHost } = await import("./StudioWindowHost");
const { StudioLaunchButton } = await import("./StudioLaunchButton");
const ID = "11111111-1111-4111-8111-111111111111";
let host: HTMLDivElement, root: Root;
function Fixture() { const location = useLocation(), navigate = useNavigate(); return <div data-tenant-shell><StudioLaunchButton sessionId={ID} /><button onClick={() => navigate("/solo/test/team-hub")}>Team Hub</button><output>{location.pathname + location.search}</output><StudioWindowHost /></div>; }
async function render(path = "/solo/test/chat") { await act(async () => root.render(<MemoryRouter initialEntries={[path]}><Fixture /></MemoryRouter>)); }
function button(label: string) { return [...host.querySelectorAll<HTMLButtonElement>("button")].find(x => x.textContent === label)!; }
beforeEach(() => { h.tenant = "test-tenant-a"; h.actor = "test-user-a"; h.mounts = 0; host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });
it("keeps one original window and unsent edits while minimized and across Chat/Hub navigation", async () => {
  await render(); await act(async () => button("Open Studio").click());
  const input = host.querySelector<HTMLInputElement>('input[aria-label="Unsent change"]')!;
  input.value = "Unsent design edit";
  await act(async () => button("Minimize").click());
  expect(host.querySelector<HTMLElement>("[data-studio]")?.hidden).toBe(true);
  await act(async () => button("Team Hub").click());
  await act(async () => button("Restore Studio").click());
  expect(host.querySelector('input[aria-label="Unsent change"]')).toBe(input);
  expect(input.value).toBe("Unsent design edit"); expect(h.mounts).toBe(1);
  expect(host.querySelector("output")?.textContent).toContain(`/team-hub?studio=${ID}`);
});
it("reopens only the original ID from URL without a start/seed and drops the host on scope change", async () => {
  await render(`/solo/test/chat?studio=${ID}&studio_min=1`);
  expect(host.querySelector("[data-studio]")?.textContent).toContain(ID);
  expect(host.querySelector<HTMLElement>("[data-studio]")?.hidden).toBe(true);
  h.actor = "test-user-b";
  await render();
  expect(host.querySelector("[data-studio]")).toBeNull();
  expect(host.querySelector("output")?.textContent).not.toContain("studio=");
});
it("refuses detached/disabled/nonbutton/hidden launchers and malformed project references", async () => {
  await render();
  const valid = button("Open Studio"), detached = document.createElement("button");
  detached.setAttribute("data-solo-vibe-studio-launcher", "");
  const send = (target: HTMLElement, sessionId: string = ID) => window.dispatchEvent(new CustomEvent("paige-studio", { detail: { returnFocus: target, sessionId } }));
  await act(async () => { send(detached); send(host.querySelector("output")!); send(valid, "https://example.test/"); valid.disabled = true; send(valid); valid.disabled = false; valid.hidden = true; send(valid); });
  expect(host.querySelector("[data-studio]")).toBeNull();
});
it("waits for initial identity resolution before recovering the original URL pointer", async () => {
  h.actor = ""; h.tenant = "";
  await render(`/solo/test/chat?studio=${ID}`);
  expect(host.querySelector("[data-studio]")).toBeNull();
  h.actor = "test-user-a"; h.tenant = "test-tenant-a";
  await render();
  expect(host.querySelector("[data-studio]")?.textContent).toContain(ID);
});
it("retains the uncertain original start pointer when closed across route navigation", async () => {
  await render(`/solo/test/chat?studio_start=${ID}`);
  expect(host.querySelector("[data-pending]")?.textContent).toBe(ID);
  await act(async () => button("Close").click());
  await act(async () => button("Team Hub").click());
  expect(host.querySelector("output")?.textContent).toContain(`studio_start=${ID}`);
  // The existing launcher reopens the original project while the unrelated
  // pending pointer remains recoverable in this same shell.
  h.actor = "test-user-b";
  await render();
  expect(host.querySelector("output")?.textContent).not.toContain("studio_start=");
});
