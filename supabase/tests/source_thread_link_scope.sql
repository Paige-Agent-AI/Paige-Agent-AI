-- ============================================================================
-- Trusted task↔thread link — §9/§13 RLS SET-ROLE proof (VERIFY-ONLY, rolls back).
--
-- Owner ruling (2026-09-13): when Paige creates a task from a chat conversation, the thread
-- association must come from TRUSTED server-side context — the caller's OWN thread in the RESOLVED
-- tenant — never a client-supplied/forged thread id. The edge `crm_create_task` now validates the
-- body thread CLAIM with an RLS-scoped read on the caller's JWT client, filtered by
--   id = <claim> AND tenant_id = current_user_tenant_id() AND caller_user_id = auth.uid()
-- and stamps `tasks.source_thread_id` ONLY when that returns the row (else NULL).
--
-- This test proves the SECURITY the edge relies on, at the RLS layer it cannot bypass:
--   (1) SAME-TENANT owner: the validation read returns the caller's own thread → a link is allowed.
--   (2) CROSS-TENANT denial: a caller in tenant B running the exact validation read for tenant A's
--       thread gets 0 rows → the edge resolves NULL → the task is never attached to A's conversation.
--   (3) ACCOUNT-SWITCH denial: the SAME user, re-seated into tenant B, cannot validate a thread that
--       lives in tenant A (current_user_tenant_id() moved) → 0 rows.
--   (4) NO DISCOVERY / NO LEAK: even if a task in tenant B already carried tenant A's thread id as
--       source_thread_id, that uuid grants its owner NO read of the foreign thread — the task is
--       visible to its owner, the linked conversation is not (RLS denies the cross-tenant thread read).
-- Synthetic fixtures only; self-contained; rolls back. Terminal row 'SOURCE_THREAD_LINK_SCOPE_PROVEN'
-- = pass; any RAISE = fail.
--
-- Run: psql "$DB_URL" -1 -f supabase/tests/source_thread_link_scope.sql
-- ============================================================================
BEGIN;

