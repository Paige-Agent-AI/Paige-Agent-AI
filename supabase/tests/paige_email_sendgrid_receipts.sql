-- ISOLATED database only (local stack or CI clone); never execute on production.
-- Experience 03 · S3 — truthful PAIGE Email receipts and one connected history
-- (20271031000200_paige_email_sendgrid_receipts_and_history.sql).
--
-- Proves, through the REAL writers (file_action, advance_action, the governed email door's
-- prepare → claim → finalize, lead_reply_record_send_service, ingest_sendgrid_receipt):
--   0. The migration replays as a no-op; grants: ingest + applier service_role only, history helper and
--      trigger functions nobody; the old 5-arg ingest signature is gone (positional 5-arg calls still work).
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
--      email_send_log keeps one appended row per event.
--
-- Synthetic tenants and people only (§2/§63); one transaction that ROLLS BACK.
-- Run: psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/paige_email_sendgrid_receipts.sql
-- Governed SendGrid sends cannot be PREPARED yet (prepare_comms_email_send admits resend/gmail/smtp), so
-- fixtures send through the door with a Resend connector and then mark the accepted binding
-- provider='sendgrid' — exactly the row a SendGrid-admitting door will write. Stated, not hidden (§13).
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
\ir ../migrations/20271031000000_exp03_lead_reply_once_per_submission.sql
\ir ../migrations/20271031000200_paige_email_sendgrid_receipts_and_history.sql
\ir ../migrations/20271031000200_paige_email_sendgrid_receipts_and_history.sql

SELECT pg_temp.check_true(to_regprocedure('public.ingest_sendgrid_receipt(text,text,text,text,timestamptz)') IS NULL
  AND to_regprocedure('public.ingest_sendgrid_receipt(text,text,text,text,timestamptz,text,text,text,text,text)') IS NOT NULL,
  'ingest_sendgrid_receipt has exactly the 10-arg signature (the 5-arg one is replaced, not overloaded)');
SELECT pg_temp.check_true(has_function_privilege('service_role','public.ingest_sendgrid_receipt(text,text,text,text,timestamptz,text,text,text,text,text)','EXECUTE')
  AND NOT has_function_privilege('anon','public.ingest_sendgrid_receipt(text,text,text,text,timestamptz,text,text,text,text,text)','EXECUTE')
  AND NOT has_function_privilege('authenticated','public.ingest_sendgrid_receipt(text,text,text,text,timestamptz,text,text,text,text,text)','EXECUTE')
  AND has_function_privilege('service_role','public._sendgrid_apply_governed_receipt(text,text,text,timestamptz,text,text,text,text,text)','EXECUTE')
  AND NOT has_function_privilege('anon','public._sendgrid_apply_governed_receipt(text,text,text,timestamptz,text,text,text,text,text)','EXECUTE')
  AND NOT has_function_privilege('authenticated','public._sendgrid_apply_governed_receipt(text,text,text,timestamptz,text,text,text,text,text)','EXECUTE'),
  'ingest and the receipt applier: service_role only');
SELECT pg_temp.check_true(NOT has_function_privilege('anon','public._paige_email_record_lead_reply_history(uuid)','EXECUTE')
  AND NOT has_function_privilege('authenticated','public._paige_email_record_lead_reply_history(uuid)','EXECUTE')
  AND NOT has_function_privilege('service_role','public._paige_email_record_lead_reply_history(uuid)','EXECUTE')
  AND (SELECT bool_and(prosecdef AND array_to_string(proconfig,',') LIKE 'search_path=%') FROM pg_proc WHERE oid IN (
    'public._paige_email_record_lead_reply_history(uuid)'::regprocedure,'public._sendgrid_apply_governed_receipt(text,text,text,timestamptz,text,text,text,text,text)'::regprocedure,
    'public._paige_email_history_on_message()'::regprocedure,'public._paige_email_history_on_approval()'::regprocedure)),
  'the history helper is callable by no API role; every new DEFINER function pins search_path');
SELECT pg_temp.check_true((SELECT count(*)=1 FROM pg_trigger WHERE tgname='trg_paige_email_history_on_message' AND tgrelid='public.messages'::regclass)
  AND (SELECT count(*)=1 FROM pg_trigger WHERE tgname='trg_paige_email_history_on_approval' AND tgrelid='public.paige_pending_approvals'::regclass),
  'one history trigger on each side after a replay');

