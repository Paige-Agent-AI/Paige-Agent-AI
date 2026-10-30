// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  executeVerifiedCampaignBriefMutation as executeImpl,
  resolveCampaignBriefListContext as resolveImpl,
  readCampaignBriefLeads as readLeadsImpl,
  readCampaignBriefAssets as readAssetsImpl,
  executeVerifiedCampaignAssetMutation as assetMutationImpl,
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
  executeImpl({ expectedTenantId: TENANT, actorId: ACTOR,
    ...(input.tool==="campaign_brief_transition"?{readCommandReceipt:"receipt" in input.caller?input.caller.receipt as NonNullable<Parameters<typeof executeImpl>[0]["readCommandReceipt"]>:async()=>null}:{}),...input });

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

describe("original campaign lifecycle writer through the verified domain adapter",()=>{
  const transitionTool="campaign_brief_transition";
  const args={idempotency_key:KEY,briefId:BRIEF,expectedVersion:1,status:"approved"};
  function setup(after=row({lifecycle_status:"approved",version:2}),write:Record<string,unknown>={ok:true,outcome:"transitioned",brief_id:BRIEF,lifecycle_status:"approved",version:2}){
    return Object.assign(port({current_user_tenant_id:{data:TENANT,error:null},get_campaign_briefs:[list([row()]),list([after])],configure_campaign_brief:{data:write,error:null}}),{receipt:vi.fn(async()=>write)});
  }
  it("uses original transition_brief, verifies exact state/version and unchanged fields, then records original Rail",async()=>{
    const caller=setup(),recordRun=vi.fn(async()=>true);
    const result=await execute({caller,tool:transitionTool,args,recordRun});
    expect(caller.calls.find(([name])=>name==="configure_campaign_brief")?.[1]).toEqual({_tenant_id:TENANT,_command:{type:"transition-brief",briefId:BRIEF,expectedVersion:1,status:"approved"},_idempotency_key:KEY,_actor_kind:"paige"});
    expect(result).toMatchObject({success:true,verified:true,brief:{sourceRef:BRIEF,revision:2,lifecycleStatus:"approved"},receipt:{outcome:"transitioned",runId:KEY}});
    expect(recordRun).toHaveBeenCalledWith({tenantId:TENANT,actorId:ACTOR,capabilityKey:"campaign_brief_transition",outcome:"capability_succeeded",runId:KEY});
  });
  it.each(["invented","archived","",null])("rejects unsupported lifecycle %j before any read or write",async status=>{
    const caller=port({}),recordRun=vi.fn();const result=await execute({caller,tool:transitionTool,args:{...args,status},recordRun});
    expect(result).toMatchObject({success:false,verified:false,code:"CAMPAIGN_BRIEF_ARGUMENTS_INVALID"});expect(caller.calls).toHaveLength(0);expect(recordRun).not.toHaveBeenCalled();
  });
  it("does not treat model-supplied approval or unrelated field changes as authority",async()=>{
    for(const extra of [{approved:true},{objective:"replace strategy"},{tenant_id:OTHER_TENANT}]){
      const caller=port({}),recordRun=vi.fn();expect(await execute({caller,tool:transitionTool,args:{...args,...extra},recordRun})).toMatchObject({success:false,code:"CAMPAIGN_BRIEF_ARGUMENTS_INVALID"});expect(caller.calls).toHaveLength(0);
    }
  });
  it("a changed business or non-manager cannot dispatch lifecycle changes",async()=>{
    for(const caller of [port({current_user_tenant_id:{data:OTHER_TENANT,error:null}}),port({current_user_tenant_id:{data:TENANT,error:null},get_campaign_briefs:list([row()],false)})]){
      const recordRun=vi.fn();expect(await execute({caller,tool:transitionTool,args,recordRun})).toMatchObject({success:false,verified:false});expect(caller.calls.some(([name])=>name==="configure_campaign_brief")).toBe(false);expect(recordRun).not.toHaveBeenCalled();
    }
  });
  it.each([row({lifecycle_status:"active",version:2}),row({lifecycle_status:"approved",version:3}),row({lifecycle_status:"approved",version:2,objective:"unexpected overwrite"})])("never reports another state/version/strategy as verified",async after=>{
    const recordRun=vi.fn();expect(await execute({caller:setup(after),tool:transitionTool,args,recordRun})).toMatchObject({success:false,verified:false,mutationMayHavePersisted:true});expect(recordRun).not.toHaveBeenCalled();
  });
  it("blocked status records the exact blocker through the original native writer",async()=>{
    const recordRun=vi.fn(async()=>true),blockedArgs={...args,status:"blocked",blocker:"Owner review needed"};
    const caller=setup(row({lifecycle_status:"blocked",version:2,blocker:blockedArgs.blocker}),{ok:true,outcome:"transitioned",brief_id:BRIEF,lifecycle_status:"blocked",version:2});
    expect(await execute({caller,tool:transitionTool,args:blockedArgs,recordRun})).toMatchObject({success:true,verified:true});
    expect(caller.calls.find(([name])=>name==="configure_campaign_brief")?.[1]._command).toMatchObject({blocker:blockedArgs.blocker});
  });
  it.each([null,"old blocker"])("leaving blocked requires the native-cleared blocker, got %j",async blocker=>{
    const caller=setup(row({lifecycle_status:"approved",version:2,blocker}));
    const recordRun=vi.fn(async()=>true);expect(await execute({caller,tool:transitionTool,args,recordRun})).toMatchObject({success:blocker===null,verified:blocker===null});
  });
  it("uses the incumbent actor/business/key receipt reader before any Rail success",async()=>{
    const caller=setup(),recordRun=vi.fn(async()=>true);await execute({caller,tool:transitionTool,args,recordRun});
    expect(caller.receipt).toHaveBeenCalledWith({tenantId:TENANT,actorId:ACTOR,idempotencyKey:KEY});expect(recordRun).toHaveBeenCalledOnce();
  });
  it("a missing actor-fenced receipt cannot mint a successful Rail receipt",async()=>{
    const recordRun=vi.fn();expect(await execute({caller:setup(),tool:transitionTool,args,recordRun,readCommandReceipt:async()=>null})).toMatchObject({success:false,verified:false,mutationMayHavePersisted:true,code:"CAMPAIGN_BRIEF_RECEIPT_READ_FAILED"});expect(recordRun).not.toHaveBeenCalled();
  });
  it("requires the original receipt reader before dispatch, rather than inventing proof",async()=>{
    const caller=setup(),recordRun=vi.fn();expect(await executeImpl({expectedTenantId:TENANT,actorId:ACTOR,caller,tool:transitionTool,args,recordRun})).toMatchObject({success:false,code:"CAMPAIGN_BRIEF_RECEIPT_READER_REQUIRED"});expect(caller.calls).toHaveLength(0);
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

describe("original campaign composition read and writer adapters",()=>{
  const ASSET="50000000-0000-4000-8000-000000000001";
  const link=(over:Record<string,unknown>={})=>({brief_id:BRIEF,kind:"form",id:ASSET,name:"Inquiry form",status:"draft",slug:"inquiry",channel:null,created_through:"paige",linked_at:"2026-10-30T00:00:00.000Z",detachable:true,...over});
  const assets=(links:unknown[]=[],canManage=true,available:unknown[]=[]):Response=>({data:{can_manage:canManage,links,available},error:null});
  const read=(caller:ReturnType<typeof port>)=>readAssetsImpl({caller,expectedTenantId:TENANT,briefId:BRIEF});
  const native=(outcome="attached")=>({ok:true,outcome,brief_id:BRIEF,asset_kind:"form",asset_id:ASSET});
  function fixture(outcome="attached",after:unknown[]=outcome==="attached"||outcome==="already_attached"?[link()]:[]){
    return port({current_user_tenant_id:{data:TENANT,error:null},get_campaign_briefs:list([row()]),
      get_campaign_brief_assets:[assets(outcome==="detached"?[link()]:[]),assets(after)],configure_campaign_brief_assets:{data:native(outcome),error:null}});
  }
  const args={idempotency_key:KEY,briefId:BRIEF,assetKind:"form",assetId:ASSET};
  const mutate=(caller:ReturnType<typeof port>,over:Partial<Parameters<typeof assetMutationImpl>[0]>={})=>assetMutationImpl({caller,expectedTenantId:TENANT,actorId:ACTOR,tool:"campaign_asset_attach",args,readCommandReceipt:vi.fn(async()=>native()),recordRun:vi.fn(async()=>true),...over});
  it("reads the original one-brief projection, bounds the inventory claim and returns only whitelisted fields",async()=>{
    const caller=port({current_user_tenant_id:{data:TENANT,error:null},get_campaign_briefs:list([row()]),get_campaign_brief_assets:assets([link({secret:"not for the model"})],true,[{kind:"form",id:ASSET,name:"Inquiry form",status:"draft",channel:null,extra:"not for the model"}])});
    const result=await read(caller);expect(result).toMatchObject({ok:true,canManage:true,briefId:BRIEF,context:{canonicalSource:"public.get_campaign_brief_assets"},links:[{kind:"form",id:ASSET,name:"Inquiry form"}]});
    expect(JSON.stringify(result)).not.toContain("not for the model");expect(result).toHaveProperty("note",expect.stringContaining("not a complete inventory"));
    expect(caller.calls.filter(([name])=>name==="get_campaign_brief_assets")).toEqual([["get_campaign_brief_assets",{_tenant_id:TENANT,_brief_id:BRIEF}]]);
  });
  it("preserves native member redaction of email/library identity and disallows management",async()=>{
    const caller=port({current_user_tenant_id:{data:TENANT,error:null},get_campaign_briefs:list([row()],false),get_campaign_brief_assets:assets([link({kind:"email_campaign",name:null,status:null,channel:null,detachable:false})],false)});
    expect(await read(caller)).toMatchObject({ok:true,canManage:false,links:[{kind:"email_campaign",name:null,status:null,channel:null,detachable:false}],available:[]});
  });
  it.each([link({brief_id:OTHER_TENANT,name:"secret foreign asset"}),link({kind:"email_campaign",name:"secret private asset",detachable:false})])("a wrong-brief or unredacted member result exposes no asset",async raw=>{
    const caller=port({current_user_tenant_id:{data:TENANT,error:null},get_campaign_briefs:list([row()],false),get_campaign_brief_assets:assets([raw],false)});const result=await read(caller);
    expect(result).toEqual({ok:false,code:"CAMPAIGN_ASSET_READBACK_INVALID"});expect(JSON.stringify(result)).not.toContain("secret");
  });
  it("an unavailable brief never turns its empty links into a workspace asset inventory",async()=>{
    const caller=port({current_user_tenant_id:{data:TENANT,error:null},get_campaign_briefs:list([])});expect(await read(caller)).toEqual({ok:false,code:"CAMPAIGN_BRIEF_NOT_FOUND"});expect(caller.calls.some(([name])=>name==="get_campaign_brief_assets")).toBe(false);
  });
  it("rechecks native authority after reading private names and withholds them on revocation",async()=>{
    const caller=port({current_user_tenant_id:{data:TENANT,error:null},get_campaign_briefs:[list([row()]),list([row()],false)],get_campaign_brief_assets:assets([link()])});expect(await read(caller)).toEqual({ok:false,code:"CAMPAIGN_BRIEF_FORBIDDEN"});
  });
  it.each(["attached","already_attached","detached","not_attached"])("verifies native %s, exact link presence, actor-scoped ledger and original Rail",async outcome=>{
    const caller=fixture(outcome),readCommandReceipt=vi.fn(async()=>native(outcome)),recordRun=vi.fn(async()=>true),tool=outcome==="detached"||outcome==="not_attached"?"campaign_asset_detach":"campaign_asset_attach";
    const result=await mutate(caller,{tool,readCommandReceipt,recordRun});expect(result).toMatchObject({success:true,verified:true,railRecorded:true,asset:{briefId:BRIEF,kind:"form",id:ASSET,linked:tool==="campaign_asset_attach"},receipt:{outcome,runId:KEY}});
    expect(caller.calls.filter(([name])=>name==="configure_campaign_brief_assets")).toEqual([["configure_campaign_brief_assets",{_tenant_id:TENANT,_command:{type:tool==="campaign_asset_attach"?"attach_asset":"detach_asset",briefId:BRIEF,assetKind:"form",assetId:ASSET},_idempotency_key:KEY,_actor_kind:"paige"}]]);
    expect(readCommandReceipt).toHaveBeenCalledWith({tenantId:TENANT,actorId:ACTOR,idempotencyKey:KEY});expect(recordRun).toHaveBeenCalledWith({tenantId:TENANT,actorId:ACTOR,capabilityKey:tool,outcome:"capability_succeeded",runId:KEY});
  });
  it.each([{assetKind:"social_post"},{assetId:"bad"},{idempotency_key:"bad"},{approved:true},{_tenant_id:OTHER_TENANT}])("rejects unsupported asset mutation input %j before any RPC",async extra=>{
    const caller=port({});expect(await mutate(caller,{args:{...args,...extra}})).toMatchObject({success:false,verified:false,code:"CAMPAIGN_ASSET_ARGUMENTS_INVALID"});expect(caller.calls).toHaveLength(0);
  });
  it("a member cannot dispatch an asset writer",async()=>{
    const caller=port({current_user_tenant_id:{data:TENANT,error:null},get_campaign_briefs:list([row()],false),get_campaign_brief_assets:assets([],false)});expect(await mutate(caller)).toMatchObject({success:false,code:"CAMPAIGN_BRIEF_FORBIDDEN"});expect(caller.calls.some(([name])=>name==="configure_campaign_brief_assets")).toBe(false);
  });
  it("an ACK without the exact persisted link never records success",async()=>{
    const recordRun=vi.fn();expect(await mutate(fixture("attached",[]),{recordRun})).toMatchObject({success:false,verified:false,mutationMayHavePersisted:true,code:"CAMPAIGN_ASSET_READBACK_MISMATCH"});expect(recordRun).not.toHaveBeenCalled();
  });
  it("a missing original actor receipt cannot manufacture an attachment receipt",async()=>{
    const recordRun=vi.fn();expect(await mutate(fixture(),{readCommandReceipt:async()=>null,recordRun})).toMatchObject({success:false,verified:false,mutationMayHavePersisted:true,code:"CAMPAIGN_BRIEF_RECEIPT_READ_FAILED"});expect(recordRun).not.toHaveBeenCalled();
  });
  it("a brief archived during receipt verification cannot receive a successful Rail record",async()=>{
    const caller=port({current_user_tenant_id:{data:TENANT,error:null},get_campaign_briefs:[list([row()]),list([row()]),list([row()]),list([row()]),list([row({lifecycle_status:"archived"})])],get_campaign_brief_assets:[assets(),assets([link()])],configure_campaign_brief_assets:{data:native(),error:null}}),recordRun=vi.fn();
    expect(await mutate(caller,{recordRun})).toMatchObject({success:false,verified:false,mutationMayHavePersisted:true,code:"CAMPAIGN_BRIEF_FORBIDDEN"});expect(recordRun).not.toHaveBeenCalled();
  });
  it("a mismatched original receipt never borrows another asset's successful outcome",async()=>{
    const recordRun=vi.fn();expect(await mutate(fixture(),{readCommandReceipt:async()=>({...native(),asset_id:OTHER_TENANT}),recordRun})).toMatchObject({success:false,verified:false,mutationMayHavePersisted:true,code:"CAMPAIGN_BRIEF_RECEIPT_READ_FAILED"});expect(recordRun).not.toHaveBeenCalled();
  });
  it("a foreign active account cannot read assets or dispatch the writer",async()=>{
    const caller=port({current_user_tenant_id:{data:OTHER_TENANT,error:null}});expect(await mutate(caller)).toMatchObject({success:false,verified:false,code:"ACTIVE_ACCOUNT_CHANGED"});expect(caller.calls.map(([name])=>name)).toEqual(["current_user_tenant_id"]);
  });
  it("Rail failure retries only evidence under the original key, not the mutation",async()=>{
    const caller=fixture(),recordRun=vi.fn(async()=>false);expect(await mutate(caller,{recordRun})).toMatchObject({success:false,verified:true,railRecorded:false,mutationMayHavePersisted:true,code:"CAMPAIGN_BRIEF_RAIL_WRITE_FAILED"});expect(recordRun).toHaveBeenCalledTimes(2);expect(caller.calls.filter(([name])=>name==="configure_campaign_brief_assets")).toHaveLength(1);
  });
  it("an uncertain native write is not retried or converted to an empty/successful result",async()=>{
    const caller=port({current_user_tenant_id:{data:TENANT,error:null},get_campaign_briefs:list([row()]),get_campaign_brief_assets:assets(),configure_campaign_brief_assets:"throw"}),recordRun=vi.fn();
    expect(await mutate(caller,{recordRun})).toMatchObject({success:false,verified:false,mutationMayHavePersisted:true,code:"CAMPAIGN_ASSET_WRITE_OUTCOME_UNKNOWN"});expect(recordRun).not.toHaveBeenCalled();expect(caller.calls.filter(([name])=>name==="configure_campaign_brief_assets")).toHaveLength(1);
  });
});

function readLeads(input: { caller: ReturnType<typeof port>; briefId: unknown; observedAt?: Date }) {
  return readLeadsImpl({ caller: input.caller, expectedTenantId: TENANT, briefId: input.briefId, observedAt: input.observedAt });
}
