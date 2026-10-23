-- EXP01 consent-repair cases: the Live acknowledgement gate + per-account status read.
-- Runs inside scripts/e01-live-consent-check.mjs (rollback-only). Emits LIVE_CONSENT_PROOF lines.

do $fixture$
begin
  insert into public.tenants(id) values ('11111111-1111-4111-8111-111111111111');
  insert into public.tenants(id, account_type) values ('99999999-9999-4999-8999-999999999999','agency');
  insert into public.tenants(id) values ('88888888-8888-4888-8888-888888888888');
  insert into public.tenant_members(tenant_id,user_id,role,status,is_owner)
    values ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','owner','active',true);
  insert into public.tenant_members(tenant_id,user_id,role,status,is_owner)
    values ('99999999-9999-4999-8999-999999999999','22222222-2222-4222-8222-222222222222','owner','active',true);
end $fixture$;

-- Caller context: the workspace owner, and the service-role lens through which
-- the edge functions call the predicate.
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false);
select set_config('test.tenant','11111111-1111-4111-8111-111111111111',false);
select set_config('request.jwt.claim.role','service_role',false);

-- CASE 1 — eligible member, NO acknowledgement: admission must REFUSE (the P1 gap,
-- closed). The status read says not_acknowledged so the surface offers the disclosure.
do $case1$
declare a boolean; s jsonb;
begin
  select public.paige_live_pilot_authorized_internal('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111') into a;
  select public.paige_live_terms_status() into s;
  if a is not false or s->>'state' is distinct from 'not_acknowledged' then
    raise notice 'LIVE_CONSENT_PROOF FAIL case1 unacknowledged-refused got authorized=% status=%', a, s;
  else
    raise notice 'LIVE_CONSENT_PROOF case1-pass unacknowledged-refused status-not_acknowledged';
  end if;
end $case1$;

-- Acknowledge (the person's own self-service row, exactly as paige_live_accept_terms writes it).
insert into public.paige_live_pilot_subjects(user_id,tenant_id,admitted_by,admitted_at,expires_at,
  accepted_default_provider_retention,accepted_procedural_single_speaker,acceptance_actor_user_id)
values ('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',now(),now()+interval '365 days',true,true,'22222222-2222-4222-8222-222222222222');

-- CASE 2 — same member, acknowledged: admission ADMITS. Self-service eligibility preserved.
do $case2$
declare a boolean; s jsonb; c boolean;
begin
  select public.paige_live_pilot_authorized_internal('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111') into a;
  select public.paige_live_acknowledgement_current_internal('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111') into c;
  perform set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false);
  perform set_config('test.tenant','11111111-1111-4111-8111-111111111111',false);
  select public.paige_live_terms_status() into s;
  if a is not true or c is not true or s->>'state' is distinct from 'acknowledged' then
    raise notice 'LIVE_CONSENT_PROOF FAIL case2 acknowledged-admitted got authorized=% companion=% status=%', a, c, s;
  else
    raise notice 'LIVE_CONSENT_PROOF case2-pass acknowledged-admitted self-service-preserved status-acknowledged';
  end if;
end $case2$;

-- CASE 3 — revocation ends admission AND reports revoked (renewal stops with it).
do $case3$
declare a boolean; s jsonb;
begin
  update public.paige_live_pilot_subjects set revoked_at=now() where tenant_id='11111111-1111-4111-8111-111111111111';
  select public.paige_live_pilot_authorized_internal('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111') into a;
  perform set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false);
  perform set_config('test.tenant','11111111-1111-4111-8111-111111111111',false);
  select public.paige_live_terms_status() into s;
  if a is not false or s->>'state' is distinct from 'revoked' then
    raise notice 'LIVE_CONSENT_PROOF FAIL case3 revoked-refused got authorized=% status=%', a, s;
  else
    raise notice 'LIVE_CONSENT_PROOF case3-pass revoked-refused status-revoked';
  end if;
end $case3$;

-- CASE 4 — expiry ends admission and reports expired.
do $case4$
declare a boolean; s jsonb;
begin
  update public.paige_live_pilot_subjects set revoked_at=null, expires_at=now()-interval '1 day' where tenant_id='11111111-1111-4111-8111-111111111111';
  select public.paige_live_pilot_authorized_internal('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111') into a;
  perform set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false);
  perform set_config('test.tenant','11111111-1111-4111-8111-111111111111',false);
  select public.paige_live_terms_status() into s;
  if a is not false or s->>'state' is distinct from 'expired' then
    raise notice 'LIVE_CONSENT_PROOF FAIL case4 expired-refused got authorized=% status=%', a, s;
  else
    raise notice 'LIVE_CONSENT_PROOF case4-pass expired-refused status-expired';
  end if;
end $case4$;

