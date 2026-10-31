CREATE OR REPLACE FUNCTION public._comms_email_reconcilable(_binding jsonb)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
 -- Resend's Idempotency-Key let a lost answer be re-dispatched safely; Resend is retired and every
 -- 'resend' operation now sends through SendGrid, where a second POST is a second email. An unknown
 -- outcome stays unknown until provider evidence settles it (20271116200000).
 SELECT false
$function$;
CREATE OR REPLACE FUNCTION public._comms_email_release_actor(_binding jsonb, _tenant uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
 IF _binding->>'send_at' IS NOT NULL AND (_binding->>'send_at')::timestamptz<=now() THEN
  PERFORM public._comms_email_seat((_binding->>'actor_user_id')::uuid,_tenant);
 ELSE
  PERFORM public._comms_email_actor((_binding->>'actor_user_id')::uuid,_tenant);
 END IF;
END $function$;
CREATE OR REPLACE FUNCTION public.claim_comms_email_send(_message_id uuid, _operation_id uuid, _reconcile boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
END $function$;
REVOKE ALL ON FUNCTION public._comms_email_release_actor(jsonb,uuid),public._comms_email_reconcilable(jsonb),public.claim_comms_email_send(uuid,uuid,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._comms_email_release_actor(jsonb,uuid),public._comms_email_reconcilable(jsonb),public.claim_comms_email_send(uuid,uuid,boolean) TO service_role;

