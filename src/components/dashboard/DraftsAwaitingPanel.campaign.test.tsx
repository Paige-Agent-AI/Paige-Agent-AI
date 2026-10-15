// @vitest-environment jsdom
// "Approve all" never approves an email campaign: a campaign reaches many people and is approved
// on its own, through its own row (marketing email E1). The button counts only what it will approve.
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApprovalQueueRow } from "@/hooks/usePendingApprovals";

const invoke = vi.fn(async (_name: string, _options: { body: { approval_id: string } }) => ({ data: { ok: true, executed: false }, error: null }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: (name: string, options: { body: { approval_id: string } }) => invoke(name, options) } } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), warning: vi.fn() } }));
vi.mock("@/components/paige/ApprovalRow", () => ({ ApprovalRow: ({ a }: { a: ApprovalQueueRow }) => <div>{a.summary}</div> }));

import { DraftsAwaitingPanel } from "./DraftsAwaitingPanel";

const row = (id: string, type: string, summary: string) => ({ id, type, summary, sla_state: "on_track", priority: 2 }) as unknown as ApprovalQueueRow;

let host: HTMLDivElement;
let root: Root;
const flush = async () => { await act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); }); };
const render = async (items: ApprovalQueueRow[]) => { act(() => root.render(<MemoryRouter><DraftsAwaitingPanel items={items} refresh={() => {}}/></MemoryRouter>)); await flush(); };
const batchButton = () => Array.from(host.querySelectorAll("button")).find((b) => /Approve all/.test(b.textContent ?? ""));

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  invoke.mockClear();
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

describe("Drafts awaiting you — batch approve", () => {
  it("counts and approves only the drafts that are not campaign sends", async () => {
    await render([row("a", "email_draft", "Reply to Dana"), row("b", "campaign_send", "Send October news"), row("c", "task", "Follow up")]);
    const button = batchButton();
    expect(button?.textContent).toContain("Approve all (2)");
    await act(async () => { button!.click(); });
    await flush();
    expect(invoke.mock.calls.map((call) => call[1].body.approval_id).sort()).toEqual(["a", "c"]);
  });

  it("offers no batch button when only one draft besides a campaign send is waiting", async () => {
    await render([row("a", "email_draft", "Reply to Dana"), row("b", "campaign_send", "Send October news")]);
    expect(batchButton()).toBeUndefined();
    expect(host.textContent).toContain("Send October news");
  });
});
