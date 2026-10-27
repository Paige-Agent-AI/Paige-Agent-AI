// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TEST_BUSINESS_REVIEW as SNAPSHOT } from "@/test/fixtures/business-review";
import { ExecutiveOverview } from "./ExecutiveOverview";
import { withTargetAndFinanceFixtures } from '../../scripts/live-drive/harness/executive-mount/slice-fixtures';

const mocks = vi.hoisted(() => ({ review: vi.fn(), pending: vi.fn(), activity: vi.fn(), missions: vi.fn(), calendar: vi.fn(), prefill: vi.fn() }));
vi.mock("./data/useBusinessReview", () => ({ useBusinessReview: mocks.review }));
vi.mock("./data/useSoloPendingActions", () => ({ useSoloPendingActions: mocks.pending }));
vi.mock("./data/useSoloActivityFeed", () => ({ useSoloActivityFeed: mocks.activity, elapsedLabel: () => "just now" }));
vi.mock("./data/useBusinessGamePlanMissions", () => ({ useBusinessGamePlanMissions: mocks.missions }));
vi.mock("./data/useBusinessTimeZone", async (original) => ({ ...await original<typeof import("./data/useBusinessTimeZone")>(), useBusinessCalendarDay: mocks.calendar }));
vi.mock("@/lib/paigePromptHandoff", () => ({ handOffPaigePrompt: mocks.prefill }));
vi.mock("@/components/paige/live/PaigePresence", () => ({ PaigePresence: ({ state }: { state: string }) => <div data-presence-state={state} /> }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
let host: HTMLDivElement;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.review.mockReturnValue({ state: "ready", snapshot: structuredClone(SNAPSHOT), refresh: vi.fn() });
  mocks.pending.mockReturnValue({ items: [], total: 0, loading: false, error: null, refresh: vi.fn() });
  mocks.activity.mockReturnValue({ items: [], status: "ready", refresh: vi.fn() });
  mocks.missions.mockReturnValue({ items: [], status: "ready", refresh: vi.fn() });
  mocks.calendar.mockReturnValue({ day: { kind: "withheld", reason: "missing", canSet: true }, refresh: vi.fn() });
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
});

afterEach(() => { act(() => root?.unmount()); host.remove(); root = null; });
async function mount(openPaige?: () => void, accountEpoch: string | null = "test-tenant-1") {
  await act(async () => root!.render(<MemoryRouter><ExecutiveOverview account="1234567" accountEpoch={accountEpoch} openPaige={openPaige} /></MemoryRouter>));
  return host;
}
const text = () => host.textContent ?? "";
const button = (name: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.includes(name))!;
const link = (path: string) => host.querySelector("a[href='" + path + "']");

function PeriodRouteProbe() {
  const location = useLocation(), navigate = useNavigate();
  return <><output data-testid="route-address">{location.pathname + location.search + location.hash}</output>
    <output data-testid="route-state">{JSON.stringify(location.state)}</output>
    <button onClick={() => navigate(-1)}>Test browser Back</button></>;
}
const EXECUTIVE = '/solo/1234567/command-center/executive';
const selectedPeriod = () => (host.querySelector('.exec-period select') as HTMLSelectElement).value;
const routeAddress = () => host.querySelector('[data-testid="route-address"]')!.textContent!;
async function mountPeriodRoute(entry: string, key = 'first-page', epoch = 'test-tenant-1') {
  await act(async () => root!.render(<MemoryRouter key={key} initialEntries={[entry]}><Routes>
    <Route path="/solo/:account/command-center/executive" element={<ExecutiveOverview account="1234567" accountEpoch={epoch} />} />
    <Route path="/solo/:account/finance" element={<h1>Original Finance destination</h1>} />
  </Routes><PeriodRouteProbe /></MemoryRouter>));
}
function choosePeriod(value: string) {
  act(() => { const select = host.querySelector('.exec-period select') as HTMLSelectElement;
    select.value = value; select.dispatchEvent(new Event('change', { bubbles: true })); });
}

