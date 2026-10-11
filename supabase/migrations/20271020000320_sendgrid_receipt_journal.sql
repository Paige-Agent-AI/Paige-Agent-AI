-- =============================================================================
-- ANT-43/S7 slice 2 — SendGrid Event Webhook receipt journal + ingest.
--
-- Mirrors the resend receipt pattern (resend_receipt_processing / ingest_resend_receipt)
-- at bounded depth: a private processing journal deduplicates verified event
-- identities and gates a single append into the ONE truth table
-- public.email_send_log. It is not a second delivery history, tenant read
-- surface, or notification store. email_send_log's status CHECK gains 'dropped'
-- so a provider "dropped" event is recorded truthfully rather than coerced
-- into a status the provider never reported. Provider marker: sender_account =
-- 'sendgrid'. correlation is by message_id = the X-Message-Id the send path
-- recorded (documented to correspond to the Event Webhook's sg_message_id).
--
-- Paired proof: supabase/tests/sendgrid_receipt_ingest.sql
-- =============================================================================

BEGIN;

-- EXTEND the live CHECK verbatim (pending/suppressed/failed/dlq preserved —
-- production rows carry 'failed') + the new truthful 'dropped'. Never narrow.
ALTER TABLE public.email_send_log
  DROP CONSTRAINT email_send_log_status_check;
ALTER TABLE public.email_send_log
  ADD CONSTRAINT email_send_log_status_check
  CHECK (status = ANY (ARRAY['pending'::text, 'sent'::text, 'suppressed'::text, 'failed'::text, 'bounced'::text, 'complained'::text, 'dlq'::text, 'delivered'::text, 'delivery_delayed'::text, 'opened'::text, 'clicked'::text, 'dropped'::text]));

CREATE TABLE IF NOT EXISTS public.sendgrid_receipt_processing (
  receipt_id  text PRIMARY KEY,
  message_id  text NOT NULL,
  status      text NOT NULL,
  email       text,
  event_at    timestamptz,
  state       text NOT NULL DEFAULT 'pending'
              CHECK (state IN ('pending','processed','duplicate','unresolved')),
  reason      text,
  received_at timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL DEFAULT now() + interval '3 days',
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  attempts    integer NOT NULL DEFAULT 0
);

REVOKE ALL ON public.sendgrid_receipt_processing FROM PUBLIC, anon, authenticated;

-- One verified event → journal row (idempotent on receipt_id) → one append-only
-- email_send_log row per EVENT (the timeline survives; nothing is updated).
-- Returns: 'invalid' | 'duplicate' | 'processed' | 'unresolved'.
CREATE OR REPLACE FUNCTION public.ingest_sendgrid_receipt(
  _receipt_id text, _message_id text, _status text,
  _email text DEFAULT NULL, _event_at timestamptz DEFAULT NULL
) RETURNS text
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE r public.sendgrid_receipt_processing%ROWTYPE;
BEGIN
  IF _receipt_id IS NULL OR _receipt_id !~ '^[A-Za-z0-9_.:-]{1,200}$'
     OR _message_id IS NULL OR _message_id !~ '^[A-Za-z0-9_.:-]{1,200}$'
     OR _status IS NULL OR _status NOT IN
       ('sent','delivered','delivery_delayed','opened','clicked','bounced','complained','dropped')
     OR (_email IS NOT NULL AND (_email !~ '^[^@\s]{1,64}@[^@\s]{1,255}$' OR length(_email) > 320))
     OR (_event_at IS NOT NULL AND NOT isfinite(_event_at)) THEN RETURN 'invalid'; END IF;

  INSERT INTO public.sendgrid_receipt_processing(receipt_id,message_id,status,email,event_at)
  VALUES (_receipt_id,_message_id,_status,lower(btrim(_email)),_event_at)
  ON CONFLICT (receipt_id) DO NOTHING;
  SELECT * INTO r FROM public.sendgrid_receipt_processing WHERE receipt_id = _receipt_id FOR UPDATE;
  IF r.message_id IS DISTINCT FROM _message_id OR r.status IS DISTINCT FROM _status
     OR r.email IS DISTINCT FROM lower(btrim(_email)) THEN RETURN 'duplicate'; END IF;
  IF r.state = 'processed' THEN RETURN 'duplicate'; END IF;

  -- The append: one row per verified event. message_id carries the provider id
  -- the send recorded; recipient email is allowlisted from the event payload.
  INSERT INTO public.email_send_log
    (message_id, template_name, recipient_email, status, sender_account, metadata, created_at)
  VALUES
    (r.message_id,
     'sendgrid_event', -- NOT NULL column; honest label for a provider-event append
     COALESCE(r.email, 'unknown'),
     r.status,
     'sendgrid',
     jsonb_build_object('provider','sendgrid','receipt_id',r.receipt_id,'event_at',r.event_at),
     COALESCE(r.event_at, r.received_at));

  UPDATE public.sendgrid_receipt_processing
    SET state = 'processed', attempts = attempts + 1
    WHERE receipt_id = r.receipt_id;
  RETURN 'processed';
EXCEPTION WHEN OTHERS THEN
  UPDATE public.sendgrid_receipt_processing
    SET attempts = attempts + 1,
        next_attempt_at = now() + make_interval(secs => LEAST(3600, 60 * power(2, LEAST(attempts, 6))::integer))
    WHERE receipt_id = _receipt_id;
  RETURN 'pending';
END $function$;

REVOKE ALL ON FUNCTION public.ingest_sendgrid_receipt(text,text,text,text,timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_sendgrid_receipt(text,text,text,text,timestamptz) TO service_role;

COMMIT;
