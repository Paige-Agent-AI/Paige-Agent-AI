import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// E09 F2 — the bell's credit alerts and its way into /app/credit exist only for a finance-entitled business.
// Synthetic only; never a real account.
const f = vi.hoisted(() => ({ open: false, alertOptions: [] as Record<string, unknown>[], alerts: [] as unknown[] }));
vi.mock("@/hooks/useFinanceEntitlement", () => ({ useFinancePortal: () => ({ open: f.open, loading: false }) }));
vi.mock("@/hooks/useNotifications", () => ({ useNotifications: () => ({
  notifications: Array.from({ length: 6 }, (_, i) => ({ id: `n${i}`, type: "welcome", title: `Note ${i}`, message: "Hello", created_at: "2026-10-19T12:00:00Z", is_read: true })),
  unreadCount: 0, markAsRead: () => {}, markAllAsRead: () => {}, deleteNotification: () => {},
}) }));
vi.mock("@/hooks/useCreditAlerts", () => ({ useCreditAlerts: (o: Record<string, unknown>) => {
  f.alertOptions.push(o);
  return { alerts: o.enabled === false ? [] : f.alerts, unreadCount: o.enabled === false ? 0 : f.alerts.length, highestSeverity: "informational", markAsRead: () => {}, markAllAsRead: () => {} };
} }));
// The menu opens on pointer events jsdom does not model; render its content inline.
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onSelect }: { children: React.ReactNode; onSelect?: (e: { preventDefault(): void }) => void }) =>
    <button type="button" onClick={() => onSelect?.({ preventDefault() {} })}>{children}</button>,
  DropdownMenuSeparator: () => <hr />,
}));
const { NotificationBell } = await import("./NotificationBell");
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root, host: HTMLDivElement;
beforeEach(() => { f.open = false; f.alertOptions = []; f.alerts = []; host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });
const mount = async () => {
  await act(async () => root.render(
    <MemoryRouter initialEntries={["/app"]}><Routes>
      <Route path="/app" element={<NotificationBell />} />
      <Route path="/app/credit" element={<p>Credit page</p>} />
    </Routes></MemoryRouter>,
  ));
};

describe("NotificationBell and the finance entitlement", () => {
  it("not entitled: credit alerts are never read, and nothing leads to /app/credit", async () => {
    await mount();
    expect(f.alertOptions.every((o) => o.enabled === false)).toBe(true);
    expect(host.textContent).not.toContain("Credit Alerts");
    expect(host.textContent).not.toContain("View All Alerts");
  });

  it("CONTROL: entitled — alerts are read and View All Alerts still opens the credit page", async () => {
    f.open = true;
    f.alerts = [{ id: "a1", alert_title: "Score changed", alert_description: "Up 4", alert_severity: "informational", bureau: null, created_at: "2026-10-19T12:00:00Z", is_read: false }];
    await mount();
    expect(f.alertOptions.some((o) => o.enabled === true)).toBe(true);
    expect(host.textContent).toContain("Credit Alerts");
    const all = [...host.querySelectorAll("button")].find((b) => b.textContent === "View All Alerts")!;
    await act(async () => all.click());
    expect(host.textContent).toBe("Credit page");
  });
});
