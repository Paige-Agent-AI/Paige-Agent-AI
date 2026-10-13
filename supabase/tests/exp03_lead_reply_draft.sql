-- ISOLATED full production-schema-only clone only; never execute on production.
-- Experience 03 · S3 "PAIGE works your leads" — the reply draft growth-process-submission files.
--
-- Proves, through the REAL action-bus writers (file_action, advance_action) and the REAL catalogue row:
--   1. One owner.lead_followup per (business, submission): a second filing for the same submission is
--      refused (23505), whether through file_action or a direct insert; another submission, another
--      business, an action with no submission_id, and another action kind are all unaffected.
--   2. owner.lead_followup can never go out without the owner: its catalogue row is
--      send_via_approval / requires_approval / lane confirm / cs_draft; the two CHECKs refuse an 'auto'
--      default lane and dropping requires_approval; the processor's filing (no lane override) lands at
--      confirm; and a drafted reply routes to paige_pending_approvals — never to 'executing' — even when
--      a caller asked file_action for the 'auto' lane.
--   3. The migration replays as a no-op, and lead_reply_skipped_reason exists for the processor.
--
-- Synthetic tenants and people only (§2/§63); one transaction that ROLLS BACK.
-- Runs against a database with every migration applied (CI: paige-spine-contract › database-contract).
-- The migration is replayed below with \ir, so this file also applies it to a database one migration
-- behind (a local stack), still inside the rolled-back transaction.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL timezone='UTC';
SELECT set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claim.role','',true);
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);

