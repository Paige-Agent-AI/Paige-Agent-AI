-- Migration B (Vibe Studio V1, owner-authorized 2026-10-03): the Design Studio's capability scope,
-- stored as DATA on the canonical platform role record. Data only — no table, column, function,
-- grant or policy changes.
--
-- paige-ai-chat reads `config.capability_scope` from the platform `design-studio` row
-- (tenant_id IS NULL) and enforces it twice: the tool list is filtered before the model sees it,
-- and dispatch refuses anything outside it (`outside_studio_scope`). The scope only narrows; each
-- tool that survives still passes the Spine, risk, Trust Compass and tenant-permission gates.
--
-- The allowlist is the owner's ruling: page/funnel/form build and publish, image generation,
-- marketing content drafting and saving, reads of existing growth artifacts, capability status,
-- bounded web research, and ask_choices. Everything else is out — CRM/contact and deal/pipeline
-- mutations, sales, client files, team/permissions, billing, calendar, GHL/Zapier/n8n execution,
-- communications and phone-number purchase, sub-agent forge/delegate, funding, operator actions,
-- action-bus writes, business mission/profile mutations, and Knowledge WRITES (save_to_knowledge_base
-- waits for the governed learning path, V5). Knowledge READS reach the Studio as context (V3).
--
-- Tenant safety, unchanged and relied on: `paige_subagents.slug` is unique table-wide
-- (paige_subagents_slug_key), so no tenant can create a competing `design-studio` row, and the
-- write policy never matches a NULL-tenant row for a tenant actor (20260721002907).

DO $$
DECLARE _n int;
BEGIN
  UPDATE public.paige_subagents
     SET config = COALESCE(config, '{}'::jsonb) || jsonb_build_object('capability_scope', jsonb_build_object(
           'version', 1,
           'mode', 'allowlist',
           'tools', jsonb_build_array(
             'ask_choices',
             'capability_status',
             'generate_image',
             'draft_marketing_content',
             'content_save',
             'growth_list',
             'growth_page_generate',
             'growth_page_save',
             'growth_page_publish',
             'growth_funnel_generate',
             'growth_funnel_build',
             'growth_funnel_publish',
             'growth_form_save',
             'growth_form_publish',
             'web_search',
             'web_fetch'
           ))),
         updated_at = now()
   WHERE slug = 'design-studio' AND tenant_id IS NULL;
  GET DIAGNOSTICS _n = ROW_COUNT;
  IF _n <> 1 THEN
    RAISE EXCEPTION 'design-studio capability scope: expected exactly one platform row, updated %', _n;
  END IF;
END $$;
