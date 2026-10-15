import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TeamSettings, ConnectionsSettings, BillingSettings, AnalyticsSettings } from "./SettingsDestinations";
import { useTeamPulse } from "@/operator/data/useTeamPulse";
vi.mock("@/operator/data/useTeamPulse", () => ({ useTeamPulse: vi.fn() }));
let node: HTMLDivElement;
let root: Root;
async function mount(child: React.ReactNode) {
  node = document.createElement("div"); document.body.append(node); root = createRoot(node);
  await act(async () => root.render(<MemoryRouter>{child}</MemoryRouter>));
}
afterEach(async () => { if (root) await act(async () => root.unmount()); node?.remove(); vi.resetAllMocks(); });
describe("Operator Settings source and permission boundaries", () => {
  it("refused staff reads hide even a previously returned roster", async () => {
    vi.mocked(useTeamPulse).mockReturnValue({ loading: false, error: "42501", seats: [{ userId: "test", email: "private@example.test", fullName: "Private staff", role: "super_admin" }] });
    await mount(<TeamSettings />);
    expect(node.textContent).not.toContain("private@example.test");
    expect(node.querySelector('[role="alert"]')?.textContent).toContain("access was refused");
  });
  it("distinguishes loading, no returned staff, and recorded seats without invitation controls", async () => {
    const mock = vi.mocked(useTeamPulse);
    mock.mockReturnValue({ loading: true, error: null, seats: [] }); await mount(<TeamSettings />);
    expect(node.textContent).toContain("Loading platform staff");
    mock.mockReturnValue({ loading: false, error: null, seats: [] }); await act(async () => root.render(<TeamSettings />));
    expect(node.textContent).toContain("No platform staff records returned");
    mock.mockReturnValue({ loading: false, error: null, seats: [{ userId: "test", email: "staff@example.test", fullName: "Test staff", role: "platform_admin" }] });
    await act(async () => root.render(<TeamSettings />));
    expect(node.textContent).toContain("Test staff"); expect(node.textContent).toContain("Platform administrator");
    expect(node.querySelector("form")).toBeNull(); expect(node.textContent).toContain("grants no new access");
  });
  it("connection and billing destinations expose truthful absence and existing canonical routes", async () => {
    await mount(<><ConnectionsSettings /><BillingSettings /></>);
    expect(node.textContent).toContain("verified platform connection inventory");
    expect(node.textContent).toContain("cannot create a charge");
    expect(Array.from(node.querySelectorAll("a")).map((a) => a.getAttribute("href"))).toContain("/operator/settings/connections/numbers");
    expect(node.querySelector("input")).toBeNull(); expect(node.querySelector("button")).toBeNull();
  });
  it("analytics uses all five existing destinations rather than a duplicate engine", async () => {
    await mount(<AnalyticsSettings />);
    const paths = Array.from(node.querySelectorAll("a")).map((a) => a.getAttribute("href"));
    expect(paths).toHaveLength(5); expect(paths.every((path) => path?.startsWith("/operator/analytics/"))).toBe(true);
    expect(new Set(paths).size).toBe(5);
  });
});
