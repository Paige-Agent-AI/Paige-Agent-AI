-- An operator acting as a Solo workspace can READ its Setup context. Writes are unchanged.
--
-- The defect (owner live drive, 2026-09-28): a platform operator entered a Solo workspace through
-- the audited act-as, the shell rendered, and Business Game Plan stayed an empty skeleton forever.
-- `get_solo_setup_context()` opens with `solo_setup_can_read()`, which admits only the workspace
-- owner or an active member. An operator is neither — act-as adds no membership, by design — so the
-- read returned NULL for every operator in every workspace, and the page never left its skeleton.
-- The same predicate, through `solo_setup_assert_canonical_tenant()`, refused
-- `get_solo_business_context()` with 42501.
--
-- The rule this applies is the shell scope document's, already ruled: inside an act-as the operator
-- sees that tenant's content READ-ONLY, audited on entry and exit. The authority is G1's capability
-- `tenant.act_as` (held in force by super_admin and platform_admin), read through `operator_may()`,
-- so no role is named here and a capability revoked in the table closes this read with it.
--
-- WHAT DOES NOT CHANGE:
--   * `solo_setup_can_read()` itself. It also gates `save_solo_setup_context` and, through
--     `solo_setup_assert_canonical_tenant()`, `solo_setup_lock_expected_tenant`,
--     `check_solo_setup_managed_email` and `search_solo_setup_naics`. Widening it in place would
--     open those; writing inside an act-as is G3's `tenant.act_as.write`, not in force for
--     platform_admin and not decided here.
--   * `solo_setup_access_scope()`: an operator who is not a member still reads 'read_only', so the
--     client's edit controls stay off.
--   * The workspace is the caller's own act-as pointer AND that pointer is backed by an open
--     `operator.tenant.enter` receipt: an enter for that workspace with no exit for it at or after
--     it. The pointer alone is not enough — `profiles` lets an operator update their own row, and
--     `guard_active_tenant_membership` admits a platform admin's non-member pointer, so a pointer
--     can be set with no receipt at all (found by the independent review of this change). The
--     owner's standing principle is gate by audit; a read that skipped the audit would break it.

CREATE OR REPLACE FUNCTION public.solo_setup_operator_can_read()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  select auth.uid() is not null
    and public.current_user_tenant_id() is not null
    and public.operator_may('tenant.act_as')
    and exists (
      select 1 from public.profiles p
      join public.tenants t on t.id = p.active_tenant_id
      where p.user_id = auth.uid()
        and p.active_tenant_id = public.current_user_tenant_id()
        -- The entry was recorded, and has not been recorded as ended since.
        and exists (
          select 1 from public.paige_audit_log e
          where e.actor_user_id = auth.uid()
            and e.action = 'operator.tenant.enter'
            and e.target_id = p.active_tenant_id
            and not exists (
              select 1 from public.paige_audit_log x
              where x.actor_user_id = auth.uid()
                and x.action = 'operator.tenant.exit'
                and x.target_id = e.target_id
                and x.created_at >= e.created_at
            )
        )
    )
$function$;

COMMENT ON FUNCTION public.solo_setup_operator_can_read() IS
  'Whether the caller is an operator holding tenant.act_as whose Setup scope is their own act-as '
  'pointer, backed by an operator.tenant.enter receipt with no exit since. Read paths only: it admits get_solo_setup_context and get_solo_business_context, '
  'never a Setup write.';

REVOKE ALL ON FUNCTION public.solo_setup_operator_can_read() FROM PUBLIC, anon, authenticated;

-- The read-side twin of solo_setup_assert_canonical_tenant(): the same two refusals, admitting an
-- operator's act-as as well as a member. The original stays as it is for the write paths.
CREATE OR REPLACE FUNCTION public.solo_setup_assert_canonical_tenant_for_read()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare v_tid uuid := public.current_user_tenant_id();
begin
  if auth.uid() is null or v_tid is null
     or not (public.solo_setup_can_read() or public.solo_setup_operator_can_read()) then
    raise exception 'Solo Setup requires an authenticated workspace member' using errcode='42501';
  end if;
  if not exists(select 1 from public.tenants t where t.id=v_tid and t.account_type::text='standalone' and t.parent_tenant_id is null) then
    raise exception 'This Setup contract is available only to a top-level Solo workspace' using errcode='42501';
  end if;
  return v_tid;
end $function$;

REVOKE ALL ON FUNCTION public.solo_setup_assert_canonical_tenant_for_read() FROM PUBLIC, anon, authenticated;

-- Body unchanged from production except the first statement's gate.
CREATE OR REPLACE FUNCTION public.get_solo_setup_context()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_identity record;
  v_owners jsonb;
  v_representatives jsonb := '[]'::jsonb;
  v_representative_provenance jsonb;
  v_legal_provenance jsonb := '{}'::jsonb;
  v_private_brief jsonb := '{}'::jsonb;
  v_private_provenance jsonb := '{}'::jsonb;
