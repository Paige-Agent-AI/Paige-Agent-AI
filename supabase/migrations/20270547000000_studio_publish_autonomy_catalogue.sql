-- Migration E (Vibe Studio V2b) — the five new Studio publish acts get autonomy-settings rows and
-- named lines on the Rail. Owner authorized 2026-10-04 ("Authorize Migration E").
--
-- The acts: growth_page_unpublish, growth_funnel_unpublish, growth_form_unpublish,
-- studio_image_publish, studio_image_unpublish. Their RPCs already exist (20270537000000); the
-- growth-publish-command door runs them for both the Studio panel and the chat, and records each
-- run via recordCapabilityRun. All five are HIGH in _shared/action-risk.ts: they change what the
-- public can see, so the runtime clamp keeps them ask-first whatever mode is stored.
--
-- 1. _workspace_event_display. The five keys read what happened, for every outcome the function
--    distinguishes, instead of "Completed a step for you". Unknown keys keep the generic line.
--    Every other answer is unchanged. Presentation only.
--
-- 2. list_tool_autonomy. Five rows in the Studio category so the owner can see and set them.
--    No other row changes.
--
-- Reversibility: two function bodies are replaced; no table, column, row or grant changes.
-- Reverting means restoring both bodies from 20270546000000.
--
-- Proof: supabase/tests/migration_e_studio_publish_catalogue.sql
--        (.github/workflows/migration-e-studio-publish-catalogue.yml).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. _workspace_event_display — carried forward VERBATIM from the live body (prod md5
--    3a9888e9db334b177ab9d71acc2f60dc, = 20270546000000) plus named lines for the five acts.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._workspace_event_display(_source_kind text, _outcome text, _capability text)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_catalog AS $$
DECLARE
  title text; summary text;
  dept text := 'owner_ops';
  actor text := 'system';
  done text; try text;
