// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const h = vi.hoisted(() => ({ tenant: "test-tenant-a", actor: "test-user-a", loads: [] as Array<(v: unknown[]) => void>, mounts: 0 }));
vi.mock("@/hooks/useTenantContext", () => ({ useTenantContext: () => ({ activeTenantId: h.tenant, activeUserId: h.actor, activeTenant: { slug: "test-workspace" } }) }));
vi.mock("./studio/studio-data", () => ({ listSessions: () => new Promise(resolve => h.loads.push(resolve)), plainError: () => "Unavailable" }));
vi.mock("./studio/StudioHome", () => ({
  StudioRail: ({ sessions, onOpen, onMinimize }: { sessions: Array<{ id: string; title: string }> | null; onOpen: (s: { id: string }) => void; onMinimize?: () => void }) => <nav><button onClick={onMinimize}>Minimize</button>{sessions?.map(s => <button key={s.id} onClick={() => onOpen(s)}>{s.title}</button>)}</nav>,
  StudioHome: () => <input aria-label="Unsent project brief" />,
}));
vi.mock("./studio/StudioSession", () => ({ StudioSession: ({ sessionId, seedBrief, onMinimize }: { sessionId: string; seedBrief: string | null; onMinimize?: () => void }) => {
  React.useEffect(() => { h.mounts++; }, []);
  return <div><b>{sessionId}</b><span data-seed>{seedBrief}</span><input aria-label="Unsent project edit" /><button onClick={onMinimize}>Minimize</button></div>;
} }));
vi.mock("./studio/MediaTools", () => ({ MediaTools: () => null }));
const { VibeStudio } = await import("./vibe");
let host: HTMLDivElement, root: Root;
const close = vi.fn(), minimize = vi.fn();
beforeEach(() => { h.tenant = "test-tenant-a"; h.actor = "test-user-a"; h.loads = []; h.mounts = 0; close.mockClear(); minimize.mockClear(); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });
function render(minimized = false, launch?: { key: string; sessionId?: string }) { act(() => root.render(<VibeStudio onBack={close} onMinimize={minimize} minimized={minimized} launch={launch ? { ...launch, tenantId: "test-tenant-a", actorId: "test-user-a" } : undefined} />)); }

it("minimizes the same mounted project, keeps unsent work, and never seeds a reopened project", () => {
  const launch = { key: "open-1", sessionId: "test-session-one" };
  render(false, launch);
  const input = host.querySelector<HTMLInputElement>('input[aria-label="Unsent project edit"]')!;
  input.value = "Keep this unsent change";
  render(true, launch);
  expect(host.querySelector(".vs-studio")?.hasAttribute("hidden")).toBe(true);
  expect(host.querySelector(".vs-studio")?.getAttribute("aria-modal")).toBeNull();
  act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
  expect(close).not.toHaveBeenCalled();
  render(false, launch);
  expect(host.querySelector('input[aria-label="Unsent project edit"]')).toBe(input);
  expect(input.value).toBe("Keep this unsent change");
  expect(h.mounts).toBe(1);
  expect(host.querySelector("[data-seed]")?.textContent).toBe("");
  act(() => host.querySelector<HTMLButtonElement>("button")!.click());
  expect(minimize).toHaveBeenCalledOnce();
});

it("drops the prior private window immediately on tenant or actor change and ignores its late list", async () => {
  render(false, { key: "open-1", sessionId: "test-session-one" });
  const priorLoad = h.loads[0];
  h.tenant = "test-tenant-b";
  render(false, { key: "open-1", sessionId: "test-session-one" });
  expect(host.textContent).not.toContain("test-session-one");
  await act(async () => priorLoad([{ id: "old-private-project", title: "Old private title" }]));
  expect(host.textContent).not.toContain("Old private title");
  const input = host.querySelector<HTMLInputElement>("input")!;
  input.value = "Other person's private draft";
  h.actor = "test-user-b";
  render();
  expect(host.querySelector<HTMLInputElement>("input")?.value).toBe("");
});

it("new launch restores by original ID without creating or reseeding a project", () => {
  render(false, { key: "open-1", sessionId: "test-session-one" });
  render(false, { key: "open-2", sessionId: "test-session-two" });
  expect(host.textContent).toContain("test-session-two");
  expect(host.textContent).not.toContain("test-session-one");
  expect(host.querySelector("[data-seed]")?.textContent).toBe("");
});