-- CASE 5 — partial acceptance (one flag false) is NOT an acknowledgement,
-- and the status read reports the honest not_acknowledged, never expired.
do $case5$
declare a boolean; s jsonb;
begin
  update public.paige_live_pilot_subjects set expires_at=now()+interval '365 days', accepted_procedural_single_speaker=false where tenant_id='11111111-1111-4111-8111-111111111111';
  select public.paige_live_pilot_authorized_internal('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111') into a;
  select public.paige_live_terms_status() into s;
  if a is not false or s->>'state' is distinct from 'not_acknowledged' then
    raise notice 'LIVE_CONSENT_PROOF FAIL case5 partial-acceptance-refused got authorized=% status=%', a, s;
  else
    raise notice 'LIVE_CONSENT_PROOF case5-pass partial-acceptance-refused status-not_acknowledged';
  end if;
end $case5$;

-- Restore a full acknowledgement, then the two eligibility refusals still refuse.
update public.paige_live_pilot_subjects set accepted_procedural_single_speaker=true, expires_at=now()+interval '365 days' where tenant_id='11111111-1111-4111-8111-111111111111';

-- CASE 6 — tier failure (agency account) refuses even with a current acknowledgement.
do $case6$
declare a boolean;
begin
  select public.paige_live_pilot_authorized_internal('22222222-2222-4222-8222-222222222222','99999999-9999-4999-8999-999999999999') into a;
  if a is not false then
    raise notice 'LIVE_CONSENT_PROOF FAIL case6 tier-refuses got authorized=%', a;
  else
    raise notice 'LIVE_CONSENT_PROOF case6-pass tier-refuses-with-acknowledgement';
  end if;
end $case6$;

-- CASE 7 — operator kill switch refuses even with a current acknowledgement.
do $case7$
declare a boolean;
begin
  insert into public.paige_live_tenant_availability(tenant_id,enabled) values ('11111111-1111-4111-8111-111111111111',false);
  select public.paige_live_pilot_authorized_internal('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111') into a;
  delete from public.paige_live_tenant_availability where tenant_id='11111111-1111-4111-8111-111111111111';
  if a is not false then
    raise notice 'LIVE_CONSENT_PROOF FAIL case7 kill-switch-refuses got authorized=%', a;
  else
    raise notice 'LIVE_CONSENT_PROOF case7-pass kill-switch-refuses-with-acknowledgement';
  end if;
end $case7$;

-- CASE 8 — non-service callers cannot interrogate the predicate at all.
do $case8$
begin
  perform set_config('request.jwt.claim.role','authenticated',false);
  begin
    perform public.paige_live_pilot_authorized_internal('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111');
    raise notice 'LIVE_CONSENT_PROOF FAIL case8 expected-42501';
  exception when others then
    if sqlstate='42501' then raise notice 'LIVE_CONSENT_PROOF case8-pass non-service-refused-42501';
    else raise notice 'LIVE_CONSENT_PROOF FAIL case8 wrong-error %', sqlstate; end if;
  end;
  perform set_config('request.jwt.claim.role','service_role',false);
end $case8$;

-- CASE 9 — status read: unauthenticated caller and execute grants.
do $case9$
declare s jsonb;
begin
  perform set_config('request.jwt.claim.sub','',false);
  perform set_config('test.tenant','',false);
  select public.paige_live_terms_status() into s;
  if s->>'state' is distinct from 'unauthenticated' then
    raise notice 'LIVE_CONSENT_PROOF FAIL case9a unauthenticated-status got %', s;
  else
    raise notice 'LIVE_CONSENT_PROOF case9a-pass status-unauthenticated-without-context';
  end if;
  -- The POSITIVE grants matter as much as the negatives (review P1: a companion
  -- revoked from every role is dead code, and a negative-only assertion cannot
  -- catch it). Scoped to THIS migration's functions: the admission predicate's
  -- own grants belong to 20270412000000, which this fixture does not replay.
  if has_function_privilege('authenticated','public.paige_live_terms_status()','EXECUTE')
    and not has_function_privilege('anon','public.paige_live_terms_status()','EXECUTE')
    and not has_function_privilege('service_role','public.paige_live_terms_status()','EXECUTE')
    and not has_function_privilege('authenticated','public.paige_live_acknowledgement_current_internal(uuid,uuid)','EXECUTE')
    and has_function_privilege('service_role','public.paige_live_acknowledgement_current_internal(uuid,uuid)','EXECUTE')
    and not has_function_privilege('public','public.paige_live_acknowledgement_current_internal(uuid,uuid)','EXECUTE') then
    raise notice 'LIVE_CONSENT_PROOF case9b-pass grants-status-authenticated-only-companion-service-only-public-revoked';
  else
    raise notice 'LIVE_CONSENT_PROOF FAIL case9b grants';
  end if;
end $case9$;
