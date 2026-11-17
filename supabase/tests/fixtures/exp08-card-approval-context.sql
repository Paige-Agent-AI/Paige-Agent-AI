-- Owning A2b disposable database only, after its historical assertions and mutants.
-- Match the actual protected-table ACL rather than the old default-grant fixture.
RESET ROLE;
SELECT set_config('request.jwt.claims','',false);
\ir ../../migrations/20271126035008_exp08_team_hub_stranded_card_resume.sql
REVOKE ALL ON public.team_hub_messages,public.team_hub_agent_turns,public.team_hub_message_cards
 FROM PUBLIC,anon,authenticated,service_role;
CREATE TEMP TABLE context_acl AS
 SELECT oid,relacl,relowner,relrowsecurity,relforcerowsecurity FROM pg_class
 WHERE oid IN ('public.team_hub_messages'::regclass,'public.team_hub_agent_turns'::regclass,'public.team_hub_message_cards'::regclass);
CREATE TEMP TABLE context_functions AS
 SELECT oid,to_jsonb(p)-'prosrc' AS metadata,prosrc FROM pg_proc p
 WHERE pronamespace='public'::regnamespace AND proname LIKE '%team_hub%';
SELECT pg_temp.j(:'u1',format('public.team_hub_open_agent_dm(%L::uuid,%L)',:'ta','nexus'))->>'channel_id' AS context_dm \gset
SELECT pg_temp.make_card(:'u1',:'ta',:'context_dm','nexus','growth_page_publish','page_publish','context publication') AS cx \gset
SELECT pg_temp.cs(pg_temp.cstates(:'u1',:'ta',:'context_dm',ARRAY[(:'cx')::jsonb->>'card']),(:'cx')::jsonb->>'card') AS context_before \gset

\if :{?exp08_card_context_baseline}
 \echo 'BASELINE: original protected caller reader has no approval context'
\else
 \ir ../../migrations/20271133000024_exp08_card_approval_context.sql
 \ir ../../migrations/20271133000024_exp08_card_approval_context.sql
\endif

SELECT pg_temp.cs(pg_temp.cstates(:'u1',:'ta',:'context_dm',ARRAY[(:'cx')::jsonb->>'card']),(:'cx')::jsonb->>'card') AS context_after \gset
SELECT pg_temp.check((:'context_after')::jsonb->'approval_context'=jsonb_build_object(
 'tenant_id',:'ta','channel_id',:'context_dm','approver_user_id',:'u1',
 'agent_key','nexus','source_message_id',(:'cx')::jsonb->>'q','root_message_id',(:'cx')::jsonb->>'card'),
 'context: real authenticated approver gets the exact original source and root under protected-table ACLs');
SELECT pg_temp.check((:'context_after')::jsonb-'approval_context'=(:'context_before')::jsonb,
 'context: original member-safe card state and resume/fingerprint/record fields remain identical');

DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM context_acl b JOIN pg_class c ON c.oid=b.oid
  WHERE ROW(c.relacl,c.relowner,c.relrowsecurity,c.relforcerowsecurity)
   IS DISTINCT FROM ROW(b.relacl,b.relowner,b.relrowsecurity,b.relforcerowsecurity))
  OR EXISTS(SELECT 1 FROM context_functions b JOIN pg_proc p ON p.oid=b.oid
   WHERE to_jsonb(p)-'prosrc' IS DISTINCT FROM b.metadata
    OR (p.proname<>'team_hub_card_states' AND p.prosrc<>b.prosrc)) THEN
  RAISE EXCEPTION 'FAIL: context repair changed original ACLs, metadata or another Team Hub function';
 END IF;
END $$;
SELECT pg_temp.check(pg_temp.j(:'u1',format('public.team_hub_card_states(%L::uuid,%L::uuid,%L::uuid[])',
 :'ta',:'context_dm',ARRAY[(:'cx')::jsonb->>'card']),'anon') ? 'error'
 AND pg_temp.j(NULL,format('public.team_hub_card_states(%L::uuid,%L::uuid,%L::uuid[])',
 :'ta',:'context_dm',ARRAY[(:'cx')::jsonb->>'card']),'service_role') ? 'error'
 AND pg_temp.j(NULL,'(SELECT to_jsonb(count(*)) FROM public.team_hub_messages)','service_role') ? 'error'
 AND pg_temp.j(NULL,'(SELECT to_jsonb(count(*)) FROM public.team_hub_agent_turns)','service_role') ? 'error'
 AND pg_temp.j(NULL,'(SELECT to_jsonb(count(*)) FROM public.team_hub_message_cards)','service_role') ? 'error',
 'context: anon/service cannot execute caller reader and all direct service table reads remain denied');