BEGIN
  IF _source_kind IN ('zapier_api_oauth','zapier_api_connection','zapier_mcp_connection','zapier_skool_intake') THEN
    RETURN public._zapier_workspace_event_display(_outcome);
  END IF;

  IF _source_kind IN ('oauth_attempt','mcp_connection') THEN
    BEGIN
      RETURN public._n8n_workspace_event_display(_outcome);
    EXCEPTION WHEN invalid_parameter_value THEN
      NULL;
    END;
  END IF;

  IF _source_kind = 'capability_run' THEN
    actor := 'paige_agent';

    CASE _capability
      WHEN 'n8n_run_workflow'         THEN done:='Ran an automation'; try:='run an automation';
      WHEN 'n8n_create_workflow'      THEN done:='Created an automation'; try:='create an automation';
      WHEN 'n8n_update_workflow'      THEN done:='Changed an automation'; try:='change an automation';
      WHEN 'n8n_activate_workflow'    THEN done:='Turned an automation on'; try:='turn an automation on';
      WHEN 'n8n_deactivate_workflow'  THEN done:='Turned an automation off'; try:='turn an automation off';
      WHEN 'n8n_archive_workflow'     THEN done:='Archived an automation'; try:='archive an automation';
      WHEN 'zapier_run_action'        THEN done:='Ran a connected app action'; try:='run a connected app action';
      WHEN 'comms_buy_number'         THEN done:='Bought a phone number'; try:='buy a phone number';
      WHEN 'comms_name_number'        THEN done:='Renamed a phone number'; try:='rename a phone number';
      WHEN 'comms_set_primary_number' THEN done:='Changed which number you send from'; try:='change which number you send from';
      WHEN 'comms_draft_registration' THEN done:='Drafted your carrier registration'; try:='draft your carrier registration';
      WHEN 'campaign_brief_create'    THEN done:='Verified a Campaign Brief planning record was created'; try:='create and verify a Campaign Brief planning record';
      WHEN 'campaign_brief_revise'    THEN done:='Verified a Campaign Brief planning record was revised'; try:='revise and verify a Campaign Brief planning record';
      WHEN 'growth_page_save'         THEN done:='Saved your landing page'; try:='save your landing page';
      WHEN 'growth_page_publish'      THEN done:='Published your landing page'; try:='publish your landing page';
      WHEN 'growth_funnel_build'      THEN done:='Built your funnel'; try:='build your funnel';
      WHEN 'growth_funnel_publish'    THEN done:='Published your funnel'; try:='publish your funnel';
      WHEN 'growth_form_save'         THEN done:='Saved your form'; try:='save your form';
      WHEN 'growth_form_publish'      THEN done:='Published your form'; try:='publish your form';
      WHEN 'growth_page_unpublish'    THEN done:='Took your landing page offline'; try:='take your landing page offline';
      WHEN 'growth_funnel_unpublish'  THEN done:='Took your funnel offline'; try:='take your funnel offline';
      WHEN 'growth_form_unpublish'    THEN done:='Took your form offline'; try:='take your form offline';
      WHEN 'studio_image_publish'     THEN done:='Published your image'; try:='publish your image';
      WHEN 'studio_image_unpublish'   THEN done:='Took your image offline'; try:='take your image offline';
      WHEN 'content_save'             THEN done:='Saved your marketing copy'; try:='save your marketing copy';
      WHEN 'vibe_media_image'         THEN done:='Created an image'; try:='create an image';
      WHEN 'vibe_media_video'         THEN done:='Created a video'; try:='create a video';
      ELSE done:='Completed a step for you'; try:='complete a step for you';
    END CASE;

    CASE _outcome
      WHEN 'capability_succeeded' THEN
        title := done;
        IF _capability IN ('campaign_brief_create','campaign_brief_revise') THEN
          summary := 'Paige verified the canonical Campaign Brief planning record. This did not launch or publish a campaign, spend money, prove performance, or complete campaign work.';
        ELSIF _capability = 'growth_page_publish' THEN
          summary := 'Your landing page is live, along with any form it uses. Visitors can see it now.';
        ELSIF _capability = 'growth_funnel_publish' THEN
          summary := 'Your funnel is live, along with the pages and forms it uses. Visitors can see it now.';
        ELSIF _capability = 'growth_form_publish' THEN
          summary := 'Your form is live. Visitors can fill it in now.';
        ELSIF _capability = 'growth_page_unpublish' THEN
          summary := 'Your landing page is no longer published. Any form it used is still live.';
        ELSIF _capability = 'growth_funnel_unpublish' THEN
          summary := 'Your funnel is no longer published. The pages and forms it used are still live.';
        ELSIF _capability = 'studio_image_publish' THEN
          summary := 'Your image is live. Anyone with the link can see it now.';
        ELSE
          summary := 'Paige did this for you.';
        END IF;
      WHEN 'capability_failed' THEN
        title := 'Did not ' || try;
        summary := 'Paige tried this and it did not go through. Nothing was left half-done.';
      WHEN 'capability_refused' THEN
        title := 'Not allowed to ' || try;
        summary := 'This was refused before it ran, so nothing changed. What PAIGE is approved to do here may need a look.';
      WHEN 'capability_unreachable' THEN
        title := 'Could not reach the service to ' || try;
        summary := 'The service did not answer, so this never ran. Nothing changed.';
      WHEN 'capability_outcome_unknown' THEN
        title := 'Result unknown — ' || try;
        summary := 'This was sent and no result came back, so it may or may not have taken effect. Check the service before running it again.';
      WHEN 'capability_completed_unrecorded' THEN
        title := done || ' — but the record did not finish';
        summary := 'This DID take effect: the action has landed. Paige could not finish writing it down, so it may be missing elsewhere in the platform. Check the service before doing it again — doing it twice would repeat it for real.';
      ELSE
        title := 'Recorded activity'; summary := 'This activity was recorded but has no description yet.';
    END CASE;

    RETURN jsonb_build_object(
      'event_kind', 'capability_run.' || COALESCE(_outcome,'unknown'),
      'surface','command_center','actor_type',actor,
      'audience','owner','visibility','owner_internal',
      'from_department', dept, 'to_department', NULL,
      'title', title, 'summary', summary
    );
  END IF;

  CASE _outcome
    WHEN 'plan_drafted'             THEN title:='Business game plan drafted'; summary:='A plan was prepared for your review. Nothing in it has been acted on.';
    WHEN 'plan_updated'             THEN title:='Business game plan updated'; summary:='The plan changed. Steps already completed were not altered.';
    WHEN 'plan_step_completed'      THEN title:='A plan step was completed'; summary:='One step of the plan finished.';
    WHEN 'plan_blocked'             THEN title:='A plan step is blocked'; summary:='A step cannot continue until something is resolved.';
    WHEN 'check_completed'          THEN title:='System check completed'; summary:='A check finished and its result was recorded.';
    WHEN 'check_failed'             THEN title:='System check did not complete'; summary:='A check could not finish. Its previous result still stands and is not current.';
    WHEN 'check_finding_resolved'   THEN title:='A setup issue was resolved'; summary:='Something the last check flagged is no longer outstanding.';
    WHEN 'agent_enabled'            THEN title:='A specialist was switched on'; summary:='This specialist may now be given work in this workspace.'; dept:='operations_pmo';
    WHEN 'agent_disabled'           THEN title:='A specialist was switched off'; summary:='This specialist will not be given new work until it is switched back on.'; dept:='operations_pmo';
    WHEN 'agent_authority_changed'  THEN title:='A specialist''s authority changed'; summary:='How much this specialist may do on its own was changed.'; dept:='operations_pmo';
    WHEN 'run_completed'            THEN title:='Delegated work finished'; summary:='Work handed to a specialist completed.';
    WHEN 'run_failed'               THEN title:='Delegated work did not finish'; summary:='Work handed to a specialist stopped before completing. Nothing was left half-sent.';
    WHEN 'run_refused'              THEN title:='Delegated work was refused'; summary:='A specialist declined this work because it sits outside what it is allowed to do.';
    WHEN 'run_awaiting_approval'    THEN title:='Delegated work is waiting on you'; summary:='A specialist prepared this and is holding it for your word.';
    ELSE title:='Recorded activity'; summary:='This activity was recorded but has no description yet.';
  END CASE;

  RETURN jsonb_build_object(
    'event_kind', COALESCE(_source_kind,'workspace') || '.' || COALESCE(_outcome,'unknown'),
    'surface','command_center','actor_type',actor,
    'audience','owner','visibility','owner_internal',
    'from_department', dept, 'to_department', NULL,
    'title', title, 'summary', summary
  );
