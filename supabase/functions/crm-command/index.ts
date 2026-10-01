import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { z } from "https://esm.sh/zod@3.22.4";
import { confirmFingerprint } from "../_shared/confirm-fingerprint.ts";
import { decideGovernedExecution } from "../_shared/paige-spine/governedExecution.ts";
import {
  CRM_ACTION_CAPABILITY as ACTION_CAPABILITY,
  canonicalizeCrmCommand,
  crmContactCreateNameIssue,
  crmApprovalSubject,
  crmCommandExecutionPayload,
  crmCommandLegacyReplaySource,
  type CanonicalCrmCommand,
  type CrmAction,
} from "../_shared/crm-command/catalog.ts";
import { parseExecutorError, executorFailureSpeech } from "../_shared/crm-command/executor-error.ts";
import { databaseAnswered } from "../_shared/approval-outcome.ts";
import { canonicalAppUrl, type CanonicalTier } from "../_shared/canonical-app-url.ts";
import { resolveCommandContactRefs } from "../_shared/crm-command/contact-refs.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};


type JsonObject = Record<string, unknown>;

const PREVIEW_REQUIRED_ACTIONS = new Set<CrmAction>([
  "contact.merge", "contact.hard_delete", "contact.bulk_update", "task.delete", "deal.delete",
]);

const actionSchema = z.custom<CrmAction>(
  (value): value is CrmAction => typeof value === "string"
    && Object.prototype.hasOwnProperty.call(ACTION_CAPABILITY, value),
  { message: "Unknown CRM action." },
);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected an ISO calendar date (YYYY-MM-DD).");

