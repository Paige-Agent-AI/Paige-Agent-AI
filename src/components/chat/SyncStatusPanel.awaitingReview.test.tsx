import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, it, expect } from "vitest";
import { SyncStatusPanel, SYNC_FAILURE_FALLBACK } from "./SyncStatusPanel";
import { syncStatusForClient } from "../../../supabase/functions/_shared/client-seat-reply.ts";

/** Mount into a real DOM, the way the other component tests here do — this repo has no
 *  @testing-library/react, and assertions must be on rendered output rather than on source. */
function render(node: React.ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => { root.render(node); });
  return { container };
}

/**
 * A document read that produced a PROPOSAL is not a failed sync. It arrives with `success: false`,
 * because nothing was written and this panel's other readers are entitled to that — but the
 * failure treatment must not be applied to it.
 *
 * These assert on the rendered DOM rather than on the source, because the defect was entirely in
 * what a person saw: six red crosses and the word "Error:" over an outcome that had worked.
 */
describe("SyncStatusPanel — an extraction waiting on a person", () => {
  const awaiting = {
    success: false,
    awaiting_review: true,
    error: "I've read the report and pulled out what I found. Nothing has been saved yet.",
  };

  it("does not call it a failed sync", () => {
    const { container } = render(<SyncStatusPanel syncStatus={awaiting} />);
    expect(container.textContent).not.toContain("Sync Incomplete");
    expect(container.textContent).not.toContain("Error:");
  });

  it("does not draw the six failure rows", () => {
    const { container } = render(<SyncStatusPanel syncStatus={awaiting} />);
    expect(container.textContent).not.toContain("Negative items synced");
    expect(container.textContent).not.toContain("Funding readiness updated");
    expect(container.querySelectorAll(".text-destructive").length).toBe(0);
  });

  it("still shows the sentence, because on the portal this panel is the only thing that does", () => {
    const { container } = render(<SyncStatusPanel syncStatus={awaiting} />);
    expect(container.textContent).toContain("Nothing has been saved yet");
  });

  /**
   * The guard against over-correcting: a REAL sync failure must keep its failure treatment. Without
   * this, making the awaiting case quiet could be done by making every case quiet.
   */
  it("leaves a genuine failure looking like a failure", () => {
    const sentence = "I read your report, but I couldn't finish pulling out its details for you to review. You can ask Northside Fitness to take a look.";
    const { container } = render(<SyncStatusPanel syncStatus={{ success: false, uploader_sentence: true, error: sentence }} />);
    expect(container.textContent).toContain("Sync Incomplete");
    expect(container.textContent).toContain(sentence);
    expect(container.querySelectorAll(".text-destructive").length).toBeGreaterThan(0);
  });

  /**
   * R3b — the person who uploaded the report reads a sentence, never the pipeline's own text or a step.
   * A frame from an older server (a portal deployed before its chat server, a failed Edge deploy)
   * carries exactly that, with a step and without one (the old handler's catch sent none), so the panel
   * draws only text the server marks as written for the uploader and replaces anything else.
   */
  it("never draws an older server's pipeline text or step, with or without a step", () => {
    for (const legacy of [
      { success: false, error: "Failed to parse extracted data", step: "extraction_parse" },
      { success: false, error: "Validation failed: negative_items[0].account_type must be one of revolving", step: "validation" },
      { success: false, error: "TypeError: cannot read properties of undefined (reading 'id')" },
    ]) {
      const { container } = render(<SyncStatusPanel syncStatus={legacy as never} />);
      const text = container.textContent ?? "";
      expect(text).toContain("Sync Incomplete");
      expect(text).toContain(SYNC_FAILURE_FALLBACK);
      expect(text).not.toContain(legacy.error);
      expect(text).not.toMatch(/extraction_parse|validation|step|Error:|TypeError/);
    }
  });

  it("draws the sentence a current server marks as written for the uploader", () => {
    const frame = syncStatusForClient({ success: false, step: "extraction_parse" }, "Northside Fitness") as never;
    const { container } = render(<SyncStatusPanel syncStatus={frame} />);
    expect(container.textContent).toContain("I read your report, but I couldn't pull out its details for you to review, and none of them were added to your profile.");
    expect(container.textContent).not.toContain(SYNC_FAILURE_FALLBACK);
  });

  it("falls back to the server's own did-not-finish sentence, without a business name", () => {
    expect(SYNC_FAILURE_FALLBACK).toBe((syncStatusForClient({ success: false, step: "pipeline" }) as { error: string }).error);
  });

  it("leaves a genuine success looking like a success", () => {
    const { container } = render(
      <SyncStatusPanel syncStatus={{ success: true, scores_synced: { equifax: 700 }, credit_factors_recalculated: true }} />,
    );
    expect(container.textContent).toContain("Profile Sync Complete");
  });
});
