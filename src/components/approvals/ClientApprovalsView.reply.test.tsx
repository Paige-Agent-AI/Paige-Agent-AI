import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ClientApprovalsView } from "./ClientApprovalsView";
import type { MyApprovalRow } from "@/hooks/useMyApprovals";

const row = (status: string): MyApprovalRow => ({
  id: `row-${status}`, category: "other", type: null, status, summary: "Confirm your mailing address", priority: null,
  risk_level: null, source: null, contact_id: null, sla_due_at: null, created_at: "2026-10-01T10:00:00Z",
  reviewed_at: null, sent_at: null, decision_rationale: null, metadata: null,
});
const f = vi.hoisted(() => ({ pending: [] as MyApprovalRow[] }));
vi.mock("@/hooks/useMyApprovals", () => ({ useMyApprovals: () => ({ pending: f.pending, resolved: [], loading: false }) }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root, host: HTMLDivElement;
beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });

it("sends a customer who must reply to their business's portal thread, not the platform desk", async () => {
  f.pending = [row("changes_requested")];
  await act(async () => root.render(<MemoryRouter><ClientApprovalsView /></MemoryRouter>));
  const reply = Array.from(host.querySelectorAll("a")).find(a => a.textContent === "Reply to your team");
  expect(reply?.getAttribute("href")).toBe("/app/messages");
  expect(host.querySelector('a[href="/app/support"]')).toBeNull();
  expect(host.textContent).not.toMatch(/your coach/i);
});
