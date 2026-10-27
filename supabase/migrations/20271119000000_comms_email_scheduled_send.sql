-- "Approve now, send later" for the governed email door (comms.email_send, INT-328).
--
-- A person approves ONE governed email with a send time. The door prepares the same bound messages row
-- an immediate send prepares, then this overload marks it scheduled: binding.send_at (canonical text,
-- exactly Date#toISOString: YYYY-MM-DDTHH:MM:SS.mmmZ), messages.status='queued',
-- messages.scheduled_for=send_at. Nothing is sent at prepare. The existing scheduled drainer leases the
-- due row (claim_due_scheduled_messages, §10 below) and hands it to releaseScheduledCommsEmail, which asks
-- send-message to send exactly the bound row; send-message's claim (below) admits it only once due.
-- Chat and drafted lead replies keep sending immediately through the unchanged 13-argument prepare.
--
-- What this file changes, and only this:
--  1. NEW _comms_email_seat(actor, tenant) — _comms_email_actor minus ONLY its profiles.active_tenant_id
--     check: the scheduler still exists and is not banned, the business is trial/active/past_due, and
--     they still hold an ACTIVE owner/admin seat. A release days later must not depend on which
--     business the person happens to have open.
--  2. NEW _comms_email_release_actor(binding, tenant) — the seat check when the binding has send_at AND
--     it is due; _comms_email_actor, unchanged, otherwise (every immediate send, and a scheduled one
--     before its time).
--  3. NEW prepare_comms_email_send(<the 13 args>, _send_at timestamptz) — an overload with NO default,
--     so PostgREST picks it only when `_send_at` is named (the adapter names it only for a scheduled
--     call). It validates the time, refuses a drafted lead reply (approval_id) or an agreement send,
--     takes the 13-argument body's own per-operation advisory lock (hashtextextended(op, 32847) —
--     confirmed in the live body), refuses a replay whose stored send_at differs (including none),
--     calls the UNCHANGED 13-argument function, and marks a fresh row scheduled.
--  4. read_comms_email_send_result — additionally returns send_at when the binding has one.
--  5. read_comms_email_send_binding — the actor check becomes _comms_email_release_actor.
--  6. claim_comms_email_send — the actor check becomes _comms_email_release_actor; a scheduled binding
--     whose time has not come answers {admitted:false, not_before} before anything is locked; the
--     admission UPDATE moves a 'queued' row to 'draft' (so a send finalized 'unknown' is never leased
--     by the drainer again and never cancellable as an ordinary queued draft).
--  7. NEW close_scheduled_comms_email(message, operation, reason, closing_actor) — the ONE close of a
--     scheduled governed email that never went out (see "Why not finalize_comms_email_send" below).
--  8. NEW cancel_comms_email_send(actor, tenant, operation) — any active owner/admin of the business
--     with it open (_comms_email_actor) may cancel a scheduled operation still 'prepared': it is closed
--     refused `cancelled_by_owner` through (7) with the canceller as the closing actor. Once a claim has
--     taken it, the answer is {cancelled:false, outcome:<state>}.
--  9. NEW close_missed_scheduled_comms_emails(limit) — the drainer's sweep: every governed row still
--     'prepared' and 'queued' more than the release grace (15 min) after its time is closed
--     `scheduled_release_missed` through (7). Per row, so one bad row cannot stop the rest.
-- 10. claim_due_scheduled_messages — the drainer's lease, with two exclusions and nothing else changed:
--     (a) a governed row past its release grace is never leased again (the sweep (9) closes it instead,
--         so stuck rows can no longer fill the LIMIT ahead of every other business's sends);
--     (b) a row the provider floor would refuse — exactly the a00_comms_provider_message_queue check
--         (a kill-switched, archived or paused business, or a restricted recipient) — is not selected.
--         Before, that trigger aborted this function's single UPDATE, so ONE such business made the
--         drain fail (claim_failed) for EVERY business.
-- 11. NEW unlease_scheduled_messages(ids, stamp) — the drainer hands back leases on rows it did not reach
--     inside its run-time budget, so they are picked up next minute instead of five minutes later.
-- 12. cancel_scheduled_message — never touches a governed row (AND NOT (meta ? 'comms_email_binding')).
--
-- Why not finalize_comms_email_send for closing a scheduled send (owner-visible terminal state, ALWAYS):
--   finalize records the Rail through record_capability_run, which refuses (CAPABILITY_RUN_FORBIDDEN) an
--   actor with no ACTIVE membership. A scheduled send whose scheduler has left the business could then
--   never be cancelled or closed: it would sit "Scheduled · Cancel", be re-leased every five minutes and,
--   in numbers, starve every business's scheduled sends. close_scheduled_comms_email performs exactly
--   finalize's unclaimed prepared -> refused writes (binding state/finalized_at/outcome_reason, status
--   'blocked', error = the code) plus scheduled_for = NULL, and records the Rail against, in order: the
--   closing person (a canceller — the Rail names who cancelled), else the scheduler while they are still
--   an active member, else NOBODY. In that last case no Rail row can honestly be attributed to anyone, so
--   none is invented: the close still happens and its paige_audit_log row says rail_recorded=false with
--   rail_unrecorded_reason='no_active_member_to_attribute'. Every close writes exactly one audit row
--   (comms.email_scheduled_cancelled for a cancel, comms.email_scheduled_closed otherwise). It only ever
--   closes a SCHEDULED binding still 'prepared' — never an immediate send, never one a claim has taken.
--   The closing actor is attribution only (service-role callers; it grants nothing) and is used only when
--   it is an active member of the row's business.
--
-- Every other check in the replaced bodies is byte-identical to the live bodies pinned below (claim and
-- read_binding: 20271114230204; read_result: 20270597000000; cancel_scheduled_message: the body
-- 20270504000000 rewrote from 20260726211000; claim_due_scheduled_messages: 20260726211000). §59: every
-- new function is SECURITY DEFINER with a pinned search_path and service_role-only; each re-proves its
-- actor in its own body where it has one.
--
-- HONEST RESIDUALS (§13):
--  * The release re-checks recipient preferences at send time; a quiet-hours / do-not-disturb hold at
--    that moment closes the scheduled send as refused with that reason (it is not re-queued).
--  * A business that is kill-switched / archived / paused is never leased. Its governed rows are closed
--    as missed by the sweep once their grace passes, whatever the business's state. Its ordinary
--    (non-governed) queued rows stay queued with no terminal state until it is re-enabled.
BEGIN;
SET LOCAL lock_timeout='3s';
DO $guard$
DECLARE expected record; actual text;
BEGIN
 -- Bodies this file calls and does NOT replace: exactly the live ones.
 FOR expected IN SELECT * FROM (VALUES
  ('public._comms_email_actor(uuid,uuid)','c9850c30ae7885c23eee1da268c8c0e0'),
  ('public.prepare_comms_email_send(uuid,uuid,uuid,uuid,text,uuid,text,text,text,text,text,jsonb,jsonb)','8da3b64c24552123b973db96a74ab986'),
  ('public.finalize_comms_email_send(uuid,uuid,text,text,text,integer)','2d66695eb8e42f5e9232e839e05d090a')
 ) AS dependencies(identity,body) LOOP
  SELECT pg_catalog.md5(prosrc) INTO actual FROM pg_catalog.pg_proc WHERE oid=to_regprocedure(expected.identity);
  IF NOT FOUND OR actual IS DISTINCT FROM expected.body THEN
   RAISE EXCEPTION 'Scheduled email dependency % changed; reconcile before applying',expected.identity USING ERRCODE='23514'; END IF;
 END LOOP;
 -- Bodies this file replaces: the live one, or this file's own (a re-apply is a no-op).
 FOR expected IN SELECT * FROM (VALUES
  ('public.read_comms_email_send_result(uuid,uuid,uuid)','ae501d698cd16e0e128079b0c6566bae','d12d25b1d3859f5383dfde5bf4106060'),
  ('public.read_comms_email_send_binding(uuid)','6bc0d581e141cfaf0221002d71564eaa','7cdafa1530f75a2d7c02b08f5c6ccc7d'),
  ('public.claim_comms_email_send(uuid,uuid,boolean)','7b1173ff7d53da5836e33c2d77366c77','a9dfb75621838268a961152d19de954d'),
  ('public.cancel_scheduled_message(uuid)','0d767250452d8a29858b4152c4b71fcd','c1fbef56be124fd68cc916dd54593f1c'),
  ('public.claim_due_scheduled_messages(integer)','9d4c0ba5e8fb7acd648a5900aa218d13','6f73777a47948368222f1d0e216fa325')
 ) AS replaced(identity,prior_body,own_body) LOOP
  SELECT pg_catalog.md5(prosrc) INTO actual FROM pg_catalog.pg_proc WHERE oid=to_regprocedure(expected.identity);
  IF NOT FOUND OR actual NOT IN (expected.prior_body,expected.own_body) THEN
   RAISE EXCEPTION 'Scheduled email source % changed; reconcile before applying',expected.identity USING ERRCODE='23514'; END IF;
 END LOOP;