begin
  if not (public.solo_setup_can_read() or public.solo_setup_operator_can_read()) then return null; end if;
  select * into v_identity from public.get_solo_setup_identity() limit 1;
  if not found then return null; end if;
  select coalesce(lp.setup_provenance,'{}'::jsonb) into v_legal_provenance
  from public.tenant_legal_profile lp where lp.tenant_id=v_identity.tenant_id;
  select coalesce(pc.private_brief,'{}'::jsonb),coalesce(pc.setup_provenance,'{}'::jsonb)
  into v_private_brief,v_private_provenance
  from public.tenant_setup_private_context pc where pc.tenant_id=v_identity.tenant_id;
  if v_legal_provenance ? 'authorizedRepresentativeUserId' then
    v_legal_provenance := (v_legal_provenance - 'authorizedRepresentativeUserId')
      || jsonb_build_object('authorizedRepresentative',v_legal_provenance -> 'authorizedRepresentativeUserId');
  end if;
  select coalesce(jsonb_agg(r.user_id::text order by r.user_id::text),'[]'::jsonb)
  into v_representatives
  from public.tenant_business_representatives r where r.tenant_id=v_identity.tenant_id;
  select jsonb_build_object('source',r.source,'confidence',r.confidence,'confirmedAt',r.confirmed_at)
  into v_representative_provenance
  from public.tenant_business_representatives r
  where r.tenant_id=v_identity.tenant_id order by r.created_at limit 1;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',bo.id,
    'ownerKind',bo.owner_kind,
    'legalName',bo.legal_name,
    'displayName',coalesce(bo.display_name,''),
    'ownershipInterest',coalesce(bo.ownership_interest::text,''),
    'effectiveDate',coalesce(bo.effective_date::text,''),
    'status',bo.ownership_status,
    'representativeUserId',coalesce(bo.representative_user_id::text,''),
    'provenance',bo.setup_provenance
  ) order by bo.created_at,bo.id),'[]'::jsonb)
  into v_owners
  from public.tenant_business_owners bo
  where bo.tenant_id = v_identity.tenant_id;
  return jsonb_build_object(
    'tenantId',v_identity.tenant_id,
    'tenantName',v_identity.tenant_name,
    'brief',jsonb_set(
      coalesce(v_private_brief,'{}'::jsonb)
        || coalesce(v_identity.business_brief,'{}'::jsonb) || jsonb_build_object(
        'businessRegistrationNumberLast4',coalesce(v_identity.business_registration_number_last_4,''),
        'representativeUserIds',v_representatives
      ),
      '{provenance}',
      coalesce(v_private_provenance,'{}'::jsonb)
        || coalesce(v_identity.business_brief -> 'provenance','{}'::jsonb)
        || coalesce(v_legal_provenance,'{}'::jsonb)
        || case when v_representative_provenance is null then '{}'::jsonb
             else jsonb_build_object('representatives',v_representative_provenance) end,
      true
    ),
    'pendingProposal',v_identity.pending_proposal,
    'primaryBusinessEmail',v_identity.primary_business_email,
    'accessScope',public.solo_setup_access_scope(),
    'businessOwners',v_owners
  );
end;
$function$;

-- Body unchanged from production except the assert it opens with.
CREATE OR REPLACE FUNCTION public.get_solo_business_context()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tid uuid := public.solo_setup_assert_canonical_tenant_for_read();
  v_base jsonb;
  v_managed_local text;
  v_managed_domain text;
begin
  v_base := public.get_solo_setup_context();
  select i.local_part into v_managed_local from public.tenant_email_identities i where i.tenant_id=v_tid;
  select coalesce(nullif(shared_domain,''),'mail.paigeagent.ai') into v_managed_domain from public.platform_email_settings limit 1;
  v_managed_domain := coalesce(v_managed_domain,'mail.paigeagent.ai');
  return v_base || jsonb_build_object(
    'contextRevision',coalesce((select revision from public.tenant_setup_business_context_meta where tenant_id=v_tid),0),
    'primaryEmailProvenance',coalesce(nullif((select primary_email_provenance from public.tenant_setup_business_context_meta where tenant_id=v_tid
      and primary_email_snapshot is not distinct from nullif(lower(btrim(coalesce(v_base->>'primaryBusinessEmail',''))),'')),'{}'::jsonb),
      case when nullif(v_base->>'primaryBusinessEmail','') is null then '{"source":"needs_confirmation","confidence":"unknown"}'::jsonb
      else '{"source":"connection_sourced","confidence":"observed"}'::jsonb end),
    'knowledgeSources',coalesce((select jsonb_agg(jsonb_build_object(
      'id',k.id,'sourceType',k.source_type,'title',k.title,'category',k.category,
      'sourceUrl',coalesce(k.source_url,''),'reference',coalesce(k.reference,''),'notes',coalesce(k.notes,''),
      'reviewStatus',k.review_status,'provenance',k.setup_provenance,'updatedAt',k.updated_at
    ) order by k.updated_at desc) from public.tenant_setup_knowledge_sources k where k.tenant_id=v_tid),'[]'::jsonb),
    'paigeProfile',coalesce((select p.profile || jsonb_build_object('provenance',p.setup_provenance) from public.tenant_setup_paige_profiles p where p.tenant_id=v_tid),'{}'::jsonb),
    'voiceExamples',coalesce((select jsonb_agg(jsonb_build_object(
      'id',e.id,'channel',e.channel,'kind',e.example_kind,'example',e.example_text,'note',coalesce(e.note,''),
      'provenance',e.setup_provenance,'updatedAt',e.updated_at
    ) order by e.updated_at desc) from public.tenant_setup_voice_examples e where e.tenant_id=v_tid),'[]'::jsonb),
    'managedEmail',jsonb_build_object(
      'localPart',coalesce(v_managed_local,''),
      'domain',v_managed_domain,
      'address',case when v_managed_local is null then '' else v_managed_local||'@'||v_managed_domain end,
      'registrationAvailable',public.solo_setup_managed_email_registration_ready()
    )
  );
end $function$;
