-- Opt-in extension of the ORIGINAL E08 A1c disposable proof, after all original assertions.
-- Never execute on the linked project. Existing synthetic people/schema/helpers are reused.
-- The Sales actor below is the exact original production body (27202521...), not a new guard.
\if :{?e04_source_reads}
DO $$ BEGIN
 IF current_database()<>'exp08_team_hub_a1c_proof' THEN
  RAISE EXCEPTION 'This extension runs only in the original disposable E08 fixture'; END IF;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claims','',false);
ALTER TABLE auth.users ADD COLUMN deleted_at timestamptz;
ALTER TABLE auth.users ADD COLUMN banned_until timestamptz;
ALTER TABLE public.tenants ADD COLUMN status text DEFAULT 'active';
CREATE TABLE public.paige_agreements(id uuid PRIMARY KEY,tenant_id uuid);
-- A1c did not need the platform configuration table. This minimal fixture has ONLY
-- the original selector fields; no tenant registry, provisioning or provider proof.
CREATE TABLE public.paige_subagents(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid,slug text,config jsonb);
INSERT INTO public.paige_subagents(tenant_id,slug,config) VALUES (NULL,'merit',
 '{"personality":{"fixture":"retained"},"team_hub_tools":{"mode":"allowlist","tools":["team_hub_read_conversation"]},"capability_scope":{"version":1,"mode":"allowlist","access":"read","tools":["ask_choices","capability_status","read_business_time_zone","team_hub_read_conversation","crm_list_deals","crm_pipeline_summary","agreement_list","agreement_status"]}}'),
 (NULL,'cura','{"fixture":"other specialist unchanged"}');
