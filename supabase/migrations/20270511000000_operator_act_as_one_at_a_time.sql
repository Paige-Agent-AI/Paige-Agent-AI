-- =============================================================================
-- Operator act-as — one at a time, decided on the server (fix for the act-as defect, #1547)
-- =============================================================================
-- The ruling: an act-as completes on both sides or on neither. The client now reads the
-- operator's scope before entering and refuses to enter over an open act-as, and it locks a
-- single exit button against a second press. Both of those checks live in ONE browser tab. With
-- the console or a tenant shell open in two tabs (Codex review of #1547, 2026-09-28):
--
--   * ENTER: both tabs read an empty scope, both call operator_enter_tenant, and the RPC wrote
--     unconditionally — two "entered" receipts committed, the last pointer won, and the earlier
--     tab's receipt named a tenant its session never stood in.
--   * EXIT: both tabs pressed Exit, and the RPC recorded an exit even when the other call had
--     already cleared the scope — a second, null-tenant exit receipt.
--
-- So the rule moves into the RPCs, where two tabs cannot both pass it. Each locks the caller's
-- profile row (FOR UPDATE) before reading the pointer, so concurrent calls for one operator are
-- decided one after the other against the committed state:
--
--   * operator_enter_tenant(_tenant)
--       - scope empty            → enter and record, as before;
--       - already in _tenant     → no change and NO second receipt; answers already_entered;
--       - in a different tenant  → refused: 'operator_scope_occupied'. Nothing is written. The
--                                  operator ends that act-as first (the console offers it).
--   * operator_exit_tenant()
--       - in a tenant            → exit and record, as before;
--       - scope already empty    → no change and NO receipt; answers already_exited.
--
-- REVERSED HERE, recorded rather than silent (§58): the original exit logged even from an
-- empty scope, "so the audit trail never reads as an unbounded session." An exit from an empty
-- scope closes nothing — the session it would close was already closed by the exit that emptied
-- it — and a receipt with a NULL tenant never closed anything in the trail either. The one real
-- gap, a pointer cleared by some other path without an exit row, is not reached by this receipt;
-- it is A2's (direct writes to the pointer), and the settlement records it.
--
-- Also changed: entering the tenant already entered used to write a second enter receipt. It
-- now writes none — one act-as, one receipt.
--
-- Producers (§37), inventoried 2026-09-28: the only caller of either RPC is the web provider
-- (src/hooks/useTenantContext.tsx), which already reads scope first, treats a lost response by
-- reading the pointer back, and maps this refusal to its "occupied" outcome. No edge function,
-- MCP tool, trigger, cron job, workflow or script calls them (their other mentions in the repo
-- are comments). The return shape only gains keys.
--
-- §59 unchanged: SECURITY DEFINER, authority re-checked in the body before any read or write,
-- keyed on auth.uid() alone. Grants are unchanged (CREATE OR REPLACE keeps them).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.operator_enter_tenant(_tenant uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _name  text;
  _prev  uuid;
  _found boolean;
BEGIN
  IF NOT public.is_platform_operator() THEN
    RAISE EXCEPTION 'operator_scope_forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT name INTO _name FROM public.tenants WHERE id = _tenant;
  IF _name IS NULL THEN
    RAISE EXCEPTION 'tenant_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- The lock is the rule: a second call for this operator waits here until the first commits,
  -- then reads what it wrote.
  SELECT active_tenant_id, true INTO _prev, _found
    FROM public.profiles WHERE user_id = auth.uid() FOR UPDATE;
  IF NOT coalesce(_found, false) THEN
    RAISE EXCEPTION 'operator_profile_missing' USING ERRCODE = 'P0002';
  END IF;

  IF _prev = _tenant THEN
    RETURN jsonb_build_object('active_tenant_id', _tenant, 'name', _name, 'already_entered', true);
  END IF;

  IF _prev IS NOT NULL THEN
    RAISE EXCEPTION 'operator_scope_occupied'
      USING ERRCODE = 'P0001',
            DETAIL = 'End the open act-as before entering another tenant. Nothing was entered.';
  END IF;

  UPDATE public.profiles SET active_tenant_id = _tenant WHERE user_id = auth.uid();

  -- Same transaction as the scope change: "entered" and "recorded" cannot disagree.
  INSERT INTO public.paige_audit_log
    (actor_user_id, actor_role, action, target_type, target_id, tenant_id, payload)
  VALUES
    (auth.uid(), 'platform_operator', 'operator.tenant.enter', 'tenant', _tenant, _tenant,
     jsonb_build_object('tenant_name', _name, 'previous_active_tenant_id', _prev));

  RETURN jsonb_build_object('active_tenant_id', _tenant, 'name', _name);
END;
$$;

COMMENT ON FUNCTION public.operator_enter_tenant(uuid) IS
  'Platform operator acts as a tenant: points profiles.active_tenant_id and records the act in paige_audit_log. One act-as at a time: refuses with operator_scope_occupied while another tenant is entered, and re-entering the same tenant records nothing. Grants NO tenant_members membership by design (§9).';

CREATE OR REPLACE FUNCTION public.operator_exit_tenant()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _prev  uuid;
  _found boolean;
BEGIN
  IF NOT public.is_platform_operator() THEN
    RAISE EXCEPTION 'operator_scope_forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT active_tenant_id, true INTO _prev, _found
    FROM public.profiles WHERE user_id = auth.uid() FOR UPDATE;
  IF NOT coalesce(_found, false) THEN
    RAISE EXCEPTION 'operator_profile_missing' USING ERRCODE = 'P0002';
  END IF;

  IF _prev IS NULL THEN
    RETURN jsonb_build_object('active_tenant_id', NULL, 'previous_active_tenant_id', NULL,
                              'already_exited', true);
  END IF;

  UPDATE public.profiles SET active_tenant_id = NULL WHERE user_id = auth.uid();

  INSERT INTO public.paige_audit_log
    (actor_user_id, actor_role, action, target_type, target_id, tenant_id, payload)
  VALUES
    (auth.uid(), 'platform_operator', 'operator.tenant.exit', 'tenant', _prev, _prev,
     jsonb_build_object('previous_active_tenant_id', _prev));

  RETURN jsonb_build_object('active_tenant_id', NULL, 'previous_active_tenant_id', _prev);
END;
$$;

COMMENT ON FUNCTION public.operator_exit_tenant() IS
  'Platform operator stops acting as a tenant: restores the tenant-less resting state (active_tenant_id = NULL) and records the exit in paige_audit_log. An exit from an empty scope changes nothing and records nothing.';