const commandSchema = z.object({
  action: actionSchema,
  contact_id: z.string().uuid().nullable().optional(),
  loser_contact_id: z.string().uuid().nullable().optional(),
  // The reference Paige is shown (a contact's account number). Resolved to contact_id inside the
  // caller's own workspace before anything else runs; see resolveContactReferences below.
  client_ref: z.string().trim().min(1).max(64).optional(),
  loser_client_ref: z.string().trim().min(1).max(64).optional(),
  expected_loser_updated_at: z.string().datetime({ offset: true }).optional(),
  target_ids: z.array(z.string().uuid()).min(1).max(200).optional(),
  target_client_refs: z.array(z.string().trim().min(1).max(64)).min(1).max(200).optional(),
  resolutions: z.record(z.enum(["survivor", "loser"])).optional(),
  preview_id: z.string().uuid().optional(),
  company_id: z.string().uuid().optional(),
  task_id: z.string().uuid().optional(),
  deal_id: z.string().uuid().optional(),
  stage_id: z.string().uuid().optional(),
  owner_user_id: z.string().uuid().nullable().optional(),
  title: z.string().trim().min(1).max(300).optional(),
  value_cents: z.number().int().nonnegative().optional(),
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  expected_close_date: dateSchema.optional(),
  offer_type: z.string().trim().max(120).optional(),
  tags: z.array(z.string().trim().min(1).max(80)).max(50).optional(),
  notes: z.string().max(10000).optional(),
  outcome_type: z.enum(["won", "lost", "not_fit", "closed_without_decision"] as const).optional(),
  outcome_date: dateSchema.optional(),
  pipeline_id: z.string().uuid().optional(),
  target_stage_id: z.string().uuid().optional(),
  expected_version: z.number().int().positive().optional(),
  expected_target_version: z.number().int().positive().optional(),
  reason: z.string().trim().max(500).optional(),
  expected_updated_at: z.string().datetime({ offset: true }).optional(),
  patch: z.record(z.unknown()).optional(),
}).strict().superRefine((command, ctx) => {
  const requireField = (field: keyof typeof command) => {
    if (command[field] === undefined) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [field], message: `${String(field)} is required for ${command.action}` });
  };
  // A contact is named by its id or by the client_ref a read returned; either satisfies the action.
  const requireContact = (idField: "contact_id" | "loser_contact_id", refField: "client_ref" | "loser_client_ref") => {
    if (command[idField] === undefined && command[refField] === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [refField], message: `${refField} or ${idField} is required for ${command.action}` });
    }
  };
  const namesContact = (command.action.startsWith("contact.") && !["contact.create", "contact.bulk_update"].includes(command.action))
    || ["company.create", "activity.log", "deal.assign_contact"].includes(command.action);
  if (command.client_ref !== undefined && !namesContact) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["client_ref"], message: `${command.action} does not name a contact.` });
  }
  if (command.loser_client_ref !== undefined && command.action !== "contact.merge") {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["loser_client_ref"], message: "loser_client_ref names the losing contact of a merge only." });
  }
  if (command.action.startsWith("contact.") && !["contact.create", "contact.bulk_update"].includes(command.action)) {
    requireContact("contact_id", "client_ref"); requireField("expected_updated_at");
  }
  if (command.action === "contact.merge") { requireContact("loser_contact_id", "loser_client_ref"); requireField("expected_loser_updated_at"); }
  if (command.action === "contact.bulk_update") {
    if (command.target_ids === undefined && command.target_client_refs === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["target_client_refs"], message: "target_client_refs or target_ids is required for contact.bulk_update" });
    }
    if (command.target_ids !== undefined && command.target_client_refs !== undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["target_client_refs"], message: "Name the contacts by target_client_refs or by target_ids, not both." });
    }
    requireField("patch");
  } else if (command.target_client_refs !== undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["target_client_refs"], message: "target_client_refs names the contacts of a bulk update only." });
  }
  if (["contact.assign_coach", "contact.assign_owner"].includes(command.action)) requireField("owner_user_id");
  if (command.action === "contact.link_company") requireField("company_id");
  if (command.action === "contact.create" || command.action === "contact.update" || command.action === "company.create" || command.action === "company.update") requireField("patch");
  if (["contact.create", "contact.update", "contact.bulk_update"].includes(command.action) && command.patch && Object.prototype.hasOwnProperty.call(command.patch, "tags")) {
    const tags = command.patch.tags;
    if (!Array.isArray(tags) || tags.length > 50 || tags.some((tag) => typeof tag !== "string" || tag.trim().length === 0 || tag.length > 80)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["patch", "tags"], message: "Contact tags must be an array of 1-80 character strings." });
    }
  }
  if (command.action === "company.create") requireContact("contact_id", "client_ref");
  if (command.action.startsWith("company.") && command.action !== "company.create") {
    requireField("company_id"); requireField("expected_updated_at");
  }
  if (command.action === "task.create") requireField("patch");
  if (command.action.startsWith("task.") && command.action !== "task.create") {
    requireField("task_id"); requireField("expected_updated_at");
  }
  if (["task.update", "task.assign", "task.reschedule"].includes(command.action)) requireField("patch");
  if (["task.create", "task.update"].includes(command.action) && command.patch && Object.prototype.hasOwnProperty.call(command.patch, "metadata")) {
    const metadata = command.patch.metadata;
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["patch", "metadata"], message: "Task metadata must be an object." });
    }
  }
  if (command.action === "activity.log") { requireContact("contact_id", "client_ref"); requireField("patch"); }
  if (command.action === "deal.create") { requireField("title"); requireField("pipeline_id"); requireField("stage_id"); }
  if (command.action === "deal.update") {
    requireField("deal_id"); requireField("expected_version");
    if (!["title", "value_cents", "currency", "expected_close_date", "offer_type", "tags", "notes"]
      .some((field) => command[field as keyof typeof command] !== undefined)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["action"], message: "At least one reversible deal field is required for deal.update." });
    }
    if (command.owner_user_id !== undefined || command.contact_id !== undefined || command.client_ref !== undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["action"], message: "Use the separately governed deal assignment action." });
    }
  }
  if (command.action === "deal.create" && command.owner_user_id !== undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["owner_user_id"], message: "Assign the deal owner through the separately governed action." });
  }
  if (command.action === "deal.assign_owner") { requireField("deal_id"); requireField("expected_version"); requireField("owner_user_id"); }
  if (command.action === "deal.assign_contact") { requireField("deal_id"); requireField("expected_version"); requireContact("contact_id", "client_ref"); }
  if (command.action === "deal.move") {
    requireField("deal_id"); requireField("pipeline_id"); requireField("target_stage_id"); requireField("expected_version"); requireField("expected_target_version");
  }
  if (command.action === "deal.close") { requireField("deal_id"); requireField("expected_version"); requireField("outcome_type"); }
  if (command.action === "deal.reopen") { requireField("deal_id"); requireField("expected_version"); requireField("target_stage_id"); }
  if (command.action === "deal.delete") { requireField("deal_id"); requireField("expected_version"); }
});

const bodySchema = z.object({
  command: commandSchema,
  legacy_command: commandSchema.optional(),
  legacy_idempotency_key: z.string().regex(/^[0-9a-f]{16}$/).optional(),
  legacy_supplied_idempotency_key: z.string().trim().min(1).max(192).optional(),
  idempotency_key: z.string().trim().min(1).max(192),
  approved_fingerprint: z.string().regex(/^[0-9a-f]{16}$/).optional(),
}).strict();

function object(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
}

function response(status: number, body: JsonObject): Response {
  return new Response(JSON.stringify(body), { status, headers: cors });
}

