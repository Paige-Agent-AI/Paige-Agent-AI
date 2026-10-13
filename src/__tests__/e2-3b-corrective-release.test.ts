// @vitest-environment node
// E2-3b — the corrective release for QA #2102's two failed points and two triage findings.
// Failing-first: every assertion fails on the pre-fix tree (verified by mutation locally).
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { salesMetricWindow } from "../../supabase/functions/_shared/paige-context/adapters/sales-metric.ts";
import type { SnapshotPeriod } from "../../supabase/functions/_shared/paige-context/snapshot.ts";
import { BUSINESS_SNAPSHOT_TOOLS, dispatchBusinessSnapshotChat } from "../../supabase/functions/_shared/paige-context/business-review-chat.ts";

const CHAT = fs.readFileSync(path.resolve(__dirname, "../../supabase/functions/paige-ai-chat/index.ts"), "utf8");
const TENANT = "d2000000-0000-4000-8000-0000000000e2";
const NOW = Date.UTC(2026, 9, 12, 15, 30);
const caller = {
  calls: [] as { name: string; args?: Record<string, unknown> }[],
  rpc(name: string, args?: Record<string, unknown>) {
    caller.calls.push({ name, args });
    if (name === "current_user_tenant_id") return Promise.resolve({ data: TENANT, error: null });
    return Promise.resolve({ data: null, error: { code: "42501" } });
  },
};

describe("E2-3b point 8 — the conversational action-refusal defect", () => {
  it("the action-intent exhaustion branch authors the truthful CONVERSATIONAL refusal, not the generic capability copy", () => {
    const i = CHAT.indexOf("isActionIntent && !claimAnswered");
    expect(i).toBeGreaterThan(0);
    const branch = CHAT.slice(i, i + 2600);
    expect(branch).toMatch(/const exhausted = interactiveConversational/);
    expect(branch).toMatch(/I can't create, change, send, schedule or delete anything in this conversation right now/);
    expect(branch).toMatch(/nothing was run, created or sent/);
    // And the generic copy is retained ONLY for non-conversational turns.
    expect(branch).toMatch(/: "I wasn't able to complete that request\./);
  });

  it("a conversational exhaustion is a COMPLETED answer, not a limit stop (no budgetStop, so the UI never says 'Reached the limit')", () => {
    const i = CHAT.indexOf("isActionIntent && !claimAnswered");
    const branch = CHAT.slice(i, i + 2600);
    expect(branch).toMatch(/if \(!interactiveConversational\) turnTracker\.budgetStop\(\);/);
  });

  it("the per-call conversational refusal teaches recovery in words", () => {
    expect(CHAT).toMatch(/Answer the owner in words: say plainly that actions are off in this conversation right now/);
  });
});

describe("E2-3b point 5 — the Sales reporting cutoff", () => {
  it("a completed sales window carries the cutoff as data: 'counted through the last completed UTC day'", () => {
    const period = (start: string, end: string): SnapshotPeriod =>
      ({ key: "last_7_days", start, end, timezone: "UTC", basis: "rolling", label: "last 7 days" } as unknown as SnapshotPeriod);
    const completed = salesMetricWindow(period("2026-10-05T00:00:00.000Z", "2026-10-12T00:00:00.000Z"), new Date(NOW));
    expect(completed?.window_note).toBe("counted through the last completed UTC day");
    const inProgress = salesMetricWindow(period("2026-10-06T00:00:00.000Z", "2026-11-13T00:00:00.000Z"), new Date(NOW));
    expect(inProgress?.window_note).toBe("counted up to just now; the period ends later");
  });

  it("the briefing contract requires stating the cutoff once when sales or pipeline figures appear", async () => {
    const r = await dispatchBusinessSnapshotChat(
      { who: { actorId: "a", tenantId: TENANT, role: "owner", accountShape: "solo" }, timezone: "UTC" },
      { caller }, {}, new Date(NOW));
    expect(r.message).toMatch(/Sales and pipeline figures are counted through the last completed UTC day, never up to this moment/);
    expect(r.message).toMatch(/when you narrate any of them, state that cutoff once, plainly/);
    expect(r.message).toMatch(/Current balances and Systems Check state are right now/);
  });
});

describe("E2-3b triage — duplicate user-row persistence", () => {
  it("the legacy user-append excludes conversational turns (whose user row begin_v2 already appends)", () => {
    const i = CHAT.indexOf("An answer's turn is appended once, as its claim");
    expect(i).toBeGreaterThan(0);
    const guard = CHAT.slice(i, i + 700);
    expect(guard).toMatch(/if \(!interactive && !interactiveConversational && !answerBinding/);
  });
});

describe("E2-3b triage — workspace pre-check scope correction (documented, no code)", () => {
  it("the acceptance package records the corrected evidence classes for the designated workspace", () => {
    const doc = fs.readFileSync(path.resolve(__dirname, "../../docs/delivery/e2-3-authenticated-first-briefing-acceptance.md"), "utf8");
    expect(doc).toMatch(/Corrected 2026-10-13/);
    expect(doc).toMatch(/matched the WRONG account|pre-check scope error/);
    expect(doc).toMatch(/0 pipelines, 0 deals, 0 clients/);
    expect(doc).toMatch(/were CORRECT for that\s+workspace/m);
  });
});
