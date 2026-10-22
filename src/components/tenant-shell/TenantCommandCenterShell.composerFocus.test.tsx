import { act, useCallback, useState } from "react";
import { createRoot } from "react-dom/client";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MemoryRouter } from "react-router-dom";
import { expect, it, vi } from "vitest";
import { TenantCommandCenterShell } from "./TenantCommandCenterShell";

vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: "light", setTheme: vi.fn() }) }));
vi.mock("framer-motion", () => ({ useReducedMotion: () => false }));
vi.mock("@/components/admin/voice/DialPadTrigger", () => ({ DialPadTrigger: () => null }));
vi.mock("@/components/ui/paige", () => ({ useAgentPresence: () => {
  const [railExpanded, setRailExpanded] = useState(false);
  // Match the original provider's stable actions; callback churn would rerun unrelated pop-out lifecycle effects.
  const expandRail = useCallback(() => setRailExpanded(true), []), collapseRail = useCallback(() => setRailExpanded(false), []);
  return { railExpanded, expandRail, collapseRail };
} }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const settleFocus = () => new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done())));

it.each(["editable", "disabled", "hidden", "closed", "navigated"])("focuses only the owned editable pop-out composer (%s)", async state => {
  const styles = document.createElement("style");
  styles.textContent = readFileSync(resolve(process.cwd(), "src/components/tenant-shell/tenant-command-center-shell.css"), "utf8"); document.head.append(styles);
  const popupDocument = document.implementation.createHTMLDocument("PAIGE owned focus check");
  const popup = { document: popupDocument, closed: false, focus: vi.fn(), addEventListener: vi.fn(), close: vi.fn() };
  const open = vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  let composerFocus: ReturnType<typeof vi.spyOn> | undefined;
  try {
    await act(async () => root.render(<MemoryRouter initialEntries={["/solo/42/operations/playbooks"]}>
      <TenantCommandCenterShell accountName="Test studio" accountType="standalone" userRole="owner" onSignOut={vi.fn()}
        soloPaigeWorkspace={<textarea aria-label="Message PAIGE" defaultValue="Original editable question" />}><p>Original Operations</p></TenantCommandCenterShell>
    </MemoryRouter>));
    await act(async () => host.querySelector<HTMLButtonElement>("[data-tenant-paige-command]")!.click());
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Open PAIGE in a new window"]')!.click());
    const composer = popupDocument.querySelector<HTMLTextAreaElement>('#tenant-paige-workspace textarea[aria-label="Message PAIGE"]')!;
    expect(composer).not.toBeNull();
    vi.spyOn(composer, "getClientRects").mockReturnValue([new DOMRect(0, 0, 300, 80)] as unknown as DOMRectList);
    composerFocus = vi.spyOn(composer, "focus");
    composer.disabled = state === "disabled"; composer.hidden = state === "hidden";
    if (state === "navigated") Object.defineProperty(popup, "document", { get: () => { throw new DOMException("Foreign origin", "SecurityError"); } });
    await act(async () => { host.querySelector<HTMLButtonElement>("[data-tenant-paige-command]")!.click(); if (state === "closed") popup.closed = true; await settleFocus(); });
    expect(popup.focus).toHaveBeenCalledOnce();
    expect(composerFocus).toHaveBeenCalledTimes(state === "editable" ? 1 : 0);
    expect(composer.value).toBe("Original editable question"); expect(host.textContent).toContain("Original Operations");
  } finally {
    await act(async () => root.unmount()); composerFocus?.mockRestore(); open.mockRestore(); styles.remove(); host.remove();
    window.localStorage.removeItem("paige.tenantShell.navExpanded");
  }
});