-- ── Fixtures ───────────────────────────────────────────────────────────────────────────────────────
INSERT INTO auth.users(id,email) VALUES
 ('e5000000-0000-4000-8000-000000000001','pe-receipts-owner-a@example.invalid'),
 ('e5000000-0000-4000-8000-000000000002','pe-receipts-owner-b@example.invalid');
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
 ('e5000000-0000-4000-8000-0000000c00b1','e5000000-0000-4000-8000-00000000bbbb','e5000000-0000-4000-8000-000000000002','Synthetic','Lead B','lead.b@example.invalid','E5B-1','new_lead','paige_form');
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
CREATE FUNCTION pg_temp.prep(n int,actor uuid,tenant uuid,contact uuid,recipient text,connector uuid,sender text) RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.prepare_comms_email_send(actor,tenant,pg_temp.op(n),contact,recipient,connector,sender,
  'Reply '||n,'Hi, thanks for writing in ('||n||').','<p>Hi, thanks for writing in ('||n||').</p>',
  encode(extensions.digest(convert_to(recipient||E'\n'||connector::text||E'\n'||'Reply '||n||E'\n'||'Hi, thanks for writing in ('||n||').','UTF8'),'sha256'),'hex'),
  jsonb_build_object('action','comms.email_send','contact_id',contact,'connector_id',connector,'subject','Reply '||n,'body','Hi, thanks for writing in ('||n||').'),
  jsonb_build_object('actor_user_id',actor,'tenant_id',tenant,'tool','comms_send_email','action','comms.email_send',
   'approval_channel','operator_card','approved_fingerprint','0123456789abcdef','decision_receipt_recorded',true)) $$;
CREATE FUNCTION pg_temp.prep_a(n int,contact uuid,recipient text) RETURNS jsonb LANGUAGE sql AS $$
 SELECT pg_temp.prep(n,'e5000000-0000-4000-8000-000000000001','e5000000-0000-4000-8000-00000000aaaa',contact,recipient,
   'e5000000-0000-4000-8000-0000000e000a','owner@a.example.invalid') $$;
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
CREATE FUNCTION pg_temp.b(n int) RETURNS jsonb LANGUAGE sql AS $$ SELECT meta->'comms_email_binding' FROM public.messages WHERE id=pg_temp.msg(n) $$;
CREATE FUNCTION pg_temp.status(n int) RETURNS text LANGUAGE sql AS $$ SELECT status FROM public.messages WHERE id=pg_temp.msg(n) $$;
CREATE FUNCTION pg_temp.cl(n int) RETURNS bigint LANGUAGE sql AS $$ SELECT count(*) FROM public.communication_log WHERE message_id=pg_temp.msg(n) $$;
CREATE FUNCTION pg_temp.da(n int) RETURNS bigint LANGUAGE sql AS $$
 SELECT count(*) FROM public.deal_activities WHERE type='lead_reply_email' AND payload->>'message_id'=pg_temp.msg(n)::text $$;

CREATE TEMP TABLE ap(label text PRIMARY KEY, id uuid) ON COMMIT DROP;
INSERT INTO ap VALUES
 ('one', pg_temp.reply_approval('e5000000-0000-4000-8000-00000000aaaa','e5000000-0000-4000-8000-0000000c0001','e5000000-0000-4000-8000-000000050001')),
 ('two', pg_temp.reply_approval('e5000000-0000-4000-8000-00000000aaaa','e5000000-0000-4000-8000-0000000c0002','e5000000-0000-4000-8000-000000050002')),
 ('b',   pg_temp.reply_approval('e5000000-0000-4000-8000-00000000bbbb','e5000000-0000-4000-8000-0000000c00b1','e5000000-0000-4000-8000-000000050003'));
SELECT pg_temp.check_true((SELECT count(*)=3 AND bool_and(id IS NOT NULL) FROM ap)
  AND (SELECT bool_and(status='pending') FROM public.paige_pending_approvals WHERE id IN (SELECT id FROM ap)),
  'fixture: three drafted lead replies, each a pending approval');
CREATE FUNCTION pg_temp.ap(l text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM ap WHERE label=l $$;

-- ── 1. History ─────────────────────────────────────────────────────────────────────────────────────
-- Order 1: the door finalizes, THEN the reply's approval is recorded (the approval-side trigger writes).
SELECT pg_temp.prep_a(1,'e5000000-0000-4000-8000-0000000c0001','lead.one@example.invalid');
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
SELECT pg_temp.prep_a(2,'e5000000-0000-4000-8000-0000000c0002','lead.two@example.invalid');
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
  'lead.b@example.invalid','e5000000-0000-4000-8000-0000000e000b','owner@b.example.invalid');
