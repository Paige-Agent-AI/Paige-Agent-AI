-- C0a — PAIGE capability projection: the effective autonomy lane of every emitted tool in ONE call.
-- docs/delivery/paige-conversational-loop-r0.md section 20: lanes are "resolved for every emitted
-- mutating tool (batched), not 8 hand-picked keys".
--
-- ADDITIVE. Creates one function. Changes no existing function, grant, row or policy.
--
-- NO SECOND RESOLVER. Each key is answered by public.resolve_tool_autonomy_detail, which reads the
-- ONE internal resolution public._tool_autonomy_resolution (20270540000000) that
-- public.resolve_tool_autonomy also reads. For every input, `mode` here is exactly
-- resolve_tool_autonomy(_tenant_id, key) and `ceiling_allows_auto` is exactly the detail's flag:
-- the Trust ceiling, the social_post hard-off and the tenant pin all come along unchanged.
-- This function owns iteration, de-duplication and a size bound. Nothing else.
--
-- SECURITY INVOKER (CLAUDE.md section 59). It reads no table and bypasses nothing: it runs as the
-- caller and can only reach the reader the caller is already granted. That reader is the DEFINER
-- boundary and re-pins a signed-in non-operator to their OWN tenant whatever _tenant_id says; a
-- service-role caller (auth.uid() NULL) keeps the tenant the server resolved -- identical to
-- calling the reader once per key. A DEFINER wrapper would add an RLS-bypassing function to the
-- inventory for no gain.
--
-- BOUNDED. At most 256 keys (the chat surface emits ~164 tools, 104 mutating); each key 1..128
-- characters; NULL and blank keys are dropped; duplicates are answered once, in first-seen order.
-- Over the bound is a loud 22023, never a silent truncation.
--
-- COST, stated: trust_effective_rung() is evaluated once per key inside the canonical resolution
-- (one admin_app_settings read + platform_safety_proof_internal per key). Hoisting it here would
-- fork the resolution; if it ever measures as material, the fix belongs in
-- _tool_autonomy_resolution, not in this wrapper.
--
-- Producers/consumers: none yet. First consumer: paige-ai-chat's capability projection, via the
-- caller-JWT client, filling autonomyModeCache and ceilingAllowsAutoCache in one round trip.

create or replace function public.resolve_tool_autonomy_many(
  _tenant_id uuid,
  _tool_keys text[]
)
returns table(tool_key text, mode text, ceiling_allows_auto boolean)
language plpgsql
stable
security invoker
set search_path to 'public'
as $$
#variable_conflict use_column
declare
  _n int := coalesce(cardinality(_tool_keys), 0);
begin
  if _n > 256 then
    raise exception 'TOOL_AUTONOMY_BATCH_TOO_LARGE: % keys requested, at most 256', _n
      using errcode = '22023';
  end if;

  return query
    select k.key_text,
           coalesce(k.detail->>'mode', 'confirm'),
           coalesce((k.detail->>'ceiling_allows_auto')::boolean, false)
      from (
        select d.key_text,
               d.first_ord,
               public.resolve_tool_autonomy_detail(_tenant_id, d.key_text) as detail
          from (
            select u.key_text, min(u.ord) as first_ord
              from unnest(_tool_keys) with ordinality as u(key_text, ord)
             where u.key_text is not null
               and length(btrim(u.key_text)) >= 1
               and length(u.key_text) <= 128
             group by u.key_text
          ) d
      ) k
     order by k.first_ord;
end $$;

revoke all on function public.resolve_tool_autonomy_many(uuid, text[]) from public, anon;
grant execute on function public.resolve_tool_autonomy_many(uuid, text[]) to authenticated, service_role;

comment on function public.resolve_tool_autonomy_many(uuid, text[]) is
  'Batch reader over resolve_tool_autonomy_detail: one row per distinct key (first-seen order, max 256, each 1..128 chars) with the same mode resolve_tool_autonomy returns and the same ceiling_allows_auto flag. SECURITY INVOKER; owns no autonomy logic. Tenant pinning, the Trust ceiling and the social_post hard-off are applied by the canonical resolution it calls.';