-- PRIVILEGE PARITY. The `threads_select_owner_or_admin` policy on `paige_chat_threads` calls
-- `public.is_tenant_admin(tenant_id)`, so `authenticated` must hold EXECUTE on it. Production does,
-- from project default privileges no migration wrote (#1204 records the missing migration grant).
-- The database-contract job reproduces production's API-role grants before this file runs
-- (scripts/ci/reproduce-production-grants.mjs), so no test-local grant is needed or wanted.

INSERT INTO auth.users (id, aud, role, email) VALUES
  ('57a00000-0000-0000-0000-0000000000a1','authenticated','authenticated','stl-user-a@example.invalid'),
  ('57a00000-0000-0000-0000-0000000000b1','authenticated','authenticated','stl-user-b@example.invalid');

-- Two INDEPENDENT tenants (no parent relationship) — a hard cross-tenant boundary.
INSERT INTO public.tenants (id, slug, name, status, account_type, account_number_prefix, features) VALUES
  ('57a00000-0000-0000-0000-00000000aaaa','stl-tenant-a','STL Tenant A','active','standalone','STA','{}'::jsonb),
  ('57a00000-0000-0000-0000-00000000bbbb','stl-tenant-b','STL Tenant B','active','standalone','STB','{}'::jsonb);

-- User A owns tenant A (active there); User B owns tenant B (active there).
-- MEMBERSHIP MUST BE SEEDED FIRST. `guard_active_tenant_membership()` fires on the profiles UPDATE
-- below and RAISES unless the user is ALREADY an active member of the tenant being set active. And
-- `INSERT INTO auth.users` above already created each `profiles` shell (active_tenant_id NULL) via
-- the `handle_new_user` trigger, so setting active_tenant_id is an `ON CONFLICT DO UPDATE`
-- (TG_OP='UPDATE'), never a bare INSERT — a plain insert collides on profiles_user_id_key. So the
-- tenant_members rows MUST exist before the pointer write, or the guard blocks it (same membership-
-- first ordering the account-switch step below already uses). (Pattern: business_context_readiness.sql.)
INSERT INTO public.tenant_members (tenant_id, user_id, role, status, is_owner, joined_at) VALUES
  ('57a00000-0000-0000-0000-00000000aaaa','57a00000-0000-0000-0000-0000000000a1','owner','active',true, now()),
  ('57a00000-0000-0000-0000-00000000bbbb','57a00000-0000-0000-0000-0000000000b1','owner','active',true, now());
INSERT INTO public.profiles (user_id, active_tenant_id) VALUES
  ('57a00000-0000-0000-0000-0000000000a1','57a00000-0000-0000-0000-00000000aaaa'),
  ('57a00000-0000-0000-0000-0000000000b1','57a00000-0000-0000-0000-00000000bbbb')
ON CONFLICT (user_id) DO UPDATE SET active_tenant_id = EXCLUDED.active_tenant_id;

-- User A's private thread in tenant A.
INSERT INTO public.paige_chat_threads
  (id, caller_user_id, contact_id, tenant_id, lens, title, consent_snapshot, auto_delete_at, last_message_at)
VALUES ('57a00000-0000-0000-0000-00000000face','57a00000-0000-0000-0000-0000000000a1', NULL,
        '57a00000-0000-0000-0000-00000000aaaa','coach','A private thread','{}'::jsonb,
        now()+interval '90 days', now());

-- A task in tenant B, owned by B, that ALREADY carries tenant A's thread id as its link — the exact
-- foreign-link shape the hardening prevents at write time; here we prove it grants no cross read.
INSERT INTO public.tasks (id, user_id, tenant_id, title, status, source_thread_id) VALUES
  ('57a00000-0000-0000-0000-00000000ca51','57a00000-0000-0000-0000-0000000000b1',
   '57a00000-0000-0000-0000-00000000bbbb','B task with a foreign link','pending',
   '57a00000-0000-0000-0000-00000000face');

DO $t$
DECLARE _n int;
BEGIN
  -- (1) SAME-TENANT owner A validates their OWN thread (the edge lookup returns the row → link OK).
  PERFORM set_config('role','authenticated', true);
  PERFORM set_config('request.jwt.claims',
    '{"sub":"57a00000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
  IF public.is_platform_owner() THEN RAISE EXCEPTION 'SETUP_FAIL: user A resolves as platform owner'; END IF;
  SELECT count(*) INTO _n FROM public.paige_chat_threads
    WHERE id='57a00000-0000-0000-0000-00000000face'
      AND tenant_id = public.current_user_tenant_id()
      AND caller_user_id = auth.uid();
  IF _n <> 1 THEN RAISE EXCEPTION 'FAIL_SAME_TENANT: owner A could not validate their own thread (% rows)', _n; END IF;

  -- (2) CROSS-TENANT denial — user B runs the EXACT validation read for A's thread → 0 rows.
  PERFORM set_config('request.jwt.claims',
    '{"sub":"57a00000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
  IF public.current_user_tenant_id() <> '57a00000-0000-0000-0000-00000000bbbb' THEN
    RAISE EXCEPTION 'SETUP_FAIL: user B not scoped into tenant B (got %)', public.current_user_tenant_id();
  END IF;
  SELECT count(*) INTO _n FROM public.paige_chat_threads
    WHERE id='57a00000-0000-0000-0000-00000000face'
      AND tenant_id = public.current_user_tenant_id()
      AND caller_user_id = auth.uid();
  IF _n <> 0 THEN RAISE EXCEPTION 'FAIL_CROSS_TENANT: user B validated tenant A''s thread (% rows)', _n; END IF;

  -- (4) NO DISCOVERY / NO LEAK — B owns a task linked to A's thread, but the uuid grants no thread read.
  --     ACCESS-MODEL NOTE: `public.tasks` is SERVICE-ROLE-only — the edge reads it exclusively through
  --     the admin (service-role) client in crm_list_tasks, and `authenticated` has NO table SELECT on
  --     tasks by design (RLS is enabled but no authenticated table grant), so a DIRECT authenticated
  --     read is "permission denied" and is not a path the app uses. So we confirm B OWNS the task as
  --     postgres (the privileged role that actually reads tasks), then prove the security-relevant
  --     claim — the foreign source_thread_id grants B NO read of A's thread — as authenticated-B, which
  --     IS the app's thread read path (RLS). The leak check is what matters; the task check is setup sanity.
  PERFORM set_config('role','postgres', true);
  SELECT count(*) INTO _n FROM public.tasks
    WHERE id='57a00000-0000-0000-0000-00000000ca51'
      AND user_id='57a00000-0000-0000-0000-0000000000b1'
      AND tenant_id='57a00000-0000-0000-0000-00000000bbbb'
      AND source_thread_id='57a00000-0000-0000-0000-00000000face';
  IF _n <> 1 THEN RAISE EXCEPTION 'SETUP_FAIL: B''s task row (with the foreign link) is not present (% rows)', _n; END IF;
  PERFORM set_config('role','authenticated', true);
  PERFORM set_config('request.jwt.claims',
    '{"sub":"57a00000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
  SELECT count(*) INTO _n FROM public.paige_chat_threads WHERE id='57a00000-0000-0000-0000-00000000face';
  IF _n <> 0 THEN RAISE EXCEPTION 'FAIL_DISCOVERY: user B read tenant A''s thread via the task link (% rows)', _n; END IF;

  -- (3) ACCOUNT-SWITCH denial — re-seat user A into tenant B; A can no longer validate A's thread,
  --     because current_user_tenant_id() is now B. (We flip the active tenant the resolver reads.)
  -- CLEAR the JWT first (→ auth.uid() NULL, the trusted service/provisioning path): the
  -- `enforce_tenant_member_consent` trigger (SECURITY INVOKER) NEUTRALIZES a foreign-active
  -- tenant_members insert to 'pending' whenever a NON-NULL caller writes another user's active
  -- membership. With B's JWT still set from case 2, inserting A's active membership as B would
  -- demote it to 'pending', and `guard_active_tenant_membership` would then reject the profiles
  -- flip below. A null caller (exactly how the setup block seeded its members) writes the active
  -- membership directly, which is the real provisioning path.
  PERFORM set_config('role','postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);
  INSERT INTO public.tenant_members (tenant_id, user_id, role, status, is_owner, joined_at) VALUES
    ('57a00000-0000-0000-0000-00000000bbbb','57a00000-0000-0000-0000-0000000000a1','admin','active',false, now());
  UPDATE public.profiles SET active_tenant_id='57a00000-0000-0000-0000-00000000bbbb'
    WHERE user_id='57a00000-0000-0000-0000-0000000000a1';
  PERFORM set_config('role','authenticated', true);
  PERFORM set_config('request.jwt.claims',
    '{"sub":"57a00000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
  IF public.current_user_tenant_id() <> '57a00000-0000-0000-0000-00000000bbbb' THEN
    RAISE EXCEPTION 'SETUP_FAIL: user A did not switch into tenant B (got %)', public.current_user_tenant_id();
  END IF;
  SELECT count(*) INTO _n FROM public.paige_chat_threads
    WHERE id='57a00000-0000-0000-0000-00000000face'
      AND tenant_id = public.current_user_tenant_id()
      AND caller_user_id = auth.uid();
  IF _n <> 0 THEN RAISE EXCEPTION 'FAIL_ACCOUNT_SWITCH: A seated in B validated A''s thread (% rows)', _n; END IF;

  PERFORM set_config('role','postgres', true);
END
$t$;

SELECT 'SOURCE_THREAD_LINK_SCOPE_PROVEN' AS proof;
ROLLBACK;
