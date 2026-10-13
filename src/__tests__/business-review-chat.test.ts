// @vitest-environment node
// E2-1 — the business operating snapshot from chat: tool registration, dispatch behavior, and the
// wiring pins that keep the ship-dark integration honest (read-only, owner/admin seat, sequential
// corridor, step-start flip). Failing-first: every protective assertion below was written against
// the unwired main state and fails there (no dispatch branch, "no dispatch" step-start, no spine
// entry, no tool).
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  BUSINESS_SNAPSHOT_TOOLS, dispatchBusinessSnapshotChat,
} from "../../supabase/functions/_shared/paige-context/business-review-chat.ts";
import {
  BUSINESS_OPERATING_SNAPSHOT, BUSINESS_OPERATING_SNAPSHOT_READ_CAPABILITY,
} from "../../supabase/functions/_shared/paige-spine/domains/business-review.ts";
import { PAIGE_SPINE_CAPABILITIES } from "../../supabase/functions/_shared/paige-spine/registry.ts";
import { STEP_START_LABELS, STEP_NO_START } from "../../supabase/functions/_shared/paige-turn/step-start.ts";
import type { BusinessReviewWho } from "../../supabase/functions/_shared/paige-context/business-review.ts";

const TENANT = "d2000000-0000-4000-8000-0000000000e2";
const CHAT_SOURCE = fs.readFileSync(
  path.resolve(__dirname, "../../supabase/functions/paige-ai-chat/index.ts"), "utf8",
);
const WHO: BusinessReviewWho = { actorId: "e2-owner", tenantId: TENANT, role: "owner", accountShape: "solo" };
// 2026-10-12T15:30:00Z, a fixed clock.
const NOW = Date.UTC(2026, 9, 12, 15, 30);

/** A caller-session double. The issuer refuses everything; the composer reports the domains honestly. */
function fakeCaller(opts: { tenant?: string | null } = {}) {
  const calls: { name: string; args?: Record<string, unknown> }[] = [];
  const tenant = opts.tenant === undefined ? TENANT : opts.tenant;
  return {
    calls,
    rpc: (name: string, args?: Record<string, unknown>) => {
      calls.push({ name, args });
      if (name === "current_user_tenant_id") return Promise.resolve({ data: tenant, error: null });
      // A Postgres-level refusal shape on every issuer read: domains degrade honestly, never zero.
      return Promise.resolve({ data: null, error: { code: "42501" } });
    },
  };
}
const dispatch = (args: unknown, timezone = "UTC", caller = fakeCaller()) =>
  dispatchBusinessSnapshotChat({ who: WHO, timezone }, { caller }, args, new Date(NOW));

describe("E2-1 registration", () => {
  it("pushes exactly one chat tool named get_business_snapshot whose parameters are the registered capability's input", () => {
    expect(BUSINESS_SNAPSHOT_TOOLS).toHaveLength(1);
    const tool = BUSINESS_SNAPSHOT_TOOLS[0].function;
    expect(tool.name).toBe("get_business_snapshot");
    expect(tool.parameters).toEqual(JSON.parse(JSON.stringify(BUSINESS_OPERATING_SNAPSHOT_READ_CAPABILITY.input)));
  });

  it("registers business.operating_snapshot as a read-only, workspace-admin-seat spine capability", () => {
    const entry = PAIGE_SPINE_CAPABILITIES.find((c) => c.key === "business.operating_snapshot");
    expect(entry).toBeDefined();
    expect(entry!.action!.classification).toBe("read");
    expect(entry!.action!.riskPolicyKey).toBe("read_only");
    expect(entry!.action!.approvalAuthority).toBe("none");
    expect(entry!.action!.chatTool).toBe("get_business_snapshot");
    // Owner ruling (E2-1 order 3): full COO snapshots stay owner/admin-only — the seat declaration
    // matches the issuer's in-body owner/admin check.
    expect(entry!.action!.seatAuthority).toBe("workspace-admin");
    // E2-2: LIVE once the ANT-23 read-only admission admits the tool to conversational turns.
    expect(entry!.chatBinding).toBe("LIVE");
  });

  it("binds the spine executor to the INT-340 issuer seam, not a chat-only path", () => {
    expect(BUSINESS_OPERATING_SNAPSHOT.action!.executor).toBe("public.issue_analytics_evidence_bundle");
  });
});

