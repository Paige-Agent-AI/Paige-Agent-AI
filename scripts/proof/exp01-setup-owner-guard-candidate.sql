-- E01 I2: original Setup writer legal-owner protection; inert until normal ordered release.
BEGIN;
DO $exp01_owner_guard_install$
DECLARE p record; original_oid oid;
BEGIN
 SELECT * INTO p FROM pg_catalog.pg_proc
 WHERE oid=pg_catalog.to_regprocedure('public.save_solo_setup_context(jsonb,jsonb,text,uuid)');
 IF NOT FOUND THEN RAISE EXCEPTION 'Original Setup writer unavailable' USING ERRCODE='23514'; END IF;
 IF pg_catalog.pg_get_userbyid(p.proowner) IS DISTINCT FROM 'postgres'
   OR p.proacl::text IS DISTINCT FROM '{postgres=X/postgres,authenticated=X/postgres}'
   OR NOT p.prosecdef OR p.proisstrict OR p.proleakproof OR p.proretset
   OR p.provolatile<>'v' OR p.proparallel<>'u' OR p.prokind<>'f'
   OR p.pronargs<>4 OR p.pronargdefaults<>3
   OR pg_catalog.pg_get_expr(p.proargdefaults,0) IS DISTINCT FROM '''[]''::jsonb, NULL::text, NULL::uuid'
   OR pg_catalog.pg_get_function_result(p.oid) IS DISTINCT FROM 'jsonb'
   OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public, vault']
   OR p.proargnames IS DISTINCT FROM ARRAY['_brief','_business_owners','_expected_updated_at','_proposal_id']
   OR p.proargmodes IS NOT NULL OR p.proallargtypes IS NOT NULL OR p.provariadic<>0
   OR (SELECT l.lanname FROM pg_catalog.pg_language l WHERE l.oid=p.prolang)<>'plpgsql'
   OR pg_catalog.md5(p.prosrc) NOT IN ('d70cdc664b5c703395e4f077a30fdbd8','898434290f8bd6325e54b4c2795f7f48') THEN
  RAISE EXCEPTION 'Original Setup writer source or authority changed; reconcile before applying' USING ERRCODE='23514';
 END IF;
 original_oid:=p.oid;
 EXECUTE $exp01_writer_definition$create or replace function public.save_solo_setup_context(
  _brief jsonb,
  _business_owners jsonb default '[]'::jsonb,
  _expected_updated_at text default null,
  _proposal_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_tid uuid := public.current_user_tenant_id();
  v_access text := public.solo_setup_access_scope();
  v_item jsonb;
  v_id uuid;
  v_keep uuid[] := '{}'::uuid[];
  v_kind text;
  v_legal_name text;
  v_interest numeric(5,2);
  v_rep uuid;
  v_saved jsonb;
  v_admin_brief jsonb;
  v_tenant_name text;
  v_existing_context jsonb;
  v_key text;
  v_owner_only_keys constant text[] := array[
    'legalName','publicName','dbaName','website','address','phone','industry','naicsCode','sicCode',
    'entityType','stateOfFormation','businessRegistrationIdentifier','businessRegistrationNumber',
    'regionsOfOperation','registeredStreet','registeredStreetSecondary','registeredCity','registeredRegion',
    'registeredPostalCode','registeredIsoCountry','authorizedRepresentativePhone',
    'authorizedRepresentativeJobPosition','authorizedRepresentativeUserId'
  ];
  v_existing_owner public.tenant_business_owners%rowtype;
  v_owner_provenance jsonb;
  v_private_current jsonb := '{}'::jsonb;
  v_private_provenance jsonb := '{}'::jsonb;
  v_private_next jsonb := '{}'::jsonb;
  v_private_provenance_next jsonb := '{}'::jsonb;
  v_private_value text;
  v_private_old_value text;
  v_private_decision text;
  v_private_keys constant text[] := array['address','phone'];
begin
  if auth.uid() is null or v_tid is null or not public.solo_setup_can_read() then
    raise exception 'active workspace not resolved' using errcode = '42501';
  end if;
  if v_access not in ('owner_full','admin_operational') then
    raise exception 'not authorized to edit this business brief' using errcode = '42501';
  end if;
  if _business_owners is null or jsonb_typeof(_business_owners) <> 'array'
     or jsonb_array_length(_business_owners) > 50 or pg_column_size(_business_owners)>131072 then
    raise exception 'business owners must be an array of at most 50 records and 128 KB' using errcode = '22023';
  end if;

  if v_access = 'owner_full' then
    -- Existing legal/Vault code remains the single protected-storage boundary.
    perform public.save_solo_setup_identity(_brief,_expected_updated_at,_proposal_id);
    select coalesce(pc.private_brief,'{}'::jsonb),coalesce(pc.setup_provenance,'{}'::jsonb)
    into v_private_current,v_private_provenance
    from public.tenant_setup_private_context pc where pc.tenant_id=v_tid for update;
    v_private_current:=coalesce(v_private_current,'{}'::jsonb);
    v_private_provenance:=coalesce(v_private_provenance,'{}'::jsonb);
    v_private_next:=v_private_current;
    v_private_provenance_next:=v_private_provenance;
    foreach v_key in array v_private_keys loop
      v_private_value:=nullif(btrim(coalesce(_brief ->> v_key,'')),'');
      v_private_old_value:=nullif(btrim(coalesce(v_private_current ->> v_key,'')),'');
      v_private_decision:=nullif(_brief -> 'sourceDecisions' ->> v_key,'');
      if v_private_provenance -> v_key ->> 'source'='connection_sourced'
         and v_private_value is distinct from v_private_old_value
         and v_private_decision is distinct from 'override' then
        raise exception 'connection-sourced private field % requires an explicit override',v_key
          using errcode='22023',hint='SETUP_SOURCE_DECISION_REQUIRED';
      end if;
      if v_private_value is null then
        v_private_next:=v_private_next - v_key;
        v_private_provenance_next:=v_private_provenance_next - v_key;
      else
        v_private_next:=v_private_next || jsonb_build_object(v_key,v_private_value);
        if v_private_value is not distinct from v_private_old_value
           and v_private_decision is distinct from 'adopt'
           and v_private_provenance -> v_key is not null then
          null;
        else
          v_private_provenance_next:=v_private_provenance_next || jsonb_build_object(
            v_key,jsonb_build_object('source','owner_confirmed','confidence','confirmed','confirmedAt',clock_timestamp())
          );
        end if;
      end if;
    end loop;
    if exists(select 1 from public.tenant_legal_profile lp where lp.tenant_id=v_tid) then
      v_private_next:=v_private_next - array[
        'legalName','entityType','stateOfFormation','businessRegistrationIdentifier',
        'regionsOfOperation','registeredStreet','registeredStreetSecondary','registeredCity',
        'registeredRegion','registeredPostalCode','registeredIsoCountry',
        'authorizedRepresentativePhone','authorizedRepresentativeJobPosition',
        'authorizedRepresentativeUserId'
      ]::text[];
      v_private_provenance_next:=v_private_provenance_next - array[
        'legalName','entityType','stateOfFormation','businessRegistrationIdentifier',
        'regionsOfOperation','registeredStreet','registeredStreetSecondary','registeredCity',
        'registeredRegion','registeredPostalCode','registeredIsoCountry',
        'authorizedRepresentativePhone','authorizedRepresentativeJobPosition',
        'authorizedRepresentative'
      ]::text[];
    end if;
    insert into public.tenant_setup_private_context(
      tenant_id,private_brief,setup_provenance,created_by,updated_by,updated_at
    ) values(v_tid,v_private_next,v_private_provenance_next,auth.uid(),auth.uid(),now())
    on conflict(tenant_id) do update set
      private_brief=excluded.private_brief,setup_provenance=excluded.setup_provenance,
      updated_by=auth.uid(),updated_at=now();
    if nullif(btrim(coalesce(_brief ->> 'regionsOfOperation','')),'') is null then
      update public.tenant_legal_profile
      set business_regions_of_operation = '{}'::text[], updated_at = now()
      where tenant_id = v_tid;
    end if;
    perform 1 from public.tenant_business_owners
      where tenant_id = v_tid order by id for update;
    for v_item in select value from jsonb_array_elements(_business_owners) loop
      if jsonb_typeof(v_item) <> 'object' then
        raise exception 'each business owner must be an object' using errcode = '22023';
      end if;
      v_kind := nullif(v_item ->> 'ownerKind','');
      v_legal_name := nullif(btrim(coalesce(v_item ->> 'legalName','')),'');
      if v_kind not in ('individual','company','trust','other_legal_person') or v_legal_name is null then
        raise exception 'each business owner needs a supported type and legal name' using errcode = '22023';
      end if;
      begin
        v_id := coalesce(nullif(v_item ->> 'id','')::uuid,gen_random_uuid());
        v_interest := nullif(v_item ->> 'ownershipInterest','')::numeric;
        v_rep := nullif(v_item ->> 'representativeUserId','')::uuid;
      exception when invalid_text_representation then
        raise exception 'business owner id, interest, or representative is invalid' using errcode = '22023';
      end;
      if v_interest is not null and (v_interest < 0 or v_interest > 100) then
        raise exception 'ownership interest must be between 0 and 100 when provided' using errcode = '22023';
      end if;
      if v_rep is not null and not exists (
        select 1 from public.tenant_members tm
        where tm.tenant_id = v_tid and tm.user_id = v_rep and tm.status = 'active'
      ) then
        raise exception 'every designated representative must be an active Team member' using errcode = '42501';
      end if;
      select * into v_existing_owner from public.tenant_business_owners
      where id=v_id and tenant_id=v_tid;
      -- E01 I2: original owner-row locks precede current seat/invitation inspection.
      if found and (coalesce((v_item ->> 'deleteRequested')::boolean,false)
          or v_existing_owner.owner_kind is distinct from v_kind
          or v_existing_owner.representative_user_id is distinct from v_rep)
        and (v_existing_owner.owner_seat_vacant_since is not null
          or exists(select 1 from public.tenant_members seated
            where seated.tenant_id=v_tid and seated.business_owner_id=v_existing_owner.id)
          or exists(select 1 from public.tenant_invite_tokens invitation
            where invitation.tenant_id=v_tid and invitation.business_owner_id=v_existing_owner.id
              and invitation.default_role::text='owner' and invitation.kind not in ('consumer','agency_team')
              and invitation.revoked_at is null and invitation.business_owner_removed_at is null
              and invitation.uses=0 and (invitation.max_uses is null or invitation.max_uses>invitation.uses)
              and invitation.expires_at>clock_timestamp())) then
        raise exception '% holds an owner seat on the team, so it can''t be removed or changed here yet.',
          coalesce(nullif(btrim(v_existing_owner.display_name),''),v_existing_owner.legal_name)
          using errcode='42501',hint='OWNER_RECORD_SEATED';
      end if;
      if coalesce((v_item ->> 'deleteRequested')::boolean,false) then
        if not found then raise exception 'business owner record does not belong to this workspace' using errcode='42501'; end if;
        if exists(select 1 from jsonb_each(v_existing_owner.setup_provenance) p where p.value ->> 'source'='connection_sourced')
           and nullif(v_item ->> 'sourceDecision','') is distinct from 'override' then
          raise exception 'deleting connection-sourced business ownership requires an explicit override'
            using errcode='22023', hint='SETUP_SOURCE_DECISION_REQUIRED';
        end if;
        delete from public.tenant_business_owners where id=v_id and tenant_id=v_tid;
        continue;
      end if;
      if found
         and exists(select 1 from jsonb_each(v_existing_owner.setup_provenance) p where p.value ->> 'source'='connection_sourced')
         and (
           v_existing_owner.owner_kind is distinct from v_kind
           or v_existing_owner.legal_name is distinct from v_legal_name
           or v_existing_owner.display_name is distinct from nullif(btrim(v_item ->> 'displayName'),'')
           or v_existing_owner.ownership_interest is distinct from v_interest
           or v_existing_owner.effective_date is distinct from nullif(v_item ->> 'effectiveDate','')::date
           or v_existing_owner.ownership_status is distinct from coalesce(nullif(v_item ->> 'status',''),'active')
           or v_existing_owner.representative_user_id is distinct from v_rep
         )
         and nullif(v_item ->> 'sourceDecision','') is distinct from 'override' then
        raise exception 'connection-sourced business ownership requires an explicit override'
          using errcode='22023', hint='SETUP_SOURCE_DECISION_REQUIRED';
      end if;
      v_owner_provenance := jsonb_build_object(
        'ownerKind',jsonb_build_object('source','owner_confirmed','confidence','confirmed','confirmedAt',clock_timestamp()),
        'legalName',jsonb_build_object('source','owner_confirmed','confidence','confirmed','confirmedAt',clock_timestamp()),
        'status',jsonb_build_object('source','owner_confirmed','confidence','confirmed','confirmedAt',clock_timestamp())
      );
      if nullif(btrim(v_item ->> 'displayName'),'') is not null then
        v_owner_provenance := v_owner_provenance || jsonb_build_object('displayName',jsonb_build_object('source','owner_confirmed','confidence','confirmed','confirmedAt',clock_timestamp()));
      end if;
      if v_interest is not null then
        v_owner_provenance := v_owner_provenance || jsonb_build_object('ownershipInterest',jsonb_build_object('source','owner_confirmed','confidence','confirmed','confirmedAt',clock_timestamp()));
      end if;
      if nullif(v_item ->> 'effectiveDate','') is not null then
        v_owner_provenance := v_owner_provenance || jsonb_build_object('effectiveDate',jsonb_build_object('source','owner_confirmed','confidence','confirmed','confirmedAt',clock_timestamp()));
      end if;
      if v_rep is not null then
        v_owner_provenance := v_owner_provenance || jsonb_build_object('representativeUserId',jsonb_build_object('source','owner_confirmed','confidence','confirmed','confirmedAt',clock_timestamp()));
      end if;
      insert into public.tenant_business_owners(
        id,tenant_id,owner_kind,legal_name,display_name,ownership_interest,effective_date,
        ownership_status,representative_user_id,created_by,updated_by,setup_provenance
      ) values (
        v_id,v_tid,v_kind,v_legal_name,nullif(btrim(v_item ->> 'displayName'),''),
        v_interest,nullif(v_item ->> 'effectiveDate','')::date,
        coalesce(nullif(v_item ->> 'status',''),'active'),v_rep,auth.uid(),auth.uid(),
        v_owner_provenance
      )
      on conflict(id) do update set
        owner_kind=excluded.owner_kind,
        legal_name=excluded.legal_name,
        display_name=excluded.display_name,
        ownership_interest=excluded.ownership_interest,
        effective_date=excluded.effective_date,
        ownership_status=excluded.ownership_status,
        representative_user_id=excluded.representative_user_id,
        setup_provenance=case
          when tenant_business_owners.owner_kind=excluded.owner_kind
           and tenant_business_owners.legal_name=excluded.legal_name
           and tenant_business_owners.display_name is not distinct from excluded.display_name
           and tenant_business_owners.ownership_interest is not distinct from excluded.ownership_interest
           and tenant_business_owners.effective_date is not distinct from excluded.effective_date
           and tenant_business_owners.ownership_status=excluded.ownership_status
           and tenant_business_owners.representative_user_id is not distinct from excluded.representative_user_id
          then case when nullif(v_item ->> 'sourceDecision','')='adopt' then excluded.setup_provenance else tenant_business_owners.setup_provenance end
          else excluded.setup_provenance end,
        updated_by=auth.uid(),
        updated_at=now()
      where tenant_business_owners.tenant_id = v_tid;
      if not found then
        raise exception 'business owner record does not belong to this workspace' using errcode = '42501';
      end if;
      v_keep := array_append(v_keep,v_id);
    end loop;
    -- E01 I2: omission is a deletion, even with an explicit source override.
    select bo.* into v_existing_owner from public.tenant_business_owners bo
    where bo.tenant_id=v_tid and not (bo.id=any(v_keep)) and (bo.owner_seat_vacant_since is not null
          or exists(select 1 from public.tenant_members seated
            where seated.tenant_id=v_tid and seated.business_owner_id=bo.id)
          or exists(select 1 from public.tenant_invite_tokens invitation
            where invitation.tenant_id=v_tid and invitation.business_owner_id=bo.id
              and invitation.default_role::text='owner' and invitation.kind not in ('consumer','agency_team')
              and invitation.revoked_at is null and invitation.business_owner_removed_at is null
              and invitation.uses=0 and (invitation.max_uses is null or invitation.max_uses>invitation.uses)
              and invitation.expires_at>clock_timestamp()))
    order by bo.id limit 1;
    if found then
      raise exception '% holds an owner seat on the team, so it can''t be removed or changed here yet.',
          coalesce(nullif(btrim(v_existing_owner.display_name),''),v_existing_owner.legal_name)
          using errcode='42501',hint='OWNER_RECORD_SEATED';
    end if;
    if exists(
      select 1 from public.tenant_business_owners bo
      where bo.tenant_id=v_tid and not (bo.id=any(v_keep))
        and exists(select 1 from jsonb_each(bo.setup_provenance) p where p.value ->> 'source'='connection_sourced')
    ) then
      raise exception 'removing connection-sourced business ownership requires an explicit override'
        using errcode='22023', hint='SETUP_SOURCE_DECISION_REQUIRED';
    end if;
    delete from public.tenant_business_owners
    where tenant_id = v_tid and not (id = any(v_keep));
    insert into public.paige_audit_log(actor_user_id,actor_role,action,target_type,target_id,tenant_id,payload)
    values (
      auth.uid(),'owner','solo_setup.business_ownership_saved','tenant_business_ownership',v_tid,v_tid,
      jsonb_build_object('owner_record_count',coalesce(array_length(v_keep,1),0))
    );
  else
    v_existing_context := public.get_solo_setup_context();
    foreach v_key in array v_owner_only_keys loop
      if nullif(btrim(coalesce(_brief ->> v_key,'')),'')
         is distinct from nullif(btrim(coalesce(v_existing_context -> 'brief' ->> v_key,'')),'') then
        raise exception 'only the workspace Owner can change legal identity or business ownership'
          using errcode = '42501', hint = 'SETUP_OWNER_REQUIRED';
      end if;
    end loop;
    if coalesce(_brief -> 'representativeUserIds','[]'::jsonb)
         is distinct from coalesce(v_existing_context -> 'brief' -> 'representativeUserIds','[]'::jsonb) then
      raise exception 'only the workspace Owner can change legal identity or business ownership'
        using errcode = '42501', hint = 'SETUP_OWNER_REQUIRED';
    end if;
    if _business_owners is distinct from (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id',bo.id,'ownerKind',bo.owner_kind,'legalName',bo.legal_name,
        'displayName',coalesce(bo.display_name,''),'ownershipInterest',coalesce(bo.ownership_interest::text,''),
        'effectiveDate',coalesce(bo.effective_date::text,''),'status',bo.ownership_status,
        'representativeUserId',coalesce(bo.representative_user_id::text,''),'provenance',bo.setup_provenance
      ) order by bo.created_at,bo.id),'[]'::jsonb)
      from public.tenant_business_owners bo where bo.tenant_id = v_tid
    ) then
      raise exception 'only the workspace Owner can change legal identity or business ownership'
        using errcode = '42501', hint = 'SETUP_OWNER_REQUIRED';
    end if;
    select coalesce(t.brand -> 'business_brief','{}'::jsonb), t.name
    into v_admin_brief, v_tenant_name
    from public.tenants t where t.id = v_tid;
    v_admin_brief := v_admin_brief || jsonb_build_object(
      'publicName',coalesce(nullif(v_admin_brief ->> 'publicName',''),v_tenant_name),
      'offers',coalesce(_brief ->> 'offers',''),
      'deliveryModel',coalesce(_brief ->> 'deliveryModel',''),
      'idealCustomer',coalesce(_brief ->> 'idealCustomer',''),
      'customerSegments',coalesce(_brief ->> 'customerSegments',''),
      'serviceArea',coalesce(_brief ->> 'serviceArea',''),
      'currentPriority',coalesce(_brief ->> 'currentPriority',''),
      'goals90Day',coalesce(_brief ->> 'goals90Day',''),
      'annualDirection',coalesce(_brief ->> 'annualDirection',''),
      'successDefinition',coalesce(_brief ->> 'successDefinition',''),
      'constraints',coalesce(_brief ->> 'constraints',''),
      'brandVoice',coalesce(_brief ->> 'brandVoice',''),
      'operatingPreferences',coalesce(_brief ->> 'operatingPreferences',''),
      'doNotAssume',coalesce(_brief ->> 'doNotAssume',''),
      'representativeUserIds',coalesce(v_existing_context -> 'brief' -> 'representativeUserIds','[]'::jsonb),
      'sourceDecisions',coalesce(_brief -> 'sourceDecisions','{}'::jsonb)
    );
    v_saved := public.save_solo_business_brief(v_admin_brief,_expected_updated_at,_proposal_id);
  end if;
  return public.get_solo_setup_context();
end;
$$;$exp01_writer_definition$;
 SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid=original_oid;
 IF NOT FOUND OR pg_catalog.pg_get_userbyid(p.proowner) IS DISTINCT FROM 'postgres'
   OR p.proacl::text IS DISTINCT FROM '{postgres=X/postgres,authenticated=X/postgres}'
   OR NOT p.prosecdef OR p.proisstrict OR p.proleakproof OR p.proretset
   OR p.provolatile<>'v' OR p.proparallel<>'u' OR p.prokind<>'f'
   OR p.pronargs<>4 OR p.pronargdefaults<>3
   OR pg_catalog.pg_get_expr(p.proargdefaults,0) IS DISTINCT FROM '''[]''::jsonb, NULL::text, NULL::uuid'
   OR pg_catalog.pg_get_function_result(p.oid) IS DISTINCT FROM 'jsonb'
   OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public, vault']
   OR p.proargnames IS DISTINCT FROM ARRAY['_brief','_business_owners','_expected_updated_at','_proposal_id']
   OR p.proargmodes IS NOT NULL OR p.proallargtypes IS NOT NULL OR p.provariadic<>0
   OR (SELECT l.lanname FROM pg_catalog.pg_language l WHERE l.oid=p.prolang)<>'plpgsql'
   OR pg_catalog.md5(p.prosrc) IS DISTINCT FROM '898434290f8bd6325e54b4c2795f7f48' THEN
  RAISE EXCEPTION 'Setup owner guard installation did not preserve original identity/authority' USING ERRCODE='23514';
 END IF;
END $exp01_owner_guard_install$;
COMMIT;