END $$;

REVOKE ALL ON FUNCTION public._workspace_event_display(text,text,text) FROM PUBLIC,anon,authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. list_tool_autonomy — carried forward VERBATIM from the tip (20270546000000; prod md5
--    94ee6854d6a6db89536e19e74ad8970d) plus five Studio rows.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.list_tool_autonomy(_tenant_id uuid DEFAULT NULL)
RETURNS TABLE (
  tool_key    text,
  label       text,
  category    text,
  mode        text,
  is_default  boolean,
  updated_at  timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _caller uuid := auth.uid();
  _tenant uuid;
BEGIN
  IF _caller IS NOT NULL THEN
    _tenant := public.current_user_tenant_id();
    IF _tenant_id IS NOT NULL AND _tenant_id <> _tenant AND NOT public.is_platform_owner() THEN
      RAISE EXCEPTION 'AUTONOMY_FORBIDDEN: tenant mismatch' USING ERRCODE = '42501';
    END IF;
    IF public.is_platform_owner() AND _tenant_id IS NOT NULL THEN _tenant := _tenant_id; END IF;
  ELSE
    _tenant := _tenant_id;
  END IF;

  RETURN QUERY
  WITH catalog(tool_key, label, category) AS (
    VALUES
      ('sales_publish_invoice',             'Publish a customer invoice', 'Payments'),
      ('sales_record_manual_payment',       'Record a received customer payment', 'Payments'),
      ('sales_reverse_manual_payment',      'Reverse a recorded customer payment', 'Payments'),
      ('sales_void_invoice',                'Void a customer invoice', 'Payments'),
      ('sales_create_invoice_link',         'Create a customer invoice access link', 'Payments'),
      ('agreement_draft',                    'Draft an agreement', 'Approvals'),
      ('agreement_send',                     'Send an agreement for signature', 'Approvals'),
      -- ── previously listed (23) ──
      ('crm_update_contact',            'Update a contact', 'CRM'),
      ('crm_create_contact',            'Add a contact', 'CRM'),
      ('crm_delete_contact',            'Delete a contact', 'CRM'),
      ('crm_update_pipeline_stage',     'Move a client''s stage', 'Pipeline'),
      ('crm_assign_coach',              'Assign a coach', 'CRM'),
      ('crm_assign_contact',            'Assign a contact', 'CRM'),
      ('crm_create_task',               'Create a task', 'Tasks'),
      ('crm_log_activity',              'Log an activity', 'CRM'),
      ('crm_add_note',                  'Add a note to a client', 'CRM'),
      ('crm_file_document',             'File a document on a client', 'CRM'),
      ('member_grant_role',             'Grant a staff role', 'Team'),
      ('member_revoke_role',            'Revoke a staff role', 'Team'),
      ('calendar_book_meeting',         'Book a meeting', 'Calendar'),
      -- ── added 2026-09-13 (E5): the governed booking-preset lifecycle. These edit a bookable
      -- /book PAGE, not a booked meeting. publish/revise/archive are HIGH in action-risk.ts, so
      -- no stored mode can bypass explicit confirmation; create/pause/duplicate/restore are ordinary.
      ('booking_preset_create',         'Create a booking calendar', 'Calendar'),
      ('booking_preset_revise',         'Change a booking calendar', 'Calendar'),
      ('booking_preset_publish',        'Publish a booking calendar''s public page', 'Calendar'),
      ('booking_preset_pause',          'Pause a booking calendar', 'Calendar'),
      ('booking_preset_duplicate',      'Duplicate a booking calendar', 'Calendar'),
      ('booking_preset_archive',        'Archive a booking calendar', 'Calendar'),
      ('booking_preset_restore',        'Restore a booking calendar', 'Calendar'),
      -- ── added 2026-09-13 (E7): the governed calendar-link SHARE. Sends a published calendar's
      -- public /book link to a contact by email/SMS; HIGH in action-risk.ts (never bypassable by a
      -- stored mode). The prepare/social-copy reads are not catalogued.
      ('calendar_link_send',            'Send a booking link to a contact', 'Calendar'),
      -- catalogue-removal-ok: draft_marketing_content — drafts persist nothing and no longer pass the approval gate (owner ruling 2026-10-04); saving is content_save, which stays governed
      ('generate_image',                'Generate an image', 'Content'),
      ('content_save',                  'Save marketing content', 'Content'),
      ('growth_page_save',              'Save a landing page draft', 'Studio'),
      ('growth_page_publish',           'Publish a landing page', 'Studio'),
      ('growth_funnel_build',           'Build a funnel', 'Studio'),
      ('growth_funnel_publish',         'Publish a funnel', 'Studio'),
      ('growth_form_save',              'Save a form draft', 'Studio'),
      ('growth_form_publish',           'Publish a form', 'Studio'),
      -- ── added 2026-10-04 (Migration E): taking Vibe Studio work offline, and publishing images.
      -- All five are HIGH in action-risk.ts, so no stored mode can bypass explicit confirmation.
      ('growth_page_unpublish',         'Unpublish a landing page', 'Studio'),
      ('growth_funnel_unpublish',       'Unpublish a funnel', 'Studio'),
      ('growth_form_unpublish',         'Unpublish a form', 'Studio'),
      ('studio_image_publish',          'Publish an image', 'Studio'),
      ('studio_image_unpublish',        'Unpublish an image', 'Studio'),
      ('action_file',                   'File an action', 'Action bus'),
      ('action_advance',                'Advance an action', 'Action bus'),
      ('update_client_data',            'Save details to a client''s file', 'Client file'),
      ('delegate_to_subagent',          'Hand work to a specialist', 'Paige''s team'),
      ('forge_subagent',                'Create a new specialist', 'Paige''s team'),
      ('save_to_knowledge_base',        'Save something to your knowledge base', 'Knowledge'),
      ('update_business_profile',       'Update your business profile', 'Business'),
      ('deal_create',                   'Add a deal', 'Pipeline'),
      ('deal_move_stage',               'Move a deal''s stage', 'Pipeline'),
      ('document_generate',             'Generate a document', 'Content'),
      ('author_event_kind',             'Add an activity kind', 'Action bus'),
      ('n8n_run_workflow',              'Run an automation', 'Automations'),
      ('n8n_activate_workflow',         'Turn an automation on', 'Automations'),
      ('n8n_deactivate_workflow',       'Turn an automation off', 'Automations'),
      ('n8n_create_workflow',           'Create an automation', 'Automations'),
      ('n8n_update_workflow',           'Change an automation', 'Automations'),
      ('n8n_archive_workflow',          'Archive an automation', 'Automations'),
      ('n8n_delete_workflow',           'Delete an automation permanently', 'Automations'),
      ('zapier_run_action',             'Run a connected app action', 'Automations'),
      -- ── added 2026-10-03 (GHL-1): the governed GoHighLevel run tool. HIGH in action-risk.ts
      -- (no stored mode bypasses explicit confirmation); dispatched through the canonical
      -- mcp-gateway with per-tool durable approval and the owner's execute gate.
      ('ghl_run_action',                'Run a GoHighLevel action', 'Automations'),
      ('plan_set_reminder',             'Set a reminder', 'Planning'),
      ('plan_create',                   'Create a plan', 'Planning'),
      ('plan_add_milestone',            'Add a milestone', 'Planning'),
      ('plan_assign_task',              'Assign a task from a plan', 'Planning'),
      ('plan_update_item',              'Change a plan item', 'Planning'),
      ('plan_remove_item',              'Remove a plan item', 'Planning'),
      -- added by Phase 2: visible controls for governed Business Mission record changes
      ('mission_create',                 'Create a Business Mission', 'Planning'),
      ('mission_revise',                 'Revise a Business Mission brief', 'Planning'),
      ('mission_transition',             'Change a Business Mission state', 'Planning'),
      ('automation_draft',              'Set up a repeatable process', 'Automations'),
      ('automation_set_grant',          'Change how much Paige runs alone', 'Automations'),
      ('automation_set_state',          'Turn a process on or off', 'Automations'),
      ('marketplace_install',           'Install from the marketplace', 'Marketplace'),
      ('marketplace_uninstall',         'Remove a marketplace install', 'Marketplace'),
      ('propose_business_brief_update', 'Propose a business brief update', 'CRM'),
      ('pipeline_configure',            'Configure pipelines and stages', 'Pipeline'),
      -- added 2026-09-06: the two governed campaign-brief PLANNING writes (Slice 2)
      ('campaign_brief_create',         'Save a campaign brief', 'Campaigns'),
      ('campaign_brief_revise',         'Revise a campaign brief', 'Campaigns'),
      ('comms_buy_number',              'Buy a phone number (monthly charge)', 'Comms'),
      ('comms_set_primary_number',      'Change which number you send from', 'Comms'),
      ('comms_name_number',             'Rename a phone number', 'Comms'),
      ('comms_draft_registration',      'Draft your carrier registration', 'Comms'),
      -- ── added 2026-09-02: the Solo Team seam ──
      ('team_set_work_profile',         'Update a teammate''s work details', 'Team'),
      ('team_set_permission',           'Change what a teammate can access', 'Team'),
      ('team_invite_member',            'Invite someone to the team', 'Team'),
      ('team_invite_resend',            'Send a team invitation again', 'Team'),
      ('team_invite_revoke',            'Withdraw a team invitation', 'Team'),
      -- ── added 2026-09-05: the acts the inbound MCP door names (task #45) ──
      ('tenant_create',                     'Create a new workspace', 'Platform'),
      ('crm_append_contact_notes',          'Add notes to a client''s record', 'CRM'),
      ('crm_delete_task',                   'Delete a task', 'Tasks'),
      ('workflow_run',                      'Run a registered automation', 'Automations'),
      ('workflow_cancel_run',               'Stop an automation that is running', 'Automations'),
      ('workflow_register',                 'Register a new automation', 'Automations'),
      ('automation_rule_create',            'Create a stage automation rule', 'Automations'),
      ('automation_rule_update',            'Change a stage automation rule', 'Automations'),
      ('automation_rule_delete',            'Delete a stage automation rule permanently', 'Automations'),
      ('approval_decide',                   'Approve or reject something waiting for review', 'Approvals'),
      ('approval_create',                   'File something for review', 'Approvals'),
      ('readiness_approve_proposal',        'Approve a readiness item for a client', 'Approvals'),
      ('coach_update_profile',              'Change a coach''s details and availability', 'Team'),
      ('team_invite_mint',                  'Create a workspace invitation link', 'Team'),
      ('comms_upsert_email_template',       'Save a shared email template', 'Comms'),
      ('comms_send_email',                  'Send an email to a real person', 'Comms'),
      ('comms_send_bulk_email',             'Send an email to many people at once', 'Comms'),
      ('comms_add_email_domain',            'Add a sending domain', 'Comms'),
      ('comms_set_primary_email_domain',    'Change which domain you send email from', 'Comms'),
      ('billing_send_invoice',              'Send an invoice to a client', 'Payments'),
      ('skill_run',                         'Run a skill', 'Paige''s team'),
      ('subagent_create',                   'Propose a new specialist', 'Paige''s team'),
      ('subagent_approve_proposal',         'Put a proposed specialist live', 'Paige''s team'),
      ('business_verify',                   'Check a company against outside registries', 'Business'),
      ('agency_create_subaccount',          'Create a sub-account', 'Agency'),
      ('agency_enter_subaccount',           'Work inside a sub-account', 'Agency'),
      ('privacy_handle_request',            'Act on a data request from a person', 'Privacy'),
      ('tenant_set_status',                 'Suspend or restore a workspace', 'Platform'),
      ('tenant_set_features',               'Turn capabilities on or off for a workspace', 'Platform'),
      ('crm_update_lifecycle_stage',        'Move a client to another lifecycle stage', 'CRM'),
      ('crm_advance_journey_stage',         'Move a client along their journey', 'CRM'),
      ('crm_propose_contact_update',        'Propose a change to a client''s record', 'CRM'),
      ('crm_update_task',                   'Change a task', 'Tasks'),
      ('approval_claim',                    'Take ownership of something waiting for review', 'Approvals'),
      ('approval_comment',                  'Comment on something waiting for review', 'Approvals'),
      ('readiness_reject_proposal',         'Close a readiness item without approving it', 'Approvals'),
      ('billing_create_invoice',            'Draft an invoice', 'Payments'),
      ('comms_draft_email',                 'Draft an email', 'Comms'),
      ('platform_post_notification',        'Post an operator notice', 'Platform'),
      ('agency_exit_subaccount',            'Return to your own workspace', 'Agency'),
      ('business_create',                   'Add a business you own', 'Business'),
      ('business_update',                   'Update a business you own', 'Business'),
      ('update_social_accounts',            'Record the accounts you post from', 'Business'),
      ('ingest_client_memory',              'Remember something about a client', 'Client file'),
      ('ingest_credit_scores',              'Record reported score figures on a client''s file', 'Client file'),
      ('nav_pull_business_credit',          'Pull a paid NAV business credit report', 'Client file'),
      ('smartcredit_pull_snapshot',         'Pull a paid SmartCredit snapshot', 'Client file'),
      ('ingest_banking_snapshot',           'Record reported account figures on a client''s file', 'Client file'),
      ('ingest_confirm_proposal',           'Confirm a staged change to a client''s file', 'Client file'),
      ('ingest_reject_proposal',            'Discard a staged change to a client''s file', 'Client file'),
      ('client_log_progress',               'Add a progress note to your own record', 'Client file'),
      -- Added in the same branch, after the peer gate refused three reuses that merged different
      -- acts under one key: the one send tool that also chooses which address the email appears
      -- to come from.
      ('comms_send_email_choosing_the_sender', 'Send an email and choose the sending address', 'Comms'),
      -- ── added 2026-09-12: the action-risk classification repair (improvement loop + social) ──
      ('improvement_propose',               'Propose an improvement to Paige', 'Paige''s team'),
      ('improvement_decide',                'Approve or reject an improvement proposal', 'Paige''s team'),
      ('social_post',                       'Post to social media', 'Content'),
      -- Added with the tenant-owned Social connection lifecycle. These mutations remain high-risk
      -- in action-risk.ts, so no stored autonomy mode can bypass explicit confirmation.
      ('social_connection_start',           'Connect a Social identity', 'Automations'),
      ('social_account_select',             'Select a Social account', 'Automations'),
      ('social_connection_disconnect',      'Disconnect a Social identity', 'Automations'),
      -- Governed CRM/Pipeline operational surface. These are the same keys classified by
      -- action-risk.ts and emitted from the one shared CRM command catalogue.
      ('crm_archive_contact',                'Archive a contact', 'CRM'),
      ('crm_restore_contact',                'Restore a contact', 'CRM'),
      ('crm_link_contact_company',           'Link a contact to a company', 'CRM'),
      ('crm_unlink_contact_company',         'Unlink a contact from a company', 'CRM'),
      ('crm_assign_contact_owner',           'Change a contact owner', 'CRM'),
      ('crm_merge_contacts',                 'Merge contacts', 'CRM'),
      ('crm_hard_delete_contact',            'Delete a contact permanently', 'CRM'),
      ('crm_bulk_update_contacts',           'Update an exact set of contacts', 'CRM'),
      ('crm_create_company',                 'Add a company', 'CRM'),
      ('crm_update_company',                 'Update a company', 'CRM'),
      ('crm_archive_company',                'Archive a company', 'CRM'),
      ('crm_restore_company',                'Restore a company', 'CRM'),
      ('crm_update_deal',                    'Update a deal', 'Pipeline'),
      ('crm_assign_deal_owner',              'Change a deal owner', 'Pipeline'),
      ('crm_assign_deal_contact',            'Change a deal contact', 'Pipeline'),
      ('crm_close_deal',                     'Close a deal', 'Pipeline'),
      ('crm_reopen_deal',                    'Reopen a deal', 'Pipeline'),
      ('crm_delete_deal',                    'Delete a deal permanently', 'Pipeline'),
      ('crm_assign_task',                    'Assign a task', 'Tasks'),
      ('crm_reschedule_task',                'Reschedule a task', 'Tasks'),
      ('crm_complete_task',                  'Complete a task', 'Tasks'),
      ('crm_reopen_task',                    'Reopen a task', 'Tasks'),
      ('crm_cancel_task',                    'Cancel a task', 'Tasks')
  )
  SELECT
    c.tool_key,
    c.label,
    c.category,
    COALESCE(t.mode, 'confirm')       AS mode,
    (t.mode IS NULL)                  AS is_default,
    t.updated_at
  FROM catalog c
  LEFT JOIN public.tenant_tool_autonomy t
    ON t.tool_key = c.tool_key AND t.tenant_id = _tenant
  ORDER BY c.category, c.label;
END;
$$;

REVOKE ALL ON FUNCTION public.list_tool_autonomy(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_tool_autonomy(uuid) TO authenticated, service_role;
