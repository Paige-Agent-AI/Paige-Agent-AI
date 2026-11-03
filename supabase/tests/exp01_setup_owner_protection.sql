-- Composed into the ORIGINAL rollback-only full-schema receipt proof, before
-- its original Admin revocation. Reuses its real native tenant/actor fixture.
-- No replacement permission functions, lifecycle writers or production rows.
SAVEPOINT exp01_owner_protection;
SELECT pg_temp.e01_as('e0100100-0000-4000-8000-000000000001');
CREATE FUNCTION pg_temp.e01_owner_request(operation text) RETURNS jsonb
 LANGUAGE sql SECURITY INVOKER AS $$
 SELECT coalesce(jsonb_agg(CASE WHEN item->>'id'='e0100600-0000-4000-8000-000000000002' THEN
  item||CASE operation
   WHEN 'delete' THEN '{"deleteRequested":true,"sourceDecision":"override"}'::jsonb
   WHEN 'kind' THEN '{"ownerKind":"trust","sourceDecision":"override"}'::jsonb
   WHEN 'representative' THEN '{"representativeUserId":"e0100100-0000-4000-8000-000000000003","sourceDecision":"override"}'::jsonb
   WHEN 'label' THEN '{"displayName":"Permitted owner label"}'::jsonb
   ELSE '{}'::jsonb END ELSE item END ORDER BY item->>'id'),'[]'::jsonb)
 FROM jsonb_array_elements(public.get_solo_setup_context()->'businessOwners') item
 WHERE operation<>'omit' OR item->>'id'<>'e0100600-0000-4000-8000-000000000002'
$$;
CREATE FUNCTION pg_temp.e01_owner_save(operation text) RETURNS jsonb
 LANGUAGE plpgsql SECURITY INVOKER AS $$DECLARE c jsonb;BEGIN
 c:=public.get_solo_setup_context();
 RETURN public.save_solo_setup_context(c->'brief',pg_temp.e01_owner_request(operation),c#>>'{brief,updatedAt}',NULL);
END$$;
CREATE FUNCTION pg_temp.e01_owner_snapshot() RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object(
 'tenant',(SELECT to_jsonb(t) FROM public.tenants t WHERE id='e0100200-0000-4000-8000-000000000001'),
 'owners',(SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM public.tenant_business_owners o WHERE tenant_id='e0100200-0000-4000-8000-000000000001'),
 'legal',(SELECT to_jsonb(l) FROM public.tenant_legal_profile l WHERE tenant_id='e0100200-0000-4000-8000-000000000001'),
 'private',(SELECT to_jsonb(p) FROM public.tenant_setup_private_context p WHERE tenant_id='e0100200-0000-4000-8000-000000000001'),
 'meta',(SELECT to_jsonb(m) FROM public.tenant_setup_business_context_meta m WHERE tenant_id='e0100200-0000-4000-8000-000000000001'),
 'audit',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.paige_audit_log a WHERE tenant_id='e0100200-0000-4000-8000-000000000001'))
$$;
CREATE FUNCTION pg_temp.e01_owner_error(operation text) RETURNS text
 LANGUAGE plpgsql SECURITY INVOKER AS $$DECLARE hint text;BEGIN
 PERFORM pg_temp.e01_owner_save(operation); RETURN 'NO_ERROR';
 EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS hint=PG_EXCEPTION_HINT;
 RETURN SQLSTATE||'/'||coalesce(hint,'');
END$$;
-- Real full-schema causal control: the old writer allows the exact held
-- legal-person kind edit that the old seated-to-individual trigger misses.
SAVEPOINT exp01_owner_baseline;
-- EXP01_OWNER_BASELINE_WRITER
UPDATE public.tenant_business_owners SET owner_seat_vacant_since=clock_timestamp()
 WHERE id='e0100600-0000-4000-8000-000000000002';
