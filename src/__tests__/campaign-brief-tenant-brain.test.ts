// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  executeVerifiedCampaignBriefMutation as executeImpl,
  resolveCampaignBriefListContext as resolveImpl,
  readCampaignBriefLeads as readLeadsImpl,
} from "../../supabase/functions/_shared/campaign-brief-tenant-brain";

const TENANT = "20000000-0000-4000-8000-000000000001";
const OTHER_TENANT = "20000000-0000-4000-8000-000000000002";
const ACTOR = "10000000-0000-4000-8000-000000000001";
const BRIEF = "30000000-0000-4000-8000-000000000001";
const KEY = "40000000-0000-4000-8000-000000000001";

type Response = { data: unknown; error: { message?: string } | null };
function port(responses: Record<string, Response | Response[] | "throw">) {
  const calls: Array<[string, Record<string, unknown>]> = [];
  const rpc = vi.fn(async (name: string, args: Record<string, unknown> = {}) => {
    calls.push([name, args]);
    const configured = responses[name];
    if (configured === "throw") throw new Error("transport");
    if (Array.isArray(configured)) {
      const next = configured.shift();
      if (!next) throw new Error(`No response left for ${name}`);
      return next;
    }
    if (!configured) throw new Error(`Unexpected RPC ${name}`);
    return configured;
  });
  return { rpc, calls };
}

const row = (overrides: Record<string, unknown> = {}) => ({
  id: BRIEF,
  short_ref: "CB-A1B2C3",
  name: "Fall Launch",
  objective: "Book 10 calls",
  audience: "Founder-led firms",
  positioning: "A focused advisory sprint",
  channels: ["email"],
  desired_outcome: "Ten qualified conversations",
  success_definition: "Ten calls booked",
  budget_target: null,
  timing: "Q4",
  constraints: "No paid media",
  content_needs: null,
  conversion_destination: null,
  followup_path: null,
  lifecycle_status: "draft",
  blocker: null,
  offer_id: null,
  offer_name: null,
  pipeline_id: null,
  pipeline_name: null,
  pipeline_deal_count: 0,
  mission_id: null,
  version: 1,
  created_through: "paige",
  created_at: "2026-09-07T12:00:00.000Z",
  updated_at: "2026-09-07T12:00:00.000Z",
  ...overrides,
});

const list = (briefs: unknown[], canManage = true): Response => ({
  data: { can_manage: canManage, archived_count: 0, briefs },
  error: null,
});

const execute = (input: Omit<Parameters<typeof executeImpl>[0], "expectedTenantId" | "actorId">) =>
  executeImpl({ expectedTenantId: TENANT, actorId: ACTOR, ...input });

describe("Solo Tenant Brain — Campaign Brief source context", () => {
  it("server-resolves the tenant and labels the canonical source, revision, lifecycle and freshness", async () => {
    const caller = port({
      current_user_tenant_id: { data: TENANT, error: null },
      get_campaign_briefs: list([row({ offer_name: "Growth Sprint", pipeline_name: "New Leads" })]),
    });
    const result = await resolveImpl({ caller, expectedTenantId: TENANT, observedAt: new Date("2026-09-07T12:05:00.000Z") });
    expect(result).toMatchObject({
      ok: true,
      tenantId: TENANT,
      context: {
        lane: "campaign_brief",
        canonicalSource: "public.get_campaign_briefs",
        observedAt: "2026-09-07T12:05:00.000Z",
        freshness: "current_canonical_projection",
        mindEligibility: "UNAVAILABLE",
        memoryRetention: "UNAVAILABLE",
      },
      briefs: [{ offerName: "Growth Sprint", pipelineName: "New Leads" }],
    });
    expect(caller.calls).toEqual([
      ["current_user_tenant_id", {}],
      ["get_campaign_briefs", { _tenant_id: TENANT }],
    ]);
  });

  it("fails closed before reading when the active workspace changed", async () => {
    const caller = port({ current_user_tenant_id: { data: OTHER_TENANT, error: null } });
    await expect(resolveImpl({ caller, expectedTenantId: TENANT })).resolves.toEqual({
      ok: false, code: "ACTIVE_ACCOUNT_CHANGED", tenantId: OTHER_TENANT,
    });
    expect(caller.calls).toHaveLength(1);
  });
});