SELECT pg_temp.check(pg_temp.cstates(:'u3',:'ta',:'context_dm',ARRAY[(:'cx')::jsonb->>'card'])->>'code'='not_found'
 AND pg_temp.cstates(:'u7',:'tb',:'bz',ARRAY[(:'cx')::jsonb->>'card'])->'cards'='[]'::jsonb
 AND pg_temp.cstates(:'u1',:'ta',:'launch',ARRAY[(:'cx')::jsonb->>'card'])->'cards'='[]'::jsonb,
 'context: another actor, workspace or conversation gets no private context');
BEGIN;
SELECT pg_temp.peek(:'context_dm',:'ta',:'u3');
SELECT pg_temp.check(NOT (pg_temp.cs(pg_temp.cstates(:'u3',:'ta',:'context_dm',
 ARRAY[(:'cx')::jsonb->>'card']),(:'cx')::jsonb->>'card') ? 'approval_context'),
 'context: even fabricated visibility cannot reveal the approver context to another actor');
ROLLBACK;

-- Native private follow-up retains its original external asking message.
SELECT pg_temp.post(:'u1',:'ta',:'launch','Please prepare my private publication','{nexus}')#>>'{message,id}' AS context_source \gset
SELECT pg_temp.accept(:'ta',:'u1',:'context_dm',:'context_source','nexus','dm',pg_temp.tok('context-followup')) AS context_accept \gset
SELECT pg_temp.proposal(:'u1',:'ta','growth_page_publish','context-followup')::text AS context_conf \gset
SELECT pg_temp.apost(:'u1',:'ta',:'context_dm','nexus','Private follow-up',gen_random_uuid()::text,
 NULL,NULL,'dm',pg_temp.tok('context-followup'),:'context_conf','page_publish') AS context_followup \gset
