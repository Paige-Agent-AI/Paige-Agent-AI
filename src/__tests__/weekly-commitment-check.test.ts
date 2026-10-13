import { describe, it, expect } from "vitest";
import { adapterForAction } from "../../supabase/functions/_shared/paige-orchestration/adapters";
import { registeredSubjectTables } from "../../supabase/functions/_shared/paige-orchestration/subject-tenant";
import { nativeCapabilityBindingKeys } from "../../supabase/functions/_shared/paige-capability-status/gatherer";
import { stableRunId } from "../../supabase/functions/_shared/capability-record";
import { actReceiptRunSeed } from "../../supabase/functions/_shared/paige-orchestration/outcomes";
import { dispatchUnderClaim } from "../../supabase/functions/_shared/paige-orchestration/dispatch-claim";
import type { DispatchInput } from "../../supabase/functions/_shared/paige-orchestration/adapters";
import { readWeeklyCommitmentStatus } from "../../supabase/functions/_shared/paige-orchestration/weekly-commitment-chat";

describe("weekly commitment check enters the canonical engine", () => {
  it("has one native adapter and Gateway binding", () => {
    const adapter = adapterForAction("planning.weekly_commitment_check");
    expect(adapter?.kind).toBe("native");
    expect(adapter?.resolveCapability("planning.weekly_commitment_check")?.effect).toBe("read");
    expect(nativeCapabilityBindingKeys()).toContain("planning.weekly_commitment_check");
  });
  it("checks process-subject tenant integrity", () => {
    expect(registeredSubjectTables()).toContain("paige_automations");
  });
  it("refuses a fabricated subject before executing or reconciling", async () => {
    const adapter = adapterForAction("planning.weekly_commitment_check");
    expect(adapter).not.toBeNull();
    let calls = 0;
    const input = { tenantId: "tenant", actionKind: "planning.weekly_commitment_check", args: {},
      correlationRef: "correlation", subjectTable: "clients", subjectId: "client",
      db: { from: () => { throw new Error("no table read allowed"); }, rpc: async () => { calls++; return { data: null, error: null }; } } };
    expect((await adapter!.dispatch!(input)).outcome).toBe("failed");
    expect(calls).toBe(0);
  });
});

describe("subsequent-conversation readback handoff", () => {
  it("uses only the caller-JWT owner RPC; a new conversation reads saved last/next evidence", async () => {
    const saved = { ok: true, scope: "personal_planning_commitments", checks: [{ id: "same-process", last_run: { status: "unknown" }, next_run_at: null }] };
    const names: string[] = [];
    const caller = { rpc: async (name: string) => { names.push(name); return { data: saved, error: null }; } };
    expect(await readWeeklyCommitmentStatus(caller)).toEqual({ status: "available", source: "canonical_process_and_act_receipts", checks: saved });
    expect(await readWeeklyCommitmentStatus(caller)).toEqual({ status: "available", source: "canonical_process_and_act_receipts", checks: saved });
    expect(names).toEqual(["get_weekly_commitment_checks", "get_weekly_commitment_checks"]);
  });
  it("read errors do not become a false empty schedule or completed run", async () => {
    expect(await readWeeklyCommitmentStatus({ rpc: async () => ({ data: null, error: "held" }) }))
      .toEqual({ status: "unavailable", reason: "canonical_read_failed" });
  });
  it("a malformed canonical response cannot claim available readback", async () => {
    for (const data of [{ ok: false }, [], { ok: true, checks: [] }, { ok: true, scope: "tenant_wide", checks: [] }]) {
      expect(await readWeeklyCommitmentStatus({ rpc: async () => ({ data, error: null }) }))
        .toEqual({ status: "unavailable", reason: "canonical_read_failed" });
    }
  });
});

const adapter = adapterForAction("planning.weekly_commitment_check")!;
function input(rpc: DispatchInput["db"]["rpc"]): DispatchInput {
  return { tenantId: "tenant", actionKind: "planning.weekly_commitment_check", args: { arbitrary: "ignored" },
    correlationRef: "occurrence:act", subjectTable: "paige_automations", subjectId: "process",
    eventId: "event", actId: "act", db: { from: () => { throw new Error("no unscoped read"); }, rpc } };
}

