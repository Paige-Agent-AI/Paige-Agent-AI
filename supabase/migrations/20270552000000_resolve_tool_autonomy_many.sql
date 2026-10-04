-- C0a — PAIGE capability projection: the effective autonomy lane of every emitted tool in ONE call,
-- with the Trust Compass rung evaluated ONCE per call instead of once per tool.
-- docs/delivery/paige-conversational-loop-r0.md section 20: lanes are "resolved for every emitted
-- mutating tool (batched), not 8 hand-picked keys".
--
-- WHY THE RESOLUTION ITSELF CHANGES (measured, §71.3). The first version of this migration looped
-- resolve_tool_autonomy_detail once per key. Each call re-ran trust_effective_rung() (an
-- admin_app_settings read + a DISTINCT ON scan in platform_safety_proof_internal). Measured read-only
-- on prod by the C0a verifier: ~38 ms per rung, 104 keys = 4,936 ms, on the path before the first
-- model call. trust_effective_rung() takes no arguments, so its value is the same for every key of a
-- call. The fix belongs in the one canonical resolution (as that version's own COST note said), not
-- in a wrapper that would fork it.
--
-- ONE RESOLUTION, TWO SHAPES. public._tool_autonomy_resolution_many is now THE resolution: tenant
-- pinning once, tenant_tool_autonomy read once, rung read once, then the previous per-key branches
-- verbatim as a CASE. public._tool_autonomy_resolution (20270540000000) keeps its signature and every
-- reader of it (resolve_tool_autonomy, resolve_tool_autonomy_detail, and through them every dispatch
-- gate) and becomes a one-key call into it. There is no second copy of the branch logic anywhere.
--
-- EQUIVALENCE + COST, proved on prod 2026-10-04 inside a self-raising DO block (rolled back; pg_proc
-- re-read afterwards showed nothing persisted). 132 (tenant, key) pairs — every tenant_tool_autonomy
-- row, every tenant x {social_post, an unknown key, NULL}, a tenant with no rows, a NULL tenant, and
-- the busiest tenant x all 64 distinct keys: 0 differences between the old and new single-key result,
-- and 0 between the batch and the OLD single-key result. 64 keys: per-key loop 2,334.9 ms → batch
-- 37.2 ms; one key: 37.5 ms → 36.5 ms. NULL handling is preserved deliberately: an unknown rung (NULL)
-- falls through both clamps exactly as the plpgsql IFs did, and a NULL key resolves 'confirm'.
--
-- TENANT SCOPE (§59), unchanged and enforced IN BODY: a signed-in non-operator always resolves their
-- OWN tenant whatever they pass; a platform owner may name one; a service-role caller (auth.uid()
-- NULL) uses the tenant the server already resolved.
--
-- ALSO HERE: paige_improvement_proposals RLS moves from the GLOBAL user_roles row to the tenant
-- question the chat gate now asks (owner ruling 2026-10-04, "ADMIN IS A TENANT ROLE"). The chat's
-- improvement_* tools write through the caller's JWT; with the gate on the workspace seat and the
-- policy on the global row the two disagreed (C0a verifier, §59/§37). Producers: paige-ai-chat
-- (caller JWT, the only RLS-bound writer) and paige-evaluator (service role, bypasses RLS). No UI
-- reads the table. Proved on prod 2026-10-04: for all 12 users holding a seat or an admin/operator
-- row, evaluated under their own JWT claims, the old and new predicates agree — nobody gains or loses.

create or replace function public._tool_autonomy_resolution_many(
  _tenant_id uuid,
  _tool_keys text[]
)
returns table(tool_key text, ord bigint, resolution jsonb)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
#variable_conflict use_column
declare
  _caller uuid:=auth.uid();
  _tenant uuid:=_tenant_id;
  _rung int;
begin
  if _caller is not null and not public.is_platform_owner() then
    _tenant:=public.current_user_tenant_id();
  end if;
  if _caller is not null and public.is_platform_owner() and _tenant_id is not null then
    _tenant:=_tenant_id;
  end if;
  -- The rung is read only when some key will reach it, exactly as the per-key body only read it
  -- past the social_post and unresolvable-input early returns.
  if _tenant is not null and exists (
    select 1 from unnest(_tool_keys) k(v) where k.v is not null and k.v<>'social_post'
  ) then
    _rung:=public.trust_effective_rung();
  end if;

  return query
    select u.v,
           u.n,
           case
             when u.v='social_post' then jsonb_build_object('mode','off','ceiling_allows_auto',false)
             when _tenant is null or u.v is null then jsonb_build_object('mode','confirm','ceiling_allows_auto',false)
             -- the mode branches of the previous body, verbatim (rung 0 forces off; rung 1 turns
             -- auto into confirm); an unknown (NULL) rung matches neither, as before
             when _rung <= 0 then jsonb_build_object('mode','off','ceiling_allows_auto',false)
             when _rung <= 1 and coalesce(t.mode,'confirm')='auto'
               then jsonb_build_object('mode','confirm','ceiling_allows_auto',false)
             else jsonb_build_object('mode',coalesce(t.mode,'confirm'),'ceiling_allows_auto',coalesce(_rung >= 2,false))
           end
      from unnest(_tool_keys) with ordinality as u(v,n)
      left join public.tenant_tool_autonomy t
        on t.tenant_id=_tenant and t.tool_key=u.v
     order by u.n;
end $$;
revoke all on function public._tool_autonomy_resolution_many(uuid,text[]) from public,anon,authenticated,service_role;
comment on function public._tool_autonomy_resolution_many(uuid,text[]) is
  'The one autonomy resolution, for one or many keys: tenant tool mode clamped by the Trust Compass effective rung (read once per call), plus whether the ceiling permits auto. Internal — read through resolve_tool_autonomy / _detail / _many.';

-- The single-key resolution keeps its signature and readers; its body is now one call into the above.
create or replace function public._tool_autonomy_resolution(
  _tenant_id uuid,
  _tool_key text
)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select r.resolution from public._tool_autonomy_resolution_many(_tenant_id, array[_tool_key]) r;
$$;
revoke all on function public._tool_autonomy_resolution(uuid,text) from public,anon,authenticated,service_role;
comment on function public._tool_autonomy_resolution(uuid,text) is
  'The one autonomy resolution for one key: delegates to _tool_autonomy_resolution_many. Internal — read through resolve_tool_autonomy / resolve_tool_autonomy_detail.';

-- The batch reader. DEFINER only so it can reach the internal resolution, which re-pins the tenant
-- in its own body (§59); this wrapper owns de-duplication and a size bound, nothing else.
-- BOUNDED: at most 256 keys (the chat surface emits ~170 tools); each key 1..128 characters; NULL and
-- blank keys dropped; duplicates answered once, first-seen order. Over the bound is a loud 22023.
create or replace function public.resolve_tool_autonomy_many(
  _tenant_id uuid,
  _tool_keys text[]
)
returns table(tool_key text, mode text, ceiling_allows_auto boolean)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
#variable_conflict use_column
declare
  _n int := coalesce(cardinality(_tool_keys), 0);
  _keys text[];
begin
  if _n > 256 then
    raise exception 'TOOL_AUTONOMY_BATCH_TOO_LARGE: % keys requested, at most 256', _n
      using errcode = '22023';
  end if;

  select coalesce(array_agg(d.key_text order by d.first_ord), '{}')
    into _keys
    from (
      select u.key_text, min(u.ord) as first_ord
        from unnest(_tool_keys) with ordinality as u(key_text, ord)
       where u.key_text is not null
         and length(btrim(u.key_text)) >= 1
         and length(u.key_text) <= 128
       group by u.key_text
    ) d;

  return query
    select r.tool_key,
           coalesce(r.resolution->>'mode', 'confirm'),
           coalesce((r.resolution->>'ceiling_allows_auto')::boolean, false)
      from public._tool_autonomy_resolution_many(_tenant_id, _keys) r
     order by r.ord;
end $$;

revoke all on function public.resolve_tool_autonomy_many(uuid, text[]) from public, anon;
grant execute on function public.resolve_tool_autonomy_many(uuid, text[]) to authenticated, service_role;

comment on function public.resolve_tool_autonomy_many(uuid, text[]) is
  'Batch reader over the one autonomy resolution: one row per distinct key (first-seen order, max 256, each 1..128 chars) with the same mode resolve_tool_autonomy returns and the same ceiling_allows_auto flag. The Trust rung is read once per call. Tenant pinning, the ceiling and the social_post hard-off are applied in the internal resolution body.';

-- paige_improvement_proposals: the tenant question, not the global row (see header).
alter policy pip_owner_read on public.paige_improvement_proposals
  using (
    tenant_id = public.current_user_tenant_id()
      and (public.studio_role_ok(auth.uid()) or public.has_role(auth.uid(), 'super_admin'::app_role))
  );
alter policy pip_owner_write on public.paige_improvement_proposals
  with check (
    tenant_id = public.current_user_tenant_id()
      and (public.studio_role_ok(auth.uid()) or public.has_role(auth.uid(), 'super_admin'::app_role))
  );
alter policy pip_owner_update on public.paige_improvement_proposals
  using (
    tenant_id = public.current_user_tenant_id()
      and (public.studio_role_ok(auth.uid()) or public.has_role(auth.uid(), 'super_admin'::app_role))
  );
