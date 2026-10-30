/**
 * Solo Tenant Brain — original Campaign Brief readers and verified planning writes.
 *
 * This composes the existing caller-scoped Campaign Brief projector and writer.
 * It owns no table, authority resolver, approval path, Mind projection, Memory
 * writer, or UI. A write response is never treated as proof: the canonical brief
 * is freshly projected and compared before the existing Rail writer is called.
 */

type RpcError = { message?: string } | null;

export type CampaignBriefRpcPort = {
  rpc: (
    name: string,
    args?: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: RpcError }>;
};

// Lifecycle dispatch is a domain adapter only. Its outer caller must use the
// original high-risk human gate; no model-supplied approval field is authority.
export type CampaignBriefToolName = "campaign_brief_create" | "campaign_brief_revise" | "campaign_brief_transition";
export type CampaignAssetMutationToolName = "campaign_asset_attach" | "campaign_asset_detach";

type CanonicalBrief = {
  id: string;
  shortRef: string | null;
  name: string;
  objective: string | null;
  audience: string | null;
  positioning: string | null;
  channels: string[];
  desiredOutcome: string | null;
  successDefinition: string | null;
  budgetTarget: string | null;
  timing: string | null;
  constraints: string | null;
  contentNeeds: string | null;
  conversionDestination: string | null;
  followupPath: string | null;
  lifecycleStatus: string;
  blocker: string | null;
  offerId: string | null;
  offerName: string | null;
  pipelineId: string | null;
  pipelineName: string | null;
  missionId: string | null;
  version: number;
  createdThrough: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CampaignBriefContext = {
  lane: "campaign_brief";
  canonicalSource: "public.get_campaign_briefs" | "public.get_campaign_brief_leads";
  observedAt: string;
  freshness: "current_canonical_projection";
  mindEligibility: "UNAVAILABLE";
  memoryRetention: "UNAVAILABLE";
};

export type CampaignBriefListContextResult =
  | { ok: true; tenantId: string; canManage: boolean; context: CampaignBriefContext; briefs: CanonicalBrief[] }
  | { ok: false; code: string; tenantId?: string };

type RecordRun = (input: {
  tenantId: string;
  actorId: string;
  capabilityKey: CampaignBriefToolName | CampaignAssetMutationToolName;
  outcome: "capability_succeeded";
  runId: string;
}) => Promise<boolean>;

type ReadCommandReceipt = (input: {
  tenantId: string;
  actorId: string;
  idempotencyKey: string;
}) => Promise<Record<string, unknown> | null>;

const WRITABLE_FIELDS = [
  "name", "objective", "audience", "positioning", "channels", "desiredOutcome",
  "successDefinition", "budgetTarget", "timing", "constraints", "contentNeeds",
  "conversionDestination", "followupPath", "offerId", "pipelineId",
] as const;

const stringValue = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const integerValue = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;

const stringArray = (value: unknown): string[] | null =>
  Array.isArray(value) && value.every((item) => typeof item === "string")
    ? [...value]
    : null;

const normalizedInputChannels = (value: unknown): string[] | null =>
  Array.isArray(value) && value.every((item) => typeof item === "string" && item.trim().length > 0)
    ? value.map((item) => item.trim())
    : null;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validMutationArgs(tool: CampaignBriefToolName, args: Record<string, unknown>): boolean {
  if(tool==="campaign_brief_transition"){
    return typeof args.briefId==="string"&&UUID_RE.test(args.briefId)
      &&Number.isSafeInteger(args.expectedVersion)&&Number(args.expectedVersion)>0
      &&typeof args.status==="string"&&["draft","ready_for_review","blocked","approved","active","paused","completed"].includes(args.status)
      &&(args.blocker===undefined||(typeof args.blocker==="string"&&args.blocker.length<=4000))
      &&Object.keys(args).every(key=>["briefId","expectedVersion","status","blocker","idempotency_key"].includes(key));
  }
  if (tool === "campaign_brief_create" && !stringValue(args.name)) return false;
  if (tool === "campaign_brief_revise") {
    const briefId = stringValue(args.briefId);
    if (!briefId || !UUID_RE.test(briefId) || !integerValue(args.expectedVersion)) return false;
  }
  for (const field of WRITABLE_FIELDS) {
    if (args[field] === undefined) continue;
    if (field === "channels") {
      if (!normalizedInputChannels(args[field])) return false;
      continue;
    }
    if (typeof args[field] !== "string") return false;
    if (field === "name" && !stringValue(args[field])) return false;
    if ((field === "offerId" || field === "pipelineId") && stringValue(args[field]) && !UUID_RE.test(String(args[field]).trim())) return false;
  }
  return true;
}

const rpcCode = (error: RpcError, fallback: string): string => {
  const message = stringValue(error?.message);
  if (!message) return fallback;
  for (const code of [
    "ACTIVE_ACCOUNT_CHANGED",
    "CAMPAIGN_BRIEF_FORBIDDEN",
    "CAMPAIGN_BRIEF_VERSION_CONFLICT",
    "CAMPAIGN_BRIEF_NOT_FOUND",
    "CAMPAIGN_BRIEF_OFFER_TENANT_MISMATCH",
    "CAMPAIGN_BRIEF_PIPELINE_TENANT_MISMATCH",
    "CAMPAIGN_BRIEF_NAME_REQUIRED",
    "CAMPAIGN_BRIEF_IDEMPOTENCY_CONFLICT",
    "CAMPAIGN_BRIEF_IDEMPOTENCY_REQUIRED",
    "CAMPAIGN_BRIEF_ACTOR_INVALID",
    "CAMPAIGN_BRIEF_ACTION_INVALID",
  ]) if (message.includes(code)) return code;
  return fallback;
};

function asCanonicalBrief(value: unknown): CanonicalBrief | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const id = stringValue(row.id);
  const name = stringValue(row.name);
  const lifecycleStatus = stringValue(row.lifecycle_status);
  const version = integerValue(row.version);
  const createdAt = stringValue(row.created_at);
  const updatedAt = stringValue(row.updated_at);
  const channels = stringArray(row.channels);
  if (!id || !name || !lifecycleStatus || !version || !createdAt || !updatedAt || !channels) return null;
  if (Number.isNaN(Date.parse(createdAt)) || Number.isNaN(Date.parse(updatedAt))) return null;
  return {
    id,
    shortRef: stringValue(row.short_ref),
    name,
    objective: stringValue(row.objective),
    audience: stringValue(row.audience),
    positioning: stringValue(row.positioning),
    channels,
    desiredOutcome: stringValue(row.desired_outcome),
    successDefinition: stringValue(row.success_definition),
    budgetTarget: stringValue(row.budget_target),
    timing: stringValue(row.timing),
    constraints: stringValue(row.constraints),
    contentNeeds: stringValue(row.content_needs),
    conversionDestination: stringValue(row.conversion_destination),
    followupPath: stringValue(row.followup_path),
    lifecycleStatus,
    blocker: stringValue(row.blocker),
    offerId: stringValue(row.offer_id),
    offerName: stringValue(row.offer_name),
    pipelineId: stringValue(row.pipeline_id),
    pipelineName: stringValue(row.pipeline_name),
    missionId: stringValue(row.mission_id),
    version,
    createdThrough: stringValue(row.created_through),
    createdAt,
    updatedAt,
  };
}

