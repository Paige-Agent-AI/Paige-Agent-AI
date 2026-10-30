-- UNVERSIONED I2 component. Original mint/accept only; no deployment/native slot/activation.
-- Preserve the entire incumbent including E09 consumer/recipient/contact protections.
DO $patch$
DECLARE sig text; expected text; original text; replacement text; old_body text; new_body text;
  definition text; before_metadata jsonb; after_metadata jsonb; target oid;
  inverse_body text;
  declaration_before constant text:=E'\nDECLARE\n';
  declaration_after constant text:=E'\nDECLARE\n  _exp08_never_owned boolean;\n';
  tail_before constant text:=$before$
  RETURN _tok.tenant_id;
END$before$;
  tail_after constant text:=$after$
  -- EXP08_FIRST_OWNER_FINAL_EXPIRY_V1: all original writes are transactional; a late refusal
  -- rolls back seat, pointer, profile, token and audit together, including waits after admission.
  IF _tok.kind='subaccount_owner' AND _tok.expires_at<=pg_catalog.clock_timestamp() THEN
    RAISE EXCEPTION 'invite has expired' USING ERRCODE='42501',HINT='OWNER_INVITE_EXPIRED';
  END IF;
  IF _tok.kind='subaccount_owner' THEN
    IF _minter_ok AND NOT (public.is_platform_owner(_tok.created_by)
       OR public.agency_can_manage_child(_tok.tenant_id, _tok.created_by)) THEN
      RAISE EXCEPTION 'This invitation can''t be used because its sender''s access has changed. Ask for a new invitation.'
        USING ERRCODE='42501',HINT='OWNER_INVITE_AUTHORITY_CHANGED';
    END IF;
    -- Reuse the pre-effect history fact: our own legitimate first-owner writes now make the
    -- current predicate false. Current minter authority must not revive an agency exception.
    IF public._solo_shell_tenant(_tok.tenant_id) AND public.is_platform_owner(_tok.created_by)
       AND NOT public.agency_can_manage_child(_tok.tenant_id, _tok.created_by)
       AND NOT _exp08_never_owned THEN
      RAISE EXCEPTION 'This invitation can''t be used. Owners of % are added by its account holder. Ask them for a new invitation.',
        (SELECT COALESCE(NULLIF(btrim(name),''),'this business') FROM public.tenants WHERE id=_tok.tenant_id)
        USING ERRCODE='42501',HINT='OWNER_HISTORY_REQUIRES_RECOVERY';
    END IF;
  END IF;
  RETURN _tok.tenant_id;
