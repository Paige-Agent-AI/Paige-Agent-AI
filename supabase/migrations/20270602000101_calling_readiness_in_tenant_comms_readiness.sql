-- INT-345 K-3 — tenant_comms_readiness() learns the CALLING verdict (four facts).
--
-- The canonical voice-readiness classifier (voice-access-token/authorization.ts,
-- classifyVoiceReadiness) stays the token-seam authority. This additive block
-- mirrors its EXACT invariants so READ surfaces — PAIGE's comms_connection_summary,
-- the Settings setup card, Systems Check — all answer "why can't this workspace
-- call" from ONE resolver instead of each inventing its own reading of the rows.
-- A pgTAP suite pins the mirror to the classifier's fixture semantics so the two
-- cannot drift silently.
--
-- FOUR FACTS, never conflated (owner ruling, INT-345 final order):
--   calling.account          absent | incomplete | configured
--   calling.number_assigned  the workspace owns >= 1 ACTIVE number (any capability)
--   calling.primary_selected exactly ONE active primary exists
--   calling.ready            every classifier invariant holds
-- plus code ('calling_ready' | 'calling_not_configured' |
--            'calling_number_needs_verification') and reason_code (the five
-- repairable number states, null unless applicable) — the same vocabulary the
-- dialer already renders.
--
-- BYTE-IDENTICAL OUTSIDE THE ADDITION: the body is the 20261160000000 definer
-- verbatim except (a) v_sub additionally selects id/twilio_subaccount_sid/
-- twiml_app_sid (needed to evaluate the subaccount-match invariant and report
-- app state), (b) one new aggregate select over active primary numbers, and
-- (c) the new 'calling' key inserted after 'subaccount'. Every existing key,
-- predicate, ordering and comment is untouched.

create or replace function public.tenant_comms_readiness()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tenant        uuid;
  v_sub           record;
  v_num           record;
  v_a2p           record;
  v_consent_count int := 0;
  v_suppressed    int := 0;
  v_brand         jsonb;
  v_legal         record;
  v_sms_total     int := 0;
  v_sms_failed    int := 0;
  v_sms_delivered int := 0;
  v_last_inbound  timestamptz;
  v_delivery      text;
  v_blocked       text;
  v_billing       record;
  v_metered_30d   int := 0;
  v_call          record;
  v_call_reason   text;
  v_call_code     text;