describe('Executive period continuity through the existing route', () => {
  it('restores the original department opener and reading position on browser Back', async () => {
    await act(async () => root!.render(<MemoryRouter initialEntries={[EXECUTIVE + '?review_period=last_30_days']}><Routes>
      <Route path="/solo/:account/command-center/executive" element={<ExecutiveOverview account="1234567" accountEpoch="test-tenant-1" actorId="test-owner" />} />
      <Route path="/solo/:account/finance" element={<h1>Original Finance destination</h1>} />
    </Routes><PeriodRouteProbe /></MemoryRouter>));
    const originalRoot = host.querySelector('.executive-root') as HTMLElement;
    originalRoot.scrollTop = 420;
    const opener = link('/solo/1234567/finance') as HTMLAnchorElement;
    opener.focus(); act(() => opener.click());
    expect(text()).toContain('Original Finance destination');
    act(() => button('Test browser Back').click());
    expect((host.querySelector('.executive-root') as HTMLElement).scrollTop).toBe(420);
    expect(document.activeElement).toBe(link('/solo/1234567/finance'));
    expect(selectedPeriod()).toBe('last_30_days');
    expect(mocks.prefill).not.toHaveBeenCalled();
  });
  it('opens and reloads the selected period from the exact address', async () => {
    const entry = EXECUTIVE + '?review_period=last_30_days';
    await mountPeriodRoute(entry);
    expect(selectedPeriod()).toBe('last_30_days');
    expect(mocks.review).toHaveBeenLastCalledWith('test-tenant-1', 'last_30_days');
    await mountPeriodRoute(entry, 'fresh-page');
    expect(selectedPeriod()).toBe('last_30_days');
    expect(mocks.review).toHaveBeenLastCalledWith('test-tenant-1', 'last_30_days');
  });
  it('keeps a changed period on browser Back from an original departmental link', async () => {
    await mountPeriodRoute(EXECUTIVE);
    choosePeriod('current_quarter');
    act(() => (link('/solo/1234567/finance') as HTMLAnchorElement).click());
    expect(text()).toContain('Original Finance destination');
    act(() => button('Test browser Back').click());
    expect(selectedPeriod()).toBe('current_quarter');
    expect(mocks.review).toHaveBeenLastCalledWith('test-tenant-1', 'current_quarter');
  });
  it('preserves unrelated route context and removes only its own default query', async () => {
    await mountPeriodRoute(EXECUTIVE + '?source=review&review_period=current_quarter#evidence');
    choosePeriod('last_30_days');
    expect(routeAddress()).toBe(EXECUTIVE + '?source=review&review_period=last_30_days#evidence');
    choosePeriod('last_7_days');
    expect(routeAddress()).toBe(EXECUTIVE + '?source=review#evidence');
  });
  it.each(['', 'all_time', 'foreign-account', '2026-10-01'])('defaults unsupported period %j without widening the read', async value => {
    await mountPeriodRoute(EXECUTIVE + '?review_period=' + value);
    expect(selectedPeriod()).toBe('last_7_days');
    expect(mocks.review).toHaveBeenLastCalledWith('test-tenant-1', 'last_7_days');
  });
  it('carries only display choice while re-binding the existing read to a new workspace epoch', async () => {
    const entry = EXECUTIVE + '?review_period=last_30_days';
    await mountPeriodRoute(entry);
    await mountPeriodRoute(entry, 'first-page', 'test-tenant-2');
    expect(mocks.review).toHaveBeenLastCalledWith('test-tenant-2', 'last_30_days');
    expect(mocks.prefill).not.toHaveBeenCalled();
  });
});

