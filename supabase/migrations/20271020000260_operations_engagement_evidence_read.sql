begin;
-- Operations consumes the existing Sales signing source under caller RLS.
-- No commercial mutation, signer payload, storage-key disclosure or new record store.
create or replace function public.operations_engagement_evidence_read(
 p_expected_actor_id uuid,p_expected_tenant_id uuid,p_agreement_id uuid
) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v_actor uuid:=auth.uid();v_tenant uuid;v_result jsonb;
begin
 if v_actor is null or v_actor is distinct from p_expected_actor_id or p_expected_tenant_id is null then
   raise exception 'OPERATIONS_ENGAGEMENT_SCOPE_CHANGED' using errcode='42501'; end if;
 v_tenant:=public.current_user_tenant_id();
 if v_tenant is distinct from p_expected_tenant_id or not public.is_tenant_member(v_tenant) then
   raise exception 'OPERATIONS_ENGAGEMENT_SCOPE_CHANGED' using errcode='42501'; end if;
 if not exists(select 1 from public.tenants t where t.id=v_tenant and t.account_type::text='standalone' and t.parent_tenant_id is null) then
   raise exception 'OPERATIONS_SOLO_UNAVAILABLE' using errcode='42501'; end if;
 select jsonb_build_object('agreement_id',a.id,'tenant_id',a.tenant_id,
   'contact_id',a.contact_id,'commercial_terms_id',a.commercial_terms_id,'offer_id',a.offer_id,
   'version',a.version,'status',a.status,'completed_at',a.completed_at,'updated_at',a.updated_at,
   'content_sha256',a.content_sha256,'sealed_sha256',a.sealed_sha256,
   'sealed_copy_recorded',a.sealed_storage_key is not null,
   'handoff_authorized',false,'client_accepted',false) into v_result
 from public.paige_agreements a where a.id=p_agreement_id and a.tenant_id=v_tenant;
 if v_result is null then raise exception 'OPERATIONS_ENGAGEMENT_UNAVAILABLE' using errcode='42501'; end if;
 return jsonb_build_object('ok',true,'actor_id',v_actor,'tenant_id',v_tenant,'evidence',v_result);
end; $$;
revoke all on function public.operations_engagement_evidence_read(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.operations_engagement_evidence_read(uuid,uuid,uuid) to authenticated;
comment on function public.operations_engagement_evidence_read(uuid,uuid,uuid) is 'Single signing-evidence projection under caller RLS and canonical Solo scope; signing is not an authorized fulfillment handoff or client acceptance.';
commit;