async function resolveTenant(caller: CampaignBriefRpcPort): Promise<string | null> {
  try {
    const { data, error } = await caller.rpc("current_user_tenant_id", {});
    return error ? null : stringValue(data);
  } catch {
    return null;
  }
}

async function readCanonicalList(input: {
  caller: CampaignBriefRpcPort;
  expectedTenantId: string;
  observedAt: Date;
}): Promise<CampaignBriefListContextResult> {
  const tenantId = await resolveTenant(input.caller);
  if (!tenantId) return { ok: false, code: "CAMPAIGN_BRIEF_TENANT_NOT_RESOLVED" };
  if (tenantId !== input.expectedTenantId) return { ok: false, code: "ACTIVE_ACCOUNT_CHANGED", tenantId };

  let response: { data: unknown; error: RpcError };
  try {
    response = await input.caller.rpc("get_campaign_briefs", { _tenant_id: tenantId });
  } catch {
    return { ok: false, code: "CAMPAIGN_BRIEF_READ_OUTCOME_UNKNOWN", tenantId };
  }
  if (response.error) return { ok: false, code: rpcCode(response.error, "CAMPAIGN_BRIEF_READ_FAILED"), tenantId };
  if (!response.data || typeof response.data !== "object") {
    return { ok: false, code: "CAMPAIGN_BRIEF_READBACK_INVALID", tenantId };
  }
  const envelope = response.data as Record<string, unknown>;
  if (!Array.isArray(envelope.briefs) || typeof envelope.can_manage !== "boolean") {
    return { ok: false, code: "CAMPAIGN_BRIEF_READBACK_INVALID", tenantId };
  }
  const briefs = envelope.briefs.map(asCanonicalBrief);
  if (briefs.some((brief) => brief === null)) {
    return { ok: false, code: "CAMPAIGN_BRIEF_READBACK_INVALID", tenantId };
  }
  return {
    ok: true,
    tenantId,
    canManage: envelope.can_manage,
    context: {
      lane: "campaign_brief",
      canonicalSource: "public.get_campaign_briefs",
      observedAt: input.observedAt.toISOString(),
      freshness: "current_canonical_projection",
      mindEligibility: "UNAVAILABLE",
      memoryRetention: "UNAVAILABLE",
    },
    briefs: briefs as CanonicalBrief[],
  };
}

export async function resolveCampaignBriefListContext(input: {
  caller: CampaignBriefRpcPort;
  expectedTenantId: string;
  observedAt?: Date;
}): Promise<CampaignBriefListContextResult> {
  return readCanonicalList({ ...input, observedAt: input.observedAt ?? new Date() });
}