SELECT pg_temp.check((:'context_accept')::jsonb->>'ok'='true' AND (:'context_followup')::jsonb->>'ok'='true'
 AND (SELECT asked_in_message_id IS NULL FROM public.team_hub_messages WHERE id=((:'context_followup')::jsonb#>>'{message,id}')::uuid)
 AND pg_temp.cs(pg_temp.cstates(:'u1',:'ta',:'context_dm',
 ARRAY[(:'context_followup')::jsonb#>>'{message,id}']),(:'context_followup')::jsonb#>>'{message,id}')
 #>>'{approval_context,source_message_id}'=:'context_source',
 'context: private follow-up comes from accepted turn when visible asked-in field is null');

BEGIN;
UPDATE public.team_hub_messages SET deleted_at=now() WHERE id=:'context_source'::uuid;
SELECT pg_temp.check(NOT (pg_temp.cs(pg_temp.cstates(:'u1',:'ta',:'context_dm',
 ARRAY[(:'context_followup')::jsonb#>>'{message,id}']),(:'context_followup')::jsonb#>>'{message,id}') ? 'approval_context'),
 'context: deleted original source cannot supply context');
ROLLBACK;

BEGIN;
UPDATE public.team_hub_agent_turns SET posted_message_id=NULL
 WHERE posted_message_id=((:'cx')::jsonb->>'card')::uuid;
SELECT pg_temp.check(NOT (pg_temp.cs(pg_temp.cstates(:'u1',:'ta',:'context_dm',
 ARRAY[(:'cx')::jsonb->>'card']),(:'cx')::jsonb->>'card') ? 'approval_context'),
 'context: absent accepted-turn provenance supplies no context');
ROLLBACK;

BEGIN;
-- Introduce impossible storage ambiguity only inside this rolled-back local probe.
DROP INDEX public.team_hub_agent_turns_posted_idx;
ALTER TABLE public.team_hub_agent_turns DISABLE TRIGGER USER;
INSERT INTO public.team_hub_agent_turns
 SELECT (jsonb_populate_record(NULL::public.team_hub_agent_turns,
  to_jsonb(t)||jsonb_build_object('id',gen_random_uuid(),'intent','reply','token_hash',repeat('a',64)))).*
 FROM public.team_hub_agent_turns t WHERE t.posted_message_id=((:'cx')::jsonb->>'card')::uuid;
SELECT pg_temp.check(NOT (pg_temp.cs(pg_temp.cstates(:'u1',:'ta',:'context_dm',
 ARRAY[(:'cx')::jsonb->>'card']),(:'cx')::jsonb->>'card') ? 'approval_context'),
 'context: duplicate provenance supplies no context even without storage uniqueness');
ROLLBACK;

BEGIN;
ALTER TABLE public.team_hub_agent_turns DISABLE TRIGGER USER;
UPDATE public.team_hub_agent_turns SET agent_key='vera'
 WHERE posted_message_id=((:'cx')::jsonb->>'card')::uuid;
SELECT pg_temp.check(NOT (pg_temp.cs(pg_temp.cstates(:'u1',:'ta',:'context_dm',
 ARRAY[(:'cx')::jsonb->>'card']),(:'cx')::jsonb->>'card') ? 'approval_context'),
 'context: known but mismatched agent supplies no context');
ROLLBACK;

BEGIN;
SELECT pg_temp.seat(:'ta',:'u1','suspended');
SELECT pg_temp.check(pg_temp.cstates(:'u1',:'ta',:'context_dm',ARRAY[(:'cx')::jsonb->>'card'])->>'ok'='false',
 'context: actor currentness remains enforced before projection');
ROLLBACK;

-- Preserve original decline, expiration, stranded recovery and server settlement.
BEGIN;
SELECT pg_temp.decide(:'u1',:'ta',(:'cx')::jsonb->>'card','decline',(:'cx')::jsonb->>'fp') AS context_decline \gset
SELECT pg_temp.check((:'context_decline')::jsonb->>'decision'='declined'
 AND (SELECT consumed_at IS NOT NULL FROM public.paige_pending_confirmations WHERE id=((:'cx')::jsonb->>'conf')::uuid),
 'context: original decline still consumes the exact proposal');
ROLLBACK;
BEGIN;
UPDATE public.paige_pending_confirmations SET expires_at=now()-interval '1 second' WHERE id=((:'cx')::jsonb->>'conf')::uuid;
SELECT pg_temp.check(pg_temp.decide(:'u1',:'ta',(:'cx')::jsonb->>'card','approve',(:'cx')::jsonb->>'fp')->>'code'='expired',
 'context: original expiry refuses approval');
ROLLBACK;
BEGIN;
SELECT pg_temp.decide(:'u1',:'ta',(:'cx')::jsonb->>'card','approve',(:'cx')::jsonb->>'fp') AS context_decide \gset
UPDATE public.team_hub_message_cards SET decided_at=now()-interval '20 seconds' WHERE message_id=((:'cx')::jsonb->>'card')::uuid;
SELECT pg_temp.check((:'context_decide')::jsonb->>'ok'='true'
 AND pg_temp.cs(pg_temp.cstates(:'u1',:'ta',:'context_dm',ARRAY[(:'cx')::jsonb->>'card']),(:'cx')::jsonb->>'card')#>>'{card,can_resume}'='true',
 'context: original stranded approval remains resumable');
SELECT pg_temp.check(pg_temp.settle_as_user(:'u1',:'ta',(:'cx')::jsonb->>'card','{"state":"done"}') ? 'error',
 'context: approver cannot assert execution completion');
SELECT pg_temp.settle(:'u1',:'ta',(:'cx')::jsonb->>'card','{"state":"done","note":"Synthetic domain execution verified"}') AS context_settle \gset
SELECT pg_temp.check((:'context_settle')::jsonb->>'ok'='true'
 AND pg_temp.cs(pg_temp.cstates(:'u1',:'ta',:'context_dm',ARRAY[(:'cx')::jsonb->>'card']),(:'cx')::jsonb->>'card')#>>'{card,state}'='done',
 'context: original service settlement remains authoritative');
ROLLBACK;
\set context_guard_sql `sed -n '/^DO \$guard\$/,/^END \$guard\$;/p' supabase/migrations/20271133000024_exp08_card_approval_context.sql`
BEGIN;
-- Supabase fresh-branch defaults can retain these non-DML rights after old
-- migrations revoke the four DML privileges. Actual production has none.
GRANT TRUNCATE,REFERENCES,TRIGGER ON public.team_hub_messages,public.team_hub_agent_turns,public.team_hub_message_cards TO service_role;
SELECT pg_temp.try(:'context_guard_sql') AS context_default_normalize \gset
SELECT pg_temp.check(:'context_default_normalize'='ran'
 AND NOT EXISTS(SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a
  WHERE c.oid IN ('public.team_hub_messages'::regclass,'public.team_hub_agent_turns'::regclass,'public.team_hub_message_cards'::regclass)
   AND a.grantee<>'postgres'::regrole),
 'context: fresh-branch residual service administration rights narrow to exact production ACLs');
ROLLBACK;
BEGIN;
GRANT SELECT,TRUNCATE ON public.team_hub_messages TO service_role;
SELECT pg_temp.try(:'context_guard_sql') AS context_forbidden_read \gset
SELECT pg_temp.check(:'context_forbidden_read'='EXP08 protected card table grants drift'
 AND has_table_privilege('service_role','public.team_hub_messages','SELECT')
 AND has_table_privilege('service_role','public.team_hub_messages','TRUNCATE'),
 'context: forward installer refuses broadened protected-table grants');
ROLLBACK;
CREATE FUNCTION pg_temp.context_guard_refusal(ddl text,guard_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE answer text;
BEGIN
 BEGIN
  EXECUTE ddl;
  answer:=pg_temp.try(guard_sql);
  RAISE EXCEPTION USING ERRCODE='ZX008',MESSAGE='rollback isolated privilege probe';
 EXCEPTION WHEN SQLSTATE 'ZX008' THEN NULL;
 END;
 RETURN answer;
END $$;
SELECT pg_temp.check(NOT EXISTS(SELECT 1 FROM (VALUES
 ('GRANT INSERT ON public.team_hub_messages TO service_role'),
 ('GRANT UPDATE ON public.team_hub_agent_turns TO service_role'),
 ('GRANT DELETE ON public.team_hub_message_cards TO service_role'),
 ('GRANT TRIGGER ON public.team_hub_messages TO service_role WITH GRANT OPTION'),
 ('GRANT TRIGGER ON public.team_hub_messages TO authenticated'),
 ('GRANT TRIGGER ON public.team_hub_messages TO anon'),
 ('GRANT TRIGGER ON public.team_hub_messages TO PUBLIC'),
 ('ALTER TABLE public.team_hub_messages DISABLE ROW LEVEL SECURITY')
 ) probes(ddl) WHERE pg_temp.context_guard_refusal(ddl,:'context_guard_sql') IS DISTINCT FROM 'EXP08 protected card table grants drift'),
 'context: DML, grant options, caller/public grants and disabled RLS all refuse instead of normalizing');
BEGIN;
SELECT pg_temp.mutate('public.team_hub_card_states(uuid,uuid,uuid[])'::regprocedure,
 's.approver_user_id=actor AND s.approval_context IS NOT NULL','true AND s.approval_context IS NOT NULL');
SELECT pg_temp.check(pg_temp.try(:'context_guard_sql')='EXP08 card context prerequisite drift',
 'context: forward installer refuses a changed source body');
ROLLBACK;
\o
\pset tuples_only on
\pset format unaligned
SELECT 'EXP08_CARD_CONTEXT_CONTRACT:'||jsonb_build_object(
 'body_md5',md5(p.prosrc),'acl',p.proacl::text,'owner',p.proowner::regrole::text,
 'security_definer',p.prosecdef,'config',p.proconfig)::text
 FROM pg_proc p WHERE p.oid='public.team_hub_card_states(uuid,uuid,uuid[])'::regprocedure;
\echo 'PASS: EXP08 protected card approval context and original decision/recovery roles'