SET LOCAL ROLE authenticated;
SELECT lives_ok($$SELECT pg_temp.e01_owner_save('kind')$$,'original writer demonstrably permits held legal-person kind change');
RESET ROLE;
ROLLBACK TO SAVEPOINT exp01_owner_baseline;
RELEASE SAVEPOINT exp01_owner_baseline;

-- EXP01_OWNER_PROTECTION_CASES

SAVEPOINT exp01_guard_seated;
UPDATE public.tenant_members SET business_owner_id='e0100600-0000-4000-8000-000000000002' WHERE tenant_id='e0100200-0000-4000-8000-000000000001' AND user_id='e0100100-0000-4000-8000-000000000001';
INSERT INTO e01_state VALUES('guard_snapshot',pg_temp.e01_owner_snapshot());
SET LOCAL ROLE authenticated;
SELECT is(pg_temp.e01_owner_error('omit'),'42501/OWNER_RECORD_SEATED','seated refuses omit, including explicit source override');
SELECT is(pg_temp.e01_owner_error('delete'),'42501/OWNER_RECORD_SEATED','seated refuses delete, including explicit source override');
SELECT is(pg_temp.e01_owner_error('kind'),'42501/OWNER_RECORD_SEATED','seated refuses kind, including explicit source override');
SELECT is(pg_temp.e01_owner_error('representative'),'42501/OWNER_RECORD_SEATED','seated refuses representative, including explicit source override');
RESET ROLE;
SELECT is(pg_temp.e01_owner_snapshot(),(SELECT value FROM e01_state WHERE name='guard_snapshot'),'seated refusal rolls back all original public/private/legal/context/audit effects');
SET LOCAL ROLE authenticated;
SELECT lives_ok($$SELECT pg_temp.e01_owner_save('label')$$,'seated harmless authorized label edit remains usable');
SELECT is((SELECT item->>'displayName' FROM jsonb_array_elements(public.get_solo_setup_context()->'businessOwners') item WHERE item->>'id'='e0100600-0000-4000-8000-000000000002'),'Permitted owner label','seated original authoritative readback confirms harmless edit');
RESET ROLE;
ROLLBACK TO SAVEPOINT exp01_guard_seated;
RELEASE SAVEPOINT exp01_guard_seated;

SAVEPOINT exp01_guard_held;
UPDATE public.tenant_business_owners SET owner_seat_vacant_since=clock_timestamp() WHERE id='e0100600-0000-4000-8000-000000000002';
INSERT INTO e01_state VALUES('guard_snapshot',pg_temp.e01_owner_snapshot());
SET LOCAL ROLE authenticated;
SELECT is(pg_temp.e01_owner_error('omit'),'42501/OWNER_RECORD_SEATED','held refuses omit, including explicit source override');
SELECT is(pg_temp.e01_owner_error('delete'),'42501/OWNER_RECORD_SEATED','held refuses delete, including explicit source override');
SELECT is(pg_temp.e01_owner_error('kind'),'42501/OWNER_RECORD_SEATED','held refuses kind, including explicit source override');
SELECT is(pg_temp.e01_owner_error('representative'),'42501/OWNER_RECORD_SEATED','held refuses representative, including explicit source override');
RESET ROLE;
SELECT is(pg_temp.e01_owner_snapshot(),(SELECT value FROM e01_state WHERE name='guard_snapshot'),'held refusal rolls back all original public/private/legal/context/audit effects');
SET LOCAL ROLE authenticated;
SELECT lives_ok($$SELECT pg_temp.e01_owner_save('label')$$,'held harmless authorized label edit remains usable');
SELECT is((SELECT item->>'displayName' FROM jsonb_array_elements(public.get_solo_setup_context()->'businessOwners') item WHERE item->>'id'='e0100600-0000-4000-8000-000000000002'),'Permitted owner label','held original authoritative readback confirms harmless edit');
-- The completed fact-approval consumer must pass the protected owner unchanged,
-- not drop its identity fields or treat publication as permission to remove it.
INSERT INTO e01_state VALUES('guard_owners',public.get_solo_business_context()->'businessOwners');
UPDATE e01_state SET value=pg_temp.e01_stage('e0100400-0000-4000-8000-000000000101') WHERE name='proposal';
SELECT is(pg_temp.e01_save('e0100400-0000-4000-8000-000000000101','e0100500-0000-4000-8000-000000000101','["address"]')->>'current',
 'true','explicit selected-fact approval still saves through original Setup with a held legal owner');
