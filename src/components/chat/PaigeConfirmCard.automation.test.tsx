import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { PaigeConfirmCard } from "./PaigeConfirmCard";
import { automationDraftSummary } from "../../../supabase/functions/_shared/paige-orchestration/automation-draft-summary";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let cleanup: (() => void) | undefined;
afterEach(() => { cleanup?.(); cleanup = undefined; });
function mount(fingerprint?: string) {
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host), approve = vi.fn(), deny = vi.fn();
  const summary = automationDraftSummary({ name: "Kickoff", trigger_key: "contact.created", steps: [
    { action_kind: "owner.task", config: { title: "Prepare <strong>the brief</strong>", description: "Review the original signed scope." } },
  ] });
  act(() => root.render(<PaigeConfirmCard actions={[{ summary, fingerprint }]} onApprove={approve} onDeny={deny} />));
  cleanup = () => { act(() => root.unmount()); host.remove(); };
  const button = (text: string) => [...host.querySelectorAll("button")].find(b => b.textContent?.trim() === text);
  return { host, approve, deny, button };
}

it("renders original task words as plain text and distinguishes preparation from execution", () => {
  const ui = mount("original-stored-fingerprint");
  expect(ui.host.textContent).toContain("Prepare <strong>the brief</strong>");
  expect(ui.host.querySelector('[data-confirm-part="summary"] strong')).toBeNull();
  expect(ui.host.textContent).toContain("No task is created or process enabled");
  expect(ui.approve).not.toHaveBeenCalled();
  expect(ui.deny).not.toHaveBeenCalled();
});
it("returns only the original stored fingerprint when the existing review is approved", () => {
  const ui = mount("original-stored-fingerprint");
  act(() => ui.button("Approve")!.click());
  expect(ui.approve).toHaveBeenCalledExactlyOnceWith(["original-stored-fingerprint"]);
  expect(ui.deny).not.toHaveBeenCalled();
});
it("retains the original Not now route instead of saving or enabling the draft", () => {
  const ui = mount("original-stored-fingerprint");
  act(() => ui.button("Not now")!.click());
  expect(ui.deny).toHaveBeenCalledExactlyOnceWith(["original-stored-fingerprint"]);
  expect(ui.approve).not.toHaveBeenCalled();
});
it("cannot turn a display preview into approval authority without its original binding", () => {
  const ui = mount();
  expect(ui.button("Approve")).toBeUndefined();
  expect(ui.approve).not.toHaveBeenCalled();
});
