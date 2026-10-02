/**
 * C2 — the truthful working lifecycle.
 *
 * Production complaint (2026-10-01): "when you make a short statement you don't 1. Show that
 * you are still working and 2. Actually bring up the card in the chat box like I requested."
 * The owner had to send another message to see a card that had been minted mid-stream.
 *
 * Root cause: the approval-card render gate carries `!isLoading`, hiding every card until the
 * stream ends. With C1's continuation loop keeping the stream alive through the task lifecycle,
 * this gate now hides cards for the entire duration of a multi-round task.
 *
 * This suite pins:
 *  - approval cards render MID-STREAM (the isLoading gate is gone from the card render);
 *  - the card stays visible after the stream ends (no re-hide on [DONE]);
 *  - the working indicator is tied to the stream lifecycle (which, post-C1, IS the task
 *    lifecycle — the continuation loop keeps the stream open until a terminal state);
 *  - no stuck working state: the indicator clears on every exit path.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

const root = join(__dirname, "..", "..");
const ui = readFileSync(join(root, "src/components/dashboard/PaigeAIChat.tsx"), "utf8");

describe("approval cards render immediately when minted", () => {
  it("the card render gate does NOT require the stream to be idle", () => {
    // The FULL gate line: find the confirm render condition and check it has no !isLoading.
    // (The lazy [^)]*? regex can stop at an inner paren; match the whole gate instead.)
    const line = ui.split("\n").find((l) => l.includes("message.confirm?.length && !message.confirmResolved"));
    expect(line).toBeTruthy();
    expect(line!).not.toContain("!isLoading");
  });

  it("the card's Approve is available mid-stream (clicking it supersedes the model's turn)", () => {
    // The disabled prop on the card must not gate on isLoading either.
    const disabledMatch = ui.match(/disabled=\{[^}]*composerSendBlocked[^}]*\}/);
    if (disabledMatch) {
      expect(disabledMatch![0]).not.toContain("isLoading");
    }
  });
});

describe("the working indicator is truthful", () => {
  it("clears on every exit path — the fence release runs in finally as a safety net", () => {
    // The streamTurn's finally block (the LAST one in the file) carries releaseRequestBusy
    // (idempotent via the fence check), catching any exit path that missed it.
    const lastFinally = ui.lastIndexOf("} finally {");
    expect(lastFinally).toBeGreaterThan(0);
    const finallyBlock = ui.slice(lastFinally, lastFinally + 600);
    expect(finallyBlock).toContain("releaseRequestBusy(requestTicket)");
  });

  it("the working label shows the task's latest step, not a generic 'thinking'", () => {
    expect(ui).toContain("workingLabel={steps.at(-1)?.label");
  });

  it("abortActiveRequest clears the loading state", () => {
    expect(ui).toMatch(/abortActiveRequest[\s\S]{0,200}setIsLoading\(false\)/);
  });
});

describe("the card does not re-hide after the stream ends", () => {
  it("the confirmDecision gate is NOT tied to isLoading", () => {
    // The settled-record render (confirmDecision) must not have an isLoading condition.
    const decisionMatch = ui.match(/message\.confirmDecision[\s\S]{0,300}PaigeConfirmRecord/);
    if (decisionMatch) {
      expect(decisionMatch![0]).not.toContain("isLoading");
    }
  });
});
