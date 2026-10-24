import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OwnerTaskReview } from "./data/ownerTaskAutomation";
const m = vi.hoisted(() => ({ state: {} as Record<string, unknown>, refresh: vi.fn(), control: vi.fn(),
  openHistory: vi.fn(), inspectOutcome: vi.fn(), closeHistory: vi.fn() }));
vi.mock("./data/useOwnerTaskAutomations", () => ({ useOwnerTaskAutomations: () => m.state }));
import { OwnerTaskAutomations } from "./owner-task-automations";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: Array<{ root: Root; host: HTMLDivElement }> = [];
const cleanup = () => { act(() => { for (const r of roots) { r.root.unmount(); r.host.remove(); } }); roots.length = 0; };
function render(element: ReactNode) {
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host); roots.push({ root, host });
  const rerender = (next: ReactNode) => act(() => root.render(next)); rerender(element); return { rerender };
}
const roleElements = (role: string, name?: string) => [...document.querySelectorAll<HTMLElement>(role === "button" ? "button" : role === "link" ? "a" : `[role="${role}"]`)]
  .filter(e => name === undefined || (e.getAttribute("aria-label") ?? e.textContent?.trim()) === name);
const textElements = (text: string | RegExp) => [...document.querySelectorAll<HTMLElement>("p,strong,summary,pre")].filter(e => e.children.length === 0 &&
  (typeof text === "string" ? e.textContent === text : text.test(e.textContent ?? "")));
const screen = {
  getByRole: (role: string, options?: { name?: string; exact?: boolean }) => { const e = roleElements(role, options?.name)[0]; if (!e) throw new Error(`Missing ${role} ${options?.name ?? ""}`); return e; },
  queryByRole: (role: string, options?: { name?: string; exact?: boolean }) => roleElements(role, options?.name)[0] ?? null,
  getByText: (text: string | RegExp) => { const e = textElements(text)[0]; if (!e) throw new Error(`Missing text ${text}`); return e; },
  queryByText: (text: string | RegExp) => textElements(text)[0] ?? null,
};
const fireEvent = { click: (e: HTMLElement) => act(() => e.click()), keyDown: (e: HTMLElement, options: { key: string }) => act(() => { e.dispatchEvent(new KeyboardEvent("keydown", { ...options, bubbles: true })); }) };
const review = (): OwnerTaskReview => ({ id: "process", updatedAt: "2026-10-16T12:00:00.123456Z", process: {
  id: "process", tenant_id: "tenant", name: "Review new contacts", category: "general", trigger_key: "contact.created", trigger_config: {}, conditions: [],
  created_by: "owner", state: "draft", granted_lane: "confirm", owner_task_armed_at: null }, acts: [{ id: "step", position: 1, action_kind: "owner.task", tool_key: null,
  config: { title: "Review the new contact and prepare the next step for the owner.", description: "Read all contact notes.\nKeep the existing customer approval flow." } }] });
