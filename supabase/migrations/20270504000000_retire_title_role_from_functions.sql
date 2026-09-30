-- No database function grants anything through the retired title role.
--
-- "Coach" is a title a business gives its people. It never grants permission. 81 functions let the
-- platform-wide `coach` role, or a `coach` membership seat, into a check. After this migration none do:
--   * where the role or the seat sat beside admin, owner or another role in a list, it leaves the list
--     and every other entry stays;
--   * where it stood alone as a way in, the branch is removed: staff standing (is_staff), the studio
--     seat, paid features, recognising a staff reader of help documents or of a journey stage, and the
--     document-work and Paige-action checks;
--   * the CRM commands no longer give a coach seat record-by-record access. Owners and admins keep
--     theirs; whether an assigned member may run CRM commands is a product decision, and this
--     migration does not make it. The same holds for naming a client's assigned staff member through
--     the CRM commands: that is now open to owners and admins only, as it already was for everyone
--     on production; making an ordinary member assignable there is a product decision too;
--   * the pipeline workspace shows an assigned member the deals and clients they are assigned, read
--     only, through membership of the business, as the row policies do since 20270502000000. Access
--     through "created it" is dropped, because creating a client is not an assignment, and the client
--     behind a task or a deal must belong to the same business.
--
-- Each function is edited where it stands: its current definition is read, only the fragment that
-- reads the role is replaced, and the result is recreated with the same signature and settings. The
-- migration stops if a fragment is not found, or if an edited function still reads the role.
--
-- The 'coach' kept in assign_contact, get_client_rail and similar functions is an assignment kind or a
-- conversation lens (a data label), not a role. The grant paths are the next slice; the finance
-- function stays with the finance slice.
--
-- Who is affected on production today: 0 membership seats hold coach. The 4 people who hold the
-- platform-wide coach role also hold admin or above and keep every path through the admin branches.

CREATE FUNCTION pg_temp.reads_retired_role(_src text) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT _src ~ ('has_(any_|tenant_)?role\([^;]*''coach'''
                 || '|\m(tm|m)\.role(::text)?\s*(in|IN|=)\s*\(?[^;)]*''coach'''
                 || '|\mrole::text\s*(in|IN|=)\s*\(?[^;)]*''coach'''
                 || '|v_role is distinct from ''coach''|v_actor_role\s*=\s*''coach''')
$$;

-- Applies the common edits, then each required edit (every one must change the definition), checks
-- the role is no longer read, and recreates the function.
CREATE FUNCTION pg_temp.retire_role(_fn regprocedure, _required text[] DEFAULT '{}') RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  _def text := pg_get_functiondef(_fn);
  _new text;
  _before text;
  i int;
BEGIN
  _new := _def;
  -- The role beside other entries in a list: it leaves the list.
  _new := regexp_replace(_new, '(''admin''\s*,\s*''super_admin'')\s*,\s*''coach''', '\1', 'g');
  _new := regexp_replace(_new, '(''admin'')\s*,\s*''coach''(\s*,\s*''manager'')', '\1\2', 'g');
  _new := regexp_replace(_new, '(\[\s*''admin'')\s*,\s*''coach''(\s*\])', '\1\2', 'g');
  _new := regexp_replace(_new, '(''owner''\s*,\s*''admin'')\s*,\s*''coach''(\s*\))', '\1\2', 'g');
  _new := regexp_replace(_new, '(''cs_rep'')\s*,\s*''coach''(\s*,\s*''finance'')', '\1\2', 'g');
  -- The role as a separate way in: the branch is removed.
  _new := regexp_replace(_new, '\s+OR\s+public\.has_role\((v_uid|_caller|auth\.uid\(\))\s*,\s*''coach''::public\.app_role\)', '', 'g');
  _new := regexp_replace(_new, '\s+or\s+public\.has_tenant_role\([^;()]*,\s*''coach''\)', '', 'g');
  _new := regexp_replace(_new, '\s+AND NOT public\.has_role\(auth\.uid\(\), ''coach''\)', '', 'g');
  _new := regexp_replace(_new, '\s*WHEN tm\.role::text\s*=\s*''coach''\s+THEN 3', '', 'g');
  FOR i IN 1 .. coalesce(array_length(_required, 1), 0) BY 2 LOOP
    _before := _new;
    _new := regexp_replace(_new, _required[i], _required[i + 1], 'g');
    IF _new = _before THEN
      RAISE EXCEPTION 'retire_role: % has no match for a required edit', _fn;
    END IF;
  END LOOP;
  IF _new = _def THEN
    RAISE EXCEPTION 'retire_role: % did not change', _fn;
  END IF;
  IF pg_temp.reads_retired_role(_new) THEN
    RAISE EXCEPTION 'retire_role: % still reads the retired role', _fn;
  END IF;
  EXECUTE _new;
