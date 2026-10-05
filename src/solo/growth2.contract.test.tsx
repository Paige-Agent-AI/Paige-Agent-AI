import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(process.cwd(), "src/solo/growth2.tsx"), "utf8");
const commandDesk = readFileSync(resolve(process.cwd(), "src/solo/PipelineCommandDesk.tsx"), "utf8");
const css = readFileSync(resolve(process.cwd(), "src/solo/solo-campaigns.css"), "utf8");
const adapter = readFileSync(resolve(process.cwd(), "src/solo/useSoloCampaigns.ts"), "utf8");
const pipelineSettings = readFileSync(resolve(process.cwd(), "src/pages/admin/PipelineSettings.tsx"), "utf8");
const closingStageMigration = readFileSync(resolve(process.cwd(), "supabase/migrations/20261205000000_a_stage_can_be_marked_closing.sql"), "utf8");
const pipelineAdmin = readFileSync(resolve(process.cwd(), "src/pages/admin/PipelineAdmin.tsx"), "utf8");
const contactDeals = readFileSync(resolve(process.cwd(), "src/components/admin/contacts/ContactDealsSection.tsx"), "utf8");
const stageAutomationRules = readFileSync(resolve(process.cwd(), "src/pages/admin/StageAutomationRules.tsx"), "utf8");
const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/20260831180000_solo_pipeline_board_contract.sql"), "utf8");
const routingMigration = readFileSync(resolve(process.cwd(), "supabase/migrations/20260831193000_solo_pipeline_routing_evidence.sql"), "utf8");
const dealGuardMigration = readFileSync(resolve(process.cwd(), "supabase/migrations/20260831194500_solo_pipeline_deal_tenant_guard.sql"), "utf8");
const taskGuardMigration = readFileSync(resolve(process.cwd(), "supabase/migrations/20260831195500_solo_pipeline_task_tenant_guard.sql"), "utf8");
const concurrencyMigration = readFileSync(resolve(process.cwd(), "supabase/migrations/20260831203500_solo_pipeline_concurrency_guards.sql"), "utf8");
const invariantMigration = readFileSync(resolve(process.cwd(), "supabase/migrations/20260831205000_solo_pipeline_invariant_guards.sql"), "utf8");
const archiveMigration = readFileSync(resolve(process.cwd(), "supabase/migrations/20260831210000_solo_pipeline_archive_serialization.sql"), "utf8");
const visibilityMigration = readFileSync(resolve(process.cwd(), "supabase/migrations/20260831211500_solo_pipeline_visibility_guard.sql"), "utf8");
const directArchiveMigration = readFileSync(resolve(process.cwd(), "supabase/migrations/20260831213000_solo_pipeline_direct_archive_guard.sql"), "utf8");
const reorderMigration = readFileSync(resolve(process.cwd(), "supabase/migrations/20260831214500_solo_pipeline_reorder_serialization.sql"), "utf8");
const defaultCreatorMigration = readFileSync(resolve(process.cwd(), "supabase/migrations/20260831220000_solo_pipeline_default_creator_lock.sql"), "utf8");
const defaultSetterMigration = readFileSync(resolve(process.cwd(), "supabase/migrations/20260831221500_solo_pipeline_default_setter_lock.sql"), "utf8");
const activeReorderMigration = readFileSync(resolve(process.cwd(), "supabase/migrations/20260831223000_solo_pipeline_active_reorder.sql"), "utf8");
const pipelineManagementMigration = readFileSync(resolve(process.cwd(), "supabase/migrations/20260831224500_solo_pipeline_governed_management.sql"), "utf8");
const pipelineIdentityMigration = readFileSync(resolve(process.cwd(), "supabase/migrations/20260901045935_pipeline_identity_catalogue.sql"), "utf8");
const pipelineFoldersMigration = readFileSync(resolve(process.cwd(), "supabase/migrations/20260901144648_solo_pipeline_folders.sql"), "utf8");
const submissionProcessor = readFileSync(resolve(process.cwd(), "supabase/functions/growth-process-submission/index.ts"), "utf8");
const paigeChat = readFileSync(resolve(process.cwd(), "supabase/functions/paige-ai-chat/index.ts"), "utf8");
const paigeChatSurface = readFileSync(resolve(process.cwd(), "src/components/dashboard/PaigeAIChat.tsx"), "utf8");
const paigeMcp = readFileSync(resolve(process.cwd(), "supabase/functions/paige-mcp/index.ts"), "utf8");