CREATE FUNCTION pg_temp.check_true(v boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF v IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',label; END IF; RAISE NOTICE 'PASS: %',label; END $$;
CREATE FUNCTION pg_temp.refused(stmt text,code text,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN BEGIN EXECUTE stmt; EXCEPTION WHEN others THEN IF SQLSTATE=code THEN RAISE NOTICE 'PASS: %',label; RETURN; END IF;
RAISE EXCEPTION 'FAIL: % unexpected %: %',label,SQLSTATE,SQLERRM; END; RAISE EXCEPTION 'FAIL: % accepted',label; END $$;
-- file_action as growth-process-submission calls it: the service path (no JWT subject), the claimed
-- submission's tenant passed explicitly, and the kind's default lane unless one is given.
CREATE FUNCTION pg_temp.file_reply(tenant uuid,contact uuid,submission text,lane text DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.file_action('owner.lead_followup','Reply to a new lead - Test form',NULL,contact,
   jsonb_build_object('submission_id',submission,'form_id','e3000000-0000-4000-8000-0000000f0001','source','growth_form',
     'draft_input',jsonb_build_object('intent','Reply personally','key_points',jsonb_build_array('Budget: 2000'),'tone','warm','length','short')),
   NULL,NULL,NULL,NULL,NULL,NULL,'paige',tenant,lane) $$;

-- ── 0. The migration (replayed: a database that already has it proves replay is a no-op). ──────────
\ir ../migrations/20271030000000_exp03_lead_reply_once_per_submission.sql
\ir ../migrations/20271030000000_exp03_lead_reply_once_per_submission.sql

SELECT pg_temp.check_true((SELECT count(*)=1 FROM pg_indexes WHERE schemaname='public' AND indexname='uq_paige_actions_lead_followup_submission'),
  'the reply-draft index exists exactly once after a replay');
SELECT pg_temp.check_true((
  SELECT i.indisunique AND i.indrelid='public.paige_actions'::regclass
     AND pg_get_expr(i.indpred,i.indrelid) LIKE '%owner.lead_followup%'
     AND pg_get_indexdef(i.indexrelid) LIKE '%tenant_id%' AND pg_get_indexdef(i.indexrelid) LIKE '%submission_id%'
    FROM pg_index i WHERE i.indexrelid='public.uq_paige_actions_lead_followup_submission'::regclass),
  'it is UNIQUE on paige_actions (tenant_id, payload->>submission_id), partial to owner.lead_followup');
SELECT pg_temp.check_true(EXISTS(SELECT 1 FROM information_schema.columns
  WHERE table_schema='public' AND table_name='growth_form_submissions' AND column_name='lead_reply_skipped_reason' AND is_nullable='YES'),
  'growth_form_submissions.lead_reply_skipped_reason exists for the processor to record why no draft was filed');

-- ── 1. The catalogue row and its two safety CHECKs (unchanged by this slice, asserted here). ───────
SELECT pg_temp.check_true((SELECT executor='send_via_approval' AND requires_approval AND default_autonomy_lane='confirm'
    AND approval_type='cs_draft' AND draft_subagent_slug='email-composer' AND enabled AND tenant_id IS NULL
   FROM public.paige_action_kinds WHERE slug='owner.lead_followup'),
  'owner.lead_followup is a platform send_via_approval kind: requires approval, lane confirm, drafted by email-composer');
SELECT pg_temp.refused($$UPDATE public.paige_action_kinds SET default_autonomy_lane='auto' WHERE slug='owner.lead_followup'$$,
  '23514','chk_auto_lane_safe refuses an auto default lane for the reply kind');
SELECT pg_temp.refused($$UPDATE public.paige_action_kinds SET requires_approval=false WHERE slug='owner.lead_followup'$$,
  '23514','chk_send_requires_approval refuses dropping the approval requirement');

-- ── Fixtures: two Solo businesses, a lead in each. ─────────────────────────────────────────────────
INSERT INTO auth.users(id,email) VALUES
 ('e3000000-0000-4000-8000-000000000001','exp03-reply-owner-a@example.invalid'),
 ('e3000000-0000-4000-8000-000000000002','exp03-reply-owner-b@example.invalid');
DO $fixture_owner$ DECLARE fixture_owner_id uuid; BEGIN
 IF (SELECT count(*) FROM public.user_roles WHERE role='super_admin')>1 THEN RAISE EXCEPTION 'FIXTURE: canonical owner is ambiguous'; END IF;
 SELECT user_id INTO fixture_owner_id FROM public.user_roles WHERE role='super_admin';
 IF fixture_owner_id IS NULL THEN
   fixture_owner_id := 'e3000000-0000-4000-8000-000000000004';
   INSERT INTO auth.users(id,email) VALUES(fixture_owner_id,'exp03-reply-fixture-owner@example.invalid');
   INSERT INTO public.user_roles(user_id,role) VALUES(fixture_owner_id,'super_admin');
 END IF;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',fixture_owner_id)::text,true);
END $fixture_owner$;
INSERT INTO public.tenants(id,slug,name,status,account_type,account_number_prefix,features) VALUES
 ('e3000000-0000-4000-8000-00000000aaaa','test-exp03-reply-a','Test Reply A','active','standalone','E3A','{}'),
 ('e3000000-0000-4000-8000-00000000bbbb','test-exp03-reply-b','Test Reply B','active','standalone','E3B','{}');
SELECT set_config('request.jwt.claims','{}',true);
INSERT INTO public.tenant_members(tenant_id,user_id,role,status,is_owner,joined_at) VALUES
 ('e3000000-0000-4000-8000-00000000aaaa','e3000000-0000-4000-8000-000000000001','owner','active',true,now()),
 ('e3000000-0000-4000-8000-00000000bbbb','e3000000-0000-4000-8000-000000000002','owner','active',true,now());
INSERT INTO public.clients(id,tenant_id,created_by,first_name,last_name,account_number,lifecycle_stage,source) VALUES
 ('e3000000-0000-4000-8000-0000000c0001','e3000000-0000-4000-8000-00000000aaaa','e3000000-0000-4000-8000-000000000001','Synthetic','Lead A','E3A-1','new_lead','paige_form'),
 ('e3000000-0000-4000-8000-0000000c00b1','e3000000-0000-4000-8000-00000000bbbb','e3000000-0000-4000-8000-000000000002','Synthetic','Lead B','E3B-1','new_lead','paige_form');
-- Back to the processor's identity: service role, no JWT subject.
SELECT set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT pg_temp.check_true(auth.uid() IS NULL,'the filings below run on the service path (no JWT subject), as the processor does');

CREATE TEMP TABLE filed(label text PRIMARY KEY, result jsonb) ON COMMIT DROP;
INSERT INTO filed VALUES ('a1', pg_temp.file_reply('e3000000-0000-4000-8000-00000000aaaa','e3000000-0000-4000-8000-0000000c0001','e3000000-0000-4000-8000-00000005e001'));

-- ── 2. One draft per submission. ───────────────────────────────────────────────────────────────────
SELECT pg_temp.check_true((SELECT (result->>'ok')::boolean AND result->>'status'='filed' FROM filed WHERE label='a1'),
  'the first reply draft for a submission is filed');
SELECT pg_temp.check_true((SELECT autonomy_lane='confirm' AND status='filed' AND assigned_subagent_slug='email-composer'
    AND tenant_id='e3000000-0000-4000-8000-00000000aaaa' AND contact_id='e3000000-0000-4000-8000-0000000c0001'
    AND payload->>'source'='growth_form' AND payload->'draft_input'->>'tone'='warm'
   FROM public.paige_actions WHERE id=(SELECT (result->>'action_id')::uuid FROM filed WHERE label='a1')),
  'filed at lane confirm (no override), for the claimed business and the intake''s contact, routed to email-composer');
SELECT pg_temp.refused($$SELECT pg_temp.file_reply('e3000000-0000-4000-8000-00000000aaaa','e3000000-0000-4000-8000-0000000c0001','e3000000-0000-4000-8000-00000005e001')$$,
  '23505','a second reply draft for the same submission is refused (file_action)');
SELECT pg_temp.refused($$INSERT INTO public.paige_actions(tenant_id,action_kind,from_department,to_department,title,payload,status,autonomy_lane)
   VALUES ('e3000000-0000-4000-8000-00000000aaaa','owner.lead_followup','owner_ops','client_experience','direct',jsonb_build_object('submission_id','e3000000-0000-4000-8000-00000005e001'),'filed','confirm')$$,
  '23505','a second reply draft for the same submission is refused (direct insert)');
SELECT pg_temp.check_true((SELECT count(*)=1 FROM public.paige_actions WHERE action_kind='owner.lead_followup'
    AND tenant_id='e3000000-0000-4000-8000-00000000aaaa' AND payload->>'submission_id'='e3000000-0000-4000-8000-00000005e001'),
  'exactly one reply draft exists for that submission');

INSERT INTO filed VALUES ('a2', pg_temp.file_reply('e3000000-0000-4000-8000-00000000aaaa','e3000000-0000-4000-8000-0000000c0001','e3000000-0000-4000-8000-00000005e002'));
SELECT pg_temp.check_true((SELECT (result->>'ok')::boolean FROM filed WHERE label='a2'),'another submission from the same lead gets its own draft');
INSERT INTO filed VALUES ('b1', pg_temp.file_reply('e3000000-0000-4000-8000-00000000bbbb','e3000000-0000-4000-8000-0000000c00b1','e3000000-0000-4000-8000-00000005e001'));
SELECT pg_temp.check_true((SELECT (result->>'ok')::boolean FROM filed WHERE label='b1'),'another business is never blocked by this business''s submission id');
SELECT pg_temp.check_true((SELECT (public.file_action('owner.lead_followup','Chat follow-up',NULL,'e3000000-0000-4000-8000-0000000c0001','{}'::jsonb,
    NULL,NULL,NULL,NULL,NULL,NULL,'paige','e3000000-0000-4000-8000-00000000aaaa',NULL)->>'ok')::boolean
  AND (public.file_action('owner.lead_followup','Chat follow-up 2',NULL,'e3000000-0000-4000-8000-0000000c0001','{}'::jsonb,
    NULL,NULL,NULL,NULL,NULL,NULL,'paige','e3000000-0000-4000-8000-00000000aaaa',NULL)->>'ok')::boolean),
  'follow-ups with no submission_id (e.g. from chat) are unaffected — any number may be filed');
SELECT pg_temp.check_true((SELECT (public.file_action('owner.lead_captured','Lead captured',NULL,'e3000000-0000-4000-8000-0000000c0001',
    jsonb_build_object('submission_id','e3000000-0000-4000-8000-00000005e001'),NULL,NULL,NULL,NULL,NULL,NULL,'paige','e3000000-0000-4000-8000-00000000aaaa',NULL)->>'ok')::boolean),
  'another action kind carrying the same submission_id is unaffected (the index is partial to owner.lead_followup)');

-- ── 3. A drafted reply always goes to the owner. ───────────────────────────────────────────────────
-- The processor's own filing (lane confirm), drafted the way paige-action-worker stores it.
SELECT public.advance_action((SELECT (result->>'action_id')::uuid FROM filed WHERE label='a1'),'drafted',
  jsonb_build_object('channel','email','subject','Thanks for reaching out','body','<p>Hi</p>','body_text','Hi','raw','{}'::jsonb),
  NULL,NULL,NULL,NULL,NULL,NULL,'e3000000-0000-4000-8000-00000000aaaa');
SELECT pg_temp.check_true((SELECT a.status='pending_approval' AND a.approval_id IS NOT NULL AND a.executed_at IS NULL
    AND p.type='cs_draft' AND p.category='owner.lead_followup' AND p.tenant_id=a.tenant_id AND p.contact_id=a.contact_id
    AND p.metadata->>'action_id'=a.id::text AND p.draft_content->>'subject'='Thanks for reaching out'
   FROM public.paige_actions a JOIN public.paige_pending_approvals p ON p.id=a.approval_id
  WHERE a.id=(SELECT (result->>'action_id')::uuid FROM filed WHERE label='a1')),
  'a drafted reply becomes a cs_draft approval for the owner, carrying the draft; it is not executed');
-- Even a caller that asks file_action for the auto lane cannot make a reply skip the owner.
INSERT INTO filed VALUES ('auto', pg_temp.file_reply('e3000000-0000-4000-8000-00000000aaaa','e3000000-0000-4000-8000-0000000c0001','e3000000-0000-4000-8000-00000005e003','auto'));
SELECT public.advance_action((SELECT (result->>'action_id')::uuid FROM filed WHERE label='auto'),'drafted',
  jsonb_build_object('channel','email','subject','S','body','<p>B</p>','body_text','B','raw','{}'::jsonb),
  NULL,NULL,NULL,NULL,NULL,NULL,'e3000000-0000-4000-8000-00000000aaaa');
SELECT pg_temp.check_true((SELECT status='pending_approval' AND approval_id IS NOT NULL AND executed_at IS NULL
   FROM public.paige_actions WHERE id=(SELECT (result->>'action_id')::uuid FROM filed WHERE label='auto')),
  'a reply filed with an auto lane request still waits for the owner''s approval (send_via_approval requires it)');
SELECT pg_temp.refused($$SELECT public.advance_action((SELECT (result->>'action_id')::uuid FROM filed WHERE label='a2'),'executing',
   NULL,NULL,NULL,NULL,NULL,NULL,NULL,'e3000000-0000-4000-8000-00000000aaaa')$$,
  '22023','forcing a reply straight to executing is refused: send kinds only go out through the approval lane');
SELECT pg_temp.refused($$SELECT public.advance_action((SELECT (result->>'action_id')::uuid FROM filed WHERE label='b1'),'drafted',
   NULL,NULL,NULL,NULL,NULL,NULL,NULL,'e3000000-0000-4000-8000-00000000aaaa')$$,
  '42501','a reply cannot be advanced under another business''s tenant');

ROLLBACK;
