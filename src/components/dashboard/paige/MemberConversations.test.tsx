import { act, Profiler } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Owner ruling 2026-09-28: members' private conversations are hidden by default, openable on
// purpose, and recorded when opened. This is the deliberate door; the server decides who may use it.

const h = vi.hoisted(() => ({
  listResult: { data: [] as unknown[], error: null as null | { message: string } },
  openResult: { data: null as unknown, error: null as null | { message: string } },
  calls: [] as Array<{ name: string; args?: unknown }>,
  openGate: null as null | Promise<unknown>,
  listPages: null as null | Array<{ data: unknown[]; error: null }>,
  openPages: null as null | Array<{ data: unknown; error: null }>,
  toasts: [] as string[],
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name: string, args?: unknown) => {
      h.calls.push({ name, args });
      if (name === "operator_list_member_threads") return Promise.resolve(h.listPages?.shift() ?? h.listResult);
      if (name === "operator_open_member_thread") return h.openGate ?? Promise.resolve(h.openPages?.shift() ?? h.openResult);
      return Promise.resolve({ data: null, error: null });
    },
  },
}));
vi.mock("sonner", () => ({ toast: { error: (m: string) => h.toasts.push(m), success: vi.fn() } }));

import { MemberConversations } from "./MemberConversations";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
const thread = {
  thread_id: "thread-1", owner_name: "Test Member", owner_email: "member@example.test", message_count: 2,
  last_message_at: new Date().toISOString(), created_at: new Date().toISOString(),
};

async function mount() {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => { root.render(<MemberConversations scopeKey="tenant-a" />); });
  await act(async () => { await Promise.resolve(); });
}
const byText = (text: string) =>
  Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.includes(text)) as HTMLButtonElement | undefined;
const opens = () => h.calls.filter((c) => c.name === "operator_open_member_thread");

beforeEach(() => {
  h.listResult = { data: [thread], error: null };
  h.openResult = { data: null, error: null };
  h.calls.length = 0;
  h.toasts.length = 0;
  h.openGate = null;
  h.listPages = null;
  h.openPages = null;
});
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
});