describe("Solo Tenant Brain — verified Campaign Brief mutation", () => {
  it("creates on empty first use, re-reads version 1/draft and only then records Rail", async () => {
    const caller = port({
      current_user_tenant_id: [{ data: TENANT, error: null }, { data: TENANT, error: null }],
      get_campaign_briefs: [list([]), list([row()])],
      configure_campaign_brief: { data: { ok: true, outcome: "created", brief_id: BRIEF, version: 1 }, error: null },
    });
    const recordRun = vi.fn(async () => true);
    const result = await execute({
      caller, tool: "campaign_brief_create", recordRun,
      args: {
        idempotency_key: KEY, name: "Fall Launch", objective: "Book 10 calls",
        audience: "Founder-led firms", positioning: "A focused advisory sprint",
        channels: ["email"], desiredOutcome: "Ten qualified conversations",
        successDefinition: "Ten calls booked", timing: "Q4", constraints: "No paid media",
      },
      observedAt: new Date("2026-09-07T12:05:00.000Z"),
    });
    expect(result).toMatchObject({ success: true, verified: true, railRecorded: true, receipt: { source: "public.campaign_brief_command_results", runId: KEY } });
    expect(recordRun).toHaveBeenCalledWith({ tenantId: TENANT, actorId: ACTOR, capabilityKey: "campaign_brief_create", outcome: "capability_succeeded", runId: KEY });
    expect(caller.calls.map(([name]) => name)).toEqual([
      "current_user_tenant_id", "get_campaign_briefs", "configure_campaign_brief",
      "current_user_tenant_id", "get_campaign_briefs",
    ]);
  });

  it("revises one brief, preserves omitted fields, verifies the new version, then records Rail", async () => {
    const after = row({ objective: "Book 20 calls", version: 2, updated_at: "2026-09-07T12:06:00.000Z" });
    const caller = port({
      current_user_tenant_id: [{ data: TENANT, error: null }, { data: TENANT, error: null }],
      get_campaign_briefs: [list([row()]), list([after])],
      configure_campaign_brief: { data: { ok: true, outcome: "updated", brief_id: BRIEF, version: 2 }, error: null },
    });
    const recordRun = vi.fn(async () => true);
    const result = await execute({ caller, tool: "campaign_brief_revise", args: {
      idempotency_key: KEY, briefId: BRIEF, expectedVersion: 1, objective: "Book 20 calls",
    }, recordRun });
    expect(result).toMatchObject({ success: true, verified: true, railRecorded: true, brief: { sourceRef: BRIEF, revision: 2, lifecycleStatus: "draft" } });
    expect(recordRun).toHaveBeenCalledTimes(1);
  });

  it("supports an idempotent replay by verifying the already-current canonical version", async () => {
    const current = row({ objective: "Book 20 calls", version: 2 });
    const caller = port({
      current_user_tenant_id: [{ data: TENANT, error: null }, { data: TENANT, error: null }],
      get_campaign_briefs: [list([current]), list([current])],
      configure_campaign_brief: { data: { ok: true, outcome: "updated", brief_id: BRIEF, version: 2 }, error: null },
    });
    const recordRun = vi.fn(async () => true);
    await expect(execute({ caller, tool: "campaign_brief_revise", args: {
      idempotency_key: KEY, briefId: BRIEF, expectedVersion: 1, objective: "Book 20 calls",
    }, recordRun })).resolves.toMatchObject({ success: true, verified: true });
    expect(recordRun).toHaveBeenCalledTimes(1);
  });

  it("allows create replay only when the same actor's existing command receipt proves the same brief", async () => {
    const current = row();
    const caller = port({
      current_user_tenant_id: [{ data: TENANT, error: null }, { data: TENANT, error: null }],
      get_campaign_briefs: [list([current]), list([current])],
      configure_campaign_brief: { data: { ok: true, outcome: "created", brief_id: BRIEF, version: 1 }, error: null },
    });
    const recordRun = vi.fn(async () => true);
    const readCommandReceipt = vi.fn(async () => ({ ok: true, outcome: "created", brief_id: BRIEF, version: 1 }));
    await expect(execute({
      caller,
      tool: "campaign_brief_create",
      args: { idempotency_key: KEY, name: "Fall Launch", objective: "Book 10 calls", audience: "Founder-led firms", positioning: "A focused advisory sprint", channels: ["email"], desiredOutcome: "Ten qualified conversations", successDefinition: "Ten calls booked", timing: "Q4", constraints: "No paid media" },
      recordRun,
      readCommandReceipt,
    })).resolves.toMatchObject({ success: true, verified: true, railRecorded: true });
    expect(readCommandReceipt).toHaveBeenCalledWith({ tenantId: TENANT, actorId: ACTOR, idempotencyKey: KEY });
    expect(caller.calls.filter(([name]) => name === "configure_campaign_brief")).toHaveLength(1);
    expect(recordRun).toHaveBeenCalledTimes(1);
  });

  it("refuses duplicate canonical names before writing", async () => {
    const caller = port({
      current_user_tenant_id: { data: TENANT, error: null },
      get_campaign_briefs: list([row(), row({ id: "30000000-0000-4000-8000-000000000002", short_ref: "CB-D4E5F6" })]),
    });
    const recordRun = vi.fn(async () => true);
    const result = await execute({ caller, tool: "campaign_brief_revise", args: {
      idempotency_key: KEY, briefId: BRIEF, expectedVersion: 1, objective: "Changed",
    }, recordRun });
    expect(result).toMatchObject({ success: false, verified: false, code: "CAMPAIGN_BRIEF_AMBIGUOUS", options: ["CB-A1B2C3", "CB-D4E5F6"] });
    expect(caller.calls.map(([name]) => name)).not.toContain("configure_campaign_brief");
    expect(recordRun).not.toHaveBeenCalled();
  });

  it("refuses a revision that would rename a brief to another canonical brief's name", async () => {
    const other = row({
      id: "30000000-0000-4000-8000-000000000002",
      short_ref: "CB-D4E5F6",
      name: "Winter Launch",
    });
    const caller = port({
      current_user_tenant_id: { data: TENANT, error: null },
      get_campaign_briefs: list([row(), other]),
    });
    const recordRun = vi.fn(async () => true);
    const result = await execute({ caller, tool: "campaign_brief_revise", args: {
      idempotency_key: KEY, briefId: BRIEF, expectedVersion: 1, name: " winter launch ",
    }, recordRun });
    expect(result).toMatchObject({ success: false, verified: false, code: "CAMPAIGN_BRIEF_DUPLICATE_NAME", options: ["CB-D4E5F6"] });
    expect(caller.calls.map(([name]) => name)).not.toContain("configure_campaign_brief");
    expect(recordRun).not.toHaveBeenCalled();
  });

  it("requires clarification before creating a duplicate canonical name", async () => {
    const caller = port({
      current_user_tenant_id: { data: TENANT, error: null },
      get_campaign_briefs: list([row()]),
    });
    const recordRun = vi.fn(async () => true);
    const result = await execute({ caller, tool: "campaign_brief_create", args: {
      idempotency_key: KEY, name: "  fall launch  ", objective: "Different intent",
    }, recordRun });
    expect(result).toMatchObject({ success: false, verified: false, code: "CAMPAIGN_BRIEF_DUPLICATE_NAME", options: ["CB-A1B2C3"] });
    expect(caller.calls.map(([name]) => name)).not.toContain("configure_campaign_brief");
    expect(recordRun).not.toHaveBeenCalled();
  });

  it.each([
    ["non-array channels", { briefId: BRIEF, expectedVersion: 1, channels: "email" }],
    ["null field", { briefId: BRIEF, expectedVersion: 1, objective: null }],
    ["blank channel", { briefId: BRIEF, expectedVersion: 1, channels: ["email", "  "] }],
    ["blank revised name", { briefId: BRIEF, expectedVersion: 1, name: "   " }],
  ])("rejects malformed %s before reading or writing", async (_label, malformed) => {
    const caller = port({});
    const recordRun = vi.fn(async () => true);
    await expect(execute({ caller, tool: "campaign_brief_revise", args: {
      idempotency_key: KEY,
      ...malformed,
    }, recordRun })).resolves.toMatchObject({
      success: false,
      verified: false,
      code: "CAMPAIGN_BRIEF_ARGUMENTS_INVALID",
    });
    expect(caller.calls).toHaveLength(0);
    expect(recordRun).not.toHaveBeenCalled();
  });

  it.each([
    ["denied role", list([row()], false), "CAMPAIGN_BRIEF_FORBIDDEN"],
    ["missing or foreign record", list([]), "CAMPAIGN_BRIEF_NOT_FOUND"],
  ])("refuses %s before write and Rail", async (_label, read, code) => {
    const caller = port({ current_user_tenant_id: { data: TENANT, error: null }, get_campaign_briefs: read });
    const recordRun = vi.fn(async () => true);
    await expect(execute({ caller, tool: "campaign_brief_revise", args: {
      idempotency_key: KEY, briefId: BRIEF, expectedVersion: 1, objective: "Changed",
    }, recordRun })).resolves.toMatchObject({ success: false, verified: false, code });
    expect(caller.calls.map(([name]) => name)).not.toContain("configure_campaign_brief");
    expect(recordRun).not.toHaveBeenCalled();
  });

  it("passes a stale version to the governed RPC and reports its refusal without Rail", async () => {
    const caller = port({
      current_user_tenant_id: { data: TENANT, error: null }, get_campaign_briefs: list([row()]),
      configure_campaign_brief: { data: null, error: { message: "CAMPAIGN_BRIEF_VERSION_CONFLICT" } },
    });
    const recordRun = vi.fn(async () => true);
    await expect(execute({ caller, tool: "campaign_brief_revise", args: {
      idempotency_key: KEY, briefId: BRIEF, expectedVersion: 99, objective: "Changed",
    }, recordRun })).resolves.toMatchObject({ success: false, verified: false, mutationMayHavePersisted: false, code: "CAMPAIGN_BRIEF_VERSION_CONFLICT" });
    expect(recordRun).not.toHaveBeenCalled();
  });

  it("treats a thrown write as outcome unknown and does not read back or record Rail", async () => {
    const caller = port({ current_user_tenant_id: { data: TENANT, error: null }, get_campaign_briefs: list([row()]), configure_campaign_brief: "throw" });
    const recordRun = vi.fn(async () => true);
    await expect(execute({ caller, tool: "campaign_brief_revise", args: {
      idempotency_key: KEY, briefId: BRIEF, expectedVersion: 1, objective: "Changed",
    }, recordRun })).resolves.toMatchObject({ success: false, verified: false, mutationMayHavePersisted: true, code: "CAMPAIGN_BRIEF_WRITE_OUTCOME_UNKNOWN" });
    expect(recordRun).not.toHaveBeenCalled();
  });

  it("treats an unclassified RPC error as an unknown write outcome", async () => {
    const caller = port({
      current_user_tenant_id: { data: TENANT, error: null }, get_campaign_briefs: list([row()]),
      configure_campaign_brief: { data: null, error: { message: "upstream connection ended" } },
    });
    const recordRun = vi.fn(async () => true);
    await expect(execute({ caller, tool: "campaign_brief_revise", args: {
      idempotency_key: KEY, briefId: BRIEF, expectedVersion: 1, objective: "Changed",
    }, recordRun })).resolves.toMatchObject({ success: false, verified: false, mutationMayHavePersisted: true, code: "CAMPAIGN_BRIEF_WRITE_OUTCOME_UNKNOWN" });
    expect(recordRun).not.toHaveBeenCalled();
  });

  it("fails closed when the workspace changes after mutation", async () => {
    const caller = port({
      current_user_tenant_id: [{ data: TENANT, error: null }, { data: OTHER_TENANT, error: null }],
      get_campaign_briefs: list([row()]),
      configure_campaign_brief: { data: { ok: true, outcome: "updated", brief_id: BRIEF, version: 2 }, error: null },
    });
    const recordRun = vi.fn(async () => true);
    await expect(execute({ caller, tool: "campaign_brief_revise", args: {
      idempotency_key: KEY, briefId: BRIEF, expectedVersion: 1, objective: "Changed",
    }, recordRun })).resolves.toMatchObject({ success: false, verified: false, mutationMayHavePersisted: true, code: "ACTIVE_ACCOUNT_CHANGED" });
    expect(recordRun).not.toHaveBeenCalled();
  });

  it.each([
    ["missing readback", list([]), "CAMPAIGN_BRIEF_NOT_FOUND"],
    ["mismatched readback", list([row({ objective: "Wrong", version: 2 })]), "CAMPAIGN_BRIEF_READBACK_MISMATCH"],
  ])("does not claim success for %s", async (_label, postRead, code) => {
    const caller = port({
      current_user_tenant_id: [{ data: TENANT, error: null }, { data: TENANT, error: null }],
      get_campaign_briefs: [list([row()]), postRead],
      configure_campaign_brief: { data: { ok: true, outcome: "updated", brief_id: BRIEF, version: 2 }, error: null },
    });
    const recordRun = vi.fn(async () => true);
    await expect(execute({ caller, tool: "campaign_brief_revise", args: {
      idempotency_key: KEY, briefId: BRIEF, expectedVersion: 1, objective: "Changed",
    }, recordRun })).resolves.toMatchObject({ success: false, verified: false, mutationMayHavePersisted: true, code });
    expect(recordRun).not.toHaveBeenCalled();
  });

  it.each(["campaign_brief_create", "campaign_brief_revise"] as const)("repairs %s Rail evidence with one bounded retry using the same run id", async (tool) => {
    const creating = tool === "campaign_brief_create";
    const before = creating ? [] : [row()];
    const after = row({ objective: "Changed", version: creating ? 1 : 2 });
    const caller = port({
      current_user_tenant_id: [{ data: TENANT, error: null }, { data: TENANT, error: null }],
      get_campaign_briefs: [list(before), list([after])],
      configure_campaign_brief: { data: { ok: true, outcome: creating ? "created" : "updated", brief_id: BRIEF, version: creating ? 1 : 2 }, error: null },
    });
    const recordRun = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const args = creating
      ? {
          idempotency_key: KEY,
          name: "Fall Launch",
          objective: "Changed",
          audience: "Founder-led firms",
          positioning: "A focused advisory sprint",
          channels: ["email"],
          desiredOutcome: "Ten qualified conversations",
          successDefinition: "Ten calls booked",
          timing: "Q4",
          constraints: "No paid media",
        }
      : { idempotency_key: KEY, briefId: BRIEF, expectedVersion: 1, objective: "Changed" };
    await expect(execute({ caller, tool, args, recordRun })).resolves.toMatchObject({ success: true, verified: true, railRecorded: true });
    expect(recordRun).toHaveBeenCalledTimes(2);
    expect(recordRun.mock.calls[0][0].runId).toBe(KEY);
    expect(recordRun.mock.calls[1][0].runId).toBe(KEY);
    expect(caller.calls.filter(([name]) => name === "configure_campaign_brief")).toHaveLength(1);
  });

  it("does not report the end-to-end operation successful when Rail cannot be recorded", async () => {
    const after = row({ objective: "Changed", version: 2 });
    const caller = port({
      current_user_tenant_id: [{ data: TENANT, error: null }, { data: TENANT, error: null }],
      get_campaign_briefs: [list([row()]), list([after])],
      configure_campaign_brief: { data: { ok: true, outcome: "updated", brief_id: BRIEF, version: 2 }, error: null },
    });
    const recordRun = vi.fn(async () => false);
    await expect(execute({ caller, tool: "campaign_brief_revise", args: {
      idempotency_key: KEY, briefId: BRIEF, expectedVersion: 1, objective: "Changed",
    }, recordRun })).resolves.toMatchObject({
      success: false, verified: true, railRecorded: false, mutationMayHavePersisted: true,
      code: "CAMPAIGN_BRIEF_RAIL_WRITE_FAILED",
    });
    expect(recordRun).toHaveBeenCalledTimes(2);
  });
});