export type CampaignBriefLeadsResult =
  | {
      ok: true;
      tenantId: string;
      briefId: string;
      context: CampaignBriefContext;
      leads: Record<string, unknown>[];
      counts: Record<string, unknown>;
      truncated: boolean;
      ambiguousOnCampaignForms: boolean;
    }
  | { ok: false; code: string; tenantId?: string };

const BRIEF_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * S1e — the leads one campaign brought in, read through the SAME canonical RPC the dossier's
 * "Brought in" lane reads (public.get_campaign_brief_leads), on the caller's OWN session. The
 * RPC decides who may read (its own workspace only; CAMPAIGN_BRIEF_FORBIDDEN for anyone else's)
 * and redacts member views itself, so this helper adds no authority and no redaction of its own.
 * Attribution is how a lead was LINKED (form in this campaign, the link's tag, or both) — the
 * caller is responsible for never narrating it as ad performance.
 */
export async function readCampaignBriefLeads(input: {
  caller: CampaignBriefRpcPort;
  expectedTenantId: string;
  briefId: unknown;
  observedAt?: Date;
}): Promise<CampaignBriefLeadsResult> {
  if (typeof input.briefId !== "string" || !BRIEF_UUID_RE.test(input.briefId)) {
    return { ok: false, code: "CAMPAIGN_BRIEF_ARGUMENTS_INVALID" };
  }
  const tenantId = await resolveTenant(input.caller);
  if (!tenantId) return { ok: false, code: "CAMPAIGN_BRIEF_TENANT_NOT_RESOLVED" };
  if (tenantId !== input.expectedTenantId) return { ok: false, code: "ACTIVE_ACCOUNT_CHANGED", tenantId };

  let response: { data: unknown; error: RpcError };
  try {
    response = await input.caller.rpc("get_campaign_brief_leads", {
      _tenant_id: tenantId,
      _brief_id: input.briefId,
    });
  } catch {
    return { ok: false, code: "CAMPAIGN_BRIEF_LEADS_READ_OUTCOME_UNKNOWN", tenantId };
  }
  if (response.error) return { ok: false, code: rpcCode(response.error, "CAMPAIGN_BRIEF_LEADS_READ_FAILED"), tenantId };
  const envelope = response.data && typeof response.data === "object" ? response.data as Record<string, unknown> : null;
  const counts = envelope?.counts && typeof envelope.counts === "object" && !Array.isArray(envelope.counts)
    ? envelope.counts as Record<string, unknown> : null;
  if (!envelope || !Array.isArray(envelope.leads) || !counts) {
    return { ok: false, code: "CAMPAIGN_BRIEF_READBACK_INVALID", tenantId };
  }
  const leads = envelope.leads.filter((lead): lead is Record<string, unknown> =>
    !!lead && typeof lead === "object" && !Array.isArray(lead));
  // The RPC's own honesty signals ride along: `truncated` (the list is capped at the newest 200
  // while counts.leads is the true total) and `ambiguous_on_campaign_forms` (some leads' tags
  // matched several campaigns, so they are excluded from these counts and not credited — the
  // owner is told rather than seeing a quiet undercount). Dropping them would let a chat answer
  // understate honestly.
  const truncated = envelope.truncated === true;
  const ambiguousOnCampaignForms = envelope.ambiguous_on_campaign_forms === true;
  return {
    ok: true,
    tenantId,
    briefId: input.briefId,
    context: {
      lane: "campaign_brief",
      canonicalSource: "public.get_campaign_brief_leads",
      observedAt: (input.observedAt ?? new Date()).toISOString(),
      freshness: "current_canonical_projection",
      mindEligibility: "UNAVAILABLE",
      memoryRetention: "UNAVAILABLE",
    },
    leads,
    counts,
    truncated,
    ambiguousOnCampaignForms,
  };
}

function commandFor(tool: CampaignBriefToolName, args: Record<string, unknown>): Record<string, unknown> {
  if(tool==="campaign_brief_transition")return{type:"transition-brief",briefId:args.briefId,expectedVersion:args.expectedVersion,status:args.status,...(args.blocker!==undefined?{blocker:args.blocker}:{})};
  const command: Record<string, unknown> = tool === "campaign_brief_create"
    ? { type: "create-brief" }
    : { type: "update-brief", briefId: args.briefId, expectedVersion: args.expectedVersion };
  for (const field of WRITABLE_FIELDS) if (args[field] !== undefined) {
    command[field] = field === "channels" ? normalizedInputChannels(args[field]) : args[field];
  }
  return command;
}

function expectedValue(field: typeof WRITABLE_FIELDS[number], value: unknown): unknown {
  if (field === "channels") return normalizedInputChannels(value) ?? [];
  return stringValue(value);
}

function currentValue(brief: CanonicalBrief, field: typeof WRITABLE_FIELDS[number]): unknown {
  return brief[field];
}

function valuesEqual(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(expected)) return JSON.stringify(actual) === JSON.stringify(expected);
  return actual === expected;
}

function verifyBrief(input: {
  tool: CampaignBriefToolName;
  args: Record<string, unknown>;
  before: CanonicalBrief | null;
  after: CanonicalBrief;
  writeResult: Record<string, unknown>;
}): boolean {
  const writeId = stringValue(input.writeResult.brief_id);
  const writeVersion = integerValue(input.writeResult.version);
  const expectedOutcome = input.tool === "campaign_brief_create" ? "created" : input.tool === "campaign_brief_transition" ? "transitioned" : "updated";
  if (
    input.writeResult.ok === false || input.writeResult.outcome !== expectedOutcome ||
    !writeId || input.after.id !== writeId || !writeVersion || input.after.version !== writeVersion
  ) return false;
  if (input.tool === "campaign_brief_create" && input.after.lifecycleStatus !== "draft") return false;
  if (input.tool === "campaign_brief_revise" && input.before && input.after.lifecycleStatus !== input.before.lifecycleStatus) return false;
  if(input.tool==="campaign_brief_transition"&&(input.writeResult.ok!==true||input.writeResult.lifecycle_status!==input.args.status
    ||input.after.lifecycleStatus!==input.args.status||input.after.blocker!==(input.args.status==="blocked"?stringValue(input.args.blocker):null)))return false;

  for (const field of WRITABLE_FIELDS) {
    const expected = input.args[field] !== undefined
      ? expectedValue(field, input.args[field])
      : input.tool === "campaign_brief_create"
        ? expectedValue(field, field === "channels" ? [] : null)
        : input.before ? currentValue(input.before, field) : undefined;
    if (!valuesEqual(currentValue(input.after, field), expected)) return false;
  }
  return true;
}

export async function executeVerifiedCampaignBriefMutation(input: {
  caller: CampaignBriefRpcPort;
  expectedTenantId: string;
  actorId: string;
  tool: CampaignBriefToolName;
  args: Record<string, unknown>;
  recordRun: RecordRun;
  readCommandReceipt?: ReadCommandReceipt;
  observedAt?: Date;
}): Promise<Record<string, unknown>> {
  const idempotencyKey = stringValue(input.args.idempotency_key);
  if (!idempotencyKey) return { success: false, verified: false, code: "CAMPAIGN_BRIEF_IDEMPOTENCY_REQUIRED" };
  if (!UUID_RE.test(idempotencyKey) || !validMutationArgs(input.tool, input.args)) {
    return { success: false, verified: false, code: "CAMPAIGN_BRIEF_ARGUMENTS_INVALID" };
  }
  if(input.tool==="campaign_brief_transition"&&(!UUID_RE.test(input.expectedTenantId)||!UUID_RE.test(input.actorId)||!input.readCommandReceipt)){
    return{success:false,verified:false,code:"CAMPAIGN_BRIEF_RECEIPT_READER_REQUIRED"};
  }

  const beforeRead = await readCanonicalList({
    caller: input.caller,
    expectedTenantId: input.expectedTenantId,
    observedAt: input.observedAt ?? new Date(),
  });
  if ("code" in beforeRead) return { success: false, verified: false, code: beforeRead.code };
  if (!beforeRead.canManage) return { success: false, verified: false, code: "CAMPAIGN_BRIEF_FORBIDDEN" };

  if (input.tool === "campaign_brief_create") {
    const requestedName = stringValue(input.args.name);
    const sameName = requestedName
      ? beforeRead.briefs.filter((brief) => brief.name.trim().toLocaleLowerCase() === requestedName.toLocaleLowerCase())
      : [];
    if (sameName.length) {
      let priorResult: Record<string, unknown> | null = null;
      try {
        priorResult = input.readCommandReceipt
          ? await input.readCommandReceipt({
              tenantId: beforeRead.tenantId,
              actorId: input.actorId,
              idempotencyKey,
            })
          : null;
      } catch {
        return { success: false, verified: false, code: "CAMPAIGN_BRIEF_RECEIPT_READ_FAILED" };
      }
      const replayId = stringValue(priorResult?.brief_id);
      const isProvenReplay = priorResult?.ok === true && priorResult?.outcome === "created" &&
        !!replayId && sameName.some((brief) => brief.id === replayId);
      if (!isProvenReplay) {
        return {
          success: false,
          verified: false,
          code: "CAMPAIGN_BRIEF_DUPLICATE_NAME",
          options: sameName.map((brief) => brief.shortRef ?? brief.name),
        };
      }
    }
  }

  let before: CanonicalBrief | null = null;
  if(input.tool==="campaign_brief_transition"){
    before=beforeRead.briefs.find(brief=>brief.id===input.args.briefId)??null;
    if(!before)return{success:false,verified:false,code:"CAMPAIGN_BRIEF_NOT_FOUND"};
  }
  if (input.tool === "campaign_brief_revise") {
    const briefId = stringValue(input.args.briefId);
    if (!briefId) return { success: false, verified: false, code: "CAMPAIGN_BRIEF_NOT_FOUND" };
    before = beforeRead.briefs.find((brief) => brief.id === briefId) ?? null;
    if (!before) return { success: false, verified: false, code: "CAMPAIGN_BRIEF_NOT_FOUND" };
    const normalizedName = before.name.trim().toLocaleLowerCase();
    const sameName = beforeRead.briefs.filter((brief) => brief.name.trim().toLocaleLowerCase() === normalizedName);
    if (sameName.length > 1) {
      return {
        success: false,
        verified: false,
        code: "CAMPAIGN_BRIEF_AMBIGUOUS",
        options: sameName.map((brief) => brief.shortRef ?? brief.name),
      };
    }

    const proposedName = input.args.name === undefined ? null : stringValue(input.args.name);
    const proposedNameMatches = proposedName
      ? beforeRead.briefs.filter((brief) =>
          brief.id !== briefId &&
          brief.name.trim().toLocaleLowerCase() === proposedName.toLocaleLowerCase()
        )
      : [];
    if (proposedNameMatches.length) {
      return {
        success: false,
        verified: false,
        code: "CAMPAIGN_BRIEF_DUPLICATE_NAME",
        options: proposedNameMatches.map((brief) => brief.shortRef ?? brief.name),
      };
    }
  }

  let writeData: unknown;
  try {
    const { data, error } = await input.caller.rpc("configure_campaign_brief", {
      _tenant_id: beforeRead.tenantId,
      _command: commandFor(input.tool, input.args),
      _idempotency_key: idempotencyKey,
      _actor_kind: "paige",
    });
    if (error) {
      const code = rpcCode(error, "CAMPAIGN_BRIEF_WRITE_OUTCOME_UNKNOWN");
      return {
        success: false,
        verified: false,
        mutationMayHavePersisted: code === "CAMPAIGN_BRIEF_WRITE_OUTCOME_UNKNOWN",
        code,
      };
    }
    writeData = data;
  } catch {
    return {
      success: false,
      verified: false,
      mutationMayHavePersisted: true,
      code: "CAMPAIGN_BRIEF_WRITE_OUTCOME_UNKNOWN",
    };
  }

  if (!writeData || typeof writeData !== "object") {
    return {
      success: false,
      verified: false,
      mutationMayHavePersisted: true,
      code: "CAMPAIGN_BRIEF_WRITE_RESULT_INVALID",
    };
  }
  const writeResult = writeData as Record<string, unknown>;
  const briefId = stringValue(writeResult.brief_id);
  if (!briefId) {
    return {
      success: false,
      verified: false,
      mutationMayHavePersisted: true,
      code: "CAMPAIGN_BRIEF_WRITE_RESULT_INVALID",
    };
  }

  const tenantAfterWrite = await resolveTenant(input.caller);
  if (tenantAfterWrite !== input.expectedTenantId) {
    return {
      success: false,
      verified: false,
      mutationMayHavePersisted: true,
      code: "ACTIVE_ACCOUNT_CHANGED",
    };
  }

  // The tenant was just re-resolved above. Read the projector directly so a workspace
  // change cannot be hidden by a stale client value, then bind the returned row to it.
  let readbackResponse: { data: unknown; error: RpcError };
  try {
    readbackResponse = await input.caller.rpc("get_campaign_briefs", { _tenant_id: tenantAfterWrite });
  } catch {
    return { success: false, verified: false, mutationMayHavePersisted: true, code: "CAMPAIGN_BRIEF_READ_OUTCOME_UNKNOWN" };
  }
  if (readbackResponse.error) {
    return {
      success: false,
      verified: false,
      mutationMayHavePersisted: true,
      code: rpcCode(readbackResponse.error, "CAMPAIGN_BRIEF_READ_FAILED"),
    };
  }
  if (!readbackResponse.data || typeof readbackResponse.data !== "object") {
    return { success: false, verified: false, mutationMayHavePersisted: true, code: "CAMPAIGN_BRIEF_READBACK_INVALID" };
  }
  const envelope = readbackResponse.data as Record<string, unknown>;
  if(input.tool==="campaign_brief_transition"&&envelope.can_manage!==true){
    return{success:false,verified:false,mutationMayHavePersisted:true,code:"CAMPAIGN_BRIEF_FORBIDDEN"};
  }
  if (!Array.isArray(envelope.briefs)) {
    return { success: false, verified: false, mutationMayHavePersisted: true, code: "CAMPAIGN_BRIEF_READBACK_INVALID" };
  }
  const after = envelope.briefs.map(asCanonicalBrief).find((brief) => brief?.id === briefId) ?? null;
  if (!after) {
    return { success: false, verified: false, mutationMayHavePersisted: true, code: "CAMPAIGN_BRIEF_NOT_FOUND" };
  }
  if (!verifyBrief({ tool: input.tool, args: input.args, before, after, writeResult })) {
    return { success: false, verified: false, mutationMayHavePersisted: true, code: "CAMPAIGN_BRIEF_READBACK_MISMATCH" };
  }
  if(input.tool==="campaign_brief_transition"){
    // The incumbent reader is fenced to this actor/business/key. A tenant-global
    // cached result from another actor is not this person's approval or receipt.
    let receipt:Record<string,unknown>|null;
    try{receipt=await input.readCommandReceipt!({tenantId:beforeRead.tenantId,actorId:input.actorId,idempotencyKey});}
    catch{return{success:false,verified:false,mutationMayHavePersisted:true,code:"CAMPAIGN_BRIEF_RECEIPT_READ_FAILED"};}
    if(!receipt||receipt.ok!==true||receipt.outcome!=="transitioned"||receipt.brief_id!==after.id
      ||receipt.version!==after.version||receipt.lifecycle_status!==after.lifecycleStatus){
      return{success:false,verified:false,mutationMayHavePersisted:true,code:"CAMPAIGN_BRIEF_RECEIPT_READ_FAILED"};
    }
    if(await resolveTenant(input.caller)!==input.expectedTenantId){
      return{success:false,verified:false,mutationMayHavePersisted:true,code:"ACTIVE_ACCOUNT_CHANGED"};
    }
  }

  let railRecorded = false;
  for (let attempt = 0; attempt < 2 && !railRecorded; attempt += 1) {
    try {
      railRecorded = await input.recordRun({
        tenantId: beforeRead.tenantId,
        actorId: input.actorId,
        capabilityKey: input.tool,
        outcome: "capability_succeeded",
        runId: idempotencyKey,
      });
    } catch {
      railRecorded = false;
    }
  }

  const brief = {
    lane: "campaign_brief",
    canonicalSource: "public.get_campaign_briefs",
    sourceRef: after.id,
    revision: after.version,
    lifecycleStatus: after.lifecycleStatus,
    updatedAt: after.updatedAt,
    observedAt: (input.observedAt ?? new Date()).toISOString(),
    freshness: "current_canonical_projection",
    mindEligibility: "UNAVAILABLE",
    memoryRetention: "UNAVAILABLE",
    safeFields: {
      shortRef: after.shortRef,
      name: after.name,
      objective: after.objective,
      desiredOutcome: after.desiredOutcome,
      successDefinition: after.successDefinition,
    },
  };
  const receipt = {
    source: "public.campaign_brief_command_results",
    runId: idempotencyKey,
    outcome: input.tool === "campaign_brief_create" ? "created" : input.tool === "campaign_brief_transition" ? "transitioned" : "updated",
  };

  if (!railRecorded) {
    return {
      success: false,
      verified: true,
      railRecorded: false,
      mutationMayHavePersisted: true,
      code: "CAMPAIGN_BRIEF_RAIL_WRITE_FAILED",
      brief,
      receipt,
      note: "The canonical Campaign Brief planning record was verified, but its Rail evidence did not finish after a bounded same-key evidence retry. Do not report end-to-end success and do not repeat the Campaign Brief mutation; evidence repair remains required.",
    };
  }

  return {
    success: true,
    verified: true,
    railRecorded: true,
    brief,
    receipt,
    note: "The canonical Campaign Brief planning record was verified and recorded on the workspace Rail. Nothing launched, published, spent money, performed, or completed. Mind and Memory remain unavailable.",
  };
}

const LINKABLE_ASSET_KINDS=["page","form","funnel","email_campaign","email_series","content"] as const;
type LinkableAssetKind=typeof LINKABLE_ASSET_KINDS[number];
type AssetKind=LinkableAssetKind|"social_post";
type AssetLink={briefId:string;kind:AssetKind;id:string;name:string|null;status:string|null;slug:string|null;channel:string|null;createdThrough:string|null;linkedAt:string|null;detachable:boolean};
type AvailableAsset={kind:LinkableAssetKind;id:string;name:string;status:string|null;channel:string|null};
type AssetContext=Omit<CampaignBriefContext,"canonicalSource">&{canonicalSource:"public.get_campaign_brief_assets"};
export type CampaignBriefAssetsResult=
  |{ok:true;tenantId:string;briefId:string;canManage:boolean;context:AssetContext;links:AssetLink[];available:AvailableAsset[];note:string}
  |{ok:false;code:string};
const assetObject=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==="object"&&!Array.isArray(value);
const assetKind=(value:unknown):value is LinkableAssetKind=>typeof value==="string"&&(LINKABLE_ASSET_KINDS as readonly string[]).includes(value);
const nullableAssetString=(value:unknown)=>value===null||value===undefined||typeof value==="string";

/** The original native composition read, never an asset/permission/publishing store. */
export async function readCampaignBriefAssets(input:{caller:CampaignBriefRpcPort;expectedTenantId:string;briefId:unknown;observedAt?:Date}):Promise<CampaignBriefAssetsResult>{
  if(typeof input.briefId!=="string"||!UUID_RE.test(input.briefId)||!UUID_RE.test(input.expectedTenantId))return{ok:false,code:"CAMPAIGN_ASSET_ARGUMENTS_INVALID"};
  const briefId=input.briefId.toLowerCase(),observedAt=input.observedAt??new Date();
  const before=await readCanonicalList({...input,observedAt});
  if(before.ok===false)return{ok:false,code:before.code};
  if(!before.briefs.some(brief=>brief.id===briefId&&brief.lifecycleStatus!=="archived"))return{ok:false,code:"CAMPAIGN_BRIEF_NOT_FOUND"};
  let response:{data:unknown;error:RpcError};
  try{response=await input.caller.rpc("get_campaign_brief_assets",{_tenant_id:before.tenantId,_brief_id:briefId});}
  catch{return{ok:false,code:"CAMPAIGN_ASSET_READ_OUTCOME_UNKNOWN"};}
  if(response.error)return{ok:false,code:rpcCode(response.error,"CAMPAIGN_ASSET_READ_FAILED")};
  const body=response.data;
  if(!assetObject(body)||typeof body.can_manage!=="boolean"||!Array.isArray(body.links)||!Array.isArray(body.available))return{ok:false,code:"CAMPAIGN_ASSET_READBACK_INVALID"};
  const links:AssetLink[]=[],available:AvailableAsset[]=[];
  for(const row of body.links){
    if(!assetObject(row)||row.brief_id!==briefId||typeof row.id!=="string"||!UUID_RE.test(row.id)
      ||(!assetKind(row.kind)&&row.kind!=="social_post")||typeof row.detachable!=="boolean"
      ||!["name","status","slug","channel","created_through","linked_at"].every(key=>nullableAssetString(row[key])))return{ok:false,code:"CAMPAIGN_ASSET_READBACK_INVALID"};
    // Native member redaction is also enforced at this model-facing projection.
    if(!body.can_manage&&(row.detachable||((row.kind==="email_campaign"||row.kind==="email_series"||row.kind==="content")&&(row.name!==null||row.status!==null||row.channel!==null))))return{ok:false,code:"CAMPAIGN_ASSET_READBACK_INVALID"};
    if(row.kind==="social_post"&&row.detachable)return{ok:false,code:"CAMPAIGN_ASSET_READBACK_INVALID"};
    links.push({briefId,kind:row.kind as AssetKind,id:row.id,name:stringValue(row.name),status:stringValue(row.status),slug:stringValue(row.slug),channel:stringValue(row.channel),createdThrough:stringValue(row.created_through),linkedAt:stringValue(row.linked_at),detachable:row.detachable});
  }
  if(!body.can_manage&&body.available.length)return{ok:false,code:"CAMPAIGN_ASSET_READBACK_INVALID"};
  for(const row of body.available){
    if(!assetObject(row)||!assetKind(row.kind)||typeof row.id!=="string"||!UUID_RE.test(row.id)||typeof row.name!=="string"||!["status","channel"].every(key=>nullableAssetString(row[key])))return{ok:false,code:"CAMPAIGN_ASSET_READBACK_INVALID"};
    available.push({kind:row.kind,id:row.id,name:row.name,status:stringValue(row.status),channel:stringValue(row.channel)});
  }
  const after=await readCanonicalList({...input,observedAt});
  if(after.ok===false)return{ok:false,code:after.code};
  if(!after.briefs.some(brief=>brief.id===briefId&&brief.lifecycleStatus!=="archived"))return{ok:false,code:"CAMPAIGN_BRIEF_NOT_FOUND"};
  if(after.canManage!==body.can_manage)return{ok:false,code:"CAMPAIGN_BRIEF_FORBIDDEN"};
  return{ok:true,tenantId:after.tenantId,briefId,canManage:body.can_manage,links,available,
    context:{lane:"campaign_brief",canonicalSource:"public.get_campaign_brief_assets",observedAt:observedAt.toISOString(),freshness:"current_canonical_projection",mindEligibility:"UNAVAILABLE",memoryRetention:"UNAVAILABLE"},
    note:"Original campaign composition only. Native available choices are at most200 per kind, not a complete inventory. Linking is not publishing, sending, approval of an email, spending or performance. Private member fields stay withheld."};
}

/** Caller-JWT original link writer + actor-scoped original ledger/readback + existing Rail. */
export async function executeVerifiedCampaignAssetMutation(input:{caller:CampaignBriefRpcPort;expectedTenantId:string;actorId:string;tool:CampaignAssetMutationToolName;args:Record<string,unknown>;readCommandReceipt:ReadCommandReceipt;recordRun:RecordRun;observedAt?:Date}):Promise<Record<string,unknown>>{
  const a=input.args,key=stringValue(a.idempotency_key);
  const fail=(code:string,persisted=false)=>({success:false,verified:false,mutationMayHavePersisted:persisted,code});
  if(!["campaign_asset_attach","campaign_asset_detach"].includes(input.tool)||!key||!UUID_RE.test(key)||!UUID_RE.test(input.expectedTenantId)||!UUID_RE.test(input.actorId)
    ||typeof a.briefId!=="string"||!UUID_RE.test(a.briefId)||typeof a.assetId!=="string"||!UUID_RE.test(a.assetId)||!assetKind(a.assetKind)
    ||Object.keys(a).some(name=>!["briefId","assetId","assetKind","idempotency_key"].includes(name)))return fail("CAMPAIGN_ASSET_ARGUMENTS_INVALID");
  if(typeof input.readCommandReceipt!=="function")return fail("CAMPAIGN_BRIEF_RECEIPT_READER_REQUIRED");
  const briefId=a.briefId.toLowerCase(),assetId=a.assetId.toLowerCase(),kind=a.assetKind;
  const before=await readCampaignBriefAssets({...input,briefId});
  if(before.ok===false)return fail(before.code);
  if(!before.canManage)return fail("CAMPAIGN_BRIEF_FORBIDDEN");
  let response:{data:unknown;error:RpcError};
  try{response=await input.caller.rpc("configure_campaign_brief_assets",{_tenant_id:before.tenantId,_command:{type:input.tool==="campaign_asset_attach"?"attach_asset":"detach_asset",briefId,assetKind:kind,assetId},_idempotency_key:key,_actor_kind:"paige"});}
  catch{return fail("CAMPAIGN_ASSET_WRITE_OUTCOME_UNKNOWN",true);}
  if(response.error){
    const known=["CAMPAIGN_ASSET_NOT_FOUND","CAMPAIGN_ASSET_KIND_INVALID","CAMPAIGN_ASSET_ARGUMENTS_INVALID"].find(code=>response.error?.message?.includes(code));
    const code=known??rpcCode(response.error,"CAMPAIGN_ASSET_WRITE_OUTCOME_UNKNOWN");return fail(code,code==="CAMPAIGN_ASSET_WRITE_OUTCOME_UNKNOWN");
  }
  const result=response.data,wanted=input.tool==="campaign_asset_attach";
  if(!assetObject(result)||result.ok!==true||result.brief_id!==briefId||result.asset_kind!==kind||result.asset_id!==assetId
    ||!(wanted?["attached","already_attached"]:["detached","not_attached"]).includes(String(result.outcome)))return fail("CAMPAIGN_ASSET_WRITE_RESULT_INVALID",true);
  const after=await readCampaignBriefAssets({...input,briefId});
  if(after.ok===false)return fail(after.code,true);
  if(!after.canManage)return fail("CAMPAIGN_BRIEF_FORBIDDEN",true);
  if(after.links.some(link=>link.briefId===briefId&&link.kind===kind&&link.id===assetId)!==wanted)return fail("CAMPAIGN_ASSET_READBACK_MISMATCH",true);
  let receipt:Record<string,unknown>|null;
  try{receipt=await input.readCommandReceipt({tenantId:after.tenantId,actorId:input.actorId,idempotencyKey:key});}
  catch{return fail("CAMPAIGN_BRIEF_RECEIPT_READ_FAILED",true);}
  if(!receipt||receipt.ok!==true||receipt.outcome!==result.outcome||receipt.brief_id!==briefId||receipt.asset_kind!==kind||receipt.asset_id!==assetId)return fail("CAMPAIGN_BRIEF_RECEIPT_READ_FAILED",true);
  const current=await readCanonicalList({...input,observedAt:input.observedAt??new Date()});
  if(current.ok===false)return fail(current.code,true);
  if(!current.canManage||!current.briefs.some(brief=>brief.id===briefId&&brief.lifecycleStatus!=="archived"))return fail("CAMPAIGN_BRIEF_FORBIDDEN",true);
  let recorded=false;
  for(let attempt=0;attempt<2&&!recorded;attempt++){try{recorded=await input.recordRun({tenantId:after.tenantId,actorId:input.actorId,capabilityKey:input.tool,outcome:"capability_succeeded",runId:key});}catch{recorded=false;}}
  const proof={source:"public.campaign_brief_command_results",runId:key,outcome:result.outcome};
  if(!recorded)return{success:false,verified:true,railRecorded:false,mutationMayHavePersisted:true,code:"CAMPAIGN_BRIEF_RAIL_WRITE_FAILED",receipt:proof,note:"Original campaign link verified; Rail evidence remains unconfirmed. Do not repeat the link mutation to repair evidence."};
  return{success:true,verified:true,railRecorded:true,asset:{briefId,kind,id:assetId,linked:wanted},receipt:proof,context:after.context,
    note:"Original campaign link and Rail verified. Nothing published, sent, approved for sending, spent or launched. A form link can change attribution/routing for future inquiries under the original native intake rules."};
}