describe("E2-3a briefing narrative contract", () => {
  it("#2102 narrates Sales' last completed UTC day cutoff without replacing current balance freshness", async () => {
    const d = BUSINESS_SNAPSHOT_TOOLS[0].function.description;
    const r = await dispatch({});
    for (const text of [d, r.message]) {
      expect(text).toMatch(/When presenting Sales evidence, explicitly state.*last completed UTC day/);
      expect(text).toMatch(/current receivables balances.*as of now/);
      expect(text).toMatch(/period headline.*does not replace.*cutoff/);
    }
  });
  // The owner's required answer shape for "how's my business doing, what needs attention, and
  // what should we work on today?": accurate evidence, source freshness, meaningful priorities,
  // appropriate recommendations, and missing information identified — never invented. The contract
  // lives in the two model-facing surfaces (tool description + result guidance); these pins bite
  // (mutation-proven: removing any clause turns its assertion red).
  it("the tool description promises the briefing structure: picture, attention (act before watch), supported next steps, unmeasured named", () => {
    const d = BUSINESS_SNAPSHOT_TOOLS[0].function.description;
    expect(d).toMatch(/answer as a briefing/);
    expect(d).toMatch(/act-level risks.*before its watch-level ones/);
    expect(d).toMatch(/one to three practical next steps that the cited figures actually support/);
    expect(d).toMatch(/what could not be measured and why/);
  });

  it("the result guidance carries the full narration order and every honesty rule", async () => {
    const r = await dispatch({});
    const m = r.message;
    // The four-part order.
    expect(m).toMatch(/\(1\) the overall picture for the period/);
    expect(m).toMatch(/\(2\) what needs attention — every act-level risk first, then watch-level/);
    expect(m).toMatch(/\(3\) one to three practical next steps/);
    expect(m).toMatch(/\(4\) what could not be measured, named by area/);
    // Freshness, priorities and the not-invented rules.
    expect(m).toMatch(/the window note the review gives/);
    expect(m).toMatch(/Priorities follow the risk levels the review assigns, never your own ranking/);
    expect(m).toMatch(/money at risk and failed runs outrank plain counts/);
    expect(m).toMatch(/never estimate, never sum currencies/);
    expect(m).toMatch(/a real zero is different from not-available/);
    expect(m).toMatch(/say it needs setup rather than implying the data exists/);
  });
});

