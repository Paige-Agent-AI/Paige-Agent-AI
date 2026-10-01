-- Operator-visible Knowledge registration; existing predicates, defaults and ACL unchanged.
-- Source 20270524000000; only the two authorized catalogue rows are added.
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
      ('knowledge_update', 'Update Knowledge metadata', 'Knowledge'),
      ('knowledge_delete', 'Delete a Knowledge document permanently', 'Knowledge'),
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
      ('pipeline_create',               'Create a pipeline', 'Pipeline'),
      ('pipeline_add_stage',            'Add a pipeline stage', 'Pipeline'),
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
      ('draft_marketing_content',       'Draft marketing content', 'Content'),
      ('generate_image',                'Generate an image', 'Content'),
      ('content_save',                  'Save marketing content', 'Content'),
      ('growth_page_save',              'Save a landing page draft', 'Studio'),
      ('growth_page_publish',           'Publish a landing page', 'Studio'),
      ('growth_funnel_build',           'Build a funnel', 'Studio'),
      ('growth_funnel_publish',         'Publish a funnel', 'Studio'),
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
      ('billing_send_invoice',              'Send an invoice to a client', 'Billing'),
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
      ('billing_create_invoice',            'Draft an invoice', 'Billing'),
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

-- Re-asserted, as every predecessor in this chain does. `CREATE OR REPLACE` preserves an existing
-- function's ACL, so this changes nothing on a database that already ran an earlier grant.
REVOKE ALL ON FUNCTION public.list_tool_autonomy(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_tool_autonomy(uuid) TO authenticated, service_role;
