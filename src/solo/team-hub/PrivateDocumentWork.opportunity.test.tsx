import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PrivateDocumentWork } from "./PrivateDocumentWork";
import { keepPrivateCrmUpdate } from "@/lib/privateDocumentWorkHandoff";
import { PaigeCrmResultCard } from "@/components/chat/PaigeCrmResultCard";

const mock = vi.hoisted(() => ({ invoke: vi.fn(), scope: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: mock.invoke } } }));
vi.mock("@/hooks/useTenantContext", () => ({ useTenantContext: () => mock.scope }));
vi.mock("@/solo/data/useBusinessTimeZone", () => ({ readBusinessTimeZone: async () => ({ status: "unavailable" }) }));
vi.mock("@/components/chat/OriginalDocumentWork", () => ({ OriginalDocumentWork: () => <p>Original Document control</p> }));
vi.mock("@/components/chat/OriginalResearchWork", () => ({ OriginalResearchWork: () => <p>Original Research control</p> }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const id = (n: number) => `e4000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const actor = id(1), tenant = id(2), deal = id(3), receipt = id(4);
const answer = () => ({ error: null, data: { ok: true, outcome: "recorded", receipt: {
  action: "deal.update", correlation_id: receipt, record_id: deal, result_version: 3, recorded_at: "2026-11-11T12:00:00Z",
}, current_version: 4 } });
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  window.sessionStorage.clear();
  mock.scope = { activeUserId: actor, activeTenantId: tenant, activeTenant: { id: tenant, account_number: 98765 },
    accountContextStatus: "ready", accountContextLoading: false };
  mock.invoke.mockReset().mockResolvedValue(answer());
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
const button = (name: string) => [...host.querySelectorAll("button")].find(b => b.textContent?.trim() === name);
async function open(user = actor, workspace = tenant) {
  await act(async () => root.render(<PrivateDocumentWork key={`${user}:${workspace}`} actorId={user} tenantId={workspace} />));
  await act(async () => { const details = host.querySelector("details")!; details.open = true; details.dispatchEvent(new Event("toggle")); });
}
async function check() { await act(async () => button("View saved receipt")!.click()); }
describe("private Team Hub original Opportunity receipt", () => {
  it("reopens the same original receipt after remount without another mutation or copied private result", async () => {
    keepPrivateCrmUpdate(actor, tenant, { kind: "opportunity", dealId: deal, correlationId: receipt });
    for (let visit = 0; visit < 2; visit++) {
      await open(); expect(host.textContent).not.toContain(receipt); await check();
      expect(host.textContent).toContain(receipt); expect(host.textContent).toContain("Saved version 3");
      expect(host.querySelector("a")?.getAttribute("href")).toContain(deal);
      expect(button("Keep in Team Hub")).toBeUndefined();
      await act(async () => root.render(null));
    }
    expect(mock.invoke).toHaveBeenCalledTimes(2);
    for (const [name, options] of mock.invoke.mock.calls) {
      expect(name).toBe("crm-command");
      expect(options.body).toEqual({ expected_tenant_id: tenant, inspect_opportunity_result: { deal_id: deal, correlation_id: receipt } });
    }
  });
  it("does not expose the reference in a different actor or workspace slot", async () => {
    keepPrivateCrmUpdate(actor, tenant, { kind: "opportunity", dealId: deal, correlationId: receipt });
    await open(id(8)); expect(button("View saved receipt")).toBeUndefined();
    await open(actor, id(8)); expect(button("View saved receipt")).toBeUndefined();
    expect(mock.invoke).not.toHaveBeenCalled();
  });
  it("retires an interrupted read on collapse before the answer arrives", async () => {
    let finish!: (value: ReturnType<typeof answer>) => void;
    mock.invoke.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    keepPrivateCrmUpdate(actor, tenant, { kind: "opportunity", dealId: deal, correlationId: receipt }); await open(); await check();
    const signal = mock.invoke.mock.calls[0][1].signal as AbortSignal;
    await act(async () => { const details = host.querySelector("details")!; details.open = false; details.dispatchEvent(new Event("toggle")); });
    expect(signal.aborted).toBe(true);
    await act(async () => { finish(answer()); }); expect(host.textContent).not.toContain(receipt);
    await open(); await check(); expect(host.textContent).toContain(receipt);
    expect(mock.invoke).toHaveBeenCalledTimes(2);
  });
});

it("reopens the same original Task and Rail receipt through Chat and private Team Hub after a remount", async () => {
  const task = id(6), rail = id(7);
  const original = { error: null, data: { ok: true, outcome: "recorded", receipt: {
    id: rail, action: "task.update", correlation_id: receipt, record_id: task, recorded_at: "2026-11-21T12:00:00Z",
  } } };
  mock.invoke.mockResolvedValue(original);
  const account = { account_type: "standalone", parent_tenant_id: null, account_number: 98765 };
  const result = { action: "task.update", outcome: "succeeded", receipt_recorded: true, correlation_id: receipt,
    record_reference: { destination: "operations_work" as const, record_id: task } };
  await act(async () => root.render(<PaigeCrmResultCard result={result} account={account} />));
  await check();
  expect(host.textContent).toContain(rail);
  await act(async () => button("Keep in Team Hub")!.click());
  expect(window.sessionStorage.getItem(window.sessionStorage.key(0)!)).toEqual(JSON.stringify({
    kind: "task_update", taskId: task, correlationId: receipt,
  }));
  await act(async () => root.render(null));
  await open();
  expect(host.textContent).not.toContain(rail);
  await check();
  expect(host.textContent).toContain(rail);
  expect(host.querySelector("a")?.getAttribute("href")).toContain(`operations/work?task=${task}`);
  expect(mock.invoke).toHaveBeenCalledTimes(2);
  for (const [name, options] of mock.invoke.mock.calls) {
    expect(name).toBe("crm-command");
    expect(options.body).toEqual({ expected_tenant_id: tenant, inspect_task_update_result: {
      task_id: task, correlation_id: receipt,
    } });
  }
});