SELECT is(public.get_solo_business_context()->'businessOwners',(SELECT value FROM e01_state WHERE name='guard_owners'),
 'reviewed-fact receipt preserves exact held legal-owner fields and provenance');
SELECT is(public.inspect_solo_reviewed_business_facts('e0100200-0000-4000-8000-000000000001',auth.uid(),
 'e0100500-0000-4000-8000-000000000101')->>'current','true','held-owner save is recovered through the original same-request receipt');
RESET ROLE;
ROLLBACK TO SAVEPOINT exp01_guard_held;
RELEASE SAVEPOINT exp01_guard_held;

SAVEPOINT exp01_guard_invited;
INSERT INTO public.tenant_invite_tokens(tenant_id,token,kind,default_role,created_by,business_owner_id,expires_at,max_uses) VALUES('e0100200-0000-4000-8000-000000000001','e01-guard-live','team','owner','e0100100-0000-4000-8000-000000000001','e0100600-0000-4000-8000-000000000002',clock_timestamp()+interval '1 day',1);
INSERT INTO e01_state VALUES('guard_snapshot',pg_temp.e01_owner_snapshot());
SET LOCAL ROLE authenticated;
SELECT is(pg_temp.e01_owner_error('omit'),'42501/OWNER_RECORD_SEATED','invited refuses omit, including explicit source override');
SELECT is(pg_temp.e01_owner_error('delete'),'42501/OWNER_RECORD_SEATED','invited refuses delete, including explicit source override');
SELECT is(pg_temp.e01_owner_error('kind'),'42501/OWNER_RECORD_SEATED','invited refuses kind, including explicit source override');
SELECT is(pg_temp.e01_owner_error('representative'),'42501/OWNER_RECORD_SEATED','invited refuses representative, including explicit source override');
RESET ROLE;
SELECT is(pg_temp.e01_owner_snapshot(),(SELECT value FROM e01_state WHERE name='guard_snapshot'),'invited refusal rolls back all original public/private/legal/context/audit effects');
SET LOCAL ROLE authenticated;
SELECT lives_ok($$SELECT pg_temp.e01_owner_save('label')$$,'invited harmless authorized label edit remains usable');
SELECT is((SELECT item->>'displayName' FROM jsonb_array_elements(public.get_solo_setup_context()->'businessOwners') item WHERE item->>'id'='e0100600-0000-4000-8000-000000000002'),'Permitted owner label','invited original authoritative readback confirms harmless edit');
RESET ROLE;
ROLLBACK TO SAVEPOINT exp01_guard_invited;
RELEASE SAVEPOINT exp01_guard_invited;

SAVEPOINT exp01_guard_expired;
INSERT INTO public.tenant_invite_tokens(tenant_id,token,kind,default_role,created_by,business_owner_id,expires_at,revoked_at,uses,max_uses)
VALUES('e0100200-0000-4000-8000-000000000001','e01-guard-expired','team','owner','e0100100-0000-4000-8000-000000000001','e0100600-0000-4000-8000-000000000002',clock_timestamp()-interval '1 day',NULL,0,1);
SET LOCAL ROLE authenticated;
SELECT lives_ok($$SELECT pg_temp.e01_owner_save('omit')$$,'expired invitation does not block permitted owner-record omission');
SELECT ok(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(public.get_solo_setup_context()->'businessOwners') item WHERE item->>'id'='e0100600-0000-4000-8000-000000000002'),'expired permitted omission is authoritatively read back');
RESET ROLE;
ROLLBACK TO SAVEPOINT exp01_guard_expired;
RELEASE SAVEPOINT exp01_guard_expired;