CREATE TEMP TABLE e04_config_before AS SELECT * FROM public.paige_subagents;
CREATE OR REPLACE FUNCTION public._sales_invoice_actor(_actor uuid,_tenant uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE active_tenant uuid;
BEGIN
  PERFORM 1 FROM auth.users WHERE id=_actor AND deleted_at IS NULL AND (banned_until IS NULL OR banned_until<=now()) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice actor unavailable' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public.tenants WHERE id=_tenant AND status IN ('trial','active','past_due') FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice workspace unavailable' USING ERRCODE='42501'; END IF;
  SELECT active_tenant_id INTO active_tenant FROM public.profiles WHERE user_id=_actor FOR UPDATE;
  IF NOT FOUND OR active_tenant IS DISTINCT FROM _tenant THEN RAISE EXCEPTION 'Active invoice workspace changed' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public.tenant_members WHERE user_id=_actor AND tenant_id=_tenant AND status='active' AND role IN ('owner','admin') FOR UPDATE;
  IF NOT FOUND OR _actor IS NULL OR _tenant IS NULL THEN RAISE EXCEPTION 'Invoice workspace or authority unavailable' USING ERRCODE='42501'; END IF;
END $$;
REVOKE ALL ON FUNCTION public._sales_invoice_actor(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public._sales_invoice_actor(uuid,uuid) TO service_role;

SELECT pg_temp.check((SELECT md5(prosrc)='27202521ef9750d3246ee5e5e11018aa' FROM pg_proc
 WHERE oid='public._sales_invoice_actor(uuid,uuid)'::regprocedure),'original Sales actor exact production body');
CREATE TEMP TABLE e04_before AS SELECT oid::regprocedure::text AS sig,prosrc,proacl,proconfig FROM pg_proc
 WHERE pronamespace='public'::regnamespace AND proname LIKE '%team_hub%';
\if :{?e04_native_red}
SELECT pg_temp.check(to_regprocedure('public.team_hub_stage_agent_read_context(uuid,text,jsonb,jsonb)') IS NOT NULL,
 'required native publication contract is not implemented');
\endif
\ir ../migrations/20271122010004_e04_team_hub_source_reads.sql

-- Preserve the entire original bodies outside the three exact additive hunks.
DO $$ DECLARE src text; old text; guard text; BEGIN
 SELECT prosrc INTO src FROM pg_proc WHERE oid='public.team_hub_post_agent_message(uuid,uuid,text,text,uuid,uuid,uuid,text,text,boolean)'::regprocedure;
 guard:=$g$  -- EXP04 original post: current native authority, bound to this exact accepted token.
  IF turn.read_context->>'token_hash'=hashed THEN
   PERFORM public._team_hub_assert_agent_read_scope(turn);
  END IF;
$g$;
 SELECT prosrc INTO old FROM e04_before WHERE sig='team_hub_post_agent_message(uuid,uuid,text,text,uuid,uuid,uuid,text,text,boolean)';
 IF old IS NULL OR replace(src,guard,'')<>old THEN RAISE EXCEPTION 'Original post inverse failed'; END IF;
 SELECT prosrc INTO src FROM pg_proc WHERE oid='public._team_hub_message_json(public.team_hub_messages)'::regprocedure;
 SELECT prosrc INTO old FROM e04_before WHERE sig='_team_hub_message_json(team_hub_messages)';
 IF old IS NULL OR replace(src,E'\n  || public._team_hub_agent_read_annotations(p_message.id)','')<>old THEN RAISE EXCEPTION 'Original serializer inverse failed'; END IF;
 SELECT prosrc INTO src FROM pg_proc WHERE oid='public.team_hub_search(uuid,text,integer)'::regprocedure;
 SELECT prosrc INTO old FROM e04_before WHERE sig='team_hub_search(uuid,text,integer)';
 IF old IS NULL OR replace(src,'''source_backed_read'',coalesce((public._team_hub_agent_read_annotations(h.id)->>''source_backed_read'')::boolean,false),','')<>old THEN RAISE EXCEPTION 'Original search inverse failed'; END IF;
 IF EXISTS(SELECT 1 FROM e04_before b JOIN pg_proc p ON p.oid=to_regprocedure(b.sig)
  WHERE (p.proacl IS DISTINCT FROM b.proacl OR p.proconfig IS DISTINCT FROM b.proconfig)
   OR (p.prosrc<>b.prosrc AND b.sig NOT IN ('team_hub_post_agent_message(uuid,uuid,text,text,uuid,uuid,uuid,text,text,boolean)',
    '_team_hub_message_json(team_hub_messages)','team_hub_search(uuid,text,integer)'))) THEN RAISE EXCEPTION 'Peer body/config/ACL changed'; END IF;
END $$;
\echo 'PASS: E04 three complete source inverses; every original peer body/config/ACL retained'

SELECT pg_temp.check(has_function_privilege('service_role','public.team_hub_stage_agent_read_context(uuid,text,jsonb,jsonb)','EXECUTE')
 AND NOT has_function_privilege('authenticated','public.team_hub_stage_agent_read_context(uuid,text,jsonb,jsonb)','EXECUTE')
 AND NOT has_function_privilege('anon','public.team_hub_stage_agent_read_context(uuid,text,jsonb,jsonb)','EXECUTE')
 AND NOT has_function_privilege('service_role','public._team_hub_assert_agent_read_scope(public.team_hub_agent_turns)','EXECUTE')
 AND NOT has_function_privilege('authenticated','public._team_hub_agent_read_annotations(uuid)','EXECUTE'),
 'native stage service-only, internal scope/annotation inaccessible to browser and service');

SELECT pg_temp.check((SELECT config#>'{capability_scope,tools}' @> '["read_client_engagement_status"]'::jsonb FROM public.paige_subagents WHERE tenant_id IS NULL AND slug='merit')
 AND NOT EXISTS(SELECT 1 FROM e04_config_before b JOIN public.paige_subagents s USING(id)
  WHERE (b.slug<>'merit' AND s.config<>b.config)
   OR (b.slug='merit' AND jsonb_set(s.config,'{capability_scope,tools}',(s.config#>'{capability_scope,tools}')-'read_client_engagement_status')<>b.config)),
 'only one canonical MERIT private read key added; whole original config and other specialist exact');
\set e04_doc '42000000-0000-4000-8000-000000000004'
INSERT INTO public.paige_agreements VALUES (:'e04_doc',:'ta');
INSERT INTO public.paige_agreements VALUES ('42000000-0000-4000-8000-000000000005',:'tb');
SELECT pg_temp.j(:'u1',format('public.team_hub_open_agent_dm(%L::uuid,''merit'')',:'ta'))->>'channel_id' AS e04_dm \gset
SELECT pg_temp.post(:'u1',:'ta',:'e04_dm','Please inspect my agreement')#>>'{message,id}' AS e04_question \gset
SELECT pg_temp.tok('E04-READ') AS e04_token \gset
SELECT pg_temp.accept(:'ta',:'u1',:'e04_dm',:'e04_question','merit','dm',:'e04_token')->>'turn_id' AS e04_turn \gset
CREATE FUNCTION pg_temp.e04_stage(turn_id text,token text,tools jsonb,links jsonb,as_role text DEFAULT 'service_role') RETURNS jsonb LANGUAGE sql AS $$
 SELECT pg_temp.j(NULL,format('public.team_hub_stage_agent_read_context(%L::uuid,%L,%L::jsonb,%L::jsonb)',
  turn_id,pg_temp.h(token),tools,links),as_role) $$;
SELECT jsonb_build_array(jsonb_build_object('destination','sales_agreements','record_id',:'e04_doc')) AS e04_links \gset
SELECT pg_temp.check(pg_temp.e04_stage(:'e04_turn',:'e04_token','["agreement_list"]',:'e04_links')->>'ok'='true',
 'owner private original accepted turn stages verified references');
SELECT pg_temp.check(pg_temp.e04_stage(:'e04_turn',:'e04_token','["agreement_list"]',:'e04_links','authenticated') ? 'error'
 AND pg_temp.e04_stage(:'e04_turn',pg_temp.tok('WRONG'),'["agreement_list"]',:'e04_links')->>'code'='not_allowed'
 AND pg_temp.e04_stage(:'e04_turn',:'e04_token','["agreement_send"]',:'e04_links') ? 'error'
 AND pg_temp.e04_stage(:'e04_turn',:'e04_token','["agreement_list"]','[{"destination":"sales_agreements","record_id":"42000000-0000-4000-8000-000000000005"}]')->>'code'='not_allowed'
 AND pg_temp.e04_stage(:'e04_turn',:'e04_token','["agreement_list"]','[{"destination":"sales_agreements","record_id":null,"url":"https://example.test"}]')->>'code'='invalid',
 'browser, wrong token, consequential tool and address metadata refused');

-- Each native revocation is after a real successful preparation and rolls back independently.
BEGIN;
UPDATE public.tenant_members SET role='member' WHERE user_id=:'u1' AND tenant_id=:'ta';
SELECT pg_temp.check(pg_temp.agent_post(:'u1',:'ta',:'e04_dm','merit','must not publish',gen_random_uuid()::text,NULL,:'e04_question','dm',:'e04_token') ? 'error',
 'owner/admin loss after preparation refuses original publication');
ROLLBACK;
BEGIN;
UPDATE public.profiles SET active_tenant_id=:'tb' WHERE user_id=:'u1';
SELECT pg_temp.check(pg_temp.agent_post(:'u1',:'ta',:'e04_dm','merit','must not publish',gen_random_uuid()::text,NULL,:'e04_question','dm',:'e04_token') ? 'error'
 OR pg_temp.agent_post(:'u1',:'ta',:'e04_dm','merit','must not publish',gen_random_uuid()::text,NULL,:'e04_question','dm',:'e04_token')->>'ok'='false',
 'active-business switch after preparation refuses publication');
ROLLBACK;
BEGIN;
UPDATE public.paige_subagents SET config=jsonb_set(config,'{capability_scope,tools}','[]') WHERE tenant_id IS NULL AND slug='merit';
SELECT pg_temp.check(pg_temp.agent_post(:'u1',:'ta',:'e04_dm','merit','must not publish',gen_random_uuid()::text,NULL,:'e04_question','dm',:'e04_token') ? 'error',
 'stored specialist read scope revoked after preparation refuses publication');
ROLLBACK;
BEGIN;
UPDATE public.team_hub_agent_turns SET read_context=jsonb_set(read_context,'{expires_at}',to_jsonb(clock_timestamp()-interval '1 second')) WHERE id=:'e04_turn';
SELECT pg_temp.check(pg_temp.agent_post(:'u1',:'ta',:'e04_dm','merit','must not publish',gen_random_uuid()::text,NULL,:'e04_question','dm',:'e04_token') ? 'error',
 'expired attestation refuses publication without a new source read');
ROLLBACK;
BEGIN;
UPDATE auth.users SET banned_until=clock_timestamp()+interval '1 hour' WHERE id=:'u1';
SELECT pg_temp.check(pg_temp.agent_post(:'u1',:'ta',:'e04_dm','merit','must not publish',gen_random_uuid()::text,NULL,:'e04_question','dm',:'e04_token') ? 'error',
 'disabled original Auth actor after preparation refuses publication');
ROLLBACK;
-- Causal native mutation: removing only the added original-post scope call breaks
-- the already-proved role-loss property. The mutation/effect is rolled back.
BEGIN;
SELECT pg_temp.mutate('public.team_hub_post_agent_message(uuid,uuid,text,text,uuid,uuid,uuid,text,text,boolean)'::regprocedure,
 '   PERFORM public._team_hub_assert_agent_read_scope(turn);','   NULL; -- deliberately weakened proof mutant');
UPDATE public.tenant_members SET role='member' WHERE user_id=:'u1' AND tenant_id=:'ta';
SELECT pg_temp.agent_post(:'u1',:'ta',:'e04_dm','merit','mutant must escape this isolated probe',gen_random_uuid()::text,NULL,:'e04_question','dm',:'e04_token')->>'ok' AS e04_mutant_escaped \gset
ROLLBACK;
SELECT pg_temp.check(:'e04_mutant_escaped'='true','causal mutant removes native role-loss protection; unchanged control refused');
\echo 'PASS: E04 native publication guard mutant is detected; original guard restored'
SELECT gen_random_uuid() AS e04_request \gset
SELECT pg_temp.agent_post(:'u1',:'ta',:'e04_dm','merit','The source is a draft.',:'e04_request',NULL,:'e04_question','dm',:'e04_token') AS e04_posted \gset
SELECT pg_temp.check((:'e04_posted')::jsonb->>'ok'='true'
 AND (:'e04_posted')::jsonb#>>'{message,source_backed_read}'='true'
 AND (:'e04_posted')::jsonb#>'{message,paige_record_links}'=(:'e04_links')::jsonb,
 'existing native post returns exact references and source flag');
SELECT pg_temp.check(pg_temp.agent_post(:'u1',:'ta',:'e04_dm','merit','retry same original request',:'e04_request',NULL,:'e04_question','dm',:'e04_token')#>>'{message,id}'
  =(:'e04_posted')::jsonb#>>'{message,id}'
 AND (SELECT count(*) FROM public.team_hub_messages WHERE client_request_id=:'e04_request')=1,
 'same original token/request retry cannot create another message');
SELECT pg_temp.j(:'u1',format('public.team_hub_list_messages(%L::uuid,%L::uuid,NULL,NULL,NULL,50)',:'ta',:'e04_dm')) AS e04_reload \gset
SELECT pg_temp.check(EXISTS(SELECT 1 FROM jsonb_array_elements((:'e04_reload')::jsonb->'messages') m
 WHERE m->>'id'=(:'e04_posted')::jsonb#>>'{message,id}' AND m->'paige_record_links'=(:'e04_links')::jsonb),
 'original native message reload retains reopen references');
SELECT pg_temp.check(EXISTS(SELECT 1 FROM jsonb_array_elements(pg_temp.j(:'u1',format('public.team_hub_search(%L::uuid,''draft'',20)',:'ta'))->'results') r
 WHERE r->>'message_id'=(:'e04_posted')::jsonb#>>'{message,id}' AND r->>'source_backed_read'='true'),
 'original search tags source-backed snippets for model omission');
SELECT pg_temp.check(position(pg_temp.h(:'e04_token') IN (:'e04_reload')::text)=0
 AND position('expires_at' IN (:'e04_reload')::text)=0 AND position('read_tools' IN (:'e04_reload')::text)=0,
 'UI receives references only, no token, attestation or source arguments');
\echo 'PASS: E04 native private source-read publication, current authority, closed references, original duplicate recovery and reload'

-- Exercise the incoming A2b DEFAULTED ABI without pretending to execute its cards.
-- This uses the SAME incumbent body and real PostgreSQL resolution; the actual unmerged
-- f786 A2b body also has a separately recorded complete source inverse. Its card proof is separate.
\set e04_compose_sql `sed -n '/^DO \$patch\$/,/^END \$patch\$;/p' supabase/migrations/20271122010004_e04_team_hub_source_reads.sql`
BEGIN;
DO $abi$ DECLARE src text; BEGIN
 DROP FUNCTION public.team_hub_post_agent_message(uuid,uuid,text,text,uuid,uuid,uuid,text,text,boolean);
 SELECT prosrc INTO src FROM e04_before WHERE sig='team_hub_post_agent_message(uuid,uuid,text,text,uuid,uuid,uuid,text,text,boolean)';
 EXECUTE format('CREATE FUNCTION public.team_hub_post_agent_message(p_expected_tenant uuid,p_channel_id uuid,p_agent_key text,
 p_body text,p_client_request_id uuid,p_parent_message_id uuid,p_asked_in_message_id uuid,p_intent text,p_turn_token text,
 p_private_answer boolean DEFAULT false,p_confirmation_id uuid DEFAULT NULL,p_card_kind text DEFAULT NULL,
 p_card_outcome jsonb DEFAULT NULL,p_card_summary text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='''' AS %L',src);
 REVOKE ALL ON FUNCTION public.team_hub_post_agent_message(uuid,uuid,text,text,uuid,uuid,uuid,text,text,boolean,uuid,text,jsonb,text) FROM PUBLIC,anon,service_role;
 GRANT EXECUTE ON FUNCTION public.team_hub_post_agent_message(uuid,uuid,text,text,uuid,uuid,uuid,text,text,boolean,uuid,text,jsonb,text) TO authenticated;
 SELECT pg_get_functiondef('public._team_hub_message_json(public.team_hub_messages)'::regprocedure) INTO src;
 EXECUTE replace(src,E'\n  || public._team_hub_agent_read_annotations(p_message.id)','');
 SELECT pg_get_functiondef('public.team_hub_search(uuid,text,integer)'::regprocedure) INTO src;
 EXECUTE replace(src,'''source_backed_read'',coalesce((public._team_hub_agent_read_annotations(h.id)->>''source_backed_read'')::boolean,false),','');
END $abi$;
:e04_compose_sql
SELECT pg_temp.check(to_regprocedure('public.team_hub_post_agent_message(uuid,uuid,text,text,uuid,uuid,uuid,text,text,boolean)') IS NULL
 AND (SELECT pronargs=14 AND pronargdefaults=5 FROM pg_proc WHERE oid='public.team_hub_post_agent_message(uuid,uuid,text,text,uuid,uuid,uuid,text,text,boolean,uuid,text,jsonb,text)'::regprocedure)
 AND pg_temp.agent_post(:'u1',:'ta',:'e04_dm','merit','old named caller stays idempotent',:'e04_request',NULL,:'e04_question','dm',:'e04_token')#>>'{message,id}'=(:'e04_posted')::jsonb#>>'{message,id}',
 'native fourteen-argument ABI/defaults/old caller and duplicate recovery preserved');
ROLLBACK;
\echo 'PASS: original 10-argument and incoming 14-argument ABI composition; no A2b card execution claimed'
\endif
