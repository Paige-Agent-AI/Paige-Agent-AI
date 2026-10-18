-- E09 Customer Portal Slice 6: Profile & Consent. The customer reads and changes how their business
-- may reach them, and whether its Paige may use their account details; the owner reads the same truth.
--
-- ONE HOME (§18). Messaging preference stays in the existing ledger: public.paige_suppressions (the hard
-- opt-out every send gate reads) plus public.paige_consent_events (the append-only evidence). The
-- data-sharing consent stays clients.paige_shared_context_consent. No new table and no new column.
--
-- What this migration changes, named (§00):
--   1. CHECK widenings: paige_consent_events.source and paige_suppressions.source gain 'customer_portal';
--      paige_suppressions.reason gains 'customer_request'. Widened, never narrowed.
--   2. The suppression unique index gains a "customer-held" partition, so a customer's own opt-out (or a
--      STOP, an unsubscribe click, a complaint) always lands even when the business already holds the
--      contact x channel slot with its own pause. Before this, ON CONFLICT DO NOTHING and the
--      23505-as-success writers silently dropped it, and lifting the business pause resumed sends.
--   3. Ledger write guards (triggers, every write path): only the customer's own RPC may write a
--      'customer_portal' row; a signed-in staff session may write only 'admin_ui'/'api' rows, and only
--      'manual' suppressions; nobody but the contact (or a trusted service context) may delete a row the
--      contact holds. The service role is not exempt from the 'customer_portal' rule.
--   4. A data-sharing guard (trigger, INSERT and UPDATE): only the customer's own RPC can turn
--      clients.paige_shared_context_consent on. Turning it off stays open to everyone.
--   5. New functions: _comms_normalize_address, _suppression_customer_held, _comms_contact_address,
--      _comms_row_is_contacts, _comms_set_by, _client_communication_state (internal);
--      client_portal_consent_disclosure, client_portal_communication_preferences,
--      client_portal_set_communication_preference, client_portal_set_shared_context_consent (customer);
--      read_client_communication_state (owner).
--   6. Restated: set_contact_channel_suppression (customer-held rows refused, no 'granted' on lift,
--      tenant-admin guard, reason forced to 'manual'), load_contact_context (refusal message literal
--      only), read_email_marketing_dashboard (customer_request counts as an unsubscribe).
--   7. Grants: anon loses EXECUTE on load_contact_context and admin_propose_paige_actions (§59).
--   8. Opt-outs follow the person, not the row (round 2): a merge moves the archived contact's
--      suppressions and opt-out events to the winner (address kept); deleting a contact detaches the
--      opt-outs the contact holds (contact_id NULL, address kept) instead of cascading them away.
--   9. Integrator defaults (round 2; the owner may overrule): a customer's own spam report is lifted only by that customer turning
--      email back on in their portal; after a customer leaves Updates, staff cannot subscribe them
--      again (only the customer can).
--
-- Nothing here depends on 20271110040000..090000 (parallel slices). No backfill.
BEGIN;

-- ── 1. CHECK widenings ─────────────────────────────────────────────────────────────────────────
ALTER TABLE public.paige_consent_events DROP CONSTRAINT paige_consent_events_source_check,
  ADD CONSTRAINT paige_consent_events_source_check CHECK (source IN
  ('signup_form','inbound_message','admin_ui','api','customer_portal'));
ALTER TABLE public.paige_suppressions DROP CONSTRAINT paige_suppressions_source_check,
  ADD CONSTRAINT paige_suppressions_source_check CHECK (source IN
  ('inbound_message','admin_ui','webhook','api','customer_portal'));
ALTER TABLE public.paige_suppressions DROP CONSTRAINT paige_suppressions_reason_check,
  ADD CONSTRAINT paige_suppressions_reason_check CHECK (reason IN
  ('user_stop','complaint','bounce_hard','manual','unsubscribe_link','customer_request'));

