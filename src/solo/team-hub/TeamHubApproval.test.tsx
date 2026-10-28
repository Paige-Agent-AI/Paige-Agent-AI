import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TeamHubApprovalCard } from "./TeamHubApproval";
import { parseApproval, parseTeamHubMessage, type TeamHubApproval } from "./team-hub-contract";

// EXP08 A2: the approval an agent's message carries. Fictional names only.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SUMMARY = "ZION wants to create a task in Operations: \u201cPrepare the onboarding packet\u201d, for Jordan Lee, due Fri, Oct 31.";
const waiting = (o: Partial<TeamHubApproval> = {}): TeamHubApproval => ({
  state: "waiting", kind: "Operations task", asker_user_id: "u-morgan", decided_by_name: null, decided_at: null, covered_by: null,
  actions: [{ summary: SUMMARY, fingerprint: "fp-1" }], ...o,
});

let root: Root | null = null;
let host: HTMLDivElement | null = null;
function render(node: React.ReactNode) {
  host = document.createElement("div"); document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(node));
  return host;
}
afterEach(() => { act(() => root?.unmount()); host?.remove(); root = null; host = null; });
const buttons = (el: HTMLElement) => Array.from(el.querySelectorAll("button")).map((b) => b.textContent?.trim());

describe("TeamHubApprovalCard", () => {
  it("gives the asker Approve and Not now, bound to the action's own fingerprint", () => {
    const onAct = vi.fn();
    const el = render(<TeamHubApprovalCard approval={waiting()} agent="zion" meId="u-morgan" askerName="Morgan" decidedLabel={null} onAct={onAct} />);
    expect(buttons(el)).toEqual(["Approve", "Not now"]);
    // The Team Hub layout keys on these regions, never on the gold variant's utility class.
    const approve = el.querySelector('[data-confirm-part="approve"]') as HTMLButtonElement;
    expect(approve.textContent?.trim()).toBe("Approve");
    expect(el.querySelector('[data-confirm-part="deny"]')?.textContent?.trim()).toBe("Not now");
    act(() => approve.click());
    expect(onAct).toHaveBeenCalledWith({ kind: "approve", fingerprints: ["fp-1"] });
  });

  it("gives everyone else the shared card's refusal in the contract's words, and no control", () => {
    const el = render(<TeamHubApprovalCard approval={waiting()} agent="zion" meId="u-priya" askerName="Morgan" decidedLabel={null} onAct={vi.fn()} />);
    expect(el.querySelectorAll("button")).toHaveLength(0);
    const card = el.querySelector('[data-card-mode="decide"]');
    expect(card?.querySelector('[data-confirm-part="refusal"]')?.textContent).toBe("Waiting on Morgan. Only Morgan can approve this, because Morgan asked.");
    // The card is named for this reader, never "Needs your OK" to someone who is not deciding.
    expect(card?.getAttribute("aria-label")).toBe("Waiting on Morgan");
    expect(el.textContent).not.toContain("Needs your OK");
  });

  it("never carries a fingerprint into a teammate's card, even if a read leaked one", () => {
    const onAct = vi.fn();
    const el = render(<TeamHubApprovalCard approval={waiting()} agent="zion" meId="u-priya" askerName="Morgan" decidedLabel={null} onAct={onAct} />);
    expect(el.querySelector('[data-confirm-part="approve"]')).toBeNull();
  });

  it("refuses honestly, with no Approve, where no seam can redeem it", () => {
    const el = render(<TeamHubApprovalCard approval={waiting()} agent="zion" meId="u-morgan" askerName="Morgan" decidedLabel={null} />);
    expect(buttons(el)).toEqual([]);
    expect(el.textContent).toContain("isn't connected yet, so nothing has changed");
    // Named for what is true for the asker here, never "Needs your OK" on a card nothing can redeem.
    expect(el.querySelector('[data-card-mode="decide"]')?.getAttribute("aria-label")).toBe("Approval not available here");
    expect(el.textContent).not.toContain("Needs your OK");
  });

  it("tells an asker whose card arrived without a binding that it can no longer be approved, not that Team Hub isn't connected", () => {
    const el = render(<TeamHubApprovalCard approval={waiting({ actions: [{ summary: SUMMARY }] })} agent="zion" meId="u-morgan" askerName="Morgan" decidedLabel={null} onAct={vi.fn()} />);
    expect(buttons(el)).toEqual([]);
    const card = el.querySelector('[data-card-mode="decide"]');
    expect(card?.querySelector('[data-confirm-part="refusal"]')?.textContent).toBe("This card can no longer be approved, so nothing has changed. Ask again for a fresh one.");
    expect(card?.getAttribute("aria-label")).toBe("Approval not available here");
    expect(el.textContent).not.toContain("isn't connected yet");
  });

  it("keeps the asker's own heading on a card they can approve", () => {
    const el = render(<TeamHubApprovalCard approval={waiting()} agent="zion" meId="u-morgan" askerName="Morgan" decidedLabel={null} onAct={vi.fn()} />);
    expect(el.querySelector('[data-card-mode="decide"]')?.getAttribute("aria-label")).not.toBe("Approval not available here");
  });

  it("reports Done once, in the server's words, with who approved it", () => {
    const el = render(<TeamHubApprovalCard agent="zion" meId="u-priya" askerName="Morgan" decidedLabel="10:04 AM" onAct={vi.fn()}
      approval={waiting({ state: "done", decided_at: "2026-10-28T10:04:00Z", actions: [{ summary: SUMMARY, state: "done", note: "Created in Operations for Jordan Lee, due Fri, Oct 31." }] })} />);
    expect(el.textContent).toContain("Created in Operations for Jordan Lee, due Fri, Oct 31.");
    expect(el.textContent).not.toContain(SUMMARY);
    expect(el.textContent).toContain("Approved by Morgan · 10:04 AM");
    expect(buttons(el)).toEqual([]);
  });

  it("says Couldn't confirm it ran in the contract's words", () => {
    const el = render(<TeamHubApprovalCard agent="zion" meId="u-morgan" askerName="Morgan" decidedLabel="10:04 AM"
      approval={waiting({ state: "unconfirmed", actions: [{ summary: SUMMARY, state: "unconfirmed" }] })} />);
    expect(el.textContent).toContain("Couldn't confirm it ran");
    expect(el.textContent).toContain("Approved by you · 10:04 AM");
  });

  // Standing (owner decision 1, ruled 2026-10-28; written by A2c, no backend writes it yet): an ordinary write that ran under the asker's standing permission.
  const standing = (): TeamHubApproval => waiting({ state: "standing", decided_at: "2026-10-28T10:04:00Z", covered_by: "Operations tasks you ask ZION for in this workspace",
    actions: [{ summary: SUMMARY, state: "done", note: "Created in Operations: \u201cPrepare the onboarding packet\u201d, for Jordan Lee, due Fri, Oct 31." }] });

  it("gives the asker a standing receipt with what it covers and one Pause, wired to the act", () => {
    const onAct = vi.fn();
    const el = render(<TeamHubApprovalCard approval={standing()} agent="zion" meId="u-morgan" askerName="Morgan" decidedLabel="10:04 AM" onAct={onAct} />);
    expect(el.textContent).toContain("Created in Operations");
    expect(el.textContent).toContain("Covers: Operations tasks you ask ZION for in this workspace.");
    expect(el.textContent).toContain("Done under your standing permission \u00b7 10:04 AM");
    expect(buttons(el)).toEqual(["Pause"]);
    expect(el.querySelector('[data-confirm-part="approve"], [data-confirm-part="deny"]')).toBeNull();
    act(() => (el.querySelector("button") as HTMLButtonElement).click());
    expect(onAct).toHaveBeenCalledWith({ kind: "pause" });
  });

  it("shows a teammate the same standing receipt in their words, with nothing to press", () => {
    const el = render(<TeamHubApprovalCard approval={{ ...standing(), covered_by: "Operations tasks Morgan asks ZION for in this workspace" }}
      agent="zion" meId="u-priya" askerName="Morgan" decidedLabel="10:04 AM" onAct={vi.fn()} />);
    expect(el.textContent).toContain("Done under Morgan's standing permission \u00b7 10:04 AM");
    expect(el.textContent).toContain("Covers: Operations tasks Morgan asks ZION for in this workspace.");
    expect(buttons(el)).toEqual([]);
  });

  it("tells Not now and Expired apart, names who declined, and offers nothing to press", () => {
    const declined = render(<TeamHubApprovalCard approval={waiting({ state: "declined", decided_by_name: "Morgan Reyes" })} agent="zion" meId="u-morgan" askerName="Morgan" decidedLabel="10:03 AM" onAct={vi.fn()} />);
    expect(declined.textContent).toContain("You chose Not now at 10:03 AM. Nothing was changed.");
    expect(buttons(declined)).toEqual([]);
    act(() => root?.unmount()); host?.remove();
    const seen = render(<TeamHubApprovalCard approval={waiting({ state: "declined", decided_by_name: "Morgan Reyes" })} agent="zion" meId="u-priya" askerName="Morgan" decidedLabel="10:03 AM" onAct={vi.fn()} />);
    expect(seen.textContent).toContain("Morgan declined at 10:03 AM. Nothing was changed.");
    act(() => root?.unmount()); host?.remove();
    const expired = render(<TeamHubApprovalCard approval={waiting({ state: "expired" })} agent="zion" meId="u-morgan" askerName="Morgan" decidedLabel="10:32 AM" onAct={vi.fn()} />);
    expect(expired.textContent).toContain("Expired at 10:32 AM. Nothing was changed.");
    expect(expired.textContent?.match(/Expired/g)).toHaveLength(1);
    expect(buttons(expired)).toEqual([]);
  });
});

