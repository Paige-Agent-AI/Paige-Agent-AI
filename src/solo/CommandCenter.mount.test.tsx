// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommandHub } from "./CommandCenter";
import { TenantCommandCenterShell } from "@/components/tenant-shell/TenantCommandCenterShell";

vi.mock("@/hooks/useTenantContext", () => ({ useTenantContext: () => ({ activeTenantId: "test-tenant-1", activeUserId: "test-owner" }) }));
vi.mock("@/hooks/useTierFeatures", () => ({ useTierFeatures: () => ({ has: () => true, loading: false }) }));
vi.mock("./ExecutiveOverview", () => ({ ExecutiveOverview: () => <div>Executive evidence<input aria-label="Recorded search" /></div> }));
vi.mock("@/components/admin/voice/DialPadTrigger", () => ({ DialPadTrigger: () => null }));
vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: "dark", setTheme: () => {} }) }));
vi.mock("@/components/ui/paige", () => ({ useAgentPresence: () => {
  const [railExpanded, set] = React.useState(false);
  return { railExpanded, expandRail: () => set(true), collapseRail: () => set(false) };
} }));
vi.mock("./SoloMindWorkspace", () => ({ SoloMindWorkspace: () => <div>Mind</div> }));
vi.mock("./SoloSystemsCheckWorkspace", () => ({ SoloSystemsCheckWorkspace: () => <div>Systems</div> }));
vi.mock("./SoloGamePlanWorkspace", () => ({ SoloGamePlanWorkspace: () => <div>Strategy</div> }));
vi.mock("./compass", () => ({ TrustCompass: () => <div>Trust</div> }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null; let host: HTMLDivElement | null = null;
afterEach(() => { act(() => root?.unmount()); host?.remove(); });
function Path() { const l = useLocation(); return <output>{l.pathname + l.search + l.hash}</output>; }
async function mount(path: string, shell = false) {
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  const hub = <CommandHub account="1234567" />;
  const page = shell ? <TenantCommandCenterShell accountName="Test services" accountType="standalone" userRole="admin" onSignOut={() => {}} soloPaigeWorkspace={<textarea aria-label="Test PAIGE composer" />}>{hub}</TenantCommandCenterShell> : hub;
  await act(async () => root!.render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/solo/:account/*" element={page} /></Routes><Path /></MemoryRouter>));
  return host;
}
async function settleFocus() { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 180)); }); }
async function foldPaige(node: HTMLDivElement) {
  await act(async () => (node.querySelector("[data-tenant-paige-command]") as HTMLButtonElement).click());
  const composer = node.querySelector('textarea[aria-label="Test PAIGE composer"]') as HTMLTextAreaElement;
  expect(composer).toBeTruthy(); composer.focus();
  await act(async () => composer.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  await settleFocus();
  expect(document.activeElement).toBe(node.querySelector("[data-tenant-paige-command]"));
}
describe("Command Center default — real route effects", () => {
  it.each(["", "/overview"])("redirects the bare/legacy entry %s to Executive and preserves search/hash", async (suffix) => {
    const node = await mount("/solo/1234567/command-center" + suffix + "?context=keep#source");
    expect(node!.querySelector("output")?.textContent).toBe("/solo/1234567/command-center/executive?context=keep#source");
    expect(node!.querySelector("[role='tab'][aria-selected='true']")?.textContent).toBe("Executive");
  });
  it("preserves the explicit Game Plan route", async () => {
    const node = await mount("/solo/1234567/command-center/business-game-plan");
    expect(node!.querySelector("output")?.textContent).toContain("business-game-plan");
    expect(node!.textContent).toContain("Strategy");
  });
  it("keeps all five tabs in an intentional horizontally scrollable tablist", async () => {
    const node = await mount("/solo/1234567/command-center/executive");
    expect(node!.querySelectorAll("[role='tab']")).toHaveLength(5);
    expect((node!.querySelector("[role='tablist']") as HTMLElement).style.overflowX).toBe("auto");
    expect((node!.querySelector("#command-tab-mind") as HTMLElement).style.flex).toBe("0 0 auto");
  });

  it("keeps actual Command Center keyboard focus after PAIGE folds and the route changes", async () => {
    const node = (await mount("/solo/1234567/command-center/executive", true))!;
    await foldPaige(node);
    (node.querySelector("#command-tab-exec") as HTMLButtonElement).focus();
    for (const [key, id] of [["End", "mind"], ["Home", "exec"], ["ArrowRight", "plan"], ["ArrowLeft", "exec"]]) {
      await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })));
      await settleFocus();
      const selected = node.querySelector("#command-tab-" + id);
      expect(selected?.getAttribute("aria-selected")).toBe("true");
      expect(document.activeElement).toBe(selected);
    }
  });

  it("preserves deliberate native-input focus across a shell breakpoint change after folding", async () => {
    const node = (await mount("/solo/1234567/command-center/executive", true))!;
    await foldPaige(node);
    const field = node.querySelector('input[aria-label="Recorded search"]') as HTMLInputElement;
    field.focus(); const originalWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { value: 1500, configurable: true });
    await act(async () => window.dispatchEvent(new Event("resize")));
    await settleFocus();
    expect(document.activeElement).toBe(field);
    Object.defineProperty(window, "innerWidth", { value: originalWidth, configurable: true });
  });
});
