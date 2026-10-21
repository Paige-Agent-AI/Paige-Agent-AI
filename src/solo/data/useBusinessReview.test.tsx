// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TEST_BUSINESS_REVIEW, TEST_REVIEW_TENANT } from "@/test/fixtures/business-review";
import { parseBusinessReview, useBusinessReview } from "./useBusinessReview";

const api = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: api.invoke } } }));
vi.mock("@/lib/userClock", () => ({ getUserClock: () => ({ userTimezone: "America/New_York" }) }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root; let host: HTMLDivElement;
beforeEach(() => { api.invoke.mockReset(); host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });
function Probe({ tenant }: { tenant: string | null }) { const r = useBusinessReview(tenant); return <div>{r.state === "ready" ? r.snapshot.tenant_id : r.state}</div>; }
async function render(tenant: string | null) { await act(async () => { root.render(<Probe tenant={tenant} />); }); }

describe("Business review transport — canonical shape and workspace fence", () => {
  it("accepts a real Fabric-shaped response and retains its actual full/partial coverage", () => {
    const result = parseBusinessReview({ ok: true, snapshot: TEST_BUSINESS_REVIEW }, TEST_REVIEW_TENANT, "America/New_York");
    expect(result?.domains.payments.data?.coverage).toBe("full");
    expect(result?.domains.operations.data?.coverage).toBe("partial");
  });
  it("rejects a foreign workspace or changed reporting zone", () => {
    expect(parseBusinessReview({ ok: true, snapshot: TEST_BUSINESS_REVIEW }, "foreign", "America/New_York")).toBeNull();
    expect(parseBusinessReview({ ok: true, snapshot: TEST_BUSINESS_REVIEW }, TEST_REVIEW_TENANT, "UTC")).toBeNull();
  });
  it("rejects a malformed domain instead of crashing or painting invented numbers", () => {
    const malformed = { ...TEST_BUSINESS_REVIEW, domains: { ...TEST_BUSINESS_REVIEW.domains,
      payments: { status: "available" as const, data: { ...TEST_BUSINESS_REVIEW.domains.payments.data!, coverage: "complete" as never } },
    } };
    expect(parseBusinessReview({ ok: true, snapshot: malformed }, TEST_REVIEW_TENANT, "America/New_York")).toBeNull();
  });
  it("runs no request before workspace resolution", async () => { await render(null); expect(api.invoke).not.toHaveBeenCalled(); });
  it("uses the same explicit reporting clock as Chat and the existing seam", async () => {
    api.invoke.mockResolvedValue({ data: { ok: true, snapshot: TEST_BUSINESS_REVIEW }, error: null }); await render(TEST_REVIEW_TENANT);
    expect(api.invoke).toHaveBeenCalledWith("paige-business-review?finance_sources=1", expect.objectContaining({ body: { period: "last_7_days", timezone: "America/New_York" } }));
    expect(host.textContent).toBe(TEST_REVIEW_TENANT);
  });
  it("drops an old request across a workspace switch, including its late completion", async () => {
    let answer: (value: unknown) => void = () => {};
    api.invoke.mockImplementationOnce(() => new Promise((resolve) => { answer = resolve; })).mockResolvedValueOnce({ data: null, error: new Error("unavailable") });
    await render(TEST_REVIEW_TENANT); await render("test-tenant-2");
    await act(async () => { answer({ data: { ok: true, snapshot: TEST_BUSINESS_REVIEW }, error: null }); });
    expect(host.textContent).toBe("failed"); expect(host.textContent).not.toContain(TEST_REVIEW_TENANT);
  });
});

const operationReview = () => ({ ...structuredClone(TEST_BUSINESS_REVIEW), requested: ['operations'],
  domains: { operations: structuredClone(TEST_BUSINESS_REVIEW.domains.operations) }, degradation: [] });
const focused = { focus: ['operations'] as const, actorId: 'test-owner' };
const expectation = { ...focused, period: 'last_7_days' as const };
const parseFocused = (snapshot: unknown, ok: unknown = true) =>
  parseBusinessReview({ ok, snapshot }, TEST_REVIEW_TENANT, 'America/New_York', expectation);
function FocusProbe({ tenant, actor = focused.actorId, focus = focused.focus }: {
  tenant: string | null; actor?: string; focus?: readonly ('operations' | 'clients')[];
}) {
  const review = useBusinessReview(tenant, 'last_7_days', { focus, actorId: actor });
  return <><div>{review.state === 'ready' ? `${review.snapshot.actor_id}:${review.snapshot.requested.join(',')}` : review.state}</div>
    <button onClick={review.refresh}>Refresh</button></>;
}
async function renderFocus(tenant: string | null = TEST_REVIEW_TENANT, actor = focused.actorId,
  focus: readonly ('operations' | 'clients')[] = focused.focus) {
  await act(async () => root.render(<FocusProbe tenant={tenant} actor={actor} focus={focus} />));
}

describe('Focused canonical review, without changing the Executive default', () => {
  it('preserves the source coverage, period, ordering and bounded evidence', () => {
    const original = operationReview();
    expect(parseFocused(original)).toEqual(original);
    expect(parseFocused(original)?.domains.operations.data?.coverage_note).toContain('Two figures');
  });
  it.each([
    ['empty requested domains', (s: ReturnType<typeof operationReview>) => ({ ...s, requested: [] })],
    ['wrong requested domain', (s: ReturnType<typeof operationReview>) => ({ ...s, requested: ['clients'] })],
    ['duplicate requested domains', (s: ReturnType<typeof operationReview>) => ({ ...s, requested: ['operations', 'operations'] })],
    ['missing Operations entry', (s: ReturnType<typeof operationReview>) => ({ ...s, domains: {} })],
    ['unrequested data', (s: ReturnType<typeof operationReview>) => ({ ...s, domains: { ...s.domains, clients: TEST_BUSINESS_REVIEW.domains.clients } })],
    ['foreign actor', (s: ReturnType<typeof operationReview>) => ({ ...s, actor_id: 'another-actor' })],
    ['different period', (s: ReturnType<typeof operationReview>) => ({ ...s, period: { ...s.period, key: 'last_30_days' } })],
    ['unavailable with embedded data', (s: ReturnType<typeof operationReview>) => ({ ...s, domains: { operations: { ...s.domains.operations, status: 'unavailable', reason: 'failed' } } })],
    ['array domain container', (s: ReturnType<typeof operationReview>) => ({ ...s, domains: [] })],
  ])('refuses %s before publishing focused business evidence', (_name, corrupt) => {
    expect(parseFocused(corrupt(operationReview()))).toBeNull();
  });
  it('rejects a coerced success and retains a real unavailable source as unavailable', () => {
    expect(parseFocused(operationReview(), 'true')).toBeNull();
    const review = { ...operationReview(), domains: { operations: { status: 'unavailable', reason: 'not_connected', data: null } } };
    expect(parseFocused(review)?.domains.operations).toEqual(review.domains.operations);
  });
  it('uses one incumbent endpoint with only the requested focus and verifies the returned actor', async () => {
    api.invoke.mockResolvedValue({ data: { ok: true, snapshot: operationReview() }, error: null });
    await renderFocus();
    expect(api.invoke).toHaveBeenCalledTimes(1);
    expect(api.invoke).toHaveBeenCalledWith('paige-business-review?finance_sources=1', expect.objectContaining({
      body: { period: 'last_7_days', timezone: 'America/New_York', focus: ['operations'] },
    }));
    expect(host.textContent).toContain('test-owner:operations');
  });
  it('does not issue an unresolved, empty or duplicate focus request', async () => {
    await renderFocus(null); await renderFocus(TEST_REVIEW_TENANT, '');
    await renderFocus(TEST_REVIEW_TENANT, focused.actorId, []);
    await renderFocus(TEST_REVIEW_TENANT, focused.actorId, ['operations', 'operations']);
    expect(api.invoke).not.toHaveBeenCalled();
  });
  it('retires the old actor result in the same business, even when transport ignores abort', async () => {
    let answer!: (value: unknown) => void;
    api.invoke.mockImplementationOnce(() => new Promise(resolve => { answer = resolve; }))
      .mockResolvedValueOnce({ data: null, error: new Error('unavailable') });
    await renderFocus(); await renderFocus(TEST_REVIEW_TENANT, 'new-owner');
    expect(api.invoke).toHaveBeenCalledTimes(2);
    expect(api.invoke.mock.calls[0][1].signal.aborted).toBe(true);
    await act(async () => answer({ data: { ok: true, snapshot: operationReview() }, error: null }));
    expect(host.textContent).toBe('failedRefresh');
  });
  it('re-reads on a focus change without painting the prior domain result', async () => {
    api.invoke.mockResolvedValueOnce({ data: { ok: true, snapshot: operationReview() }, error: null })
      .mockResolvedValueOnce({ data: null, error: new Error('unavailable') });
    await renderFocus(); await renderFocus(TEST_REVIEW_TENANT, focused.actorId, ['clients']);
    expect(api.invoke).toHaveBeenCalledTimes(2);
    expect(host.textContent).toBe('failedRefresh');
  });
  it.each(['actor', 'focus', 'default workspace'] as const)('does not resurrect settled evidence during a layout-phase %s A→B→A transition', async changing => {
    const afterReturn: string[] = [];
    api.invoke.mockResolvedValueOnce({ data: { ok: true, snapshot: operationReview() }, error: null })
      .mockImplementation(() => new Promise(() => {}));
    function CycleProbe() {
      const [phase, setPhase] = React.useState(0);
      const review = useBusinessReview(phase === 1 && changing === 'default workspace' ? 'test-tenant-2' : TEST_REVIEW_TENANT,
        'last_7_days', changing === 'default workspace' ? undefined : {
        actorId: phase === 1 && changing === 'actor' ? 'another-actor' : focused.actorId,
        focus: phase === 1 && changing === 'focus' ? ['clients'] : ['operations'],
        });
      React.useLayoutEffect(() => {
        if (phase === 2) afterReturn.push(review.state);
        if (phase === 1) setPhase(2);
      }, [phase, review.state]);
      return <><span>{review.state}</span><button onClick={() => setPhase(1)}>Cycle</button></>;
    }
    await act(async () => root.render(<CycleProbe />));
    expect(host.textContent).toBe('readyCycle');
    await act(async () => host.querySelector('button')!.click());
    expect(api.invoke).toHaveBeenCalledTimes(3);
    expect(afterReturn.length).toBeGreaterThan(0);
    expect(afterReturn).not.toContain('ready');
    expect(host.textContent).toBe('loadingCycle');
  });
  it('bounds a stalled read, ignores its late success and refreshes only on request', async () => {
    vi.useFakeTimers();
    try {
      let answer!: (value: unknown) => void;
      api.invoke.mockImplementationOnce(() => new Promise(resolve => { answer = resolve; }));
      await renderFocus();
      await act(async () => { vi.advanceTimersByTime(15_000); });
      expect(host.textContent).toBe('failedRefresh');
      expect(api.invoke.mock.calls[0][1].signal.aborted).toBe(true);
      await act(async () => answer({ data: { ok: true, snapshot: operationReview() }, error: null }));
      expect(host.textContent).toBe('failedRefresh');
      expect(api.invoke).toHaveBeenCalledTimes(1);
      api.invoke.mockResolvedValueOnce({ data: { ok: true, snapshot: operationReview() }, error: null });
      await act(async () => host.querySelector('button')!.click());
      expect(host.textContent).toContain('test-owner:operations');
      expect(api.invoke).toHaveBeenCalledTimes(2);
    } finally { vi.useRealTimers(); }
  });
});
