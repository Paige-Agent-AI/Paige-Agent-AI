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
-- 2. list_tool_autonomy. Five rows in the Studio category so the owner can see and set them. It
--    EXTENDS the live catalogue rather than replacing it, the way 20270547000002 (Sales Collections)
--    did: the live function is renamed to _list_tool_autonomy_before_studio_publish (private —
--    service_role and the owner only), and a wrapper returns every row the predecessor returns,
--    unfiltered and first (so its scope guard runs before anything new), then the five Studio rows
--    under the same tenant resolution. No predecessor row can be lost or changed by this migration.
--
-- Reversibility: one function body is replaced, one function is renamed and one wrapper added; no
-- table, column, row or grant changes. Reverting means dropping the wrapper, renaming
-- _list_tool_autonomy_before_studio_publish back to list_tool_autonomy with its grants restored
-- (authenticated + service_role), and restoring _workspace_event_display from 20270546000000.
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
-- 2. list_tool_autonomy — extend the live catalogue (prod 2026-10-04: the 20270547000002 wrapper,
--    md5 a8fcfafeaccff30656b68f7da9554a18) with five Studio rows. Guarded, so a replay keeps the
--    first rename and only re-creates the identical wrapper.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN
 IF to_regprocedure('public._list_tool_autonomy_before_studio_publish(uuid)') IS NULL THEN
  ALTER FUNCTION public.list_tool_autonomy(uuid) RENAME TO _list_tool_autonomy_before_studio_publish;
 END IF;
END $$;
REVOKE ALL ON FUNCTION public._list_tool_autonomy_before_studio_publish(uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.list_tool_autonomy(_tenant_id uuid DEFAULT NULL)
RETURNS TABLE(tool_key text,label text,category text,mode text,is_default boolean,updated_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _tenant uuid;
BEGIN
 RETURN QUERY SELECT * FROM public._list_tool_autonomy_before_studio_publish(_tenant_id);
 -- The predecessor ran the canonical scope guard above (a signed-in caller naming a workspace that
 -- is not theirs is refused before any row returns). The same resolution picks whose stored modes
 -- the new rows read.
 IF auth.uid() IS NOT NULL THEN
  _tenant:=public.current_user_tenant_id();
  IF public.is_platform_owner() AND _tenant_id IS NOT NULL THEN _tenant:=_tenant_id; END IF;
 ELSE _tenant:=_tenant_id; END IF;
 RETURN QUERY
 -- Migration E (2026-10-04): taking Vibe Studio work offline, and publishing images. All five are
 -- HIGH in action-risk.ts, so no stored mode can bypass explicit confirmation.
 WITH catalog(tool_key,label) AS (VALUES
  ('growth_page_unpublish','Unpublish a landing page'),
  ('growth_funnel_unpublish','Unpublish a funnel'),
  ('growth_form_unpublish','Unpublish a form'),
  ('studio_image_publish','Publish an image'),
  ('studio_image_unpublish','Unpublish an image')
 )
 SELECT c.tool_key,c.label,'Studio'::text,coalesce(t.mode,'confirm'),t.mode IS NULL,t.updated_at
 FROM catalog c
 LEFT JOIN public.tenant_tool_autonomy t ON t.tenant_id=_tenant AND t.tool_key=c.tool_key;
END $$;
REVOKE ALL ON FUNCTION public.list_tool_autonomy(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.list_tool_autonomy(uuid) TO authenticated,service_role;
