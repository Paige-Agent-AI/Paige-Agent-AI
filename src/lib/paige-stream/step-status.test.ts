import { describe, expect, it } from "vitest";
import { normalizeStepStatus, settleOpenSteps } from "./index";

describe("normalizeStepStatus — one rule for every client", () => {
  it("passes the four lifecycle statuses through", () => {
    expect(["running", "done", "error", "withdrawn"].map(normalizeStepStatus)).toEqual(["running", "done", "error", "withdrawn"]);
  });
  it("a missing status is done (frames from before the lifecycle)", () => {
    expect(normalizeStepStatus(undefined)).toBe("done");
  });
  it("anything else — null included — is not drawn, never shown as done", () => {
    expect([null, "paused", "", "DONE", 1, {}].map(normalizeStepStatus)).toEqual([null, null, null, null, null, null]);
  });
});

describe("settleOpenSteps — the read ended", () => {
  it("drops what is still running and keeps the order of the rest", () => {
    const rows = [{ id: "a", status: "done" }, { id: "b", status: "running" }, { id: "c", status: "error" }];
    expect(settleOpenSteps(rows).map((r) => r.id)).toEqual(["a", "c"]);
  });
  it("returns the same array when nothing was open", () => {
    const rows = [{ id: "a", status: "done" }];
    expect(settleOpenSteps(rows)).toBe(rows);
  });
});
