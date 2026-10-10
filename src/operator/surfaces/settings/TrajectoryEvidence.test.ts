import { describe, expect, it } from "vitest";
import { syntheticTrajectory as task } from "@/test/fixtures/trajectory";
import { trajectoryResult, trajectoryTimeline } from "./TrajectoryEvidence";
describe("Task evidence presentation", () => {
  it.each([['failed','Failed'],['cancelled','Cancelled'],['blocked','Blocked'],['expired','Reconciliation required'],['outcome_unknown','Reconciliation required']])("preserves recorded %s despite a model success", (work_state,label) => {
    expect(trajectoryResult({ ...task,work_state })).toBe(label);
  });
  it("requires current server verification, scope and a supported terminal condition", () => {
    expect(trajectoryResult(task)).toBe("Artifact creation verified");
    expect(trajectoryResult({ ...task,terminal_verified:false })).toBe("Terminal outcome unverified");
    expect(trajectoryResult({ ...task,scope_consistent:false })).toBe("Terminal outcome unverified");
    expect(trajectoryResult({ ...task,terminal_condition:'unavailable' })).toBe("Terminal outcome unverified");
    expect(trajectoryResult({ ...task,receipt_conflict:true })).toBe("Conflicting receipts");
    expect(trajectoryResult({ ...task,terminal_condition:'read_only' })).toBe("Read result verified");
  });
  it("separates acceptance, dispatch, execution, receipts and current readback", () => {
    const timeline=trajectoryTimeline(task,"2026-10-10T12:05:00Z");
    expect(timeline.map(e=>e.kind)).toEqual(expect.arrayContaining(['Work observation','Model call','Capability decision','Tool dispatch','Execution outcome','Approval record','Canonical receipt','Linked conversation turn','Current server readback']));
    expect(timeline.at(-1)?.label).toBe("Artifact creation verified");
    expect(timeline.find(e=>e.kind==='Model call')?.label).toContain("attempt attribution unavailable");
    expect(timeline.find(e=>e.kind==='Tool dispatch')?.label).toContain("does not establish execution");
    expect(timeline.map(e=>Date.parse(e.at))).toEqual(timeline.map(e=>Date.parse(e.at)).sort((a,b)=>a-b));
  });
});
