-- ============================================================================
-- #616 · coach-fields seam — §32 behavioral regression test (self-contained).
--
-- Proves the own-record-or-tenant-admin gate on set_coach_fields /
-- get_tenant_coach_fields (migration 20260803210000). Synthetic fixtures only;
-- rolls back. Terminal row 'COACH_FIELDS_GATE_PROVEN' = pass; any RAISE = fail.
--
-- Matrix proven (§51):
--   1. coach edits OWN coach fields            → allowed (persists)
--   2. coach edits a PEER's coach fields       → denied (42501)
--   3. tenant admin edits a SAME-tenant coach  → allowed (persists)
--   4. tenant admin edits a CROSS-tenant coach → denied (42501)
--   5. tenant admin reads coach fields         → same-tenant only, no cross leak
--
-- Run: psql "$DB_URL" -1 -f supabase/tests/coach_fields_gate.sql
-- ============================================================================
BEGIN;

INSERT INTO auth.users(id,aud,role,email) VALUES
 ('c0000000-0000-0000-0000-0000000000a1','authenticated','authenticated','cf-admin@x.invalid'),
 ('c0000000-0000-0000-0000-0000000000c1','authenticated','authenticated','cf-coach1@x.invalid'),
 ('c0000000-0000-0000-0000-0000000000c2','authenticated','authenticated','cf-coach2@x.invalid'),
 ('c0000000-0000-0000-0000-0000000000c3','authenticated','authenticated','cf-coach3@x.invalid');

INSERT INTO public.tenants(id,slug,name,status,account_type,account_number_prefix,features) VALUES
 ('c0000000-0000-0000-0000-000000001111','cf-t1','CF T1','active','standalone','CF1','{}'::jsonb),
 ('c0000000-0000-0000-0000-000000002222','cf-t2','CF T2','active','standalone','CF2','{}'::jsonb);

INSERT INTO public.profiles(user_id,active_tenant_id,coach_specialties,coach_capacity,coach_accepting_clients) VALUES
 ('c0000000-0000-0000-0000-0000000000a1','c0000000-0000-0000-0000-000000001111','{}',NULL,true),
 ('c0000000-0000-0000-0000-0000000000c1','c0000000-0000-0000-0000-000000001111','{}',5,true),
 ('c0000000-0000-0000-0000-0000000000c2','c0000000-0000-0000-0000-000000001111','{}',5,true),
 ('c0000000-0000-0000-0000-0000000000c3','c0000000-0000-0000-0000-000000002222','{}',5,true);

INSERT INTO public.tenant_members(tenant_id,user_id,role,status,is_owner,joined_at) VALUES
 ('c0000000-0000-0000-0000-000000001111','c0000000-0000-0000-0000-0000000000a1','admin','active',false,now()),
 ('c0000000-0000-0000-0000-000000001111','c0000000-0000-0000-0000-0000000000c1','member','active',false,now()),
 ('c0000000-0000-0000-0000-000000001111','c0000000-0000-0000-0000-0000000000c2','member','active',false,now()),
 ('c0000000-0000-0000-0000-000000002222','c0000000-0000-0000-0000-0000000000c3','member','active',false,now());

DO $t$
DECLARE _n int; _blocked boolean;
BEGIN
  PERFORM set_config('role','authenticated',true);

  -- 1. coach edits OWN → allowed
  PERFORM set_config('request.jwt.claims','{"sub":"c0000000-0000-0000-0000-0000000000c1","role":"authenticated"}',true);
  PERFORM public.set_coach_fields('c0000000-0000-0000-0000-0000000000c1','{funding}'::text[],7,false,NULL,NULL);
  SELECT coach_capacity INTO _n FROM public.profiles WHERE user_id='c0000000-0000-0000-0000-0000000000c1';
  IF _n<>7 THEN RAISE EXCEPTION 'FAIL_SELF: own edit did not persist (cap=%)',_n; END IF;

  -- 2. coach edits PEER → denied
  _blocked:=false;
  BEGIN PERFORM public.set_coach_fields('c0000000-0000-0000-0000-0000000000c2','{x}'::text[],9,false,NULL,NULL);
  EXCEPTION WHEN sqlstate '42501' THEN _blocked:=true; END;
  IF NOT _blocked THEN RAISE EXCEPTION 'FAIL_PEER: coach edited a peer'; END IF;

  -- 3. admin edits SAME-tenant coach → allowed
  PERFORM set_config('request.jwt.claims','{"sub":"c0000000-0000-0000-0000-0000000000a1","role":"authenticated"}',true);
  PERFORM public.set_coach_fields('c0000000-0000-0000-0000-0000000000c1','{funding,credit}'::text[],3,true,NULL,NULL);
  SELECT coach_capacity INTO _n FROM public.profiles WHERE user_id='c0000000-0000-0000-0000-0000000000c1';
  IF _n<>3 THEN RAISE EXCEPTION 'FAIL_ADMIN_SAME: admin edit did not persist (cap=%)',_n; END IF;

  -- 4. admin edits CROSS-tenant coach → denied
  _blocked:=false;
  BEGIN PERFORM public.set_coach_fields('c0000000-0000-0000-0000-0000000000c3','{x}'::text[],1,false,NULL,NULL);
  EXCEPTION WHEN sqlstate '42501' THEN _blocked:=true; END;
  IF NOT _blocked THEN RAISE EXCEPTION 'FAIL_ADMIN_XTENANT: admin edited a cross-tenant coach'; END IF;

  -- 5. admin READ → same-tenant only (c1,c2), never c3
  SELECT count(*) INTO _n FROM public.get_tenant_coach_fields(ARRAY['c0000000-0000-0000-0000-0000000000c1','c0000000-0000-0000-0000-0000000000c2','c0000000-0000-0000-0000-0000000000c3']::uuid[]);
  IF _n<>2 THEN RAISE EXCEPTION 'FAIL_READ: admin saw % coach rows (expected 2)',_n; END IF;

  PERFORM set_config('role','postgres',true);
END $t$;

SELECT 'COACH_FIELDS_GATE_PROVEN' AS proof;
ROLLBACK;
