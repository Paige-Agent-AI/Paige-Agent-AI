-- Reproducible rollback-only proof for 20261046000000_solo_setup_persistence_repair.sql and
-- 20270511090000_outbound_private_business_facts.sql.
-- Runner: BEGIN; apply any of those migrations not yet on the database, without an outer
-- BEGIN/COMMIT; run this file's DO block; ROLLBACK. No tenant mutation may be committed.
--
-- A1 (owner ruling 2026-09-27) moved what this probe guards. The registered address, business
-- phone and website may now reach PAIGE for the owner's own use, so the boundary that matters is
-- the one in front of the customer: "customer-bound draft" below fails if the saved address, phone
-- or website can reach a customer-bound draft unnoticed. The shared persona projection check
-- ("private PAIGE projection") stays, because that projection is sent on every seat, a client's
-- included; A1 gives the facts to PAIGE only through the owner's own seat.
do $probe$
declare
  v_tenant uuid;
  v_other_tenant uuid;
  v_owner uuid;
  v_admin uuid;
  v_context jsonb;
  v_brief jsonb;
  v_saved jsonb;
  v_version text;
  v_secret text := 'GB-AB/12-34';
  v_owner_row uuid;
  v_nonmember uuid;
begin
  select t.id,coalesce(t.owner_user_id,m.user_id) into v_tenant,v_owner
  from public.tenants t
  left join public.tenant_members m on m.tenant_id=t.id and m.status='active' and (m.is_owner or m.role::text='owner')
  where t.parent_tenant_id is null
    and coalesce(t.owner_user_id,m.user_id) is not null
  order by t.created_at limit 1;
  if v_tenant is null then raise exception 'PROBE_FIXTURE_MISSING: solo owner'; end if;
  select a.user_id into v_admin from public.tenant_members a
  where a.status='active' and a.role::text='admin'
    and not exists(select 1 from public.tenant_members x where x.tenant_id=v_tenant and x.user_id=a.user_id)
  limit 1;
  if v_admin is null then raise exception 'PROBE_FIXTURE_MISSING: admin'; end if;
  insert into public.tenant_members(tenant_id,user_id,role,status,is_owner,joined_at)
  values(v_tenant,v_admin,'admin','active',false,now());
  select t.id into v_other_tenant from public.tenants t
  where t.id<>v_tenant and exists(select 1 from public.tenant_members m where m.tenant_id=t.id and m.status='active')
  order by t.created_at limit 1;

  perform set_config('request.jwt.claim.sub',v_owner::text,true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  update public.profiles set active_tenant_id=v_tenant where user_id=v_owner;
  v_context:=public.get_solo_setup_context();
  if v_context is null or v_context ->> 'accessScope'<>'owner_full' then raise exception 'PROBE_FAIL: owner read'; end if;
  v_brief:=coalesce(v_context -> 'brief','{}'::jsonb) || jsonb_build_object(
    'publicName',coalesce(nullif(v_context -> 'brief' ->> 'publicName',''),'Rollback proof business'),
    'legalName','Rollback Proof Legal Person','businessRegistrationIdentifier','VAT',
    'businessRegistrationNumber',v_secret,'registeredIsoCountry','GB',
    'offers','Rollback-only owner proof','representativeUserIds',jsonb_build_array(v_owner),
    'authorizedRepresentativeUserId',v_owner
  );
  v_saved:=public.save_solo_setup_context(v_brief,'[]'::jsonb,v_context -> 'brief' ->> 'updatedAt',null);
  if v_saved -> 'brief' ->> 'offers'<>'Rollback-only owner proof' then raise exception 'PROBE_FAIL: owner readback'; end if;
  if v_saved::text like '%'||v_secret||'%' then raise exception 'PROBE_FAIL: browser secret'; end if;
  if v_saved -> 'brief' ->> 'businessRegistrationNumberLast4'<>'2-34' then raise exception 'PROBE_FAIL: non-US mask'; end if;
  if exists(select 1 from public.tenants where id=v_tenant and brand::text like '%'||v_secret||'%') then raise exception 'PROBE_FAIL: brand secret'; end if;
  if exists(select 1 from public.paige_audit_log where tenant_id=v_tenant and payload::text like '%'||v_secret||'%') then raise exception 'PROBE_FAIL: audit secret'; end if;
  -- Client-seat half: the projection every seat receives never carries the private keys.
  if ((public.get_paige_persona_context()).brand -> 'business_brief') ?| array[
    'legalName','address','phone','entityType','stateOfFormation',
    'businessRegistrationIdentifier','registeredStreet','registeredCity',
    'registeredRegion','registeredPostalCode','registeredIsoCountry',
    'authorizedRepresentativeUserId','representativeUserIds'
  ] then raise exception 'PROBE_FAIL: private PAIGE projection'; end if;
  select decrypted_secret into v_version from vault.decrypted_secrets where name='tenant-a2p-registration-number-'||v_tenant::text;
  if v_version is distinct from v_secret then raise exception 'PROBE_FAIL: Vault exact value'; end if;

  v_context:=public.get_solo_setup_context();
  v_brief:=v_context -> 'brief' || jsonb_build_object('businessRegistrationNumber','');
  v_saved:=public.save_solo_setup_context(v_brief,v_context -> 'businessOwners',v_context -> 'brief' ->> 'updatedAt',null);
  if v_saved -> 'brief' ->> 'businessRegistrationIdentifier'<>'VAT' then raise exception 'PROBE_FAIL: keep blank identifier'; end if;
  v_context:=v_saved;
  begin
    perform public.save_solo_setup_context(v_context -> 'brief' || jsonb_build_object('businessRegistrationIdentifier','EIN','businessRegistrationNumber',''),v_context -> 'businessOwners',v_context -> 'brief' ->> 'updatedAt',null);
    raise exception 'PROBE_FAIL: identifier relabel accepted';
  exception when invalid_parameter_value then null; end;
  v_saved:=public.save_solo_setup_context(v_context -> 'brief' || jsonb_build_object('businessRegistrationIdentifier','','businessRegistrationNumber',''),v_context -> 'businessOwners',v_context -> 'brief' ->> 'updatedAt',null);
  if v_saved -> 'brief' ->> 'businessRegistrationIdentifier'<>'VAT' then raise exception 'PROBE_FAIL: clear selector changed retained secret'; end if;

  insert into public.tenant_business_owners(tenant_id,owner_kind,legal_name,created_by,updated_by,setup_provenance)
  values(v_tenant,'company','Connected owner sentinel',v_owner,v_owner,jsonb_build_object('legalName',jsonb_build_object('source','connection_sourced','confidence','observed')))
  returning id into v_owner_row;
  v_context:=public.get_solo_setup_context();
  begin
    perform public.save_solo_setup_context(v_context -> 'brief','[]'::jsonb,v_context -> 'brief' ->> 'updatedAt',null);
    raise exception 'PROBE_FAIL: connected owner omission accepted';
  exception when invalid_parameter_value then null; end;
  v_saved:=public.save_solo_setup_context(v_context -> 'brief',jsonb_build_array(jsonb_build_object(
    'id',v_owner_row,'ownerKind','company','legalName','Connected owner sentinel','displayName','',
    'ownershipInterest','','effectiveDate','','status','active','representativeUserId','',
    'sourceDecision','override','deleteRequested',true
  )),v_context -> 'brief' ->> 'updatedAt',null);
  if exists(select 1 from public.tenant_business_owners where id=v_owner_row) then raise exception 'PROBE_FAIL: explicit connected owner delete'; end if;

  delete from public.tenant_legal_profile where tenant_id=v_tenant;
  v_context:=public.get_solo_setup_context();
  v_brief:=jsonb_build_object(
    'publicName','Rollback first-use business','dbaName','Rollback DBA','website','https://rollback.example',
    'address','10 Test Way','phone','+442079460001','industry','Advisory',
    'offers','First-use operational proof','representativeUserIds','[]'::jsonb
  );
  v_saved:=public.save_solo_setup_context(v_brief,'[]'::jsonb,v_context -> 'brief' ->> 'updatedAt',null);
  if exists(select 1 from public.tenant_legal_profile where tenant_id=v_tenant) then raise exception 'PROBE_FAIL: first-use created empty legal profile'; end if;
  if v_saved -> 'brief' ->> 'offers'<>'First-use operational proof' then raise exception 'PROBE_FAIL: first-use owner save'; end if;
  if v_saved -> 'brief' ->> 'address'<>'10 Test Way' or v_saved -> 'brief' ->> 'phone'<>'+442079460001'
    then raise exception 'PROBE_FAIL: first-use private contact readback'; end if;
  -- Customer-bound half (A1): the address, phone and website just saved are found in any draft
  -- addressed to a customer, unless the owner typed them. The check is the server's, so it is
  -- asked as the server; a signed-in caller, this owner included, is refused.
  perform set_config('request.jwt.claim.role','service_role',true);
  if not (public.outbound_private_business_facts_found(v_tenant,
       array['Our office is 10 Test Way. Call +44 20 7946 0001 or see rollback.example'])
       @> array['address','phone','website']::text[])
    then raise exception 'PROBE_FAIL: customer-bound draft'; end if;
  if cardinality(public.outbound_private_business_facts_found(v_tenant, array['See you on Tuesday.'])) <> 0
    then raise exception 'PROBE_FAIL: clean customer-bound draft refused'; end if;
  if 'address' = any(public.outbound_private_business_facts_found(v_tenant,
       array['Our office is 10 Test Way.'], array['Tell them our office is 10 Test Way.']))
    then raise exception 'PROBE_FAIL: owner-typed fact refused'; end if;
  perform set_config('request.jwt.claim.role','authenticated',true);
  begin
    perform public.outbound_private_business_facts_found(v_tenant, array['10 Test Way']);
    raise exception 'PROBE_FAIL: signed-in caller asked the customer-bound check';
  exception when insufficient_privilege then null; end;
  v_context:=v_saved;
  v_saved:=public.save_solo_setup_context(
    v_context -> 'brief' || jsonb_build_object('legalName','First-use Legal Person'),
    '[]'::jsonb,v_context -> 'brief' ->> 'updatedAt',null
  );
  if v_saved -> 'brief' ->> 'legalName'<>'First-use Legal Person'
     or not exists(select 1 from public.tenant_legal_profile where tenant_id=v_tenant and legal_business_name='First-use Legal Person')
    then raise exception 'PROBE_FAIL: first-use legal name durable readback'; end if;

  v_version:=v_saved -> 'brief' ->> 'updatedAt';
  begin
    perform public.save_solo_business_brief(v_saved -> 'brief',null,null);
    raise exception 'PROBE_FAIL: missing version accepted';
  exception when serialization_failure then null; end;
  begin
    perform public.save_solo_setup_context(v_saved -> 'brief','[]'::jsonb,'stale-version',null);
    raise exception 'PROBE_FAIL: stale version accepted';
  exception when serialization_failure then null; end;

  perform set_config('request.jwt.claim.sub',v_admin::text,true);
  update public.profiles set active_tenant_id=v_tenant where user_id=v_admin;
  v_context:=public.get_solo_setup_context();
  if v_context ->> 'accessScope'<>'admin_operational' then raise exception 'PROBE_FAIL: admin scope'; end if;
  v_brief:=v_context -> 'brief' || jsonb_build_object('offers','Rollback-only admin proof');
  v_saved:=public.save_solo_setup_context(v_brief,v_context -> 'businessOwners',v_context -> 'brief' ->> 'updatedAt',null);
  if v_saved -> 'brief' ->> 'offers'<>'Rollback-only admin proof' then raise exception 'PROBE_FAIL: admin save'; end if;
  begin
    perform public.save_solo_setup_context(v_brief || jsonb_build_object('legalName','Forbidden admin legal change'),v_context -> 'businessOwners',v_saved -> 'brief' ->> 'updatedAt',null);
    raise exception 'PROBE_FAIL: admin legal write accepted';
  exception when insufficient_privilege then null; end;
  begin
    perform public.save_solo_business_brief(v_saved -> 'brief' || jsonb_build_object('sourceDecisions',jsonb_build_object('legalName','adopt')),v_saved -> 'brief' ->> 'updatedAt',null);
    raise exception 'PROBE_FAIL: admin provenance adoption accepted';
  exception when insufficient_privilege then null; end;

  update public.tenant_members set role='member',is_owner=false where tenant_id=v_tenant and user_id=v_admin;
  if public.solo_setup_access_scope()<>'read_only' or public.get_solo_setup_context() is null then raise exception 'PROBE_FAIL: member read'; end if;
  begin
    perform public.save_solo_setup_context(v_saved -> 'brief',v_saved -> 'businessOwners',v_saved -> 'brief' ->> 'updatedAt',null);
    raise exception 'PROBE_FAIL: member write accepted';
  exception when insufficient_privilege then null; end;
  update public.tenant_members set role='admin',status='invited'
  where tenant_id=v_tenant and user_id=v_admin;
  perform set_config('probe.inactive_user',v_admin::text,true);

  select u.id into v_nonmember from auth.users u
  where public.is_platform_admin(u.id)
    and not exists(select 1 from public.tenant_members m where m.tenant_id=v_tenant and m.user_id=u.id and m.status='active')
  limit 1;
  if v_nonmember is not null then
    update public.profiles set active_tenant_id=v_tenant where user_id=v_nonmember;
    perform set_config('request.jwt.claim.sub',v_nonmember::text,true);
    if public.current_user_tenant_id() is null then raise exception 'PROBE_FIXTURE_MISSING: resolved nonmember'; end if;
    if public.get_solo_setup_context() is not null then raise exception 'PROBE_FAIL: resolved nonmember read'; end if;
  end if;

  if v_other_tenant is not null then
    perform set_config('request.jwt.claim.sub',v_owner::text,true);
    update public.profiles set active_tenant_id=v_tenant where user_id=v_owner;
    insert into public.tenant_business_owners(tenant_id,owner_kind,legal_name,created_by,updated_by)
    values(v_other_tenant,'company','Cross-tenant sentinel',v_owner,v_owner) returning id into v_owner_row;
    begin
      perform public.save_solo_setup_context(v_saved -> 'brief',jsonb_build_array(jsonb_build_object(
        'id',v_owner_row,'ownerKind','company','legalName','Forbidden cross tenant','displayName','',
        'ownershipInterest','','effectiveDate','','status','active','representativeUserId',''
      )),v_saved -> 'brief' ->> 'updatedAt',null);
      raise exception 'PROBE_FAIL: cross-tenant write accepted';
    exception when insufficient_privilege then null; end;
  end if;

  perform set_config('request.jwt.claim.sub','',true);
  perform set_config('request.jwt.claim.role','anon',true);
  if public.get_solo_setup_context() is not null then raise exception 'PROBE_FAIL: anonymous read'; end if;
  begin
    perform public.save_solo_setup_context('{}'::jsonb,'[]'::jsonb,null,null);
    raise exception 'PROBE_FAIL: anonymous write accepted';
  exception when insufficient_privilege or invalid_text_representation then null; end;
end
$probe$;

-- Exercise actual RPC EXECUTE grants under browser roles, not only function bodies
-- under the privileged migration runner.
select set_config('request.jwt.claim.sub',(
  select coalesce(t.owner_user_id,m.user_id)::text from public.tenants t
  left join public.tenant_members m on m.tenant_id=t.id and m.status='active' and (m.is_owner or m.role::text='owner')
  where t.parent_tenant_id is null and coalesce(t.owner_user_id,m.user_id) is not null order by t.created_at limit 1
),true);
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;
do $authenticated_role$
declare v_public_name text;
begin
  if public.get_solo_setup_context() is null then raise exception 'PROBE_FAIL: authenticated EXECUTE'; end if;
  select legal_business_name into v_public_name
  from public.tenant_legal_profile
  where tenant_id=public.current_user_tenant_id();
  begin
    perform business_registration_number_secret_ref from public.tenant_legal_profile
    where tenant_id=public.current_user_tenant_id();
    raise exception 'PROBE_FAIL: authenticated sensitive legal SELECT accepted';
  exception when insufficient_privilege then null; end;
  begin
    update public.tenant_legal_profile set legal_business_name='Forbidden direct update'
    where tenant_id=public.current_user_tenant_id();
    raise exception 'PROBE_FAIL: authenticated direct legal UPDATE accepted';
  exception when insufficient_privilege then null; end;
  begin
    delete from public.tenant_legal_profile where tenant_id=public.current_user_tenant_id();
    raise exception 'PROBE_FAIL: authenticated direct legal DELETE accepted';
  exception when insufficient_privilege then null; end;
  begin
    perform public.save_solo_business_brief('{}'::jsonb,null,null);
    raise exception 'PROBE_FAIL: authenticated legacy direct save EXECUTE accepted';
  exception when insufficient_privilege then null; end;
end
$authenticated_role$;
reset role;

select set_config('request.jwt.claim.sub',current_setting('probe.inactive_user'),true);
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;
do $inactive_role$
begin
  if exists(select 1 from public.tenant_legal_profile
    where tenant_id=public.current_user_tenant_id()) then
    raise exception 'PROBE_FAIL: inactive member safe legal SELECT accepted';
  end if;
end
$inactive_role$;
reset role;

select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claim.role','anon',true);
set local role anon;
do $anon_role$
begin
  begin
    perform public.get_solo_setup_context();
    raise exception 'PROBE_FAIL: anon EXECUTE accepted';
  exception when insufficient_privilege or invalid_text_representation then null; end;
end
$anon_role$;
reset role;
