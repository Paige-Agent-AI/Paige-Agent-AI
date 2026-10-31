-- INERT original EXP08 I2 §5.5 candidate. No managed version/publication/apply.
-- Extends two ORIGINAL readers, not their authority, writers or grants.
BEGIN;
SET LOCAL lock_timeout='2s';
DO $owner_read$
DECLARE r record; helper record; target regprocedure; p pg_proc; original text; changed text;
 definition text; metadata jsonb; projection text; old_spans text[]; new_spans text[]; i integer;
BEGIN
 FOR helper IN SELECT * FROM (VALUES
  ('public._solo_shell_tenant(uuid)','9ade6efeff0689b78ff57b116a28c9d4','boolean'),
  ('public._tenant_account_holder_state(uuid)','8f9d27463a4c825994f165a5777aca1f','text')) h(signature,body_hash,return_name) LOOP
  SELECT * INTO p FROM pg_proc WHERE oid=to_regprocedure(helper.signature);
  IF NOT FOUND OR md5(p.prosrc)<>helper.body_hash OR NOT p.prosecdef OR p.provolatile<>'s'
   OR p.proowner<>'postgres'::regrole OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public']::text[]
   OR p.prolang<>(SELECT oid FROM pg_language WHERE lanname='sql') OR p.prokind<>'f'
   OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u' OR p.proretset OR p.prorettype<>to_regtype(helper.return_name)
   OR pg_get_function_arguments(p.oid)<>'_tenant uuid'
   OR EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    WHERE a.grantee<>'postgres'::regrole OR a.privilege_type<>'EXECUTE' OR a.is_grantable) THEN
   RAISE EXCEPTION 'EXP08 owner read original helper drift: %',helper.signature;
  END IF;
 END LOOP;
 FOR r IN SELECT * FROM (VALUES
  ('public.get_solo_team_workspace(text,text,integer,integer)','ded4ae3cb9d57f2c1ed0cef52493590b','membership_id',
   '_search text DEFAULT NULL::text, _permission text DEFAULT ''all''::text, _limit integer DEFAULT 25, _offset integer DEFAULT 0'),
  ('public.get_paige_team_context()','623d712d745867ed8f7d29374e3a6078','user_id',''))
  readers(signature,body_hash,member_key,argument_text) LOOP
  target:=to_regprocedure(r.signature);
  SELECT * INTO p FROM pg_proc WHERE oid=target;
  IF NOT FOUND OR NOT p.prosecdef OR p.proowner<>'postgres'::regrole OR p.provolatile<>'v'
   OR p.prolang<>(SELECT oid FROM pg_language WHERE lanname='plpgsql')
   OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']::text[]
   OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u' OR p.prorettype<>'jsonb'::regtype OR p.proretset OR p.prokind<>'f'
   OR pg_get_function_arguments(target) IS DISTINCT FROM r.argument_text
   OR EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    WHERE a.grantee NOT IN ('postgres'::regrole,'authenticated'::regrole) OR a.privilege_type<>'EXECUTE' OR a.is_grantable)
   OR NOT has_function_privilege('authenticated',target,'EXECUTE') THEN
   RAISE EXCEPTION 'EXP08 owner read original reader metadata drift: %',r.signature;
  END IF;
  projection:=$projection$  -- exp08_original_owner_read_v1: projection only, no authority or legal-profile save.
  -- Keep the caller's existing Auth and membership rows stable through the projection.
  -- Auth first also agrees with Auth deletion/cascade order. Revocation that wins first refuses;
  -- a read that wins first finishes before that revocation can commit. No rows are changed.
  PERFORM 1 FROM auth.users current_person WHERE current_person.id=_actor
   AND current_person.deleted_at IS NULL AND (current_person.banned_until IS NULL OR current_person.banned_until<=now())
   FOR SHARE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  PERFORM 1 FROM public.tenant_members current_member
   WHERE current_member.tenant_id=_tenant AND current_member.user_id=_actor AND current_member.status='active'
    AND current_member.role=_viewer_role AND (current_member.is_owner OR current_member.role='owner'::public.tenant_role)=_viewer_is_owner
   FOR SHARE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT _result || jsonb_build_object(
   'viewer_is_account_holder',public._solo_shell_tenant(_tenant) AND public.is_tenant_account_holder(_actor,_tenant),
   'account_holder_state',CASE WHEN public._solo_shell_tenant(_tenant) AND $MANAGE$
    THEN public._tenant_account_holder_state(_tenant) ELSE NULL END,
   'members',coalesce((SELECT jsonb_agg(m.value || jsonb_build_object(
    'is_account_holder',public._solo_shell_tenant(_tenant) AND EXISTS(SELECT 1 FROM public.tenants t
      WHERE t.id=_tenant AND t.owner_user_id=tm.user_id AND tm.is_owner
       AND public._tenant_account_holder_state(_tenant) IN ('working','paused')),
    'business_owner',CASE WHEN public._solo_shell_tenant(_tenant) AND $MANAGE$ THEN
     (SELECT jsonb_build_object('id',bo.id,'kind',bo.owner_kind,'display_name',coalesce(nullif(btrim(bo.display_name),''),bo.legal_name))
      FROM public.tenant_business_owners bo WHERE bo.tenant_id=_tenant AND bo.id=tm.business_owner_id AND tm.is_owner) ELSE NULL END,
    'billing_contact',CASE WHEN public._solo_shell_tenant(_tenant) AND
     (public.is_tenant_account_holder(_actor,_tenant) OR tm.user_id=_actor) THEN
      EXISTS(SELECT 1 FROM public.platform_billing_contacts bc WHERE bc.tenant_id=_tenant AND bc.user_id=tm.user_id AND bc.revoked_at IS NULL)
     ELSE NULL END) ORDER BY m.ord)
    FROM jsonb_array_elements(_result->'members') WITH ORDINALITY m(value,ord)
    JOIN public.tenant_members tm ON tm.tenant_id=_tenant AND tm.$MEMBER_KEY$::text=m.value->>'$MEMBER_KEY$'),'[]'::jsonb),
   'invitations',coalesce((SELECT jsonb_agg(inv.value || jsonb_build_object('business_owner',CASE
     WHEN public._solo_shell_tenant(_tenant) AND $MANAGE$ THEN
      (SELECT jsonb_build_object('id',bo.id,'kind',bo.owner_kind,'display_name',coalesce(nullif(btrim(bo.display_name),''),bo.legal_name))
       FROM public.tenant_business_owners bo WHERE bo.tenant_id=_tenant AND bo.id=ti.business_owner_id AND ti.default_role='owner'::public.tenant_role) ELSE NULL END) ORDER BY inv.ord)
    FROM jsonb_array_elements(_result->'invitations') WITH ORDINALITY inv(value,ord)
    JOIN public.tenant_invite_tokens ti ON ti.tenant_id=_tenant AND ti.id::text=inv.value->>'id'),'[]'::jsonb),
   'owner_seats_held',CASE WHEN public._solo_shell_tenant(_tenant) AND $MANAGE$ THEN
    coalesce((SELECT jsonb_agg(jsonb_build_object('id',bo.id,'kind',bo.owner_kind,
     'display_name',coalesce(nullif(btrim(bo.display_name),''),bo.legal_name),'vacant_since',bo.owner_seat_vacant_since)
     ORDER BY bo.id) FROM public.tenant_business_owners bo
     WHERE bo.tenant_id=_tenant AND bo.owner_kind<>'individual' AND bo.owner_seat_vacant_since IS NOT NULL
      AND NOT EXISTS(SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id=_tenant AND tm.business_owner_id=bo.id AND tm.is_owner)), '[]'::jsonb)
    ELSE '[]'::jsonb END,
   'business_owner_options',CASE WHEN public._solo_shell_tenant(_tenant) AND public.is_tenant_account_holder(_actor,_tenant) THEN
    coalesce((SELECT jsonb_agg(jsonb_build_object('id',bo.id,'kind',bo.owner_kind,
     'display_name',coalesce(nullif(btrim(bo.display_name),''),bo.legal_name),
     'representative',(SELECT jsonb_build_object('user_id',tm.user_id,'display_name',coalesce(nullif(btrim(profile.full_name),''),person.email))
      FROM public.tenant_members tm LEFT JOIN public.profiles profile ON profile.user_id=tm.user_id LEFT JOIN auth.users person ON person.id=tm.user_id
      WHERE tm.tenant_id=_tenant AND tm.business_owner_id=bo.id AND tm.is_owner),
     'pending_invitation',(SELECT jsonb_build_object('id',ti.id,'email',ti.email,'expires_at',ti.expires_at)
      FROM public.tenant_invite_tokens ti WHERE ti.tenant_id=_tenant AND ti.business_owner_id=bo.id
       AND ti.kind='team' AND ti.default_role='owner'::public.tenant_role AND ti.uses=0 AND ti.revoked_at IS NULL AND ti.expires_at>now()
       AND public.is_tenant_account_holder(ti.created_by,_tenant) ORDER BY ti.created_at DESC,ti.id LIMIT 1),
     'seat_state',CASE
      WHEN EXISTS(SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id=_tenant AND tm.business_owner_id=bo.id AND tm.is_owner) THEN 'represented'
      WHEN EXISTS(SELECT 1 FROM public.tenant_invite_tokens ti WHERE ti.tenant_id=_tenant AND ti.business_owner_id=bo.id
       AND ti.kind='team' AND ti.default_role='owner'::public.tenant_role AND ti.uses=0 AND ti.revoked_at IS NULL AND ti.expires_at>now()
       AND public.is_tenant_account_holder(ti.created_by,_tenant)) THEN 'invited'
      WHEN bo.owner_seat_vacant_since IS NOT NULL THEN 'held' ELSE 'none' END)
      ORDER BY bo.id) FROM public.tenant_business_owners bo WHERE bo.tenant_id=_tenant AND bo.owner_kind<>'individual'),'[]'::jsonb)
    ELSE '[]'::jsonb END
  ) INTO _result WHERE _tenant IS NOT DISTINCT FROM public.current_user_tenant_id();
  RETURN _result;$projection$;
  -- The legacy displayed Owner permission also accepts a role label. New private legal facts
  -- require the original actual owner predicate or the existing active Admin seat instead.
  projection:=replace(replace(projection,'$MANAGE$',
   '(public.is_tenant_owner(_actor,_tenant) OR EXISTS(SELECT 1 FROM public.tenant_members current_admin WHERE current_admin.tenant_id=_tenant AND current_admin.user_id=_actor AND current_admin.status=''active'' AND current_admin.role=''admin''::public.tenant_role))'),
   '$MEMBER_KEY$',r.member_key);
  -- The screen's object identifies membership_id; its real table column is id.
  IF r.member_key='membership_id' THEN projection:=replace(projection,'tm.membership_id::text','tm.id::text'); END IF;
  IF r.member_key='membership_id' THEN
   old_spans:=ARRAY['  RETURN _result;'];new_spans:=ARRAY[projection];
  ELSE
   old_spans:=ARRAY[E'DECLARE\n', '  RETURN jsonb_build_object(', E'  );\nEND;'];
   new_spans:=ARRAY[E'DECLARE\n  _result jsonb;\n','  _result := jsonb_build_object(',E'  );\n'||projection||E'\nEND;'];
  END IF;
  original:=p.prosrc;
  IF position('exp08_original_owner_read_v1' IN original)>0 THEN
   changed:=original;
   FOR i IN REVERSE cardinality(old_spans)..1 LOOP
    IF (length(changed)-length(replace(changed,new_spans[i],'')))/length(new_spans[i])<>1 THEN RAISE EXCEPTION 'EXP08 owner read partial source: %',r.signature; END IF;
    changed:=replace(changed,new_spans[i],old_spans[i]);
   END LOOP;
   IF md5(changed)<>r.body_hash THEN RAISE EXCEPTION 'EXP08 owner read replay source drift: %',r.signature; END IF;
  ELSE
   IF md5(original)<>r.body_hash THEN RAISE EXCEPTION 'EXP08 owner read original source drift: %',r.signature; END IF;
   changed:=pg_get_functiondef(target);
   FOR i IN 1..cardinality(old_spans) LOOP
    IF (length(original)-length(replace(original,old_spans[i],'')))/length(old_spans[i])<>1 THEN RAISE EXCEPTION 'EXP08 owner read source span drift: %',r.signature; END IF;
    changed:=replace(changed,old_spans[i],new_spans[i]);
   END LOOP;
   SELECT (to_jsonb(f)-'prosrc'-'proargdefaults')||jsonb_build_object('proargdefaults',pg_get_expr(f.proargdefaults,0)) INTO metadata FROM pg_proc f WHERE oid=target;
   EXECUTE changed;
   IF (SELECT (to_jsonb(f)-'prosrc'-'proargdefaults')||jsonb_build_object('proargdefaults',pg_get_expr(f.proargdefaults,0)) FROM pg_proc f WHERE oid=target) IS DISTINCT FROM metadata THEN
    RAISE EXCEPTION 'EXP08 owner read metadata conservation failed: %',r.signature;
   END IF;
   SELECT prosrc INTO changed FROM pg_proc WHERE oid=target;
   FOR i IN REVERSE cardinality(old_spans)..1 LOOP changed:=replace(changed,new_spans[i],old_spans[i]); END LOOP;
   IF md5(changed)<>r.body_hash THEN RAISE EXCEPTION 'EXP08 owner read inverse failed: %',r.signature; END IF;
  END IF;
 END LOOP;
END $owner_read$;
COMMIT;