function summaryFor(command: z.infer<typeof commandSchema>, preview?: JsonObject | null): string {
  if (preview) {
    const affected = typeof preview.affected_count === "number" ? preview.affected_count
      : typeof preview.eligible_count === "number" ? preview.eligible_count : 1;
    const refused = typeof preview.refused_count === "number" ? preview.refused_count : 0;
    if (command.action === "contact.merge") {
      const survivor = object(preview.survivor); const loser = object(preview.loser);
      const dependencies = object(preview.dependency_counts);
      const transferEffects = object(preview.transfer_effects);
      const emailTransferSummary = transferEffects?.loser_email_cleared === true
        ? " The losing contact's email will be cleared after it is transferred."
        : "";
      const conflicts = Array.isArray(preview.conflicts) ? preview.conflicts : [];
      const conflictSummary = conflicts.map((item) => {
        const conflict = object(item);
        return `${String(conflict?.field ?? "field")}: ${String(conflict?.survivor ?? "empty")} / ${String(conflict?.loser ?? "empty")} → keep ${String(conflict?.resolution ?? "survivor")}`;
      }).join("; ");
      return `Merge contact ${String(loser?.client_ref ?? loser?.id ?? "(unknown)")} into ${String(survivor?.client_ref ?? survivor?.id ?? "(unknown)")}; reassign ${String(dependencies?.supported ?? 0)} supported dependent record(s), then archive the losing contact.${conflictSummary ? ` Conflict preview: ${conflictSummary}.` : " No conflicting populated fields were found."}${emailTransferSummary}`;
    }
    if (command.action === "contact.bulk_update") {
      const targets = Array.isArray(preview.eligible_targets) ? preview.eligible_targets.map((item) => object(item)?.client_ref ?? object(item)?.id).filter(Boolean) : [];
      const shown = targets.slice(0, 10).join(", ");
      const patch = object(preview.patch) ?? {};
      const patchSummary = Object.entries(patch).map(([field, value]) => `${field}=${JSON.stringify(value)}`).join(", ");
      return `Update exactly ${affected} eligible contact(s)${shown ? ` (${shown}${targets.length > 10 ? `, plus ${targets.length - 10} more` : ""})` : ""} with ${patchSummary || "no fields"}; ${refused} requested target(s) were refused or ineligible. Any version change before execution stops the whole write.`;
    }
    if (command.action === "contact.hard_delete") return `Permanently delete contact ${String(preview.client_ref ?? preview.record_id ?? "(unknown)")}. The server verified it is unlinked and has 0 dependencies; this cannot be undone.`;
    if (command.action === "task.delete") return `Permanently delete task ${String(preview.title ?? preview.record_id ?? "(unknown)")} (${String(preview.record_id ?? "unknown id")}). This cannot be undone.`;
    if (command.action === "deal.delete") {
      const dependencies = object(preview.dependency_counts) ?? {};
      return `Permanently delete deal ${String(preview.title ?? preview.record_id ?? "(unknown)")} (${String(preview.record_id ?? "unknown id")}); delete ${String(dependencies.activities ?? 0)} activity row(s), ${String(dependencies.automation_events ?? 0)} automation event(s), ${String(dependencies.move_approvals ?? 0)} move approval(s), and ${String(dependencies.outcomes ?? 0)} outcome row(s); detach ${String(dependencies.tasks ?? 0)} task(s) and ${String(dependencies.invoices ?? 0)} invoice(s). This cannot be undone.`;
    }
  }
  const contactName = command.client_ref ?? command.contact_id;
  const target = (command.action.startsWith("deal.") ? command.deal_id : undefined)
    ?? contactName ?? command.company_id ?? command.task_id ?? command.deal_id ?? "a new record";
  const commandPatch = object(command.patch);
  switch (command.action) {
    case "contact.assign_coach":
      return `Change contact ${target}'s coach to ${command.owner_user_id ?? "unassigned"}.`;
    case "contact.assign_owner":
      return `Change contact ${target}'s owner to ${command.owner_user_id ?? "unassigned"}.`;
    case "deal.assign_owner":
      return `Change deal ${target}'s owner to ${command.owner_user_id ?? "unassigned"}.`;
    case "deal.assign_contact":
      return `Change deal ${target}'s contact to ${contactName ?? "unassigned"}.`;
    case "deal.move":
      return `Move deal ${target} to stage ${command.target_stage_id} in pipeline ${command.pipeline_id}.`;
    case "deal.close":
      return `Close deal ${target} as ${command.outcome_type}${command.outcome_date ? ` on ${command.outcome_date}` : ""}${command.reason ? `; reason: ${command.reason}` : ""}.`;
    case "deal.reopen":
      return `Reopen deal ${target} in stage ${command.target_stage_id}.`;
    case "task.assign":
      return `Assign task ${target} to ${String(commandPatch?.assignee_user_id ?? "unassigned")}.`;
    case "task.cancel":
      return `Cancel task ${target}${command.reason ? `; reason: ${command.reason}` : ""}.`;
    case "deal.create":
      return `Add a deal "${typeof command.title === "string" && command.title.trim() ? command.title.trim().slice(0, 80) : "Untitled"}" to the pipeline.`;
    case "contact.create": {
      const patch = object(command.patch) ?? {};
      const named = [patch.first_name, patch.last_name].filter((v) => typeof v === "string" && String(v).trim()).map((v) => String(v).trim()).join(" ");
      const who = named || (typeof patch.entity_name === "string" && patch.entity_name.trim() ? patch.entity_name.trim() : "") || "a new contact";
      return `Add ${who} as a new contact.`;
    }
    case "company.create": {
      const patch = object(command.patch) ?? {};
      const name = typeof patch.name === "string" && patch.name.trim() ? patch.name.trim().slice(0, 80) : "a new company";
      return `Add "${name}" as a new company.`;
    }
    case "task.create":
      return `Create a task "${typeof command.title === "string" && command.title.trim() ? command.title.trim().slice(0, 80) : "Untitled"}".`;
    default: {
      // Never render the raw internal verb ("deal.create for …"). Compose from the action's
      // domain and verb so every catalogue action reads as a human sentence about the object.
      const [domain, verb] = command.action.split(".");
      const DOMAIN_NOUN: Record<string, string> = { contact: "contact", company: "company", task: "task", deal: "deal", activity: "record" };
      const VERB_PHRASE: Record<string, string> = {
        create: "Create a new", update: "Update the", move: "Move the", close: "Close the", reopen: "Reopen the",
        delete: "Delete the", archive: "Archive the", restore: "Restore the", merge: "Merge the",
        hard_delete: "Permanently delete the", bulk_update: "Bulk-update the", link: "Link the", unlink: "Unlink the",
        assign: "Assign the", assign_owner: "Reassign the", assign_coach: "Reassign the", assign_contact: "Reassign the",
        reschedule: "Reschedule the", complete: "Complete the", cancel: "Cancel the", log: "Log on the",
      };
      const noun = DOMAIN_NOUN[domain] ?? "record";
      return `${VERB_PHRASE[verb] ?? "Apply the requested change to"} ${noun} ${target}.`;
    }
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return response(405, { ok: false, code: "METHOD_NOT_ALLOWED" });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return response(401, { ok: false, code: "CRM_AUTH_REQUIRED" });

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceKey) return response(503, { ok: false, code: "CRM_SERVER_NOT_CONFIGURED" });

  const caller = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: { user }, error: authError } = await caller.auth.getUser();
  if (authError || !user) return response(401, { ok: false, code: "CRM_AUTH_INVALID" });

  type ParsedBody = z.infer<typeof bodySchema>;
  type CanonicalBody = Omit<ParsedBody, "command" | "legacy_command" | "legacy_idempotency_key" | "legacy_supplied_idempotency_key"> & {
    command: CanonicalCrmCommand<ParsedBody["command"]>;
    legacyCommand: Readonly<Record<string, unknown>> | null;
    legacyIdempotencyKey: string | null;
    legacySuppliedIdempotencyKey: string | null;
  };
  let body: CanonicalBody;
  try {
    const parsedBody = bodySchema.parse(await req.json());
    const canonicalCommand = canonicalizeCrmCommand(parsedBody.command);
    const legacyCommand = parsedBody.legacy_command
      ? crmCommandLegacyReplaySource(canonicalCommand, parsedBody.legacy_command)
      : null;
    if (parsedBody.legacy_command && !legacyCommand) throw new TypeError("CRM_COMMAND_LEGACY_REPLAY_UNSUPPORTED");
    if (parsedBody.legacy_idempotency_key && !legacyCommand) throw new TypeError("CRM_COMMAND_LEGACY_KEY_UNSUPPORTED");
    if (parsedBody.legacy_supplied_idempotency_key && canonicalCommand.action !== "contact.create") {
      throw new TypeError("CRM_COMMAND_LEGACY_SUPPLIED_KEY_UNSUPPORTED");
    }
    const contactNameIssue = crmContactCreateNameIssue(canonicalCommand);
    if (contactNameIssue) {
      throw new z.ZodError([{
        code: z.ZodIssueCode.custom,
        path: ["command", "patch", contactNameIssue],
        message: `CRM_CONTACT_NAME_INCOMPLETE:${contactNameIssue}`,
      }]);
    }
    body = {
      command: canonicalCommand,
      idempotency_key: parsedBody.idempotency_key,
      ...(parsedBody.approved_fingerprint ? { approved_fingerprint: parsedBody.approved_fingerprint } : {}),
      legacyCommand,
      legacyIdempotencyKey: parsedBody.legacy_idempotency_key ?? null,
      legacySuppliedIdempotencyKey: parsedBody.legacy_supplied_idempotency_key ?? null,
    };
  } catch (error) {
    return response(400, {
      ok: false,
      code: "CRM_COMMAND_INVALID",
      details: error instanceof z.ZodError ? error.issues.map((issue) => ({ path: issue.path.join("."), code: issue.code })) : undefined,
    });
  }

  const { data: tenantId, error: tenantError } = await caller.rpc("current_user_tenant_id");
  if (tenantError || typeof tenantId !== "string") {
    return response(403, { ok: false, code: "CRM_TENANT_REQUIRED" });
  }
  // Active account is mutable session state. Re-read it at the last responsible moment so
  // an account switch between request authentication, approval, and execution cannot write the
  // tenant that was active earlier in the request.
  const activeTenantStillMatches = async (): Promise<boolean> => {
    const { data, error } = await caller.rpc("current_user_tenant_id");
    return !error && data === tenantId;
  };

  const { data: member, error: memberError } = await admin.from("tenant_members")
    .select("role,status")
    .eq("tenant_id", tenantId)
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle();
  const role = typeof member?.role === "string" ? member.role : null;
  const accessAllowed = !memberError && ["owner", "admin"].includes(role ?? "");
  const { data: tenantRoute } = await admin.from("tenants")
    .select("account_number,account_type,parent_tenant_id")
    .eq("id", tenantId).maybeSingle();
  // THE REFERENCE PAIGE HOLDS, TURNED INTO THE CONTACT IT NAMES. Every read Paige makes gives her a
  // contact's client_ref, never its id; a command naming contacts that way is resolved inside the
  // caller's own workspace before anything is decided, cached, approved or executed
  // (_shared/crm-command/contact-refs.ts). Skipped for a caller the decision below refuses anyway,
  // so a caller without CRM authority learns nothing about which references exist.
  if (accessAllowed) {
    const resolution = await resolveCommandContactRefs(admin, tenantId, body.command, "crm-command");
    if (!resolution.ok) {
      return response(resolution.status, {
        ok: false, outcome: "refused", code: resolution.code, detail: resolution.detail,
        ...executorFailureSpeech(resolution.code, resolution.detail, "refused"),
      });
    }
  }
  const capability = ACTION_CAPABILITY[body.command.action];
  const requestArgs = { command: body.command, idempotency_key: body.idempotency_key };
  const readbackCommand = crmCommandExecutionPayload(body.command, body.legacyCommand);
  const successfulResultResponse = (resultObject: JsonObject, action: string): Response => {
    const readback = object(resultObject.readback);
    const destination = action.startsWith("deal.") ? "pipeline" : action.startsWith("task.") ? "tasks" : "contacts";
    const accountType = typeof tenantRoute?.account_type === "string" ? tenantRoute.account_type : "standalone";
    const tier: CanonicalTier = tenantRoute?.parent_tenant_id ? "sub_account"
      : accountType === "agency" ? "agency" : accountType === "enterprise" ? "enterprise" : "solo";
    const surfaceUrl = canonicalAppUrl({ actor: "account", tier, account: tenantRoute?.account_number ?? null, destination });
    // The current Solo routers own unified People/business focus (`?person=`) and Pipeline deal
    // focus (`?deal=`). CRM tasks still have no human record router, so task actions return only
    // the truthful Command Center surface URL and explicitly label it surface_only.
    const recordId = typeof readback?.id === "string" && readback.absent !== true ? readback.id : null;
    const deepLink = surfaceUrl && tier === "solo" && recordId && action.startsWith("contact.")
      ? `${surfaceUrl}?person=${encodeURIComponent(recordId)}`
      : surfaceUrl && tier === "solo" && recordId && action.startsWith("deal.")
        ? `${surfaceUrl}?deal=${encodeURIComponent(recordId)}` : null;
    return response(200, {
      ...resultObject,
      capability,
      record_locator: {
        surface: action.startsWith("deal.") ? "campaigns" : action.startsWith("task.") ? "command-center" : "clients",
        tab: action.startsWith("deal.") ? "pipeline" : action.startsWith("task.") ? "tasks" : "people",
        record_id: readback?.id ?? null,
        surface_url: surfaceUrl,
        deep_link: deepLink,
        deep_link_status: deepLink ? "exact" : surfaceUrl ? "surface_only" : "unavailable",
      },
    });
  };

  // A committed command whose HTTP response was lost is a readback, not a second mutation.
  // Recover it before the approval decision so an identical retry never asks the operator to
  // approve the already-completed action again. The service-only RPC revalidates the tenant,
  // active account, membership, actor, and exact command hash before returning anything.
  if (accessAllowed && await activeTenantStillMatches()) {
    const readbackKeys = [...new Set([
      body.idempotency_key,
      body.legacyIdempotencyKey,
      body.legacySuppliedIdempotencyKey,
    ].filter((key): key is string => Boolean(key)))];
    for (const readbackKey of readbackKeys) {
      const { data: cachedData, error: cachedError } = await admin.rpc("read_crm_command_result", {
        _tenant_id: tenantId,
        _actor_id: user.id,
        _command: readbackCommand,
        _idempotency_key: readbackKey,
      });
      const cachedResult = object(cachedData);
      if (!cachedError && cachedResult) return successfulResultResponse(cachedResult, body.command.action);
      if (cachedError) {
        const { code, detail } = parseExecutorError(cachedError.message, "CRM_READBACK_UNAVAILABLE");
        const status = code === "CRM_IDEMPOTENCY_REUSE" || code === "CRM_ACTIVE_ACCOUNT_CHANGED"
          ? 409
          : code === "CRM_FORBIDDEN"
          ? 403
          : 503;
        return response(status, {
          ok: false, outcome: "refused", code,
          ...(detail.length ? { detail } : {}),
          ...executorFailureSpeech(code, detail, "unproven"),
        });
      }
    }
  }

  let lane = "unresolved";
  const { data: resolvedLane, error: laneError } = await caller.rpc("resolve_tool_autonomy", {
    _tenant_id: tenantId,
    _tool_key: capability,
  });
  if (!laneError && typeof resolvedLane === "string" && ["auto", "confirm", "off"].includes(resolvedLane)) {
    lane = resolvedLane;
  }
  // The canonical Pipeline stage can require an operator card even when the ordinary move tool's
  // stored lane is auto. Resolve that server-owned policy before the Gateway decision so a protected
  // move proposes confirmation instead of reaching the executor with a standing-autonomy stamp.
  if (body.command.action === "deal.move" && lane === "auto") {
    const { data: targetStage, error: targetStageError } = await admin.from("pipeline_stages")
      .select("move_policy")
      .eq("id", body.command.target_stage_id!)
      .eq("tenant_id", tenantId)
      .eq("pipeline_id", body.command.pipeline_id!)
      .maybeSingle();
    if (targetStageError || !targetStage) lane = "unresolved";
    else if (targetStage.move_policy === "approval") lane = "confirm";
  }

  const requestNonce = crypto.randomUUID();
  let claimedArgs: JsonObject | null | undefined;
  if (body.approved_fingerprint !== undefined) {
    claimedArgs = null;
    const { data: claimed, error: claimError } = await admin.from("paige_pending_confirmations")
      .update({ consumed_at: new Date().toISOString() })
      .eq("user_id", user.id)
      .eq("tenant_id", tenantId)
      .eq("tool_name", capability)
      .eq("fingerprint", body.approved_fingerprint)
      .is("thread_id", null)
      .is("scoped_client_id", null)
      .is("consumed_at", null)
      .not("server_issued_at", "is", null)
      .not("issued_in_request", "is", null)
      .neq("issued_in_request", requestNonce)
      .gt("expires_at", new Date().toISOString())
      .select("args")
      .maybeSingle();
    const stored = object(claimed?.args);
    if (!claimError && stored) claimedArgs = stored;
  }

  const decision = decideGovernedExecution({
    caller: {
      authenticated: true,
      userId: user.id,
      principal: "person",
      tenantId,
      tenantSource: "server",
      door: "other",
      access: { allowed: accessAllowed, reason: "An active owner, admin, or assigned coach role is required." },
    },
    capability: {
      id: capability,
      effect: "mutate",
      outcomeChannel: "record_capability_run",
      availability: "unknown",
    },
    approval: {
      autonomyLane: lane,
      ...(claimedArgs !== undefined ? { claimedArgs, claimedFor: capability } : {}),
    },
    requestArgs,
  });

  const decidedRequest = decision.kind === "execute" ? object(decision.args) : null;
  const auditedCommand = object(decidedRequest?.command) ?? body.command;
  const auditedAction = typeof auditedCommand.action === "string" ? auditedCommand.action : body.command.action;
  const auditedContactId = typeof auditedCommand.contact_id === "string" ? auditedCommand.contact_id : null;
  const auditedCompanyId = typeof auditedCommand.company_id === "string" ? auditedCommand.company_id : null;
  const auditedTaskId = typeof auditedCommand.task_id === "string" ? auditedCommand.task_id : null;
  const auditedDealId = typeof auditedCommand.deal_id === "string" ? auditedCommand.deal_id : null;

  const auditPayload = {
    capability,
    command_action: auditedAction,
    effect: "mutate",
    principal: "person",
    decision: decision.kind,
    refusal_code: decision.kind === "refuse" ? decision.code : null,
    risk: decision.risk,
    lane_requested: decision.audit.laneRequested,
    lane_effective: decision.audit.laneEffective,
    clamped: decision.audit.clamped,
  };
  const { error: auditError } = await admin.from("paige_audit_log").insert({
    actor_user_id: user.id,
    actor_role: `crm:${role ?? "none"}`,
    action: "crm.governed_decision",
    target_type: auditedAction.startsWith("contact.") ? "contact" : auditedAction.startsWith("company.") ? "company" : auditedAction.startsWith("task.") ? "task" : auditedAction.startsWith("deal.") ? "deal" : "activity",
    target_id: auditedContactId ?? auditedCompanyId ?? auditedTaskId ?? auditedDealId,
    tenant_id: tenantId,
    payload: auditPayload,
  });

  if (decision.kind === "refuse") {
    return response(403, { ok: false, outcome: "refused", code: decision.code, message: decision.message, audit_recorded: !auditError });
  }
  if (auditError) {
    return response(503, { ok: false, outcome: "refused", code: "CRM_DECISION_RECEIPT_FAILED" });
  }

  if (decision.kind === "propose") {
    if (!(await activeTenantStillMatches())) {
      return response(409, { ok: false, outcome: "refused", code: "CRM_ACTIVE_ACCOUNT_CHANGED", message: "The active workspace changed. Reopen the record there before trying again." });
    }
    const approvalSubject = await crmApprovalSubject(body.command.action, body.command as Record<string, unknown>);
    let proposalArgs: JsonObject = { ...requestArgs, approval_subject: approvalSubject };
    let preview: JsonObject | null = null;
    let proposalExpiresAt: string | undefined;
    if (PREVIEW_REQUIRED_ACTIONS.has(body.command.action)) {
      const { data: previewData, error: previewError } = await admin.rpc("preview_crm_command", {
        _tenant_id: tenantId,
        _actor_id: user.id,
        _command: body.command,
        _preview_key: `${body.idempotency_key}:preview`,
      });
      preview = object(previewData);
      if (previewError || !preview) {
        const { code, detail } = parseExecutorError(previewError?.message, "CRM_PREVIEW_FAILED");
        return response(code.includes("VERSION_CONFLICT") ? 409 : 422, {
          ok: false, outcome: "failed", code,
          ...(detail.length ? { detail } : {}),
          ...executorFailureSpeech(code, detail, "refused"),
        });
      }
      if (preview.ok === true && preview.outcome === "succeeded") {
        return successfulResultResponse(preview, body.command.action);
      }
      if (preview.eligible !== true) {
        return response(422, { ok: false, outcome: "refused", code: "CRM_PREVIEW_INELIGIBLE", preview });
      }
      if (typeof preview.preview_id !== "string" || typeof preview.expires_at !== "string") {
        return response(503, { ok: false, outcome: "refused", code: "CRM_PREVIEW_BINDING_FAILED" });
      }
      const previewExpiresAt = Date.parse(preview.expires_at);
      if (!Number.isFinite(previewExpiresAt) || previewExpiresAt <= Date.now() + 60_000) {
        return response(503, { ok: false, outcome: "refused", code: "CRM_PREVIEW_BINDING_FAILED" });
      }
      // The approval expires first, leaving the transaction a one-minute execution cushion.
      proposalExpiresAt = new Date(previewExpiresAt - 60_000).toISOString();
      proposalArgs = {
        command: { action: body.command.action, preview_id: preview.preview_id },
        idempotency_key: body.idempotency_key,
        approval_subject: approvalSubject,
      };
    }
    const fingerprint = await confirmFingerprint(capability, proposalArgs);
    const summary = summaryFor(body.command, preview);
    // The canonical live-row uniqueness predicate includes expired-but-unconsumed confirmations.
    // Retire an exact expired server-issued row before insertion so abandonment can be retried; a
    // concurrent request either inserts the replacement or reads that same active replacement below.
    const proposalNow = new Date().toISOString();
    const { error: expiredProposalError } = await admin.from("paige_pending_confirmations")
      .update({ consumed_at: proposalNow })
      .eq("user_id", user.id)
      .eq("tenant_id", tenantId)
      .eq("tool_name", capability)
      .eq("fingerprint", fingerprint)
      .is("thread_id", null)
      .is("scoped_client_id", null)
      .is("consumed_at", null)
      .not("server_issued_at", "is", null)
      .not("issued_in_request", "is", null)
      .lte("expires_at", proposalNow);
    if (expiredProposalError) return response(503, { ok: false, outcome: "refused", code: "CRM_APPROVAL_STORE_UNAVAILABLE" });
    let { data: proposal, error: proposalError } = await admin.from("paige_pending_confirmations").insert({
      user_id: user.id,
      tenant_id: tenantId,
      thread_id: null,
      scoped_client_id: null,
      tool_name: capability,
      fingerprint,
      issued_in_request: requestNonce,
      server_issued_at: new Date().toISOString(),
      args: proposalArgs,
      summary,
      ...(proposalExpiresAt ? { expires_at: proposalExpiresAt } : {}),
    }).select("summary,expires_at").maybeSingle();
    if (proposalError?.code === "23505") {
      const existing = await admin.from("paige_pending_confirmations")
        .select("summary,expires_at")
        .eq("user_id", user.id)
        .eq("tenant_id", tenantId)
        .eq("tool_name", capability)
        .eq("fingerprint", fingerprint)
        .is("thread_id", null)
        .is("scoped_client_id", null)
        .is("consumed_at", null)
        .not("server_issued_at", "is", null)
        .gt("expires_at", new Date().toISOString())
        .maybeSingle();
      proposal = existing.data;
      proposalError = existing.error;
    }
    if (proposalError || !proposal) return response(503, { ok: false, outcome: "refused", code: "CRM_APPROVAL_STORE_UNAVAILABLE" });
    return response(202, {
      ok: false,
      outcome: "approval_required",
      fingerprint,
      idempotency_key: body.idempotency_key,
      summary: proposal.summary ?? summary,
      expires_at: proposal.expires_at ?? null,
      revalidate: decision.revalidate,
      ...(preview ? { preview } : {}),
    });
  }

  const decidedArgs = decidedRequest;
  const decidedCommand = object(decidedArgs?.command);
  const decidedKey = decidedArgs?.idempotency_key;
  if (!decidedCommand || typeof decidedKey !== "string") {
    return response(403, { ok: false, outcome: "refused", code: "CRM_APPROVAL_CLAIM_INVALID" });
  }

  if (!(await activeTenantStillMatches())) {
    return response(409, { ok: false, outcome: "refused", code: "CRM_ACTIVE_ACCOUNT_CHANGED", message: "The active workspace changed. Nothing was executed; reopen the record in the current workspace." });
  }
  const canonicalExecutionCommand = canonicalizeCrmCommand({
    ...decidedCommand,
    approval_channel: decision.audit.laneEffective === "confirm" ? "operator_card" : "standing_autonomy_setting",
  });
  const executionCommand = crmCommandExecutionPayload(canonicalExecutionCommand, body.legacyCommand);
  const { data: result, error: commandError } = await admin.rpc("execute_crm_command", {
    _tenant_id: tenantId,
    _actor_id: user.id,
    _command: executionCommand,
    _idempotency_key: decidedKey,
  });
  if (commandError) {
    const { code, detail } = parseExecutorError(commandError.message, "CRM_COMMAND_FAILED");
    // No database code: the answer never came back, and the command may have committed. The
    // same code (the audit row is unchanged), but never "nothing was created".
    if (!databaseAnswered(commandError)) {
      return response(503, { ok: false, outcome: "failed", code, ...executorFailureSpeech(code, [], "lost") });
    }
    if (code === "CRM_COMPANY_OWNER_SETUP_REQUIRED") return response(409, { ok: false, outcome: "setup_required", code, message: "This CRM-only contact needs an active tenant owner before a company can be created. Restore or assign the workspace owner, then retry." });
    if (code === "CRM_TASK_CONTACT_LINK_UNAVAILABLE") return response(409, { ok: false, outcome: "setup_required", code, message: "The canonical task model does not yet own a contact relationship. Create the task without a contact link, or use a supported company/deal link." });
    return response(code.includes("VERSION_CONFLICT") ? 409 : 422, {
      ok: false, outcome: "failed", code,
      ...(detail.length ? { detail } : {}),
      ...executorFailureSpeech(code, detail, "refused"),
    });
  }

  // The call returned without an error, so it committed; an answer nobody can read says nothing
  // about what it did.
  const resultObject = object(result) ?? { ok: false, outcome: "failed", outcome_unknown: true };
  const action = typeof decidedCommand.action === "string" ? decidedCommand.action : body.command.action;
  return successfulResultResponse(resultObject, action);
});