describe("E2-1 dispatch behavior", () => {
  it("returns the composer's bounded projection as an available read with no-action-authority guidance", async () => {
    const r = await dispatch({});
    expect(r.status).toBe("available");
    expect(typeof r.projection).toBe("string");
    expect(r.projection!.length).toBeGreaterThan(0);
    expect(r.message).toMatch(/no action authority/i);
  });

  it("refuses an unknown period as needs_input with a fix, and reads nothing", async () => {
    const caller = fakeCaller();
    const r = await dispatch({ period: "since_forever" }, "UTC", caller);
    expect(r.status).toBe("needs_input");
    expect(r.message).toMatch(/period must be one of/i);
    expect(r.message).toMatch(/Nothing was read/i);
    expect(caller.calls).toEqual([]);
  });

  it("refuses an unknown caller timezone as needs_input rather than silently substituting UTC", async () => {
    const r = await dispatch({}, "Mars/Olympus");
    expect(r.status).toBe("needs_input");
    expect(r.message).toMatch(/timezone/i);
  });

  it("requires custom bounds together and rejects unknown argument keys", async () => {
    const onlyStart = await dispatch({ period: "custom", custom_start: "2026-10-01" });
    expect(onlyStart.status).toBe("needs_input");
    expect(onlyStart.message).toMatch(/custom_start and custom_end/);
    const extra = await dispatch({ metric_key: "sales.pipeline.open_value" });
    expect(extra.status).toBe("needs_input");
    expect(extra.message).toMatch(/Only period, custom_start, custom_end and focus/i);
  });

  it("computes the period in the caller's timezone, not the model's (America/New_York midnight ≠ UTC midnight)", async () => {
    const caller = fakeCaller();
    const r = await dispatch({ period: "today" }, "America/New_York", caller);
    expect(r.status).toBe("available");
    const issued = caller.calls.filter((c) => c.name === "issue_analytics_evidence_bundle");
    expect(issued.length).toBeGreaterThan(0);
    const start = Date.parse(String(issued[0].args!.p_range_start));
    // 'today' in New York starts at 2026-10-12T00:00-04:00 = 2026-10-12T04:00:00Z — four hours after UTC midnight.
    expect(start).toBe(Date.UTC(2026, 9, 12, 4, 0, 0));
  });

  it("degrades honestly when the caller's reads throw: an available review whose reads refused, no crash, no error text", async () => {
    const throwing = {
      calls: [] as { name: string }[],
      rpc: (name: string) => {
        throwing.calls.push({ name });
        if (name === "current_user_tenant_id") return Promise.resolve({ data: TENANT, error: null });
        return Promise.reject(new Error("secret internal detail PGRST-17000"));
      },
    };
    const r = await dispatchBusinessSnapshotChat({ who: WHO, timezone: "UTC" }, { caller: throwing }, {}, new Date(NOW));
    // The composer is total: a failure is a domain reason inside the review, never a crash and
    // never a fabricated zero.
    expect(r.status).toBe("available");
    expect(r.projection).toMatch(/not available|could not be read|refused/i);
    expect(r.projection).not.toMatch(/PGRST|secret internal/);
  });
});

describe("E2-1 wiring pins (source contracts)", () => {
  it("offers the tool only inside the tenant-lens push, beside the metric read", () => {
    expect(CHAT_SOURCE).toMatch(/if \(callerTier === "tenant"\) toolDefs\.push\(\.\.\.BUSINESS_METRIC_TOOLS\);/);
    expect(CHAT_SOURCE).toMatch(/if \(callerTier === "tenant"\) toolDefs\.push\(\.\.\.BUSINESS_SNAPSHOT_TOOLS\);/);
  });

  it("dispatches through the shared module on the caller's own session with the turn's timezone", () => {
    expect(CHAT_SOURCE).toMatch(/tc\.function\.name === "get_business_snapshot"/);
    expect(CHAT_SOURCE).toMatch(/dispatchBusinessSnapshotChat\(/);
    expect(CHAT_SOURCE).toMatch(/timezone: userTimezone \?\? "UTC"/);
    expect(CHAT_SOURCE).toMatch(/caller: supabaseClient/);
  });

  it("keeps the non-tenant refusal honest (Solo workspace lens only, pending a widening ruling)", () => {
    const branch = CHAT_SOURCE.match(/tc\.function\.name === "get_business_snapshot"[\s\S]{0,2200}?update_client_data/);
    expect(branch).not.toBeNull();
    expect(branch![0]).toMatch(/callerTier === "tenant"/);
    expect(branch![0]).toMatch(/available only in the authorized Solo workspace lens/);
  });

  it("announces the read at START (label present, 'no dispatch' entry gone)", () => {
    expect(STEP_START_LABELS["get_business_snapshot"]).toBe("Taking stock of your business");
    expect(STEP_NO_START["get_business_snapshot"]).toBeUndefined();
  });

  it("describeStep carries an honest failed variant for the snapshot", () => {
    expect(CHAT_SOURCE).toMatch(/case "get_business_snapshot": return \{ label: failed \? "Couldn't take stock of your business" : "Taking stock of your business", group: "shared" \};/);
  });
});