function returnTree(actorId: string | null = 'test-owner', epoch = 'test-tenant-1') {
  return <MemoryRouter initialEntries={[{ pathname: EXECUTIVE, search: '?source=review&review_period=last_30_days', state: { existingContext: 'retained' } }]}><Routes>
    <Route path="/solo/:account/command-center/executive" element={<ExecutiveOverview account="1234567" accountEpoch={epoch} actorId={actorId} />} />
    <Route path="/solo/:account/finance" element={<h1>Original Finance destination</h1>} />
  </Routes><PeriodRouteProbe /></MemoryRouter>;
}
function leaveReview() {
  const node = host.querySelector('.executive-root') as HTMLElement;
  node.scrollTop = 420;
  const opener = link('/solo/1234567/finance') as HTMLAnchorElement;
  const disclosure = opener.closest('section.exec-domain')?.querySelector('details');
  if (disclosure) disclosure.open = true;
  opener.focus(); act(() => opener.click());
}
describe('Executive display-only history return', () => {
  it('restores source freshness without opening a nested financial account disclosure', async () => {
    mocks.review.mockReturnValue({ state: 'ready', snapshot: withTargetAndFinanceFixtures(structuredClone(SNAPSHOT), 'ready', true), refresh: vi.fn() });
    await act(async () => root!.render(returnTree()));
    const section = host.querySelector("[aria-labelledby='exec-domain-finance']")!;
    const source = section.querySelector(':scope > details.exec-provenance') as HTMLDetailsElement;
    source.open = true;
    const node = host.querySelector('.executive-root') as HTMLElement; node.scrollTop = 420;
    act(() => (section.querySelector('a.exec-link') as HTMLAnchorElement).click());
    act(() => button('Test browser Back').click());
    const returned = host.querySelector("[aria-labelledby='exec-domain-finance']")!;
    expect((returned.querySelector(':scope > details.exec-provenance') as HTMLDetailsElement).open).toBe(true);
    expect((returned.querySelector('.exec-finance-source') as HTMLDetailsElement).open).toBe(false);
    expect((host.querySelector('.executive-root') as HTMLElement).scrollTop).toBe(420);
  });
  it('retains original route state and source disclosure without retaining a business snapshot', async () => {
    await act(async () => root!.render(returnTree())); leaveReview();
    act(() => button('Test browser Back').click());
    const state = host.querySelector('[data-testid="route-state"]')!.textContent!;
    expect(JSON.parse(state).existingContext).toBe('retained');
    expect(state).not.toMatch(/headline|as_of|evidence_ref|PRIVATE|pending/);
    expect(link('/solo/1234567/finance')?.closest('section.exec-domain')?.querySelector('details')?.open).toBe(true);
    expect(routeAddress()).toBe(EXECUTIVE + '?source=review&review_period=last_30_days');
  });
  it.each(['actor', 'workspace', 'unresolved actor'])('does not restore a preceding %s context', async change => {
    await act(async () => root!.render(returnTree())); leaveReview();
    await act(async () => root!.render(returnTree(change === 'actor' ? 'other-owner' : change === 'unresolved actor' ? null : 'test-owner', change === 'workspace' ? 'test-tenant-2' : 'test-tenant-1')));
    act(() => button('Test browser Back').click());
    expect((host.querySelector('.executive-root') as HTMLElement).scrollTop).toBe(0);
    expect(document.activeElement).not.toBe(link('/solo/1234567/finance'));
    expect(mocks.review).toHaveBeenLastCalledWith(change === 'workspace' ? 'test-tenant-2' : 'test-tenant-1', 'last_30_days');
  });
  it('waits for the original fresh read before restoring context', async () => {
    await act(async () => root!.render(returnTree())); leaveReview();
    mocks.review.mockReturnValue({ state: 'loading', refresh: vi.fn() });
    act(() => button('Test browser Back').click());
    expect((host.querySelector('.executive-root') as HTMLElement).scrollTop).toBe(0);
    mocks.review.mockReturnValue({ state: 'ready', snapshot: structuredClone(SNAPSHOT), refresh: vi.fn() });
    await act(async () => root!.render(returnTree()));
    expect((host.querySelector('.executive-root') as HTMLElement).scrollTop).toBe(420);
    expect(document.activeElement).toBe(link('/solo/1234567/finance'));
  });
  it('preserves a person’s newer focus while the fresh read is pending', async () => {
    await act(async () => root!.render(returnTree())); leaveReview();
    mocks.review.mockReturnValue({ state: 'loading', refresh: vi.fn() }); act(() => button('Test browser Back').click());
    const select = host.querySelector('select')!; select.focus();
    mocks.review.mockReturnValue({ state: 'ready', snapshot: structuredClone(SNAPSHOT), refresh: vi.fn() });
    await act(async () => root!.render(returnTree()));
    expect(document.activeElement).toBe(select);
    expect((host.querySelector('.executive-root') as HTMLElement).scrollTop).toBe(0);
  });
  it.each([false, true])('distinguishes automatic folded-shell focus from newer user input (%s)', async userInput => {
    const command = document.createElement('button'); command.dataset.tenantPaigeCommand = ''; command.textContent = 'Existing PAIGE command'; document.body.appendChild(command);
    try {
      await act(async () => root!.render(returnTree())); leaveReview(); command.focus();
      mocks.review.mockReturnValue({ state: 'loading', refresh: vi.fn() }); act(() => button('Test browser Back').click());
      if (userInput) command.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      mocks.review.mockReturnValue({ state: 'ready', snapshot: structuredClone(SNAPSHOT), refresh: vi.fn() });
      await act(async () => root!.render(returnTree()));
      expect(document.activeElement).toBe(userInput ? command : link('/solo/1234567/finance'));
      expect((host.querySelector('.executive-root') as HTMLElement).scrollTop).toBe(userInput ? 0 : 420);
    } finally { command.remove(); }
  });
  it('returns to the review heading if fresh evidence no longer offers the original link', async () => {
    await act(async () => root!.render(returnTree())); leaveReview();
    mocks.review.mockReturnValue({ state: 'failed', message: 'Fresh evidence unavailable', refresh: vi.fn() });
    act(() => button('Test browser Back').click());
    expect(document.activeElement).toBe(host.querySelector('h1'));
    expect((host.querySelector('.executive-root') as HTMLElement).scrollTop).toBe(0);
    expect(text()).toContain('Fresh evidence unavailable');
    expect(mocks.prefill).not.toHaveBeenCalled();
  });
  it.each(['modified', 'new-window'])('leaves %s navigation and original history untouched', async mode => {
    await act(async () => root!.render(returnTree()));
    const opener = link('/solo/1234567/finance') as HTMLAnchorElement;
    if (mode === 'new-window') opener.target = '_blank';
    opener.addEventListener('click', event => event.preventDefault());
    act(() => opener.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: mode === 'modified', button: 0 })));
    expect(JSON.parse(host.querySelector('[data-testid="route-state"]')!.textContent!)).toEqual({ existingContext: 'retained' });
    expect(routeAddress()).toContain('/command-center/executive');
  });
});