describe("members' conversations", () => {
  it("does not exist for a caller the server refuses", async () => {
    h.listResult = { data: [], error: { message: "operator_member_threads_not_permitted" } };
    await mount();
    expect(host.textContent).toBe("");
  });

  it("is collapsed by default and names whose conversation, never its title", async () => {
    await mount();
    const toggle = byText("Members' conversations");
    expect(toggle?.getAttribute("aria-expanded")).toBe("false");
    expect(host.textContent).not.toContain("Test Member");
    await act(async () => { toggle!.click(); });
    expect(host.textContent).toContain("Test Member");
    expect(host.textContent).toContain("2 messages");
    expect(host.textContent).toContain("Opening one is recorded under your name");
  });

  it("asks first, says the open is recorded, and opens nothing on Cancel", async () => {
    await mount();
    await act(async () => { byText("Members' conversations")!.click(); });
    await act(async () => { byText("Test Member")!.click(); });
    expect(document.body.textContent).toContain("Open Test Member's conversation?");
    expect(document.body.textContent).toContain("Opening it is recorded under your name");
    await act(async () => { byText("Cancel")!.click(); });
    expect(opens()).toHaveLength(0);
  });

  it("opens on purpose into a read-only view named as the member's", async () => {
    h.openResult = {
      data: { threadId: "thread-1", ownerName: "Test Member", turns: [
        { role: "user", content: "member question", createdAt: "2026-09-28T00:00:00Z" },
        { role: "assistant", content: "paige answer", createdAt: "2026-09-28T00:00:01Z" },
      ] },
      error: null,
    };
    await mount();
    await act(async () => { byText("Members' conversations")!.click(); });
    await act(async () => { byText("Test Member")!.click(); });
    await act(async () => { byText("Open conversation")!.click(); await Promise.resolve(); });
    expect(opens()).toEqual([{ name: "operator_open_member_thread", args: { _thread_id: "thread-1", _expected_tenant: "tenant-a" } }]);
    expect(h.calls.find((c) => c.name === "operator_list_member_threads")?.args).toEqual({ _expected_tenant: "tenant-a", _limit: 50 });
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain("Test Member's conversation with PAIGE");
    expect(dialog?.textContent).toContain("Read only");
    expect(dialog?.textContent).toContain("member question");
    expect(dialog?.textContent).toContain("paige answer");
    expect(dialog?.querySelector("textarea, input")).toBeNull();
  });

  it("shows nothing of the conversation when the server refuses the open", async () => {
    h.openResult = { data: null, error: { message: "operator_not_acting" } };
    await mount();
    await act(async () => { byText("Members' conversations")!.click(); });
    await act(async () => { byText("Test Member")!.click(); });
    await act(async () => { byText("Open conversation")!.click(); await Promise.resolve(); });
    expect(h.toasts[0]).toContain("no longer acting as this workspace");
    expect(document.body.textContent).not.toContain("conversation with PAIGE");
  });

  it("drops an open that answers after the workspace changed", async () => {
    let answer!: (value: unknown) => void;
    h.openGate = new Promise((resolve) => { answer = resolve; });
    await mount();
    await act(async () => { byText("Members' conversations")!.click(); });
    await act(async () => { byText("Test Member")!.click(); });
    await act(async () => { byText("Open conversation")!.click(); await Promise.resolve(); });
    // The operator moves to another workspace while the open for this one is still in flight.
    await act(async () => { root.render(<MemberConversations scopeKey="tenant-b" />); });
    await act(async () => {
      answer({ data: { threadId: "thread-1", ownerName: "Test Member", turns: [
        { role: "user", content: "workspace A question", createdAt: "2026-09-28T00:00:00Z" },
      ] }, error: null });
      await Promise.resolve();
    });
    expect(document.body.textContent).not.toContain("workspace A question");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("never commits a frame of the next workspace that still shows this one's members", async () => {
    // The same tree on both renders, so React reuses the component rather than remounting it.
    const atCommit: string[] = [];
    let recording = false;
    const tree = (scope: string) => (
      <Profiler id="switch" onRender={() => { if (recording) atCommit.push(host.textContent ?? ""); }}>
        <MemberConversations scopeKey={scope} />
      </Profiler>
    );
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => { root.render(tree("tenant-a")); });
    await act(async () => { await Promise.resolve(); });
    await act(async () => { byText("Members' conversations")!.click(); });
    expect(host.textContent).toContain("Test Member");
    // What the DOM holds at the moment workspace B's render commits, before any effect runs.
    h.listResult = { data: [], error: null };
    recording = true;
    await act(async () => { root.render(tree("tenant-b")); });
    expect(atCommit.length).toBeGreaterThan(0);
    expect(atCommit[0]).not.toContain("Test Member");
  });

  it("keeps its dialogs' keys to themselves, so Escape does not also close the sheet around it", async () => {
    // The Solo history sheet closes on Escape and traps Tab from its own onKeyDown. React sends a
    // portaled dialog's key events up the component tree, so without a stop they reach the sheet.
    const sheetKeys: string[] = [];
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => {
      root.render(<div onKeyDown={(e) => sheetKeys.push(e.key)}><MemberConversations scopeKey="tenant-a" /></div>);
    });
    await act(async () => { await Promise.resolve(); });
    await act(async () => { byText("Members' conversations")!.click(); });
    await act(async () => { byText("Test Member")!.click(); });
    const confirm = document.querySelector('[role="alertdialog"]') as HTMLElement;
    expect(confirm).not.toBeNull();
    await act(async () => {
      confirm.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
      confirm.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(sheetKeys).toEqual([]);
  });

  it("shows the time the server recorded, not the browser's clock", async () => {
    h.openResult = { data: { threadId: "thread-1", ownerName: "Test Member", openedAt: "2026-09-28T03:07:00Z", turns: [] }, error: null };
    await mount();
    await act(async () => { byText("Members' conversations")!.click(); });
    await act(async () => { byText("Test Member")!.click(); });
    await act(async () => { byText("Open conversation")!.click(); await Promise.resolve(); });
    const recorded = new Date("2026-09-28T03:07:00Z").toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(`You opened it at ${recorded}`);
  });

  it("says so when this tab shows a workspace the operator has since left", async () => {
    h.openResult = { data: null, error: { message: "operator_scope_moved" } };
    await mount();
    await act(async () => { byText("Members' conversations")!.click(); });
    await act(async () => { byText("Test Member")!.click(); });
    await act(async () => { byText("Open conversation")!.click(); await Promise.resolve(); });
    expect(h.toasts[0]).toContain("another workspace");
    expect(document.body.textContent).not.toContain("conversation with PAIGE");
  });

  it("tells same-named members apart by email, in the row and before the open", async () => {
    h.listResult = { data: [
      { ...thread, thread_id: "a", owner_name: "Sam Lee", owner_email: "sam.lee@example.test" },
      { ...thread, thread_id: "b", owner_name: "Sam Lee", owner_email: "slee@example.test" },
    ], error: null };
    await mount();
    await act(async () => { byText("Members' conversations")!.click(); });
    const rows = Array.from(host.querySelectorAll("li button")).map((b) => b.textContent);
    expect(rows[0]).toContain("sam.lee@example.test");
    expect(rows[1]).toContain("slee@example.test");
    await act(async () => { byText("slee@example.test")!.click(); });
    expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain("slee@example.test");
  });

  it("lists fifty at a time and fetches the next page from the last row on request", async () => {
    const at = (i: number) => new Date(Date.UTC(2026, 8, 28, 0, 0) - i * 60000).toISOString();
    const page = (from: number, n: number) => Array.from({ length: n }, (_, i) => ({
      ...thread, thread_id: `t${from + i}`, owner_name: `Member ${from + i}`, owner_email: `m${from + i}@example.test`, sort_at: at(from + i),
    }));
    h.listPages = [{ data: page(0, 50), error: null }, { data: page(50, 3), error: null }];
    await mount();
    await act(async () => { byText("Members' conversations")!.click(); });
    expect(host.querySelectorAll("li button").length).toBe(50);
    await act(async () => { byText("Show more")!.click(); await Promise.resolve(); });
    const lists = h.calls.filter((c) => c.name === "operator_list_member_threads");
    expect(lists[1].args).toEqual({ _expected_tenant: "tenant-a", _limit: 50, _before_sort_at: at(49), _before_thread_id: "t49" });
    expect(host.querySelectorAll("li button").length).toBe(53);
    expect(byText("Show more")).toBeUndefined();
  });

  it("shows earlier messages on request, above the ones already shown", async () => {
    h.openPages = [
      { data: { threadId: "thread-1", ownerName: "Test Member", earlierBeforeSeq: 7, turns: [{ role: "user", content: "recent turn", createdAt: "2026-09-28T01:00:00Z" }] }, error: null },
      { data: { threadId: "thread-1", ownerName: "Test Member", earlierBeforeSeq: null, turns: [{ role: "user", content: "first turn", createdAt: "2026-09-27T01:00:00Z" }] }, error: null },
    ];
    await mount();
    await act(async () => { byText("Members' conversations")!.click(); });
    await act(async () => { byText("Test Member")!.click(); });
    await act(async () => { byText("Open conversation")!.click(); await Promise.resolve(); });
    await act(async () => { byText("Show earlier messages")!.click(); await Promise.resolve(); });
    expect(opens()[1].args).toEqual({ _thread_id: "thread-1", _expected_tenant: "tenant-a", _before_seq: 7 });
    const text = document.querySelector('[role="dialog"]')?.textContent ?? "";
    expect(text.indexOf("first turn")).toBeGreaterThan(-1);
    expect(text.indexOf("first turn")).toBeLessThan(text.indexOf("recent turn"));
    expect(byText("Show earlier messages")).toBeUndefined();
  });

  it("clears what it shows when the operator's workspace moved in another tab", async () => {
    h.openResult = { data: { threadId: "thread-1", ownerName: "Test Member", turns: [{ role: "user", content: "private words", createdAt: "2026-09-28T00:00:00Z" }] }, error: null };
    await mount();
    await act(async () => { byText("Members' conversations")!.click(); });
    await act(async () => { byText("Test Member")!.click(); });
    await act(async () => { byText("Open conversation")!.click(); await Promise.resolve(); });
    expect(document.body.textContent).toContain("private words");
    // Another tab exits this workspace and enters another; this tab comes back into focus.
    h.listResult = { data: [], error: { message: "operator_scope_moved" } };
    await act(async () => { window.dispatchEvent(new Event("focus")); await Promise.resolve(); await Promise.resolve(); });
    expect(document.body.textContent).not.toContain("private words");
    expect(host.textContent).toBe("");
    expect(h.toasts.some((t) => t.includes("another workspace"))).toBe(true);
  });

  it("re-checks when the tab becomes visible again, and keeps what still holds", async () => {
    await mount();
    await act(async () => { byText("Members' conversations")!.click(); });
    const before = h.calls.filter((c) => c.name === "operator_list_member_threads").length;
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); await Promise.resolve(); });
    expect(h.calls.filter((c) => c.name === "operator_list_member_threads").length).toBe(before + 1);
    expect(host.textContent).toContain("Test Member");
  });

  it("frees Show more when its page answers after the list was reloaded", async () => {
    const page = Array.from({ length: 50 }, (_, i) => ({ ...thread, thread_id: `t${i}`, owner_name: `Member ${i}`, sort_at: new Date(Date.UTC(2026, 8, 28) - i * 60000).toISOString() }));
    h.listResult = { data: page, error: null };
    await mount();
    await act(async () => { byText("Members' conversations")!.click(); });
    let answer!: (value: unknown) => void;
    h.listPages = [new Promise((resolve) => { answer = resolve; }) as never];
    await act(async () => { byText("Show more")!.click(); });
    // A failed open reloads the list while the page is still in flight.
    h.listPages = null;
    h.openResult = { data: null, error: { message: "member_thread_not_available" } };
    await act(async () => { byText("Member 0")!.click(); });
    await act(async () => { byText("Open conversation")!.click(); await Promise.resolve(); await Promise.resolve(); });
    await act(async () => { answer({ data: [], error: null }); await Promise.resolve(); });
    expect(byText("Show more")?.disabled).toBe(false);
  });

  it("comes back when a later re-check finds the operator back in this workspace", async () => {
    await mount();
    // Another tab exits this workspace; this tab comes back and clears.
    h.listResult = { data: [], error: { message: "operator_not_acting" } };
    await act(async () => { window.dispatchEvent(new Event("focus")); await Promise.resolve(); await Promise.resolve(); });
    expect(host.textContent).toBe("");
    // The operator re-enters the same workspace in that tab; this tab's scope never changed.
    h.listResult = { data: [thread], error: null };
    await act(async () => { window.dispatchEvent(new Event("focus")); await Promise.resolve(); await Promise.resolve(); });
    await act(async () => { byText("Members' conversations")?.click(); });
    expect(host.textContent).toContain("Test Member");
  });

  it("drops an open still in flight when a re-check has revoked this workspace", async () => {
    let answer!: (value: unknown) => void;
    h.openGate = new Promise((resolve) => { answer = resolve; });
    await mount();
    await act(async () => { byText("Members' conversations")!.click(); });
    await act(async () => { byText("Test Member")!.click(); });
    await act(async () => { byText("Open conversation")!.click(); await Promise.resolve(); });
    h.listResult = { data: [], error: { message: "operator_scope_moved" } };
    await act(async () => { window.dispatchEvent(new Event("focus")); await Promise.resolve(); await Promise.resolve(); });
    await act(async () => {
      answer({ data: { threadId: "thread-1", ownerName: "Test Member", turns: [{ role: "user", content: "revoked words", createdAt: "2026-09-28T00:00:00Z" }] }, error: null });
      await Promise.resolve();
    });
    expect(document.body.textContent).not.toContain("revoked words");
  });
});
