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
  toasts: [] as string[],
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name: string, args?: unknown) => {
      h.calls.push({ name, args });
      if (name === "operator_list_member_threads") return Promise.resolve(h.listResult);
      if (name === "operator_open_member_thread") return h.openGate ?? Promise.resolve(h.openResult);
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
  thread_id: "thread-1", owner_name: "Test Member", message_count: 2,
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
    expect(opens()).toEqual([{ name: "operator_open_member_thread", args: { _thread_id: "thread-1" } }]);
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
});