describe("weekly observation evidence and recovery", () => {
  it("passes only canonical occurrence coordinates and the existing stable receipt identity", async () => {
    const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
    const receipt = await stableRunId(actReceiptRunSeed("event", "act"));
    const i = input(async (fn, args) => {
      calls.push({ fn, args });
      return { data: { outcome: "executed", detail: { confirmed_via: "weekly_commitment_observation", receipt_id: receipt } }, error: null };
    });
    expect((await adapter.dispatch!(i)).outcome).toBe("executed");
    expect(calls).toEqual([{ fn: "execute_weekly_commitment_check", args: {
      _automation_id: "process", _event_id: "event", _act_id: "act", _correlation: "occurrence:act", _receipt_id: receipt,
    } }]);
  });
  it("a 200 or observation without a durable receipt cannot claim completion", async () => {
    for (const data of [{}, { outcome: "executed" }, { outcome: "executed", detail: { confirmed_via: "weekly_commitment_observation" } }]) {
      expect((await adapter.dispatch!(input(async () => ({ data, error: null })))).outcome).toBe("ambiguous");
    }
  });
  it("reconciles a lost response through the read RPC without dispatching", async () => {
    const calls: string[] = [];
    const i = input(async (fn) => {
      calls.push(fn);
      if (fn === "execute_weekly_commitment_check") throw new Error("response lost after commit");
      return { data: { outcome: "executed", detail: { confirmed_via: "weekly_commitment_observation", receipt_id: "durable" } }, error: null };
    });
    expect((await adapter.dispatch!(i)).outcome).toBe("ambiguous");
    expect((await adapter.readback!(null, i)).outcome).toBe("executed");
    expect(calls).toEqual(["execute_weekly_commitment_check", "read_weekly_commitment_check"]);
  });
  it("readback failure and transport errors stay unknown; definitive SQL rejection fails", async () => {
    const transport = input(async () => ({ data: null, error: { code: "503", message: "unavailable" } }));
    expect((await adapter.dispatch!(transport)).outcome).toBe("ambiguous");
    expect((await adapter.readback!(null, transport)).outcome).toBe("ambiguous");
    const rejection = input(async () => ({ data: null, error: { code: "42501", message: "owner required" } }));
    expect((await adapter.dispatch!(rejection)).outcome).toBe("failed");
    expect((await adapter.readback!(null, rejection)).outcome).toBe("ambiguous");
  });
  it("accepted recovery requires explicit canonical absence proof", async () => {
    const safe = input(async () => ({ data: { outcome: "ambiguous", detail: { proven_absent: true } }, error: null }));
    expect((await adapter.readback!(null, safe)).detail?.proven_absent).toBe(true);
    const uncertain = input(async () => ({ data: { outcome: "ambiguous", detail: {} }, error: null }));
    expect((await adapter.readback!(null, uncertain)).detail?.proven_absent).toBe(false);
  });
  it("a held claim makes no execution call, and claimed IDs override caller-supplied IDs", async () => {
    const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
    let held = true;
    const i = input(async (fn, args) => {
      calls.push({ fn, args });
      if (fn === "paige_claim_act_dispatch") return { data: held ? null : { id: "claim-row" }, error: null };
      return { data: {}, error: null };
    });
    expect((await dispatchUnderClaim(i.db, "trusted-event", "trusted-act", adapter, i)).kind).toBe("held");
    expect(calls.map(c => c.fn)).toEqual(["paige_claim_act_dispatch"]);
    held = false;
    await dispatchUnderClaim(i.db, "trusted-event", "trusted-act", adapter, i);
    expect(calls.at(-1)?.args._event_id).toBe("trusted-event");
    expect(calls.at(-1)?.args._act_id).toBe("trusted-act");
  });
});
