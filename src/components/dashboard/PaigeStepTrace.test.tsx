/**
 * The step lifecycle (C2): an action can arrive first as "running" and close on the SAME id as
 * "done", "error" or "withdrawn". These pin the one reducer every chat surface shares, and the glyph
 * the trace draws for each status.
 *
 * EVIDENCE CLASS (§32/§70.1): automated, jsdom. Synthetic data only (§63).
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { StepTimeline, upsertStep, type PaigeStep, type PaigeStepFrame } from "./PaigeStepTrace";
import { settleOpenSteps } from "@/lib/paige-stream";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const step = (id: string, seq: number, label: string, status?: unknown): PaigeStepFrame => ({
  id, seq, round: 1, kind: "action", label, group: "owner", ...(status === undefined ? {} : { status }),
});
const fold = (frames: PaigeStepFrame[]) => frames.reduce<PaigeStep[]>((acc, f) => upsertStep(acc, f), []);

describe("upsertStep — the start/finish lifecycle", () => {
  it("a running step that closes as done is ONE row, done, keeping what the close left out", () => {
    const rows = fold([
      { ...step("a", 1, "Looking up Northwind", "running"), detail: "Contacts" },
      { id: "a", seq: 1, round: 1, label: "Looked up Northwind", group: "owner", status: "done" },
    ]);
    expect(rows).toEqual([{ id: "a", seq: 1, round: 1, kind: "action", label: "Looked up Northwind", group: "owner", status: "done", detail: "Contacts" }]);
  });

  it("a running step that closes as error is one row, error", () => {
    const rows = fold([step("a", 1, "Saving the form", "running"), step("a", 1, "Couldn't save the form", "error")]);
    expect(rows.map((s) => [s.id, s.status, s.label])).toEqual([["a", "error", "Couldn't save the form"]]);
  });

  it("withdrawn removes the row it started, and leaves the others", () => {
    const rows = fold([step("a", 1, "Read your goals", "done"), step("b", 2, "Checking the calendar", "running"), step("b", 2, "Checking the calendar", "withdrawn")]);
    expect(rows.map((s) => s.id)).toEqual(["a"]);
  });

  it("withdrawn for an id it never saw changes nothing", () => {
    const prev = fold([step("a", 1, "Read your goals", "done")]);
    expect(upsertStep(prev, step("zz", 9, "Never started", "withdrawn"))).toBe(prev);
  });

  it("a status this client does not know is ignored — never drawn, never shown as done", () => {
    const prev = fold([step("a", 1, "Looking up Northwind", "running")]);
    expect(upsertStep(prev, step("a", 1, "Looking up Northwind", "paused"))).toBe(prev);
    expect(upsertStep(prev, step("b", 2, "Something new", "queued"))).toBe(prev);
    expect(upsertStep(prev, step("b", 2, "Null is not missing", null))).toBe(prev);
    expect(prev[0].status).toBe("running");
  });

  it("a frame with NO status still means done (frames from before the lifecycle)", () => {
    const rows = fold([step("a", 1, "Read your goals")]);
    expect(rows).toEqual([{ id: "a", seq: 1, round: 1, kind: "action", label: "Read your goals", group: "owner", status: "done" }]);
  });

  it("still upserts by id in seq order", () => {
    const rows = fold([step("b", 2, "Second", "running"), step("a", 1, "First", "done"), step("b", 2, "Second", "done")]);
    expect(rows.map((s) => [s.id, s.status])).toEqual([["a", "done"], ["b", "done"]]);
  });
});

describe("settleOpenSteps — the read ended", () => {
  it("drops every step still running and keeps the rest", () => {
    const rows = fold([step("a", 1, "Read", "done"), step("b", 2, "Checking", "running"), step("c", 3, "Failed", "error"), step("d", 4, "Saving", "running")]);
    expect(settleOpenSteps(rows).map((s) => [s.id, s.status])).toEqual([["a", "done"], ["c", "error"]]);
  });

  it("returns the same array when nothing was open", () => {
    const rows = fold([step("a", 1, "Read", "done")]);
    expect(settleOpenSteps(rows)).toBe(rows);
  });
});

describe("StepTimeline draws the status it was given, and nothing it was not", () => {
  const mounted: Array<() => void> = [];
  afterEach(() => { while (mounted.length) mounted.pop()!(); });

  function draw(steps: PaigeStep[]) {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => { root.render(<StepTimeline steps={steps} />); });
    mounted.push(() => { act(() => root.unmount()); host.remove(); });
    return Array.from(host.querySelectorAll("li")).map((li) => li.querySelector("span")!.innerHTML);
  }

  it("running spins (static under reduced motion), done checks in success, error alerts in destructive", () => {
    const [running, done, error] = draw(fold([step("a", 1, "Checking", "running"), step("b", 2, "Read", "done"), step("c", 3, "Failed", "error")]));
    expect(running).toContain("animate-spin");
    expect(running).toContain("motion-safe:hidden");
    expect(running).not.toContain("--success");
    expect(done).toContain("--success");
    expect(error).toContain("--destructive");
  });

  it("a status it does not know draws no glyph — never the done check", () => {
    const [unknown] = draw([{ ...(step("a", 1, "Odd") as PaigeStep), status: "paused" as PaigeStep["status"] }]);
    expect(unknown).toBe("");
  });
});