-- ── 2. One active suppression per recipient x channel x holder class ──────────────────────────
-- Holder class: does the CONTACT hold this row (their portal choice, their STOP, their unsubscribe
-- click, their complaint) or does the business / delivery hold it (a pause, a hard bounce)? The two
-- classes now have separate slots, so neither can silently swallow the other. Every existing row
-- keeps its slot (production: one 'manual' row). Writers that relied on the old index keep working:
-- ON CONFLICT DO NOTHING has no conflict target, and a repeat of the same class still conflicts.
CREATE OR REPLACE FUNCTION public._suppression_customer_held(p_source text, p_reason text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = pg_catalog
AS $$ SELECT coalesce(p_source = 'customer_portal', false)
          OR coalesce(p_reason IN ('user_stop','unsubscribe_link','complaint','customer_request'), false) $$;
REVOKE ALL ON FUNCTION public._suppression_customer_held(text, text) FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public._suppression_customer_held(text, text) IS
  'E09 Slice 6: a suppression the CONTACT holds (portal choice, STOP, unsubscribe link, complaint). Only the contact, or a trusted service context acting on their own message, may lift one.';

-- The rows a customer may lift THEMSELVES by turning email back on in their portal: their own portal
-- choice, their own unsubscribe click, and their own spam report (integrator default (owner may overrule), round 2: only the
-- customer, by an affirmative act, can take back a report they made; the business never can). A STOP
-- is lifted by replying START (D1), never from the portal; a business pause or a hard bounce is not
-- the customer's to lift.
CREATE OR REPLACE FUNCTION public._suppression_customer_liftable(p_source text, p_reason text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = pg_catalog
AS $$ SELECT coalesce(p_source = 'customer_portal', false)
          OR coalesce(p_reason IN ('unsubscribe_link','complaint'), false) $$;
REVOKE ALL ON FUNCTION public._suppression_customer_liftable(text, text) FROM PUBLIC, anon, authenticated;

DROP INDEX public.uq_paige_suppressions_recipient_channel;
CREATE UNIQUE INDEX uq_paige_suppressions_recipient_channel ON public.paige_suppressions
  (tenant_id, channel, coalesce(contact_id::text, address_normalized),
   ((source = 'customer_portal') OR (reason IN ('user_stop','unsubscribe_link','complaint','customer_request'))));

-- ── 3. Address normalization: a byte-for-byte port of _shared/pre-send-pipeline.ts ──────────────
-- normalizePhone: trim; a leading '+' keeps only digits after it; a bare 10-digit number gains '+1';
-- anything else is '+' || digits. normalizeEmail: trim, lowercase, fold the '+tag' of the local part
-- before the LAST '@'; no '@' (or '@' first) returns the trimmed lowercase value unchanged.
-- The trimmed set mirrors String.prototype.trim (JS whitespace + line terminators). The SQL
-- normalize_e164_phone is NOT reused: it returns NULL for a bare 10-digit number.
CREATE OR REPLACE FUNCTION public._comms_normalize_address(p_channel text, p_value text)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog
AS $$
DECLARE
  _ws constant text := '[\s   -     　﻿]';
  _raw text := regexp_replace(coalesce(p_value, ''), '^' || _ws || '+|' || _ws || '+$', '', 'g');
  _digits text;
  _at integer;
  _local text;
BEGIN
  IF p_channel = 'sms' THEN
    IF left(_raw, 1) = '+' THEN
      RETURN '+' || regexp_replace(substr(_raw, 2), '[^0-9]', '', 'g');
    END IF;
    _digits := regexp_replace(_raw, '[^0-9]', '', 'g');
    IF length(_digits) = 10 THEN RETURN '+1' || _digits; END IF;
    RETURN '+' || _digits;
  END IF;
  _raw := lower(_raw);
  _at := position('@' in reverse(_raw));
  IF _at = 0 THEN RETURN _raw; END IF;
  _at := length(_raw) - _at + 1;          -- 1-based index of the LAST '@'
  IF _at <= 1 THEN RETURN _raw; END IF;   -- JS lastIndexOf('@') <= 0
  _local := substr(_raw, 1, _at - 1);
  RETURN split_part(_local, '+', 1) || '@' || substr(_raw, _at + 1);
END $$;
REVOKE ALL ON FUNCTION public._comms_normalize_address(text, text) FROM PUBLIC, anon, authenticated;

-- The contact's normalized primary address on a channel, and whether it is THEIRS ALONE in this
-- business. A phone is not a unique key (no tenant-wide unique index; a household or an office shares
-- one), so a number another live client also holds is never used to read or write this contact's text
-- preference (M1: never touch or show another client's rows). An email is different: the normalized
-- address IS the mailbox, so two records that fold to it are one person (usually the duplicate a
-- merge is about to join). Email keeps its address, which is what keeps an opt-out blocking after a
-- merge (M5); runPreSend and _email_audience both match by address.
CREATE OR REPLACE FUNCTION public._comms_contact_address(p_tenant uuid, p_client uuid, p_channel text)
RETURNS TABLE(address text, address_unique boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  WITH mine AS (
    SELECT nullif(nullif(public._comms_normalize_address(p_channel, cm.value), ''), '+') AS a
      FROM public.client_contact_methods cm
     WHERE cm.tenant_id = p_tenant AND cm.client_id = p_client AND cm.is_primary
       AND cm.kind = CASE p_channel WHEN 'sms' THEN 'phone' ELSE 'email' END
     ORDER BY cm.id LIMIT 1)
  SELECT m.a,
         m.a IS NOT NULL AND (p_channel = 'email' OR NOT EXISTS (
           SELECT 1 FROM public.client_contact_methods o
             JOIN public.clients oc ON oc.id = o.client_id AND oc.tenant_id = o.tenant_id
            WHERE o.tenant_id = p_tenant AND o.client_id <> p_client
              AND o.kind = CASE p_channel WHEN 'sms' THEN 'phone' ELSE 'email' END
              AND oc.merged_into_contact_id IS NULL AND oc.status <> 'archived'
              AND public._comms_normalize_address(p_channel, o.value) = m.a))
    FROM mine m
  UNION ALL
  SELECT NULL::text, false WHERE NOT EXISTS (SELECT 1 FROM mine)
$$;
REVOKE ALL ON FUNCTION public._comms_contact_address(uuid, uuid, text) FROM PUBLIC, anon, authenticated;

-- Is a ledger row (suppression or event) THIS contact's? Their own id, or a contactless row on an
-- address that is theirs alone. That is the same match runPreSend makes (contact id OR normalized
-- address), so the card and the send gate read ONE derivation. A merged contact's rows are not read
-- here: a merge MOVES them to the winner (section 4b), so they already carry the winner's id.
CREATE OR REPLACE FUNCTION public._comms_row_is_contacts(p_tenant uuid, p_client uuid, p_address text,
  p_address_unique boolean, p_row_contact uuid, p_row_address text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = pg_catalog
AS $$
  SELECT CASE
    WHEN p_row_contact IS NOT NULL THEN p_row_contact = p_client
    ELSE coalesce(p_address_unique, false) AND p_address IS NOT NULL AND p_row_address = p_address
  END
$$;
REVOKE ALL ON FUNCTION public._comms_row_is_contacts(uuid, uuid, text, boolean, uuid, text) FROM PUBLIC, anon, authenticated;

-- Who set the deciding row, in customer-safe words. Never the address, the staff id or the evidence.
CREATE OR REPLACE FUNCTION public._comms_set_by(p_source text, p_reason text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = pg_catalog
AS $$ SELECT CASE
  WHEN p_source = 'customer_portal' THEN 'you'
  WHEN p_reason = 'user_stop' OR p_source = 'inbound_message' THEN 'reply'
  WHEN p_reason = 'unsubscribe_link' THEN 'unsubscribe_link'
  WHEN p_reason = 'complaint' THEN 'reported'
  WHEN p_reason = 'bounce_hard' THEN 'delivery'
  WHEN p_source = 'signup_form' THEN 'form'
  WHEN p_source IN ('admin_ui','api','webhook') THEN 'business'
  ELSE NULL END $$;
REVOKE ALL ON FUNCTION public._comms_set_by(text, text) FROM PUBLIC, anon, authenticated;

-- Has the contact left Updates and offers themselves, and not come back? (Integrator default (owner may overrule), round 2,
-- CAN-SPAM-conservative.) True when their latest OWN newsletter choice — the portal, a sign-up form,
-- a reply — is an unsubscribe, or while they hold an email opt-out of their own (their portal email
-- off, their unsubscribe click, their spam report). While it is true the business cannot subscribe
-- them; only the customer can, by subscribing again themselves. Matched by contact id or the
-- normalized email, the same way _email_newsletter_subscribed reads the topic.
CREATE OR REPLACE FUNCTION public._newsletter_left_by_contact(p_tenant uuid, p_contact uuid, p_address text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  WITH a AS (
    SELECT coalesce(nullif(p_address, ''),
      (SELECT x.address FROM public._comms_contact_address(p_tenant, p_contact, 'email') x WHERE p_contact IS NOT NULL)) AS addr)
  SELECT coalesce((SELECT e.action = 'revoked' FROM public.paige_consent_events e, a
            WHERE e.tenant_id = p_tenant AND e.channel = 'email' AND e.topic = 'newsletter'
              AND e.source IN ('customer_portal','signup_form','inbound_message')
              AND (e.contact_id = p_contact OR (a.addr IS NOT NULL AND e.address_normalized = a.addr))
            ORDER BY e.created_at DESC, e.id DESC LIMIT 1), false)
      OR EXISTS (SELECT 1 FROM public.paige_suppressions s, a
            WHERE s.tenant_id = p_tenant AND s.channel = 'email'
              AND public._suppression_customer_held(s.source, s.reason)
              AND (s.contact_id = p_contact OR (a.addr IS NOT NULL AND s.address_normalized = a.addr)))
$$;
REVOKE ALL ON FUNCTION public._newsletter_left_by_contact(uuid, uuid, text) FROM PUBLIC, anon, authenticated;

-- ── 4. Ledger write guards (B1) ────────────────────────────────────────────────────────────────
-- Trusted context = no signed-in end user: service role, cron, migrations. A signed-in session that
-- reaches these tables (RLS for tenant admins and managing agencies, or a SECURITY DEFINER RPC acting
-- for them) is staff, and staff record the business's own choices only. The customer's RPC is the one
-- writer of 'customer_portal' rows, for exactly the relationship it resolved; it says so with two
-- transaction-local settings that no API caller can set.
CREATE OR REPLACE FUNCTION public._paige_ledger_write_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _customer_gate boolean := current_setting('paige.customer_consent_write', true) = 'on';
  _customer_contact text := nullif(current_setting('paige.customer_consent_contact', true), '');
  -- Read through jsonb: paige_consent_events has no reason column, and PL/pgSQL does not
  -- short-circuit a record field reference behind a table-name test.
  _reason text := to_jsonb(NEW)->>'reason';
BEGIN
  -- A merge or a contact deletion re-keys a row to the person it belongs to (section 4b). That is the
  -- only UPDATE this guard admits on its own terms, and only when nothing but contact_id changes.
  IF TG_OP = 'UPDATE' AND current_setting('paige.ledger_rekey', true) = 'on'
     AND (to_jsonb(NEW) - 'contact_id') = (to_jsonb(OLD) - 'contact_id') THEN
    RETURN NEW;
  END IF;
  IF NEW.source = 'customer_portal' THEN
    IF NOT _customer_gate OR NEW.contact_id IS NULL OR NEW.contact_id::text IS DISTINCT FROM _customer_contact THEN
      RAISE EXCEPTION 'LEDGER_CUSTOMER_SOURCE_FORBIDDEN: only the contact can record their own portal choice'
        USING ERRCODE = '42501';
    END IF;
    IF TG_TABLE_NAME = 'paige_suppressions' AND _reason IS DISTINCT FROM 'customer_request' THEN
      RAISE EXCEPTION 'LEDGER_REASON_FORBIDDEN: a portal opt-out is recorded as customer_request'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME = 'paige_suppressions' AND _reason = 'customer_request' THEN
    RAISE EXCEPTION 'LEDGER_REASON_FORBIDDEN: customer_request is recorded only from the contact''s portal'
      USING ERRCODE = '42501';
  END IF;
  -- The business (staff UI, its API, Paige acting for it) never subscribes someone to Updates who
  -- left them. Service context included: the rule is about whose choice it is, not who is signed in.
  IF TG_OP = 'INSERT' AND TG_TABLE_NAME = 'paige_consent_events'
     AND NEW.channel = 'email' AND to_jsonb(NEW)->>'topic' = 'newsletter' AND to_jsonb(NEW)->>'action' = 'granted'
     AND NEW.source IN ('admin_ui','api')
     AND public._newsletter_left_by_contact(NEW.tenant_id, NEW.contact_id, NEW.address_normalized) THEN
    RAISE EXCEPTION 'NEWSLETTER_LEFT_BY_CONTACT: they unsubscribed from updates and offers; only they can subscribe again'
      USING ERRCODE = '42501';
  END IF;
  IF auth.uid() IS NOT NULL THEN
    IF NEW.source NOT IN ('admin_ui','api') THEN
      RAISE EXCEPTION 'LEDGER_SOURCE_FORBIDDEN: a signed-in session records the business''s own choice (admin_ui or api)'
        USING ERRCODE = '42501';
    END IF;
    IF TG_TABLE_NAME = 'paige_suppressions' AND _reason IS DISTINCT FROM 'manual' THEN
      RAISE EXCEPTION 'LEDGER_REASON_FORBIDDEN: a business pause is recorded as manual'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._paige_ledger_write_guard() FROM PUBLIC, anon, authenticated;

-- Fires after trg_*_tenant (alphabetical), so the guard sees the derived tenant.
CREATE TRIGGER trg_paige_suppressions_write_guard BEFORE INSERT OR UPDATE ON public.paige_suppressions
  FOR EACH ROW EXECUTE FUNCTION public._paige_ledger_write_guard();
CREATE TRIGGER trg_paige_consent_events_write_guard BEFORE INSERT OR UPDATE ON public.paige_consent_events
  FOR EACH ROW EXECUTE FUNCTION public._paige_ledger_write_guard();

-- A row the contact holds is lifted only by the contact: their portal RPC (only their own portal row,
-- their own unsubscribe-link row or their own spam report), or a trusted service context (a START
-- reply from that number). The cascade from deleting the business is allowed; deleting the contact
-- first detaches every held row that has an address (section 4b), so only an address-less row, which
-- nothing could match any more, goes with the contact.
CREATE OR REPLACE FUNCTION public._paige_suppression_delete_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _contact uuid;
  _addr text;
  _uniq boolean;
BEGIN
  IF NOT public._suppression_customer_held(OLD.source, OLD.reason) OR auth.uid() IS NULL
     OR current_setting('paige.ledger_rekey', true) = 'on' THEN
    -- (The re-key only deletes a duplicate of a slot the same person already holds, section 4b.)
    RETURN OLD;
  END IF;
  IF (OLD.contact_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.clients c WHERE c.id = OLD.contact_id))
     OR NOT EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = OLD.tenant_id) THEN
    RETURN OLD;
  END IF;
  IF current_setting('paige.customer_consent_write', true) = 'on'
     AND public._suppression_customer_liftable(OLD.source, OLD.reason) THEN
    _contact := nullif(current_setting('paige.customer_consent_contact', true), '')::uuid;
    SELECT a.address, a.address_unique INTO _addr, _uniq
      FROM public._comms_contact_address(OLD.tenant_id, _contact, OLD.channel) a;
    IF _contact IS NOT NULL
       AND public._comms_row_is_contacts(OLD.tenant_id, _contact, _addr, _uniq, OLD.contact_id, OLD.address_normalized) THEN
      RETURN OLD;
    END IF;
  END IF;
  RAISE EXCEPTION 'SUPPRESSION_HELD_BY_CONTACT: the contact turned this off; only they can turn it back on'
    USING ERRCODE = '42501';
END $$;
REVOKE ALL ON FUNCTION public._paige_suppression_delete_guard() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_paige_suppressions_delete_guard BEFORE DELETE ON public.paige_suppressions
  FOR EACH ROW EXECUTE FUNCTION public._paige_suppression_delete_guard();

-- ── 4b. Opt-outs follow the person (round 2: verifier MAJOR 1 and MAJOR 2) ─────────────────────
-- An opt-out belongs to a PERSON, and two things used to separate it from them:
--   * a merge archived the contact the customer opted out on, so the winner's sends (matched by the
--     winner's id and address) went out while the card, which read merged contacts, said "off";
--   * deleting the contact cascaded the opt-out away, so re-importing the same address emailed them.
-- _paige_ledger_rekey moves a contact's rows to the person they now belong to, keeping the address:
--   merge  (p_to = the winner): every suppression, and every opt-out (revoked) event, moves to the
--          winner. Granted events stay with the archived contact: consent given for one number or
--          mailbox is never stretched to another (it can only block more, never send more).
--   delete (p_to NULL): suppressions the contact HOLDS and opt-out events that carry an address are
--          detached (contact_id NULL, address kept), so runPreSend still blocks by address. Business
--          pauses and grants go with the contact, as before.
-- When the destination slot is already held by an equal row (same person, channel and holder
-- class), the row is kept as an address-keyed row if it has an address, else dropped as a duplicate.
-- paige_consent_events is append-only evidence: the re-key changes contact_id and nothing else, and
-- the write guard admits exactly that (paige.ledger_rekey), from these two triggers only.
CREATE OR REPLACE FUNCTION public._paige_ledger_rekey(p_tenant uuid, p_from uuid, p_to uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  r record;
  _held boolean;
  _prev text := coalesce(current_setting('paige.ledger_rekey', true), '');
BEGIN
  IF p_from IS NULL OR p_tenant IS NULL OR p_from IS NOT DISTINCT FROM p_to THEN RETURN; END IF;
  PERFORM set_config('paige.ledger_rekey', 'on', true);
  FOR r IN SELECT s.id, s.channel, s.source, s.reason, s.address_normalized FROM public.paige_suppressions s
            WHERE s.tenant_id = p_tenant AND s.contact_id = p_from ORDER BY s.created_at, s.id LOOP
    _held := public._suppression_customer_held(r.source, r.reason);
    CONTINUE WHEN p_to IS NULL AND NOT _held;
    IF p_to IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.paige_suppressions o
         WHERE o.tenant_id = p_tenant AND o.channel = r.channel AND o.contact_id = p_to
           AND public._suppression_customer_held(o.source, o.reason) = _held) THEN
      UPDATE public.paige_suppressions SET contact_id = p_to WHERE id = r.id;
    ELSIF r.address_normalized IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.paige_suppressions o
         WHERE o.tenant_id = p_tenant AND o.channel = r.channel AND o.contact_id IS NULL
           AND o.address_normalized = r.address_normalized
           AND public._suppression_customer_held(o.source, o.reason) = _held) THEN
      UPDATE public.paige_suppressions SET contact_id = NULL WHERE id = r.id;
    ELSIF p_to IS NOT NULL THEN
      DELETE FROM public.paige_suppressions WHERE id = r.id;
    END IF;
  END LOOP;
  UPDATE public.paige_consent_events e SET contact_id = p_to
   WHERE e.tenant_id = p_tenant AND e.contact_id = p_from AND e.action = 'revoked'
     AND (p_to IS NOT NULL OR e.address_normalized IS NOT NULL);
  PERFORM set_config('paige.ledger_rekey', _prev, true);
END $$;
REVOKE ALL ON FUNCTION public._paige_ledger_rekey(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._clients_ledger_follow_person()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public._paige_ledger_rekey(OLD.tenant_id, OLD.id, NULL);
    RETURN OLD;
  END IF;
  PERFORM public._paige_ledger_rekey(NEW.tenant_id, NEW.id, NEW.merged_into_contact_id);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._clients_ledger_follow_person() FROM PUBLIC, anon, authenticated;
-- BEFORE DELETE: runs before the foreign-key cascade, which then removes only what was not detached.
CREATE TRIGGER trg_clients_ledger_keep_opt_outs BEFORE DELETE ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public._clients_ledger_follow_person();
CREATE TRIGGER trg_clients_ledger_follow_merge AFTER UPDATE OF merged_into_contact_id ON public.clients
  FOR EACH ROW WHEN (NEW.merged_into_contact_id IS NOT NULL
                     AND NEW.merged_into_contact_id IS DISTINCT FROM OLD.merged_into_contact_id)
  EXECUTE FUNCTION public._clients_ledger_follow_person();

-- Contacts merged before this migration: their rows move the same way (production has one ledger row,
-- so this touches little). Ordered by merge time so a chain lands on its last winner; repeated until
-- no merged contact still holds a row (a chain merged out of order needs a second pass).
DO $$
DECLARE r record; _pass integer := 0;
BEGIN
  LOOP
    _pass := _pass + 1;
    EXIT WHEN _pass > 10 OR NOT EXISTS (
      SELECT 1 FROM public.clients c WHERE c.merged_into_contact_id IS NOT NULL
         AND (EXISTS (SELECT 1 FROM public.paige_suppressions s WHERE s.contact_id = c.id)
              OR EXISTS (SELECT 1 FROM public.paige_consent_events e WHERE e.contact_id = c.id AND e.action = 'revoked')));
    FOR r IN SELECT c.tenant_id, c.id, c.merged_into_contact_id FROM public.clients c
              WHERE c.merged_into_contact_id IS NOT NULL ORDER BY c.merged_at NULLS FIRST, c.id LOOP
      PERFORM public._paige_ledger_rekey(r.tenant_id, r.id, r.merged_into_contact_id);
    END LOOP;
  END LOOP;
END $$;

-- ── 5. The one derivation (§1a). Mirrors runPreSend steps 2-3 and tenantConsent ───────────────────
-- Returns {email, sms, updates, data_sharing, quiet_hours}. Never an address, an evidence pointer,
-- an IP, a staff id, a row id or a reason string. The Deno and pgTAP parity fixture
-- (supabase/tests/fixtures/consent-parity.json) pins it to the TypeScript deciders.
CREATE OR REPLACE FUNCTION public._client_communication_state(p_tenant uuid, p_client uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _c public.clients%ROWTYPE;
  _e_addr text; _e_uniq boolean; _s_addr text; _s_uniq boolean;
  _e_blk record; _s_blk record; _s_ev record; _nl record; _tc record;
  _e_state text; _e_by text; _e_at timestamptz; _e_held boolean; _e_fixed boolean;
  _s_state text; _s_by text; _s_at timestamptz; _s_held boolean;
  _u_state text; _u_by text; _u_at timestamptz;
  _tz_known boolean; _tz_fallback text;
BEGIN
  SELECT * INTO _c FROM public.clients WHERE id = p_client AND tenant_id = p_tenant;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT a.address, a.address_unique INTO _e_addr, _e_uniq FROM public._comms_contact_address(p_tenant, p_client, 'email') a;
  SELECT a.address, a.address_unique INTO _s_addr, _s_uniq FROM public._comms_contact_address(p_tenant, p_client, 'sms') a;

  -- Email (runPreSend step 2: any suppression blocks; email consent is not enforced, D-1/D8).
  -- The row shown is the one the customer cannot lift themselves, when there is one.
  SELECT s.source, s.reason, s.created_at INTO _e_blk FROM public.paige_suppressions s
   WHERE s.tenant_id = p_tenant AND s.channel = 'email'
     AND public._comms_row_is_contacts(p_tenant, p_client, _e_addr, _e_uniq, s.contact_id, s.address_normalized)
   ORDER BY public._suppression_customer_liftable(s.source, s.reason) ASC, s.created_at DESC, s.id DESC LIMIT 1;
  SELECT EXISTS (SELECT 1 FROM public.paige_suppressions s
    WHERE s.tenant_id = p_tenant AND s.channel = 'email' AND public._suppression_customer_held(s.source, s.reason)
      AND public._comms_row_is_contacts(p_tenant, p_client, _e_addr, _e_uniq, s.contact_id, s.address_normalized)) INTO _e_held;
  SELECT EXISTS (SELECT 1 FROM public.paige_suppressions s
    WHERE s.tenant_id = p_tenant AND s.channel = 'email' AND NOT public._suppression_customer_liftable(s.source, s.reason)
      AND public._comms_row_is_contacts(p_tenant, p_client, _e_addr, _e_uniq, s.contact_id, s.address_normalized)) INTO _e_fixed;
  IF _e_blk.created_at IS NOT NULL THEN
    _e_state := 'off'; _e_by := public._comms_set_by(_e_blk.source, _e_blk.reason); _e_at := _e_blk.created_at;
  ELSIF _e_addr IS NULL THEN
    _e_state := 'no_address';
  ELSE
    _e_state := 'on';
  END IF;

  -- Texts (step 2 suppression, then step 3 default-deny consent: the latest event decides).
  SELECT s.source, s.reason, s.created_at INTO _s_blk FROM public.paige_suppressions s
   WHERE s.tenant_id = p_tenant AND s.channel = 'sms'
     AND public._comms_row_is_contacts(p_tenant, p_client, _s_addr, _s_uniq, s.contact_id, s.address_normalized)
   ORDER BY public._suppression_customer_held(s.source, s.reason) ASC, s.created_at DESC, s.id DESC LIMIT 1;
  SELECT EXISTS (SELECT 1 FROM public.paige_suppressions s
    WHERE s.tenant_id = p_tenant AND s.channel = 'sms' AND public._suppression_customer_held(s.source, s.reason)
      AND public._comms_row_is_contacts(p_tenant, p_client, _s_addr, _s_uniq, s.contact_id, s.address_normalized)) INTO _s_held;
  SELECT e.action, e.source, e.created_at INTO _s_ev FROM public.paige_consent_events e
   WHERE e.tenant_id = p_tenant AND e.channel = 'sms'
     AND public._comms_row_is_contacts(p_tenant, p_client, _s_addr, _s_uniq, e.contact_id, e.address_normalized)
   ORDER BY e.created_at DESC, e.id DESC LIMIT 1;
  IF _s_blk.created_at IS NOT NULL THEN
    _s_state := 'off'; _s_by := public._comms_set_by(_s_blk.source, _s_blk.reason); _s_at := _s_blk.created_at;
  ELSIF _s_addr IS NULL THEN
    _s_state := 'no_number';
  ELSIF _s_ev.action = 'granted' THEN
    _s_state := 'on'; _s_by := public._comms_set_by(_s_ev.source, NULL); _s_at := _s_ev.created_at;
  ELSIF _s_ev.action = 'revoked' THEN
    _s_state := 'off'; _s_by := public._comms_set_by(_s_ev.source, NULL); _s_at := _s_ev.created_at;
  ELSE
    _s_state := 'not_set';
  END IF;

  -- Updates and offers (M9): subscribed only when BOTH deciders agree — the newsletter topic
  -- (_email_newsletter_subscribed, campaigns) AND the latest email event of any topic (tenantConsent,
  -- marketing stage automations) — and email itself is on.
  SELECT e.action, e.source, e.created_at INTO _nl FROM public.paige_consent_events e
   WHERE e.tenant_id = p_tenant AND e.channel = 'email' AND e.topic = 'newsletter'
     AND public._comms_row_is_contacts(p_tenant, p_client, _e_addr, _e_uniq, e.contact_id, e.address_normalized)
   ORDER BY e.created_at DESC, e.id DESC LIMIT 1;
  SELECT e.action, e.source, e.created_at INTO _tc FROM public.paige_consent_events e
   WHERE e.tenant_id = p_tenant AND e.channel = 'email'
     AND public._comms_row_is_contacts(p_tenant, p_client, _e_addr, _e_uniq, e.contact_id, e.address_normalized)
   ORDER BY e.created_at DESC, e.id DESC LIMIT 1;
  IF _e_state = 'no_address' THEN
    _u_state := 'no_address';
  ELSIF _nl.action = 'granted' AND _tc.action = 'granted' AND _e_state = 'on' THEN
    _u_state := 'subscribed'; _u_by := public._comms_set_by(_nl.source, NULL); _u_at := _nl.created_at;
  ELSIF _nl.action = 'granted' THEN
    _u_state := 'paused';
    IF _e_state = 'off' THEN _u_by := _e_by; _u_at := _e_at;
    ELSE _u_by := public._comms_set_by(_tc.source, NULL); _u_at := _tc.created_at; END IF;
  ELSE
    _u_state := 'not_subscribed';
    IF _nl.action IS NOT NULL THEN _u_by := public._comms_set_by(_nl.source, NULL); _u_at := _nl.created_at; END IF;
  END IF;

  -- Quiet hours (texts): runPreSend uses safeTz(client.timezone ?? business autosend_dnd_timezone)
  -- (pre-send-pipeline.ts step 5). A stored client zone, usable or not, is tried first and an unusable
  -- one falls to America/New_York; with no client zone the business's usable zone applies; otherwise
  -- America/New_York. Known only when the client's own zone is usable; otherwise the page names the
  -- zone the gate actually falls back to (verifier minor 4), never a guessed one. Intl accepts IANA
  -- names case-insensitively; so do these matches, which return the canonical spelling.
  _tz_known := EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names z
                        WHERE lower(z.name) = lower(btrim(coalesce(_c.timezone, ''))));
  IF NOT _tz_known THEN
    _tz_fallback := CASE WHEN _c.timezone IS NULL THEN
        (SELECT z.name FROM public.tenant_comms_preferences p
           JOIN pg_catalog.pg_timezone_names z ON lower(z.name) = lower(btrim(coalesce(p.autosend_dnd_timezone, '')))
          WHERE p.tenant_id = p_tenant ORDER BY z.name LIMIT 1) END;
    _tz_fallback := coalesce(_tz_fallback, 'America/New_York');
  END IF;

  RETURN jsonb_build_object(
    'email', jsonb_build_object('state', _e_state, 'set_by', _e_by, 'set_at', _e_at,
      'can_turn_on', _e_state = 'off' AND NOT _e_fixed,
      'can_turn_off', NOT _e_held),
    'sms', jsonb_build_object('state', _s_state, 'set_by', _s_by, 'set_at', _s_at,
      'can_turn_on', false,
      'can_turn_off', NOT _s_held),
    'updates', jsonb_build_object('state', _u_state, 'set_by', _u_by, 'set_at', _u_at,
      'can_subscribe', _e_state = 'on' AND _u_state <> 'subscribed',
      'can_unsubscribe', _u_state IN ('subscribed','paused')),
    'data_sharing', jsonb_build_object('allowed', coalesce(_c.paige_shared_context_consent, false),
      'updated_at', _c.paige_shared_context_consent_updated_at),
    'quiet_hours', jsonb_build_object('start', '20:00', 'end', '08:00',
      'time_zone_known', _tz_known, 'fallback_time_zone', _tz_fallback));
END $$;
REVOKE ALL ON FUNCTION public._client_communication_state(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- ── 6. Disclosures (Minor 7): the exact sentence each evidence id stands for, held server-side ────
-- Evidence written by the portal carries 'portal:<uid>:<id>:<first 12 of md5(text)>', so a later copy
-- change can never silently re-label old evidence: a new sentence is a new id (v2), and the hash
-- names the bytes the customer saw. {business} is replaced with the business name when rendered.
-- v1 of email, Updates and texts is superseded (round 3) and kept, because evidence already written
-- names it: email-pref:v2 adds the agreements exception and that email off also leaves Updates (D4);
-- updates-optin:v2 drops the repeated row label; sms-pref:v2 drops "again" and no longer implies a
-- text will come (a contact with texts not set up may have none to reply to). Every writer below
-- records the id the page shows today (src/lib/client-portal-preferences.ts CURRENT_DISCLOSURE).
CREATE OR REPLACE FUNCTION public.client_portal_consent_disclosure(p_id text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = pg_catalog
AS $$ SELECT CASE p_id
  WHEN 'email-pref:v1' THEN 'Email from {business}. When email is off, {business} won''t email you through Paige. Confirmations for times you book, and changes you make to them, still arrive.'
  WHEN 'email-pref:v2' THEN 'Email from {business}. When email is off, {business} won''t email you through Paige, except booking confirmations and agreements you''re asked to sign. Turning email off also unsubscribes you from updates and offers, and turning it back on doesn''t subscribe you again.'
  WHEN 'updates-optin:v1' THEN 'Updates and offers: newsletters and automated marketing emails from {business}, sent through Paige. You can unsubscribe anytime.'
  WHEN 'updates-optin:v2' THEN 'Newsletters and automated marketing emails from {business}, sent through Paige. You can unsubscribe anytime.'
  WHEN 'sms-pref:v1' THEN 'Texts from {business}. When texts are off, {business} can''t text you through Paige. To get texts again, reply START to a text from {business}.'
  WHEN 'sms-pref:v2' THEN 'Texts from {business}. When texts are off, {business} can''t text you through Paige. To get texts, reply START to a text from {business} if you have one, or ask them.'
  WHEN 'data-sharing:v1' THEN 'Lets {business}''s Paige use your account details and portal activity when it prepares requests or suggestions for you. It has no effect yet, and you can turn it off anytime.'
  END $$;
REVOKE ALL ON FUNCTION public.client_portal_consent_disclosure(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.client_portal_consent_disclosure(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public._client_portal_evidence_ref(p_uid uuid, p_disclosure text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp
AS $$ SELECT 'portal:' || p_uid::text || ':' || p_disclosure || ':'
          || left(md5(public.client_portal_consent_disclosure(p_disclosure)), 12) $$;
REVOKE ALL ON FUNCTION public._client_portal_evidence_ref(uuid, text) FROM PUBLIC, anon, authenticated;

-- ── 7. The customer read ───────────────────────────────────────────────────────────────────────
-- VOLATILE because it re-proves the relationship under FOR SHARE (Messages pattern). Signed out
-- raises 42501; no relationship returns NULL; more than one relationship raises 42501 (from
-- client_portal_relationship_id). Exact keys; the hook refuses any widening.
CREATE OR REPLACE FUNCTION public.client_portal_communication_preferences(p_tenant_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _uid uuid := auth.uid();
  _client_id uuid;
  _c public.clients%ROWTYPE;
  _t public.tenants%ROWTYPE;
  _s jsonb;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'customer authentication required' USING ERRCODE = '42501';
  END IF;
  _client_id := public.client_portal_relationship_id(p_tenant_id);
  IF _client_id IS NULL THEN RETURN NULL; END IF;
  SELECT c.* INTO _c FROM public.clients c
   WHERE c.id = _client_id AND c.linked_user_id = _uid AND c.status = 'active' AND c.merged_into_contact_id IS NULL
   FOR SHARE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT t.* INTO _t FROM public.tenants t WHERE t.id = _c.tenant_id AND t.status = 'active' FOR SHARE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  _s := public._client_communication_state(_c.tenant_id, _c.id);
  RETURN jsonb_build_object(
    'schema_version', 1,
    'tenant_id', _c.tenant_id,
    'business_name', _t.name,
    'email', _s->'email',
    'sms', _s->'sms',
    'updates', _s->'updates',
    'data_sharing', _s->'data_sharing',
    'quiet_hours', _s->'quiet_hours',
    'read_at', clock_timestamp());
END $$;
REVOKE ALL ON FUNCTION public.client_portal_communication_preferences(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.client_portal_communication_preferences(uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.client_portal_communication_preferences(uuid) IS
  'E09 Slice 6: the signed-in customer''s own email, text, updates and data-sharing state with their business, derived from the one ledger. No address, evidence, IP or id is ever returned.';

-- ── 8. The customer write ──────────────────────────────────────────────────────────────────────
-- Every answer carries the fresh read: {ok:true, replayed, preferences} or {ok:false, error, preferences}.
-- The contact always comes from the relationship; there is no contact parameter to forge. Replay
-- compares the customer's OWN recorded intent, not the derived state (B2): a business pause does not
-- stop the customer recording their own opt-out underneath it.
CREATE OR REPLACE FUNCTION public.client_portal_set_communication_preference(
  p_channel text, p_topic text, p_enabled boolean, p_tenant_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _uid uuid := auth.uid();
  _client_id uuid;
  _c public.clients%ROWTYPE;
  _ch text := lower(btrim(coalesce(p_channel, '')));
  _topic text := nullif(lower(btrim(coalesce(p_topic, ''))), '');
  _before jsonb;
  _addr text; _uniq boolean; _row_addr text;
  _disclosure text;
  _err text;
  _changed boolean := false;
  _took_back boolean := false;
  _at timestamptz;
  _after jsonb;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'customer authentication required' USING ERRCODE = '42501';
  END IF;
  IF _ch NOT IN ('email','sms') OR p_enabled IS NULL
     OR (_topic IS NOT NULL AND (_topic <> 'newsletter' OR _ch <> 'email')) THEN
    RAISE EXCEPTION 'BAD_PREFERENCE: channel email or sms; topic newsletter is email only' USING ERRCODE = '22023';
  END IF;
  _client_id := public.client_portal_relationship_id(p_tenant_id);
  IF _client_id IS NULL THEN
    RAISE EXCEPTION 'customer relationship unavailable' USING ERRCODE = '42501';
  END IF;
  -- One key serializes the customer, the staff pause/lift RPC and every retry for this contact.
  PERFORM pg_advisory_xact_lock(hashtextextended('portal_pref:' || _client_id::text, 0));
  SELECT c.* INTO _c FROM public.clients c
   WHERE c.id = _client_id AND c.linked_user_id = _uid AND c.status = 'active' AND c.merged_into_contact_id IS NULL
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'customer relationship unavailable' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.tenants t WHERE t.id = _c.tenant_id AND t.status = 'active' FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'customer relationship unavailable' USING ERRCODE = '42501';
  END IF;

  _before := public._client_communication_state(_c.tenant_id, _c.id);
  SELECT a.address, a.address_unique INTO _addr, _uniq FROM public._comms_contact_address(_c.tenant_id, _c.id, _ch) a;
  -- An address another client also holds is never written (M1); the row stays contact-keyed.
  _row_addr := CASE WHEN _uniq THEN _addr END;

  PERFORM set_config('paige.customer_consent_write', 'on', true);
  PERFORM set_config('paige.customer_consent_contact', _c.id::text, true);

  IF _ch = 'email' AND _topic IS NULL AND NOT p_enabled THEN
    _disclosure := 'email-pref:v2';
    IF (_before #>> '{email,can_turn_off}')::boolean THEN
      INSERT INTO public.paige_suppressions(contact_id, address_normalized, channel, reason, source, created_at)
      VALUES (_c.id, _row_addr, 'email', 'customer_request', 'customer_portal', clock_timestamp()) ON CONFLICT DO NOTHING;
      INSERT INTO public.paige_consent_events(contact_id, address_normalized, channel, topic, action, source, evidence_ref, ip, created_at)
      VALUES (_c.id, _row_addr, 'email', NULL, 'revoked', 'customer_portal', public._client_portal_evidence_ref(_uid, _disclosure), NULL, clock_timestamp());
      -- D4: turning email off also leaves Updates and offers. Turning it back on never re-subscribes.
      IF _before #>> '{updates,state}' IN ('subscribed','paused') THEN
        INSERT INTO public.paige_consent_events(contact_id, address_normalized, channel, topic, action, source, evidence_ref, ip, created_at)
        VALUES (_c.id, _row_addr, 'email', 'newsletter', 'revoked', 'customer_portal', public._client_portal_evidence_ref(_uid, 'updates-optin:v2'), NULL, clock_timestamp());
      END IF;
      _changed := true;
    END IF;
  ELSIF _ch = 'email' AND _topic IS NULL AND p_enabled THEN
    _disclosure := 'email-pref:v2';
    IF EXISTS (SELECT 1 FROM public.paige_suppressions s
                WHERE s.tenant_id = _c.tenant_id AND s.channel = 'email'
                  AND public._comms_row_is_contacts(_c.tenant_id, _c.id, _addr, _uniq, s.contact_id, s.address_normalized)) THEN
      -- A row the customer did not set themselves keeps email off; name who holds it.
      SELECT CASE
          WHEN count(*) = 0 THEN NULL
          WHEN bool_or(s.reason = 'manual') THEN 'EMAIL_PAUSED_BY_BUSINESS'
          WHEN bool_or(s.reason = 'bounce_hard') THEN 'EMAIL_UNDELIVERABLE'
          ELSE 'EMAIL_PAUSED_BY_BUSINESS'
        END INTO _err
        FROM public.paige_suppressions s
       WHERE s.tenant_id = _c.tenant_id AND s.channel = 'email'
         AND NOT public._suppression_customer_liftable(s.source, s.reason)
         AND public._comms_row_is_contacts(_c.tenant_id, _c.id, _addr, _uniq, s.contact_id, s.address_normalized);
      IF _err IS NULL THEN
        SELECT coalesce(bool_or(s.reason IN ('complaint','unsubscribe_link')), false) INTO _took_back
          FROM public.paige_suppressions s
         WHERE s.tenant_id = _c.tenant_id AND s.channel = 'email'
           AND public._comms_row_is_contacts(_c.tenant_id, _c.id, _addr, _uniq, s.contact_id, s.address_normalized);
        DELETE FROM public.paige_suppressions s
         WHERE s.tenant_id = _c.tenant_id AND s.channel = 'email'
           AND public._suppression_customer_liftable(s.source, s.reason)
           AND public._comms_row_is_contacts(_c.tenant_id, _c.id, _addr, _uniq, s.contact_id, s.address_normalized);
        IF _took_back THEN
          -- The customer took back their own spam report or unsubscribe click (integrator default (owner may overrule), round 2).
          -- Two events, in this order: the 'granted' is the evidence of that affirmative act; the
          -- newsletter 'revoked' after it keeps them out of Updates and offers, and keeps marketing
          -- automations (tenantConsent reads the latest email event of any topic) closed until they
          -- subscribe again themselves. Email back on is never a marketing opt-in (D4).
          _at := clock_timestamp();
          INSERT INTO public.paige_consent_events(contact_id, address_normalized, channel, topic, action, source, evidence_ref, ip, created_at)
          VALUES (_c.id, _row_addr, 'email', NULL, 'granted', 'customer_portal', public._client_portal_evidence_ref(_uid, _disclosure), NULL, _at);
          INSERT INTO public.paige_consent_events(contact_id, address_normalized, channel, topic, action, source, evidence_ref, ip, created_at)
          VALUES (_c.id, _row_addr, 'email', 'newsletter', 'revoked', 'customer_portal', public._client_portal_evidence_ref(_uid, 'updates-optin:v2'), NULL, _at + interval '1 microsecond');
        END IF;
        -- Otherwise (their own portal choice) no event: resuming email to someone the business already
        -- serves is not marketing consent, and a 'granted' would open tenantConsent.
        _changed := true;
      END IF;
    END IF;
  ELSIF _ch = 'email' AND p_enabled THEN
    _disclosure := 'updates-optin:v2';
    IF _before #>> '{updates,state}' <> 'subscribed' THEN
      IF _before #>> '{email,state}' = 'no_address' THEN _err := 'NO_EMAIL_ADDRESS';
      ELSIF _before #>> '{email,state}' <> 'on' THEN _err := 'EMAIL_OFF';
      ELSE
        INSERT INTO public.paige_consent_events(contact_id, address_normalized, channel, topic, action, source, evidence_ref, ip, created_at)
        VALUES (_c.id, _row_addr, 'email', 'newsletter', 'granted', 'customer_portal', public._client_portal_evidence_ref(_uid, _disclosure), NULL, clock_timestamp());
        _changed := true;
      END IF;
    END IF;
  ELSIF _ch = 'email' THEN
    _disclosure := 'updates-optin:v2';
    IF _before #>> '{updates,state}' IN ('subscribed','paused') THEN
      INSERT INTO public.paige_consent_events(contact_id, address_normalized, channel, topic, action, source, evidence_ref, ip, created_at)
      VALUES (_c.id, _row_addr, 'email', 'newsletter', 'revoked', 'customer_portal', public._client_portal_evidence_ref(_uid, _disclosure), NULL, clock_timestamp());
      _changed := true;
    END IF;
  ELSIF NOT p_enabled THEN
    _disclosure := 'sms-pref:v2';
    IF (_before #>> '{sms,can_turn_off}')::boolean THEN
      INSERT INTO public.paige_suppressions(contact_id, address_normalized, channel, reason, source, created_at)
      VALUES (_c.id, _row_addr, 'sms', 'customer_request', 'customer_portal', clock_timestamp()) ON CONFLICT DO NOTHING;
      INSERT INTO public.paige_consent_events(contact_id, address_normalized, channel, topic, action, source, evidence_ref, ip, created_at)
      VALUES (_c.id, _row_addr, 'sms', NULL, 'revoked', 'customer_portal', public._client_portal_evidence_ref(_uid, _disclosure), NULL, clock_timestamp());
      _changed := true;
    END IF;
  ELSE
    -- D1 (owner): texts are never turned ON from the portal. TCPA consent must come from the
    -- subscriber of the number, and the portal phone is self-edited and unverified. The honest route
    -- is replying START to a text from the business (handle-inbound-sms records it with carrier
    -- evidence). A state that is already on replays.
    _disclosure := 'sms-pref:v2';
    IF _before #>> '{sms,state}' <> 'on' THEN _err := 'SMS_OPT_IN_UNAVAILABLE'; END IF;
  END IF;

  PERFORM set_config('paige.customer_consent_write', '', true);
  PERFORM set_config('paige.customer_consent_contact', '', true);

  IF _changed THEN
    INSERT INTO public.audit_logs(user_id, entity, action, entity_id, data)
    VALUES (_uid, 'client_portal', 'communication_preference_set', _c.id,
      jsonb_build_object('actor_user_id', _uid, 'tenant_id', _c.tenant_id, 'client_id', _c.id,
        'channel', _ch, 'topic', _topic, 'enabled', p_enabled, 'disclosure', _disclosure,
        'via', 'client_portal_set_communication_preference'));
  END IF;
  _after := public.client_portal_communication_preferences(_c.tenant_id);
  IF _after IS NULL OR _after->>'tenant_id' IS DISTINCT FROM _c.tenant_id::text THEN
    RAISE EXCEPTION 'customer preferences readback unavailable' USING ERRCODE = '42501';
  END IF;
  IF _err IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', _err, 'preferences', _after);
  END IF;
  RETURN jsonb_build_object('ok', true, 'replayed', NOT _changed, 'preferences', _after);
END $$;
REVOKE ALL ON FUNCTION public.client_portal_set_communication_preference(text, text, boolean, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.client_portal_set_communication_preference(text, text, boolean, uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.client_portal_set_communication_preference(text, text, boolean, uuid) IS
  'E09 Slice 6: the customer''s own email / texts / Updates choice. Off is always allowed; email back on only lifts the customer''s own rows (their portal choice, unsubscribe click or spam report); texts on is not offered (D1). Evidence is an authenticated portal session by uid; no IP is stored (M7).';

-- ── 9. The customer's data-sharing writer: the first and only legitimate writer of the flag ──────
CREATE OR REPLACE FUNCTION public.client_portal_set_shared_context_consent(p_allow boolean, p_tenant_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _uid uuid := auth.uid();
  _client_id uuid;
  _c public.clients%ROWTYPE;
  _changed boolean := false;
  _after jsonb;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'customer authentication required' USING ERRCODE = '42501';
  END IF;
  IF p_allow IS NULL THEN
    RAISE EXCEPTION 'BAD_PREFERENCE: allow must be true or false' USING ERRCODE = '22023';
  END IF;
  _client_id := public.client_portal_relationship_id(p_tenant_id);
  IF _client_id IS NULL THEN
    RAISE EXCEPTION 'customer relationship unavailable' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('portal_pref:' || _client_id::text, 0));
  SELECT c.* INTO _c FROM public.clients c
   WHERE c.id = _client_id AND c.linked_user_id = _uid AND c.status = 'active' AND c.merged_into_contact_id IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'customer relationship unavailable' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.tenants t WHERE t.id = _c.tenant_id AND t.status = 'active' FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'customer relationship unavailable' USING ERRCODE = '42501';
  END IF;
  IF coalesce(_c.paige_shared_context_consent, false) IS DISTINCT FROM p_allow THEN
    PERFORM set_config('paige.customer_consent_write', 'on', true);
    PERFORM set_config('paige.customer_consent_contact', _c.id::text, true);
    -- Also bumps clients.updated_at (update_clients_updated_at), so an open profile form gets the
    -- existing 40001 "changed; reload" answer on its next save.
    UPDATE public.clients SET paige_shared_context_consent = p_allow,
           paige_shared_context_consent_updated_at = clock_timestamp()
     WHERE id = _c.id AND tenant_id = _c.tenant_id AND linked_user_id = _uid;
    PERFORM set_config('paige.customer_consent_write', '', true);
    PERFORM set_config('paige.customer_consent_contact', '', true);
    INSERT INTO public.audit_logs(user_id, entity, action, entity_id, data)
    VALUES (_uid, 'client_portal', 'shared_context_consent_set', _c.id,
      jsonb_build_object('actor_user_id', _uid, 'tenant_id', _c.tenant_id, 'client_id', _c.id,
        'allowed', p_allow, 'disclosure', 'data-sharing:v1',
        'disclosure_md5', left(md5(public.client_portal_consent_disclosure('data-sharing:v1')), 12),
        'via', 'client_portal_set_shared_context_consent'));
    _changed := true;
  END IF;
  _after := public.client_portal_communication_preferences(_c.tenant_id);
  IF _after IS NULL OR (_after #>> '{data_sharing,allowed}')::boolean IS DISTINCT FROM p_allow THEN
    RAISE EXCEPTION 'customer preferences readback unavailable' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object('ok', true, 'replayed', NOT _changed, 'preferences', _after);
END $$;
REVOKE ALL ON FUNCTION public.client_portal_set_shared_context_consent(boolean, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.client_portal_set_shared_context_consent(boolean, uuid) TO authenticated, service_role;

-- Only the customer's RPC can turn data sharing ON; every path, service role included, INSERT included
-- (M4). Turning it off stays open to staff and service: it is the more restrictive direction.
CREATE OR REPLACE FUNCTION public._clients_shared_context_consent_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.paige_shared_context_consent IS TRUE
     AND (TG_OP = 'INSERT' OR OLD.paige_shared_context_consent IS DISTINCT FROM true)
     AND (current_setting('paige.customer_consent_write', true) IS DISTINCT FROM 'on'
          OR current_setting('paige.customer_consent_contact', true) IS DISTINCT FROM NEW.id::text) THEN
    RAISE EXCEPTION 'SHARED_CONTEXT_CUSTOMER_ONLY: only the client can allow this, from their portal account'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._clients_shared_context_consent_guard() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_clients_shared_context_consent_guard
  BEFORE INSERT OR UPDATE OF paige_shared_context_consent ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public._clients_shared_context_consent_guard();

-- ── 10. The owner read ─────────────────────────────────────────────────────────────────────────
-- Slice 3 owner authority: the caller's current workspace must be the one named, and the caller must
-- be its owner/admin (never a global role, §59). A foreign or missing contact answers the same 42501.
-- Read-only: there is no owner writer of a customer's choice. Addresses are not returned even here.
CREATE OR REPLACE FUNCTION public.read_client_communication_state(_expected_tenant_id uuid, _contact_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _c public.clients%ROWTYPE;
  _s jsonb;
BEGIN
  IF auth.uid() IS NULL OR _expected_tenant_id IS NULL
     OR public.current_user_tenant_id() IS DISTINCT FROM _expected_tenant_id
     OR NOT public.is_tenant_admin(_expected_tenant_id) THEN
    RAISE EXCEPTION 'Client unavailable' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO _c FROM public.clients WHERE id = _contact_id AND tenant_id = _expected_tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Client unavailable' USING ERRCODE = '42501';
  END IF;
  _s := public._client_communication_state(_c.tenant_id, _c.id);
  RETURN jsonb_build_object(
    'schema_version', 1,
    'tenant_id', _c.tenant_id,
    'contact_id', _c.id,
    'email', _s->'email',
    'sms', _s->'sms',
    'updates', _s->'updates',
    'data_sharing', _s->'data_sharing',
    'quiet_hours', _s->'quiet_hours',
    'portal_joined', _c.linked_user_id IS NOT NULL,
    'do_not_contact', coalesce(_c.do_not_contact, false),
    'dnd_active', coalesce(_c.dnd_active, false) AND (_c.dnd_until IS NULL OR _c.dnd_until > now()),
    'read_at', clock_timestamp());
END $$;
REVOKE ALL ON FUNCTION public.read_client_communication_state(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.read_client_communication_state(uuid, uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.read_client_communication_state(uuid, uuid) IS
  'E09 Slice 6: the owner''s read-only view of how one client can be reached. Owner/admin of the current workspace only. Never a writer.';

-- ── 11. Staff pause / lift, restated (§1c, B1, B2, D3) ─────────────────────────────────────────
-- Same signature and return keys. Changes: the guard is owner/admin of the caller's current workspace
-- (was a global role, §59); the reason is always 'manual' (a staff pause never displays as the
-- contact's STOP or unsubscribe); a lift refuses while the contact holds a row on that channel, on the
-- service path too; a lift no longer writes 'granted' (lifting the business's own pause is not the
-- contact's consent, D3). The pause still writes its 'revoked' audit event.
CREATE OR REPLACE FUNCTION public.set_contact_channel_suppression(_contact_id uuid, _channel text, _suppressed boolean, _reason text DEFAULT 'manual'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  _caller uuid := auth.uid();
  _tenant uuid;
  _ch     text := lower(coalesce(_channel, ''));
  _rsn    constant text := 'manual';
  _n      integer := 0;
  _changed boolean := false;
  _addr   text;
  _uniq   boolean;
begin
  -- Only the two channels paige_suppressions actually backs (§13 — never a fake write).
  if _ch not in ('sms', 'email') then
    raise exception 'SUPPRESSION_UNSUPPORTED_CHANNEL: % (only sms|email are supported)', _ch
      using errcode = '22023';
  end if;
  -- _reason is accepted for signature compatibility and ignored: a business pause is 'manual'.

  if _caller is not null then
    _tenant := public.current_user_tenant_id();
    if _tenant is null or not public.is_tenant_admin(_tenant) then
      raise exception 'SUPPRESSION_FORBIDDEN: owner or admin of this business required' using errcode = '42501';
    end if;
  else
    -- Service-role (Paige headless): scope to the contact's own tenant.
    select c.tenant_id into _tenant from public.clients c where c.id = _contact_id;
    if _tenant is null then
      raise exception 'SUPPRESSION_NO_TENANT: contact not found' using errcode = '22023';
    end if;
  end if;

  -- The contact must belong to the resolved tenant (§9 — no cross-tenant write).
  if not exists (select 1 from public.clients where id = _contact_id and tenant_id = _tenant) then
    raise exception 'SUPPRESSION_CONTACT_NOT_IN_TENANT' using errcode = '42501';
  end if;

  -- The customer's portal RPC takes the same key, so a pause/lift and a customer choice never race.
  perform pg_advisory_xact_lock(hashtextextended('portal_pref:' || _contact_id::text, 0));

  if _suppressed then
    -- clock_timestamp(), not the transaction's now(): "the latest event decides", so two choices
    -- in one transaction must still order truthfully.
    insert into public.paige_suppressions (contact_id, channel, reason, source, created_at)
    values (_contact_id, _ch, _rsn, 'admin_ui', clock_timestamp())
    on conflict do nothing;
    get diagnostics _n = row_count;
    _changed := (_n > 0);
    if _changed then
      insert into public.paige_consent_events (contact_id, channel, action, source, created_at)
      values (_contact_id, _ch, 'revoked', 'admin_ui', clock_timestamp());
    end if;
  else
    select a.address, a.address_unique into _addr, _uniq
      from public._comms_contact_address(_tenant, _contact_id, _ch) a;
    if exists (select 1 from public.paige_suppressions s
                where s.tenant_id = _tenant and s.channel = _ch
                  and public._suppression_customer_held(s.source, s.reason)
                  and public._comms_row_is_contacts(_tenant, _contact_id, _addr, _uniq, s.contact_id, s.address_normalized)) then
      raise exception 'SUPPRESSION_HELD_BY_CONTACT: % was turned off by the contact. Only they can turn it back on.',
        case _ch when 'sms' then 'Texting' else 'Email' end
        using errcode = '42501';
    end if;
    delete from public.paige_suppressions
      where contact_id = _contact_id and channel = _ch and tenant_id = _tenant
        and not public._suppression_customer_held(source, reason);
    get diagnostics _n = row_count;
    _changed := (_n > 0);
  end if;

  return jsonb_build_object(
    'ok', true,
    'contact_id', _contact_id,
    'channel', _ch,
    'suppressed', _suppressed,
    'changed', _changed
  );
end $function$;
REVOKE ALL ON FUNCTION public.set_contact_channel_suppression(uuid, text, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_contact_channel_suppression(uuid, text, boolean, text) TO authenticated, service_role;

-- ── 12. load_contact_context: the refusal message only (§2, §13) ───────────────────────────────
-- The old text told staff to "Ask them to enable in their workspace settings" (no such setting) and
-- named a "coach". The body is re-issued byte-for-byte from production (prosrc md5
-- b10016fb2bd5236bc7f268b936e2cb81); only that one literal differs (pgTAP case 15 proves it).
CREATE OR REPLACE FUNCTION public.load_contact_context(p_contact_id uuid, p_scopes text[] DEFAULT ARRAY['contact'::text])
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_client public.clients%ROWTYPE;
  v_bundle jsonb := '{}'::jsonb;
  v_surfaces text[] := '{}';
  v_row_count int := 0;
  v_load_id uuid;
  v_consent boolean;
  v_tenant uuid;
  r record;
  q text;
  data jsonb;
BEGIN
  SELECT * INTO v_client FROM public.clients WHERE id = p_contact_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'CONTACT_NOT_FOUND');
  END IF;
  v_tenant := v_client.tenant_id;
  v_consent := COALESCE(v_client.paige_shared_context_consent, false);
  IF v_client.linked_user_id = auth.uid() THEN
    v_consent := true;
  END IF;
  IF NOT v_consent THEN
    INSERT INTO public.paige_context_loads(tenant_id, contact_id, caller_user_id, caller_role, scope, surfaces_used, row_count, consent_state)
    VALUES (v_tenant, p_contact_id, auth.uid(), 'coach', 'contact', '{}', 0, 'denied')
    RETURNING id INTO v_load_id;
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'CONSENT_NOT_GRANTED',
      'message', 'This client hasn''t allowed this yet. They can turn it on in their portal account.',
      'load_id', v_load_id
    );
  END IF;
  FOR r IN
    SELECT surface, table_name, context_fk_column, context_field_whitelist, context_max_rows, context_priority
    FROM public.paige_data_source_registry
    WHERE paige_context_eligible = true
      AND context_scope = ANY(p_scopes)
      AND array_length(context_field_whitelist,1) > 0
      AND table_name IS NOT NULL
      AND context_fk_column IS NOT NULL
    ORDER BY context_priority ASC
  LOOP
    BEGIN
      q := format(
        'SELECT coalesce(jsonb_agg(row_to_json(t)), ''[]''::jsonb) FROM (SELECT %s FROM public.%I WHERE %I = $1 LIMIT %s) t',
        (SELECT string_agg(quote_ident(c), ',') FROM unnest(r.context_field_whitelist) c),
        r.table_name,
        r.context_fk_column,
        r.context_max_rows
      );
      EXECUTE q INTO data USING p_contact_id;
      IF data IS NOT NULL AND jsonb_array_length(data) > 0 THEN
        v_bundle := v_bundle || jsonb_build_object(r.surface, data);
        v_surfaces := array_append(v_surfaces, r.surface);
        v_row_count := v_row_count + jsonb_array_length(data);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      CONTINUE;
    END;
  END LOOP;
  INSERT INTO public.paige_context_loads(tenant_id, contact_id, caller_user_id, caller_role, scope, surfaces_used, row_count, consent_state)
  VALUES (v_tenant, p_contact_id, auth.uid(), 'coach', 'contact', v_surfaces, v_row_count,
          CASE WHEN v_client.linked_user_id = auth.uid() THEN 'self' ELSE 'granted' END)
  RETURNING id INTO v_load_id;
  RETURN jsonb_build_object(
    'ok', true,
    'load_id', v_load_id,
    'contact_id', p_contact_id,
    'surfaces_used', v_surfaces,
    'row_count', v_row_count,
    'bundle', v_bundle
  );
END;
$function$;
-- §59: both producers are authenticated JWTs (paige-context-router with the caller's bearer;
-- ContactPaigePanel through the signed-in client). No anon caller exists.
REVOKE ALL ON FUNCTION public.load_contact_context(uuid, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.load_contact_context(uuid, text[]) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_propose_paige_actions(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_propose_paige_actions(uuid, jsonb) TO authenticated, service_role;

-- ── 13. read_email_marketing_dashboard: a portal opt-out is an unsubscribe (M6) ─────────────────
-- Restated from production (prosrc md5 841df313f3e6ba35128b9e9a24d62235); the only changes are the
-- three reason lists, which now include 'customer_request'. Keys and kinds are unchanged.
CREATE OR REPLACE FUNCTION public.read_email_marketing_dashboard(p_days integer DEFAULT 30, p_tz text DEFAULT 'UTC'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  t uuid := public._email_caller_tenant();
  days integer := CASE WHEN p_days IN (7, 30, 90) THEN p_days ELSE 30 END;
  tz text := CASE WHEN EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = p_tz) THEN p_tz ELSE 'UTC' END;
  now_ts timestamptz := now();
  cur_from timestamptz;
  prev_from timestamptz;
  used integer;
  out jsonb;
BEGIN
  cur_from := now_ts - make_interval(days => days);
  prev_from := now_ts - make_interval(days => days * 2);
  used := public._email_used_today(t);

  WITH r AS (
    SELECT r.*, v.conversion_goal FROM public.email_campaign_recipients r
      JOIN public.email_campaign_versions v ON v.id = r.version_id
     WHERE r.tenant_id = t AND r.sent_at >= prev_from
  ), clicks AS (
    -- every click in either period, whenever its email went out
    SELECT r.*, v.conversion_goal FROM public.email_campaign_recipients r
      JOIN public.email_campaign_versions v ON v.id = r.version_id
     WHERE r.tenant_id = t AND r.clicked_at >= prev_from
  ), conv AS (
    SELECT r.client_id, r.clicked_at FROM clicks r
     WHERE r.clicked_at IS NOT NULL AND r.client_id IS NOT NULL AND r.conversion_goal <> 'none' AND (
       (r.conversion_goal = 'form_submission' AND EXISTS (SELECT 1 FROM public.growth_form_submissions g
          WHERE g.tenant_id = t AND g.contact_id = r.client_id AND g.created_at > r.clicked_at AND g.created_at <= r.clicked_at + interval '7 days'))
       OR (r.conversion_goal = 'booking' AND EXISTS (SELECT 1 FROM public.internal_bookings b
          WHERE b.tenant_id = t AND b.contact_id = r.client_id AND b.created_at > r.clicked_at AND b.created_at <= r.clicked_at + interval '7 days'
            AND lower(COALESCE(b.status, '')) NOT IN ('cancelled', 'canceled')))
       OR (r.conversion_goal = 'deal_created' AND EXISTS (SELECT 1 FROM public.deals d
          WHERE d.tenant_id = t AND d.contact_client_id = r.client_id AND d.created_at > r.clicked_at AND d.created_at <= r.clicked_at + interval '7 days'))
       OR (r.conversion_goal = 'invoice_paid' AND EXISTS (SELECT 1 FROM public.paige_invoices i
          WHERE i.tenant_id = t AND i.contact_id = r.client_id AND i.paid_at > r.clicked_at AND i.paid_at <= r.clicked_at + interval '7 days'))
     )
  ), stats AS (
    SELECT
      count(*) FILTER (WHERE sent_at >= cur_from) AS sent,
      count(*) FILTER (WHERE sent_at < cur_from) AS sent_prev,
      count(*) FILTER (WHERE sent_at >= cur_from AND route = 'managed') AS tracked,
      count(*) FILTER (WHERE sent_at < cur_from AND route = 'managed') AS tracked_prev,
      count(*) FILTER (WHERE sent_at >= cur_from AND route = 'managed' AND opened_at IS NOT NULL) AS opened,
      count(*) FILTER (WHERE sent_at < cur_from AND route = 'managed' AND opened_at IS NOT NULL) AS opened_prev,
      count(*) FILTER (WHERE sent_at >= cur_from AND route = 'managed' AND clicked_at IS NOT NULL) AS clicked,
      count(*) FILTER (WHERE sent_at < cur_from AND route = 'managed' AND clicked_at IS NOT NULL) AS clicked_prev,
      count(*) FILTER (WHERE sent_at >= cur_from AND bounced_at IS NOT NULL) AS bounced
    FROM r
  )
  SELECT jsonb_build_object(
    'period_days', days, 'time_zone', tz, 'generated_at', now_ts,
    'stats', (SELECT to_jsonb(s) FROM stats s) || jsonb_build_object(
      -- a contact who reached a goal counts once in a period, however many campaigns they clicked
      'conversions', (SELECT count(DISTINCT client_id) FROM conv WHERE clicked_at >= cur_from),
      'conversions_prev', (SELECT count(DISTINCT client_id) FROM conv WHERE clicked_at >= prev_from AND clicked_at < cur_from),
      'new_subscribers', (SELECT count(*) FROM public.paige_consent_events e WHERE e.tenant_id = t AND e.channel = 'email'
                            AND e.topic = 'newsletter' AND e.action = 'granted' AND e.created_at >= cur_from),
      'new_subscribers_prev', (SELECT count(*) FROM public.paige_consent_events e WHERE e.tenant_id = t AND e.channel = 'email'
                            AND e.topic = 'newsletter' AND e.action = 'granted' AND e.created_at >= prev_from AND e.created_at < cur_from),
      'unsubscribes', (SELECT count(*) FROM public.paige_suppressions s WHERE s.tenant_id = t AND s.channel = 'email'
                            AND s.reason IN ('unsubscribe_link','customer_request') AND s.created_at >= cur_from)),
    'series', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('day', d.day, 'sent', COALESCE(x.sent, 0), 'tracked', COALESCE(x.tracked, 0),
                                          'opened', COALESCE(x.opened, 0), 'clicked', COALESCE(x.clicked, 0)) ORDER BY d.day)
        FROM generate_series((cur_from AT TIME ZONE tz)::date + 1, (now_ts AT TIME ZONE tz)::date, interval '1 day') AS d(day)
        LEFT JOIN (
          SELECT (sent_at AT TIME ZONE tz)::date AS day, count(*) AS sent,
                 count(*) FILTER (WHERE route = 'managed') AS tracked,
                 count(*) FILTER (WHERE route = 'managed' AND opened_at IS NOT NULL) AS opened,
                 count(*) FILTER (WHERE route = 'managed' AND clicked_at IS NOT NULL) AS clicked
            FROM r WHERE sent_at >= cur_from GROUP BY 1) x ON x.day = d.day::date), '[]'::jsonb),
    'campaign_count', (SELECT count(*) FROM public.email_campaigns c WHERE c.tenant_id = t AND c.sequence_id IS NULL),
    'campaigns', COALESCE((
      SELECT jsonb_agg(q.item ORDER BY q.updated_at DESC) FROM (
        SELECT c.updated_at, jsonb_build_object(
          'id', c.id, 'name', c.name, 'kind', c.kind, 'status', c.status, 'blocked_reason', c.blocked_reason,
          'updated_at', c.updated_at, 'version_id', v.id, 'version_state', v.state, 'subject', v.subject,
          'scheduled_for', v.scheduled_for, 'segment_name', sg.name, 'conversion_goal', v.conversion_goal,
          'recipients', COALESCE(NULLIF(cv.total, 0), NULLIF(a.total, 0), v.expected_recipients), 'first_sent_at', a.first_sent, 'last_sent_at', a.last_sent,
          'sent', COALESCE(a.sent, 0), 'tracked', COALESCE(a.tracked, 0), 'opened', COALESCE(a.opened, 0),
          'clicked', COALESCE(a.clicked, 0), 'failed', COALESCE(a.failed, 0), 'not_confirmed', COALESCE(a.unknown, 0),
          'skipped', COALESCE(a.skipped, 0), 'waiting', COALESCE(cv.waiting, 0)) AS item
        FROM public.email_campaigns c
        LEFT JOIN public.email_campaign_versions v ON v.id = c.current_version_id
        LEFT JOIN public.email_segments sg ON sg.id = v.segment_id
        LEFT JOIN LATERAL (
          SELECT count(*) FILTER (WHERE status NOT IN ('cancelled')) AS total, min(sent_at) AS first_sent, max(sent_at) AS last_sent,
                 count(*) FILTER (WHERE status = 'sent') AS sent,
                 count(*) FILTER (WHERE status = 'sent' AND route = 'managed') AS tracked,
                 count(*) FILTER (WHERE route = 'managed' AND opened_at IS NOT NULL) AS opened,
                 count(*) FILTER (WHERE route = 'managed' AND clicked_at IS NOT NULL) AS clicked,
                 count(*) FILTER (WHERE status = 'failed') AS failed,
                 count(*) FILTER (WHERE status = 'outcome_unknown') AS unknown,
                 count(*) FILTER (WHERE status = 'skipped') AS skipped
            FROM public.email_campaign_recipients rr
           WHERE rr.campaign_id = c.id) a ON true
        LEFT JOIN LATERAL (
          SELECT count(*) AS total, count(*) FILTER (WHERE status IN ('planned','sending')) AS waiting
            FROM public.email_campaign_recipients rr WHERE rr.version_id = v.id) cv ON true
        WHERE c.tenant_id = t AND c.sequence_id IS NULL
        ORDER BY c.updated_at DESC LIMIT 8) q), '[]'::jsonb),
    'audience', (
      SELECT jsonb_build_object(
        'contacts', count(*),
        'with_email', count(*) FILTER (WHERE em.has_email),
        'new_leads', count(*) FILTER (WHERE c.lifecycle_stage IN ('new_lead','lead','prospect','nurturing')),
        'customers', count(*) FILTER (WHERE c.lifecycle_stage IN ('won','customer','active','client_active','client_paused','client_funded')),
        'inactive_90', count(*) FILTER (WHERE c.last_contacted_at IS NULL AND c.created_at < now_ts - interval '90 days'
                                         OR c.last_contacted_at < now_ts - interval '90 days'),
        'newsletter_subscribers', count(*) FILTER (WHERE em.has_email AND public._email_newsletter_subscribed(t, c.id, NULL)))
        FROM public.clients c
        LEFT JOIN LATERAL (SELECT EXISTS (SELECT 1 FROM public.client_contact_methods cm WHERE cm.client_id = c.id
                             AND cm.tenant_id = t AND cm.kind = 'email' AND btrim(cm.value) LIKE '%_@_%._%') AS has_email) em ON true
       WHERE c.tenant_id = t AND c.merged_into_contact_id IS NULL),
    'segment_count', (SELECT count(*) FROM public.email_segments s WHERE s.tenant_id = t),
    'segments', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'rule', s.rule,
               'eligible', (SELECT count(*) FROM public._email_audience(t, s.rule, false) a WHERE a.ineligible IS NULL),
               'matched', (SELECT count(*) FROM public._email_audience(t, s.rule, false))) ORDER BY s.updated_at DESC)
        FROM (SELECT * FROM public.email_segments WHERE tenant_id = t ORDER BY updated_at DESC LIMIT 6) s), '[]'::jsonb),
    'activity', COALESCE((
      SELECT jsonb_agg(x.e ORDER BY x.at DESC) FROM (
        SELECT u.e, u.at FROM (
          (SELECT jsonb_build_object('kind', 'campaign_sent', 'at', ls.last_sent, 'title', c.name, 'campaign_id', c.id,
                                     'detail', c.status) AS e, ls.last_sent AS at
             FROM public.email_campaigns c
             JOIN LATERAL (SELECT max(rr.sent_at) AS last_sent FROM public.email_campaign_recipients rr
                            WHERE rr.campaign_id = c.id AND rr.sent_at IS NOT NULL) ls ON ls.last_sent IS NOT NULL
            WHERE c.tenant_id = t AND c.sequence_id IS NULL
            ORDER BY ls.last_sent DESC LIMIT 8)
          UNION ALL
          (SELECT jsonb_build_object('kind', CASE WHEN s.reason IN ('unsubscribe_link','customer_request') THEN 'unsubscribed' ELSE 'bounced' END,
                                     'at', s.created_at, 'detail', s.reason) AS e, s.created_at AS at
             FROM public.paige_suppressions s WHERE s.tenant_id = t AND s.channel = 'email'
              AND s.reason IN ('unsubscribe_link','customer_request','bounce_hard','complaint')
             ORDER BY s.created_at DESC LIMIT 8)
          UNION ALL
          (SELECT jsonb_build_object('kind', 'subscribed', 'at', ce.created_at, 'detail', ce.source) AS e, ce.created_at AS at
             FROM public.paige_consent_events ce WHERE ce.tenant_id = t AND ce.channel = 'email' AND ce.topic = 'newsletter'
              AND ce.action = 'granted'
             ORDER BY ce.created_at DESC LIMIT 8)
        ) u ORDER BY u.at DESC LIMIT 8) x), '[]'::jsonb),
    'sending', jsonb_build_object('daily_cap', public.email_campaign_daily_cap(), 'used_last_24h', used,
                                  'remaining_today', GREATEST(public.email_campaign_daily_cap() - used, 0),
                                  'postal_address_set', public._email_postal_address(t) IS NOT NULL)
  ) INTO out;
  RETURN out;
END $function$;
REVOKE ALL ON FUNCTION public.read_email_marketing_dashboard(integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.read_email_marketing_dashboard(integer, text) TO authenticated;

COMMENT ON TRIGGER trg_clients_shared_context_consent_guard ON public.clients IS
  'E09 Slice 6: only the client''s own portal RPC turns paige_shared_context_consent on. Staff, service and imports may only turn it off.';
COMMENT ON TRIGGER trg_paige_suppressions_delete_guard ON public.paige_suppressions IS
  'E09 Slice 6 (B1): a row the contact holds is lifted only by the contact (their portal RPC) or a trusted service context (their START reply).';
COMMENT ON TRIGGER trg_clients_ledger_keep_opt_outs ON public.clients IS
  'E09 Slice 6 (round 2): deleting a contact keeps the opt-outs they hold, address-keyed, so a re-imported address stays blocked.';
COMMENT ON TRIGGER trg_clients_ledger_follow_merge ON public.clients IS
  'E09 Slice 6 (round 2): a merge moves the archived contact''s suppressions and opt-out events to the winner, so the card and every send gate read one derivation.';

COMMIT;