let row: OwnerTaskReview;
beforeEach(() => {
  row = review(); m.refresh.mockReset(); m.control.mockReset(); m.control.mockResolvedValue({ status: "saved", state: "live" });
  m.openHistory.mockReset(); m.inspectOutcome.mockReset(); m.closeHistory.mockReset();
  m.state = { read: { status: "ready", items: [row], hasMore: false }, busy: false, needsRefresh: false, feedback: null, scopeKey: "scope1", refresh: m.refresh, control: m.control,
    history: { status: "closed" }, openHistory: m.openHistory, inspectOutcome: m.inspectOutcome, closeHistory: m.closeHistory };
});
afterEach(cleanup);
const view = () => render(<MemoryRouter initialEntries={["/solo/123/settings/integrations"]}><OwnerTaskAutomations /></MemoryRouter>);
describe("internal task process customer controls", () => {
  it.each(["busy", "unknown"])("keeps %s feedback beside Refresh before long saved configuration", state => {
    row.acts[0].config = { title: "Review this contact", description: "Read the complete contact context carefully. ".repeat(9) };
    if (state === "busy") m.state.busy = true;
    else { m.state.feedback = { result: { status: "unknown" }, action: "arm" }; m.state.needsRefresh = true; }
    view(); const panel = document.querySelector(".sa-owner-tasks")!, header = panel.querySelector("header")!;
    const statuses = panel.querySelectorAll('[role="status"]'); expect(statuses).toHaveLength(1);
    expect(header.nextElementSibling).toBe(statuses[0]);
    expect(statuses[0].compareDocumentPosition(panel.querySelector(".sa-rules")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(m.control).not.toHaveBeenCalled(); expect(m.refresh).not.toHaveBeenCalled();
  });
  it("shows the complete stored task and links to the existing approvals/work homes", () => {
    view(); const config = row.acts[0].config as Record<string, string>;
    expect(screen.getByText(config.title)).toBeTruthy(); expect(screen.getByText(/Read all contact notes/).textContent).toBe(config.description);
    expect(screen.getByText(/When a contact is created/).textContent).toContain("Draft");
    expect(screen.getByRole("link", { name: "Review pending tasks" }).getAttribute("href")).toBe("/solo/123/command-center/business-game-plan");
    expect(screen.getByRole("link", { name: "Open work" }).getAttribute("href")).toBe("/solo/123/operations/work");
  });
  it.each(["Cancel", "Escape"])("%s closes inline review with zero configuration effects and restores focus", choice => {
    view(); const source = screen.getByRole("button", { name: "Review to enable" }); fireEvent.click(source);
    const cancel = screen.getByRole("button", { name: "Cancel", exact: true }); expect(document.activeElement).toBe(cancel);
    if (choice === "Cancel") fireEvent.click(cancel); else fireEvent.keyDown(cancel, { key: "Escape" });
    expect(screen.queryByRole("button", { name: "Enable future contacts" })).toBeNull(); expect(document.activeElement).toBe(source);
    expect(m.control).not.toHaveBeenCalled(); expect(m.refresh).not.toHaveBeenCalled();
  });
  it("sends exactly the captured reviewed object only after explicit enable confirmation", () => {
    view(); fireEvent.click(screen.getByRole("button", { name: "Review to enable" })); expect(m.control).not.toHaveBeenCalled();
    expect(screen.getByText(/No task is created by enabling/)).toBeTruthy(); fireEvent.click(screen.getByRole("button", { name: "Enable future contacts" }));
    expect(m.control).toHaveBeenCalledExactlyOnceWith(row, "arm"); expect(m.refresh).not.toHaveBeenCalled();
  });
  it("Refresh reads without submitting or retaining a review", () => {
    view(); fireEvent.click(screen.getByRole("button", { name: "Review to enable" })); fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(m.refresh).toHaveBeenCalledTimes(1); expect(m.control).not.toHaveBeenCalled(); expect(screen.queryByRole("button", { name: "Enable future contacts" })).toBeNull();
  });
  it("offers a safe pause, rather than enabling a legacy live row without activation evidence", () => {
    row.process.state = "live"; view(); expect(screen.getByText(/Activation unverified/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Review to enable" })).toBeNull(); fireEvent.click(screen.getByRole("button", { name: "Pause future contacts" }));
    expect(m.control).toHaveBeenCalledExactlyOnceWith(row, "pause");
  });
  it.each([{ title: "Review", assignee_user_id: "unsupported" }, ["unsupported"], { title: "{{payload.contact_id}}" }])("keeps unsupported %j inspectable and safely pausable", config => {
    row.acts[0].config = config; view(); expect(screen.queryByRole("button", { name: "Review to enable" })).toBeNull();
    fireEvent.click(screen.getByText("Inspect saved configuration")); expect(screen.getByText(/This configuration cannot be enabled/)).toBeTruthy();
    expect(document.querySelector("pre")!.textContent).toContain(JSON.stringify(config, null, 2).split("\n")[0]);
    fireEvent.click(screen.getByRole("button", { name: "Pause future contacts" })); expect(m.control).toHaveBeenCalledExactlyOnceWith(row, "pause");
  });
  it("rejects multistep/bare-tool/external/dynamic/unsupported trigger shapes as enable choices", () => {
    for (const change of [
      (r: OwnerTaskReview) => { r.acts.push({ ...r.acts[0], id: "other", position: 2 }); },
      (r: OwnerTaskReview) => { r.acts[0].action_kind = null; r.acts[0].tool_key = "crm_create_task"; },
      (r: OwnerTaskReview) => { r.acts[0].config = { title: "Review", to: "outside@example.invalid" }; },
      (r: OwnerTaskReview) => { r.process.trigger_config = { delay: 1 }; },
      (r: OwnerTaskReview) => { r.process.conditions = [{ field: "source" }]; },
    ]) { const r = review(); change(r); m.state.read = { status: "ready", items: [r], hasMore: false }; view();
      expect(screen.queryByRole("button", { name: "Review to enable" })).toBeNull(); cleanup(); }
  });
  it("uses native character counts for long Unicode text rather than rejecting valid astral characters", () => {
    row.acts[0].config = { title: "😀".repeat(500) }; const h = view(); expect(screen.getByRole("button", { name: "Review to enable" })).toBeTruthy();
    row.acts[0].config = { title: "😀".repeat(501) }; h.rerender(<MemoryRouter><OwnerTaskAutomations /></MemoryRouter>);
    expect(screen.queryByRole("button", { name: "Review to enable" })).toBeNull();
  });
  it.each(["unknown", "stale", "busy", "unavailable", "unsupported"])("shows truthful %s recovery and requires manual read before another decision", status => {
    m.state.feedback = { result: { status }, action: "arm" }; m.state.needsRefresh = true; view();
    expect((screen.getByRole("button", { name: "Review to enable" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("status").textContent).toContain("Refresh");
    if (status === "unknown") { expect(screen.getByRole("status").textContent).toContain("may have changed"); expect(screen.getByRole("status").textContent).not.toMatch(/nothing|not saved|did not/i); }
    expect(m.control).not.toHaveBeenCalled(); expect(m.refresh).not.toHaveBeenCalled();
  });
  it("reports saved configuration without claiming that a task executed", () => {
    m.state.feedback = { result: { status: "saved", state: "live" }, action: "arm" }; m.state.needsRefresh = true; view();
    expect(screen.getByRole("status").textContent).toContain("No task was created"); expect(m.control).not.toHaveBeenCalled();
  });
  it("hides a prior scope's open review immediately on context change", () => {
    const h = view(); fireEvent.click(screen.getByRole("button", { name: "Review to enable" })); m.state.scopeKey = "scope2";
    h.rerender(<MemoryRouter><OwnerTaskAutomations /></MemoryRouter>); expect(screen.queryByRole("button", { name: "Enable future contacts" })).toBeNull(); expect(m.control).not.toHaveBeenCalled();
  });
  it.each(["loading", "refused", "unavailable"])("keeps %s distinct from an empty account", status => {
    m.state.read = { status }; view(); expect(screen.queryByText(/No internal task process is saved/)).toBeNull(); expect(screen.queryByRole("button", { name: "Review to enable" })).toBeNull();
  });
  it("gives an honest empty and limited-inventory state", () => {
    m.state.read = { status: "ready", items: [], hasMore: true }; view(); expect(screen.getByText(/No internal task process appeared/)).toBeTruthy();
    expect(screen.queryByText(/No internal task process is saved/)).toBeNull();
    expect(screen.getByText(/Only the first 50/)).toBeTruthy(); expect(m.control).not.toHaveBeenCalled();
  });
  it("disables decisions and refresh while a control is pending", () => {
    m.state.busy = true; view(); expect(screen.getByRole("status").textContent).toContain("Saving");
    expect((screen.getByRole("button", { name: "Refresh" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Review to enable" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("original internal-task history inspection", () => {
  const taskId = "00000000-0000-4000-8000-000000000111";
  const locator = { approvalId: "00000000-0000-4000-8000-000000000112", occurrenceId: "00000000-0000-4000-8000-000000000113",
    updatedAt: "2026-10-18T12:30:00Z", approvalStatus: "approved" };
  const readyHistory = (outcome: unknown = null, hasMore = false) => ({ status: "ready", processId: row.id,
    list: { items: [locator], hasMore }, selected: outcome ? locator : null, outcome });
  const original = (verified = false) => ({ status: "ready", processId: row.id, approvalId: locator.approvalId,
    occurrenceId: locator.occurrenceId, approvalStatus: "approved", recordedOutcome: "executed", decidedAt: "2026-10-18T12:31:00Z",
    title: "Review the new contact", originalTask: verified ? { state: "verified", taskId,
      receiptId: "00000000-0000-4000-8000-000000000114", runId: "00000000-0000-4000-8000-000000000115" } : { state: "unconfirmed" }, currentTask: { state: "not_read" } });

  it("requests history for the exact current process without a control, refresh or replay", () => {
    view(); fireEvent.click(screen.getByRole("button", { name: "View history", exact: true }));
    expect(m.openHistory).toHaveBeenCalledExactlyOnceWith(row);
    expect(m.control).not.toHaveBeenCalled(); expect(m.refresh).not.toHaveBeenCalled(); expect(m.inspectOutcome).not.toHaveBeenCalled();
  });
  it("passes only the exact displayed locator to the existing outcome reader", () => {
    m.state.history = readyHistory(); view(); fireEvent.click(screen.getByRole("button", { name: "Inspect outcome", exact: true }));
    expect(m.inspectOutcome).toHaveBeenCalledExactlyOnceWith(locator); expect(m.control).not.toHaveBeenCalled();
  });
  it.each(["loading", "refused", "unavailable"])("shows %s history without implying an empty history or successful task", status => {
    m.state.history = { status, processId: row.id }; view();
    expect(screen.queryByText(/No recorded attempts/)).toBeNull(); expect(screen.queryByRole("link", { name: "Open task" })).toBeNull();
    expect(document.querySelector('[aria-label="Process history"]')).not.toBeNull(); expect(m.control).not.toHaveBeenCalled();
  });
  it.each([false, true])("keeps an empty history honest when the bounded list hasMore=%s", hasMore => {
    m.state.history = { ...readyHistory(null, hasMore), list: { items: [], hasMore } }; view();
    expect(screen.getByText(hasMore ? /Older attempts may not be shown/ : /No recorded attempts/)).toBeTruthy();
    if (hasMore) expect(screen.queryByText(/No recorded attempts/)).toBeNull();
  });
  it("never converts recorded executed status into a verified original task", () => {
    m.state.history = readyHistory(original()); view();
    expect(screen.getByText(/original task could not be verified/i)).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Open task" })).toBeNull(); expect(m.control).not.toHaveBeenCalled();
  });
  it.each([0, 24])("keeps the one selected result directly beside attempt %s of a full bounded list", selectedIndex => {
    const items = Array.from({ length: 25 }, (_, n) => ({ ...locator, approvalId: `approval-${n}`, occurrenceId: `occurrence-${n}` }));
    m.state.history = { ...readyHistory(original(true), true), list: { items, hasMore: true }, selected: items[selectedIndex] };
    view();
    const rows = document.querySelectorAll(".sa-owner-task-attempts > li"), results = document.querySelectorAll(".sa-owner-task-result");
    expect(rows).toHaveLength(25); expect(results).toHaveLength(1); expect(rows[selectedIndex].contains(results[0])).toBe(true);
    expect(results[0].previousElementSibling?.textContent).toBe("Inspect outcome");
    expect(screen.getByText(/Showing 25 recent attempts/)).toBeTruthy(); expect(m.control).not.toHaveBeenCalled();
  });
  it("does not render a result without the exact selected locator from its displayed list", () => {
    m.state.history = { ...readyHistory(original(true)), selected: { ...locator } }; view();
    expect(screen.queryByRole("link", { name: "Open task" })).toBeNull(); expect(document.querySelector(".sa-owner-task-result")).toBeNull();
  });
  it("rereads unavailable history through its existing reader without execution or refresh", () => {
    m.state.history = { status: "unavailable", processId: row.id }; view();
    fireEvent.click(screen.getByRole("button", { name: "Read history again" }));
    expect(m.openHistory).toHaveBeenCalledExactlyOnceWith(row); expect(m.control).not.toHaveBeenCalled(); expect(m.refresh).not.toHaveBeenCalled();
  });
  it("does not offer a Task destination outside a current SOLO route", () => {
    m.state.history = readyHistory(original(true)); render(<MemoryRouter initialEntries={["/settings"]}><OwnerTaskAutomations /></MemoryRouter>);
    expect(screen.queryByRole("link", { name: "Open task" })).toBeNull();
  });
  it("renders a saved title as text without executing markup", () => {
    m.state.history = readyHistory({ ...original(true), title: '<img src=x onerror="throw 1">' }); view();
    expect(document.querySelector(".sa-owner-task-result h4")?.textContent).toBe('<img src=x onerror="throw 1">');
    expect(document.querySelector(".sa-owner-task-result img")).toBeNull(); expect(m.control).not.toHaveBeenCalled();
  });
  it("closes history when entering the existing enable review without changing its saved action", () => {
    m.state.history = readyHistory(original(true)); view(); fireEvent.click(screen.getByRole("button", { name: "Review to enable" }));
    expect(m.closeHistory).toHaveBeenCalledTimes(1); expect(screen.getByRole("button", { name: "Enable future contacts" })).toBeTruthy();
    expect(m.control).not.toHaveBeenCalled();
  });
  it("opens the exact verified original Task through the current canonical SOLO route", () => {
    m.state.history = readyHistory(original(true)); view();
    expect(screen.getByRole("link", { name: "Open task", exact: true }).getAttribute("href")).toBe(`/solo/123/operations/work?task=${taskId}`);
    expect(screen.getByText(/Open the task to read its current state/)).toBeTruthy(); expect(m.control).not.toHaveBeenCalled();
  });
  it.each(["loading", "refused", "unavailable"])("does not retain a previous Task link while the selected outcome becomes %s", status => {
    m.state.history = readyHistory(original(true)); const h = view(); expect(screen.getByRole("link", { name: "Open task" })).toBeTruthy();
    m.state.history = readyHistory({ status }); h.rerender(<MemoryRouter initialEntries={["/solo/123/settings/integrations"]}><OwnerTaskAutomations /></MemoryRouter>);
    expect(screen.queryByRole("link", { name: "Open task" })).toBeNull(); expect(m.control).not.toHaveBeenCalled();
  });
  it("does not expose another process's selected outcome beside this process", () => {
    m.state.history = { ...readyHistory(original(true)), processId: "another-process" }; view();
    expect(screen.queryByRole("link", { name: "Open task" })).toBeNull();
    expect(document.querySelector('[aria-label="Process history"]')).toBeNull();
  });
  it.each(["busy", "needsRefresh"])("withholds private history and disables its opener while %s", state => {
    m.state.history = readyHistory(original(true)); m.state[state] = true; view();
    expect(screen.queryByRole("link", { name: "Open task" })).toBeNull();
    expect((screen.getByRole("button", { name: "View history" }) as HTMLButtonElement).disabled).toBe(true);
  });
  it.each(["Close history", "Escape"])("%s closes only inspection and restores the invoking control", choice => {
    m.state.history = readyHistory(); view(); const opener = screen.getByRole("button", { name: "View history" });
    fireEvent.click(opener);
    const close = screen.getByRole("button", { name: "Close history", exact: true });
    if (choice === "Escape") fireEvent.keyDown(close, { key: "Escape" }); else fireEvent.click(close);
    expect(m.closeHistory).toHaveBeenCalledTimes(1); expect(document.activeElement).toBe(opener); expect(m.control).not.toHaveBeenCalled();
  });
});


describe("Operations host navigation contract", () => {
  function Location() { const location = useLocation(); return <output>{location.pathname}</output>; }
  it("publishes the original exact-review hold and clears it on Cancel and unmount", () => {
    let guard: () => string | null = () => null;
    const register = vi.fn((next: (() => string | null) | null) => { guard = next ?? (() => null); });
    render(<MemoryRouter><OwnerTaskAutomations onNavigationGuardChange={register} /></MemoryRouter>);
    expect(guard()).toBeNull(); fireEvent.click(screen.getByRole("button", { name: "Review to enable" }));
    expect(guard()).toContain("Finish or cancel");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" })); expect(guard()).toBeNull();
    expect(m.control).not.toHaveBeenCalled(); cleanup(); expect(register).toHaveBeenLastCalledWith(null);
  });
  it.each(["review", "saving"])("keeps the original Work exit in the host while %s is held", state => {
    let guard: () => string | null = () => null;
    const register = (next: (() => string | null) | null) => { guard = next ?? (() => null); };
    if (state === "saving") m.state.busy = true;
    render(<MemoryRouter initialEntries={["/solo/test-account/operations/playbooks"]}><Location />
      <OwnerTaskAutomations onNavigationGuardChange={register} canLeave={() => !guard()} /></MemoryRouter>);
    if (state === "review") fireEvent.click(screen.getByRole("button", { name: "Review to enable" }));
    fireEvent.click(screen.getByRole("link", { name: "Open work" }));
    expect(document.querySelector("output")?.textContent).toBe("/solo/test-account/operations/playbooks");
    expect(m.control).not.toHaveBeenCalled();
    if (state === "review") { fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      fireEvent.click(screen.getByRole("link", { name: "Open work" }));
      expect(document.querySelector("output")?.textContent).toBe("/solo/test-account/operations/work"); }
  });
});
