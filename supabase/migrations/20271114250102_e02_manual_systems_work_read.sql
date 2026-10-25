-- Extend the original Work projection for the closed, read-only manual purpose.
-- No new reader, grant, dispatch, scan, result or customer activation.
BEGIN;

DO $guard$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
     WHERE oid = 'public.get_paige_durable_work(uuid)'::regprocedure
       AND md5(prosrc) IN ('c9d66a9c23eb9027984a12d4dc801560', 'd953ea9965f31193d3dbf2f184114730')
  ) THEN
    RAISE EXCEPTION 'Original Work reader changed; receiving reconciliation required';
  END IF;
END
$guard$;

create or replace function public.get_paige_durable_work(_work_id uuid)
returns table (
  work_id uuid,
  capability_key text,
  work_kind text,
  work_status text,
  attempt_count integer,
  max_attempts integer,
  blocked_reason text,
  error_code text,
  safe_summary text,
  created_at timestamptz,
  updated_at timestamptz,
  settled_at timestamptz
)
language sql security definer stable set search_path = '' as $$
  select w.id, w.capability_key, w.work_kind, w.status, w.attempt_count, w.max_attempts,
         w.blocked_reason, w.error_code, w.safe_summary, w.created_at, w.updated_at, w.settled_at
    from public.paige_durable_work w
   where w.id = _work_id
     and auth.uid() is not null
     and case when w.work_kind='systems_check' or w.capability_key='systems.check' then
       w.work_kind='systems_check' and w.capability_key='systems.check'
       and w.request_payload='{"version":1,"scope":"tenant","scan_flavor":"manual","action_filing":"none"}'::jsonb
       and w.scope_epoch='tenant:'||w.tenant_id::text||':systems-check:manual:v1'
       and w.max_attempts=1 and w.attempt_count=1
       and public._analytics_metric_authorized(w.tenant_id)
       and exists(select 1 from public.tenants t where t.id=w.tenant_id
         and t.account_type::text='standalone' and t.parent_tenant_id is null)
     when w.work_kind in ('knowledge_extract','knowledge_publish') then
       ((w.work_kind='knowledge_extract' and w.capability_key='knowledge.extract')
         or (w.work_kind='knowledge_publish' and w.capability_key='knowledge.publish'))
       and public.knowledge_actor_authorized(auth.uid(),w.tenant_id)
       and (w.initiating_user_id=auth.uid() or public.is_platform_owner(auth.uid())
            or public.is_tenant_admin_as(auth.uid(),w.tenant_id)
            or exists (select 1 from public.tenant_members m
              where m.tenant_id=w.tenant_id and m.user_id=auth.uid()
                and m.status='active' and m.is_owner=true))
     else (
       public.is_platform_owner()
       or exists (
         select 1 from public.tenant_members m
          where m.tenant_id = w.tenant_id
            and m.user_id = auth.uid()
            and m.status = 'active'
            and (
              w.initiating_user_id = auth.uid()
              or m.is_owner = true
              or m.role = 'owner'
              or m.role = 'admin'
            )
       )
     ) end
$$;

COMMIT;
