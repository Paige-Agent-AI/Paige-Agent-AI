import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PaigeCrmResultCard } from "./PaigeCrmResultCard";

const mock = vi.hoisted(() => ({ invoke: vi.fn(), clock: vi.fn(), scope: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: mock.invoke } } }));
vi.mock("@/hooks/useTenantContext", () => ({ useTenantContext: () => mock.scope }));
vi.mock("@/solo/data/useBusinessTimeZone", () => ({ readBusinessTimeZone: mock.clock }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const TENANT = "e4000000-0000-4000-8000-0000000a0001", ACTOR = "e4000000-0000-4000-8000-0000000a0002";
const DEAL = "e4000000-0000-4000-8000-0000000a0003", RECEIPT = "e4000000-0000-4000-8000-0000000a0004";
const account = { account_type: "standalone", parent_tenant_id: null, account_number: 201 };
const result = { action: "deal.update", outcome: "succeeded", receipt_recorded: true, correlation_id: RECEIPT,
  record_reference: { destination: "pipeline" as const, record_id: DEAL } };
const response = () => ({ data: { ok: true, outcome: "recorded", receipt: { action: "deal.update", correlation_id: RECEIPT,
  record_id: DEAL, recorded_at: "2026-10-10T12:00:00Z", result_version: 3 }, current_version: 4 }, error: null });
let host: HTMLDivElement, root: Root;
const mount = async () => { await act(async () => root.render(<PaigeCrmResultCard result={result} account={account} />)); };
const button = (name: string) => Array.from(host.querySelectorAll("button")).find(b => b.textContent === name);
const click = async (name: string) => { const b = button(name); expect(b, name).toBeTruthy(); await act(async () => b!.click()); };
beforeEach(() => {
  window.sessionStorage.clear();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  mock.scope = { activeUserId: ACTOR, activeTenantId: TENANT, activeTenant: { id: TENANT, ...account },
    accountContextLoading: false, accountContextStatus: "ready" };
  mock.invoke.mockReset().mockResolvedValue(response());
  mock.clock.mockReset().mockResolvedValue({ status: "ready", value: { state: "configured", zone: "UTC" } });
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); });

describe("original Opportunity receipt in its existing result card", () => {
  it("keeps the verified original reference privately without copying the result or running an update", async () => {
    await mount(); expect(button("Keep in Team Hub")).toBeUndefined();
    await click("View saved receipt"); await click("Keep in Team Hub");
    expect(window.sessionStorage.length).toBe(1);
    expect(window.sessionStorage.getItem(window.sessionStorage.key(0)!)).toBe(JSON.stringify({ kind: "opportunity", dealId: DEAL, correlationId: RECEIPT }));
    expect(mock.invoke).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("Kept privately");
  });
  it("offers a read-only receipt view for the saved native reference", async () => {
    await mount(); expect(button("View saved receipt")?.getAttribute("aria-expanded")).toBe("false");
    expect(mock.invoke).not.toHaveBeenCalled();
  });
  it("reads the same original receipt and version without an execution or approval payload", async () => {
    await mount(); await click("View saved receipt");
    expect(host.textContent).toContain("Saved version 3 · current version 4");
    expect(mock.invoke).toHaveBeenCalledTimes(1);
    expect(mock.invoke.mock.calls[0][0]).toBe("crm-command");
    expect(mock.invoke.mock.calls[0][1].body).toEqual({ expected_tenant_id: TENANT,
      inspect_opportunity_result: { deal_id: DEAL, correlation_id: RECEIPT } });
    expect(host.textContent).toContain(RECEIPT);
    expect(Array.from(host.querySelectorAll("button")).some(b => /approve|send|run update/i.test(b.textContent || ""))).toBe(false);
    expect(host.querySelector("a")?.getAttribute("href")).toContain(DEAL);
  });
  it("collapses and reopens through a fresh read rather than persisting receipt contents", async () => {
    await mount(); await click("View saved receipt"); expect(host.textContent).toContain(RECEIPT);
    await click("Hide receipt"); expect(host.textContent).not.toContain(RECEIPT);
    await click("View saved receipt"); expect(host.textContent).toContain(RECEIPT); expect(mock.invoke).toHaveBeenCalledTimes(2);
  });
  it("aborts and discards an interrupted late read without rerunning anything", async () => {
    let finish!: (value: ReturnType<typeof response>) => void;
    mock.invoke.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await mount(); await click("View saved receipt"); expect(mock.invoke).toHaveBeenCalledTimes(1);
    const signal = mock.invoke.mock.calls[0][1].signal as AbortSignal;
    await click("Hide receipt"); expect(signal.aborted).toBe(true);
    await act(async () => { finish(response()); });
    expect(host.textContent).not.toContain(RECEIPT); expect(mock.invoke).toHaveBeenCalledTimes(1);
  });
  it.each(["workspace", "actor", "readiness"])("retires old reads on %s change", async change => {
    let finish!: (value: ReturnType<typeof response>) => void;
    mock.invoke.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await mount(); await click("View saved receipt"); expect(mock.invoke).toHaveBeenCalledTimes(1);
    if (change === "workspace") mock.scope.activeTenantId = null;
    else if (change === "actor") mock.scope.activeUserId = null;
    else mock.scope.accountContextLoading = true;
    await mount(); await act(async () => { finish(response()); });
    expect(host.textContent).not.toContain(RECEIPT); expect(button("View saved receipt")).toBeUndefined();
  });
  it.each(["not_found", "refused", "unavailable"])("shows %s honestly and permits only another read", async outcome => {
    mock.invoke.mockResolvedValueOnce({ data: { ok: false, outcome }, error: null });
    await mount(); await click("View saved receipt"); expect(host.querySelector('[role="alert"]')).toBeTruthy();
    expect(host.textContent).not.toContain(RECEIPT); await click("Check receipt again");
    expect(host.textContent).toContain(RECEIPT); expect(mock.invoke).toHaveBeenCalledTimes(2);
    for (const [, options] of mock.invoke.mock.calls) expect(options.body).not.toHaveProperty("command");
  });
  it("refuses a mismatched receipt instead of displaying success", async () => {
    const wrong = response(); wrong.data.receipt.record_id = ACTOR; mock.invoke.mockResolvedValueOnce(wrong);
    await mount(); await click("View saved receipt"); expect(host.querySelector('[role="alert"]')).toBeTruthy();
    expect(host.textContent).not.toContain(RECEIPT);
  });
  it("does not wait for optional business-clock formatting before showing the receipt", async () => {
    mock.clock.mockImplementationOnce(() => new Promise(() => {}));
    await mount(); await click("View saved receipt");
    expect(host.textContent).toContain(RECEIPT); expect(host.textContent).toContain("UTC");
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });
  it("bounds a stalled read and retires its late answer before a fresh read", async () => {
    vi.useFakeTimers();
    let finish!: (value: ReturnType<typeof response>) => void;
    mock.invoke.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await mount(); await click("View saved receipt");
    const signal = mock.invoke.mock.calls[0][1].signal as AbortSignal;
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(signal.aborted).toBe(true); expect(host.textContent).toContain("timed out");
    await click("Check receipt again"); expect(host.textContent).toContain(RECEIPT);
    const old = response(); old.data.receipt.result_version = 1;
    await act(async () => { finish(old); });
    expect(host.textContent).toContain("Saved version 3"); expect(host.textContent).not.toContain("Saved version 1");
    expect(mock.invoke).toHaveBeenCalledTimes(2);
  });
  it("does not hand an in-flight receipt to another signed-in actor in the same workspace", async () => {
    let finish!: (value: ReturnType<typeof response>) => void;
    mock.invoke.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await mount(); await click("View saved receipt"); mock.scope.activeUserId = DEAL;
    await mount(); await act(async () => { finish(response()); });
    expect(host.textContent).not.toContain(RECEIPT); expect(button("View saved receipt")).toBeTruthy();
  });
  it("uses another eligible SOLO workspace without a named-account branch", async () => {
    const nextTenant = "e4000000-0000-4000-8000-0000000b0001";
    const nextAccount = { ...account, account_number: 9876543 };
    mock.scope = { ...mock.scope, activeTenantId: nextTenant, activeTenant: { id: nextTenant, ...nextAccount } };
    await act(async () => root.render(<PaigeCrmResultCard result={result} account={nextAccount} />));
    await click("View saved receipt");
    expect(host.textContent).toContain(RECEIPT);
    expect(mock.invoke.mock.calls[0][1].body.expected_tenant_id).toBe(nextTenant);
    expect(host.querySelector("a")?.getAttribute("href")).toContain("9876543");
  });
  it("does not restore a collapsed receipt when its optional clock resolves late", async () => {
    let finish!: (value: unknown) => void;
    mock.clock.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await mount(); await click("View saved receipt"); await click("Hide receipt");
    await act(async () => { finish({ status: "ready", value: { state: "configured", zone: "America/New_York" } }); });
    expect(host.textContent).not.toContain(RECEIPT);
    expect(button("View saved receipt")?.getAttribute("aria-expanded")).toBe("false");
    expect(mock.invoke).toHaveBeenCalledTimes(1);
  });
});