describe("Solo Campaigns approved contract", () => {
  it("renders the owner's nine Marketing tabs, with no Planned marker in the strip", () => {
    // Owner ruling 2026-10-04: "these are the ones that I want dedicated to marketing". Audience,
    // Content, Email and Ads carry no marker in the strip (owner, 2026-10-04: no redundant words).
    const tabBlock = /const tabs=\[([\s\S]*?)\];/.exec(source)?.[1] ?? "";
    expect([...tabBlock.matchAll(/\['([^']+)','([^']+)'/g)].map((match) => match.slice(1, 3))).toEqual([
      ["overview", "Overview"],
      ["campaigns", "Campaigns"],
      ["audience", "Audience"],
      ["content", "Content"],
      ["social", "Social"],
      ["email", "Email"],
      ["ads", "Ads"],
      ["capture", "Lead capture"],
      ["analytics", "Analytics"],
    ]);
    expect(tabBlock).not.toMatch(/'planned'/);
    expect([...tabBlock.matchAll(/\['([^']+)','[^']+',\(\)=>[^,\]]+,'sales'\]/g)].map((match) => match[1])).toEqual([]);
    expect(tabBlock).not.toMatch(/Active|Brand Kit|Pages|Funnels|Forms|Builders/);
  });

  it("keeps creative ownership in the existing generic Vibe Studio seam", () => {
    expect(source).toContain("detail:{returnFocus:event.currentTarget}");
    expect(source).toContain("data-solo-vibe-studio-launcher");
    expect(source).toContain(">Vibe Studio</button>");
    expect(source).not.toMatch(/initialSection|assetId|studioMode|returnRoute/);
    expect(source).not.toMatch(/New campaign|New post|New form|Publish now|Edit creative/);
  });

  it("owns truthful compatibility landings for every retired creative address", () => {
    for (const slug of ["brand-kit", "pages", "funnels", "forms", "builders"]) {
      expect(source).toMatch(new RegExp(`(?:"${slug}"|\\b${slug}:)`));
    }
    expect(source).toContain("This address moved");
    expect(source).toContain("Go to Lead capture");
    expect(source).toContain("Your workspace and account stay selected");
  });

  it("does not render the retired Campaigns fixture data", () => {
    expect(source).not.toContain("DATA.campaigns");
    expect(source).not.toContain("DATA.pipeline");
    expect(source).not.toContain("$8,400");
    // Owner ruling 2026-09-23. The four capability states still exist and are still stated —
    // Performance coverage is built on saying what can and cannot be reported — but in the
    // customer's words. RE-POINTED to guard the translation, so the release vocabulary cannot
    // drift back onto a surface a coach uses.
    for (const plain of ["Available", "Partly available", "Planned", "Not available"]) expect(source).toContain(plain);
    for (const internal of [">LIVE<", ">PARTIAL<", ">PROPOSED<", ">UNAVAILABLE<"]) expect(source).not.toContain(internal);
  });

  it("fails closed on tenant identity and contains read-only tenant filters", () => {
    expect(adapter).toContain("accountContextLoading");
    expect(adapter).toContain("if (!activeTenantId)");
    expect(adapter.match(/\.eq\("tenant_id", activeTenantId\)/g)).toHaveLength(4);
    expect(adapter).not.toContain('functions.invoke("tenant-campaigns"');
    expect(adapter).toMatch(/supabase\s*\.rpc\(\s*"get_pipeline_routing_evidence"/s);
    expect(routingMigration).toContain("from public.growth_form_automations a");
    expect(routingMigration).toContain("from public.growth_submission_dispatches d");
    expect(routingMigration).toContain("a.autonomy_lane");
    expect(routingMigration).not.toMatch(/limit\s+200/i);
    expect(adapter).toContain('effective_autonomy_lane === "confirm"');
    expect(adapter).toContain('effective_autonomy_lane === "off"');
    expect(adapter).toContain('"Human-only" as const');
    expect(adapter).toContain('"Active + approval-gated" as const');
    expect(adapter).toContain('"Active + approval-gated + human-only" as const');
    expect(adapter).toContain("if (!current) return");
    expect(adapter).not.toMatch(/\.(insert|update|upsert|delete)\(/);
  });

  it("contains keyboard, reduced-motion, forced-colors, and overflow safeguards", () => {
    expect(source).toContain("event.key === \"Escape\"");
    expect(source).toContain('role="dialog"');
    expect(source).toContain('aria-modal="true"');
    expect(source).toContain('setAttribute("inert", "")');
    expect(css).toContain("prefers-reduced-motion");
    expect(css).toContain("forced-colors");
    expect(css).toContain("overflow-x: clip");
  });

  it("lets the Pipeline board use available vertical canvas without changing its compact-stage behavior", () => {
    expect(css).toContain("min-height:clamp(330px,calc(100dvh - 390px),560px)");
    expect(css).toMatch(/@media\(max-width:1100px\)\{[^}]*\.pipeline-stage-focus\{display:block\}[^}]*\.pipeline-board\{display:block\}/);
    expect(css).toContain("overflow-x:clip");
  });

  it("keeps Campaigns navigation and heading bands on the shared theme canvas", () => {
    expect(css).toMatch(/\.solo-campaigns\{[^}]*background:var\(--pg-canvas\)/);
    expect(css).toMatch(/\.campaigns-nav\{[^}]*background:var\(--pg-canvas\)/);
    expect(css).toMatch(/\.campaigns-scroll>\.pg-hd\{[^}]*background:transparent/);
  });

  it("implements the approved tenant-owned Pipeline contract without a fixed campaign or sales taxonomy", () => {
    expect(commandDesk).toContain('eyebrow="Deal workspace"');
    expect(commandDesk).toContain("New deal");
    expect(source).toContain("Create blank pipeline");
    expect(source).toContain("Add custom stage");
    expect(source).toContain("Start with zero stages");
    expect(source + commandDesk).not.toMatch(/>\s*(Use starter stages|Start from preset|Simple starter)\s*</i);
    expect(source).toContain("Pipeline configuration");
    expect(source).toContain("Back to board");
    expect(source).toContain("Ask PAIGE");
    expect(source).toContain("Add a stage");
    expect(commandDesk).toContain("Focused stage");
    expect(commandDesk).toMatch(/folderFilter\s*===\s*"all"\s*\?\s*activePipelines\[0\]/s);
    expect(commandDesk).toContain("Routing, approvals, and repair evidence");
    expect(source).not.toMatch(/pipeline.*revenue|pipeline.*ROI|pipeline.*payment/i);
    expect(pipelineManagementMigration).not.toContain("_default_stages");
    expect(pipelineManagementMigration).toContain("'preset_used',false");
  });

  it("gives duplicate and zero-deal pipelines immutable, tenant-safe catalogue identities", () => {
    expect(pipelineIdentityMigration).toContain("short_ref");
    expect(pipelineIdentityMigration).toContain("PIPELINE_ID_IMMUTABLE");
    expect(pipelineIdentityMigration).toContain("PIPELINE_REFERENCE_IMMUTABLE");
    expect(pipelineIdentityMigration).toContain("unique (tenant_id,short_ref)");
    expect(pipelineIdentityMigration).toContain("where tenant_id is null");
    expect(pipelineIdentityMigration).toContain("PIPELINE_TENANT_REQUIRED");
    expect(pipelineIdentityMigration).toContain("extensions.gen_random_bytes(1)");
    expect(pipelineIdentityMigration).not.toContain("PIPELINE_TENANT_BACKFILL_REQUIRED");
    expect(pipelineIdentityMigration).toContain("get_pipeline_catalogue");
    expect(pipelineIdentityMigration).toContain("stage_count");
    expect(pipelineIdentityMigration).toContain("deal_count");
    expect(pipelineIdentityMigration).toContain("prepare_pipeline_archive_as_paige");
    expect(pipelineIdentityMigration).toContain("configure_tenant_pipeline_as_paige");
    expect(pipelineIdentityMigration).toContain("PIPELINE_ARCHIVE_REFERENCE_MISMATCH");
    expect(pipelineIdentityMigration).toContain("PIPELINE_ARCHIVE_CONFIRMATION_REQUIRED");
    expect(pipelineIdentityMigration).toContain("drop policy if exists pipelines_coach_read");
    expect(source).toContain("pipeline.shortRef");
    expect(source).toContain("pipeline.dealCount");
    expect(adapter).toContain("short_ref");
    expect(paigeChat).toContain('name: "pipeline_catalogue"');
    expect(paigeChat).toContain('name: "pipeline_archive_preview"');
    expect(pipelineIdentityMigration).toContain("revoke insert,update,delete on public.pipelines,public.pipeline_stages from authenticated");
    expect(pipelineIdentityMigration).toContain("PIPELINE_HARD_DELETE_UNAVAILABLE");
    // REWRITTEN 2026-09-02 onto the one approval gate. This test used to assert a
    // pipeline-specific approval channel — a `confirmedActions` echo carrying a token, and a
    // string comparison against the operator's last message. Both were removed when the two
    // branches merged, because the general fingerprint gate already binds an approval to the
    // exact call, and prose a model can produce is not evidence a person approved anything.
    // What the archive still has, and no other action does, is a server-issued preview it is
    // bound to — asserted below as a PRECONDITION, not as a second approval.
    expect(paigeChat).toContain("previewPredatesTurn");
    expect(paigeChat).toContain("archive_preview_required");
    // Bound to THIS tenant and THIS requester, single-use, expiring: the four properties that
    // make the binding a real precondition rather than a flag.
    expect(paigeChat).toContain('.eq("token", token).eq("tenant_id", tenantId).eq("requested_by", user.id)');
    expect(paigeChat).toContain("archiveBinding.used_at");
    expect(paigeChat).toContain("new Date(archiveBinding.expires_at).getTime() <= Date.now()");
    // The pipeline that gets archived is read from the binding row, never from a name or a
    // reference the model supplied — which is what makes a same-named duplicate unreachable.
    expect(paigeChat).toContain('.eq("id", archiveBinding.pipeline_id).eq("tenant_id", tenantId)');
    // The second approval channel is gone from both sides of the wire.
    expect(paigeChat).not.toMatch(/hasExactPipelineArchiveApproval\(/);
    expect(paigeChatSurface).not.toMatch(/confirmedActions|approvalToken|pipelineRef/);
    // …and what replaced it: the fingerprint of the exact call, echoed by the surface.
    expect(paigeChatSurface).toContain("approvedConfirmations");
    expect(paigeChatSurface).toContain("declinedConfirmations");
    expect(source).not.toContain("Delete pipeline");
    expect(source).not.toContain("Delete stage");
  });

  // REMOVED 2026-09-02, with its subject: `hasExactPipelineArchiveApproval` and the
  // `supabase/functions/_shared/pipelineArchiveApproval.ts` module it lived in. It matched a
  // client-supplied approval list against a token and a PPL reference, and it was the only
  // caller of that module once the merge settled on the general gate (§58 — recorded here
  // rather than deleted quietly, because a removed guard should leave a note saying what now
  // holds the property).
  //
  // The property it protected — an approval for one pipeline cannot archive its same-named
  // duplicate — is now structural instead of compared: the archive resolves its target from
  // the server's own binding row (`archiveBinding.pipeline_id`, scoped to tenant and
  // requester), so a name was never the thing being trusted. Asserted directly above.

  it("binds a folder archive to its own server-issued preview, not to a client-echoed approval", () => {
    // REPLACES a test of `hasExactPipelineFolderArchiveApproval`, removed with the second
    // approval channel it exercised (#718 rebuilt for folders what #709 had built for
    // pipelines; both are now the one fingerprint gate). The property that test protected —
    // an approval for one folder cannot archive another, or the same folder under a stale
    // name — is now structural rather than compared, and asserted against the handler.
    expect(paigeChat).not.toMatch(/hasExactPipelineFolderArchiveApproval\(/);
    expect(paigeChat).not.toMatch(/ownerApprovedThisTurn/);
    // Bound to THIS tenant and THIS requester, single-use, expiring, and it must predate the
    // turn — minting a preview and acting on it in one breath is the turn approving itself.
    expect(paigeChat).toContain('.eq("token", token).eq("tenant_id", tenantId).eq("requested_by", user.id)');
    expect(paigeChat).toContain("folderBinding.used_at");
    expect(paigeChat).toContain("folder_archive_preview_required");
    // The folder that gets archived is the one the preview named, so a model cannot re-title
    // it on the confirming turn and archive something the owner never read.
    expect(paigeChat).toContain("folder_archive_preview_mismatch");
    expect(paigeChat).toContain('.eq("id", folderBinding.folder_id).eq("tenant_id", tenantId)');
  });

  it("implements tenant-owned one-level Pipeline folders through the governed contract", () => {
    expect(pipelineFoldersMigration).toContain("create table public.pipeline_folders");
    expect(pipelineFoldersMigration).not.toContain("parent_id");
    expect(pipelineFoldersMigration).toContain("lifecycle_status");
    expect(pipelineFoldersMigration).toContain("folder_id uuid");
    expect(pipelineFoldersMigration).toContain("foreign key (tenant_id,folder_id)");
    expect(pipelineFoldersMigration).toContain("enable row level security");
    expect(pipelineFoldersMigration).toContain("revoke insert,update,delete on public.pipeline_folders,public.pipelines from authenticated");
    for (const action of ["create_folder", "rename_folder", "archive_folder", "restore_folder", "move_pipeline_to_folder"]) {
      expect(pipelineFoldersMigration + adapter + source).toContain(action);
    }
    expect(pipelineFoldersMigration).toContain("'folders'");
    expect(pipelineFoldersMigration).toContain("'unfiled_count'");
    expect(pipelineFoldersMigration).toContain("set folder_id=null");
    expect(pipelineFoldersMigration).toContain("'active_pipeline_count'");
    expect(pipelineFoldersMigration).toContain("'archived_pipeline_count'");
    expect(pipelineFoldersMigration).toContain("'active_pipelines_moved_to_unfiled'");
    expect(pipelineFoldersMigration).toContain("'archived_pipelines_moved_to_unfiled'");
    expect(pipelineFoldersMigration).toMatch(/select count\(\*\)::int into _count from public\.pipelines where tenant_id=_tenant_id and folder_id=_folder\.id;/);
    expect(pipelineFoldersMigration).not.toMatch(/expected_pipeline_count[\s\S]{0,500}lifecycle_status<>'archived'/);
    expect(source).toContain("keep the current lifecycle status");
    expect(paigeChat).toContain("keeps its current lifecycle status");
    expect(pipelineFoldersMigration).toContain("PIPELINE_FOLDER_TENANT_MISMATCH");
    expect(pipelineFoldersMigration).toContain("PIPELINE_FOLDER_OWNER_REQUIRED");
    expect(pipelineFoldersMigration).toContain("pipeline_folder_archive_confirmations");
    expect(pipelineFoldersMigration).toContain("prepare_pipeline_folder_archive_as_paige");
    expect(pipelineFoldersMigration).toContain("expected_pipeline_count");
    expect(pipelineFoldersMigration).toContain("used_at=now()");
    expect(pipelineFoldersMigration).toContain("_cached.command_hash<>_hash");
    expect(pipelineFoldersMigration).toContain("return _cached.result||jsonb_build_object");
    expect(pipelineFoldersMigration).toContain("replay_pipeline_folder_archive_as_paige");
    expect(pipelineFoldersMigration).toContain("'replayed',true");
    expect(pipelineFoldersMigration).toContain("lower(btrim(name))<>'unfiled'");
    expect(adapter).toContain("can_archive_folders");
    expect(pipelineFoldersMigration).toContain("pipeline_command_results");
    expect(pipelineFoldersMigration).toContain("audit_logs");
    expect(source).toContain("Unfiled");
    expect(source).toContain("Folder organizer");
    expect(source).toContain("Archive folder");
    expect(source).toContain("Direct PAIGE");
    expect(source).toContain("Only the workspace owner can archive a folder");
    expect(paigeChat).toContain('name: "pipeline_folder_archive_preview"');
    // The folder archive's APPROVAL is asserted in its own test above, against the one
    // fingerprint gate. This line used to pin the retired echo and was updated with it,
    // rather than deleted: what belongs in THIS test is the folder contract, which is the
    // replay guard that makes an archive retry safe.
    expect(paigeChat).toContain("replay_pipeline_folder_archive_as_paige");
    expect(paigeChat).toContain("folder_archive_replay_refused");
    expect(paigeChat).toContain("a._folderArchive.pipeline_count");
    // The replay guard runs BEFORE the preview lookup, so a retry of a committed archive is
    // answered from its recorded result rather than by burning a second single-use preview.
    expect(paigeChat.indexOf('gateAdmin.rpc("replay_pipeline_folder_archive_as_paige"')).toBeLessThan(paigeChat.indexOf('.from("pipeline_folder_archive_confirmations")'));
    // The `kind: "pipeline_folder_archive"` discriminator that used to be asserted here on both
    // the handler and the surface belonged to the retired approval echo, not to folders. The
    // surface carries no folder-specific approval shape now — one fingerprint covers every
    // gated action — so asserting its ABSENCE is what keeps the channel from being rebuilt.
    expect(paigeChatSurface).not.toMatch(/pipeline_folder_archive|approvalKind|folderName\?:/);
    expect(css).toContain(".pipeline-action-new");
    expect(css).toContain(".pipeline-action-manage");
    expect(css).toContain(".pipeline-action-folders");
    expect(css).toContain("translateY(-2px)");
  });

  it("uses callable tenant-safe reads and writes for the complete stage lifecycle", () => {
    for (const contract of ["get_pipeline_workspace", "get_pipeline_routing_evidence", "configure_tenant_pipeline"]) {
      expect(adapter + migration + routingMigration).toContain(contract);
    }
    for (const action of ["create_pipeline", "update_pipeline", "activate_pipeline", "archive_pipeline", "restore_pipeline", "create_stage", "update_stage", "archive_stage", "restore_stage", "reorder_stages", "move_deal"]) {
      expect(adapter + source + pipelineManagementMigration).toContain(action);
    }
    expect(migration).toContain("PIPELINE_STAGE_OCCUPIED");
    expect(migration).toContain("public.is_tenant_admin(_tenant)");
    expect(migration).toContain("revoke all on function public.get_pipeline_workspace(uuid) from public,anon");
    expect(dealGuardMigration).toContain("c.id=d.contact_client_id and c.tenant_id=_tenant");
    expect(dealGuardMigration).toContain("DEAL_CLIENT_TENANT_MISMATCH");
    expect(dealGuardMigration).toContain("trg_validate_deal_tenant_links");
    expect(taskGuardMigration).toContain("t.tenant_id=_tenant");
    expect(taskGuardMigration).toContain("TASK_DEAL_TENANT_MISMATCH");
    expect(taskGuardMigration).toContain("trg_validate_task_deal_tenant_link");
    expect(concurrencyMigration).toContain("pg_advisory_xact_lock(hashtextextended('pipeline-default:'||_tenant::text,0))");

    // ── The closing-stage seam, and the one trap that would make it a silent no-op ────────────
    //
    // useSoloCampaigns forwards the command object VERBATIM (no serializer), and every key this
    // RPC already reads is camelCase. If the RPC read `stage_type` instead of `stageType` the
    // value would be NULL, the absent-value rule would write 'open', and the UI would report a
    // successful save that changed nothing. The sibling `create_pipeline_with_stages` DOES read
    // snake_case, so that is the exact line someone copies. These pin the correct spelling.
    expect(closingStageMigration).toContain("_command->>'stageType'");
    expect(closingStageMigration).toContain("_proposed_stage->>'stageType'");
    expect(closingStageMigration).not.toContain("_command->>'stage_type'");
    expect(closingStageMigration).not.toContain("_proposed_stage->>'stage_type'");
    // Raise on an unrecognised value rather than coerce it to 'open' — stage_type has no safe
    // fallback direction, unlike movePolicy whose coercion lands on the stricter value.
    expect(closingStageMigration).toContain("PIPELINE_STAGE_TYPE_INVALID");
    // Update must PRESERVE on absent. An unconditional overwrite would silently reopen a closing
    // stage on any edit that did not resend the field.
    expect(closingStageMigration).toContain("stage_type=coalesce(nullif(_command->>'stageType',''),_stage.stage_type)");
    // The value has to come back out, or it is written and unverifiable (§70).
    expect(closingStageMigration).toContain("'stage_type',s.stage_type");
    // §59/§9: replace, never drop+create — a drop resets EXECUTE to PUBLIC on a DEFINER function
    // that is deliberately revoked.
    expect(closingStageMigration).toContain("create or replace function public.get_pipeline_workspace_pre_identity");
    expect(closingStageMigration).not.toMatch(/drop function public\.(get_pipeline_workspace_pre_identity|configure_tenant_pipeline_core_identity)/);
    // PAIGE must be able to drive it (§10), and the tenant must be told why a refusal happened.
    expect(adapter).toContain("PIPELINE_STAGE_TYPE_INVALID");
    expect(concurrencyMigration).toContain("pg_advisory_xact_lock(hashtextextended('pipeline-stage-order:'||_pipeline::text,0))");
    expect(invariantMigration).toContain("target.executor in ('contact_upsert','pipeline_attach','client_rail_event','notify_team') then 'auto'");
    expect(invariantMigration).toContain("s.archived_at is null");
    expect(invariantMigration).toContain("DEAL_STAGE_INVALID_OR_ARCHIVED");
    expect(invariantMigration).toContain("trg_serialize_pipeline_stage_insert");
    expect(invariantMigration).toContain("pg_advisory_xact_lock(hashtextextended('pipeline-stage-order:'||new.pipeline_id::text,0))");
    expect(archiveMigration).toContain("for share");
    expect(archiveMigration).toContain("where id=_stage_id for update");
    // Admission now owns stage advance + durable binding in one transaction.
    const admission = readFileSync(resolve(process.cwd(), "supabase/migrations/20270588326001_solo_form_deal_identity.sql"), "utf8");
    expect(submissionProcessor).toContain('admin.rpc("growth_attach_submission_deal"');
    expect(submissionProcessor).toContain('if(attachError || !attached) return {status:"error",result:{},error:"submission_deal_admission_failed"}');
    expect(admission).toContain("archived_at IS NULL FOR SHARE");
    expect(admission).toContain("UPDATE public.deals SET stage_id=stage WHERE id=deal.id RETURNING * INTO deal");
    expect(admission).toContain("UPDATE public.growth_form_submissions SET deal_id=deal.id WHERE id=sub.id");
    expect(admission.indexOf("UPDATE public.deals SET stage_id=stage")).toBeLessThan(admission.indexOf("UPDATE public.growth_form_submissions SET deal_id=deal.id"));
    expect(visibilityMigration).toContain("_deal_admin or (_is_coach");
    expect(visibilityMigration).toContain("d.owner_user_id=_caller");
    expect(visibilityMigration).toContain("dc.assigned_coach_user_id=_caller");
    expect(visibilityMigration).toContain("_task_admin or t.user_id=_caller");
    expect(visibilityMigration).toContain("_client_admin or (_is_coach");
    expect(directArchiveMigration).toContain("_deal_admin:=public.is_platform_owner()");
    expect(directArchiveMigration).toContain("trg_prevent_occupied_stage_archive");
    expect(directArchiveMigration).toContain("old.archived_at is null and new.archived_at is not null");
    expect(directArchiveMigration).toContain("exists(select 1 from public.deals d where d.stage_id=old.id)");
    expect(reorderMigration).toContain("pg_advisory_xact_lock(hashtextextended('pipeline-stage-order:'||_pipeline_id::text,0))");
    expect(source).toContain("[data.tenantId]");
    expect(source).toContain('setNewPipeline({name:"",description:"",stages:[]})');
    expect(adapter).toContain("state.tenantId === synchronousTenantId");
    expect(adapter).toMatch(/synchronousTenantId\s*\?\s*\("loading" as const\)/s);
    expect(pipelineSettings).toContain('rpc("reorder_pipeline_stages" as never');
    expect(pipelineSettings).not.toContain('supabase.from("pipeline_stages").update({ order_index:');
    expect(pipelineAdmin).toContain('.eq("pipeline_id", pid).is("archived_at", null).order("order_index")');
    expect(defaultCreatorMigration).toContain("create or replace function public.create_pipeline_with_stages");
    expect(defaultCreatorMigration).toContain("if _is_default then\n    perform pg_advisory_xact_lock(hashtextextended('pipeline-default:'||_tenant::text,0));");
    expect(pipelineSettings).toContain('rpc("set_default_pipeline" as never');
    expect(pipelineSettings).not.toContain("update({ is_default:");
    expect(defaultSetterMigration).toContain("pg_advisory_xact_lock(hashtextextended('pipeline-default:'||_tenant::text,0))");
    expect(contactDeals).toContain('from("pipeline_stages").select("*").eq("tenant_id", activeTenantId).is("archived_at", null)');
    expect(stageAutomationRules).toContain('.eq("pipeline_id", pid).is("archived_at", null)');
    expect(paigeChat.match(/\.is\("archived_at", null\)/g)?.length).toBeGreaterThanOrEqual(2);
    expect(paigeMcp).toContain('.eq("tenant_id", tenantId)\n        .is("archived_at", null)');
    expect(activeReorderMigration).toContain("array_agg(order_index order by order_index)");
    expect(activeReorderMigration).toContain("s.archived_at is null");
  });

  it("reduces only the Pipeline page title and preserves the board/card geometry", () => {
    expect(css).toContain('.solo-campaigns[data-campaigns-view="pipeline"] .campaigns-scroll>.pg-hd h1{font-size:20px}');
    expect(css).toContain(".pipeline-board{");
    expect(css).toContain(".pipeline-card{");
  });

  it("implements governed drag, keyboard, compact move, and portal-unavailable contracts", () => {
    expect(commandDesk).toContain('draggable={canManage}');
    expect(commandDesk).toMatch(/event\.dataTransfer\.setData\(\s*"text\/pipeline-deal"/s);
    expect(commandDesk).toContain('event.key === " "');
    expect(commandDesk).toContain('event.key === "Escape"');
    expect(commandDesk).toContain("Move stage");
    expect(commandDesk).toContain('moving={busy}');
    expect(commandDesk).toContain("No portal activity source connected");
    expect(commandDesk).toContain("Send customer invite");
    expect(commandDesk).toContain("Client portal is not available yet");
    expect(adapter).toContain('name = "configure_tenant_pipeline"');
    expect(pipelineManagementMigration).toContain("PIPELINE_VERSION_CONFLICT");
    expect(pipelineManagementMigration).toContain("pipeline_command_results");
    expect(pipelineManagementMigration).toContain("record_rail_event");
    expect(pipelineManagementMigration).toContain("PIPELINE_DEPENDENCIES_UNRESOLVED");
  });
});
