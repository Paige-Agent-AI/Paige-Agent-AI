import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, it, expect } from "vitest";
import { SyncStatusPanel } from "./SyncStatusPanel";

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
    const { container } = render(<SyncStatusPanel syncStatus={{ success: false, error: sentence }} />);
    expect(container.textContent).toContain("Sync Incomplete");
    expect(container.textContent).toContain(sentence);
    expect(container.querySelectorAll(".text-destructive").length).toBeGreaterThan(0);
  });

  /**
   * R3b — the person who uploaded the report reads a sentence, never a pipeline step. A server that
   * still sends one (an older deployment, a stale tab) must not have it drawn.
   */
  it("never shows a step name or an 'Error:' label", () => {
    const status = { success: false, error: "I read your report, but I couldn't finish pulling out its details for you to review.", step: "extraction_parse" };
    const { container } = render(<SyncStatusPanel syncStatus={status as never} />);
    expect(container.textContent).not.toContain("extraction_parse");
    expect(container.textContent).not.toContain("step");
    expect(container.textContent).not.toContain("Error:");
    expect(container.textContent).toContain("I read your report, but I couldn't finish pulling out its details for you to review.");
  });

  it("leaves a genuine success looking like a success", () => {
    const { container } = render(
      <SyncStatusPanel syncStatus={{ success: true, scores_synced: { equifax: 700 }, credit_factors_recalculated: true }} />,
    );
    expect(container.textContent).toContain("Profile Sync Complete");
  });
});
