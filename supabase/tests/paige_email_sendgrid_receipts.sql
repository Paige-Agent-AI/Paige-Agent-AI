-- ISOLATED database only (local stack or CI clone); never execute on production.
-- Current-contract continuation: preserve historical replay/ACL/index oracles, then restore the
-- six exact current bodies. Rejected/malformed historical DATA never becomes a new current claim.
-- The original outer ROLLBACK remains the sole transaction end; no provider call occurs here.
-- Experience 03 · S3 — truthful PAIGE Email receipts and one connected history
-- (20271031000200_paige_email_sendgrid_receipts_and_history.sql).
--
-- Proves, through the REAL writers (file_action, advance_action, the governed email door's
-- prepare → claim → finalize, lead_reply_record_send_service, ingest_sendgrid_receipt):
--   0. The migration replays as a no-op; grants: ingest service_role only (SECURITY DEFINER, refuses a
--      signed-in subject in its body), the receipt applier, history helper and trigger functions nobody —
--      service_role cannot call the applier; the old 5-arg ingest signature is gone.
--   1. History: a lead reply reaching provider_accepted writes ONE communication_log row and (open deal)
--      ONE deal_activities row carrying message_id + operation_id, in either order of
--      (finalize, record); replay writes nothing more; a lead with no open deal gets no deal row; a
--      governed email that is not a lead reply gets no history; no deal stage moves; the text never says
--      "delivered" or names a vendor.
--   2. Receipts: correlated delivered; uncorrelated (unknown id) ignored; cross-tenant custom_args
--      forgery, operation forgery, recipient mismatch and a non-SendGrid binding refused; blocked bounce;
--      dropped; spam report (status unchanged, by choice); deferred is no claim; open/click no claim;
--      idempotent replay; no backwards move (stale deferred after delivered); bounce after delivered kept
--      as a late event; delivered after a failure does not resurrect; the contact history follows a
--      bounce; provider reasons stored without e-mail addresses; unrelated messages untouched;
--      email_send_log keeps one appended row per event; every governed SendGrid event needs ALL THREE
--      custom_args claims (an absent one is claims_missing); a binding not provider_accepted, or whose
--      stored id differs, is refused.
--   3. Settle: a SendGrid send finalized 'unknown' (or a stale 'dispatching') is settled by an event only
--      when all three claims AND the recipient match — and never a failed or refused SendGrid send, a Resend
--      send, or a send whose binding already holds another provider id, even with every claim matching; early events for a 'prepared'/'dispatching' send
--      come back 'pending' (nothing journalled, nothing appended) and are bounded; a failing applier
--      still journals (apply_failed) and keeps its email_send_log row.
--   4. History filters: a rejected approval, or a reply action about another contact, writes no history;
--      history rows never carry the client's portal login (user_id NULL even when one exists).
--
-- Synthetic tenants and people only (§2/§63); one transaction that ROLLS BACK.
-- Run: psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/paige_email_sendgrid_receipts.sql
-- prepare_comms_email_send admits a SendGrid connector only with verified domain facts (20271031000100),
-- so fixtures send through the door with a Resend connector and then mark the binding provider='sendgrid'
-- — exactly the row the SendGrid-admitting door writes. Stated, not hidden (§13).
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL timezone='UTC';
SET LOCAL lock_timeout='5s';
SELECT set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claim.role','',true);
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);

