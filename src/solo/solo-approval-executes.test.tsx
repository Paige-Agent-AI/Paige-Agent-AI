/**
 * Solo approvals actually execute — the regression battery for the shared approval card.
 *
 * WHAT THIS FILE ORIGINALLY CLAIMED, AND WHY THAT WAS WRONG (§13, kept rather than edited out).
 * It opened by blaming `src/solo/agent.tsx` + `useSoloChat.ts` for dropping the `paige_confirm`
 * frame. That reading of those two files was accurate and the conclusion was still wrong, because
 * THAT PAIR NEVER SHIPPED: nothing imported it, no route lazy-loaded it, and its unique strings
 * were absent from dist/assets while the live chat's were present. Both files are now deleted and
 * the assertions that read them with them. The live Solo chat is SoloPaigeWorkspace -> PaigeAIChat.
 *
 * The measured defect was real and its true cause is fixed elsewhere: the CRM approval door in
 * `paige-ai-chat` required the model to retype an approved create byte-for-byte, so any drift
 * refused it and nothing was created (see `src/__tests__/crm-approval-resolution.test.ts`).
 *
 * WHAT THIS FILE STILL GUARDS, on the live path:
 *  - the shared card cannot offer an approval it holds no binding for, and
 *  - PaigeAIChat keeps each summary PAIRED with its own fingerprint, so an approval can never be
 *    spent on a neighbouring call.
 *
 * The card is exercised BEHAVIOURALLY — really rendered, really clicked. Neither class stands in
 * for an authenticated runtime drive, which is owed.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import { PaigeConfirmCard, type ConfirmAction } from "@/components/chat/PaigeConfirmCard";


function render(node: React.ReactElement) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => { root.render(node); });
  return {
    host,
    text: () => host.textContent ?? "",
    buttons: () => Array.from(host.querySelectorAll("button")),
    button: (label: string) =>
      Array.from(host.querySelectorAll("button")).find((b) => (b.textContent ?? "").includes(label)),
    cleanup: () => { act(() => { root.unmount(); }); host.remove(); },
  };
}

const FP = "a1b2c3d4e5f60718:3f2504e0-4f89-11d3-9a0c-0305e82c3301";

describe("the card cannot offer an approval it has no binding for", () => {
  it("hands back the EXACT fingerprint of the action that was read", () => {
    const onApprove = vi.fn();
    const actions: ConfirmAction[] = [{ summary: "Add John Coleman to your contacts", fingerprint: FP }];
    const ui = render(
      <PaigeConfirmCard actions={actions} onApprove={onApprove} onDeny={vi.fn()} />,
    );

    const approve = ui.button("Approve");
    expect(approve).toBeTruthy();
    act(() => { approve!.click(); });

    // Not "a boolean is now true" — this precise stored call, and nothing else.
    expect(onApprove).toHaveBeenCalledWith([FP]);
    ui.cleanup();
  });

  it("renders NO approve control at all when no action carries a fingerprint", () => {
    // THE BITE. Restoring the old optional-`fingerprints` shape — a live Approve button with
    // nothing behind it — makes this fail. That button is what the owner pressed eight times.
    const onApprove = vi.fn();
    const ui = render(
      <PaigeConfirmCard
        actions={[{ summary: "Send the research email to Lavelle" }]}
        onApprove={onApprove}
        onDeny={vi.fn()}
      />,
    );

    expect(ui.button("Approve")).toBeUndefined();
    expect(ui.buttons()).toHaveLength(0);
    // …and it says so ONCE, rather than leaving a person to discover it by pressing. When nothing
    // is approvable the card-level line carries it; repeating it per row reads as a stutter.
    expect(ui.text()).toContain("can’t complete approvals");
    expect(ui.text()).not.toContain("Can’t be approved from this chat.");
    expect(onApprove).not.toHaveBeenCalled();
    ui.cleanup();
  });

  it("names where the decision can be completed when one is supplied", () => {
    const ui = render(
      <PaigeConfirmCard
        actions={[{ summary: "Create the deal" }]}
        onApprove={vi.fn()}
        onDeny={vi.fn()}
        cannotApproveHere="Open Paige in your workspace to approve this."
      />,
    );
    expect(ui.text()).toContain("Open Paige in your workspace to approve this.");
    ui.cleanup();
  });

  it("approves only the bound actions in a mixed batch, and says how many it could not", () => {
    const onApprove = vi.fn();
    const ui = render(
      <PaigeConfirmCard
        actions={[
          { summary: "Add John Coleman", fingerprint: FP },
          { summary: "Email the offer letter" },
        ]}
        onApprove={onApprove}
        onDeny={vi.fn()}
      />,
    );

    act(() => { ui.button("Approve")!.click(); });
    expect(onApprove).toHaveBeenCalledWith([FP]);
    expect(ui.text()).toContain("1 of 2 can’t be approved here.");
    ui.cleanup();
  });

  it("reports the outcome instead of vanishing, and offers no second approval once settled", () => {
    const ui = render(
      <PaigeConfirmCard
        actions={[{ summary: "Add John Coleman", fingerprint: FP, state: "done" }]}
        onApprove={vi.fn()}
        onDeny={vi.fn()}
      />,
    );
    expect(ui.text()).toContain("Done");
    expect(ui.button("Approve")).toBeUndefined();
    ui.cleanup();
  });

  it("surfaces a failure with its reason rather than a silent disappearance", () => {
    const ui = render(
      <PaigeConfirmCard
        actions={[{ summary: "Send the agreement", fingerprint: FP, state: "failed", note: "The sending domain isn't verified yet." }]}
        onApprove={vi.fn()}
        onDeny={vi.fn()}
      />,
    );
    expect(ui.text()).toContain("Didn't run");
    expect(ui.text()).toContain("The sending domain isn't verified yet.");
    ui.cleanup();
  });
});

describe("an approval cannot land on a neighbouring call", () => {
  it("keeps summary and fingerprint PAIRED in the live chat", () => {
    // The old caller built two arrays and filtered one, shifting every later summary onto the
    // wrong fingerprint. This is the LIVE surface: SoloPaigeWorkspace renders PaigeAIChat.
    const chat = readFileSync("src/components/dashboard/PaigeAIChat.tsx", "utf8");
    expect(chat).not.toContain("fingerprints={message.confirm.map((c) => c.fingerprint).filter(");
    expect(chat).toContain("actions={message.confirm.map((c) => ({");
  });

  it("is reached from the Solo workspace, not from a file nothing mounts (§71.1)", () => {
    const workspace = readFileSync("src/solo/SoloPaigeWorkspace.tsx", "utf8");
    expect(workspace).toContain('from "@/components/dashboard/PaigeAIChat"');
  });
});
