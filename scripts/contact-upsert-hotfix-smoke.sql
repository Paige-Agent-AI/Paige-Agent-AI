-- Transactional smoke for the Solo People / PAIGE shared contact upsert contract.
-- Requires a seeded admin|super_admin|coach and at least two tenants. It leaves no rows behind.
-- A contact's addresses are one list, `contact_methods` (20270515000000); the single email/phone
-- keys are refused by name (20270519010000), and replacing an existing contact's list names the
-- list that was loaded (20270519000000).
BEGIN;

DO $smoke$
DECLARE
  actor_id uuid;
  tenant_a uuid;
  tenant_b uuid;
  contact_id uuid;
  address_count integer;
BEGIN
  SELECT ur.user_id INTO actor_id
    FROM public.user_roles AS ur
   WHERE ur.role::text IN ('admin','super_admin','coach')
   LIMIT 1;
  SELECT t.id INTO tenant_a FROM public.tenants AS t ORDER BY t.created_at LIMIT 1;
  SELECT t.id INTO tenant_b FROM public.tenants AS t WHERE t.id <> tenant_a ORDER BY t.created_at LIMIT 1;
  IF actor_id IS NULL OR tenant_a IS NULL OR tenant_b IS NULL THEN
    RAISE EXCEPTION 'CONTACT_UPSERT_SMOKE_NEEDS_SEEDED_ACTOR_AND_TWO_TENANTS';
  END IF;

  contact_id := public.upsert_contact(
    jsonb_build_object('first_name','Smoke','last_name','Contact','source','manual',
                       'contact_methods', jsonb_build_array(jsonb_build_object('kind','email','value','smoke-upsert@example.invalid'))),
    NULL, tenant_a, actor_id, 'api'
  );
  BEGIN
    PERFORM public.upsert_contact(
      jsonb_build_object('contact_methods','[]'::jsonb,
                         'expected_contact_methods', jsonb_build_array(jsonb_build_object('kind','email','value','someone-else@example.invalid','is_primary',true))),
      contact_id, tenant_a, actor_id, 'api'
    );
    RAISE EXCEPTION 'CONTACT_UPSERT_STALE_LIST_ALLOWED';
  EXCEPTION WHEN SQLSTATE '40001' THEN NULL;
  END;
  PERFORM public.upsert_contact(
    jsonb_build_object('contact_methods','[]'::jsonb,
                       'expected_contact_methods', jsonb_build_array(jsonb_build_object('kind','email','value','smoke-upsert@example.invalid','is_primary',true)),
                       'city','Atlanta','tags',jsonb_build_array('hotfix'),'do_not_contact',true),
    contact_id, tenant_a, actor_id, 'api'
  );
  SELECT count(*) INTO address_count FROM public.client_contact_methods AS m WHERE m.client_id = contact_id;
  IF address_count <> 0 THEN RAISE EXCEPTION 'CONTACT_UPSERT_CLEAR_FAILED'; END IF;

  BEGIN
    PERFORM public.upsert_contact(jsonb_build_object('email','smoke-upsert@example.invalid'), contact_id, tenant_a, actor_id, 'api');
    RAISE EXCEPTION 'CONTACT_UPSERT_RETIRED_EMAIL_KEY_ALLOWED';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    IF SQLERRM NOT LIKE 'CONTACT_ADDRESS_FIELDS_RETIRED%' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM public.upsert_contact(jsonb_build_object('tenant_id',tenant_b), contact_id, tenant_a, actor_id, 'api');
    RAISE EXCEPTION 'CONTACT_UPSERT_UNKNOWN_FIELD_ALLOWED';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;

  BEGIN
    PERFORM public.upsert_contact(jsonb_build_object('city','Elsewhere'), contact_id, tenant_b, actor_id, 'api');
    RAISE EXCEPTION 'CONTACT_UPSERT_CROSS_TENANT_ALLOWED';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;

  RAISE NOTICE 'CONTACT_UPSERT_SMOKE_OK contact_id=%', contact_id;
END;
$smoke$;

ROLLBACK;
