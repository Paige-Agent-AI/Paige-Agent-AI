// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TEST_BUSINESS_REVIEW as SNAPSHOT } from "@/test/fixtures/business-review";
import { ExecutiveOverview } from "./ExecutiveOverview";

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

describe("Executive — integrated customer flow", () => {
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
    expect(gaps.textContent).toContain("Marketing campaigns"); expect(gaps.textContent).toContain("Not connected");
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
    expect(text()).toContain("Marketing campaigns"); expect(text()).toContain("Game Plan performance");
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