begin
  -- CALLER SCOPE ENFORCED IN-BODY (§59). This is SECURITY DEFINER because it
  -- reads tenant_twilio_subaccounts, which authenticated no longer holds a
  -- grant on. The grant is not the guard.
  if auth.uid() is null then
    raise exception 'COMMS_READINESS_UNAUTHENTICATED' using errcode = '42501';
  end if;
  v_tenant := public.current_user_tenant_id();
  if v_tenant is null then
    raise exception 'COMMS_READINESS_NO_TENANT' using errcode = '42501';
  end if;
  -- NOTE: the LIVE body's gate is the RETIRED-ROLE form — 20270504000000 edited
  --  array['admin','coach'] to array['admin'] in place. This re-emit keeps that form
  --  (re-emitting from the pre-retirement migration text would resurrect the read).
  if not (public.is_platform_operator()
          or public.has_any_role(auth.uid(), array['admin'])) then
    raise exception 'COMMS_READINESS_FORBIDDEN' using errcode = '42501';
  end if;

  -- Selects the same three credential fields `resolveTwilioCreds` requires. It is
  -- their PRESENCE, not `status`/`active`, that decides whether a send can
  -- authenticate — the creds resolver reads `status` and never uses it. Reporting
  -- "connected" from status alone would let a row with a null api_key_sid render
  -- "Ready to text" while every send returns twilio_subaccount_api_key_missing.
  -- (INT-345: id/twilio_subaccount_sid/twiml_app_sid additionally selected for the
  --  calling block's subaccount-match + app-state invariants.)
  select id, tenant_id, status, active, twilio_subaccount_sid, twiml_app_sid,
         (twilio_subaccount_sid is not null
          and auth_token_vault_ref is not null
          and api_key_sid is not null) as creds_complete
    into v_sub
    from public.tenant_twilio_subaccounts
   where tenant_id = v_tenant
   limit 1;

  -- The SAME predicate send-message enforces: active, SMS-capable, primary first.
  select phone_number, status, capabilities into v_num
    from public.tenant_phone_numbers
   where tenant_id = v_tenant
     and status = 'active'
     -- No ::boolean cast: `{"sms":"yes"}` would raise and take the whole read
     -- down. Absent or JSON-null means unspecified, which the send path includes.
     and coalesce(nullif(capabilities->'sms', 'null'::jsonb), 'true'::jsonb) = 'true'::jsonb
   order by is_primary desc, purchased_at desc nulls last
   limit 1;

  -- INT-345 — the CALLING aggregate over ACTIVE PRIMARY numbers, evaluating the
  -- classifier's five number invariants in the SAME ORDER classifyVoiceReadiness
  -- does: count, subaccount match, provider binding, voice capability.
  select count(*)                                              as n_primary,
         count(*) filter (where pn.subaccount_id = v_sub.id)  as n_on_subaccount,
         count(*) filter (where pn.twilio_sid is not null)     as n_provider_bound,
         count(*) filter (where pn.capabilities->'voice' = 'true'::jsonb) as n_voice_capable,
         (array_agg(pn.phone_number order by pn.purchased_at nulls first))[1] as primary_e164
    into v_call
    from public.tenant_phone_numbers pn
   where pn.tenant_id = v_tenant
     and pn.status = 'active'
     and pn.is_primary;

  if v_sub.tenant_id is null or coalesce(v_sub.active, false) is not true or coalesce(v_sub.status, '') <> 'active' then
    v_call_code := 'calling_not_configured';
    v_call_reason := null;
  elsif v_call.n_primary = 0 then
    v_call_code := 'calling_number_needs_verification';
    v_call_reason := 'no_active_primary_number';
  elsif v_call.n_primary > 1 then
    v_call_code := 'calling_number_needs_verification';
    v_call_reason := 'multiple_active_primary_numbers';
  elsif v_call.n_on_subaccount = 0 then
    v_call_code := 'calling_number_needs_verification';
    v_call_reason := 'primary_number_under_different_subaccount';
  elsif v_call.n_provider_bound < v_call.n_primary then
    v_call_code := 'calling_number_needs_verification';
    v_call_reason := 'primary_number_missing_provider_binding';
  elsif v_call.n_voice_capable < v_call.n_primary then
    v_call_code := 'calling_number_needs_verification';
    v_call_reason := 'primary_number_voice_capability_unconfirmed';
  else
    v_call_code := 'calling_ready';
    v_call_reason := null;
  end if;

  select status, brand_status, campaign_status, submitted_at into v_a2p
    from public.tenant_a2p_registrations
   where tenant_id = v_tenant
   limit 1;

  -- How many recipients CURRENTLY consent — the latest event per recipient, which
  -- is what `runPreSend` step 3 evaluates. A raw count of 'granted' rows would
  -- report "ready" for a contact who granted and later texted STOP.
  select count(*) into v_consent_count
    from (
      select distinct on (coalesce(contact_id::text, address_normalized))
             action
        from public.paige_consent_events
       where tenant_id = v_tenant and channel = 'sms'
       order by coalesce(contact_id::text, address_normalized), created_at desc
    ) latest
   where latest.action = 'granted';

  select count(*) into v_suppressed
    from public.paige_suppressions
   where tenant_id = v_tenant and channel = 'sms';

  select brand into v_brand from public.tenants where id = v_tenant;

  -- Setup's OWN record, which is where the current save path
  -- (save_solo_setup_context -> save_solo_setup_identity, 20261046000000) actually writes these
  -- fields. Reading only tenants.brand told Mogul Maker Academy its website and business phone
  -- were missing while both sat in Setup -- the same wrong-pointer defect 20261112000000 fixed for
  -- the Systems Check runners and PAIGE's brief, in a consumer that was never in that sweep.
  select legal_business_name, website_url, support_phone
    into v_legal
    from public.tenant_legal_profile
   where tenant_id = v_tenant;

  -- Delivery signal, read from real message rows. This is NOT a claim about
  -- webhook registration — it reports only what the message ledger shows.
  select count(*) filter (where direction = 'outbound'),
         count(*) filter (where direction = 'outbound' and status = 'failed'),
         count(*) filter (where direction = 'outbound' and status = 'delivered'),
         max(sent_at) filter (where direction = 'inbound')
    into v_sms_total, v_sms_failed, v_sms_delivered, v_last_inbound
    from public.messages
   where tenant_id = v_tenant
     and channel_type = 'sms'
     and created_at > now() - interval '30 days';

  v_delivery := case
    when v_sms_total = 0 then 'no_activity'
    when v_sms_failed > 0 and v_sms_delivered = 0 then 'failing'
    when v_sms_failed > 0 then 'mixed'
    -- Sent, but not one delivery receipt has landed. Calling that "delivering"
    -- would be a green health claim built on the ABSENCE of evidence.
    when v_sms_delivered = 0 then 'awaiting_receipts'
    else 'delivering'
  end;

  -- Billing for messaging. Settings -> Connections owns billing setup, so the one
  -- canonical record has to carry it rather than leaving the surface to invent an
  -- answer. Read-only: this REPORTS billing state and never activates, changes or
  -- charges anything.
  --
  -- SCOPED EXPLICITLY to v_tenant. This function is SECURITY DEFINER, so it
  -- bypasses platform_subscriptions' RLS entirely; the `where tenant_id` below IS
  -- the access control, not the policy (§59 — the grant is never the guard).
  --
  -- Returns NO provider identifier. stripe_subscription_id and stripe_customer_id
  -- are deliberately not selected: a Stripe id is a provider payload, and this
  -- record is consumed by surfaces and by PAIGE.
  select ps.status,
         ps.current_period_end,
         coalesce(ps.cancel_at_period_end, false) as cancel_at_period_end,
         pl.name as plan_name
    into v_billing
    from public.platform_subscriptions ps
    left join public.platform_subscription_plans pl on pl.id = ps.plan_id
   where ps.tenant_id = v_tenant
   order by (ps.status = 'active') desc, ps.current_period_end desc nulls last
   limit 1;

  -- Whether messaging usage is actually being RECORDED against that plan. Nothing
  -- has ever written a platform_metered_events row, so for every tenant today this
  -- resolves to not_recording. Reporting "billed" off an active plan alone would
  -- claim metering that demonstrably is not happening (§13).
  select count(*) into v_metered_30d
    from public.platform_metered_events
   where tenant_id = v_tenant
     and created_at > now() - interval '30 days';

  -- The blocking reason, in send-path order, so the surface can name ONE next step.
  --
  -- Billing is deliberately NOT a term here. This resolver's contract is that it
  -- enforces the SAME predicate send-message enforces, and send-message does not
  -- consult billing. Adding it would make can_send_sms disagree with what the send
  -- path actually does — a readiness record that contradicts the runtime is worse
  -- than one that reports less. Billing is reported, never gating.
  v_blocked := case
    when v_sub.tenant_id is null            then 'messaging_account_missing'
    when v_sub.creds_complete is not true    then 'messaging_account_inactive'
    when v_num.phone_number is null         then 'no_sms_number'
    when v_a2p.status is null               then 'registration_absent'
    when v_a2p.status <> 'approved'         then 'registration_not_approved'
    when v_consent_count = 0                then 'no_consent_recorded'
    else null
  end;

  return jsonb_build_object(
    'can_send_sms',   v_blocked is null,
    'blocked_reason', v_blocked,
    'subaccount',     case when v_sub.tenant_id is null then 'absent'
                           when v_sub.creds_complete is not true then 'inactive'
                           when coalesce(v_sub.active,false) and coalesce(v_sub.status,'') = 'active' then 'connected'
                           else 'inactive' end,
    -- INT-345 — the CALLING verdict. FOUR facts, never conflated: account,
    -- number assigned, primary selected, ready. reason_code uses the classifier's
    -- vocabulary so every surface names the same repair. number_assigned reports
    -- ANY active owned number (the purchase fact), independent of primary/voice —
    -- buying is not selecting (the owner's Send-from-this ruling).
    'calling',        jsonb_build_object(
                        'ready',            v_call_code = 'calling_ready',
                        'code',             v_call_code,
                        'reason_code',      v_call_reason,
                        'account',          case when v_sub.tenant_id is null then 'absent'
                                                   when v_sub.creds_complete is not true then 'incomplete'
                                                   else 'configured' end,
                        'number_assigned',  exists (select 1
                                                     from public.tenant_phone_numbers anyn
                                                    where anyn.tenant_id = v_tenant
                                                      and anyn.status = 'active'),
                        'primary_selected', coalesce(v_call.n_primary, 0) = 1,
                        'primary_e164',     case when coalesce(v_call.n_primary, 0) = 1
                                                   then v_call.primary_e164 else null end,
                        'twiml_app',        case when v_sub.tenant_id is null then 'absent'
                                                   when v_sub.twiml_app_sid is null then 'pending'
                                                   else 'configured' end),
    'number',         case when v_num.phone_number is null then 'absent' else 'assigned' end,
    'number_e164',    v_num.phone_number,
    -- SETUP FIRST, legacy brand second. These three are PRESENCE booleans -- "is there a business
    -- phone on file at all" -- not provenance claims, which is why a legacy tenants.brand value is
    -- an honest fallback here even though get_business_context_readiness deliberately refuses one.
    -- That contract reports WHERE a value came from, so it cannot call a legacy value
    -- owner_confirmed without inventing a provenance; this one only reports THAT a value exists,
    -- and a legacy value genuinely does exist. Measured across all 13 tenants on production
    -- 2026-09-03: this flips Mogul Maker Academy false->true on all three and changes NOTHING for
    -- any other tenant -- zero regressions, and it does not pre-empt the still-open owner decision
    -- about the two workspaces whose values live only in legacy brand.
    'business',       jsonb_build_object(
                        'has_name',    coalesce(nullif(v_legal.legal_business_name,''), nullif(v_brand->>'business_name',''), nullif(v_brand->>'name','')) is not null,
                        'has_website', coalesce(nullif(v_legal.website_url,''), nullif(v_brand->>'website','')) is not null,
                        'has_phone',   coalesce(nullif(v_legal.support_phone,''), nullif(v_brand->>'business_phone','')) is not null),
    'a2p',            case when v_a2p.status is null then 'absent'
                           when v_a2p.status = 'approved' then 'approved'
                           when v_a2p.submitted_at is not null then 'submitted'
                           else 'prepared' end,
    'consent',        jsonb_build_object(
                        'granted_count',    v_consent_count,
                        'suppressed_count', v_suppressed,
                        'state', case when v_consent_count = 0 then 'none_recorded' else 'ready' end),
    'delivery',       jsonb_build_object(
                        'state',           v_delivery,
                        'sent_30d',        v_sms_total,
                        'delivered_30d',   v_sms_delivered,
                        'failed_30d',      v_sms_failed,
                        -- NOT REPORTED, deliberately: nothing writes an inbound
                        -- SMS row to public.messages (handle-inbound-sms inserts
                        -- into paige_conversations), so this column is
                        -- structurally always null. A definite "no replies
                        -- received" from an unwritten column is the same class of
                        -- lie as a fabricated positive.
                        'last_inbound_at', v_last_inbound,
                        'inbound_reporting', 'unavailable'),
    'billing',        jsonb_build_object(
                        'subscription', case
                                          when v_billing.status is null then 'absent'
                                          when v_billing.status = 'active' then 'active'
                                          else 'inactive' end,
                        'plan_name',            v_billing.plan_name,
                        'period_end',           v_billing.current_period_end,
                        'cancel_at_period_end', coalesce(v_billing.cancel_at_period_end, false),
                        -- Honest today: nothing writes platform_metered_events, so
                        -- this is 'not_recording' for every tenant. It is reported
                        -- rather than hidden so the surface can say messaging usage
                        -- is not being metered instead of implying that it is.
                        'usage_metering', case when v_metered_30d > 0
                                               then 'recording' else 'not_recording' end,
                        'metered_events_30d', v_metered_30d),
    'tenant_id',      v_tenant,
    'resolved_at',    now()
  );
end;
$$;

-- Grants restated from the 20261002000000 posture (readiness is an authenticated +
-- service read; the in-body scope guard is the authority, not the grant).
revoke all on function public.tenant_comms_readiness() from public, anon;
grant execute on function public.tenant_comms_readiness() to authenticated, service_role;

comment on function public.tenant_comms_readiness() is
  'Canonical comms readiness record: SMS send-path truth + business presence + the INT-345 calling verdict (account / number_assigned / primary_selected / ready + classifier reason codes). SECURITY DEFINER by necessity (credential table reads); caller scope enforced in-body.';
