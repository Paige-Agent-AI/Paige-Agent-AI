import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import { ZapierApiPanel } from "./settings-integrations";
import { readZapierApi } from "./data/useZapierApi";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let host: HTMLDivElement;
function render(node: ReactNode) {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  act(() => root!.render(node));
  return { rerender: (next: ReactNode) => act(() => root!.render(next)) };
}
const findButton = (name: string) => [...host.querySelectorAll("button")].find(button => button.textContent?.trim() === name);
const click = (name: string) => { const button = findButton(name); expect(button).toBeTruthy(); act(() => button!.click()); };
const review = () => host.querySelector('section[aria-label="Workflow permission review"]');

type Api = ComponentProps<typeof ZapierApiPanel>["api"];
function api(overrides: Partial<Api> = {}): Api {
  return { tenantId: "neutral-solo-a", canManage: true, canAuthorizeWorkflowManagement: true,
    workflowManagementAuthorized: false, state: "not_connected", failureCode: null,
    accessibleZapCount: null, lastCheckedAt: null, lastSuccessAt: null,
    hasLocalConnection: false, hasPendingAuthorization: false, capabilities: [], limitations: [],
    loading: false, error: false, busy: false, message: null, reload: vi.fn(async () => {}),
    begin: vi.fn(async () => null), test: vi.fn(async () => true), cancel: vi.fn(async () => true),
    disconnect: vi.fn(async () => true), ...overrides };
}
afterEach(() => { if (root) act(() => root!.unmount()); root = undefined; host?.remove(); });
describe("original Zapier connection permission choice", () => {
  it("keeps the first connection read-only", async () => {
    const a = api(); render(<ZapierApiPanel api={a} onChanged={vi.fn()}/>);
    click("Connect API");
    expect(a.begin).toHaveBeenCalledExactlyOnceWith("read_only");
  });
  it("requires a separate consequence review before opening management consent", () => {
    const a = api(); render(<ZapierApiPanel api={a} onChanged={vi.fn()}/>);
    click("Authorize workflow management");
    expect(a.begin).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Creating a Zap or replacing its steps can enable it immediately");
    click("Continue to Zapier");
    expect(a.begin).toHaveBeenCalledExactlyOnceWith("workflow_management");
    expect(a.test).not.toHaveBeenCalled();
  });
  it("can decline broader permissions without provider or record effects", () => {
    const a = api(); render(<ZapierApiPanel api={a} onChanged={vi.fn()}/>);
    click("Authorize workflow management");
    findButton("Keep current permissions")!.focus();
    click("Keep current permissions");
    expect(review()).toBeNull();
    expect(document.activeElement).toBe(findButton("Authorize workflow management"));
    expect(a.begin).not.toHaveBeenCalled(); expect(a.disconnect).not.toHaveBeenCalled();
  });
  it("preserves a separately granted management profile on reconnect", () => {
    const a = api({ workflowManagementAuthorized: true, state: "authorization_expired", hasLocalConnection: true });
    render(<ZapierApiPanel api={a} onChanged={vi.fn()}/>);
    click("Reconnect API");
    expect(a.begin).toHaveBeenCalledExactlyOnceWith("workflow_management");
  });
  it("never offers management to a non-eligible actor and does not infer eligibility from Connected", () => {
    const a = api({ canAuthorizeWorkflowManagement: false, state: "connected" });
    render(<ZapierApiPanel api={a} onChanged={vi.fn()}/>);
    expect(findButton("Authorize workflow management")).toBeUndefined();
    expect(host.textContent).not.toContain("Workflow management authorized");
  });
  it("shows the actual platform authorization blocker instead of inviting a futile OAuth attempt", () => {
    const a = api({ state: "capability_unavailable" }); render(<ZapierApiPanel api={a} onChanged={vi.fn()}/>);
    expect(findButton("Provider authorization unavailable")?.disabled).toBe(true);
    expect(host.textContent).toContain("until PAIGE’s provider app is configured");
    click("Provider authorization unavailable"); expect(a.begin).not.toHaveBeenCalled();
  });
  it("drops the pending permission review on a workspace switch", () => {
    const a = api(); const view = render(<ZapierApiPanel api={a} onChanged={vi.fn()}/>);
    click("Authorize workflow management");
    view.rerender(<ZapierApiPanel api={api({ tenantId: "neutral-solo-b" })} onChanged={vi.fn()}/>);
    expect(review()).toBeNull();
    expect(a.begin).not.toHaveBeenCalled();
  });
  it("treats absent old-server scope flags as unverified permissions", () => {
    const original = { tenant_id: "neutral-solo-a", can_manage: true, state: "not_connected" };
    expect(readZapierApi(original, "neutral-solo-a")).toMatchObject({ workflowManagementAuthorized: false, canAuthorizeWorkflowManagement: false });
    expect(readZapierApi({ ...original, can_authorize_workflow_management: true }, "neutral-solo-a"))
      .toMatchObject({ canAuthorizeWorkflowManagement: false });
    expect(readZapierApi({ ...original, permission_profiles_supported: true, workflow_management_authorized: true, can_authorize_workflow_management: true }, "neutral-solo-a"))
      .toMatchObject({ workflowManagementAuthorized: true, canAuthorizeWorkflowManagement: true });
    expect(readZapierApi(original, "neutral-solo-b")).toBeNull();
  });
});
