-- Migration A (Vibe Studio V0, owner-authorized 2026-10-03): one autonomy resolution, two readers.
--
-- VERSION NOTE (2026-10-04): first merged as 20270539000000, which collided with
-- 20270539000000_sales_invoice_line_description (merged minutes earlier). Production recorded that
-- version for the Sales file, so this one never ran; it is renumbered here, unchanged in content.
--
-- WHY. paige-ai-chat lifts six Studio build tools from `confirm` to `auto` so a design turn can
-- build in the same breath (#292). `resolve_tool_autonomy` returns only the final mode, so the lift
-- could not tell "this tenant is asked by default" from "the Trust Compass forbids acting unread".
-- At effective rung 1 (production on 2026-10-03: stored ceiling 3, effective 1) the lift ran those
-- six writes at `auto` above the ceiling — the §68 bypass this migration exists to close.
--
-- WHAT. The body of `resolve_tool_autonomy` moves, unchanged, into ONE internal function that also
-- reports the single extra fact the caller needs: whether the ceiling would permit `auto` at all.
-- `resolve_tool_autonomy` becomes a wrapper over it (same signature, same grants, same result for
-- every input), and `resolve_tool_autonomy_detail` is its sibling. The rung thresholds live in one
-- place, so the two readers cannot drift apart, and no grant on `trust_effective_rung()` changes.
--
-- FAIL CLOSED. Any input the canonical path cannot resolve (no tenant, no tool, social_post) answers
-- `ceiling_allows_auto = false`, so a caller that only lifts when the ceiling allows it never lifts.
--
-- TENANT SCOPE. Unchanged: a signed-in non-operator always resolves their OWN tenant whatever they
-- pass; a platform owner may name one; a service-role caller (auth.uid() NULL) uses the tenant the
-- server already resolved. The detail reveals no tenant setting the plain mode did not already.

create or replace function public._tool_autonomy_resolution(
  _tenant_id uuid,
  _tool_key text
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  _caller uuid:=auth.uid();
  _tenant uuid:=_tenant_id;
  _mode text;
  _rung int;
begin
  if _tool_key='social_post' then
    return jsonb_build_object('mode','off','ceiling_allows_auto',false);
  end if;
  if _caller is not null and not public.is_platform_owner() then
    _tenant:=public.current_user_tenant_id();
  end if;
  if _caller is not null and public.is_platform_owner() and _tenant_id is not null then
    _tenant:=_tenant_id;
  end if;
  if _tenant is null or _tool_key is null then
    return jsonb_build_object('mode','confirm','ceiling_allows_auto',false);
  end if;
  select mode into _mode from public.tenant_tool_autonomy
  where tenant_id=_tenant and tool_key=_tool_key;
  _mode:=coalesce(_mode,'confirm');
  _rung:=public.trust_effective_rung();
  -- The mode branches are the previous body verbatim (rung 0 forces off; rung 1 turns auto into
  -- confirm). The flag is the only addition: the ceiling allows acting unread from rung 2, and an
  -- unknown rung allows nothing.
  if _rung <= 0 then
    return jsonb_build_object('mode','off','ceiling_allows_auto',false);
  end if;
  if _rung <= 1 and _mode='auto' then
    return jsonb_build_object('mode','confirm','ceiling_allows_auto',false);
  end if;
  return jsonb_build_object('mode',_mode,'ceiling_allows_auto',coalesce(_rung >= 2,false));
end $$;
revoke all on function public._tool_autonomy_resolution(uuid,text) from public,anon,authenticated,service_role;
comment on function public._tool_autonomy_resolution(uuid,text) is
  'The one autonomy resolution: tenant tool mode clamped by the Trust Compass effective rung, plus whether the ceiling permits auto at all. Internal — read through resolve_tool_autonomy / resolve_tool_autonomy_detail.';

create or replace function public.resolve_tool_autonomy(
  _tenant_id uuid,
  _tool_key text
)
returns text
language sql
stable
security definer
set search_path to 'public'
as $$
  select public._tool_autonomy_resolution(_tenant_id,_tool_key)->>'mode';
$$;
revoke all on function public.resolve_tool_autonomy(uuid,text) from public,anon;
grant execute on function public.resolve_tool_autonomy(uuid,text) to authenticated,service_role;
comment on function public.resolve_tool_autonomy(uuid,text) is
  'Tenant tool mode clamped by the Trust Compass (rung 0 off, rung 1 auto→confirm). social_post is hard-off until its governed Phase 4 executor and provider proof exist. Reads _tool_autonomy_resolution.';

create or replace function public.resolve_tool_autonomy_detail(
  _tenant_id uuid,
  _tool_key text
)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select public._tool_autonomy_resolution(_tenant_id,_tool_key);
$$;
revoke all on function public.resolve_tool_autonomy_detail(uuid,text) from public,anon;
grant execute on function public.resolve_tool_autonomy_detail(uuid,text) to authenticated,service_role;
comment on function public.resolve_tool_autonomy_detail(uuid,text) is
  'resolve_tool_autonomy plus ceiling_allows_auto: false when the Trust Compass effective rung forbids acting unread (rung 0-1) or the input is unresolvable. A caller that lifts confirm to auto (the Vibe Studio build list) must require ceiling_allows_auto = true.';
