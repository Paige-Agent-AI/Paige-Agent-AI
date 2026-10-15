-- Migration D (Vibe Studio V2a) — saving marketing content is decided by the workspace, Vibe Studio
-- work gets its own lines on the Rail, and drafting copy leaves the autonomy catalogue.
-- Owner authorized 2026-10-04 (Migration D; "Drafts skip approval is a go").
--
-- 1. save_marketing_content AUTHORITY (§9/§53/§59). Before: any signed-in caller holding the GLOBAL
--    'admin'/'super_admin' role who was a plain MEMBER of the target workspace could write, and the
--    target was COALESCE(p_tenant_id, active workspace) — so a caller could name any workspace they
--    were a member of, and the platform owner could name any workspace at all. `user_roles` is global,
--    so that 'admin' said nothing about THIS workspace. After (the same rule as _growth_admin_tenant,
--    20270537000000):
--      * signed in → the active workspace (current_user_tenant_id()) and only it; a p_tenant_id that
--        differs is refused (CONTENT_FORBIDDEN, 42501), never swapped in; the caller must be that
--        workspace's owner/admin (is_tenant_admin) or the agency that manages it
--        (agency_can_manage_child). No global role is consulted.
--      * no signed-in user → only service_role or a direct server session, and p_tenant_id is
--        required (CONTENT_NO_TENANT, 22023).
--    Everything else in the function — the insert, the tenant-scoped reuse UPDATE, the server-owned
--    version history, the audit row, the return contract — is byte-for-byte the live body. Grants are
--    re-asserted unchanged (authenticated + service_role; never PUBLIC/anon).
--
-- 2. RLS marketing_content_tenant_manage. 20270542000000 already replaced the global-role predicate
--    with is_tenant_admin(tenant_id) OR is_platform_owner(). This adds the managing agency, scoped to
--    the workspace the agency user is working in: (tenant_id = current_user_tenant_id() AND
--    agency_can_manage_child(tenant_id)). Members gain nothing. authenticated holds SELECT only on the
--    table (no INSERT/UPDATE/DELETE), so in practice the change is: an agency owner/admin/manager (or
--    an assigned specialist) who has switched into a sub-account can now READ that sub-account's
--    library, which the save function already lets them write.
--
-- 3. _workspace_event_display. Vibe Studio work (pages, funnels, forms, saved copy, images, videos)
--    recorded on the Rail read "Completed a step for you". They now read what happened, for every
--    outcome the function distinguishes. Unknown keys keep the generic line. Presentation only.
--
-- 4. list_tool_autonomy. draft_marketing_content no longer passes the approval gate (it persists
--    nothing; action-risk.ts moves it to NON_MUTATING_EXEMPT), so its catalogue row was a control that
--    governs nothing. It is removed; every other row is unchanged. Saving is content_save, still listed.
--
-- Reversibility: function bodies and one policy expression are replaced; no table, column or row
-- changes. Reverting means restoring the prior bodies (20261228000001 as edited by 20270504000000,
-- 20270105000000, 20270543000003) and the 20270542000000 policy expression.
--
-- Proof: supabase/tests/migration_d_studio_authority.sql (.github/workflows/migration-d-studio-authority.yml).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. save_marketing_content — carried forward VERBATIM from the live body (prod pg_get_functiondef
--    md5 d2bc07b69525f8eb31b56f364ba7fff9 on 2026-10-04) except the authority section.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.save_marketing_content(p_kind text, p_title text, p_body text DEFAULT NULL::text, p_channel text DEFAULT NULL::text, p_image_url text DEFAULT NULL::text, p_image_path text DEFAULT NULL::text, p_size text DEFAULT NULL::text, p_brief text DEFAULT NULL::text, p_meta jsonb DEFAULT '{}'::jsonb, p_id uuid DEFAULT NULL::uuid, p_tenant_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _caller uuid := auth.uid();
  _tenant uuid;
  _kind text := CASE WHEN p_kind IN ('text','image','video','document') THEN p_kind ELSE 'text' END;
  _id uuid;
  _cur record;
  _new_image text := NULLIF(btrim(p_image_url), '');
  _versions jsonb;
  _merged_meta jsonb;
BEGIN
  -- Migration D (§9/§59): who may write is decided by the workspace, never by a global role.
  IF _caller IS NOT NULL THEN
    -- Signed in: the caller's active workspace, and only that one. A named workspace that is not
    -- the active one is refused, never swapped in.
    _tenant := public.current_user_tenant_id();
    IF _tenant IS NULL THEN
      RAISE EXCEPTION 'CONTENT_NO_TENANT: a tenant context is required' USING ERRCODE = '22023';
    END IF;
    IF p_tenant_id IS NOT NULL AND p_tenant_id <> _tenant THEN
      RAISE EXCEPTION 'CONTENT_FORBIDDEN: that is not the workspace you are working in' USING ERRCODE = '42501';
    END IF;
    -- The workspace's own owner or admin, or the agency that manages this sub-account exactly as
    -- agency_can_manage_child scopes it (the same rule as _growth_admin_tenant).
    IF NOT (public.is_tenant_admin(_tenant) OR public.agency_can_manage_child(_tenant)) THEN
      RAISE EXCEPTION 'CONTENT_FORBIDDEN: the workspace owner or an admin is required' USING ERRCODE = '42501';
    END IF;
  ELSE
    -- No signed-in user: only a server session may name the workspace, and it must name one.
    IF NOT (COALESCE(auth.role(), '') = 'service_role' OR public.is_direct_server_context()) THEN
      RAISE EXCEPTION 'CONTENT_FORBIDDEN: sign in to change this workspace' USING ERRCODE = '42501';
    END IF;
    IF p_tenant_id IS NULL THEN
      RAISE EXCEPTION 'CONTENT_NO_TENANT: a tenant context is required' USING ERRCODE = '22023';
    END IF;
    _tenant := p_tenant_id;
  END IF;

  IF p_id IS NOT NULL THEN
    -- Read + LOCK the CURRENT row (tenant-scoped) so we can preserve the prior image before overwriting
    -- it. FOR UPDATE serializes concurrent refines of the SAME row, so a double-submit cannot lose a
    -- version to a read-modify-write race.
    SELECT image_url, image_path, size, meta INTO _cur
    FROM public.marketing_content
    WHERE id = p_id AND tenant_id = _tenant
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'CONTENT_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;

    -- p_meta (when supplied) still replaces the caller-facing meta, BUT `versions` is SERVER-OWNED: it
    -- is ALWAYS re-asserted from the row's own history below, so a caller can neither forge it (a
    -- caller-supplied meta.versions is ignored) nor wipe it (a non-image reuse with p_meta='{}' cannot
    -- drop it) — the §70 "prior image is never silently lost" invariant holds on EVERY reuse path.
    _merged_meta := COALESCE(p_meta, _cur.meta, '{}'::jsonb);
    _versions := _cur.meta -> 'versions';
    IF _versions IS NULL OR jsonb_typeof(_versions) <> 'array' THEN
      _versions := '[]'::jsonb;
    END IF;

    -- Version preservation: when the image is actually being replaced with a different one, append the
    -- OUTGOING (prior) image as the newest history entry (capped to the most-recent 20).
    IF _new_image IS NOT NULL AND _cur.image_url IS NOT NULL AND _new_image <> _cur.image_url THEN
      _versions := _versions || jsonb_build_array(jsonb_build_object(
        'image_url', _cur.image_url,
        'image_path', _cur.image_path,
        'size', _cur.size,
        'at', now()
      ));
      IF jsonb_array_length(_versions) > 20 THEN
        SELECT COALESCE(jsonb_agg(v ORDER BY ord), '[]'::jsonb)
          INTO _versions
        FROM jsonb_array_elements(_versions) WITH ORDINALITY AS t(v, ord)
        WHERE ord > jsonb_array_length(_versions) - 20;
      END IF;
    END IF;
    -- server-owned versions ALWAYS win over any caller-supplied meta.versions (forge/wipe-proof).
    -- p_meta is arbitrary jsonb (its generated client type permits strings/numbers/booleans/arrays),
    -- and jsonb_set cannot install an object key into a scalar/array root — it would return the root
    -- unchanged and SILENTLY DROP the versions snapshot, breaking the un-wipeable-history contract
    -- (Codex P2). Normalize a non-object merged meta to an object first so `versions` always persists.
    IF _merged_meta IS NULL OR jsonb_typeof(_merged_meta) <> 'object' THEN
      _merged_meta := '{}'::jsonb;
    END IF;
    _merged_meta := jsonb_set(_merged_meta, '{versions}', _versions, true);

    UPDATE public.marketing_content SET
      title = COALESCE(NULLIF(btrim(p_title), ''), title),
      body = COALESCE(p_body, body),
      channel = COALESCE(p_channel, channel),
      brief = COALESCE(p_brief, brief),
      meta = _merged_meta,
      image_url = COALESCE(_new_image, image_url),
      image_path = COALESCE(NULLIF(btrim(p_image_path), ''), image_path),
      size = COALESCE(NULLIF(btrim(p_size), ''), size)
    WHERE id = p_id AND tenant_id = _tenant
    RETURNING id INTO _id;
    IF _id IS NULL THEN
      RAISE EXCEPTION 'CONTENT_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    RETURN _id;
  END IF;

  -- §13 (Codex P2): `versions` is SERVER-OWNED lineage; a brand-new row has none. Strip any
  -- caller-supplied `meta.versions` on INSERT so a caller cannot plant fabricated history that a later
  -- reuse would then treat as authentic server-owned lineage (the reuse branch above re-asserts history
  -- from the row's OWN meta, so a forged initial `versions` would otherwise be carried forward). Only an
  -- object meta can carry the key; a scalar/array meta can't, so it is left as-is.
  _merged_meta := COALESCE(p_meta, '{}'::jsonb);
  IF jsonb_typeof(_merged_meta) = 'object' THEN
    _merged_meta := _merged_meta - 'versions';
  END IF;

  INSERT INTO public.marketing_content (
    tenant_id, created_by, kind, channel, title, body,
    image_url, image_path, size, brief, meta
  ) VALUES (
    _tenant, _caller, _kind, NULLIF(btrim(p_channel), ''),
    COALESCE(NULLIF(btrim(p_title), ''), 'Untitled'), p_body,
    NULLIF(btrim(p_image_url), ''), NULLIF(btrim(p_image_path), ''),
    NULLIF(btrim(p_size), ''), p_brief, _merged_meta
  )
  RETURNING id INTO _id;

  INSERT INTO public.audit_logs (user_id, entity, action, entity_id, data)
  VALUES (_caller, 'marketing_content', 'save_marketing_content', _id,
          jsonb_build_object('tenant_id', _tenant, 'kind', _kind, 'channel', p_channel));

  RETURN _id;
END;
$function$;

REVOKE ALL ON FUNCTION public.save_marketing_content(text, text, text, text, text, text, text, text, jsonb, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_marketing_content(text, text, text, text, text, text, text, text, jsonb, uuid, uuid) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. marketing_content_tenant_manage — add the managing agency, in the active workspace only.
--    The owner/admin arm and the platform-owner arm are exactly as 20270542000000 left them.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER POLICY marketing_content_tenant_manage ON public.marketing_content
  USING (public.is_tenant_admin(tenant_id)
         OR (tenant_id = (SELECT public.current_user_tenant_id()) AND (SELECT public.agency_can_manage_child(public.current_user_tenant_id())))
         OR public.is_platform_owner())
  WITH CHECK (public.is_tenant_admin(tenant_id)
         OR (tenant_id = (SELECT public.current_user_tenant_id()) AND (SELECT public.agency_can_manage_child(public.current_user_tenant_id())))
         OR public.is_platform_owner());

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. _workspace_event_display — carried forward VERBATIM from the live body (prod md5
--    4873a9fe5d8e93ce821d95500154e385, = 20270105000000) plus named lines for Vibe Studio work.
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
-- 4. list_tool_autonomy — carried forward VERBATIM from the tip (20270543000003; prod md5
--    feaf94b5d32f8e3d00e21042e32bc600) minus the draft_marketing_content row.
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