END;
$$;

-- Lists and separate branches, handled by the common edits.
SELECT pg_temp.retire_role(p.oid::regprocedure)
  FROM pg_proc p
 WHERE p.pronamespace = 'public'::regnamespace AND p.prokind = 'f'
   AND p.proname IN (
     'admin_propose_paige_actions', 'advance_action', 'approve_systems_check_finding', 'archive_thread',
     'assign_contact', 'can_access_rail_topic', 'can_access_voice_stt_topic', 'cancel_internal_booking',
     'cancel_scheduled_message', 'client_custom_fields_upsert', 'create_and_attach_conversation',
     'create_contact_v2', 'create_internal_booking', 'delete_conversation', 'delete_marketing_content',
     'delete_signature', 'delete_snippet', 'disable_tenant_event_kind', 'enroll_contact_in_program',
     'execute_crm_command', 'file_action', 'get_client_rail', 'get_client_rail_for_chat',
     'get_pipeline_spine_evidence', 'get_profile_with_pii_log', 'get_solo_rail_activity',
     'get_tenant_assignable_members', 'get_user_primary_tenant', 'get_zapier_rail_activity',
     'growth_form_upsert', 'growth_funnel_publish', 'growth_funnel_upsert', 'growth_page_edit_blocks',
     'growth_page_publish', 'growth_page_upsert', 'import_tenant_phone_number', 'is_staff', 'list_actions',
     'list_team_members', 'list_tenant_programs', 'match_rag_documents', 'plan_add_milestone',
     'plan_assign_task', 'plan_create', 'plan_list', 'plan_remove_item', 'plan_set_reminder',
     'plan_update_item', 'presence_set_override', 'preview_crm_command', 'process_zapier_skool_intake',
     'record_rail_event', 'record_zapier_mcp_connection_test', 'recover_paige_document_work',
     'remove_from_library', 'reschedule_internal_booking', 'resolve_systems_check_signal_reference',
     'save_marketing_content', 'save_to_library', 'set_contact_channel_suppression', 'set_journey_stage',
     'set_tenant_email_identity', 'set_thread_labels', 'snooze_thread', 'start_paige_document_work_execution',
     'studio_role_ok', 'submit_paige_document_work', 'tenant_a2p_registration_save_draft',
     'tenant_comms_readiness', 'tenant_phone_number_rename', 'tenant_phone_number_set_primary',
     'update_internal_booking', 'upsert_contact', 'upsert_signature', 'upsert_snippet',
     'upsert_tenant_event_kind');

-- Paid features: the role's bypass is removed.
SELECT pg_temp.retire_role('public.check_feature_access(uuid, text)'::regprocedure, ARRAY[
  '(\n[ \t]*--[^\n]*)?\n[ \t]*IF has_role\(_user_id, ''coach''::app_role\) THEN\s*RETURN true;\s*END IF;', '']);

-- CRM record access: a coach seat no longer has a record-by-record path.
SELECT pg_temp.retire_role('public.crm_actor_can_access_record(uuid, uuid, text, uuid)'::regprocedure, ARRAY[
  'if v_role is distinct from ''coach'' then return false; end if;', 'return false;']);
SELECT pg_temp.retire_role('public.read_crm_command_result(uuid, uuid, jsonb, text)'::regprocedure, ARRAY[
  'if v_actor_role\s*=\s*''coach'' then', 'if false then']);
SELECT pg_temp.retire_role('public.execute_crm_command_reversible(uuid, uuid, jsonb, text)'::regprocedure, ARRAY[
  'if not v_is_admin then\s*perform 1 from public\.tenant_members tm\s*where [^;]*tm\.role = ''coach'' for update;\s*v_is_coach:=found;\s*end if;',
  'v_is_coach:=false;']);

-- The pipeline workspace: an assigned member reads through membership of the business, not a role.
SELECT pg_temp.retire_role('public.get_pipeline_workspace_pre_identity(uuid)'::regprocedure, ARRAY[
  'public\.has_role\(_caller,''coach''::public\.app_role\)', 'public.is_tenant_member(_tenant)',
  'c\.created_by=_caller or ', '',
  -- The client behind a task or a deal must belong to this business too.
  'tc\.linked_user_id=t\.user_id and tc\.assigned_coach_user_id=_caller', 'tc.tenant_id=_tenant and tc.linked_user_id=t.user_id and tc.assigned_coach_user_id=_caller',
  'dc\.id=d\.contact_client_id and dc\.assigned_coach_user_id=_caller', 'dc.id=d.contact_client_id and dc.tenant_id=_tenant and dc.assigned_coach_user_id=_caller',
  '_is_coach', '_is_member']);