SAVEPOINT exp01_guard_revoked;
INSERT INTO public.tenant_invite_tokens(tenant_id,token,kind,default_role,created_by,business_owner_id,expires_at,revoked_at,uses,max_uses)
VALUES('e0100200-0000-4000-8000-000000000001','e01-guard-revoked','team','owner','e0100100-0000-4000-8000-000000000001','e0100600-0000-4000-8000-000000000002',clock_timestamp()+interval '1 day',clock_timestamp(),0,1);
SET LOCAL ROLE authenticated;
SELECT lives_ok($$SELECT pg_temp.e01_owner_save('omit')$$,'revoked invitation does not block permitted owner-record omission');
SELECT ok(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(public.get_solo_setup_context()->'businessOwners') item WHERE item->>'id'='e0100600-0000-4000-8000-000000000002'),'revoked permitted omission is authoritatively read back');
RESET ROLE;
ROLLBACK TO SAVEPOINT exp01_guard_revoked;
RELEASE SAVEPOINT exp01_guard_revoked;

SAVEPOINT exp01_guard_used;
INSERT INTO public.tenant_invite_tokens(tenant_id,token,kind,default_role,created_by,business_owner_id,expires_at,revoked_at,uses,max_uses)
VALUES('e0100200-0000-4000-8000-000000000001','e01-guard-used','team','owner','e0100100-0000-4000-8000-000000000001','e0100600-0000-4000-8000-000000000002',clock_timestamp()+interval '1 day',NULL,1,1);
SET LOCAL ROLE authenticated;
SELECT lives_ok($$SELECT pg_temp.e01_owner_save('omit')$$,'used invitation does not block permitted owner-record omission');
SELECT ok(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(public.get_solo_setup_context()->'businessOwners') item WHERE item->>'id'='e0100600-0000-4000-8000-000000000002'),'used permitted omission is authoritatively read back');
RESET ROLE;
ROLLBACK TO SAVEPOINT exp01_guard_used;
RELEASE SAVEPOINT exp01_guard_used;


-- Authority remains ORIGINAL: Admin can save operational context, never a
-- changed ownership list; a member, foreign workspace and revoked Admin cannot.
SAVEPOINT exp01_owner_authority;
SET LOCAL ROLE authenticated;
SELECT pg_temp.e01_as('e0100100-0000-4000-8000-000000000002');
SELECT lives_ok($$SELECT pg_temp.e01_owner_save('unchanged')$$,'actual scoped Admin harmless save preserves original ownership');
SELECT is(pg_temp.e01_error($$SELECT pg_temp.e01_owner_save('kind')$$),'42501','Admin cannot use the new guard as legal-identity authority');
SELECT pg_temp.e01_as('e0100100-0000-4000-8000-000000000003');
SELECT is(pg_temp.e01_error($$SELECT pg_temp.e01_owner_save('unchanged')$$),'42501','ordinary unassigned member still has no Setup save authority');
SELECT pg_temp.e01_as('e0100100-0000-4000-8000-000000000004');
SELECT is(pg_temp.e01_error($$SELECT public.save_solo_setup_context(public.get_solo_setup_context()->'brief',
 '[{"id":"e0100600-0000-4000-8000-000000000002","ownerKind":"trust","legalName":"Fixture Vacant Owner"}]',
 public.get_solo_setup_context()#>>'{brief,updatedAt}',NULL)$$),'42501','foreign actor cannot change original workspace owner records');
RESET ROLE;
ROLLBACK TO SAVEPOINT exp01_owner_authority;
RELEASE SAVEPOINT exp01_owner_authority;
ROLLBACK TO SAVEPOINT exp01_owner_protection;
RELEASE SAVEPOINT exp01_owner_protection;