END $guard$;

-- 1. The seat alone. Same facts, same FOR SHARE holds and the same refusal codes as
--    _comms_email_actor, without the "this business is the one open" check.
CREATE OR REPLACE FUNCTION public._comms_email_seat(_actor uuid,_tenant uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF _actor IS NULL OR _tenant IS NULL THEN RAISE EXCEPTION 'COMMS_EMAIL_AUTHORITY_UNAVAILABLE' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM auth.users WHERE id=_actor AND deleted_at IS NULL AND (banned_until IS NULL OR banned_until<=now()) FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'COMMS_EMAIL_ACTOR_UNAVAILABLE' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.tenants WHERE id=_tenant AND status IN ('trial','active','past_due') FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'COMMS_EMAIL_WORKSPACE_UNAVAILABLE' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.tenant_members WHERE user_id=_actor AND tenant_id=_tenant AND status='active' AND role IN ('owner','admin') FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'COMMS_EMAIL_AUTHORITY_UNAVAILABLE' USING ERRCODE='42501'; END IF;
END $$;

-- 2. Which actor check a binding read/claim needs. Only a scheduled binding that is DUE is released on
--    the seat alone; before its time, and for every immediate send, the full actor check is unchanged.
CREATE OR REPLACE FUNCTION public._comms_email_release_actor(_binding jsonb,_tenant uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF _binding->>'send_at' IS NOT NULL AND (_binding->>'send_at')::timestamptz<=now() THEN
  PERFORM public._comms_email_seat((_binding->>'actor_user_id')::uuid,_tenant);
 ELSE
  PERFORM public._comms_email_actor((_binding->>'actor_user_id')::uuid,_tenant);
 END IF;
END $$;

-- 3. The scheduled prepare. No default on _send_at: an immediate call can never land here.
CREATE OR REPLACE FUNCTION public.prepare_comms_email_send(_actor_user_id uuid,_expected_tenant_id uuid,_operation_id uuid,_contact_id uuid,_recipient text,_connector_id uuid,_from_address text,_subject text,_body_text text,_body_html text,_content_digest text,_command jsonb,_governance jsonb,_send_at timestamptz) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE m public.messages%ROWTYPE; r jsonb; send_at_text text;
BEGIN
 PERFORM public._comms_email_actor(_actor_user_id,_expected_tenant_id);
 -- A whole minute, at least 30 s ahead (the door asks for 2 min when the card is raised and refuses
 -- under 60 s at confirm), at most 30 days (+10 min: a card raised at the limit may be confirmed later).
 IF _send_at IS NULL OR _send_at IS DISTINCT FROM (date_trunc('minute',_send_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')
  OR _send_at<now()+interval '30 seconds' OR _send_at>now()+interval '30 days 10 minutes' THEN
  RAISE EXCEPTION 'COMMS_EMAIL_SEND_AT_INVALID' USING ERRCODE='22023';
 END IF;
 -- A drafted lead reply (one send per approval, recorded when accepted) and an agreement's signing
 -- request are answered now; neither is scheduled.
 IF _governance->>'purpose' IS NOT DISTINCT FROM 'agreement_signature_request' OR coalesce(btrim(_governance->>'approval_id'),'')<>'' THEN
  RAISE EXCEPTION 'COMMS_EMAIL_SCHEDULE_NOT_SUPPORTED' USING ERRCODE='22023';
 END IF;
 IF _operation_id IS NULL THEN RAISE EXCEPTION 'COMMS_EMAIL_CONTENT_INVALID' USING ERRCODE='22023'; END IF;
 send_at_text:=to_char(_send_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
 -- The 13-argument body's own lock (re-entrant here): the replay read below and its insert serialize.
 PERFORM pg_advisory_xact_lock(hashtextextended(_operation_id::text,32847));
 SELECT * INTO m FROM public.messages WHERE meta#>>'{comms_email_binding,operation_id}'=_operation_id::text;
 IF FOUND AND m.meta#>>'{comms_email_binding,send_at}' IS DISTINCT FROM send_at_text THEN
  RAISE EXCEPTION 'COMMS_EMAIL_REPLAY_MISMATCH' USING ERRCODE='22023';
 END IF;
 r:=public.prepare_comms_email_send(_actor_user_id,_expected_tenant_id,_operation_id,_contact_id,_recipient,_connector_id,
   _from_address,_subject,_body_text,_body_html,_content_digest,_command,_governance);
 IF r->'replayed' IS DISTINCT FROM 'true'::jsonb THEN
  UPDATE public.messages SET status='queued',scheduled_for=_send_at,
    meta=jsonb_set(meta,'{comms_email_binding,send_at}',to_jsonb(send_at_text))
   WHERE id=(r->>'message_id')::uuid AND status='draft'
    AND meta#>>'{comms_email_binding,operation_id}'=_operation_id::text AND meta#>>'{comms_email_binding,state}'='prepared';
  IF NOT FOUND THEN RAISE EXCEPTION 'COMMS_EMAIL_SCHEDULE_UNAVAILABLE' USING ERRCODE='55000'; END IF;
 END IF;
 RETURN r||jsonb_build_object('send_at',send_at_text);
END $$;

-- 4. The result read, plus send_at when the binding has one. Otherwise verbatim 20270597000000.
CREATE OR REPLACE FUNCTION public.read_comms_email_send_result(_actor_user_id uuid,_expected_tenant_id uuid,_operation_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE m public.messages%ROWTYPE; b jsonb;
BEGIN
 PERFORM public._comms_email_actor(_actor_user_id,_expected_tenant_id);
 SELECT * INTO m FROM public.messages WHERE meta#>>'{comms_email_binding,operation_id}'=_operation_id::text;
 IF NOT FOUND THEN RETURN NULL; END IF;
 b:=m.meta->'comms_email_binding';
 IF m.tenant_id IS DISTINCT FROM _expected_tenant_id OR b->>'actor_user_id' IS DISTINCT FROM _actor_user_id::text THEN
  RAISE EXCEPTION 'COMMS_EMAIL_REPLAY_MISMATCH' USING ERRCODE='22023';
 END IF;
 RETURN jsonb_build_object('ok',b->>'state'='provider_accepted','outcome',b->>'state','operation_id',_operation_id,'message_id',m.id,
  'provider_receipt_available',m.provider_message_id IS NOT NULL AND b->>'state'='provider_accepted','delivery_confirmed',false,
  'prepared_at',b->'prepared_at','attempts',coalesce((b->>'attempts')::int,0),'provider',b->>'provider',
  'reconcilable',public._comms_email_reconcilable(b))
  -- The reason is code-shaped by construction (finalize keeps nothing else), so a failure carries its
  -- cause to Chat exactly like a refusal does ("safe to ask again" vs "check the email setup").
  ||CASE WHEN b->>'state' IN ('refused','failed') AND b->>'outcome_reason' IS NOT NULL THEN jsonb_build_object('reason',b->>'outcome_reason') ELSE '{}'::jsonb END
  -- A scheduled operation names its time, so the door answers "scheduled", never a prepared recovery.
  ||CASE WHEN b->>'send_at' IS NOT NULL THEN jsonb_build_object('send_at',b->>'send_at') ELSE '{}'::jsonb END;
END $$;

-- 5. The binding read: _comms_email_release_actor instead of _comms_email_actor. Otherwise verbatim 20271114230204.
CREATE OR REPLACE FUNCTION public.read_comms_email_send_binding(_message_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE m public.messages%ROWTYPE; c public.channel_connectors%ROWTYPE; b jsonb;
 ap public.paige_pending_approvals%ROWTYPE; a public.paige_actions%ROWTYPE;
 approval uuid; origin uuid; named uuid; origin_ok boolean:=true;
 agreement_source jsonb;
BEGIN
 SELECT * INTO m FROM public.messages WHERE id=_message_id;
 b:=m.meta->'comms_email_binding'; IF b IS NULL THEN RETURN NULL; END IF;
 PERFORM public._comms_email_release_actor(b,m.tenant_id);
 -- Source is resolved BEFORE the message lock; claim takes the same parent
 -- first. Terminal history is never fresh permission or a re-send.
 IF b#>>'{governance,purpose}'='agreement_signature_request' THEN
  agreement_source:=private.e04_agreement_email_binding(b,b->>'state' IN ('prepared','dispatching'));
 END IF;
 -- Only a fresh prepared admission needs pending-origin eligibility. Original admitted outcomes
 -- and the incumbent bounded same-operation reconciliation do not acquire fresh approval authority.
 IF b->>'approval_id' IS NOT NULL AND b->>'state'='prepared' THEN
  BEGIN approval:=(b->>'approval_id')::uuid; origin:=(b->>'origin_action_id')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN approval:=NULL; origin:=NULL; END;
  SELECT * INTO ap FROM public.paige_pending_approvals WHERE id=approval FOR UPDATE;
  SELECT * INTO a FROM public.paige_actions WHERE id=origin FOR UPDATE;
  BEGIN named:=nullif(btrim(ap.metadata->>'action_id'),'')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN named:=NULL; END;
  origin_ok:=coalesce(ap.id IS NOT NULL AND origin IS NOT NULL AND a.id=origin AND named=origin
   AND ap.tenant_id=m.tenant_id AND a.tenant_id=m.tenant_id AND a.approval_id=ap.id
   AND a.contact_id=m.contact_id AND (ap.contact_id IS NULL OR ap.contact_id=m.contact_id)
   AND ap.status='pending' AND a.status IN ('drafted','pending_approval')
   AND a.action_kind IN ('owner.lead_followup','client.followup','owner.followup_email')
   AND a.action_kind=b->>'origin_action_kind'
   AND EXISTS (SELECT 1 FROM public.paige_action_kinds k WHERE k.slug=a.action_kind AND k.executor='send_via_approval')
   AND (SELECT count(*) FROM public.paige_actions x WHERE x.approval_id=ap.id)=1,false);
 END IF;
 -- Re-read after any origin-lock wait; a concurrent winning claim may have advanced state.
 SELECT * INTO m FROM public.messages WHERE id=_message_id FOR UPDATE;
 IF ((m.meta->'comms_email_binding')-ARRAY['state','attempts','claimed_at','finalized_at','provider_message_id','outcome_reason'])
  IS DISTINCT FROM (b-ARRAY['state','attempts','claimed_at','finalized_at','provider_message_id','outcome_reason']) THEN
  RAISE EXCEPTION 'COMMS_EMAIL_BINDING_CHANGED' USING ERRCODE='40001';
 END IF;
 b:=m.meta->'comms_email_binding';
 IF b->>'state' IS DISTINCT FROM 'prepared' THEN origin_ok:=true; END IF;
 SELECT * INTO c FROM public.channel_connectors WHERE id=m.connector_id AND tenant_id=m.tenant_id FOR SHARE;
 -- Recheck the ORIGINAL lease/approval after any connector wait. The parent
 -- agreement lock was acquired above; this adds no inverse message->parent lock.
 IF agreement_source IS NOT NULL THEN
  agreement_source:=private.e04_agreement_email_binding(b,b->>'state' IN ('prepared','dispatching'));
 END IF;
 RETURN b||jsonb_build_object('message_id',m.id,'tenant_id',m.tenant_id,'channel_type',m.channel_type,'message_status',m.status,
  'origin_eligible',origin_ok,'eligible',origin_ok AND m.channel_type='email' AND m.direction='outbound'
   AND m.tenant_id::text=b->>'tenant_id' AND m.contact_id::text=b->>'contact_id' AND m.connector_id::text=b->>'connector_id'
   AND m.subject IS NOT DISTINCT FROM b->>'subject' AND m.body_html IS NOT DISTINCT FROM b->>'body_html'
   AND m.recipients->0->>'address' IS NOT DISTINCT FROM b->>'recipient'
   AND coalesce(c.active=true AND c.status='active' AND c.channel_type='email' AND c.provider=b->>'provider'
    AND lower(btrim(c.from_address))=b->>'from_address',false)
   AND coalesce(c.mailbox_class='shared_support'
     OR (c.mailbox_class='personal' AND c.mailbox_owner_user_id=(b->>'actor_user_id')::uuid),false)
   AND (b->>'provider' IS DISTINCT FROM 'sendgrid' OR public._comms_email_sendgrid_sender_verified(m.tenant_id,b->>'from_address'))
   AND (agreement_source IS NOT NULL OR EXISTS (SELECT 1 FROM public.client_contact_methods cm WHERE cm.tenant_id=m.tenant_id AND cm.client_id=m.contact_id
    AND cm.kind='email' AND lower(btrim(cm.value))=b->>'recipient')))
  || CASE WHEN agreement_source IS NOT NULL THEN jsonb_build_object('agreement_source',agreement_source) ELSE '{}'::jsonb END;
END $$;

-- 6. The claim: release actor, not-before, queued -> draft on admission. Otherwise verbatim 20271114230204.
CREATE OR REPLACE FUNCTION public.claim_comms_email_send(_message_id uuid,_operation_id uuid,_reconcile boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE m public.messages%ROWTYPE; b jsonb; facts jsonb; attempts int;
 discovered jsonb; approval uuid; origin uuid;
BEGIN
 -- Discover without locks, then acquire actor -> PPA -> action -> message. Never enter through
 -- read_binding here: its connector lock belongs after origin/message in admission transactions.
 SELECT * INTO m FROM public.messages WHERE id=_message_id;
 discovered:=m.meta->'comms_email_binding';
 IF discovered IS NULL OR _operation_id IS NULL OR discovered->>'operation_id' IS DISTINCT FROM _operation_id::text THEN
  RAISE EXCEPTION 'COMMS_EMAIL_CLAIM_INVALID' USING ERRCODE='22023';
 END IF;
 -- A scheduled email before its time is not admitted, and nothing is locked for it. (send_at is
 -- written once, at prepare, and never changes; the locked re-read below compares the whole binding.)
 IF discovered->>'send_at' IS NOT NULL AND (discovered->>'send_at')::timestamptz>now() THEN
  RETURN jsonb_build_object('state',discovered->>'state','attempts',coalesce((discovered->>'attempts')::int,0),'admitted',false,'not_before',discovered->>'send_at');
 END IF;
 PERFORM public._comms_email_release_actor(discovered,m.tenant_id);
 -- Preserve actor -> original agreement/Work -> message. Never acquire the
 -- agreement for the first time after locking its child message.
 IF discovered#>>'{governance,purpose}'='agreement_signature_request' THEN
  PERFORM private.e04_agreement_email_binding(discovered,discovered->>'state' IN ('prepared','dispatching'));
 END IF;
 IF discovered->>'approval_id' IS NOT NULL AND discovered->>'state'='prepared' THEN
  BEGIN approval:=(discovered->>'approval_id')::uuid; origin:=(discovered->>'origin_action_id')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN approval:=NULL; origin:=NULL; END;
  PERFORM 1 FROM public.paige_pending_approvals WHERE id=approval FOR UPDATE;
  PERFORM 1 FROM public.paige_actions WHERE id=origin FOR UPDATE;
 END IF;
 SELECT * INTO m FROM public.messages WHERE id=_message_id FOR UPDATE;
 b:=m.meta->'comms_email_binding';
 IF b IS NULL OR _operation_id IS NULL OR b->>'operation_id' IS DISTINCT FROM _operation_id::text
  OR (b-ARRAY['state','attempts','claimed_at','finalized_at','provider_message_id','outcome_reason'])
   IS DISTINCT FROM (discovered-ARRAY['state','attempts','claimed_at','finalized_at','provider_message_id','outcome_reason']) THEN
  RAISE EXCEPTION 'COMMS_EMAIL_CLAIM_INVALID' USING ERRCODE='22023';
 END IF;
 facts:=public.read_comms_email_send_binding(_message_id);
 IF b->>'state'='prepared' AND coalesce((b->>'attempts')::int,0)<>0 THEN
  RETURN jsonb_build_object('state','prepared','attempts',(b->>'attempts')::int,'admitted',false);
 END IF;
 IF b->>'approval_id' IS NOT NULL AND b->>'state'='prepared'
  AND coalesce((b->>'attempts')::int,0)=0 AND facts->'origin_eligible' IS DISTINCT FROM 'true'::jsonb THEN
  -- Known not admitted. Only the existing service finalizer writes the refusal/Rail. A JWT
  -- cancellation itself never writes a bound message or changes auth.uid(). No identity backfill.
  PERFORM public.finalize_comms_email_send(_message_id,_operation_id,'refused',NULL,'origin_not_sendable',NULL);
  RETURN jsonb_build_object('state','refused','attempts',0,'admitted',false);
 END IF;
 -- Serialize admission of identical content across distinct operations (each locks only its own
 -- row above), then refuse while another identical send is in flight or of unknown outcome.
 PERFORM pg_advisory_xact_lock(hashtextextended(m.tenant_id::text||E'\n'||coalesce(b->>'recipient','')||E'\n'||coalesce(b->>'content_digest',''),32848));
 IF facts->'eligible' IS DISTINCT FROM 'true'::jsonb
  OR NOT (CASE WHEN coalesce(_reconcile,false) THEN public._comms_email_reconcilable(b) ELSE b->>'state'='prepared' END)
  OR EXISTS (SELECT 1 FROM public.messages o WHERE o.tenant_id=m.tenant_id AND o.id<>m.id AND o.meta ? 'comms_email_binding'
   AND o.meta#>>'{comms_email_binding,recipient}'=b->>'recipient' AND o.meta#>>'{comms_email_binding,content_digest}'=b->>'content_digest'
   AND o.meta#>>'{comms_email_binding,state}' IN ('dispatching','unknown')) THEN
  -- Not admitted. The row may ALREADY read 'dispatching' (a concurrent winner just claimed it), so
  -- the reply must say so explicitly: send-message dispatches only on admitted=true.
  RETURN jsonb_build_object('state',b->>'state','attempts',coalesce((b->>'attempts')::int,0),'admitted',false);
 END IF;
 attempts:=coalesce((b->>'attempts')::int,0)+1;
 -- A released scheduled row leaves 'queued' here, in the same write that claims it: an outcome the
 -- provider leaves unknown is then never leased by the drainer again (it leases only 'queued').
 UPDATE public.messages SET meta=jsonb_set(meta,'{comms_email_binding}',
   b||jsonb_build_object('state','dispatching','attempts',attempts,'claimed_at',now())),error=NULL,
   status=CASE WHEN status='queued' THEN 'draft' ELSE status END
  WHERE id=m.id;
 RETURN jsonb_build_object('state','dispatching','attempts',attempts,'admitted',true);
END $$;

-- 7. The one close of a scheduled governed email that never went out (header: "Why not finalize").
CREATE OR REPLACE FUNCTION public.close_scheduled_comms_email(_message_id uuid,_operation_id uuid,_reason text,_closing_actor uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE m public.messages%ROWTYPE; b jsonb; reason text; scheduler uuid; rail uuid; seat text;
BEGIN
 SELECT * INTO m FROM public.messages WHERE id=_message_id FOR UPDATE;
 b:=m.meta->'comms_email_binding';
 IF b IS NULL OR _operation_id IS NULL OR b->>'operation_id' IS DISTINCT FROM _operation_id::text THEN
  RAISE EXCEPTION 'COMMS_EMAIL_CLOSE_INVALID' USING ERRCODE='22023';
 END IF;
 IF b->>'send_at' IS NULL THEN RAISE EXCEPTION 'COMMS_EMAIL_NOT_SCHEDULED' USING ERRCODE='55000'; END IF;
 -- A claim has taken it (or it already has an outcome): it may have gone out. Never closed here.
 IF b->>'state' IS DISTINCT FROM 'prepared' THEN
  RETURN jsonb_build_object('closed',false,'outcome',b->>'state','operation_id',_operation_id,'message_id',m.id);
 END IF;
 reason:=CASE WHEN _reason ~ '^[a-z][a-z0-9_]{0,63}$' THEN _reason ELSE 'unspecified' END;
 BEGIN scheduler:=(b->>'actor_user_id')::uuid; EXCEPTION WHEN invalid_text_representation THEN scheduler:=NULL; END;
 -- Who the Rail names: the person closing it, else the scheduler, each only while an active member.
 IF _closing_actor IS NOT NULL THEN
  SELECT tm.role::text INTO seat FROM public.tenant_members tm WHERE tm.tenant_id=m.tenant_id AND tm.user_id=_closing_actor AND tm.status='active';
  IF FOUND THEN rail:=_closing_actor; END IF;
 END IF;
 IF rail IS NULL AND scheduler IS NOT NULL
  AND EXISTS (SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id=m.tenant_id AND tm.user_id=scheduler AND tm.status='active') THEN
  rail:=scheduler;
 END IF;
 -- Exactly finalize_comms_email_send's unclaimed prepared -> refused writes, plus the time cleared.
 UPDATE public.messages SET
  meta=jsonb_set(meta,'{comms_email_binding}',b||jsonb_build_object('state','refused','finalized_at',now(),'outcome_reason',reason)),
  status='blocked', error=reason, scheduled_for=NULL
 WHERE id=m.id;
 IF rail IS NOT NULL THEN
  PERFORM public.record_capability_run(m.tenant_id,rail,'comms_send_email','capability_refused',_operation_id,NULL);
 END IF;
 INSERT INTO public.paige_audit_log(actor_user_id,actor_role,tenant_id,action,target_type,target_id,payload)
 VALUES(_closing_actor,
  CASE WHEN seat IS NOT NULL THEN 'comms:'||seat ELSE 'service:comms-scheduled-release' END, m.tenant_id,
  CASE WHEN reason='cancelled_by_owner' THEN 'comms.email_scheduled_cancelled' ELSE 'comms.email_scheduled_closed' END,'message',m.id,
  jsonb_build_object('capability','comms_send_email','operation_id',_operation_id,'reason',reason,'send_at',b->>'send_at',
   'scheduled_by',b->>'actor_user_id','rail_actor',rail,'rail_recorded',rail IS NOT NULL)
  || CASE WHEN rail IS NULL THEN jsonb_build_object('rail_unrecorded_reason','no_active_member_to_attribute') ELSE '{}'::jsonb END);
 RETURN jsonb_build_object('closed',true,'outcome','refused','reason',reason,'operation_id',_operation_id,'message_id',m.id,
  'send_at',b->>'send_at','rail_actor',rail,'rail_recorded',rail IS NOT NULL);
END $$;

-- 8. Cancel a scheduled governed email. Lock order as the claim: actor facts (FOR SHARE), then the
--    message row (FOR UPDATE); a claim that already holds the row wins and the cancel reads its state.
CREATE OR REPLACE FUNCTION public.cancel_comms_email_send(_actor_user_id uuid,_expected_tenant_id uuid,_operation_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE m public.messages%ROWTYPE; b jsonb; found_id uuid; closed jsonb;
BEGIN
 PERFORM public._comms_email_actor(_actor_user_id,_expected_tenant_id);
 IF _operation_id IS NULL THEN RAISE EXCEPTION 'COMMS_EMAIL_OPERATION_NOT_FOUND' USING ERRCODE='P0002'; END IF;
 SELECT id INTO found_id FROM public.messages
  WHERE meta#>>'{comms_email_binding,operation_id}'=_operation_id::text AND tenant_id=_expected_tenant_id;
 IF found_id IS NULL THEN RAISE EXCEPTION 'COMMS_EMAIL_OPERATION_NOT_FOUND' USING ERRCODE='P0002'; END IF;
 SELECT * INTO m FROM public.messages WHERE id=found_id FOR UPDATE;
 b:=m.meta->'comms_email_binding';
 IF b IS NULL OR m.tenant_id IS DISTINCT FROM _expected_tenant_id OR b->>'operation_id' IS DISTINCT FROM _operation_id::text THEN
  RAISE EXCEPTION 'COMMS_EMAIL_OPERATION_NOT_FOUND' USING ERRCODE='P0002';
 END IF;
 IF b->>'send_at' IS NULL THEN RAISE EXCEPTION 'COMMS_EMAIL_NOT_SCHEDULED' USING ERRCODE='55000'; END IF;
 IF b->>'state' IS DISTINCT FROM 'prepared' THEN
  RETURN jsonb_build_object('cancelled',false,'outcome',b->>'state','reason',b->>'outcome_reason','operation_id',_operation_id,'message_id',m.id);
 END IF;
 -- Closed through (7) with the canceller as the closing actor: the Rail and the audit row name the
 -- person who cancelled, and a scheduler who has since left the business does not block the brake.
 closed:=public.close_scheduled_comms_email(m.id,_operation_id,'cancelled_by_owner',_actor_user_id);
 IF closed->>'closed' IS DISTINCT FROM 'true' THEN
  RETURN jsonb_build_object('cancelled',false,'outcome',closed->>'outcome','operation_id',_operation_id,'message_id',m.id);
 END IF;
 RETURN jsonb_build_object('cancelled',true,'outcome','refused','reason','cancelled_by_owner','operation_id',_operation_id,
  'message_id',m.id,'send_at',b->>'send_at','rail_actor',closed->'rail_actor');
END $$;

-- 9. The drainer's sweep: governed rows still waiting past their release grace are closed as missed,
--    each in its own subtransaction (a failure on one row is reported and leaves it for the next run).
CREATE OR REPLACE FUNCTION public.close_missed_scheduled_comms_emails(_limit integer) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r record; n integer:=0;
BEGIN
 FOR r IN SELECT d.id, d.meta#>>'{comms_email_binding,operation_id}' AS op FROM public.messages d
   WHERE d.status='queued' AND d.meta ? 'comms_email_binding' AND d.meta#>>'{comms_email_binding,state}'='prepared'
     AND d.meta#>>'{comms_email_binding,send_at}' IS NOT NULL
     AND d.scheduled_for IS NOT NULL AND d.scheduled_for<=now()-interval '15 minutes'
   ORDER BY d.scheduled_for
   FOR UPDATE SKIP LOCKED
   LIMIT greatest(1,least(coalesce(_limit,50),200)) LOOP
  BEGIN
   IF public.close_scheduled_comms_email(r.id,r.op::uuid,'scheduled_release_missed',NULL)->>'closed'='true' THEN n:=n+1; END IF;
  EXCEPTION WHEN OTHERS THEN
   RAISE WARNING 'close_missed_scheduled_comms_emails: message % not closed: % %',r.id,SQLSTATE,SQLERRM;
  END;
 END LOOP;
 RETURN n;
END $$;

-- 10. The lease. Byte-identical to the live body (20260726211000) except the two exclusions marked.
CREATE OR REPLACE FUNCTION public.claim_due_scheduled_messages(_limit integer DEFAULT 50)
 RETURNS SETOF messages
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  return query
  update public.messages m
     set meta = coalesce(m.meta, '{}'::jsonb)
                || jsonb_build_object('drain_claimed_at', to_jsonb(now()))
   where m.id in (
     select d.id
       from public.messages d
      where d.status = 'queued'
        and d.scheduled_for is not null
        and d.scheduled_for <= now()
        and (
          d.meta->>'drain_claimed_at' is null
          or (d.meta->>'drain_claimed_at')::timestamptz < now() - interval '5 minutes'
        )
        -- (a) a governed email past its release grace is closed by close_missed_scheduled_comms_emails,
        --     never leased again (stuck rows must not fill the limit ahead of every other business).
        and not (d.meta ? 'comms_email_binding' and d.scheduled_for <= now() - interval '15 minutes')
        -- (b) exactly what a00_comms_provider_message_queue would refuse on this UPDATE: that trigger
        --     raising here aborted the whole lease, so one restricted business stopped every business.
        and (d.tenant_id is null or public.comms_provider_execution_allowed(d.tenant_id, null, null))
        and not (d.channel_type = 'email' and exists (
          select 1 from jsonb_array_elements(d.recipients) r
           where r->>'address' is not null
             and not public.comms_provider_execution_allowed(d.tenant_id, null, r->>'address')))
      order by d.scheduled_for asc
      for update skip locked
      limit greatest(1, least(_limit, 200))
   )
  returning m.*;
end;
$function$;

-- 11. Hand back the lease on rows the drainer did not reach inside its run-time budget.
--    Only THIS run's lease is handed back: the stamp must equal the drain_claimed_at the run's own
--    claim_due wrote. A run that outlived its five-minute lease must never release a row another run
--    has since leased and is releasing, or a third run could take it and send an ordinary row twice.
CREATE OR REPLACE FUNCTION public.unlease_scheduled_messages(_ids uuid[],_stamp text) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE n integer;
BEGIN
 IF _stamp IS NULL OR btrim(_stamp)='' THEN RETURN 0; END IF;
 UPDATE public.messages SET meta=meta-'drain_claimed_at'
  WHERE id=ANY(coalesce(_ids,'{}'::uuid[])) AND status='queued' AND meta->>'drain_claimed_at'=_stamp;
 GET DIAGNOSTICS n=ROW_COUNT;
 RETURN n;
END $$;

-- 12. The generic undo-send never touches a governed row (only cancel_comms_email_send closes one).
--    Otherwise verbatim the live body (20260726211000 as rewritten by 20270504000000).
CREATE OR REPLACE FUNCTION public.cancel_scheduled_message(_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant uuid;
  v_updated integer;
begin
  select tenant_id into v_tenant from public.messages where id = _id;
  if v_tenant is null then
    return false;
  end if;
  if not (
    public.is_platform_owner()
    or (v_tenant = public.current_user_tenant_id()
        and public.has_any_role(auth.uid(), array['admin']))
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  update public.messages
     set status = 'draft',
         scheduled_for = null,
         meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object('undo_cancelled_at', to_jsonb(now()))
   where id = _id
     and status = 'queued'
     and scheduled_for is not null
     and (meta->>'drain_claimed_at') is null   -- lose the race if the drainer already claimed it
     and not (meta ? 'comms_email_binding');   -- a governed email is cancelled only by cancel_comms_email_send
  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$function$;

REVOKE ALL ON FUNCTION public._comms_email_seat(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public._comms_email_seat(uuid,uuid) TO service_role;
REVOKE ALL ON FUNCTION public._comms_email_release_actor(jsonb,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public._comms_email_release_actor(jsonb,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.prepare_comms_email_send(uuid,uuid,uuid,uuid,text,uuid,text,text,text,text,text,jsonb,jsonb,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_comms_email_send(uuid,uuid,uuid,uuid,text,uuid,text,text,text,text,text,jsonb,jsonb,timestamptz) TO service_role;
REVOKE ALL ON FUNCTION public.cancel_comms_email_send(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_comms_email_send(uuid,uuid,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.close_scheduled_comms_email(uuid,uuid,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.close_scheduled_comms_email(uuid,uuid,text,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.close_missed_scheduled_comms_emails(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.close_missed_scheduled_comms_emails(integer) TO service_role;
REVOKE ALL ON FUNCTION public.unlease_scheduled_messages(uuid[],text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.unlease_scheduled_messages(uuid[],text) TO service_role;
-- claim_due_scheduled_messages: CREATE OR REPLACE keeps its existing service_role-only grants.
COMMIT;