CREATE FUNCTION pg_temp.check_true(v boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF v IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',label; END IF; RAISE NOTICE 'PASS: %',label; END $$;
CREATE FUNCTION pg_temp.refused(stmt text,code text,msg text,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN BEGIN EXECUTE stmt; EXCEPTION WHEN others THEN
  IF SQLSTATE=code AND SQLERRM LIKE msg THEN RAISE NOTICE 'PASS: %',label; RETURN; END IF;
  RAISE EXCEPTION 'FAIL: % unexpected % %',label,SQLSTATE,SQLERRM; END;
RAISE EXCEPTION 'FAIL: % accepted',label; END $$;
CREATE FUNCTION pg_temp.as_service() RETURNS void LANGUAGE sql AS $$
 SELECT set_config('request.jwt.claims','{"role":"service_role"}',true), set_config('request.jwt.claim.sub','',true) $$;

-- ── 0. Migrations (the reply migration this builds on, then this one twice: replay is a no-op). ────
-- Historical migration replay below must not leave a mixed generation of native functions.
-- Snapshot the exact CURRENT six contracts inside this proof's existing transaction. No migration
-- BEGIN/COMMIT is included: the outer ROLLBACK remains the only termination of this proof.
CREATE TEMP TABLE current_comms_origin_contract ON COMMIT DROP AS
SELECT p.oid AS function_oid, pg_get_functiondef(p.oid) AS definition, e.expected_md5,
 jsonb_build_object('identity_args',pg_get_function_identity_arguments(p.oid),
  'arguments',pg_get_function_arguments(p.oid),'returns',pg_get_function_result(p.oid),
  'owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text,'settings',p.proconfig,
  'definer',p.prosecdef,'language',p.prolang,'volatility',p.provolatile,
  'parallel',p.proparallel,'strict',p.proisstrict,'leakproof',p.proleakproof,
  'cost',p.procost,'rows',p.prorows) AS metadata
FROM (VALUES
 ('public.advance_action(uuid,text,jsonb,text,uuid,uuid,jsonb,text,text,uuid)'::regprocedure,'66dcedb5e40dd43a54373c0e0ded1884'),
 ('public.prepare_comms_email_send(uuid,uuid,uuid,uuid,text,uuid,text,text,text,text,text,jsonb,jsonb)'::regprocedure,'34fe39ac8f870cbcc6887f3e2fc3a8e0'),
 ('public.read_comms_email_send_binding(uuid)'::regprocedure,'b1afe7cd33a951738c2f49c6660a5023'),
 ('public.claim_comms_email_send(uuid,uuid,boolean)'::regprocedure,'b457bccb225454101baba2355ee6baa6'),
 ('public.paige_guard_send_approval_requires_governed_send()'::regprocedure,'0018e0f9a1b5c63b836cb4ef72558332'),
 ('public._lead_reply_record_send(uuid,uuid,uuid)'::regprocedure,'f0ecd87330486f154d5ffec709a5b579')
) AS e(function_oid,expected_md5) JOIN pg_proc p ON p.oid=e.function_oid;
SELECT pg_temp.check_true((SELECT count(*)=6 AND bool_and(md5(p.prosrc)=s.expected_md5)
 FROM current_comms_origin_contract s JOIN pg_proc p ON p.oid=s.function_oid),
 'fixture begins with all six exact reviewed current origin-admission bodies');

\ir ../migrations/20271031000000_exp03_lead_reply_once_per_submission.sql
\ir ../migrations/20271031000100_paige_email_sendgrid_governed_door.sql
\ir ../migrations/20271031000200_paige_email_sendgrid_receipts_and_history.sql
\ir ../migrations/20271031000200_paige_email_sendgrid_receipts_and_history.sql

SELECT pg_temp.check_true(to_regprocedure('public.ingest_sendgrid_receipt(text,text,text,text,timestamptz)') IS NULL
  AND to_regprocedure('public.ingest_sendgrid_receipt(text,text,text,text,timestamptz,text,text,text,text,text)') IS NOT NULL,
  'ingest_sendgrid_receipt has exactly the 10-arg signature (the 5-arg one is replaced, not overloaded)');
SELECT pg_temp.check_true(has_function_privilege('service_role','public.ingest_sendgrid_receipt(text,text,text,text,timestamptz,text,text,text,text,text)','EXECUTE')
  AND NOT has_function_privilege('anon','public.ingest_sendgrid_receipt(text,text,text,text,timestamptz,text,text,text,text,text)','EXECUTE')
  AND NOT has_function_privilege('authenticated','public.ingest_sendgrid_receipt(text,text,text,text,timestamptz,text,text,text,text,text)','EXECUTE')
  AND NOT has_function_privilege('service_role','public._sendgrid_apply_governed_receipt(text,text,text,timestamptz,text,text,text,text,text)','EXECUTE')
  AND NOT has_function_privilege('anon','public._sendgrid_apply_governed_receipt(text,text,text,timestamptz,text,text,text,text,text)','EXECUTE')
  AND NOT has_function_privilege('authenticated','public._sendgrid_apply_governed_receipt(text,text,text,timestamptz,text,text,text,text,text)','EXECUTE')
  AND (SELECT prosecdef FROM pg_proc WHERE oid='public.ingest_sendgrid_receipt(text,text,text,text,timestamptz,text,text,text,text,text)'::regprocedure),
  'ingest: service_role only and SECURITY DEFINER; the receipt applier: no API role at all, service_role included');
SELECT pg_temp.check_true(NOT has_function_privilege('anon','public._paige_email_record_lead_reply_history(uuid)','EXECUTE')
  AND NOT has_function_privilege('authenticated','public._paige_email_record_lead_reply_history(uuid)','EXECUTE')
  AND NOT has_function_privilege('service_role','public._paige_email_record_lead_reply_history(uuid)','EXECUTE')
  AND (SELECT bool_and(prosecdef AND array_to_string(proconfig,',') LIKE 'search_path=%') FROM pg_proc WHERE oid IN (
    'public._paige_email_record_lead_reply_history(uuid)'::regprocedure,'public._sendgrid_apply_governed_receipt(text,text,text,timestamptz,text,text,text,text,text)'::regprocedure,
    'public._paige_email_history_on_message()'::regprocedure,'public._paige_email_history_on_approval()'::regprocedure,
    'public.ingest_sendgrid_receipt(text,text,text,text,timestamptz,text,text,text,text,text)'::regprocedure)),
  'the history helper is callable by no API role; every new DEFINER function pins search_path');
SELECT pg_temp.check_true((SELECT count(*)=1 FROM pg_trigger WHERE tgname='trg_paige_email_history_on_message' AND tgrelid='public.messages'::regclass)
  AND (SELECT count(*)=1 FROM pg_trigger WHERE tgname='trg_paige_email_history_on_approval' AND tgrelid='public.paige_pending_approvals'::regclass),
  'one history trigger on each side after a replay');

-- Retain the replayed guard solely for the explicitly named historical DATA setup below.
CREATE TEMP TABLE historical_comms_origin_guard ON COMMIT DROP AS
 SELECT pg_get_functiondef('public.paige_guard_send_approval_requires_governed_send()'::regprocedure) AS old_definition;
-- All original historical replay/index/ACL assertions above remain intact. Restore only the
-- exact current definitions captured before replay; no grants, role changes, disabled guards or
-- transaction boundary is introduced. CREATE OR REPLACE retains these existing object identities.
DO $restore_current_comms_origin$
DECLARE saved record;
BEGIN
 FOR saved IN SELECT * FROM current_comms_origin_contract ORDER BY function_oid LOOP
  EXECUTE saved.definition;
 END LOOP;
END $restore_current_comms_origin$;
SELECT pg_temp.check_true((SELECT count(*)=6 AND bool_and(
 md5(p.prosrc)=s.expected_md5 AND pg_get_functiondef(p.oid)=s.definition AND
 jsonb_build_object('identity_args',pg_get_function_identity_arguments(p.oid),
  'arguments',pg_get_function_arguments(p.oid),'returns',pg_get_function_result(p.oid),
  'owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text,'settings',p.proconfig,
  'definer',p.prosecdef,'language',p.prolang,'volatility',p.provolatile,
  'parallel',p.proparallel,'strict',p.proisstrict,'leakproof',p.proleakproof,
  'cost',p.procost,'rows',p.prorows)=s.metadata)
 FROM current_comms_origin_contract s JOIN pg_proc p ON p.oid=s.function_oid),
 'all six current bodies, exact definitions, ABI, owner, ACL and settings restored after historical replay');

-- ── Fixtures ───────────────────────────────────────────────────────────────────────────────────────
INSERT INTO auth.users(id,email) VALUES
 ('e5000000-0000-4000-8000-000000000001','pe-receipts-owner-a@example.invalid'),
 ('e5000000-0000-4000-8000-000000000002','pe-receipts-owner-b@example.invalid'),
 ('e5000000-0000-4000-8000-000000000005','pe-receipts-portal-lead-four@example.invalid');
DO $fixture_owner$ DECLARE fixture_owner_id uuid; BEGIN
 IF (SELECT count(*) FROM public.user_roles WHERE role='super_admin')>1 THEN RAISE EXCEPTION 'FIXTURE: canonical owner is ambiguous'; END IF;
 SELECT user_id INTO fixture_owner_id FROM public.user_roles WHERE role='super_admin';
 IF fixture_owner_id IS NULL THEN
   fixture_owner_id := 'e5000000-0000-4000-8000-000000000004';
   INSERT INTO auth.users(id,email) VALUES(fixture_owner_id,'pe-receipts-fixture-owner@example.invalid');
   INSERT INTO public.user_roles(user_id,role) VALUES(fixture_owner_id,'super_admin');
 END IF;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',fixture_owner_id)::text,true);
END $fixture_owner$;
INSERT INTO public.tenants(id,slug,name,status,account_type,account_number_prefix,features) VALUES
 ('e5000000-0000-4000-8000-00000000aaaa','test-pe-receipts-a','Test Receipts A','active','standalone','E5A','{}'),
 ('e5000000-0000-4000-8000-00000000bbbb','test-pe-receipts-b','Test Receipts B','active','standalone','E5B','{}');
SELECT set_config('request.jwt.claims','{}',true);
INSERT INTO public.tenant_members(tenant_id,user_id,role,status,is_owner,joined_at) VALUES
 ('e5000000-0000-4000-8000-00000000aaaa','e5000000-0000-4000-8000-000000000001','owner','active',true,now()),
 ('e5000000-0000-4000-8000-00000000bbbb','e5000000-0000-4000-8000-000000000002','owner','active',true,now());
UPDATE public.profiles SET active_tenant_id='e5000000-0000-4000-8000-00000000aaaa' WHERE user_id='e5000000-0000-4000-8000-000000000001';
UPDATE public.profiles SET active_tenant_id='e5000000-0000-4000-8000-00000000bbbb' WHERE user_id='e5000000-0000-4000-8000-000000000002';
INSERT INTO public.clients(id,tenant_id,created_by,first_name,last_name,email,account_number,lifecycle_stage,source) VALUES
 ('e5000000-0000-4000-8000-0000000c0001','e5000000-0000-4000-8000-00000000aaaa','e5000000-0000-4000-8000-000000000001','Synthetic','Lead One','lead.one@example.invalid','E5A-1','new_lead','paige_form'),
 ('e5000000-0000-4000-8000-0000000c0002','e5000000-0000-4000-8000-00000000aaaa','e5000000-0000-4000-8000-000000000001','Synthetic','Lead Two','lead.two@example.invalid','E5A-2','new_lead','paige_form'),
 ('e5000000-0000-4000-8000-0000000c0003','e5000000-0000-4000-8000-00000000aaaa','e5000000-0000-4000-8000-000000000001','Synthetic','Client Three','client.three@example.invalid','E5A-3','client_active','manual'),
 ('e5000000-0000-4000-8000-0000000c0004','e5000000-0000-4000-8000-00000000aaaa','e5000000-0000-4000-8000-000000000001','Synthetic','Lead Four','lead.four@example.invalid','E5A-4','new_lead','paige_form'),
 ('e5000000-0000-4000-8000-0000000c0005','e5000000-0000-4000-8000-00000000aaaa','e5000000-0000-4000-8000-000000000001','Synthetic','Lead Five','lead.five@example.invalid','E5A-5','new_lead','paige_form'),
 ('e5000000-0000-4000-8000-0000000c00b1','e5000000-0000-4000-8000-00000000bbbb','e5000000-0000-4000-8000-000000000002','Synthetic','Lead B','lead.b@example.invalid','E5B-1','new_lead','paige_form');
-- Lead Four has a portal login (the history row must still not carry it).
UPDATE public.clients SET linked_user_id='e5000000-0000-4000-8000-000000000005' WHERE id='e5000000-0000-4000-8000-0000000c0004';
INSERT INTO public.channel_connectors(id,tenant_id,channel_type,provider,from_address,status,active) VALUES
 ('e5000000-0000-4000-8000-0000000e000a','e5000000-0000-4000-8000-00000000aaaa','email','resend','owner@a.example.invalid','active',true),
 ('e5000000-0000-4000-8000-0000000e000b','e5000000-0000-4000-8000-00000000bbbb','email','resend','owner@b.example.invalid','active',true);
-- Lead One has an OPEN deal; Lead Two only a WON one (no open deal).
DO $deals$ DECLARE _p uuid; BEGIN
  PERFORM set_config('app.pipeline_created_through','paige',true);
  PERFORM set_config('app.pipeline_requested_by','e5000000-0000-4000-8000-000000000001',true);
  INSERT INTO public.pipelines(tenant_id,name,is_default) VALUES('e5000000-0000-4000-8000-00000000aaaa','Receipts pipeline',true) RETURNING id INTO _p;
  INSERT INTO public.pipeline_stages(id,pipeline_id,tenant_id,label,order_index,probability,stage_type) VALUES
   ('e5000000-0000-4000-8000-0000005a0001',_p,'e5000000-0000-4000-8000-00000000aaaa','New lead',1,10,'open'),
   ('e5000000-0000-4000-8000-0000005a0002',_p,'e5000000-0000-4000-8000-00000000aaaa','Won',2,100,'won');
  INSERT INTO public.deals(id,title,pipeline_id,stage_id,status,tenant_id,contact_client_id) VALUES
   ('e5000000-0000-4000-8000-0000000d0001','Lead One deal',_p,'e5000000-0000-4000-8000-0000005a0001','open','e5000000-0000-4000-8000-00000000aaaa','e5000000-0000-4000-8000-0000000c0001'),
   ('e5000000-0000-4000-8000-0000000d0002','Lead Two deal',_p,'e5000000-0000-4000-8000-0000005a0002','won','e5000000-0000-4000-8000-00000000aaaa','e5000000-0000-4000-8000-0000000c0002');
END $deals$;
SELECT pg_temp.as_service();

-- A drafted lead reply (owner.lead_followup) through file_action + advance_action; returns its approval.
CREATE FUNCTION pg_temp.reply_approval(tenant uuid,contact uuid,submission uuid) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE r jsonb; aid uuid; BEGIN
 r := public.file_action('owner.lead_followup','Reply to a new lead - Receipts form',NULL,contact,
   jsonb_build_object('submission_id',submission,'source','growth_form',
     'draft_input',jsonb_build_object('intent','Reply personally','tone','warm','length','short','recipient_name','Synthetic')),
   NULL,NULL,NULL,NULL,NULL,NULL,'paige',tenant,NULL);
 aid := (r->>'action_id')::uuid;
 PERFORM public.advance_action(aid,'drafted',jsonb_build_object('channel','email','subject','Thanks','body','Hi, thanks.','body_html','<p>Hi, thanks.</p>','raw','{}'::jsonb),
   NULL,NULL,NULL,NULL,NULL,NULL,tenant);
 RETURN (SELECT approval_id FROM public.paige_actions WHERE id=aid);
END $$;

CREATE FUNCTION pg_temp.op(n int) RETURNS uuid LANGUAGE sql AS $$ SELECT ('e5000000-0000-4000-8000-0000000f'||lpad(n::text,4,'0'))::uuid $$;
CREATE FUNCTION pg_temp.msg(n int) RETURNS uuid LANGUAGE sql AS $$
 SELECT id FROM public.messages WHERE meta#>>'{comms_email_binding,operation_id}'=pg_temp.op(n)::text $$;
-- approval: the drafted reply this send answers (the door's governance.approval_id → binding.approval_id).
CREATE FUNCTION pg_temp.prep(n int,actor uuid,tenant uuid,contact uuid,recipient text,connector uuid,sender text,approval uuid DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.prepare_comms_email_send(actor,tenant,pg_temp.op(n),contact,recipient,connector,sender,
  'Reply '||n,'Hi, thanks for writing in ('||n||').','<p>Hi, thanks for writing in ('||n||').</p>',
  encode(extensions.digest(convert_to(recipient||E'\n'||connector::text||E'\n'||'Reply '||n||E'\n'||'Hi, thanks for writing in ('||n||').','UTF8'),'sha256'),'hex'),
  jsonb_build_object('action','comms.email_send','contact_id',contact,'connector_id',connector,'subject','Reply '||n,'body','Hi, thanks for writing in ('||n||').'),
  jsonb_build_object('actor_user_id',actor,'tenant_id',tenant,'tool','comms_send_email','action','comms.email_send',
   'approval_channel','operator_card','approved_fingerprint','0123456789abcdef','decision_receipt_recorded',true)
   ||CASE WHEN approval IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('approval_id',approval) END) $$;
CREATE FUNCTION pg_temp.prep_a(n int,contact uuid,recipient text,approval uuid DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $$
 SELECT pg_temp.prep(n,'e5000000-0000-4000-8000-000000000001','e5000000-0000-4000-8000-00000000aaaa',contact,recipient,
   'e5000000-0000-4000-8000-0000000e000a','owner@a.example.invalid',approval) $$;
-- Claim + finalize provider_accepted with a SendGrid-shaped id; sendgrid=true marks the binding as a
-- SendGrid send (see header).
CREATE FUNCTION pg_temp.accept(n int,provider_id text,sendgrid boolean DEFAULT true) RETURNS void LANGUAGE plpgsql AS $$
DECLARE c jsonb; BEGIN
 c := public.claim_comms_email_send(pg_temp.msg(n),pg_temp.op(n));
 IF (c->>'admitted')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'FIXTURE: claim % not admitted %',n,c; END IF;
 PERFORM public.finalize_comms_email_send(pg_temp.msg(n),pg_temp.op(n),'provider_accepted',provider_id,NULL,(c->>'attempts')::int);
 IF sendgrid THEN
   UPDATE public.messages SET meta=jsonb_set(meta,'{comms_email_binding,provider}','"sendgrid"') WHERE id=pg_temp.msg(n);
 END IF;
END $$;
-- Claim only (the door is mid-dispatch), marking the binding a SendGrid send; returns the attempt.
CREATE FUNCTION pg_temp.claim_sg(n int) RETURNS int LANGUAGE plpgsql AS $$
DECLARE c jsonb; BEGIN
 c := public.claim_comms_email_send(pg_temp.msg(n),pg_temp.op(n));
 IF (c->>'admitted')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'FIXTURE: claim % not admitted %',n,c; END IF;
 UPDATE public.messages SET meta=jsonb_set(meta,'{comms_email_binding,provider}','"sendgrid"') WHERE id=pg_temp.msg(n);
 RETURN (c->>'attempts')::int;
END $$;
CREATE FUNCTION pg_temp.b(n int) RETURNS jsonb LANGUAGE sql AS $$ SELECT meta->'comms_email_binding' FROM public.messages WHERE id=pg_temp.msg(n) $$;
CREATE FUNCTION pg_temp.status(n int) RETURNS text LANGUAGE sql AS $$ SELECT status FROM public.messages WHERE id=pg_temp.msg(n) $$;
CREATE FUNCTION pg_temp.cl(n int) RETURNS bigint LANGUAGE sql AS $$ SELECT count(*) FROM public.communication_log WHERE message_id=pg_temp.msg(n) $$;
CREATE FUNCTION pg_temp.da(n int) RETURNS bigint LANGUAGE sql AS $$
 SELECT count(*) FROM public.deal_activities WHERE type='lead_reply_email' AND payload->>'message_id'=pg_temp.msg(n)::text $$;

CREATE TEMP TABLE ap(label text PRIMARY KEY, id uuid) ON COMMIT DROP;
INSERT INTO ap VALUES
 ('one', pg_temp.reply_approval('e5000000-0000-4000-8000-00000000aaaa','e5000000-0000-4000-8000-0000000c0001','e5000000-0000-4000-8000-000000050001')),
 ('two', pg_temp.reply_approval('e5000000-0000-4000-8000-00000000aaaa','e5000000-0000-4000-8000-0000000c0002','e5000000-0000-4000-8000-000000050002')),
 ('b',   pg_temp.reply_approval('e5000000-0000-4000-8000-00000000bbbb','e5000000-0000-4000-8000-0000000c00b1','e5000000-0000-4000-8000-000000050003')),
 ('four',pg_temp.reply_approval('e5000000-0000-4000-8000-00000000aaaa','e5000000-0000-4000-8000-0000000c0004','e5000000-0000-4000-8000-000000050004')),
 ('five',pg_temp.reply_approval('e5000000-0000-4000-8000-00000000aaaa','e5000000-0000-4000-8000-0000000c0005','e5000000-0000-4000-8000-000000050005')),
 ('x7',  pg_temp.reply_approval('e5000000-0000-4000-8000-00000000aaaa','e5000000-0000-4000-8000-0000000c0002','e5000000-0000-4000-8000-000000050007')),
 ('x8',  pg_temp.reply_approval('e5000000-0000-4000-8000-00000000aaaa','e5000000-0000-4000-8000-0000000c0005','e5000000-0000-4000-8000-000000050008')),
 ('x9',  pg_temp.reply_approval('e5000000-0000-4000-8000-00000000aaaa','e5000000-0000-4000-8000-0000000c0002','e5000000-0000-4000-8000-000000050009'));
SELECT pg_temp.check_true((SELECT count(*)=8 AND bool_and(id IS NOT NULL) FROM ap)
  AND (SELECT bool_and(status='pending') FROM public.paige_pending_approvals WHERE id IN (SELECT id FROM ap)),
  'fixture: eight drafted lead replies, each a pending approval');
CREATE FUNCTION pg_temp.ap(l text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM ap WHERE label=l $$;

-- ── 1. History ─────────────────────────────────────────────────────────────────────────────────────
-- Order 1: the door finalizes, THEN the reply's approval is recorded (the approval-side trigger writes).
SELECT pg_temp.prep_a(1,'e5000000-0000-4000-8000-0000000c0001','lead.one@example.invalid',pg_temp.ap('one'));
SELECT pg_temp.accept(1,'sgLeadOne1');
SELECT pg_temp.check_true(pg_temp.cl(1)=0 AND pg_temp.da(1)=0,
  'accepted but not yet linked to its reply approval: no history yet (it is not known to be a lead reply)');
SELECT pg_temp.check_true((public.lead_reply_record_send_service(pg_temp.ap('one'),pg_temp.op(1),'e5000000-0000-4000-8000-000000000001')->>'ok')::boolean,
  'the reply approval records the accepted send');
SELECT pg_temp.check_true((SELECT count(*)=1 FROM public.communication_log
    WHERE message_id=pg_temp.msg(1) AND operation_id=pg_temp.op(1) AND tenant_id='e5000000-0000-4000-8000-00000000aaaa'
      AND contact_id='e5000000-0000-4000-8000-0000000c0001' AND user_id IS NULL AND channel='email'
      AND message_type='lead_reply' AND status='sent' AND preview ILIKE '%handed to the email provider%'
      AND preview NOT ILIKE '%delivered%' AND preview NOT ILIKE '%sendgrid%' AND preview NOT ILIKE '%resend%'),
  'ONE contact activity row: message_id + operation_id, tenant- and contact-keyed, "handed to the email provider", never "delivered" or a vendor');
SELECT pg_temp.check_true((SELECT count(*)=1 FROM public.deal_activities
    WHERE deal_id='e5000000-0000-4000-8000-0000000d0001' AND type='lead_reply_email'
      AND payload->>'message_id'=pg_temp.msg(1)::text AND payload->>'operation_id'=pg_temp.op(1)::text
      AND payload->>'approval_id'=pg_temp.ap('one')::text AND (payload->>'delivery_confirmed')::boolean=false
      AND actor_user_id='e5000000-0000-4000-8000-000000000001'
      AND summary ILIKE '%handed to the email provider%' AND summary NOT ILIKE '%delivered%'
      AND summary NOT ILIKE '%won%' AND summary NOT ILIKE '%sale%'),
  'ONE deal activity on the lead''s open deal, carrying the ids, no delivery claim, no sale claim');
SELECT pg_temp.check_true((SELECT stage_id='e5000000-0000-4000-8000-0000005a0001' AND status='open' FROM public.deals WHERE id='e5000000-0000-4000-8000-0000000d0001'),
  'the deal did not move stage');
-- Replays: recording again, and the history writer again, add nothing.
SELECT public.lead_reply_record_send_service(pg_temp.ap('one'),pg_temp.op(1),'e5000000-0000-4000-8000-000000000001');
SELECT public._paige_email_record_lead_reply_history(pg_temp.msg(1));
UPDATE public.paige_pending_approvals SET metadata=metadata||'{"touched":true}'::jsonb WHERE id=pg_temp.ap('one');
SELECT pg_temp.check_true(pg_temp.cl(1)=1 AND pg_temp.da(1)=1, 'history is written once per message (replay and re-trigger write nothing)');
SELECT pg_temp.refused(format($$INSERT INTO public.communication_log(tenant_id,contact_id,message_id,channel,message_type,status) VALUES ('e5000000-0000-4000-8000-00000000aaaa','e5000000-0000-4000-8000-0000000c0001',%L,'email','lead_reply','sent')$$,pg_temp.msg(1)),
  '23505','%uq_communication_log_message%','the unique index refuses a second contact row for the same message');
SELECT pg_temp.refused($$INSERT INTO public.communication_log(channel,message_type,status) VALUES ('email','x','sent')$$,
  '23514','%communication_log_subject_check%','a history row must name a portal user or a business contact');

-- Order 2: the reply is recorded while the send is still PREPARED, then the door finalizes (the
-- message-side trigger writes). Lead Two has no OPEN deal: a contact row, no deal row.
SELECT pg_temp.prep_a(2,'e5000000-0000-4000-8000-0000000c0002','lead.two@example.invalid',pg_temp.ap('two'));
SELECT pg_temp.check_true(public.lead_reply_record_send_service(pg_temp.ap('two'),pg_temp.op(2),'e5000000-0000-4000-8000-000000000001')->>'state'='prepared',
  'recorded while prepared (the approval cites the message, still pending)');
SELECT pg_temp.check_true(pg_temp.cl(2)=0, 'nothing handed over yet: no history');
SELECT pg_temp.accept(2,'sgLeadTwo2');
SELECT pg_temp.check_true(pg_temp.cl(2)=1 AND pg_temp.da(2)=0
  AND NOT EXISTS (SELECT 1 FROM public.deal_activities WHERE deal_id='e5000000-0000-4000-8000-0000000d0002'),
  'finalize after the link writes the contact row; a lead with only a won deal gets no deal row');

-- A governed email that is NOT a lead reply (no reply approval cites it): no history.
SELECT pg_temp.prep_a(3,'e5000000-0000-4000-8000-0000000c0003','client.three@example.invalid');
SELECT pg_temp.accept(3,'sgClientThree3');
SELECT pg_temp.check_true(pg_temp.cl(3)=0 AND pg_temp.da(3)=0, 'an ordinary governed email writes no lead-reply history');

-- Business B's lead reply (for the cross-tenant checks below).
SELECT pg_temp.prep(5,'e5000000-0000-4000-8000-000000000002','e5000000-0000-4000-8000-00000000bbbb','e5000000-0000-4000-8000-0000000c00b1',
  'lead.b@example.invalid','e5000000-0000-4000-8000-0000000e000b','owner@b.example.invalid',pg_temp.ap('b'));
SELECT pg_temp.accept(5,'sgLeadB5');
SELECT public.lead_reply_record_send_service(pg_temp.ap('b'),pg_temp.op(5),'e5000000-0000-4000-8000-000000000002');
SELECT pg_temp.check_true((SELECT count(*)=1 FROM public.communication_log WHERE message_id=pg_temp.msg(5) AND tenant_id='e5000000-0000-4000-8000-00000000bbbb'),
  'business B''s history row carries business B');

-- A lead WITH a portal login: the history row still carries no user_id (owner wording; the client's
-- "own comm log" policy would otherwise show it to them).
SELECT pg_temp.prep_a(17,'e5000000-0000-4000-8000-0000000c0004','lead.four@example.invalid',pg_temp.ap('four'));
SELECT pg_temp.accept(17,'sgLeadFour17');
SELECT public.lead_reply_record_send_service(pg_temp.ap('four'),pg_temp.op(17),'e5000000-0000-4000-8000-000000000001');
SELECT pg_temp.check_true(pg_temp.cl(17)=1
  AND (SELECT user_id IS NULL AND contact_id='e5000000-0000-4000-8000-0000000c0004' FROM public.communication_log WHERE message_id=pg_temp.msg(17))
  AND (SELECT linked_user_id IS NOT NULL FROM public.clients WHERE id='e5000000-0000-4000-8000-0000000c0004'),
  'a lead with a portal login: its history row has user_id NULL (keyed to the contact, not the login)');
-- X6: an approval that is no longer live (rejected) writes no history, even though it cites the send.
SELECT pg_temp.prep_a(18,'e5000000-0000-4000-8000-0000000c0005','lead.five@example.invalid',pg_temp.ap('five'));
SELECT pg_temp.check_true(public.lead_reply_record_send_service(pg_temp.ap('five'),pg_temp.op(18),'e5000000-0000-4000-8000-000000000001')->>'state'='prepared',
  'fixture: Lead Five''s reply approval cites its prepared send');
-- Current counterpart: cancellation committed before admission forbids a new provider outcome.
UPDATE public.paige_pending_approvals SET status='rejected' WHERE id=pg_temp.ap('five');
SELECT pg_temp.check_true((public.claim_comms_email_send(pg_temp.msg(18),pg_temp.op(18))->>'admitted')::boolean IS FALSE,
 'current rejected-before-admission origin is not admitted');
SELECT pg_temp.check_true(pg_temp.b(18)->>'state'='refused' AND (pg_temp.b(18)->>'attempts')::int=0
 AND pg_temp.b(18)->>'provider_message_id' IS NULL AND pg_temp.status(18)='blocked',
 'current cancellation retains zero attempts and no provider outcome');
-- Separately model the explicitly historical accepted/rejected pair for the original history
-- filter oracle. This is DATA setup, not a claim or invented native origin identity.
-- A separate unrelated accepted message supplies canonical historical columns. Only the exact
-- known approval/operation correlation below is seeded as old unsealed DATA; there is no new
-- admission for the rejected approval and no reactivation of its status.
SELECT pg_temp.prep_a(118,'e5000000-0000-4000-8000-0000000c0005','lead.five@example.invalid');
SELECT pg_temp.accept(118,'sgLeadFive118');
-- Historical DATA fixture only: the known accepted118/rejected-five historical pair, with current admission untouched.
-- The bounded setup uses the already-replayed historical guard, then immediately restores the
-- captured CURRENT guard. It never changes current claim/prepare, invents a seal, or sends.
DO $historical_origin_data$
DECLARE definition text; affected integer;
BEGIN
 SELECT old_definition INTO STRICT definition FROM historical_comms_origin_guard;
 EXECUTE definition;
 UPDATE public.messages SET meta=jsonb_set(meta,'{comms_email_binding}',
   (meta->'comms_email_binding'-ARRAY['origin_action_id','origin_action_kind'])
   ||jsonb_build_object('approval_id',pg_temp.ap('five'),
      'governance',(meta#>'{comms_email_binding,governance}')||jsonb_build_object('approval_id',pg_temp.ap('five'))))
  WHERE id=pg_temp.msg(118) AND meta#>>'{comms_email_binding,state}'='provider_accepted';
 GET DIAGNOSTICS affected = ROW_COUNT;
 IF affected<>1 THEN RAISE EXCEPTION 'FIXTURE: expected one known historical accepted message'; END IF;
 UPDATE public.paige_pending_approvals SET metadata=metadata||jsonb_build_object('governed_send',
   jsonb_build_object('message_id',pg_temp.msg(118),'operation_id',pg_temp.op(118),'state','provider_accepted'))
  WHERE id=pg_temp.ap('five') AND status='rejected';
 GET DIAGNOSTICS affected = ROW_COUNT;
 IF affected<>1 THEN RAISE EXCEPTION 'FIXTURE: expected exactly one named historical row'; END IF;
 SELECT s.definition INTO STRICT definition FROM current_comms_origin_contract s
  WHERE s.function_oid='public.paige_guard_send_approval_requires_governed_send()'::regprocedure;
 EXECUTE definition;
 IF md5((SELECT prosrc FROM pg_proc WHERE oid='public.paige_guard_send_approval_requires_governed_send()'::regprocedure))
  IS DISTINCT FROM (SELECT expected_md5 FROM current_comms_origin_contract WHERE function_oid='public.paige_guard_send_approval_requires_governed_send()'::regprocedure)
 THEN RAISE EXCEPTION 'FIXTURE: current guard was not restored'; END IF;
END $historical_origin_data$;

SELECT pg_temp.check_true(pg_temp.b(118)->>'state'='provider_accepted'
 AND (SELECT status='rejected' FROM public.paige_pending_approvals WHERE id=pg_temp.ap('five'))
 AND pg_temp.cl(118)=0 AND pg_temp.da(118)=0,
 'historical REJECTED approval citing accepted118 writes no history (original approval-status filter)');
SELECT pg_temp.check_true(pg_temp.cl(118)=0 AND pg_temp.da(118)=0,
  'a REJECTED reply approval citing the accepted send writes no history (approval-status filter)');
-- X7: an approval whose reply action is about ANOTHER contact (Lead Two) citing Lead Five's send. The
-- binding is forged to name that approval too (the door would refuse to prepare it), so ONLY the
-- action-contact filter stands between this send and a history row.
SELECT pg_temp.prep_a(19,'e5000000-0000-4000-8000-0000000c0005','lead.five@example.invalid');
SELECT pg_temp.accept(19,'sgLeadFive19');
UPDATE public.messages SET meta=jsonb_set(meta,'{comms_email_binding,approval_id}',to_jsonb(pg_temp.ap('x7')::text)) WHERE id=pg_temp.msg(19);
UPDATE public.paige_pending_approvals
   SET metadata=metadata||jsonb_build_object('governed_send',jsonb_build_object('message_id',pg_temp.msg(19),'operation_id',pg_temp.op(19)))
 WHERE id=pg_temp.ap('x7');
SELECT pg_temp.check_true(pg_temp.cl(19)=0 AND pg_temp.da(19)=0,
  'an approval whose reply action names another contact writes no history for this send (action-contact filter)');
-- A reply approval pointed (metadata.governed_send) at an accepted email the door did NOT prepare for
-- it writes no history: (a) the binding names ANOTHER approval; (b) the binding names none (e.g. sent
-- from chat — here forged malformed, which must neither match nor break the send's own update).
SELECT pg_temp.prep_a(21,'e5000000-0000-4000-8000-0000000c0005','lead.five@example.invalid');
SELECT pg_temp.accept(21,'sgLeadFive21');
UPDATE public.messages SET meta=jsonb_set(meta,'{comms_email_binding,approval_id}',to_jsonb(pg_temp.ap('x9')::text)) WHERE id=pg_temp.msg(21);
UPDATE public.paige_pending_approvals
   SET metadata=metadata||jsonb_build_object('governed_send',jsonb_build_object('message_id',pg_temp.msg(21),'operation_id',pg_temp.op(21)))
 WHERE id=pg_temp.ap('x8');
SELECT pg_temp.check_true(pg_temp.cl(21)=0 AND pg_temp.da(21)=0,
  'a reply approval pointed at an email prepared for ANOTHER approval writes no history (binding approval_id equality)');
SELECT pg_temp.prep_a(20,'e5000000-0000-4000-8000-0000000c0005','lead.five@example.invalid');
SELECT pg_temp.accept(20,'sgLeadFive20');
-- Historical malformed binding is seeded AFTER real admission; it never requests a fresh claim.
UPDATE public.messages SET meta=jsonb_set(meta,'{comms_email_binding,approval_id}','"not-a-uuid"') WHERE id=pg_temp.msg(20);
UPDATE public.paige_pending_approvals
   SET metadata=metadata||jsonb_build_object('governed_send',jsonb_build_object('message_id',pg_temp.msg(20),'operation_id',pg_temp.op(20)))
 WHERE id=pg_temp.ap('x8');
SELECT pg_temp.check_true(pg_temp.b(20)->>'state'='provider_accepted' AND pg_temp.cl(20)=0 AND pg_temp.da(20)=0,
  'a binding with no usable approval id: the send still finalizes, and no approval earns it a history row');

-- More governed sends of business A for receipt outcomes.
SELECT pg_temp.prep_a(6,'e5000000-0000-4000-8000-0000000c0003','client.three@example.invalid'); SELECT pg_temp.accept(6,'sgDrop6');
SELECT pg_temp.prep_a(7,'e5000000-0000-4000-8000-0000000c0003','client.three@example.invalid'); SELECT pg_temp.accept(7,'sgSpam7');
SELECT pg_temp.prep_a(8,'e5000000-0000-4000-8000-0000000c0003','client.three@example.invalid'); SELECT pg_temp.accept(8,'resendId8',false);
SELECT pg_temp.prep_a(9,'e5000000-0000-4000-8000-0000000c0003','client.three@example.invalid'); SELECT pg_temp.accept(9,'sgDefer9');
-- SendGrid sends with NO stored provider id (the settle cases):
--   12: finalized 'unknown' (the door could not read the provider's answer);
--   14: claimed 'dispatching' an hour ago and never finalized;
--   15: claimed 'dispatching' just now (the door is still inside its provider call);
--   16: 'prepared', never dispatched.
SELECT pg_temp.prep_a(12,'e5000000-0000-4000-8000-0000000c0003','client.three@example.invalid');
SELECT public.finalize_comms_email_send(pg_temp.msg(12),pg_temp.op(12),'unknown',NULL,'provider_timeout',pg_temp.claim_sg(12));
SELECT pg_temp.prep_a(14,'e5000000-0000-4000-8000-0000000c0003','client.three@example.invalid'); SELECT pg_temp.claim_sg(14);
UPDATE public.messages SET meta=jsonb_set(meta,'{comms_email_binding,claimed_at}',to_jsonb(now()-interval '1 hour')) WHERE id=pg_temp.msg(14);
SELECT pg_temp.prep_a(15,'e5000000-0000-4000-8000-0000000c0003','client.three@example.invalid'); SELECT pg_temp.claim_sg(15);
SELECT pg_temp.prep_a(16,'e5000000-0000-4000-8000-0000000c0003','client.three@example.invalid');
UPDATE public.messages SET meta=jsonb_set(meta,'{comms_email_binding,provider}','"sendgrid"') WHERE id=pg_temp.msg(16);
SELECT pg_temp.check_true(pg_temp.b(12)->>'state'='unknown' AND pg_temp.b(14)->>'state'='dispatching' AND pg_temp.b(15)->>'state'='dispatching'
  AND pg_temp.b(16)->>'state'='prepared'
  AND (SELECT bool_and(provider_message_id IS NULL) FROM public.messages WHERE id IN (pg_temp.msg(12),pg_temp.msg(14),pg_temp.msg(15),pg_temp.msg(16))),
  'fixture: four SendGrid sends with no stored provider id (unknown, stale dispatching, live dispatching, prepared)');

-- ── 2. Receipts (as the webhook's real role) ───────────────────────────────────────────────────────
CREATE TEMP TABLE snap(label text PRIMARY KEY, v text) ON COMMIT DROP;
GRANT ALL ON snap, ap TO service_role;
-- Sends the settle path must NEVER settle, though an event's three claims and address all match them
-- (round-4 verifier finding 2):
--   41: a SendGrid send that FAILED (the provider refused it at dispatch);
--   42: a SendGrid send REFUSED before dispatch;
--   43: a Resend send whose outcome is unknown (a SendGrid event is never about a Resend send);
--   44: a SendGrid send whose outcome is unknown but whose binding already holds another provider id.
SELECT pg_temp.prep_a(41,'e5000000-0000-4000-8000-0000000c0003','client.three@example.invalid');
SELECT public.finalize_comms_email_send(pg_temp.msg(41),pg_temp.op(41),'failed',NULL,'provider_rejected',pg_temp.claim_sg(41));
SELECT pg_temp.prep_a(42,'e5000000-0000-4000-8000-0000000c0003','client.three@example.invalid');
SELECT public.finalize_comms_email_send(pg_temp.msg(42),pg_temp.op(42),'refused',NULL,'sender_unverified',NULL);
UPDATE public.messages SET meta=jsonb_set(meta,'{comms_email_binding,provider}','"sendgrid"') WHERE id=pg_temp.msg(42);
SELECT pg_temp.prep_a(43,'e5000000-0000-4000-8000-0000000c0003','client.three@example.invalid');
SELECT public.finalize_comms_email_send(pg_temp.msg(43),pg_temp.op(43),'unknown',NULL,'provider_timeout',
  (public.claim_comms_email_send(pg_temp.msg(43),pg_temp.op(43))->>'attempts')::int);
SELECT pg_temp.prep_a(44,'e5000000-0000-4000-8000-0000000c0003','client.three@example.invalid');
SELECT public.finalize_comms_email_send(pg_temp.msg(44),pg_temp.op(44),'unknown',NULL,'provider_timeout',pg_temp.claim_sg(44));
UPDATE public.messages SET meta=jsonb_set(meta,'{comms_email_binding,provider_message_id}','"sgOther44"') WHERE id=pg_temp.msg(44);
SELECT pg_temp.check_true(pg_temp.b(41)->>'state'='failed' AND pg_temp.b(41)->>'provider'='sendgrid'
  AND pg_temp.b(42)->>'state'='refused' AND pg_temp.b(42)->>'provider'='sendgrid'
  AND pg_temp.b(43)->>'state'='unknown' AND pg_temp.b(43)->>'provider'='resend'
  AND pg_temp.b(44)->>'state'='unknown' AND pg_temp.b(44)->>'provider'='sendgrid' AND pg_temp.b(44)->>'provider_message_id'='sgOther44'
  AND (SELECT bool_and(provider_message_id IS NULL) FROM public.messages WHERE id IN (pg_temp.msg(41),pg_temp.msg(42),pg_temp.msg(43),pg_temp.msg(44))),
  'fixture: a failed and a refused SendGrid send, an unknown Resend send, and an unknown SendGrid send already holding another id');
INSERT INTO snap SELECT 'never_settled', md5(string_agg(id::text||status||meta::text||coalesce(error,'')||coalesce(provider_message_id,''),'|' ORDER BY id))
  FROM public.messages WHERE id IN (pg_temp.msg(41),pg_temp.msg(42),pg_temp.msg(43),pg_temp.msg(44));

-- Every message the receipts below may NOT touch: business B's, and A's message 3 (never addressed).
INSERT INTO snap SELECT 'untouched', md5(string_agg(id::text||status||meta::text||coalesce(error,''),'|' ORDER BY id))
  FROM public.messages WHERE tenant_id IN ('e5000000-0000-4000-8000-00000000bbbb') OR id=pg_temp.msg(3);
-- Named arguments, exactly as the webhook calls it through PostgREST.
CREATE FUNCTION pg_temp.ev(eid text,sg text,st text,email text DEFAULT NULL,at timestamptz DEFAULT '2027-10-31T10:00:00Z',
  tenant text DEFAULT NULL,op text DEFAULT NULL,btype text DEFAULT NULL,reason text DEFAULT NULL,msgref text DEFAULT NULL) RETURNS text LANGUAGE sql AS $$
 SELECT public.ingest_sendgrid_receipt(_receipt_id=>'sg:'||eid,_message_id=>sg,_status=>st,_email=>email,_event_at=>at,
   _tenant_id=>tenant,_operation_id=>op,_paige_message_id=>msgref,_bounce_type=>btype,_reason=>reason) $$;
-- The same, carrying all three claims of governed message n (what send-message attaches to every send).
CREATE FUNCTION pg_temp.evm(eid text,sg text,n int,st text,email text DEFAULT NULL,at timestamptz DEFAULT '2027-10-31T10:00:00Z',
  btype text DEFAULT NULL,reason text DEFAULT NULL) RETURNS text LANGUAGE sql AS $$
 SELECT pg_temp.ev(eid,sg,st,email,at,(SELECT tenant_id::text FROM public.messages WHERE id=pg_temp.msg(n)),pg_temp.op(n)::text,
   btype,reason,pg_temp.msg(n)::text) $$;
CREATE FUNCTION pg_temp.j(eid text) RETURNS jsonb LANGUAGE sql AS $$
 SELECT to_jsonb(r) FROM public.sendgrid_receipt_processing r WHERE receipt_id='sg:'||eid $$;

SET LOCAL ROLE service_role;
-- Uncorrelated: an id no message carries.
SELECT pg_temp.check_true(pg_temp.ev('u1','sgUnknownZZ','delivered','someone@example.invalid')='processed'
  AND pg_temp.j('u1')->>'correlation'='uncorrelated' AND pg_temp.j('u1')->>'correlation_reason'='no_message'
  AND pg_temp.j('u1')->>'correlated_message_id' IS NULL,
  'an event for no known message is journalled uncorrelated (no_message) and changes nothing');
-- Cross-tenant custom_args forgery: business A's message id, business B's tenant.
SELECT pg_temp.check_true(pg_temp.ev('f1','sgLeadOne1','delivered','lead.one@example.invalid','2027-10-31T10:00:00Z','e5000000-0000-4000-8000-00000000bbbb',pg_temp.op(1)::text,NULL,NULL,pg_temp.msg(1)::text)='processed'
  AND pg_temp.j('f1')->>'correlation_reason'='tenant_mismatch' AND pg_temp.b(1)->>'delivery_state' IS NULL AND pg_temp.status(1)='sent',
  'a custom_args tenant that is not the message''s business is refused (tenant_mismatch), nothing moves');
SELECT pg_temp.check_true(pg_temp.ev('f2','sgLeadOne1','delivered','lead.one@example.invalid','2027-10-31T10:00:00Z','e5000000-0000-4000-8000-00000000aaaa',pg_temp.op(5)::text,NULL,NULL,pg_temp.msg(1)::text)='processed'
  AND pg_temp.j('f2')->>'correlation_reason'='operation_mismatch' AND pg_temp.status(1)='sent',
  'a custom_args operation that is not the message''s operation is refused (operation_mismatch)');
SELECT pg_temp.check_true(pg_temp.evm('f3','sgLeadOne1',1,'delivered','not.the.lead@example.invalid')='processed'
  AND pg_temp.j('f3')->>'correlation_reason'='recipient_mismatch' AND pg_temp.status(1)='sent',
  'an event for another recipient is refused (recipient_mismatch)');
SELECT pg_temp.check_true(pg_temp.ev('f4','sgLeadOne1','delivered','lead.one@example.invalid','2027-10-31T10:00:00Z','not-a-uuid',pg_temp.op(1)::text,NULL,NULL,pg_temp.msg(1)::text)='processed'
  AND pg_temp.j('f4')->>'correlation_reason'='tenant_mismatch',
  'a malformed tenant claim is refused, not ignored');
SELECT pg_temp.check_true(pg_temp.ev('f6','sgLeadOne1','delivered','lead.one@example.invalid','2027-10-31T10:00:00Z','e5000000-0000-4000-8000-00000000aaaa',pg_temp.op(1)::text,NULL,NULL,pg_temp.msg(5)::text)='processed'
  AND pg_temp.j('f6')->>'correlation_reason'='message_mismatch' AND pg_temp.status(1)='sent',
  'a custom_args message id that names another message (here: business B''s) is refused (message_mismatch)');
SELECT pg_temp.check_true(pg_temp.evm('f5','resendId8',8,'delivered','client.three@example.invalid')='processed'
  AND pg_temp.j('f5')->>'correlation_reason'='provider_mismatch' AND pg_temp.status(8)='sent',
  'a SendGrid event never updates an email another provider accepted (provider_mismatch)');
-- L1: every governed SendGrid send carries all three claims; an event missing any one is not about it.
SELECT pg_temp.check_true(pg_temp.ev('m1','sgLeadOne1','delivered','lead.one@example.invalid','2027-10-31T10:00:00Z',NULL,pg_temp.op(1)::text,NULL,NULL,pg_temp.msg(1)::text)='processed'
  AND pg_temp.j('m1')->>'correlation_reason'='claims_missing' AND pg_temp.status(1)='sent',
  'no tenant claim: claims_missing, nothing moves');
SELECT pg_temp.check_true(pg_temp.ev('m2','sgLeadOne1','delivered','lead.one@example.invalid','2027-10-31T10:00:00Z','e5000000-0000-4000-8000-00000000aaaa',NULL,NULL,NULL,pg_temp.msg(1)::text)='processed'
  AND pg_temp.j('m2')->>'correlation_reason'='claims_missing' AND pg_temp.status(1)='sent',
  'no operation claim: claims_missing, nothing moves');
SELECT pg_temp.check_true(pg_temp.ev('m3','sgLeadOne1','delivered','lead.one@example.invalid','2027-10-31T10:00:00Z','e5000000-0000-4000-8000-00000000aaaa',pg_temp.op(1)::text)='processed'
  AND pg_temp.j('m3')->>'correlation_reason'='claims_missing' AND pg_temp.status(1)='sent',
  'no message claim: claims_missing, nothing moves');

-- Deferred: no delivery claim, status unchanged.
SELECT pg_temp.check_true(pg_temp.evm('d1','sgLeadOne1',1,'delivery_delayed','lead.one@example.invalid','2027-10-31T10:01:00Z',
    NULL,'421 try again later for lead.one@example.invalid')='processed'
  AND pg_temp.j('d1')->>'correlation'='correlated' AND pg_temp.j('d1')->>'delivery_effect'='deferred'
  AND pg_temp.b(1)->>'delivery_state'='deferred' AND pg_temp.status(1)='sent'
  AND coalesce((pg_temp.b(1)->>'delivery_confirmed')::boolean,false)=false
  AND pg_temp.b(1)->>'delivery_reason' NOT LIKE '%@%' AND pg_temp.b(1)->>'delivery_reason' LIKE '%[address]%',
  'deferred (with matching custom_args): delivery_state deferred, status still sent, no delivery claim, no address kept');
-- Open / click: no claim.
SELECT pg_temp.check_true(pg_temp.evm('o1','sgLeadOne1',1,'opened','lead.one@example.invalid')='processed'
  AND pg_temp.j('o1')->>'delivery_effect'='none' AND pg_temp.b(1)->>'delivery_state'='deferred' AND pg_temp.status(1)='sent',
  'an open changes nothing and claims no delivery');
-- Delivered.
SELECT pg_temp.check_true(pg_temp.ev('v1','sgLeadOne1','delivered','lead.one@example.invalid','2027-10-31T10:02:00Z',
    'E5000000-0000-4000-8000-00000000AAAA',pg_temp.op(1)::text,NULL,NULL,pg_temp.msg(1)::text)='processed'
  AND pg_temp.status(1)='delivered' AND (pg_temp.b(1)->>'delivery_confirmed')::boolean
  AND pg_temp.b(1)->>'delivery_state'='delivered' AND (pg_temp.b(1)->>'delivered_at')::timestamptz='2027-10-31T10:02:00Z'
  AND pg_temp.b(1)->>'state'='provider_accepted' AND pg_temp.j('v1')->>'correlated_message_id'=pg_temp.msg(1)::text,
  'a correlated delivered (every custom_args claim matching; the tenant claim upper-case): status delivered, delivery_confirmed true, delivered_at = the event time; the send state is untouched');
INSERT INTO snap VALUES ('m1_after_delivered', (SELECT meta::text FROM public.messages WHERE id=pg_temp.msg(1)));
-- Idempotent replay of the same event identity.
SELECT pg_temp.check_true(pg_temp.ev('v1','sgLeadOne1','delivered','lead.one@example.invalid','2027-10-31T10:02:00Z',
    'E5000000-0000-4000-8000-00000000AAAA',pg_temp.op(1)::text,NULL,NULL,pg_temp.msg(1)::text)='duplicate'
  AND (SELECT count(*)=1 FROM public.sendgrid_receipt_processing WHERE receipt_id='sg:v1')
  AND (SELECT count(*)=1 FROM public.email_send_log WHERE metadata->>'receipt_id'='sg:v1')
  AND (SELECT meta::text FROM public.messages WHERE id=pg_temp.msg(1))=(SELECT v FROM snap WHERE label='m1_after_delivered'),
  'the same event twice is one effect (duplicate; one journal row, one log row, message unchanged)');
-- No backwards move: a stale deferred after delivered.
SELECT pg_temp.check_true(pg_temp.evm('d2','sgLeadOne1',1,'delivery_delayed','lead.one@example.invalid','2027-10-31T10:00:30Z')='processed'
  AND pg_temp.j('d2')->>'delivery_effect'='stale_ignored' AND pg_temp.status(1)='delivered' AND pg_temp.b(1)->>'delivery_state'='delivered',
  'a stale deferred after delivered stays delivered');
-- Bounce after delivered: delivered stands; the late report is kept.
SELECT pg_temp.check_true(pg_temp.evm('b9','sgLeadOne1',1,'bounced','lead.one@example.invalid','2027-10-31T11:00:00Z','bounce','550 mailbox gone')='processed'
  AND pg_temp.j('b9')->>'delivery_effect'='late_event_recorded' AND pg_temp.status(1)='delivered'
  AND (pg_temp.b(1)->>'delivery_confirmed')::boolean AND pg_temp.b(1)->'delivery_late_event'->>'state'='bounced'
  AND pg_temp.b(1)->'delivery_late_event'->>'reason'='550 mailbox gone',
  'a bounce after delivered is recorded as a late event; delivered stands');

-- Blocked bounce on Lead Two's reply: failed + blocked + reason; its contact history follows.
-- (The ingest runs in its own statement: a plain subquery in the SAME statement reads the statement's
-- snapshot and would not see the write.)
SELECT pg_temp.check_true(pg_temp.evm('k1','sgLeadTwo2',2,'bounced','lead.two@example.invalid','2027-10-31T10:05:00Z',
    'blocked','554 5.7.1 <lead.two@example.invalid>: blocked by policy')='processed',
  'the blocked bounce is processed');
SELECT pg_temp.check_true(pg_temp.status(2)='failed' AND pg_temp.b(2)->>'delivery_state'='blocked'
  AND coalesce((pg_temp.b(2)->>'delivery_confirmed')::boolean,true)=false
  AND pg_temp.b(2)->>'delivery_reason'='554 5.7.1 <[address]>: blocked by policy'
  AND (SELECT error FROM public.messages WHERE id=pg_temp.msg(2)) ILIKE '%blocked%'
  AND (SELECT error FROM public.messages WHERE id=pg_temp.msg(2)) NOT ILIKE '%sendgrid%'
  AND (SELECT status='bounced' FROM public.email_send_log WHERE metadata->>'receipt_id'='sg:k1'),
  'a blocked bounce: status failed, delivery_state blocked, safe reason, plain words; email_send_log unchanged in shape');
-- Delivered after a failure does not resurrect it.
SELECT pg_temp.check_true(pg_temp.evm('k2','sgLeadTwo2',2,'delivered','lead.two@example.invalid','2027-10-31T10:06:00Z')='processed'
  AND pg_temp.status(2)='failed' AND pg_temp.b(2)->>'delivery_state'='blocked' AND pg_temp.b(2)->'delivery_late_event'->>'state'='delivered',
  'delivered after a blocked bounce does not resurrect it (kept as a late event)');
-- A second negative does not replace the first.
SELECT pg_temp.check_true(pg_temp.evm('k3','sgLeadTwo2',2,'dropped','lead.two@example.invalid','2027-10-31T10:07:00Z',NULL,'Bounced Address')='processed'
  AND pg_temp.j('k3')->>'delivery_effect'='stale_ignored' AND pg_temp.b(2)->>'delivery_state'='blocked',
  'the first terminal outcome wins');

-- Dropped.
SELECT pg_temp.check_true(pg_temp.evm('x1','sgDrop6',6,'dropped','client.three@example.invalid','2027-10-31T10:03:00Z',NULL,'Unsubscribed Address')='processed',
  'the dropped event is processed');
SELECT pg_temp.check_true(pg_temp.status(6)='failed' AND pg_temp.b(6)->>'delivery_state'='dropped' AND pg_temp.b(6)->>'delivery_reason'='Unsubscribed Address'
  AND (SELECT error FROM public.messages WHERE id=pg_temp.msg(6)) ILIKE '%PAIGE Email%',
  'dropped: status failed, delivery_state dropped, the provider reason kept');
-- Plain bounce (no type).
SELECT pg_temp.check_true(pg_temp.evm('x2','sgDefer9',9,'bounced','client.three@example.invalid','2027-10-31T10:03:00Z')='processed'
  AND pg_temp.status(9)='failed' AND pg_temp.b(9)->>'delivery_state'='bounced',
  'a bounce with no type: delivery_state bounced');
-- Spam report: delivered to the inbox; status deliberately NOT failed.
SELECT pg_temp.check_true(pg_temp.evm('s1','sgSpam7',7,'complained','client.three@example.invalid','2027-10-31T10:04:00Z')='processed'
  AND pg_temp.status(7)='sent' AND pg_temp.b(7)->>'delivery_state'='spam_reported',
  'a spam report: delivery_state spam_reported, status left as it was (the email arrived)');

-- X1: a binding that is not provider_accepted is never moved by an event, even with the stored id and
-- every claim matching (forged: message 10 accepted, then its binding marked failed).
RESET ROLE;
SELECT pg_temp.prep_a(10,'e5000000-0000-4000-8000-0000000c0003','client.three@example.invalid'); SELECT pg_temp.accept(10,'sgForged10');
UPDATE public.messages SET meta=jsonb_set(meta,'{comms_email_binding,state}','"failed"') WHERE id=pg_temp.msg(10);
-- X4: the stored message id and the binding's id disagree (forged: message 11's binding names another id).
SELECT pg_temp.prep_a(11,'e5000000-0000-4000-8000-0000000c0003','client.three@example.invalid'); SELECT pg_temp.accept(11,'sgForged11');
UPDATE public.messages SET meta=jsonb_set(meta,'{comms_email_binding,provider_message_id}','"sgSomethingElse11"') WHERE id=pg_temp.msg(11);
SET LOCAL ROLE service_role;
SELECT pg_temp.check_true(pg_temp.evm('x10','sgForged10',10,'delivered','client.three@example.invalid')='processed'
  AND pg_temp.j('x10')->>'correlation_reason'='not_provider_accepted' AND pg_temp.status(10)='sent'
  AND pg_temp.b(10)->>'delivery_state' IS NULL,
  'a binding that is not provider_accepted is refused (not_provider_accepted), nothing moves');
SELECT pg_temp.check_true(pg_temp.evm('x11','sgForged11',11,'delivered','client.three@example.invalid')='processed'
  AND pg_temp.j('x11')->>'correlation_reason'='binding_id_mismatch' AND pg_temp.status(11)='sent'
  AND pg_temp.b(11)->>'delivery_state' IS NULL,
  'a binding whose own provider id differs from the stored one is refused (binding_id_mismatch)');

-- ── 3. Settle a SendGrid send whose outcome was not read (ALL three claims + the recipient). ─────────
-- Negatives first, on the 'unknown' send 12: nothing may settle it.
SELECT pg_temp.check_true(pg_temp.evm('n1','sgSettle12',12,'delivered',NULL)='processed'
  AND pg_temp.j('n1')->>'correlation_reason'='recipient_mismatch',
  'settle: an event with no address cannot settle (the recipient is required here)');
SELECT pg_temp.check_true(pg_temp.evm('n2','sgSettle12',12,'delivered','someone.else@example.invalid')='processed'
  AND pg_temp.j('n2')->>'correlation_reason'='recipient_mismatch',
  'settle: another recipient cannot settle');
SELECT pg_temp.check_true(pg_temp.ev('n3','sgSettle12','delivered','client.three@example.invalid','2027-10-31T10:00:00Z',
    'e5000000-0000-4000-8000-00000000aaaa',pg_temp.op(12)::text)='processed'
  AND pg_temp.j('n3')->>'correlation_reason'='no_message',
  'settle: two claims out of three settle nothing (no message claim → no match)');
SELECT pg_temp.check_true(pg_temp.ev('n4','sgSettle12','delivered','client.three@example.invalid','2027-10-31T10:00:00Z',
    'e5000000-0000-4000-8000-00000000aaaa',pg_temp.op(14)::text,NULL,NULL,pg_temp.msg(12)::text)='processed'
  AND pg_temp.j('n4')->>'correlation_reason'='operation_mismatch',
  'settle: another send''s operation cannot settle');
SELECT pg_temp.check_true(pg_temp.ev('n5','sgSettle12','delivered','client.three@example.invalid','2027-10-31T10:00:00Z',
    'e5000000-0000-4000-8000-00000000bbbb',pg_temp.op(12)::text,NULL,NULL,pg_temp.msg(12)::text)='processed'
  AND pg_temp.j('n5')->>'correlation_reason'='tenant_mismatch',
  'settle: another business''s tenant claim cannot settle');
SELECT pg_temp.check_true(pg_temp.b(12)->>'state'='unknown' AND pg_temp.b(12)->>'provider_message_id' IS NULL
  AND (SELECT provider_message_id IS NULL AND status='draft' FROM public.messages WHERE id=pg_temp.msg(12)),
  'after every near-miss the unknown send is exactly as it was');
-- The settle.
SELECT pg_temp.check_true(pg_temp.evm('v12','sgSettle12',12,'delivered','Client.Three@example.invalid','2027-10-31T12:00:00Z')='processed'
  AND pg_temp.j('v12')->>'correlation'='correlated' AND pg_temp.j('v12')->>'correlation_reason'='settled_by_provider_event'
  AND pg_temp.j('v12')->>'delivery_effect'='delivered',
  'settle: all three claims + the recipient settle the unknown send and apply the event');
SELECT pg_temp.check_true(pg_temp.b(12)->>'state'='provider_accepted' AND pg_temp.b(12)->>'provider_message_id'='sgSettle12'
  AND pg_temp.b(12)->>'outcome_reason'='settled_by_provider_event' AND pg_temp.b(12)->>'settled_from_state'='unknown'
  AND (SELECT provider_message_id='sgSettle12' FROM public.messages WHERE id=pg_temp.msg(12))
  AND pg_temp.status(12)='delivered' AND (pg_temp.b(12)->>'delivery_confirmed')::boolean,
  'settled: binding provider_accepted with SendGrid''s id stored on binding and message; delivered because delivered was reported');
SELECT pg_temp.check_true(pg_temp.evm('o12','sgSettle12',12,'opened','client.three@example.invalid')='processed'
  AND pg_temp.j('o12')->>'correlation'='correlated' AND pg_temp.j('o12')->>'correlation_reason' IS NULL,
  'after the settle, the next event correlates by the stored id');
-- A dispatch that never finalized (claimed an hour ago) settles the same way; a bounce lands as failed.
SELECT pg_temp.check_true(pg_temp.evm('b14','sgSettle14',14,'bounced','client.three@example.invalid','2027-10-31T12:00:00Z','bounce','550 no such user')='processed'
  AND pg_temp.j('b14')->>'correlation_reason'='settled_by_provider_event'
  AND pg_temp.b(14)->>'settled_from_state'='dispatching' AND pg_temp.b(14)->>'state'='provider_accepted'
  AND pg_temp.status(14)='failed' AND pg_temp.b(14)->>'delivery_state'='bounced',
  'settle: a stale dispatching send is settled too, and a bounce marks it failed (never "delivered")');

-- Never settled, though all three claims and the address match (round-4 verifier finding 2).
SELECT pg_temp.check_true(pg_temp.evm('ns41','sgSettle41',41,'delivered','client.three@example.invalid')='processed'
  AND pg_temp.b(41)->>'state'='failed' AND pg_temp.j('ns41')->>'correlation'='uncorrelated' AND pg_temp.j('ns41')->>'correlation_reason'='not_provider_accepted',
  'settle: a FAILED SendGrid send is never settled by an event (not_provider_accepted)');
SELECT pg_temp.check_true(pg_temp.evm('ns42','sgSettle42',42,'delivered','client.three@example.invalid')='processed'
  AND pg_temp.b(42)->>'state'='refused' AND pg_temp.j('ns42')->>'correlation'='uncorrelated' AND pg_temp.j('ns42')->>'correlation_reason'='not_provider_accepted',
  'settle: a REFUSED SendGrid send is never settled by an event (not_provider_accepted)');
SELECT pg_temp.check_true(pg_temp.evm('ns43','sgSettle43',43,'delivered','client.three@example.invalid')='processed'
  AND pg_temp.b(43)->>'state'='unknown' AND pg_temp.j('ns43')->>'correlation'='uncorrelated' AND pg_temp.j('ns43')->>'correlation_reason'='provider_mismatch',
  'settle: a Resend send whose outcome is unknown is never settled by a SendGrid event (provider_mismatch)');
SELECT pg_temp.check_true(pg_temp.evm('ns44','sgSettle44',44,'delivered','client.three@example.invalid')='processed'
  AND pg_temp.b(44)->>'state'='unknown' AND pg_temp.b(44)->>'provider_message_id'='sgOther44' AND pg_temp.j('ns44')->>'correlation'='uncorrelated' AND pg_temp.j('ns44')->>'correlation_reason'='binding_id_mismatch',
  'settle: an unknown send whose binding already holds another provider id is not overwritten (binding_id_mismatch)');
SELECT pg_temp.check_true((SELECT v FROM snap WHERE label='never_settled') =
  (SELECT md5(string_agg(id::text||status||meta::text||coalesce(error,'')||coalesce(provider_message_id,''),'|' ORDER BY id))
     FROM public.messages WHERE id IN (pg_temp.msg(41),pg_temp.msg(42),pg_temp.msg(43),pg_temp.msg(44))),
  'settle: those four sends are byte-for-byte as they were (state, provider id, status)');

-- ── Early events (M3): the send is still being handed over → 'pending', nothing kept, bounded. ─────
SELECT pg_temp.check_true(pg_temp.evm('e15','sgEarly15',15,'delivered','client.three@example.invalid')='pending',
  'early: an event for a send still dispatching comes back pending');
SELECT pg_temp.check_true(pg_temp.j('e15') IS NULL
  AND NOT EXISTS (SELECT 1 FROM public.email_send_log WHERE metadata->>'receipt_id'='sg:e15')
  AND pg_temp.b(15)->>'state'='dispatching' AND pg_temp.b(15)->>'provider_message_id' IS NULL,
  'early: nothing of it is kept (no journal row, no log row, the send untouched), so the webhook answers 503 and SendGrid redelivers');
SELECT public.finalize_comms_email_send(pg_temp.msg(15),pg_temp.op(15),'provider_accepted','sgEarly15',NULL,(pg_temp.b(15)->>'attempts')::int);
SELECT pg_temp.check_true(pg_temp.evm('e15','sgEarly15',15,'delivered','client.three@example.invalid')='processed'
  AND pg_temp.j('e15')->>'correlation'='correlated' AND pg_temp.j('e15')->>'correlation_reason' IS NULL
  AND pg_temp.status(15)='delivered',
  'early: the redelivered event, after finalize stored the id, correlates and applies');
SELECT pg_temp.check_true(pg_temp.evm('p16','sgPrep16',16,'delivered','client.three@example.invalid')='pending'
  AND pg_temp.j('p16') IS NULL,
  'early: an event for a prepared (never dispatched) send is pending while the send is young');
RESET ROLE;
UPDATE public.messages SET meta=jsonb_set(meta,'{comms_email_binding,prepared_at}',to_jsonb(now()-interval '2 days')) WHERE id=pg_temp.msg(16);
SET LOCAL ROLE service_role;
SELECT pg_temp.check_true(pg_temp.evm('p16','sgPrep16',16,'delivered','client.three@example.invalid')='processed'
  AND pg_temp.j('p16')->>'correlation_reason'='not_dispatched' AND pg_temp.b(16)->>'state'='prepared',
  'bounded: after 24 h the same event is journalled uncorrelated (not_dispatched) and the send is untouched');

-- §59: the applier is not reachable by the service role; ingest refuses a signed-in subject in its body.
SELECT pg_temp.refused($$SELECT public._sendgrid_apply_governed_receipt('sgLeadOne1','delivered',NULL,NULL,NULL,NULL,NULL,NULL,NULL)$$,
  '42501','%permission denied%','service_role cannot call the receipt applier directly (only ingest can)');
SELECT set_config('request.jwt.claims','{"role":"service_role","sub":"e5000000-0000-4000-8000-000000000001"}',true);
SELECT pg_temp.refused($$SELECT public.ingest_sendgrid_receipt('sg:z1','sgLeadOne1','delivered')$$,
  '42501','SENDGRID_RECEIPT_FORBIDDEN%','ingest refuses a caller carrying a signed-in subject');
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
RESET ROLE;

-- The contact history follows a negative outcome, and only that (read as the owner of the table:
-- service_role holds no grant on communication_log, which is why the applier is SECURITY DEFINER).
SELECT pg_temp.check_true((SELECT status='bounced' AND error_message ILIKE '%blocked%' FROM public.communication_log WHERE message_id=pg_temp.msg(2))
  AND (SELECT status='sent' AND error_message IS NULL FROM public.communication_log WHERE message_id=pg_temp.msg(1)),
  'the blocked reply''s contact history row now says bounced; the delivered one (late bounce) still says sent');

SELECT pg_temp.check_true((SELECT v FROM snap WHERE label='untouched') =
  (SELECT md5(string_agg(id::text||status||meta::text||coalesce(error,''),'|' ORDER BY id)) FROM public.messages
    WHERE tenant_id IN ('e5000000-0000-4000-8000-00000000bbbb') OR id=pg_temp.msg(3)),
  'unrelated messages (the other business''s, and an email no event named) are byte-for-byte untouched');
SELECT pg_temp.check_true((SELECT count(*) FROM public.email_send_log WHERE sender_account='sendgrid' AND metadata->>'receipt_id' LIKE 'sg:%'
    AND metadata->>'receipt_id' IN ('sg:u1','sg:f1','sg:f2','sg:f3','sg:f4','sg:f5','sg:f6','sg:m1','sg:m2','sg:m3','sg:d1','sg:o1','sg:v1','sg:d2','sg:b9','sg:k1','sg:k2','sg:k3','sg:x1','sg:x2','sg:s1'))=21,
  'email_send_log keeps its behaviour: one appended row per processed event, correlated or not');
SELECT pg_temp.check_true(pg_temp.cl(1)=1 AND pg_temp.da(1)=1 AND pg_temp.cl(2)=1 AND pg_temp.da(2)=0,
  'receipts never add history rows (one per handed-over reply, still)');

-- A failing message step does not lose the event: it is journalled apply_failed and keeps its log row.
-- (The applier is replaced, inside this rolled-back transaction, by one that raises.)
CREATE OR REPLACE FUNCTION public._sendgrid_apply_governed_receipt(
  _sg_message_id text, _status text, _email text, _event_at timestamptz,
  _tenant_claim text, _operation_claim text, _message_claim text, _bounce_type text, _reason text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN RAISE EXCEPTION 'simulated applier failure'; END $$;
SET LOCAL ROLE service_role;
-- (The event runs in its own statement: a subquery in the same statement would not see its writes.)
SELECT pg_temp.check_true(pg_temp.evm('af1','sgSpam7',7,'opened','client.three@example.invalid')='processed',
  'an applier failure does not fail the event (processed)');
SELECT pg_temp.check_true(pg_temp.j('af1')->>'state'='processed' AND pg_temp.j('af1')->>'correlation'='apply_failed'
  AND pg_temp.j('af1')->>'correlation_reason'='apply_failed_p0001' AND pg_temp.j('af1')->>'delivery_effect'='apply_failed'
  AND EXISTS (SELECT 1 FROM public.email_send_log WHERE metadata->>'receipt_id'='sg:af1'),
  'an applier failure is contained: the event is journalled processed/apply_failed and its email_send_log row is kept');
RESET ROLE;

SELECT 'PAIGE_EMAIL_SENDGRID_RECEIPTS_PROVEN' AS result;
-- Current native counterparts are fresh real writer calls, not the historical DATA fixtures.
RESET ROLE;
SELECT pg_temp.as_service();
CREATE TEMP TABLE current_origin_probe(label text PRIMARY KEY,id uuid) ON COMMIT DROP;
INSERT INTO current_origin_probe VALUES ('980',pg_temp.reply_approval('e5000000-0000-4000-8000-00000000aaaa','e5000000-0000-4000-8000-0000000c0001','e5000000-0000-4000-8000-00000005ef80')),('981',pg_temp.reply_approval('e5000000-0000-4000-8000-00000000aaaa','e5000000-0000-4000-8000-0000000c0001','e5000000-0000-4000-8000-00000005ef81'));
SELECT pg_temp.prep_a(980,'e5000000-0000-4000-8000-0000000c0001','lead.one@example.invalid',(SELECT id FROM current_origin_probe WHERE label='980'));
SELECT pg_temp.check_true((SELECT b->>'origin_action_id'=a.id::text
 AND b->>'origin_action_kind'='owner.lead_followup' AND b->>'approval_id'=p.id::text
 FROM current_origin_probe p JOIN public.paige_actions a ON a.approval_id=p.id
 CROSS JOIN LATERAL (SELECT meta->'comms_email_binding' AS b FROM public.messages WHERE id=pg_temp.msg(980)) m
 WHERE p.label='980') AND (public.read_comms_email_send_binding(pg_temp.msg(980))->>'origin_eligible')::boolean,
 'fresh native prepare derives its exact own action seal and current origin readback');
SELECT pg_temp.check_true((public.claim_comms_email_send(pg_temp.msg(980),pg_temp.op(980))->>'admitted')::boolean,
 'fresh native sealed origin is admitted by the unchanged current claim');
SELECT public.finalize_comms_email_send(pg_temp.msg(980),pg_temp.op(980),'failed',NULL,'fixture_provider_refused',1);
SELECT pg_temp.prep_a(981,'e5000000-0000-4000-8000-0000000c0001','lead.one@example.invalid',(SELECT id FROM current_origin_probe WHERE label='981'));
-- Explicit old prepared-row DATA shape: remove the seal, never manufacture one or claim it historical success.
UPDATE public.messages SET meta=jsonb_set(meta,'{comms_email_binding}',
 (meta->'comms_email_binding')-ARRAY['origin_action_id','origin_action_kind']) WHERE id=pg_temp.msg(981);
SELECT pg_temp.check_true((public.claim_comms_email_send(pg_temp.msg(981),pg_temp.op(981))->>'admitted')::boolean IS FALSE,
 'legacy unsealed zero-attempt prepared origin receives no fresh admission');
SELECT pg_temp.check_true((SELECT meta#>>'{comms_email_binding,state}'='refused'
 AND (meta#>>'{comms_email_binding,attempts}')::int=0 AND provider_message_id IS NULL
 AND meta#>>'{comms_email_binding,provider_message_id}' IS NULL
 AND NOT (meta->'comms_email_binding' ? 'origin_action_id')
 AND NOT (meta->'comms_email_binding' ? 'origin_action_kind')
 FROM public.messages WHERE id=pg_temp.msg(981)),
 'unsealed refusal retains zero attempts, no provider outcome and no native identity backfill');
SELECT pg_temp.check_true((SELECT count(*)=6 AND bool_and(md5(p.prosrc)=s.expected_md5 AND pg_get_functiondef(p.oid)=s.definition)
 FROM current_comms_origin_contract s JOIN pg_proc p ON p.oid=s.function_oid),
 'proof exits with all six exact current native definitions; outer ROLLBACK alone cleans fixtures');

ROLLBACK;
