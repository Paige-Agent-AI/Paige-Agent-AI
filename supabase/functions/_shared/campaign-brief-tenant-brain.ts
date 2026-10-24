/**
 * Solo Tenant Brain — verified Campaign Brief create/revise.
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

export type CampaignBriefToolName = "campaign_brief_create" | "campaign_brief_revise";

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
  capabilityKey: CampaignBriefToolName;
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
  };
}

function commandFor(tool: CampaignBriefToolName, args: Record<string, unknown>): Record<string, unknown> {
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
  const expectedOutcome = input.tool === "campaign_brief_create" ? "created" : "updated";
  if (
    input.writeResult.ok === false || input.writeResult.outcome !== expectedOutcome ||
    !writeId || input.after.id !== writeId || !writeVersion || input.after.version !== writeVersion
  ) return false;
  if (input.tool === "campaign_brief_create" && input.after.lifecycleStatus !== "draft") return false;
  if (input.tool === "campaign_brief_revise" && input.before && input.after.lifecycleStatus !== input.before.lifecycleStatus) return false;

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
    outcome: input.tool === "campaign_brief_create" ? "created" : "updated",
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
