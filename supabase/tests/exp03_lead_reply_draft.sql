-- ISOLATED full production-schema-only clone only; never execute on production.
-- Experience 03 · S3 "PAIGE works your leads" — the reply draft, its opt-in, and the only way it is
-- ever marked sent.
--
-- Proves, through the REAL writers (file_action, advance_action, growth_form_set_intake, the governed
-- email door's prepare/claim/finalize, lead_reply_record_send) and the REAL catalogue rows:
--   1. One owner.lead_followup per (business, submission) — file_action and a direct insert both refused.
--   2. owner.lead_followup can never go out without the owner: its catalogue row and CHECKs, and a draft
--      lands as a pending approval even when a caller asked for the auto lane.
--   3. The send guard on paige_pending_approvals: an approval standing for a send_via_approval action —
--      a reply, AND a legacy client.followup in the nested draft shape — is refused approved/sent with no
--      governed send, with a failed send, another business's send, another person's send, a mismatched
--      operation, a re-used send, or with metadata.action_id stripped in the same write; EACH of its three
--      signals (new metadata.action_id, stored OLD metadata.action_id, paige_actions.approval_id) is
--      enough on its own, upper-case ids included; the refusal says per kind what can be done
--      (review_and_send for a reply, decline_only for every other send kind); created already-approved
--      is refused; declining is allowed; a provider-accepted send of the same business and person is
--      accepted; the unique message index refuses a second approval citing the same message even with
--      the guard trigger disabled; a non-send action's approval (approve, decline, approve→sent) and a
--      plain approval behave as before.
--   4. lead_reply_record_send / lead_reply_record_send_service: no grant for anon/service_role (and the
--      service twin none for anon/authenticated; the shared body none for anyone); refuses a plain member,
--      another business, a wrong kind, null arguments, a send made by another person, a second send while
--      an earlier one is unresolved, and a business that is not active (an outsider still gets the
--      plain refusal); an outsider's refused call takes no row lock; answers not_found for another
--      person's / business's / unknown operation; records prepared|dispatching|unknown (stays pending),
--      leaves failed|refused untouched, approves on provider_accepted (delivery_confirmed false, action
--      done, lead's last contact stamped), replays idempotently, refuses a second different operation,
--      and lets a failed send be retried with a new accepted one. The service twin applies the same
--      validation with the door's bound actor and refuses a JWT subject.
--   5. lead_reply_enabled: default false; set/kept/cleared through growth_form_set_intake (6 args, and
--      NULL = unchanged); the existing 5-arg positional and named calls still work and keep it; a direct
--      browser insert/update is refused; a plain member and an agency account cannot turn it on.
--   6. The migration replays as a no-op.
--
-- Synthetic tenants and people only (§2/§63); one transaction that ROLLS BACK.
-- Runs against a database with every migration applied (CI: paige-spine-contract › database-contract).
-- The migration is replayed below with \ir, so this file also applies it to a database one migration
-- behind (a local stack), still inside the rolled-back transaction.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL timezone='UTC';
SET LOCAL lock_timeout='5s';
SELECT set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claim.role','',true);
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);

CREATE FUNCTION pg_temp.check_true(v boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF v IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',label; END IF; RAISE NOTICE 'PASS: %',label; END $$;
-- Expects stmt to raise SQLSTATE code with a message LIKE msg: the message pins WHICH guard refused,
-- so an unrelated refusal sharing the code cannot pass for it.
CREATE FUNCTION pg_temp.refused(stmt text,code text,msg text,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN BEGIN EXECUTE stmt; EXCEPTION WHEN others THEN
  IF SQLSTATE=code AND SQLERRM LIKE msg THEN RAISE NOTICE 'PASS: %',label; RETURN; END IF;
  RAISE EXCEPTION 'FAIL: % unexpected % %',label,SQLSTATE,SQLERRM; END;
RAISE EXCEPTION 'FAIL: % accepted',label; END $$;
-- Same, and also pins the refusal's DETAIL (the per-kind reason_code).
CREATE FUNCTION pg_temp.refused_detail(stmt text,code text,msg text,detail text,label text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE d text; BEGIN BEGIN EXECUTE stmt; EXCEPTION WHEN others THEN
  GET STACKED DIAGNOSTICS d = PG_EXCEPTION_DETAIL;
  IF SQLSTATE=code AND SQLERRM LIKE msg AND d LIKE detail THEN RAISE NOTICE 'PASS: %',label; RETURN; END IF;
  RAISE EXCEPTION 'FAIL: % unexpected % % [%]',label,SQLSTATE,SQLERRM,d; END;
RAISE EXCEPTION 'FAIL: % accepted',label; END $$;
CREATE FUNCTION pg_temp.as_user(uid text) RETURNS void LANGUAGE sql AS $$
 SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',uid)::text,true),
        set_config('request.jwt.claim.sub',uid,true) $$;
CREATE FUNCTION pg_temp.as_service() RETURNS void LANGUAGE sql AS $$
 SELECT set_config('request.jwt.claims','{"role":"service_role"}',true), set_config('request.jwt.claim.sub','',true) $$;
-- file_action as growth-process-submission calls it: the service path (no JWT subject), the claimed
-- submission's tenant passed explicitly, and the kind's default lane unless one is given.
CREATE FUNCTION pg_temp.file_reply(tenant uuid,contact uuid,submission text,lane text DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.file_action('owner.lead_followup','Reply to a new lead - Test form',NULL,contact,
   jsonb_build_object('submission_id',submission,'form_id','e3000000-0000-4000-8000-0000000f0001','source','growth_form',
     'draft_input',jsonb_build_object('intent','Reply personally','key_points',jsonb_build_array('Budget: 2000'),'tone','warm','length','short','recipient_name','Synthetic')),
   NULL,NULL,NULL,NULL,NULL,NULL,'paige',tenant,lane) $$;
-- The draft exactly as paige-action-worker stores it for owner.lead_followup.
CREATE FUNCTION pg_temp.draft(action uuid,tenant uuid,subject text DEFAULT 'Thanks for reaching out') RETURNS void LANGUAGE sql AS $$
 SELECT public.advance_action(action,'drafted',
   jsonb_build_object('channel','email','subject',subject,'body','Hi Synthetic, thanks for writing in.',
     'body_html','<p>Hi Synthetic, thanks for writing in.</p>','raw','{}'::jsonb),
   NULL,NULL,NULL,NULL,NULL,NULL,tenant);
 SELECT NULL::void $$;
-- A reply filed AND drafted for a fresh submission of lead A1; returns its approval id.
CREATE FUNCTION pg_temp.reply_approval(submission text) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE r jsonb; aid uuid; BEGIN
 r := pg_temp.file_reply('e3000000-0000-4000-8000-00000000aaaa','e3000000-0000-4000-8000-0000000c0001',submission);
 aid := (r->>'action_id')::uuid;
 PERFORM pg_temp.draft(aid,'e3000000-0000-4000-8000-00000000aaaa');
 RETURN (SELECT approval_id FROM public.paige_actions WHERE id=aid);
END $$;

-- ── 0. The migration (replayed: a database that already has it proves replay is a no-op). ──────────
\ir ../migrations/20271031000000_exp03_lead_reply_once_per_submission.sql
\ir ../migrations/20271031000000_exp03_lead_reply_once_per_submission.sql

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
SELECT pg_temp.check_true(EXISTS(SELECT 1 FROM information_schema.columns
  WHERE table_schema='public' AND table_name='growth_forms' AND column_name='lead_reply_enabled' AND is_nullable='NO' AND column_default='false'),
  'growth_forms.lead_reply_enabled exists, NOT NULL, default false (off until the owner opts in)');
SELECT pg_temp.check_true((SELECT count(*)=1 FROM pg_trigger WHERE tgrelid='public.paige_pending_approvals'::regclass
    AND tgname='trg_paige_guard_send_approval_requires_governed_send' AND tgenabled='O'),
  'the send guard is installed once on paige_pending_approvals');
SELECT pg_temp.check_true((SELECT bool_and(p.prosecdef AND p.proconfig IS NOT NULL AND array_to_string(p.proconfig,',') LIKE 'search_path=%')
   FROM pg_proc p WHERE p.oid IN ('public.lead_reply_record_send(uuid,uuid)'::regprocedure,
     'public.paige_guard_send_approval_requires_governed_send()'::regprocedure,
     'public.growth_form_set_intake(uuid,boolean,uuid,uuid,text,boolean)'::regprocedure)),
  'the record, guard and 6-arg intake functions are SECURITY DEFINER with a pinned search_path');
SELECT pg_temp.check_true(has_function_privilege('authenticated','public.lead_reply_record_send(uuid,uuid)','EXECUTE')
  AND NOT has_function_privilege('anon','public.lead_reply_record_send(uuid,uuid)','EXECUTE')
  AND NOT has_function_privilege('service_role','public.lead_reply_record_send(uuid,uuid)','EXECUTE'),
  'lead_reply_record_send is executable by a signed-in user only (not anon, not service_role)');
SELECT pg_temp.check_true(has_function_privilege('service_role','public.lead_reply_record_send_service(uuid,uuid,uuid)','EXECUTE')
  AND NOT has_function_privilege('anon','public.lead_reply_record_send_service(uuid,uuid,uuid)','EXECUTE')
  AND NOT has_function_privilege('authenticated','public.lead_reply_record_send_service(uuid,uuid,uuid)','EXECUTE')
  AND NOT has_function_privilege('anon','public._lead_reply_record_send(uuid,uuid,uuid)','EXECUTE')
  AND NOT has_function_privilege('authenticated','public._lead_reply_record_send(uuid,uuid,uuid)','EXECUTE')
  AND NOT has_function_privilege('service_role','public._lead_reply_record_send(uuid,uuid,uuid)','EXECUTE')
  AND (SELECT bool_and(prosecdef AND array_to_string(proconfig,',') LIKE 'search_path=%') FROM pg_proc
        WHERE oid IN ('public.lead_reply_record_send_service(uuid,uuid,uuid)'::regprocedure,'public._lead_reply_record_send(uuid,uuid,uuid)'::regprocedure)),
  'the service twin is executable by the service role only; the shared body by no API role; both DEFINER with a pinned search_path');
SELECT pg_temp.check_true((SELECT i.indisunique AND i.indrelid='public.paige_pending_approvals'::regclass
     AND pg_get_indexdef(i.indexrelid) LIKE '%lower((metadata #>> ''{governed_send,message_id}''::text[]))%'
     AND pg_get_expr(i.indpred,i.indrelid) LIKE '%approved%' AND pg_get_expr(i.indpred,i.indrelid) LIKE '%sent%'
     AND pg_get_expr(i.indpred,i.indrelid) NOT LIKE '%pending%'
    FROM pg_index i WHERE i.indexrelid='public.uq_paige_pending_approvals_governed_send_message'::regclass),
  'one governed message per approved/sent approval: a UNIQUE partial index on lower(governed_send.message_id)');
SELECT pg_temp.check_true(has_function_privilege('authenticated','public.growth_form_set_intake(uuid,boolean,uuid,uuid,text,boolean)','EXECUTE')
  AND NOT has_function_privilege('anon','public.growth_form_set_intake(uuid,boolean,uuid,uuid,text,boolean)','EXECUTE')
  AND has_function_privilege('authenticated','public.growth_form_set_intake(uuid,boolean,uuid,uuid,text)','EXECUTE')
  AND NOT has_function_privilege('anon','public.growth_form_set_intake(uuid,boolean,uuid,uuid,text)','EXECUTE'),
  'both intake signatures: signed-in users only; the existing 5-arg one keeps its grants');

-- ── 1. The catalogue row and its two safety CHECKs (unchanged by this slice, asserted here). ───────
SELECT pg_temp.check_true((SELECT executor='send_via_approval' AND requires_approval AND default_autonomy_lane='confirm'
    AND approval_type='cs_draft' AND draft_subagent_slug='email-composer' AND enabled AND tenant_id IS NULL
   FROM public.paige_action_kinds WHERE slug='owner.lead_followup'),
  'owner.lead_followup is a platform send_via_approval kind: requires approval, lane confirm, drafted by email-composer');
SELECT pg_temp.refused($$UPDATE public.paige_action_kinds SET default_autonomy_lane='auto' WHERE slug='owner.lead_followup'$$,
  '23514','%chk_auto_lane_safe%','chk_auto_lane_safe refuses an auto default lane for the reply kind');
SELECT pg_temp.refused($$UPDATE public.paige_action_kinds SET requires_approval=false WHERE slug='owner.lead_followup'$$,
  '23514','%chk_send_requires_approval%','chk_send_requires_approval refuses dropping the approval requirement');

-- ── Fixtures: two Solo businesses and an agency; owners, an admin, a plain member; leads with email;
--    one verified email sender per business. ────────────────────────────────────────────────────
INSERT INTO auth.users(id,email) VALUES
 ('e3000000-0000-4000-8000-000000000001','exp03-reply-owner-a@example.invalid'),
 ('e3000000-0000-4000-8000-000000000002','exp03-reply-owner-b@example.invalid'),
 ('e3000000-0000-4000-8000-000000000003','exp03-reply-member-a@example.invalid'),
 ('e3000000-0000-4000-8000-000000000005','exp03-reply-admin-a@example.invalid'),
 ('e3000000-0000-4000-8000-000000000006','exp03-reply-owner-c@example.invalid');
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
 ('e3000000-0000-4000-8000-00000000bbbb','test-exp03-reply-b','Test Reply B','active','standalone','E3B','{}'),
 ('e3000000-0000-4000-8000-00000000cccc','test-exp03-reply-c','Test Reply Agency C','active','agency','E3C','{}');
SELECT set_config('request.jwt.claims','{}',true);
INSERT INTO public.tenant_members(tenant_id,user_id,role,status,is_owner,joined_at) VALUES
 ('e3000000-0000-4000-8000-00000000aaaa','e3000000-0000-4000-8000-000000000001','owner','active',true,now()),
 ('e3000000-0000-4000-8000-00000000bbbb','e3000000-0000-4000-8000-000000000002','owner','active',true,now()),
 ('e3000000-0000-4000-8000-00000000aaaa','e3000000-0000-4000-8000-000000000003','member','active',false,now()),
 ('e3000000-0000-4000-8000-00000000aaaa','e3000000-0000-4000-8000-000000000005','admin','active',false,now()),
 ('e3000000-0000-4000-8000-00000000cccc','e3000000-0000-4000-8000-000000000006','owner','active',true,now());
UPDATE public.profiles SET active_tenant_id='e3000000-0000-4000-8000-00000000aaaa'
 WHERE user_id IN ('e3000000-0000-4000-8000-000000000001','e3000000-0000-4000-8000-000000000003','e3000000-0000-4000-8000-000000000005');
UPDATE public.profiles SET active_tenant_id='e3000000-0000-4000-8000-00000000bbbb' WHERE user_id='e3000000-0000-4000-8000-000000000002';
UPDATE public.profiles SET active_tenant_id='e3000000-0000-4000-8000-00000000cccc' WHERE user_id='e3000000-0000-4000-8000-000000000006';
SELECT pg_temp.check_true((SELECT count(*)=5 FROM public.profiles WHERE user_id::text LIKE 'e3000000-0000-4000-8000-00000000000%' AND active_tenant_id IS NOT NULL),
  'fixture: every person has a profile with an active business');
INSERT INTO public.clients(id,tenant_id,created_by,first_name,last_name,email,account_number,lifecycle_stage,source) VALUES
 ('e3000000-0000-4000-8000-0000000c0001','e3000000-0000-4000-8000-00000000aaaa','e3000000-0000-4000-8000-000000000001','Synthetic','Lead A','lead.a1@example.invalid','E3A-1','new_lead','paige_form'),
 ('e3000000-0000-4000-8000-0000000c0002','e3000000-0000-4000-8000-00000000aaaa','e3000000-0000-4000-8000-000000000001','Synthetic','Lead A Two','lead.a2@example.invalid','E3A-2','new_lead','paige_form'),
 ('e3000000-0000-4000-8000-0000000c00b1','e3000000-0000-4000-8000-00000000bbbb','e3000000-0000-4000-8000-000000000002','Synthetic','Lead B','lead.b@example.invalid','E3B-1','new_lead','paige_form');
SELECT pg_temp.check_true((SELECT count(*)=3 FROM public.client_contact_methods WHERE kind='email'
    AND client_id IN ('e3000000-0000-4000-8000-0000000c0001','e3000000-0000-4000-8000-0000000c0002','e3000000-0000-4000-8000-0000000c00b1')),
  'fixture: each lead''s email is a canonical contact method (the address the governed door reads)');
INSERT INTO public.channel_connectors(id,tenant_id,channel_type,provider,from_address,status,active) VALUES
 ('e3000000-0000-4000-8000-0000000e000a','e3000000-0000-4000-8000-00000000aaaa','email','resend','owner@a.example.invalid','active',true),
 ('e3000000-0000-4000-8000-0000000e000b','e3000000-0000-4000-8000-00000000bbbb','email','resend','owner@b.example.invalid','active',true);
INSERT INTO public.growth_forms(id,tenant_id,slug,name,status) VALUES
 ('e3000000-0000-4000-8000-0000000f0001','e3000000-0000-4000-8000-00000000aaaa','exp03-reply-form','Test form','active'),
 ('e3000000-0000-4000-8000-0000000f000c','e3000000-0000-4000-8000-00000000cccc','exp03-reply-agency-form','Agency form','active');
-- Back to the processor's identity: service role, no JWT subject.
SELECT pg_temp.as_service();
SELECT pg_temp.check_true(auth.uid() IS NULL,'the filings below run on the service path (no JWT subject), as the processor does');

-- ── The governed email door, driven through its REAL database half (prepare → claim → finalize). ─────
CREATE FUNCTION pg_temp.op(n int) RETURNS uuid LANGUAGE sql AS $$ SELECT ('e3000000-0000-4000-8000-0000000d'||lpad(n::text,4,'0'))::uuid $$;
CREATE FUNCTION pg_temp.msg(n int) RETURNS uuid LANGUAGE sql AS $$
 SELECT id FROM public.messages WHERE meta#>>'{comms_email_binding,operation_id}'=pg_temp.op(n)::text $$;
-- Prepare a one-recipient business email as that business's owner, from its one verified sender.
CREATE FUNCTION pg_temp.prep(n int,actor uuid,tenant uuid,contact uuid,recipient text,connector uuid,sender text) RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.prepare_comms_email_send(actor,tenant,pg_temp.op(n),contact,recipient,connector,sender,
  'Reply '||n,'Hi, thanks for writing in ('||n||').','<p>Hi, thanks for writing in ('||n||').</p>',
  encode(extensions.digest(convert_to(recipient||E'\n'||connector::text||E'\n'||'Reply '||n||E'\n'||'Hi, thanks for writing in ('||n||').','UTF8'),'sha256'),'hex'),
  jsonb_build_object('action','comms.email_send','contact_id',contact,'connector_id',connector,'subject','Reply '||n,'body','Hi, thanks for writing in ('||n||').'),
  jsonb_build_object('actor_user_id',actor,'tenant_id',tenant,'tool','comms_send_email','action','comms.email_send',
   'approval_channel','operator_card','approved_fingerprint','0123456789abcdef','decision_receipt_recorded',true)) $$;
CREATE FUNCTION pg_temp.prep_a(n int,contact uuid DEFAULT 'e3000000-0000-4000-8000-0000000c0001',recipient text DEFAULT 'lead.a1@example.invalid') RETURNS jsonb LANGUAGE sql AS $$
 SELECT pg_temp.prep(n,'e3000000-0000-4000-8000-000000000001','e3000000-0000-4000-8000-00000000aaaa',contact,recipient,
   'e3000000-0000-4000-8000-0000000e000a','owner@a.example.invalid') $$;
CREATE FUNCTION pg_temp.claim(n int) RETURNS jsonb LANGUAGE sql AS $$ SELECT public.claim_comms_email_send(pg_temp.msg(n),pg_temp.op(n)) $$;
CREATE FUNCTION pg_temp.fin(n int,outcome text,attempt int) RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.finalize_comms_email_send(pg_temp.msg(n),pg_temp.op(n),outcome,CASE WHEN outcome='provider_accepted' THEN 'prov-'||n END,'test_reason',attempt) $$;
CREATE FUNCTION pg_temp.st(n int) RETURNS text LANGUAGE sql AS $$ SELECT meta#>>'{comms_email_binding,state}' FROM public.messages WHERE id=pg_temp.msg(n) $$;

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
  '23505','%uq_paige_actions_lead_followup_submission%','a second reply draft for the same submission is refused (file_action)');
SELECT pg_temp.refused($$INSERT INTO public.paige_actions(tenant_id,action_kind,from_department,to_department,title,payload,status,autonomy_lane)
   VALUES ('e3000000-0000-4000-8000-00000000aaaa','owner.lead_followup','owner_ops','client_experience','direct',jsonb_build_object('submission_id','e3000000-0000-4000-8000-00000005e001'),'filed','confirm')$$,
  '23505','%uq_paige_actions_lead_followup_submission%','a second reply draft for the same submission is refused (direct insert)');
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

-- ── 2b. A drafted reply always goes to the owner. ──────────────────────────────────────────────────
SELECT pg_temp.draft((SELECT (result->>'action_id')::uuid FROM filed WHERE label='a1'),'e3000000-0000-4000-8000-00000000aaaa');
SELECT pg_temp.check_true((SELECT a.status='pending_approval' AND a.approval_id IS NOT NULL AND a.executed_at IS NULL
    AND p.status='pending' AND p.type='cs_draft' AND p.category='owner.lead_followup' AND p.tenant_id=a.tenant_id AND p.contact_id=a.contact_id
    AND p.metadata->>'action_id'=a.id::text AND p.draft_content->>'subject'='Thanks for reaching out'
    AND p.draft_content->>'body'='Hi Synthetic, thanks for writing in.' AND p.draft_content->>'body_html' LIKE '<p>%'
   FROM public.paige_actions a JOIN public.paige_pending_approvals p ON p.id=a.approval_id
  WHERE a.id=(SELECT (result->>'action_id')::uuid FROM filed WHERE label='a1')),
  'a drafted reply becomes a pending cs_draft approval carrying a plain-text body (and the HTML beside it); it is not executed');
INSERT INTO filed VALUES ('auto', pg_temp.file_reply('e3000000-0000-4000-8000-00000000aaaa','e3000000-0000-4000-8000-0000000c0001','e3000000-0000-4000-8000-00000005e003','auto'));
SELECT pg_temp.draft((SELECT (result->>'action_id')::uuid FROM filed WHERE label='auto'),'e3000000-0000-4000-8000-00000000aaaa','S');
SELECT pg_temp.check_true((SELECT status='pending_approval' AND approval_id IS NOT NULL AND executed_at IS NULL
   FROM public.paige_actions WHERE id=(SELECT (result->>'action_id')::uuid FROM filed WHERE label='auto')),
  'a reply filed with an auto lane request still waits for the owner''s approval (send_via_approval requires it)');
SELECT pg_temp.refused($$SELECT public.advance_action((SELECT (result->>'action_id')::uuid FROM filed WHERE label='a2'),'executing',
   NULL,NULL,NULL,NULL,NULL,NULL,NULL,'e3000000-0000-4000-8000-00000000aaaa')$$,
  '22023','%','forcing a reply straight to executing is refused: send kinds only go out through the approval lane');
SELECT pg_temp.refused($$SELECT public.advance_action((SELECT (result->>'action_id')::uuid FROM filed WHERE label='b1'),'drafted',
   NULL,NULL,NULL,NULL,NULL,NULL,NULL,'e3000000-0000-4000-8000-00000000aaaa')$$,
  '42501','%','a reply cannot be advanced under another business''s tenant');

-- ── Sends through the governed door: every outcome state the binding can reach. ───────────────────
SELECT pg_temp.prep_a(1);                                                        -- prepared
SELECT pg_temp.prep_a(2);  SELECT pg_temp.claim(2);                              -- dispatching
SELECT pg_temp.prep_a(3);  SELECT pg_temp.claim(3); SELECT pg_temp.fin(3,'unknown',1);   -- unknown
SELECT pg_temp.prep_a(4);  SELECT pg_temp.fin(4,'failed',NULL);                  -- failed (refused before any claim)
SELECT pg_temp.prep_a(5);  SELECT pg_temp.fin(5,'refused',NULL);                 -- refused
SELECT pg_temp.prep_a(6);  SELECT pg_temp.claim(6); SELECT pg_temp.fin(6,'provider_accepted',1);
SELECT pg_temp.prep_a(7,'e3000000-0000-4000-8000-0000000c0002','lead.a2@example.invalid');
SELECT pg_temp.claim(7);   SELECT pg_temp.fin(7,'provider_accepted',1);          -- accepted, but to another person
SELECT pg_temp.prep(8,'e3000000-0000-4000-8000-000000000002','e3000000-0000-4000-8000-00000000bbbb','e3000000-0000-4000-8000-0000000c00b1',
  'lead.b@example.invalid','e3000000-0000-4000-8000-0000000e000b','owner@b.example.invalid');
SELECT pg_temp.claim(8);   SELECT pg_temp.fin(8,'provider_accepted',1);          -- accepted, in another business
SELECT pg_temp.prep_a(9);  SELECT pg_temp.claim(9); SELECT pg_temp.fin(9,'provider_accepted',1);
SELECT pg_temp.prep_a(11); SELECT pg_temp.claim(11); SELECT pg_temp.fin(11,'provider_accepted',1);
-- An accepted send made by the business's ADMIN (not the owner), to lead A1.
SELECT pg_temp.prep(12,'e3000000-0000-4000-8000-000000000005','e3000000-0000-4000-8000-00000000aaaa','e3000000-0000-4000-8000-0000000c0001',
  'lead.a1@example.invalid','e3000000-0000-4000-8000-0000000e000a','owner@a.example.invalid');
SELECT pg_temp.claim(12);  SELECT pg_temp.fin(12,'provider_accepted',1);
SELECT pg_temp.prep_a(13); SELECT pg_temp.claim(13); SELECT pg_temp.fin(13,'provider_accepted',1);
SELECT pg_temp.prep_a(14); SELECT pg_temp.claim(14); SELECT pg_temp.fin(14,'provider_accepted',1);
SELECT pg_temp.prep_a(16); SELECT pg_temp.claim(16); SELECT pg_temp.fin(16,'provider_accepted',1);
SELECT pg_temp.check_true(pg_temp.st(1)='prepared' AND pg_temp.st(2)='dispatching' AND pg_temp.st(3)='unknown' AND pg_temp.st(4)='failed'
  AND pg_temp.st(5)='refused' AND pg_temp.st(6)='provider_accepted' AND pg_temp.st(7)='provider_accepted' AND pg_temp.st(8)='provider_accepted'
  AND pg_temp.st(9)='provider_accepted' AND pg_temp.st(11)='provider_accepted' AND pg_temp.st(12)='provider_accepted'
  AND pg_temp.st(13)='provider_accepted' AND pg_temp.st(14)='provider_accepted' AND pg_temp.st(16)='provider_accepted',
  'fixture: the governed door recorded every outcome state (prepared, dispatching, unknown, failed, refused, provider_accepted)');

-- ── 3. The send guard. ─────────────────────────────────────────────────────────────────────────────
CREATE TEMP TABLE ap(label text PRIMARY KEY, id uuid) ON COMMIT DROP;
INSERT INTO ap VALUES ('a1',(SELECT approval_id FROM public.paige_actions WHERE id=(SELECT (result->>'action_id')::uuid FROM filed WHERE label='a1')));
INSERT INTO ap VALUES ('g2',pg_temp.reply_approval('e3000000-0000-4000-8000-00000005e0a2')),
                      ('g3',pg_temp.reply_approval('e3000000-0000-4000-8000-00000005e0a3'));
GRANT SELECT ON ap, filed TO anon, authenticated, service_role;
CREATE FUNCTION pg_temp.ap(l text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM ap WHERE label=l $$;
CREATE FUNCTION pg_temp.gs(n int,op int DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('governed_send',jsonb_build_object('message_id',pg_temp.msg(n),'operation_id',pg_temp.op(coalesce(op,n)),'state','provider_accepted')) $$;

-- As the service role: no path is trusted to complete a send without a send.
SELECT pg_temp.refused(format($$UPDATE public.paige_pending_approvals SET status='approved' WHERE id=%L$$,pg_temp.ap('a1')),
  '42501','SEND_REQUIRES_GOVERNED_SEND%','approving a reply with no governed send is refused (the false completion closed)');
SELECT pg_temp.refused(format($$UPDATE public.paige_pending_approvals SET status='sent' WHERE id=%L$$,pg_temp.ap('a1')),
  '42501','SEND_REQUIRES_GOVERNED_SEND%','marking a reply sent with no governed send is refused');
SELECT pg_temp.refused(format($$UPDATE public.paige_pending_approvals SET status='approved', metadata=metadata-'action_id' WHERE id=%L$$,pg_temp.ap('a1')),
  '42501','SEND_REQUIRES_GOVERNED_SEND%','dropping metadata.action_id in the same write does not launder it (the action still points at the approval)');
SELECT pg_temp.refused(format($$UPDATE public.paige_pending_approvals SET status='approved', metadata='{}'::jsonb WHERE id=%L$$,pg_temp.ap('a1')),
  '42501','SEND_REQUIRES_GOVERNED_SEND%','replacing the whole metadata (the paige-bridge patch shape) does not launder it either');
SELECT pg_temp.refused(format($$UPDATE public.paige_pending_approvals SET status='approved', metadata=metadata||pg_temp.gs(4) WHERE id=%L$$,pg_temp.ap('a1')),
  '42501','SEND_REQUIRES_GOVERNED_SEND%','a governed send that FAILED is not proof of a send');
SELECT pg_temp.refused(format($$UPDATE public.paige_pending_approvals SET status='approved', metadata=metadata||pg_temp.gs(1) WHERE id=%L$$,pg_temp.ap('a1')),
  '42501','SEND_REQUIRES_GOVERNED_SEND%','a governed send still only prepared is not proof of a send');
SELECT pg_temp.refused(format($$UPDATE public.paige_pending_approvals SET status='approved', metadata=metadata||pg_temp.gs(8) WHERE id=%L$$,pg_temp.ap('a1')),
  '42501','SEND_REQUIRES_GOVERNED_SEND%','another business''s accepted send is not proof for this business');
SELECT pg_temp.refused(format($$UPDATE public.paige_pending_approvals SET status='approved', metadata=metadata||pg_temp.gs(7) WHERE id=%L$$,pg_temp.ap('a1')),
  '42501','SEND_REQUIRES_GOVERNED_SEND%','an accepted send to another person is not proof for this lead');
SELECT pg_temp.refused(format($$UPDATE public.paige_pending_approvals SET status='approved', metadata=metadata||pg_temp.gs(9,6) WHERE id=%L$$,pg_temp.ap('a1')),
  '42501','SEND_REQUIRES_GOVERNED_SEND%','a governed_send whose operation does not match its message is refused');
SELECT pg_temp.refused_detail(format($$UPDATE public.paige_pending_approvals SET status='approved' WHERE id=%L$$,pg_temp.ap('a1')),
  '42501','SEND_REQUIRES_GOVERNED_SEND%','reason_code=review_and_send','a reply''s refusal points the owner to review and send it (reason_code review_and_send)');
SELECT pg_temp.check_true((SELECT status='pending' FROM public.paige_pending_approvals WHERE id=pg_temp.ap('a1'))
  AND (SELECT status='pending_approval' AND executed_at IS NULL FROM public.paige_actions WHERE approval_id=pg_temp.ap('a1')),
  'after every refused approve the reply is still pending and its action is not done');

-- Each signal that an approval stands for a send is enough ON ITS OWN. Two client.followup actions that
-- were filed but never drafted (approval_id NULL), and three plain approvals that start with no action_id.
INSERT INTO filed VALUES ('sx', public.file_action('client.followup','Signal X',NULL,'e3000000-0000-4000-8000-0000000c0001','{}'::jsonb,
   NULL,NULL,NULL,NULL,NULL,NULL,'paige','e3000000-0000-4000-8000-00000000aaaa',NULL)),
                         ('sy', public.file_action('client.followup','Signal Y',NULL,'e3000000-0000-4000-8000-0000000c0001','{}'::jsonb,
   NULL,NULL,NULL,NULL,NULL,NULL,'paige','e3000000-0000-4000-8000-00000000aaaa',NULL));
CREATE FUNCTION pg_temp.fa(l text) RETURNS uuid LANGUAGE sql AS $$ SELECT (result->>'action_id')::uuid FROM filed WHERE label=l $$;
SELECT pg_temp.check_true((SELECT bool_and(approval_id IS NULL) FROM public.paige_actions WHERE id IN (pg_temp.fa('sx'),pg_temp.fa('sy'))),
  'fixture: the two signal actions point at no approval');
INSERT INTO public.paige_pending_approvals(id,type,draft_content,status,tenant_id,category,metadata) VALUES
 ('e3000000-0000-4000-8000-0000000a0101','other','{}'::jsonb,'pending','e3000000-0000-4000-8000-00000000aaaa','other','{}'::jsonb),
 ('e3000000-0000-4000-8000-0000000a0102','other','{}'::jsonb,'pending','e3000000-0000-4000-8000-00000000aaaa','other',jsonb_build_object('action_id',pg_temp.fa('sx'))),
 ('e3000000-0000-4000-8000-0000000a0103','other','{}'::jsonb,'pending','e3000000-0000-4000-8000-00000000aaaa','other','{}'::jsonb),
 ('e3000000-0000-4000-8000-0000000a0104','other','{}'::jsonb,'pending','e3000000-0000-4000-8000-00000000aaaa','other','{}'::jsonb);
UPDATE public.paige_actions SET approval_id='e3000000-0000-4000-8000-0000000a0103' WHERE id=pg_temp.fa('sy');
SELECT pg_temp.refused_detail(format($$UPDATE public.paige_pending_approvals SET status='approved', metadata=jsonb_build_object('action_id',%L)
     WHERE id='e3000000-0000-4000-8000-0000000a0101'$$,pg_temp.fa('sx')),
  '42501','SEND_REQUIRES_GOVERNED_SEND%','reason_code=decline_only',
  'signal 1 alone — the NEW metadata.action_id (no stored id, no back-pointer) — is refused, and a client.followup is told decline_only');
SELECT pg_temp.refused(format($$UPDATE public.paige_pending_approvals SET status='approved', metadata=jsonb_build_object('action_id',upper(%L))
     WHERE id='e3000000-0000-4000-8000-0000000a0101'$$,pg_temp.fa('sx')),
  '42501','SEND_REQUIRES_GOVERNED_SEND%','an upper-case action_id names the same action');
SELECT pg_temp.refused($$UPDATE public.paige_pending_approvals SET status='approved', metadata='{}'::jsonb WHERE id='e3000000-0000-4000-8000-0000000a0102'$$,
  '42501','SEND_REQUIRES_GOVERNED_SEND%','signal 2 alone — the STORED (OLD) metadata.action_id, dropped in the approving write — is refused');
SELECT pg_temp.refused($$UPDATE public.paige_pending_approvals SET status='approved' WHERE id='e3000000-0000-4000-8000-0000000a0103'$$,
  '42501','SEND_REQUIRES_GOVERNED_SEND%','signal 3 alone — paige_actions.approval_id pointing at the approval, no action_id anywhere — is refused');
SELECT pg_temp.check_true((SELECT bool_and(status='pending') FROM public.paige_pending_approvals
   WHERE id IN ('e3000000-0000-4000-8000-0000000a0101','e3000000-0000-4000-8000-0000000a0102','e3000000-0000-4000-8000-0000000a0103')),
  'all three signal approvals are still pending');
UPDATE public.paige_pending_approvals SET status='approved' WHERE id='e3000000-0000-4000-8000-0000000a0104';
SELECT pg_temp.check_true((SELECT status='approved' FROM public.paige_pending_approvals WHERE id='e3000000-0000-4000-8000-0000000a0104'),
  'control: the same plain approval with no signal approves');

-- A provider-accepted send of the same business, to the same person, is accepted.
UPDATE public.paige_pending_approvals SET status='approved', metadata=metadata||pg_temp.gs(9) WHERE id=pg_temp.ap('g2');
SELECT pg_temp.check_true((SELECT status='approved' FROM public.paige_pending_approvals WHERE id=pg_temp.ap('g2'))
  AND (SELECT status='done' FROM public.paige_actions WHERE approval_id=pg_temp.ap('g2')),
  'an approval naming a provider-accepted send of this business to this lead is accepted (and its action completes)');
SELECT pg_temp.refused(format($$UPDATE public.paige_pending_approvals SET status='approved', metadata=metadata||pg_temp.gs(9) WHERE id=%L$$,pg_temp.ap('g3')),
  '42501','SEND_REQUIRES_GOVERNED_SEND%','one accepted send proves one approval: re-using it for a second reply is refused');
-- The index holds that on its own: with the guard trigger switched off (rolled back), the database
-- still refuses a second approved approval citing the same message — in any letter case.
ALTER TABLE public.paige_pending_approvals DISABLE TRIGGER trg_paige_guard_send_approval_requires_governed_send;
SELECT pg_temp.refused(format($$UPDATE public.paige_pending_approvals SET status='approved', metadata=metadata||pg_temp.gs(9) WHERE id=%L$$,pg_temp.ap('g3')),
  '23505','%uq_paige_pending_approvals_governed_send_message%','the unique index refuses a second approval citing the same message (guard off)');
SELECT pg_temp.refused(format($$UPDATE public.paige_pending_approvals SET status='sent',
     metadata=metadata||jsonb_build_object('governed_send',jsonb_build_object('message_id',upper(pg_temp.msg(9)::text))) WHERE id=%L$$,pg_temp.ap('g3')),
  '23505','%uq_paige_pending_approvals_governed_send_message%','… and the same message id in upper case, marked sent');
UPDATE public.paige_pending_approvals SET metadata=metadata||pg_temp.gs(9) WHERE id=pg_temp.ap('g3');
SELECT pg_temp.check_true((SELECT status='pending' AND metadata ? 'governed_send' FROM public.paige_pending_approvals WHERE id=pg_temp.ap('g3')),
  'a PENDING approval may still record the same message (the index covers approved/sent only)');
UPDATE public.paige_pending_approvals SET metadata=metadata-'governed_send' WHERE id=pg_temp.ap('g3');
ALTER TABLE public.paige_pending_approvals ENABLE TRIGGER trg_paige_guard_send_approval_requires_governed_send;
-- An email older than the approval cannot be re-used as proof.
UPDATE public.paige_pending_approvals SET created_at=now()+interval '1 minute' WHERE id=pg_temp.ap('g3');
SELECT pg_temp.refused(format($$UPDATE public.paige_pending_approvals SET status='approved', metadata=metadata||pg_temp.gs(11) WHERE id=%L$$,pg_temp.ap('g3')),
  '42501','SEND_REQUIRES_GOVERNED_SEND%','a send made before the approval existed is not proof of sending it');
UPDATE public.paige_pending_approvals SET created_at=now() WHERE id=pg_temp.ap('g3');
-- Created already approved is refused too (the INSERT path).
SELECT pg_temp.refused(format($$INSERT INTO public.paige_pending_approvals(type,draft_content,status,tenant_id,contact_id,category,metadata)
   VALUES ('cs_draft','{}'::jsonb,'approved','e3000000-0000-4000-8000-00000000aaaa','e3000000-0000-4000-8000-0000000c0001','owner.lead_followup',
     jsonb_build_object('action_id',%L))$$,(SELECT (result->>'action_id') FROM filed WHERE label='a2')),
  '42501','SEND_REQUIRES_GOVERNED_SEND%','an approval for a send action cannot be CREATED already approved');

-- The legacy shape: a client.followup drafted in the nested shape (the 125 production rows).
INSERT INTO filed VALUES ('legacy', public.file_action('client.followup','Legacy follow-up',NULL,'e3000000-0000-4000-8000-0000000c0001','{}'::jsonb,
   NULL,NULL,NULL,NULL,NULL,NULL,'paige','e3000000-0000-4000-8000-00000000aaaa',NULL));
SELECT public.advance_action((SELECT (result->>'action_id')::uuid FROM filed WHERE label='legacy'),'drafted',
  jsonb_build_object('draft',jsonb_build_object('subject','Checking in','body','<p>Checking in</p>')),
  NULL,NULL,NULL,NULL,NULL,NULL,'e3000000-0000-4000-8000-00000000aaaa');
INSERT INTO ap VALUES ('legacy',(SELECT approval_id FROM public.paige_actions WHERE id=(SELECT (result->>'action_id')::uuid FROM filed WHERE label='legacy')));
SELECT pg_temp.check_true(pg_temp.ap('legacy') IS NOT NULL,'fixture: the legacy client.followup draft is a pending approval');
SELECT pg_temp.refused(format($$UPDATE public.paige_pending_approvals SET status='approved' WHERE id=%L$$,pg_temp.ap('legacy')),
  '42501','SEND_REQUIRES_GOVERNED_SEND%','a legacy nested-shape client.followup approval can never be approved into a false completion');
SELECT pg_temp.refused(format($$UPDATE public.paige_pending_approvals SET status='sent' WHERE id=%L$$,pg_temp.ap('legacy')),
  '42501','SEND_REQUIRES_GOVERNED_SEND%','nor marked sent');

-- Declining stays free, and dismisses the action.
UPDATE public.paige_pending_approvals SET status='rejected', decision_rationale='Not now' WHERE id=pg_temp.ap('legacy');
SELECT pg_temp.check_true((SELECT status='rejected' FROM public.paige_pending_approvals WHERE id=pg_temp.ap('legacy'))
  AND (SELECT status='dismissed' FROM public.paige_actions WHERE approval_id=pg_temp.ap('legacy')),
  'declining a send approval is allowed and dismisses its action (the 125 legacy drafts can be cleared)');

-- §58: approvals that do not stand for a send approve exactly as before.
INSERT INTO filed VALUES ('nonsend', public.file_action('marketing.draft_campaign','Campaign idea',NULL,NULL,'{}'::jsonb,
   NULL,NULL,NULL,NULL,NULL,NULL,'paige','e3000000-0000-4000-8000-00000000aaaa',NULL));
SELECT public.advance_action((SELECT (result->>'action_id')::uuid FROM filed WHERE label='nonsend'),'drafted',
  jsonb_build_object('summary','An idea'),NULL,NULL,NULL,NULL,NULL,NULL,'e3000000-0000-4000-8000-00000000aaaa');
UPDATE public.paige_pending_approvals SET status='approved'
 WHERE id=(SELECT approval_id FROM public.paige_actions WHERE id=(SELECT (result->>'action_id')::uuid FROM filed WHERE label='nonsend'));
SELECT pg_temp.check_true((SELECT p.status='approved' FROM public.paige_pending_approvals p JOIN public.paige_actions a ON a.approval_id=p.id
   WHERE a.id=(SELECT (result->>'action_id')::uuid FROM filed WHERE label='nonsend')),
  'a non-send action''s approval (record_only kind) still approves');
SELECT pg_temp.check_true((SELECT status='done' AND executed_at IS NOT NULL FROM public.paige_actions
   WHERE id=(SELECT (result->>'action_id')::uuid FROM filed WHERE label='nonsend')),
  '… and its action completes, as before');
UPDATE public.paige_pending_approvals SET status='sent', metadata=metadata||'{"executed":true}'::jsonb
 WHERE id=(SELECT approval_id FROM public.paige_actions WHERE id=(SELECT (result->>'action_id')::uuid FROM filed WHERE label='nonsend'));
SELECT pg_temp.check_true((SELECT status='sent' FROM public.paige_pending_approvals
   WHERE id=(SELECT approval_id FROM public.paige_actions WHERE id=(SELECT (result->>'action_id')::uuid FROM filed WHERE label='nonsend'))),
  '… and can move on to executed/sent');
INSERT INTO filed VALUES ('nonsend2', public.file_action('marketing.draft_campaign','Campaign idea 2',NULL,NULL,'{}'::jsonb,
   NULL,NULL,NULL,NULL,NULL,NULL,'paige','e3000000-0000-4000-8000-00000000aaaa',NULL));
SELECT public.advance_action((SELECT (result->>'action_id')::uuid FROM filed WHERE label='nonsend2'),'drafted',
  jsonb_build_object('summary','Another idea'),NULL,NULL,NULL,NULL,NULL,NULL,'e3000000-0000-4000-8000-00000000aaaa');
UPDATE public.paige_pending_approvals SET status='rejected'
 WHERE id=(SELECT approval_id FROM public.paige_actions WHERE id=(SELECT (result->>'action_id')::uuid FROM filed WHERE label='nonsend2'));
SELECT pg_temp.check_true((SELECT status='dismissed' FROM public.paige_actions WHERE id=(SELECT (result->>'action_id')::uuid FROM filed WHERE label='nonsend2')),
  'a non-send action''s approval can be declined, and its action is dismissed, as before');
INSERT INTO public.paige_pending_approvals(id,type,draft_content,status,tenant_id,category)
 VALUES ('e3000000-0000-4000-8000-0000000a0001','other','{}'::jsonb,'pending','e3000000-0000-4000-8000-00000000aaaa','other');
UPDATE public.paige_pending_approvals SET status='approved' WHERE id='e3000000-0000-4000-8000-0000000a0001';
SELECT pg_temp.check_true((SELECT status='approved' FROM public.paige_pending_approvals WHERE id='e3000000-0000-4000-8000-0000000a0001'),
  'a plain approval with no action still approves');

-- ── 4. lead_reply_record_send. ─────────────────────────────────────────────────────────────────────
INSERT INTO ap VALUES ('p', pg_temp.reply_approval('e3000000-0000-4000-8000-00000005e0b1')),
                      ('d', pg_temp.reply_approval('e3000000-0000-4000-8000-00000005e0b2')),
                      ('u', pg_temp.reply_approval('e3000000-0000-4000-8000-00000005e0b3')),
                      ('f', pg_temp.reply_approval('e3000000-0000-4000-8000-00000005e0b4')),
                      ('r', pg_temp.reply_approval('e3000000-0000-4000-8000-00000005e0b5')),
                      ('ok',pg_temp.reply_approval('e3000000-0000-4000-8000-00000005e0b6')),
                      ('declined',pg_temp.reply_approval('e3000000-0000-4000-8000-00000005e0b7')),
                      ('adm',pg_temp.reply_approval('e3000000-0000-4000-8000-00000005e0b8')),
                      ('svc',pg_temp.reply_approval('e3000000-0000-4000-8000-00000005e0b9'));
-- Business B's reply to its own lead (filed above as 'b1'), drafted now.
SELECT pg_temp.draft((SELECT (result->>'action_id')::uuid FROM filed WHERE label='b1'),'e3000000-0000-4000-8000-00000000bbbb');
INSERT INTO ap VALUES ('b',(SELECT approval_id FROM public.paige_actions WHERE id=(SELECT (result->>'action_id')::uuid FROM filed WHERE label='b1')));
UPDATE public.paige_pending_approvals SET status='rejected' WHERE id=pg_temp.ap('declined');
CREATE FUNCTION pg_temp.rec(l text,n int) RETURNS jsonb LANGUAGE sql AS $$ SELECT public.lead_reply_record_send(pg_temp.ap(l),pg_temp.op(n)) $$;

-- An outsider's refused call takes NO row lock: authorization runs on an unlocked read, the lock
-- comes after. (A FOR UPDATE in a subtransaction leaves the row's xmax naming that subtransaction —
-- or a multixact including it — even after the refusal rolls it back, so an unchanged xmax proves no
-- lock was taken. The row already carries this transaction's own key-share lock from the fixtures.)
CREATE TEMP TABLE lk(label text PRIMARY KEY, v text) ON COMMIT DROP;
GRANT ALL ON lk TO authenticated;
INSERT INTO lk SELECT 'before', xmax::text FROM public.paige_pending_approvals WHERE id=pg_temp.ap('ok');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('e3000000-0000-4000-8000-000000000002');
SELECT pg_temp.refused($$SELECT pg_temp.rec('ok',6)$$,'42501','LEAD_REPLY_FORBIDDEN%','an outsider''s record of this reply is refused …');
RESET ROLE;
INSERT INTO lk SELECT 'after-outsider', xmax::text FROM public.paige_pending_approvals WHERE id=pg_temp.ap('ok');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('e3000000-0000-4000-8000-000000000001');
-- The control runs in a subtransaction too (as the outsider's did), so a lock it takes shows as a new xmax.
SELECT pg_temp.refused($q$DO $c$ BEGIN IF pg_temp.rec('ok',99)->>'state'='not_found' THEN RAISE EXCEPTION 'CONTROL_RAN'; END IF; END $c$$q$,
  'P0001','CONTROL_RAN','control: the owner''s call for an unknown operation runs (not_found, nothing written)');
RESET ROLE;
INSERT INTO lk SELECT 'after-owner', xmax::text FROM public.paige_pending_approvals WHERE id=pg_temp.ap('ok');
SELECT pg_temp.check_true((SELECT v FROM lk WHERE label='before') = (SELECT v FROM lk WHERE label='after-outsider'),
  '… and took no lock on the row before being refused (the outsider can neither probe nor block it)');
SELECT pg_temp.check_true((SELECT v FROM lk WHERE label='after-owner') IS DISTINCT FROM (SELECT v FROM lk WHERE label='after-outsider'),
  'control: the authorized call DID lock the row (so the probe above can see a lock)');

-- Who may call it.
SET LOCAL ROLE anon;
SELECT pg_temp.refused($$SELECT pg_temp.rec('ok',6)$$,'42501','permission denied for function lead_reply_record_send','a visitor cannot call lead_reply_record_send');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT pg_temp.refused($$SELECT pg_temp.rec('ok',6)$$,'42501','permission denied for function lead_reply_record_send','the service role is not granted it (it records a person''s act)');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_service();
SELECT pg_temp.refused($$SELECT pg_temp.rec('ok',6)$$,'42501','LEAD_REPLY_FORBIDDEN%','no signed-in person, no record');
SELECT pg_temp.as_user('e3000000-0000-4000-8000-000000000003');
SELECT pg_temp.refused($$SELECT pg_temp.rec('ok',6)$$,'42501','LEAD_REPLY_FORBIDDEN%','a plain member of the business cannot record a send');
SELECT pg_temp.as_user('e3000000-0000-4000-8000-000000000002');
SELECT pg_temp.refused($$SELECT pg_temp.rec('ok',6)$$,'42501','LEAD_REPLY_FORBIDDEN%','another business''s owner cannot record this business''s reply');
SELECT pg_temp.refused($$SELECT public.lead_reply_record_send('e3000000-0000-4000-8000-00000000ffff',pg_temp.op(6))$$,'42501','LEAD_REPLY_FORBIDDEN%',
  'an unknown approval id is refused exactly like a foreign one (no existence oracle)');
SELECT pg_temp.as_user('e3000000-0000-4000-8000-000000000001');
SELECT pg_temp.refused($$SELECT public.lead_reply_record_send(NULL,pg_temp.op(6))$$,'22023','LEAD_REPLY_INVALID%','a null approval is refused');
SELECT pg_temp.refused($$SELECT public.lead_reply_record_send(pg_temp.ap('ok'),NULL)$$,'22023','LEAD_REPLY_INVALID%','a null operation is refused');
SELECT pg_temp.refused(format($$SELECT public.lead_reply_record_send(%L,pg_temp.op(6))$$,
    (SELECT approval_id FROM public.paige_actions WHERE id=(SELECT (result->>'action_id')::uuid FROM filed WHERE label='nonsend'))),
  '22023','LEAD_REPLY_WRONG_KIND%','an approval for another kind of action is refused (wrong kind)');

-- What the door recorded is what gets written.
CREATE TEMP TABLE rec(label text PRIMARY KEY, r jsonb) ON COMMIT DROP;
GRANT ALL ON rec TO authenticated, service_role;
INSERT INTO rec VALUES ('f-other-person', pg_temp.rec('f',7)), ('f-other-business', pg_temp.rec('f',8)), ('f-unknown-op', pg_temp.rec('f',99));
SELECT pg_temp.check_true((SELECT bool_and(r->>'ok'='false' AND r->>'state'='not_found' AND r->>'delivery_confirmed'='false') FROM rec WHERE label LIKE 'f-%'),
  'a send to another person, in another business, or an unknown operation answers not_found');
INSERT INTO rec VALUES ('p', pg_temp.rec('p',1));
INSERT INTO rec VALUES ('d', pg_temp.rec('d',2)), ('u', pg_temp.rec('u',3)), ('f', pg_temp.rec('f',4)), ('r', pg_temp.rec('r',5));
RESET ROLE;
SELECT pg_temp.check_true((SELECT bool_and(r->>'ok'='false' AND r->>'state'=label_state AND r->>'delivery_confirmed'='false')
   FROM (SELECT r, CASE label WHEN 'p' THEN 'prepared' WHEN 'd' THEN 'dispatching' WHEN 'u' THEN 'unknown' WHEN 'f' THEN 'failed' WHEN 'r' THEN 'refused' END label_state
           FROM rec WHERE label IN ('p','d','u','f','r')) x),
  'prepared, dispatching, unknown, failed and refused each answer ok:false with their state, never delivered');
SELECT pg_temp.check_true((SELECT bool_and(p.status='pending' AND p.metadata#>>'{governed_send,state}'=s AND p.metadata#>>'{governed_send,operation_id}'=pg_temp.op(n)::text)
   FROM (VALUES ('p','prepared',1),('d','dispatching',2),('u','unknown',3)) v(l,s,n) JOIN public.paige_pending_approvals p ON p.id=pg_temp.ap(v.l)),
  'an in-flight or unknown send is recorded on the approval, which stays pending');
SELECT pg_temp.check_true((SELECT bool_and(p.status='pending' AND NOT (p.metadata ? 'governed_send'))
   FROM public.paige_pending_approvals p WHERE p.id IN (pg_temp.ap('f'),pg_temp.ap('r'))),
  'a failed or refused send leaves the approval pending and untouched');
SELECT pg_temp.check_true((SELECT bool_and(status='pending_approval' AND executed_at IS NULL) FROM public.paige_actions
   WHERE approval_id IN (pg_temp.ap('p'),pg_temp.ap('d'),pg_temp.ap('u'),pg_temp.ap('f'),pg_temp.ap('r'))),
  'no reply whose send was not accepted is marked done');
SELECT pg_temp.check_true((SELECT last_contacted_at IS NULL FROM public.clients WHERE id='e3000000-0000-4000-8000-0000000c0001'),
  'the lead''s last contact is not stamped by any send that was not accepted');

-- Accepted: approved, recorded, action done, lead's last contact stamped — and still not "delivered".
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('e3000000-0000-4000-8000-000000000001');
INSERT INTO rec VALUES ('ok', pg_temp.rec('ok',6));
INSERT INTO rec VALUES ('ok-replay', pg_temp.rec('ok',6));
SELECT pg_temp.refused($$SELECT pg_temp.rec('ok',11)$$,'55000','LEAD_REPLY_ALREADY_RECORDED%','a second, different send cannot be recorded on a reply already sent');
SELECT pg_temp.refused($$SELECT pg_temp.rec('declined',11)$$,'55000','LEAD_REPLY_NOT_PENDING%','a declined reply cannot be recorded as sent');
SELECT pg_temp.refused($$SELECT pg_temp.rec('legacy',6)$$,'22023','LEAD_REPLY_WRONG_KIND%','a legacy client.followup is never recorded through the reply door');
RESET ROLE;
SELECT pg_temp.check_true((SELECT r->>'ok'='true' AND r->>'state'='provider_accepted' AND r->>'delivery_confirmed'='false'
    AND r->>'message_id'=pg_temp.msg(6)::text FROM rec WHERE label='ok'),
  'an accepted send answers ok:true, provider_accepted, delivery_confirmed:false');
SELECT pg_temp.check_true((SELECT p.status='approved' AND p.reviewed_by_user_id='e3000000-0000-4000-8000-000000000001' AND p.sent_at IS NOT NULL
    AND p.metadata#>>'{governed_send,message_id}'=pg_temp.msg(6)::text AND p.metadata#>>'{governed_send,state}'='provider_accepted'
    AND p.metadata#>>'{governed_send,operation_id}'=pg_temp.op(6)::text AND p.metadata ? 'action_id'
   FROM public.paige_pending_approvals p WHERE p.id=pg_temp.ap('ok')),
  'the approval is approved by the owner, with the governed send recorded beside its action id');
SELECT pg_temp.check_true((SELECT status='done' AND executed_at IS NOT NULL AND result->>'approval_status'='approved'
   FROM public.paige_actions WHERE approval_id=pg_temp.ap('ok')),
  'the reply action is done — because a send was accepted, not because a button was pressed');
SELECT pg_temp.check_true((SELECT last_contacted_at IS NOT NULL FROM public.clients WHERE id='e3000000-0000-4000-8000-0000000c0001')
  AND (SELECT last_contacted_at IS NULL FROM public.clients WHERE id='e3000000-0000-4000-8000-0000000c00b1'),
  'the lead''s last contact is stamped, in this business only');
SELECT pg_temp.check_true((SELECT r->>'ok'='true' AND r->>'replayed'='true' AND r->>'delivery_confirmed'='false' FROM rec WHERE label='ok-replay')
  AND (SELECT count(*)=1 FROM public.paige_pending_approvals WHERE metadata#>>'{governed_send,message_id}'=pg_temp.msg(6)::text),
  'recording the same accepted send again is idempotent');

-- A failed send can be retried: a new accepted operation records normally.
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('e3000000-0000-4000-8000-000000000001');
INSERT INTO rec VALUES ('f-retry', pg_temp.rec('f',11));
RESET ROLE;
SELECT pg_temp.check_true((SELECT r->>'ok'='true' FROM rec WHERE label='f-retry')
  AND (SELECT status='approved' FROM public.paige_pending_approvals WHERE id=pg_temp.ap('f')),
  'after a failed send, the owner''s next accepted send is recorded');
-- A send still in flight is picked up when its outcome lands: the dispatching one is accepted later.
SELECT pg_temp.as_service();
SELECT pg_temp.fin(2,'provider_accepted',1);
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('e3000000-0000-4000-8000-000000000001');
INSERT INTO rec VALUES ('d-later', pg_temp.rec('d',2));
RESET ROLE;
SELECT pg_temp.check_true((SELECT r->>'ok'='true' FROM rec WHERE label='d-later')
  AND (SELECT status='approved' AND metadata#>>'{governed_send,state}'='provider_accepted' FROM public.paige_pending_approvals WHERE id=pg_temp.ap('d')),
  'a send recorded while dispatching is approved once the door records the provider''s acceptance');

-- The person recording is the person who sent it.
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('e3000000-0000-4000-8000-000000000005');
SELECT pg_temp.refused($$SELECT pg_temp.rec('adm',13)$$,'42501','LEAD_REPLY_NOT_YOUR_SEND%','an admin cannot record a send the OWNER made (actor mismatch)');
INSERT INTO rec VALUES ('adm', pg_temp.rec('adm',12));
SELECT pg_temp.as_user('e3000000-0000-4000-8000-000000000001');
SELECT pg_temp.refused($$SELECT pg_temp.rec('svc',12)$$,'42501','LEAD_REPLY_NOT_YOUR_SEND%','the owner cannot record a send the ADMIN made');
RESET ROLE;
SELECT pg_temp.check_true((SELECT r->>'ok'='true' FROM rec WHERE label='adm')
  AND (SELECT status='approved' AND reviewed_by_user_id='e3000000-0000-4000-8000-000000000005' FROM public.paige_pending_approvals WHERE id=pg_temp.ap('adm')),
  'an admin of the business records the send they made themselves');

-- A different send cannot be recorded while an earlier one on the same reply is unresolved.
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('e3000000-0000-4000-8000-000000000001');
SELECT pg_temp.refused($$SELECT pg_temp.rec('p',13)$$,'55000','LEAD_REPLY_PRIOR_SEND_UNRESOLVED%','a second send cannot be recorded while the first is still prepared');
SELECT pg_temp.refused($$SELECT pg_temp.rec('u',14)$$,'55000','LEAD_REPLY_PRIOR_SEND_UNRESOLVED%','… nor while the first is unknown');
RESET ROLE;
SELECT pg_temp.check_true((SELECT bool_and(status='pending') FROM public.paige_pending_approvals WHERE id IN (pg_temp.ap('p'),pg_temp.ap('u'))),
  'both replies stay pending');
SELECT pg_temp.as_service();
SELECT pg_temp.fin(1,'failed',NULL);
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('e3000000-0000-4000-8000-000000000001');
INSERT INTO rec VALUES ('p-after-fail', pg_temp.rec('p',13));
RESET ROLE;
SELECT pg_temp.check_true((SELECT r->>'ok'='true' FROM rec WHERE label='p-after-fail')
  AND (SELECT status='approved' AND metadata#>>'{governed_send,operation_id}'=pg_temp.op(13)::text FROM public.paige_pending_approvals WHERE id=pg_temp.ap('p')),
  'once the earlier send has failed, the new accepted send is recorded');

-- A business that is not active cannot have replies recorded — and an outsider still learns nothing.
SELECT pg_temp.as_service();
UPDATE public.tenants SET status='suspended' WHERE id='e3000000-0000-4000-8000-00000000bbbb';
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('e3000000-0000-4000-8000-000000000002');
SELECT pg_temp.refused($$SELECT pg_temp.rec('b',8)$$,'42501','LEAD_REPLY_WORKSPACE_UNAVAILABLE%','a suspended business''s owner cannot record a reply');
SELECT pg_temp.as_user('e3000000-0000-4000-8000-000000000001');
SELECT pg_temp.refused($$SELECT pg_temp.rec('b',8)$$,'42501','LEAD_REPLY_FORBIDDEN%','an outsider gets the plain refusal, not the business''s status');
RESET ROLE;
SELECT pg_temp.as_service();
UPDATE public.tenants SET status='active' WHERE id='e3000000-0000-4000-8000-00000000bbbb';
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('e3000000-0000-4000-8000-000000000002');
INSERT INTO rec VALUES ('b', pg_temp.rec('b',8));
RESET ROLE;
SELECT pg_temp.check_true((SELECT r->>'ok'='true' FROM rec WHERE label='b'),'control: once active again, the owner records the reply');

-- ── 4b. lead_reply_record_send_service — the governed door's server-side twin. ────────────────────
CREATE FUNCTION pg_temp.svc(l text,n int,actor uuid) RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.lead_reply_record_send_service(pg_temp.ap(l),pg_temp.op(n),actor) $$;
SET LOCAL ROLE anon;
SELECT pg_temp.refused($$SELECT pg_temp.svc('svc',16,'e3000000-0000-4000-8000-000000000001')$$,'42501','permission denied for function lead_reply_record_send_service','a visitor cannot call the service twin');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('e3000000-0000-4000-8000-000000000001');
SELECT pg_temp.refused($$SELECT pg_temp.svc('svc',16,'e3000000-0000-4000-8000-000000000001')$$,'42501','permission denied for function lead_reply_record_send_service','a signed-in person — even the sender — cannot call the service twin');
SELECT pg_temp.refused($$SELECT public._lead_reply_record_send(pg_temp.ap('svc'),pg_temp.op(16),'e3000000-0000-4000-8000-000000000001')$$,'42501','permission denied for function _lead_reply_record_send','nor the shared body');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT pg_temp.as_service();
SELECT pg_temp.refused($$SELECT pg_temp.svc('svc',16,NULL)$$,'42501','LEAD_REPLY_FORBIDDEN%','the service twin needs the door''s bound actor');
SELECT pg_temp.refused($$SELECT pg_temp.svc('svc',16,'e3000000-0000-4000-8000-000000000005')$$,'42501','LEAD_REPLY_NOT_YOUR_SEND%','… and refuses an actor who did not make the send');
SELECT pg_temp.refused($$SELECT pg_temp.svc('svc',16,'e3000000-0000-4000-8000-000000000003')$$,'42501','LEAD_REPLY_FORBIDDEN%','… a plain member as actor');
SELECT pg_temp.refused($$SELECT pg_temp.svc('svc',16,'e3000000-0000-4000-8000-000000000002')$$,'42501','LEAD_REPLY_FORBIDDEN%','… another business''s owner as actor');
SELECT pg_temp.refused($$SELECT pg_temp.svc('legacy',16,'e3000000-0000-4000-8000-000000000001')$$,'22023','LEAD_REPLY_WRONG_KIND%','… and a legacy client.followup');
SELECT set_config('request.jwt.claim.sub','e3000000-0000-4000-8000-000000000001',true);
SELECT pg_temp.refused($$SELECT pg_temp.svc('svc',16,'e3000000-0000-4000-8000-000000000001')$$,'42501','LEAD_REPLY_FORBIDDEN%','a call carrying a signed-in subject is refused (the twin is for the server only)');
SELECT pg_temp.as_service();
INSERT INTO rec VALUES ('svc', pg_temp.svc('svc',16,'e3000000-0000-4000-8000-000000000001'));
INSERT INTO rec VALUES ('svc-replay', pg_temp.svc('svc',16,'e3000000-0000-4000-8000-000000000001'));
RESET ROLE;
SELECT pg_temp.check_true((SELECT r->>'ok'='true' AND r->>'state'='provider_accepted' AND r->>'delivery_confirmed'='false'
    AND r->>'approval_id'=pg_temp.ap('svc')::text AND r->>'message_id'=pg_temp.msg(16)::text AND r->>'operation_id'=pg_temp.op(16)::text
   FROM rec WHERE label='svc')
  AND (SELECT r->>'replayed'='true' FROM rec WHERE label='svc-replay'),
  'the service twin records the sender''s accepted send with the same answer shape, idempotently');
SELECT pg_temp.check_true((SELECT p.status='approved' AND p.reviewed_by_user_id='e3000000-0000-4000-8000-000000000001'
    AND p.metadata#>>'{governed_send,message_id}'=pg_temp.msg(16)::text FROM public.paige_pending_approvals p WHERE p.id=pg_temp.ap('svc'))
  AND (SELECT status='done' FROM public.paige_actions WHERE approval_id=pg_temp.ap('svc')),
  '… approving the reply in the sender''s name and completing its action');

-- ── 5. lead_reply_enabled — the opt-in, through the audited seam only. ─────────────────────────────
SELECT pg_temp.check_true((SELECT lead_reply_enabled IS FALSE FROM public.growth_forms WHERE id='e3000000-0000-4000-8000-0000000f0001'),
  'a form starts with drafted replies off');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('e3000000-0000-4000-8000-000000000001');
SELECT pg_temp.check_true((SELECT lead_reply_enabled FROM public.growth_form_set_intake('e3000000-0000-4000-8000-0000000f0001',false,NULL,NULL,NULL,true)),
  'the owner turns drafted replies on through growth_form_set_intake (6 args)');
SELECT pg_temp.check_true((SELECT lead_reply_enabled AND notify_email='alerts@a.example.invalid'
   FROM public.growth_form_set_intake('e3000000-0000-4000-8000-0000000f0001',false,NULL,NULL,'alerts@a.example.invalid')),
  'the existing 5-arg positional call still saves the intake and leaves drafted replies as they were');
SELECT pg_temp.check_true((SELECT lead_reply_enabled FROM public.growth_form_set_intake(p_form_id=>'e3000000-0000-4000-8000-0000000f0001',
    p_auto_create_deal=>false,p_pipeline_id=>NULL,p_stage_id=>NULL,p_notify_email=>NULL)),
  'the named 5-arg call (what useFormIntake sends through PostgREST) resolves and keeps the setting');
SELECT pg_temp.check_true((SELECT lead_reply_enabled FROM public.growth_form_set_intake('e3000000-0000-4000-8000-0000000f0001',false,NULL,NULL,NULL,NULL)),
  'NULL leaves the setting unchanged');
SELECT pg_temp.check_true((SELECT NOT lead_reply_enabled FROM public.growth_form_set_intake(p_form_id=>'e3000000-0000-4000-8000-0000000f0001',
    p_auto_create_deal=>false,p_pipeline_id=>NULL,p_stage_id=>NULL,p_notify_email=>NULL,_lead_reply_enabled=>false)),
  'the named 6-arg call turns it off');
SELECT pg_temp.refused($$UPDATE public.growth_forms SET lead_reply_enabled=true WHERE id='e3000000-0000-4000-8000-0000000f0001'$$,
  '42501','GROWTH_FORBIDDEN%','a direct browser write of lead_reply_enabled is refused, even by the owner');
SELECT pg_temp.refused($$INSERT INTO public.growth_forms(tenant_id,slug,name,lead_reply_enabled) VALUES ('e3000000-0000-4000-8000-00000000aaaa','exp03-sneak','Sneak',true)$$,
  '42501','GROWTH_FORBIDDEN%','a browser cannot create a form with drafted replies already on');
SELECT pg_temp.as_user('e3000000-0000-4000-8000-000000000003');
SELECT pg_temp.refused($$SELECT public.growth_form_set_intake('e3000000-0000-4000-8000-0000000f0001',false,NULL,NULL,NULL,true)$$,
  '42501','GROWTH_FORBIDDEN%','a plain member cannot turn drafted replies on');
SELECT pg_temp.as_user('e3000000-0000-4000-8000-000000000006');
SELECT pg_temp.refused($$SELECT public.growth_form_set_intake('e3000000-0000-4000-8000-0000000f000c',false,NULL,NULL,NULL,true)$$,
  '22023','GROWTH_INVALID_INTAKE%','an agency account cannot turn drafted replies on (the processor never drafts for one)');
SELECT pg_temp.check_true((SELECT NOT lead_reply_enabled FROM public.growth_form_set_intake('e3000000-0000-4000-8000-0000000f000c',false,NULL,NULL,NULL,false)),
  'an agency owner can still save the form''s intake with replies left off');
RESET ROLE;
-- (One transaction: every audit row shares created_at, so count the values rather than order them.)
SELECT pg_temp.check_true((SELECT count(*)=5 AND count(*) FILTER (WHERE data->>'lead_reply_enabled'='true')=4
     AND count(*) FILTER (WHERE data->>'lead_reply_enabled'='false')=1
     AND bool_and(user_id='e3000000-0000-4000-8000-000000000001' AND action='growth_form_set_intake')
   FROM public.audit_logs WHERE entity='growth_forms' AND entity_id='e3000000-0000-4000-8000-0000000f0001'),
  'every intake save is audited, including the drafted-replies setting');

ROLLBACK;