SELECT pg_temp.accept(5,'sgLeadB5');
SELECT public.lead_reply_record_send_service(pg_temp.ap('b'),pg_temp.op(5),'e5000000-0000-4000-8000-000000000002');
SELECT pg_temp.check_true((SELECT count(*)=1 FROM public.communication_log WHERE message_id=pg_temp.msg(5) AND tenant_id='e5000000-0000-4000-8000-00000000bbbb'),
  'business B''s history row carries business B');

-- More governed sends of business A for receipt outcomes.
SELECT pg_temp.prep_a(6,'e5000000-0000-4000-8000-0000000c0003','client.three@example.invalid'); SELECT pg_temp.accept(6,'sgDrop6');
SELECT pg_temp.prep_a(7,'e5000000-0000-4000-8000-0000000c0003','client.three@example.invalid'); SELECT pg_temp.accept(7,'sgSpam7');
SELECT pg_temp.prep_a(8,'e5000000-0000-4000-8000-0000000c0003','client.three@example.invalid'); SELECT pg_temp.accept(8,'resendId8',false);
SELECT pg_temp.prep_a(9,'e5000000-0000-4000-8000-0000000c0003','client.three@example.invalid'); SELECT pg_temp.accept(9,'sgDefer9');

-- ── 2. Receipts (as the webhook's real role) ───────────────────────────────────────────────────────
CREATE TEMP TABLE snap(label text PRIMARY KEY, v text) ON COMMIT DROP;
GRANT ALL ON snap, ap TO service_role;
-- Every message the receipts below may NOT touch: business B's, and A's message 3 (never addressed).
INSERT INTO snap SELECT 'untouched', md5(string_agg(id::text||status||meta::text||coalesce(error,''),'|' ORDER BY id))
  FROM public.messages WHERE tenant_id IN ('e5000000-0000-4000-8000-00000000bbbb') OR id=pg_temp.msg(3);
-- Named arguments, exactly as the webhook calls it through PostgREST.
CREATE FUNCTION pg_temp.ev(eid text,sg text,st text,email text DEFAULT NULL,at timestamptz DEFAULT '2027-10-31T10:00:00Z',
  tenant text DEFAULT NULL,op text DEFAULT NULL,btype text DEFAULT NULL,reason text DEFAULT NULL,msgref text DEFAULT NULL) RETURNS text LANGUAGE sql AS $$
 SELECT public.ingest_sendgrid_receipt(_receipt_id=>'sg:'||eid,_message_id=>sg,_status=>st,_email=>email,_event_at=>at,
   _tenant_id=>tenant,_operation_id=>op,_paige_message_id=>msgref,_bounce_type=>btype,_reason=>reason) $$;
CREATE FUNCTION pg_temp.j(eid text) RETURNS jsonb LANGUAGE sql AS $$
 SELECT to_jsonb(r) FROM public.sendgrid_receipt_processing r WHERE receipt_id='sg:'||eid $$;

SET LOCAL ROLE service_role;
-- Uncorrelated: an id no message carries.
SELECT pg_temp.check_true(pg_temp.ev('u1','sgUnknownZZ','delivered','someone@example.invalid')='processed'
  AND pg_temp.j('u1')->>'correlation'='uncorrelated' AND pg_temp.j('u1')->>'correlation_reason'='no_message'
  AND pg_temp.j('u1')->>'correlated_message_id' IS NULL,
  'an event for no known message is journalled uncorrelated (no_message) and changes nothing');
-- Cross-tenant custom_args forgery: business A's message id, business B's tenant.
SELECT pg_temp.check_true(pg_temp.ev('f1','sgLeadOne1','delivered','lead.one@example.invalid','2027-10-31T10:00:00Z','e5000000-0000-4000-8000-00000000bbbb')='processed'
  AND pg_temp.j('f1')->>'correlation_reason'='tenant_mismatch' AND pg_temp.b(1)->>'delivery_state' IS NULL AND pg_temp.status(1)='sent',
  'a custom_args tenant that is not the message''s business is refused (tenant_mismatch), nothing moves');
SELECT pg_temp.check_true(pg_temp.ev('f2','sgLeadOne1','delivered','lead.one@example.invalid','2027-10-31T10:00:00Z',NULL,pg_temp.op(5)::text)='processed'
  AND pg_temp.j('f2')->>'correlation_reason'='operation_mismatch' AND pg_temp.status(1)='sent',
  'a custom_args operation that is not the message''s operation is refused (operation_mismatch)');
SELECT pg_temp.check_true(pg_temp.ev('f3','sgLeadOne1','delivered','not.the.lead@example.invalid')='processed'
  AND pg_temp.j('f3')->>'correlation_reason'='recipient_mismatch' AND pg_temp.status(1)='sent',
  'an event for another recipient is refused (recipient_mismatch)');
SELECT pg_temp.check_true(pg_temp.ev('f4','sgLeadOne1','delivered','lead.one@example.invalid','2027-10-31T10:00:00Z','not-a-uuid')='processed'
  AND pg_temp.j('f4')->>'correlation_reason'='tenant_mismatch',
  'a malformed tenant claim is refused, not ignored');
SELECT pg_temp.check_true(pg_temp.ev('f6','sgLeadOne1','delivered','lead.one@example.invalid','2027-10-31T10:00:00Z',NULL,NULL,NULL,NULL,pg_temp.msg(5)::text)='processed'
  AND pg_temp.j('f6')->>'correlation_reason'='message_mismatch' AND pg_temp.status(1)='sent',
  'a custom_args message id that names another message (here: business B''s) is refused (message_mismatch)');
SELECT pg_temp.check_true(pg_temp.ev('f5','resendId8','delivered','client.three@example.invalid')='processed'
  AND pg_temp.j('f5')->>'correlation_reason'='provider_mismatch' AND pg_temp.status(8)='sent',
  'a SendGrid event never updates an email another provider accepted (provider_mismatch)');

-- Deferred: no delivery claim, status unchanged.
SELECT pg_temp.check_true(pg_temp.ev('d1','sgLeadOne1','delivery_delayed','lead.one@example.invalid','2027-10-31T10:01:00Z',
    'e5000000-0000-4000-8000-00000000aaaa',pg_temp.op(1)::text,NULL,'421 try again later for lead.one@example.invalid')='processed'
  AND pg_temp.j('d1')->>'correlation'='correlated' AND pg_temp.j('d1')->>'delivery_effect'='deferred'
  AND pg_temp.b(1)->>'delivery_state'='deferred' AND pg_temp.status(1)='sent'
  AND coalesce((pg_temp.b(1)->>'delivery_confirmed')::boolean,false)=false
  AND pg_temp.b(1)->>'delivery_reason' NOT LIKE '%@%' AND pg_temp.b(1)->>'delivery_reason' LIKE '%[address]%',
  'deferred (with matching custom_args): delivery_state deferred, status still sent, no delivery claim, no address kept');
-- Open / click: no claim.
SELECT pg_temp.check_true(pg_temp.ev('o1','sgLeadOne1','opened','lead.one@example.invalid')='processed'
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
SELECT pg_temp.check_true(pg_temp.ev('d2','sgLeadOne1','delivery_delayed','lead.one@example.invalid','2027-10-31T10:00:30Z')='processed'
  AND pg_temp.j('d2')->>'delivery_effect'='stale_ignored' AND pg_temp.status(1)='delivered' AND pg_temp.b(1)->>'delivery_state'='delivered',
  'a stale deferred after delivered stays delivered');
-- Bounce after delivered: delivered stands; the late report is kept.
SELECT pg_temp.check_true(pg_temp.ev('b9','sgLeadOne1','bounced','lead.one@example.invalid','2027-10-31T11:00:00Z',NULL,NULL,'bounce','550 mailbox gone')='processed'
  AND pg_temp.j('b9')->>'delivery_effect'='late_event_recorded' AND pg_temp.status(1)='delivered'
  AND (pg_temp.b(1)->>'delivery_confirmed')::boolean AND pg_temp.b(1)->'delivery_late_event'->>'state'='bounced'
  AND pg_temp.b(1)->'delivery_late_event'->>'reason'='550 mailbox gone',
  'a bounce after delivered is recorded as a late event; delivered stands');

-- Blocked bounce on Lead Two's reply: failed + blocked + reason; its contact history follows.
-- (The ingest runs in its own statement: a plain subquery in the SAME statement reads the statement's
-- snapshot and would not see the write.)
SELECT pg_temp.check_true(pg_temp.ev('k1','sgLeadTwo2','bounced','lead.two@example.invalid','2027-10-31T10:05:00Z',
    'e5000000-0000-4000-8000-00000000aaaa',pg_temp.op(2)::text,'blocked','554 5.7.1 <lead.two@example.invalid>: blocked by policy')='processed',
  'the blocked bounce is processed');
SELECT pg_temp.check_true(pg_temp.status(2)='failed' AND pg_temp.b(2)->>'delivery_state'='blocked'
  AND coalesce((pg_temp.b(2)->>'delivery_confirmed')::boolean,true)=false
  AND pg_temp.b(2)->>'delivery_reason'='554 5.7.1 <[address]>: blocked by policy'
  AND (SELECT error FROM public.messages WHERE id=pg_temp.msg(2)) ILIKE '%blocked%'
  AND (SELECT error FROM public.messages WHERE id=pg_temp.msg(2)) NOT ILIKE '%sendgrid%'
  AND (SELECT status='bounced' FROM public.email_send_log WHERE metadata->>'receipt_id'='sg:k1'),
  'a blocked bounce: status failed, delivery_state blocked, safe reason, plain words; email_send_log unchanged in shape');
-- Delivered after a failure does not resurrect it.
SELECT pg_temp.check_true(pg_temp.ev('k2','sgLeadTwo2','delivered','lead.two@example.invalid','2027-10-31T10:06:00Z')='processed'
  AND pg_temp.status(2)='failed' AND pg_temp.b(2)->>'delivery_state'='blocked' AND pg_temp.b(2)->'delivery_late_event'->>'state'='delivered',
  'delivered after a blocked bounce does not resurrect it (kept as a late event)');
-- A second negative does not replace the first.
SELECT pg_temp.check_true(pg_temp.ev('k3','sgLeadTwo2','dropped','lead.two@example.invalid','2027-10-31T10:07:00Z',NULL,NULL,NULL,'Bounced Address')='processed'
  AND pg_temp.j('k3')->>'delivery_effect'='stale_ignored' AND pg_temp.b(2)->>'delivery_state'='blocked',
  'the first terminal outcome wins');

-- Dropped.
SELECT pg_temp.check_true(pg_temp.ev('x1','sgDrop6','dropped','client.three@example.invalid','2027-10-31T10:03:00Z',NULL,NULL,NULL,'Unsubscribed Address')='processed',
  'the dropped event is processed');
SELECT pg_temp.check_true(pg_temp.status(6)='failed' AND pg_temp.b(6)->>'delivery_state'='dropped' AND pg_temp.b(6)->>'delivery_reason'='Unsubscribed Address'
  AND (SELECT error FROM public.messages WHERE id=pg_temp.msg(6)) ILIKE '%PAIGE Email%',
  'dropped: status failed, delivery_state dropped, the provider reason kept');
-- Plain bounce (no type).
SELECT pg_temp.check_true(pg_temp.ev('x2','sgDefer9','bounced','client.three@example.invalid','2027-10-31T10:03:00Z')='processed'
  AND pg_temp.status(9)='failed' AND pg_temp.b(9)->>'delivery_state'='bounced',
  'a bounce with no type: delivery_state bounced');
-- Spam report: delivered to the inbox; status deliberately NOT failed.
SELECT pg_temp.check_true(pg_temp.ev('s1','sgSpam7','complained','client.three@example.invalid','2027-10-31T10:04:00Z')='processed'
  AND pg_temp.status(7)='sent' AND pg_temp.b(7)->>'delivery_state'='spam_reported',
  'a spam report: delivery_state spam_reported, status left as it was (the email arrived)');
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
    AND metadata->>'receipt_id' IN ('sg:u1','sg:f1','sg:f2','sg:f3','sg:f4','sg:f5','sg:f6','sg:d1','sg:o1','sg:v1','sg:d2','sg:b9','sg:k1','sg:k2','sg:k3','sg:x1','sg:x2','sg:s1'))=18,
  'email_send_log keeps its behaviour: one appended row per processed event, correlated or not');
SELECT pg_temp.check_true(pg_temp.cl(1)=1 AND pg_temp.da(1)=1 AND pg_temp.cl(2)=1 AND pg_temp.da(2)=0,
  'receipts never add history rows (one per handed-over reply, still)');

SELECT 'PAIGE_EMAIL_SENDGRID_RECEIPTS_PROVEN' AS result;
ROLLBACK;