describe("Solo Tenant Brain — campaign leads read (S1e)", () => {
  const LEADS = {
    leads: [
      { submission_id: "50000000-0000-4000-8000-000000000001", attribution: "form_and_tag", contact_name: "A Real Person",
        pipeline_name: "QA lead", stage_label: "QA lead", deal_status: "open", processing_state: "done" },
    ],
    counts: { leads: 1, open: 1, won: 0, lost: 0, failed: 0 },
  };
  it("reads through the canonical RPC on the caller's session and returns leads, counts and context", async () => {
    const caller = port({
      current_user_tenant_id: { data: TENANT, error: null },
      get_campaign_brief_leads: { data: LEADS, error: null },
    });
    const result = await readLeads({ caller, briefId: BRIEF, observedAt: new Date("2026-10-24T12:00:00.000Z") });
    expect(result).toMatchObject({
      ok: true, tenantId: TENANT, briefId: BRIEF,
      context: { canonicalSource: "public.get_campaign_brief_leads", observedAt: "2026-10-24T12:00:00.000Z" },
      leads: LEADS.leads, counts: LEADS.counts,
    });
    expect(caller.calls).toEqual([
      ["current_user_tenant_id", {}],
      ["get_campaign_brief_leads", { _tenant_id: TENANT, _brief_id: BRIEF }],
    ]);
  });
  it("refuses the RPC's own forbidden verdict without rewriting it", async () => {
    const caller = port({
      current_user_tenant_id: { data: TENANT, error: null },
      get_campaign_brief_leads: { data: null, error: { message: 'CAMPAIGN_BRIEF_FORBIDDEN' } },
    });
    await expect(readLeads({ caller, briefId: BRIEF })).resolves.toEqual({
      ok: false, code: "CAMPAIGN_BRIEF_FORBIDDEN", tenantId: TENANT,
    });
  });
  it("maps a missing brief to the canonical NOT_FOUND refusal", async () => {
    const caller = port({
      current_user_tenant_id: { data: TENANT, error: null },
      get_campaign_brief_leads: { data: null, error: { message: 'CAMPAIGN_BRIEF_NOT_FOUND' } },
    });
    await expect(readLeads({ caller, briefId: BRIEF })).resolves.toEqual({
      ok: false, code: "CAMPAIGN_BRIEF_NOT_FOUND", tenantId: TENANT,
    });
  });
  it("fails closed before reading when the active workspace changed", async () => {
    const caller = port({ current_user_tenant_id: { data: OTHER_TENANT, error: null } });
    await expect(readLeads({ caller, briefId: BRIEF })).resolves.toEqual({
      ok: false, code: "ACTIVE_ACCOUNT_CHANGED", tenantId: OTHER_TENANT,
    });
    expect(caller.calls).toHaveLength(1);
  });
  it("refuses a malformed briefId without any RPC", async () => {
    const caller = port({});
    await expect(readLeads({ caller, briefId: "not-a-uuid" })).resolves.toEqual({
      ok: false, code: "CAMPAIGN_BRIEF_ARGUMENTS_INVALID",
    });
    expect(caller.calls).toHaveLength(0);
  });
  it("treats a transport failure as unknown, never as an empty answer", async () => {
    const caller = port({
      current_user_tenant_id: { data: TENANT, error: null },
      get_campaign_brief_leads: "throw",
    });
    await expect(readLeads({ caller, briefId: BRIEF })).resolves.toEqual({
      ok: false, code: "CAMPAIGN_BRIEF_LEADS_READ_OUTCOME_UNKNOWN", tenantId: TENANT,
    });
  });
  it("refuses a malformed readback instead of passing it through", async () => {
    const caller = port({
      current_user_tenant_id: { data: TENANT, error: null },
      get_campaign_brief_leads: { data: { leads: "nope" }, error: null },
    });
    await expect(readLeads({ caller, briefId: BRIEF })).resolves.toEqual({
      ok: false, code: "CAMPAIGN_BRIEF_READBACK_INVALID", tenantId: TENANT,
    });
  });
});

function readLeads(input: { caller: ReturnType<typeof port>; briefId: unknown; observedAt?: Date }) {
  return readLeadsImpl({ caller: input.caller, expectedTenantId: TENANT, briefId: input.briefId, observedAt: input.observedAt });
}
