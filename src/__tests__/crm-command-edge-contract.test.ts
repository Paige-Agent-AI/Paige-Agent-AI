import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const edge = readFileSync("supabase/functions/crm-command/index.ts", "utf8");
const catalog = readFileSync("supabase/functions/_shared/crm-command/catalog.ts", "utf8");
const identityMigrationPath = "supabase/migrations/20270523000000_crm_contact_name_idempotency.sql";
const originalCrmMigration = readFileSync("supabase/migrations/20270204000000_governed_crm_contact_company_commands.sql", "utf8");

describe("canonical CRM action door", () => {
  it("accepts no tenant, actor, role, or account identity from the request", () => {
    expect(edge).toContain("bodySchema");
    expect(edge).toContain("}).strict()");
    expect(edge).not.toMatch(/tenant_id:\s*z\./);
    expect(edge).not.toMatch(/actor_id:\s*z\./);
    expect(edge).not.toMatch(/actor_role:\s*z\./);
    expect(edge).toContain("owner_user_id: z.string().uuid().nullable().optional()");
    expect(edge).toContain("caller.auth.getUser()");
    expect(edge).toContain('caller.rpc("current_user_tenant_id")');
    expect(edge.match(/caller\.rpc\("current_user_tenant_id"\)/g)?.length).toBeGreaterThanOrEqual(2);
    expect(edge).toContain("CRM_ACTIVE_ACCOUNT_CHANGED");
    expect(edge).toContain("idempotency_key: z.string().trim().min(1).max(192)");
    expect(edge).toContain("Task metadata must be an object.");
  });

  it("canonicalizes a create-contact command before any readback, policy, approval, or write seam", () => {
    expect(edge).toContain("canonicalizeCrmCommand");
    const parsedAt = edge.indexOf("bodySchema.parse(await req.json())");
    const canonicalizedAt = edge.indexOf("const canonicalCommand = canonicalizeCrmCommand(parsedBody.command)");
    const tenantAt = edge.indexOf('caller.rpc("current_user_tenant_id")');
    const readbackAt = edge.indexOf('admin.rpc("read_crm_command_result"');
    const laneAt = edge.indexOf('caller.rpc("resolve_tool_autonomy"');
    const executeAt = edge.indexOf('admin.rpc("execute_crm_command"');
    expect(parsedAt).toBeGreaterThan(-1);
    expect(canonicalizedAt).toBeGreaterThan(parsedAt);
    expect(canonicalizedAt).toBeLessThan(tenantAt);
    expect(canonicalizedAt).toBeLessThan(readbackAt);
    expect(canonicalizedAt).toBeLessThan(laneAt);
    expect(canonicalizedAt).toBeLessThan(executeAt);
  });

  it("refuses an incomplete person name before tenant resolution or service-role work", () => {
    expect(catalog).toContain("export function crmContactCreateNameIssue");
    const canonicalizedAt = edge.indexOf("const canonicalCommand = canonicalizeCrmCommand(parsedBody.command)");
    const nameGuardAt = edge.indexOf("crmContactCreateNameIssue(canonicalCommand)");
    const tenantAt = edge.indexOf('caller.rpc("current_user_tenant_id")');
    expect(canonicalizedAt).toBeGreaterThan(-1);
    expect(nameGuardAt).toBeGreaterThan(canonicalizedAt);
    expect(nameGuardAt).toBeLessThan(tenantAt);
    expect(edge).toContain("CRM_CONTACT_NAME_INCOMPLETE");
  });

  it("binds each command to an existing classified capability", () => {
    for (const capability of ["crm_create_contact", "crm_update_contact", "crm_archive_contact", "crm_restore_contact", "crm_link_contact_company", "crm_unlink_contact_company", "crm_assign_coach", "crm_assign_contact_owner", "crm_merge_contacts", "crm_hard_delete_contact", "crm_bulk_update_contacts", "crm_create_company", "crm_update_company", "crm_archive_company", "crm_restore_company", "crm_create_task", "crm_update_task", "crm_assign_task", "crm_reschedule_task", "crm_complete_task", "crm_reopen_task", "crm_cancel_task", "crm_delete_task", "crm_log_activity", "deal_create", "crm_update_deal", "crm_assign_deal_owner", "crm_assign_deal_contact", "deal_move_stage", "crm_close_deal", "crm_reopen_deal", "crm_delete_deal"]) {
      expect(catalog).toContain(`"${capability}"`);
    }
    expect(edge).toContain("CRM_ACTION_CAPABILITY as ACTION_CAPABILITY");
    expect(edge).toContain("decideGovernedExecution({");
    expect(edge).toContain('outcomeChannel: "record_capability_run"');
  });

  it("resolves role and autonomy on the server and fails closed", () => {
    expect(edge).toContain('.from("tenant_members")');
    expect(edge).toContain('.eq("tenant_id", tenantId)');
    expect(edge).toContain('.eq("user_id", user.id)');
    expect(edge).toContain('.eq("status", "active")');
    expect(edge).toContain('caller.rpc("resolve_tool_autonomy"');
    expect(edge).toContain('let lane = "unresolved"');
    expect(edge).toContain('targetStage.move_policy === "approval"');
    expect(edge).toContain('.lte("expires_at", proposalNow)');
  });

  it("reuses the canonical single-use confirmation store", () => {
    expect(edge).toContain('.from("paige_pending_confirmations")');
    expect(edge).toContain("consumed_at");
    expect(edge).toContain("server_issued_at");
    expect(edge).toContain("issued_in_request");
    expect(edge).toContain("confirmFingerprint(capability, proposalArgs)");
    expect(edge).toContain('admin.rpc("preview_crm_command"');
    expect(edge).toContain("command: { action: body.command.action, preview_id: preview.preview_id }");
    expect(edge).toContain("previewExpiresAt - 60_000");
    expect(edge).toContain("expires_at: proposalExpiresAt");
    expect(edge).toContain('preview.ok === true && preview.outcome === "succeeded"');
    expect(edge).toContain("return successfulResultResponse(preview, body.command.action)");
    expect(edge).toContain('admin.rpc("read_crm_command_result"');
    expect(edge).toContain("if (accessAllowed && await activeTenantStillMatches())");
    expect(edge).not.toContain("!PREVIEW_REQUIRED_ACTIONS.has(body.command.action)");
    expect(edge.indexOf('admin.rpc("read_crm_command_result"')).toBeLessThan(edge.indexOf('caller.rpc("resolve_tool_autonomy"'));
    expect(edge).toContain("if (cachedError) {");
    expect(edge).toContain('code === "CRM_FORBIDDEN"');
    expect(edge).toContain('"CRM_READBACK_UNAVAILABLE"');
    expect(edge).not.toMatch(/confirm:\s*z\.boolean/);
  });

  it("dispatches only to the service-only executor and returns its readback locator", () => {
    expect(edge).toContain('admin.rpc("execute_crm_command"');
    expect(edge).toContain("_tenant_id: tenantId");
    expect(edge).toContain("_actor_id: user.id");
    expect(edge).toContain("record_locator");
    expect(edge).toContain("const canonicalExecutionCommand = canonicalizeCrmCommand({");
    expect(edge).toContain("const executionCommand = crmCommandExecutionPayload(canonicalExecutionCommand, body.legacyCommand)");
    expect(edge).toContain('approval_channel: decision.audit.laneEffective');
    expect(edge).not.toContain('decidedCommand.action.startsWith("deal.")');
    expect(edge).toContain("readback");
    expect(edge).toContain('outcome: "setup_required"');
    expect(edge).toContain("CRM_TASK_CONTACT_LINK_UNAVAILABLE");
    expect(edge).toContain("canonical task model does not yet own a contact relationship");
  });

  it("renders exact consequential approval summaries and only labels owned record routes exact", () => {
    for (const action of ["contact.assign_coach", "contact.assign_owner", "deal.assign_owner", "deal.assign_contact", "deal.move", "deal.close", "deal.reopen", "task.assign", "task.cancel"]) {
      expect(edge).toContain(`case "${action}"`);
    }
    expect(edge).toContain('recordId && action.startsWith("contact.")');
    expect(edge).not.toContain('action.startsWith("contact.") || action.startsWith("company.")');
    expect(edge).toContain('At least one reversible deal field is required for deal.update.');
    expect(edge).toContain('Contact tags must be an array of 1-80 character strings.');
    expect(edge).toContain('["contact.create", "contact.update", "contact.bulk_update"].includes(command.action)');
    expect(edge).toContain('Object.prototype.hasOwnProperty.call(command.patch, "tags")');
    expect(edge).toContain('const patchSummary = Object.entries(patch)');
    expect(edge).toContain('preview.client_ref ?? preview.record_id');
    expect(edge).toContain('preview.title ?? preview.record_id');
    expect(edge).toContain('dependencies.tasks ?? 0');
    expect(edge).toContain("transferEffects?.loser_email_cleared === true");
    expect(edge).toContain("The losing contact's email will be cleared after it is transferred.");
  });

  it("records the governed decision without CRM field values", () => {
    expect(edge).toContain('.from("paige_audit_log").insert({');
    expect(edge).toContain('action: "crm.governed_decision"');
    expect(edge).toContain("command_action");
    expect(edge).not.toMatch(/auditPayload\s*=\s*\{[^}]*patch/s);
  });

  it("uses one canonical identity projection for Edge readback and database replay hashing", () => {
    expect(catalog).toContain("crmCommandExecutionPayload");
    expect(edge).toContain("crmCommandExecutionPayload");
    expect(edge).toContain("_command: readbackCommand");
    expect(edge).toContain("_command: executionCommand");
    expect(edge).not.toMatch(/__paige_canonical_identity_v1\s*:\s*z\./);
    expect(existsSync(identityMigrationPath)).toBe(true);
    if (!existsSync(identityMigrationPath)) return;
    const migration = readFileSync(identityMigrationPath, "utf8");
    expect(migration).toContain("__paige_canonical_identity_v1");
    expect(migration).toContain("public.crm_effective_command(_command)::text");
    expect(migration).toContain("create or replace function public.crm_command_hash_matches");
    expect(migration).toMatch(
      /_command->>'action'='contact\.create'[\s\S]*_stored_hash=pg_catalog\.encode\([\s\S]*\(_command-'__paige_canonical_identity_v1'-'__paige_legacy_display_v1'\)::text/,
    );
    expect(migration.match(/public\.crm_command_hash_matches\(v_cached\.command_hash/g)).toHaveLength(4);
    expect(migration).toContain("CRM_CONTACT_NAME_INCOMPLETE");
    expect(migration).toMatch(/new_contact_create constant text := 'if .*CRM_CONTACT_NAME_INCOMPLETE.*public\.create_contact_v2/s);
    const predecessor = "v_hash := encode(extensions.digest(convert_to(_command::text, 'UTF8'), 'sha256'), 'hex');";
    expect(originalCrmMigration.split(predecessor)).toHaveLength(2);
    expect(migration).toContain("CRM_IDEMPOTENCY_HASH_PATCH_DRIFT");
    expect(migration).toContain("else _command-'__paige_canonical_identity_v1'-'__paige_legacy_display_v1'");
  });

  it("carries an equivalent raw display command through the authenticated action door for legacy replay", () => {
    const migration = readFileSync(identityMigrationPath, "utf8");
    const parsedAt = edge.indexOf("bodySchema.parse(await req.json())");
    const legacyValidationAt = edge.indexOf("crmCommandLegacyReplaySource(canonicalCommand, parsedBody.legacy_command)");
    const tenantAt = edge.indexOf('caller.rpc("current_user_tenant_id")');

    expect(edge).toContain("legacy_command: commandSchema.optional()");
    expect(legacyValidationAt).toBeGreaterThan(parsedAt);
    expect(legacyValidationAt).toBeLessThan(tenantAt);
    expect(edge).toContain("crmCommandExecutionPayload(body.command, body.legacyCommand)");
    expect(edge).toContain("crmCommandExecutionPayload(canonicalExecutionCommand, body.legacyCommand)");
    expect(migration).toContain("__paige_legacy_display_v1");
    expect(migration).toMatch(/_stored_hash=pg_catalog\.encode\([\s\S]*_command->'__paige_legacy_display_v1'/);
  });

  it("uses the legacy fallback key only for authorized completed-result readback", () => {
    const parsedAt = edge.indexOf("bodySchema.parse(await req.json())");
    const legacyValidationAt = edge.indexOf("crmCommandLegacyReplaySource(canonicalCommand, parsedBody.legacy_command)");
    const tenantAt = edge.indexOf('caller.rpc("current_user_tenant_id")');
    const canonicalReadAt = edge.indexOf("for (const readbackKey of readbackKeys)");
    const laneAt = edge.indexOf('caller.rpc("resolve_tool_autonomy"');
    const executeAt = edge.indexOf('admin.rpc("execute_crm_command"');

    expect(edge).toContain("legacy_idempotency_key: z.string().regex(/^[0-9a-f]{16}$/).optional()");
    expect(edge).toContain("CRM_COMMAND_LEGACY_KEY_UNSUPPORTED");
    expect(legacyValidationAt).toBeGreaterThan(parsedAt);
    expect(legacyValidationAt).toBeLessThan(tenantAt);
    expect(canonicalReadAt).toBeGreaterThan(tenantAt);
    expect(canonicalReadAt).toBeLessThan(laneAt);
    expect(edge).toContain("body.legacyIdempotencyKey");
    expect(edge).toContain("_idempotency_key: readbackKey");
    expect(edge).not.toMatch(/requestArgs\s*=\s*\{[^}]*legacy_idempotency_key/s);
    expect(edge).not.toMatch(/execute_crm_command[\s\S]{0,300}_idempotency_key:\s*body\.legacyIdempotencyKey/);
    expect(executeAt).toBeGreaterThan(laneAt);
  });

  it("uses a pre-rollout supplied contact-create key only for authorized completed-result readback", () => {
    const parsedAt = edge.indexOf("bodySchema.parse(await req.json())");
    const tenantAt = edge.indexOf('caller.rpc("current_user_tenant_id")');
    const canonicalReadAt = edge.indexOf("for (const readbackKey of readbackKeys)");
    const laneAt = edge.indexOf('caller.rpc("resolve_tool_autonomy"');

    expect(edge).toContain("legacy_supplied_idempotency_key: z.string().trim().min(1).max(192).optional()");
    expect(edge).toContain("CRM_COMMAND_LEGACY_SUPPLIED_KEY_UNSUPPORTED");
    expect(edge).toContain("body.legacySuppliedIdempotencyKey");
    expect(edge).toContain("body.legacySuppliedIdempotencyKey,\n    ].filter");
    expect(canonicalReadAt).toBeGreaterThan(parsedAt);
    expect(canonicalReadAt).toBeGreaterThan(tenantAt);
    expect(canonicalReadAt).toBeLessThan(laneAt);
    expect(edge).not.toMatch(/requestArgs\s*=\s*\{[^}]*legacy_supplied_idempotency_key/s);
    expect(edge).not.toMatch(/execute_crm_command[\s\S]{0,300}_idempotency_key:\s*body\.legacySuppliedIdempotencyKey/);
  });
});