END$after$;
BEGIN
  FOR sig,expected,original,replacement IN SELECT * FROM (VALUES
    ('public.create_tenant_invite_token(uuid,text,public.tenant_role,integer,integer,uuid,text)',
     'a42d7b2852daf7dcd3e108f0eb588679',
     $before$  IF _kind = 'subaccount_owner'
     AND NOT (public.is_platform_owner()$before$,
     $after$  -- EXP08_FIRST_OWNER_MINT_V1: existing platform-only ownership recovery boundary.
  IF _kind = 'subaccount_owner' THEN
    PERFORM 1 FROM public.tenants WHERE id=_tenant_id FOR UPDATE;
    IF public._solo_shell_tenant(_tenant_id) AND public.is_platform_owner()
       AND NOT public.agency_can_manage_child(_tenant_id, auth.uid()) THEN
      IF NOT public._tenant_never_owned(_tenant_id) THEN
        RAISE EXCEPTION '% has had an owner, so a new owner can only be added by its account holder or through owner recovery. Nothing changed.',
          (SELECT COALESCE(NULLIF(btrim(name),''),'This business') FROM public.tenants WHERE id=_tenant_id)
          USING ERRCODE='42501',HINT='OWNER_HISTORY_REQUIRES_RECOVERY';
      END IF;
    END IF;
  END IF;
  IF _kind = 'subaccount_owner'
     AND NOT (public.is_platform_owner()$after$),
    ('public.accept_tenant_invite(text)', '0194a076acce065d23de842cab9b6d29',
     $before$  ELSIF _tok.kind = 'subaccount_owner' THEN$before$,
     $after$  ELSIF _tok.kind = 'subaccount_owner' THEN
    -- EXP08_FIRST_OWNER_ACCEPT_V1: same token, original tenant serialization, no silent admin downgrade.
    PERFORM 1 FROM public.tenants WHERE id=_tok.tenant_id FOR UPDATE;
    _exp08_never_owned:=public._tenant_never_owned(_tok.tenant_id);
    IF _tok.expires_at<=pg_catalog.clock_timestamp() THEN
      RAISE EXCEPTION 'invite has expired' USING ERRCODE='42501',HINT='OWNER_INVITE_EXPIRED';
    END IF;
    IF public._solo_shell_tenant(_tok.tenant_id) THEN
      IF public.is_platform_owner(_tok.created_by)
         AND NOT public.agency_can_manage_child(_tok.tenant_id, _tok.created_by)
         AND NOT _exp08_never_owned THEN
        RAISE EXCEPTION 'This invitation can''t be used. Owners of % are added by its account holder. Ask them for a new invitation.',
          (SELECT COALESCE(NULLIF(btrim(name),''),'this business') FROM public.tenants WHERE id=_tok.tenant_id)
          USING ERRCODE='42501',HINT='OWNER_HISTORY_REQUIRES_RECOVERY';
      END IF;
    END IF;$after$)
  ) v(signature,body_hash,old_span,new_span) LOOP
    target:=sig::regprocedure;
    SELECT prosrc,to_jsonb(p)-'prosrc' INTO old_body,before_metadata FROM pg_proc p WHERE oid=target;
    IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE oid=target AND prosecdef
      AND proowner='postgres'::regrole AND proconfig=ARRAY['search_path=public']
      AND proacl::text=CASE WHEN sig='public.accept_tenant_invite(text)'
        THEN '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}'
        ELSE '{=X/postgres,postgres=X/postgres,authenticated=X/postgres}' END) THEN
      RAISE EXCEPTION 'EXP08 first owner invitation requires original writer metadata: %',sig;
    END IF;
    -- Replay is admitted only when removing this exact complete span recovers the exact incumbent.
    IF md5(old_body)<>expected THEN
      inverse_body:=old_body;
      IF sig='public.accept_tenant_invite(text)' THEN
        IF strpos(inverse_body,tail_after)=0 THEN RAISE EXCEPTION 'EXP08 first owner invitation requires exact original source: %',sig; END IF;
        inverse_body:=replace(inverse_body,tail_after,tail_before);
        IF strpos(inverse_body,declaration_after)=0 THEN RAISE EXCEPTION 'EXP08 first owner invitation requires exact original source: %',sig; END IF;
        inverse_body:=replace(inverse_body,declaration_after,declaration_before);
      END IF;
      IF strpos(old_body,replacement)=0 OR md5(replace(inverse_body,replacement,original))<>expected THEN
        RAISE EXCEPTION 'EXP08 first owner invitation requires exact original source: %',sig;
      END IF;
      CONTINUE;
    END IF;
    new_body:=replace(old_body,original,replacement);
    IF sig='public.accept_tenant_invite(text)' THEN
      IF strpos(new_body,tail_before)=0 THEN RAISE EXCEPTION 'EXP08 first owner invitation tail is not exact: %',sig; END IF;
      new_body:=replace(new_body,tail_before,tail_after);
      IF strpos(new_body,declaration_before)=0 THEN RAISE EXCEPTION 'EXP08 first owner invitation declaration is not exact: %',sig; END IF;
      new_body:=replace(new_body,declaration_before,declaration_after);
    END IF;
    inverse_body:=new_body;
    IF sig='public.accept_tenant_invite(text)' THEN
      inverse_body:=replace(replace(inverse_body,tail_after,tail_before),declaration_after,declaration_before);
    END IF;
    IF new_body=old_body OR replace(inverse_body,replacement,original)<>old_body THEN
      RAISE EXCEPTION 'EXP08 first owner invitation replacement is not exact: %',sig;
    END IF;
    definition:=pg_get_functiondef(target);
    EXECUTE replace(definition,old_body,new_body);
    SELECT to_jsonb(p)-'prosrc' INTO after_metadata FROM pg_proc p WHERE oid=target;
    IF before_metadata IS DISTINCT FROM after_metadata THEN
      RAISE EXCEPTION 'EXP08 first owner invitation writer metadata changed: %',sig;
    END IF;
  END LOOP;
END
$patch$;