describe("parseApproval", () => {
  it("reads a whole approval, refuses one that is not whole, and carries no unknown receipt flag or link", () => {
    const base = { state: "done", kind: "Operations task", asker_user_id: "u-morgan", actions: [{ summary: "Done it", state: "done" }] };
    const parsed = parseApproval({ ...base, executed_under_standing: true, reopen: { label: "Open", href: "/solo/operations" } });
    expect(parsed?.state).toBe("done");
    expect(parsed).not.toHaveProperty("executed_under_standing");
    expect(parsed).not.toHaveProperty("reopen");
    expect(parseApproval({ ...base, state: "maybe" })).toBeNull();
    expect(parseApproval({ ...base, actions: [] })).toBeNull();
    // Standing must say what it ran under; without that the receipt is not whole.
    expect(parseApproval({ ...base, state: "standing" })).toBeNull();
    expect(parseApproval({ ...base, state: "standing", covered_by: "Operations tasks you ask ZION for" })?.covered_by).toBe("Operations tasks you ask ZION for");
    expect(parsed?.covered_by).toBeNull();
  });

  it("is carried only on an agent's message, and a message without one reads as it did before A2", () => {
    const row = { id: "m1", author_user_id: "u-morgan", body: "hi", created_at: "2026-10-28T10:00:00Z", parent_message_id: null, reply_count: 0, last_reply_at: null, mentions: [] };
    expect(parseTeamHubMessage(row)).not.toHaveProperty("approval");
    const approval = { state: "waiting", kind: "Operations task", asker_user_id: "u-morgan", actions: [{ summary: "Do it" }] };
    expect(parseTeamHubMessage({ ...row, approval })).not.toHaveProperty("approval");
    expect(parseTeamHubMessage({ ...row, author_kind: "agent", agent_key: "zion", approval })?.approval?.state).toBe("waiting");
  });
});