describe("Executive — integrated customer flow", () => {
  it('presents recorded Marketing intake, its limits and the current-account originating destination', async () => {
    const snapshot = structuredClone(SNAPSHOT);
    snapshot.domains.campaigns = { status: 'available', data: { ...snapshot.domains.clients!.data!, domain: 'campaigns', owner: 'marketing',
      coverage_note: 'Recorded intake only: no visits, ad spend, revenue, full funnel or causal attribution',
      headline: [{ key: 'campaigns.received', label: 'Leads received (form submissions)', value: 0, unit: 'count', basis: 'in_period' }] } };
    mocks.review.mockReturnValue({ state: 'ready', snapshot, refresh: vi.fn() });
    await mount();
    const section = host.querySelector("[aria-labelledby='exec-domain-campaigns']")!;
    expect(section.textContent).toContain('Marketing intake');
    expect(section.textContent).toContain('no visits, ad spend, revenue, full funnel or causal attribution');
    expect(section.querySelector('.exec-figures dd')?.textContent).toBe('0');
    expect(section.querySelector('a')?.getAttribute('href')).toBe('/solo/1234567/growth/overview');
    expect(section.querySelector('summary')?.textContent).toBe('Source & freshness');
    expect(mocks.prefill).not.toHaveBeenCalled();
  });
  it("shows the canonical review-integration gap beside real zero and unchanged owning links", async () => {
    const snapshot = structuredClone(SNAPSHOT);
    snapshot.domains.campaigns = { status: "unavailable", data: null, reason: "no_adapter: campaigns" };
    mocks.review.mockReturnValue({ state: "ready", snapshot, refresh: vi.fn() });
    await mount();
    expect(text()).toContain("This area is not included in this business review yet.");
    expect(text()).not.toContain("no adapter");
    expect(host.querySelector("[aria-labelledby='exec-domain-clients'] dd")?.textContent).toBe("0");
    expect(link("/solo/1234567/sales/opportunities?view=board")).not.toBeNull();
    expect(mocks.prefill).not.toHaveBeenCalled();
  });
  it("offers VERA's analysis through the existing unsent Chat draft and preserves PAIGE's primary briefing", async () => {
    const open = vi.fn(); await mount(open);
    expect(button("How's my business doing?")).toBeDefined();
    act(() => button("Ask VERA to review the evidence").click());
    expect(open).toHaveBeenCalledOnce();
    expect(mocks.prefill).toHaveBeenCalledWith(expect.stringMatching(/^VERA, /));
    expect(mocks.prefill).toHaveBeenCalledWith(expect.stringContaining("Last 7 days"));
    expect(mocks.prefill).toHaveBeenCalledWith(expect.stringContaining("Do not take an action"));
    mocks.prefill.mockClear();
    await mount();
    expect(button("Ask VERA to review the evidence").disabled).toBe(true);
    expect(mocks.prefill).not.toHaveBeenCalled();
  });
  it("prefills the one existing Chat and opens it without sending a model request", async () => {
    const open = vi.fn(); await mount(open);
    act(() => button("How's my business doing?").click());
    expect(open).toHaveBeenCalledOnce();
    expect(mocks.prefill).toHaveBeenCalledWith(expect.stringContaining("Last 7 days"));
    expect(text()).toContain("Choose Talk live there");
  });
  it("makes the invitation disabled when the existing conversation cannot be opened", async () => {
    await mount(); expect(button("How's my business doing?").disabled).toBe(true);
  });
  it("runs no company hooks until the workspace is resolved", async () => {
    await mount(undefined, null);
    expect(text()).toContain("Resolving this workspace");
    expect(mocks.review).not.toHaveBeenCalled();
    expect(mocks.activity).not.toHaveBeenCalled();
  });
  it("announces loading without painting old figures or risk claims", async () => {
    mocks.review.mockReturnValue({ state: "loading", refresh: vi.fn() }); await mount();
    expect(text()).toContain("Reading your business review");
    expect(text()).not.toContain("USD 1,250");
    expect(host.querySelector("[data-presence-state='working']")).not.toBeNull();
  });
  it("offers retry after a failed read and never shows stale business figures", async () => {
    const refresh = vi.fn(); mocks.review.mockReturnValue({ state: "failed", message: "The review could not be verified.", refresh }); await mount();
    expect(host.querySelector("[role='alert']")).not.toBeNull();
    expect(text()).not.toContain("USD 1,250");
    act(() => button("Try again").click()); expect(refresh).toHaveBeenCalledOnce();
  });
  it("renders canonical figures, exact Sales window notes, real zero and unavailable separately", async () => {
    await mount();
    expect(text()).toContain("USD 1,250.00");
    expect(text()).toContain("Last completed UTC day: October 12");
    const clients = host.querySelector("[aria-labelledby='exec-domain-clients']")!;
    expect(clients.textContent).toContain("Active clients"); expect(clients.textContent).toContain("0");
    const gaps = host.querySelector(".exec-gaps")!;
    expect(gaps.textContent).toContain("Marketing intake"); expect(gaps.textContent).toContain("Not connected");
    expect(gaps.textContent).not.toMatch(/\b0\b/);
  });
  it.each([
    ["JPY", "JPY 125,000"], ["KWD", "KWD 125.000"],
    ["CLF", "CLF 12.5000"], ["XYZ", "XYZ 125,000 minor units"],
  ])("keeps the %s headline consistent with its canonical risk evidence", async (currency, amount) => {
    const original = SNAPSHOT.domains.payments.data!;
    const snapshot = { ...SNAPSHOT, domains: { ...SNAPSHOT.domains, payments: {
      status: "available" as const, data: { ...original,
        headline: [{ ...original.headline[0], value: 125000, currency }],
        risks: [{ kind: "receivables", severity: "act" as const, summary: amount + " recorded as overdue" }],
      },
    } } };
    mocks.review.mockReturnValue({ state: "ready", snapshot, refresh: vi.fn() });
    await mount();
    expect(host.querySelector("[aria-labelledby='exec-domain-payments'] dd")?.textContent).toContain(amount);
    expect(host.querySelector(".exec-priority-list")?.textContent).toContain(amount + " recorded as overdue");
  });
  it("names returned unavailable and missing requested domain results", async () => {
    const snapshot = structuredClone(SNAPSHOT); snapshot.requested.push("game_plan");
    mocks.review.mockReturnValue({ state: "ready", snapshot, refresh: vi.fn() }); await mount();
    expect(text()).toContain("Marketing intake"); expect(text()).toContain("Game Plan performance");
    expect(text()).toContain("missing result");
  });
  it("ranks act risks before watch across the company and labels the recommendation", async () => {
    await mount();
    const list = host.querySelector(".exec-priority-list")!;
    expect(list.textContent!.indexOf("2 blocking operating findings")).toBeLessThan(list.textContent!.indexOf("USD 300.00"));
    expect(list.textContent).toContain("Recommended");
  });
  it("links to the actual canonical sources and preserves the four command surfaces", async () => {
    await mount();
    for (const path of ["/finance", "/sales/opportunities?view=board", "/sales/payments?view=collections", "/clients/people", "/operations/work",
      "/command-center/systems-check", "/command-center/business-game-plan", "/command-center/trust-compass", "/command-center/mind"]) {
      expect(link("/solo/1234567" + path), path).not.toBeNull();
    }
  });
  it("does not mint an account path while account resolution is unavailable", async () => {
    await act(async () => root!.render(<MemoryRouter><ExecutiveOverview account={null} accountEpoch="test-tenant-1" /></MemoryRouter>));
    expect(host.querySelectorAll("a")).toHaveLength(0);
  });
  it("shows exact pending count beyond a ten-row preview without claiming execution", async () => {
    mocks.pending.mockReturnValue({ items: Array.from({ length: 10 }, (_, i) => ({ id: "a" + i, title: "Prepared work " + i, department: "Sales" })), total: 37, loading: false, error: null, refresh: vi.fn() });
    const open = vi.fn(); await mount(open);
    expect(text()).toContain("37 prepared items"); expect(text()).toContain("Previewing 3 of 37");
    expect(text()).toContain("Prepared is not completed");
    act(() => button("Review with PAIGE").click()); expect(open).toHaveBeenCalledOnce();
  });
  it("labels the preview as bounded if an exact pending count was not supplied", async () => {
    mocks.pending.mockReturnValue({ items: [{ id: "a", title: "Prepared work", department: "Sales" }], total: null, loading: false, error: null, refresh: vi.fn() }); await mount();
    expect(text()).toContain("Showing up to 1 prepared items");
  });
  it("distinguishes pending-read failure from an empty queue", async () => {
    mocks.pending.mockReturnValue({ items: [], total: null, loading: false, error: "denied", refresh: vi.fn() }); await mount();
    expect(text()).toContain("This is not an empty queue"); expect(text()).not.toContain("No filed confirm-lane");
  });
  it("attributes a recorded human act to Person and unknown actors to neither person nor PAIGE", async () => {
    mocks.activity.mockReturnValue({ status: "ready", items: [{ id: "1", title: "Business zone saved", byPaige: false, byPerson: true, actorAgent: null, occurredAt: "2026-10-13T14:00:00Z" }, { id: "2", title: "Legacy event", byPaige: false, byPerson: false, actorAgent: null, occurredAt: "2026-10-13T14:00:00Z" }], refresh: vi.fn() }); await mount();
    expect(text()).toContain("Person · Recorded"); expect(text()).toContain("Unattributed · Recorded");
  });
  it("keeps unavailable activity distinct from no recorded events", async () => {
    mocks.activity.mockReturnValue({ status: "forbidden", items: [], refresh: vi.fn() }); await mount();
    expect(text()).toContain("Activity is not authorized"); expect(text()).not.toContain("No recent activity returned");
  });
  it("renders canonical mission state and holds due judgement with no saved business zone", async () => {
    mocks.missions.mockReturnValue({ status: "ready", items: [{ id: "m1", state: "active", stageLabel: "Active", title: "A strategic play", desired_outcome: "A recorded outcome", deadline_on: "2026-10-12", next_action: "Review scope" }], refresh: vi.fn() }); await mount();
    expect(text()).toContain("A recorded outcome"); expect(text()).toContain("On hold until the business time zone is set");
    expect(text()).not.toContain("Past due date");
  });
  it("shows a passed due date only against the configured business calendar day", async () => {
    mocks.calendar.mockReturnValue({ day: { kind: "configured", date: "2026-10-13", zone: "America/New_York" }, refresh: vi.fn() });
    mocks.missions.mockReturnValue({ status: "ready", items: [{ id: "m1", state: "active", stageLabel: "Active", title: "A strategic play", desired_outcome: "Recorded outcome", deadline_on: "2026-10-12" }], refresh: vi.fn() }); await mount();
    expect(text()).toContain("Past due date");
  });
  it("refreshes all existing source hooks and changes the requested period", async () => {
    await mount(); act(() => button("Refresh evidence").click());
    expect(mocks.review.mock.results[0].value.refresh).toHaveBeenCalledOnce();
    const select = host.querySelector("select")!;
    act(() => { select.value = "last_30_days"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(mocks.review).toHaveBeenLastCalledWith("test-tenant-1", "last_30_days");
  });
});
