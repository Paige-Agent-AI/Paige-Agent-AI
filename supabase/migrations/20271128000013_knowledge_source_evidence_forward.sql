-- PRIVATE original source-evidence forward; reviewed original bodies, ordered after released 27030005.
-- No public/service execution or domain approval. Invoke in the original writer transaction.
BEGIN;
DO $source_dependencies$
DECLARE expected record; f record; target oid;
BEGIN
 FOR expected IN SELECT * FROM (VALUES
  ('public.knowledge_utf16_length(text)','ac0ec20d31948a93814074a35bc59e81','sql','i','s','integer',false,0,NULL::text,ARRAY['authenticated','service_role']::text[]),
  ('public.knowledge_actor_authorized(uuid,uuid)','a05876e786e8a6e7e3e15783cde684aa','sql','s','u','boolean',true,0,NULL::text,ARRAY['service_role']::text[]),
  ('public.lock_knowledge_extraction_authority(uuid,uuid)','788d27bc980fee58e6272c3e53ca6096','plpgsql','v','u','boolean',true,0,NULL::text,ARRAY['service_role']::text[]),
  ('public.read_tenant_knowledge(uuid,uuid,integer,integer)','9ee43da246514e9fb88b96a23c584d37','plpgsql','v','u','jsonb',true,3,'NULL::uuid, 50, 0',ARRAY['authenticated']::text[])
 ) v(signature,body_hash,language,volatility,parallel,return_type,definer,defaults_count,defaults_text,grantees) LOOP
  target:=to_regprocedure(expected.signature);
  IF target IS NULL THEN RAISE EXCEPTION 'KNOWLEDGE_SOURCE_INSTALL_DRIFT'; END IF;
  SELECT * INTO STRICT f FROM pg_proc WHERE oid=target;
  IF md5(f.prosrc)<>expected.body_hash OR f.proowner<>current_user::regrole
   OR f.prolang IS DISTINCT FROM (SELECT oid FROM pg_language WHERE lanname=expected.language)
   OR f.prokind<>'f' OR f.prorettype<>expected.return_type::regtype OR f.proretset
   OR f.provolatile::text<>expected.volatility OR f.proparallel::text<>expected.parallel
   OR f.prosecdef IS DISTINCT FROM expected.definer OR f.proisstrict OR f.proleakproof
   OR f.pronargdefaults<>expected.defaults_count
   OR pg_get_expr(f.proargdefaults,0) IS DISTINCT FROM expected.defaults_text
   OR f.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
   OR EXISTS(SELECT 1 FROM unnest(expected.grantees) r WHERE NOT has_function_privilege(r,f.oid,'EXECUTE'))
   OR EXISTS(SELECT 1 FROM aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a
    WHERE a.privilege_type<>'EXECUTE' OR a.grantor<>f.proowner
     OR (a.grantee<>f.proowner AND NOT EXISTS(SELECT 1 FROM unnest(expected.grantees) r WHERE a.grantee=r::regrole::oid))
     OR (a.grantee<>f.proowner AND a.is_grantable)) THEN
   RAISE EXCEPTION 'KNOWLEDGE_SOURCE_INSTALL_DRIFT';
  END IF;
 END LOOP;
END $source_dependencies$;
DO $source_existing$
DECLARE expected record; f record; target oid;
BEGIN
 FOR expected IN SELECT * FROM (VALUES
  ('public.knowledge_utf16_excerpt_matches(text,integer,integer,text)','615d47584f14264053a80397dcce74ee','plpgsql','i','s','boolean',false,0,NULL::text,ARRAY[]::text[]),
  ('public.lock_knowledge_source_evidence(uuid,uuid,jsonb,jsonb)','c875eff4e94775dfeb6e140957d47507','plpgsql','v','u','jsonb',false,0,NULL::text,ARRAY[]::text[])
 ) v(signature,body_hash,language,volatility,parallel,return_type,definer,defaults_count,defaults_text,grantees) LOOP
  target:=to_regprocedure(expected.signature);
  IF target IS NULL THEN CONTINUE; END IF;
  SELECT * INTO STRICT f FROM pg_proc WHERE oid=target;
  IF md5(f.prosrc)<>expected.body_hash OR f.proowner<>current_user::regrole
   OR f.prolang IS DISTINCT FROM (SELECT oid FROM pg_language WHERE lanname=expected.language)
   OR f.prokind<>'f' OR f.prorettype<>expected.return_type::regtype OR f.proretset
   OR f.provolatile::text<>expected.volatility OR f.proparallel::text<>expected.parallel
   OR f.prosecdef IS DISTINCT FROM expected.definer OR f.proisstrict OR f.proleakproof
   OR f.pronargdefaults<>expected.defaults_count
   OR pg_get_expr(f.proargdefaults,0) IS DISTINCT FROM expected.defaults_text
   OR f.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
   OR EXISTS(SELECT 1 FROM unnest(expected.grantees) r WHERE NOT has_function_privilege(r,f.oid,'EXECUTE'))
   OR EXISTS(SELECT 1 FROM aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a
    WHERE a.privilege_type<>'EXECUTE' OR a.grantor<>f.proowner
     OR (a.grantee<>f.proowner AND NOT EXISTS(SELECT 1 FROM unnest(expected.grantees) r WHERE a.grantee=r::regrole::oid))
     OR (a.grantee<>f.proowner AND a.is_grantable)) THEN
   RAISE EXCEPTION 'KNOWLEDGE_SOURCE_INSTALL_DRIFT';
  END IF;
 END LOOP;
END $source_existing$;
CREATE OR REPLACE FUNCTION public.knowledge_utf16_excerpt_matches(
 p_content text,p_start integer,p_end integer,p_quote text
) RETURNS boolean LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE SET search_path='' AS $quote$
DECLARE
 units integer; chars integer; requested integer; low integer; high integer;
 midpoint integer; prefix_units integer; matched integer; boundaries integer[]:='{}';
BEGIN
 IF p_content IS NULL OR p_start IS NULL OR p_end IS NULL OR p_quote IS NULL
  OR p_start<0 OR p_end<=p_start THEN RETURN false; END IF;
 IF p_end-p_start>12000 OR octet_length(p_content)>2097152
  OR octet_length(p_quote)>48000 THEN RETURN false; END IF;
 units:=public.knowledge_utf16_length(p_content COLLATE pg_catalog."C");
 IF units NOT BETWEEN 1 AND 480000 OR p_end>units
  OR public.knowledge_utf16_length(p_quote COLLATE pg_catalog."C")<>p_end-p_start THEN RETURN false; END IF;
 chars:=char_length(p_content);
 -- PostgreSQL indexes Unicode code points; existing JS evidence indexes UTF16.
 -- Locate exact code-point boundaries via the ORIGINAL UTF16 length helper.
 -- No rounding can turn a split surrogate pair into a different citation.
 FOREACH requested IN ARRAY ARRAY[p_start,p_end] LOOP
  low:=0; high:=chars; matched:=NULL;
  WHILE low<=high LOOP
   midpoint:=low+(high-low)/2;
   prefix_units:=public.knowledge_utf16_length(left(p_content,midpoint) COLLATE pg_catalog."C");
   IF prefix_units=requested THEN matched:=midpoint; EXIT;
   ELSIF prefix_units<requested THEN low:=midpoint+1;
   ELSE high:=midpoint-1;
   END IF;
  END LOOP;
  IF matched IS NULL THEN RETURN false; END IF;
  boundaries:=array_append(boundaries,matched);
 END LOOP;
 RETURN convert_to(substring(p_content FROM boundaries[1]+1 FOR boundaries[2]-boundaries[1]),'UTF8')=convert_to(p_quote,'UTF8');
END $quote$;
REVOKE ALL ON FUNCTION public.knowledge_utf16_excerpt_matches(text,integer,integer,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.lock_knowledge_source_evidence(
 p_actor uuid,p_tenant uuid,p_reference jsonb,p_excerpts jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $binding$
DECLARE
 source_id uuid; source public.tenant_knowledge_docs; permitted jsonb;
 excerpt jsonb; start_at integer; end_at integer; total_units integer:=0;
 reference jsonb; excerpts jsonb:='[]'::jsonb;
BEGIN
 IF p_actor IS NULL OR p_tenant IS NULL OR p_actor IS DISTINCT FROM auth.uid() THEN
  RAISE EXCEPTION 'KNOWLEDGE_SOURCE_SCOPE_CHANGED' USING ERRCODE='42501';
 END IF;
 IF p_reference IS NULL OR jsonb_typeof(p_reference) IS DISTINCT FROM 'object'
  OR p_excerpts IS NULL OR jsonb_typeof(p_excerpts) IS DISTINCT FROM 'array' THEN
  RAISE EXCEPTION 'KNOWLEDGE_SOURCE_INVALID' USING ERRCODE='22023';
 END IF;
 IF pg_column_size(p_reference)>4096 OR pg_column_size(p_excerpts)>65536
  OR jsonb_array_length(p_excerpts)>20
  OR NOT(p_reference ?& ARRAY['contractVersion','tenantId','documentId','revision','contentSha256'])
  OR (SELECT count(*) FROM jsonb_object_keys(p_reference))<>5
  OR p_reference->'contractVersion' IS DISTINCT FROM '1'::jsonb
  OR p_reference->>'tenantId' IS DISTINCT FROM p_tenant::text
  OR jsonb_typeof(p_reference->'documentId') IS DISTINCT FROM 'string'
  OR jsonb_typeof(p_reference->'revision') IS DISTINCT FROM 'number'
  OR (p_reference->>'revision' COLLATE pg_catalog."C") !~ '^[1-9][0-9]{0,9}$'
  OR jsonb_typeof(p_reference->'contentSha256') IS DISTINCT FROM 'string'
  OR (p_reference->>'contentSha256' COLLATE pg_catalog."C") !~ '^[0-9a-f]{64}$' THEN
  RAISE EXCEPTION 'KNOWLEDGE_SOURCE_INVALID' USING ERRCODE='22023';
 END IF;
 BEGIN source_id:=(p_reference->>'documentId')::uuid;
 EXCEPTION WHEN invalid_text_representation THEN
  RAISE EXCEPTION 'KNOWLEDGE_SOURCE_INVALID' USING ERRCODE='22023'; END;
 IF source_id IS NULL THEN RAISE EXCEPTION 'KNOWLEDGE_SOURCE_INVALID' USING ERRCODE='22023'; END IF;
 -- Reuse the ORIGINAL identity/member/profile/tenant locks and visibility door.
 -- No service-role existence lookup, role taxonomy or replacement resolver.
 IF NOT public.lock_knowledge_extraction_authority(p_actor,p_tenant) THEN
  RAISE EXCEPTION 'KNOWLEDGE_SCOPE_CHANGED' USING ERRCODE='42501';
 END IF;
 permitted:=public.read_tenant_knowledge(p_tenant,source_id,1,0);
 IF permitted->>'tenant_id' IS DISTINCT FROM p_tenant::text
  OR jsonb_array_length(permitted->'documents') IS DISTINCT FROM 1 THEN
  RAISE EXCEPTION 'KNOWLEDGE_SOURCE_UNAVAILABLE' USING ERRCODE='42501';
 END IF;
 SELECT * INTO source FROM public.tenant_knowledge_docs d
  WHERE d.id=source_id AND d.tenant_id=p_tenant AND d.record_state='canonical' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'KNOWLEDGE_SOURCE_UNAVAILABLE' USING ERRCODE='42501'; END IF;
 reference:=jsonb_build_object('contractVersion',1,'tenantId',source.tenant_id,'documentId',source.id,
  'revision',source.revision,'contentSha256',encode(sha256(convert_to(source.content,'UTF8')),'hex'));
 IF source.revision::text IS DISTINCT FROM p_reference->>'revision'
  OR reference->>'contentSha256' IS DISTINCT FROM p_reference->>'contentSha256' THEN
  RAISE EXCEPTION 'KNOWLEDGE_SOURCE_CHANGED' USING ERRCODE='40001';
 END IF;
 FOR excerpt IN SELECT value FROM jsonb_array_elements(p_excerpts) LOOP
  IF jsonb_typeof(excerpt) IS DISTINCT FROM 'object' THEN
   RAISE EXCEPTION 'KNOWLEDGE_SOURCE_INVALID' USING ERRCODE='22023';
  END IF;
  IF NOT(excerpt ?& ARRAY['start','end','text']) OR (SELECT count(*) FROM jsonb_object_keys(excerpt))<>3
   OR jsonb_typeof(excerpt->'start') IS DISTINCT FROM 'number' OR jsonb_typeof(excerpt->'end') IS DISTINCT FROM 'number'
   OR (excerpt->>'start' COLLATE pg_catalog."C") !~ '^[0-9]{1,6}$'
   OR (excerpt->>'end' COLLATE pg_catalog."C") !~ '^[0-9]{1,6}$'
   OR jsonb_typeof(excerpt->'text') IS DISTINCT FROM 'string' THEN
   RAISE EXCEPTION 'KNOWLEDGE_SOURCE_INVALID' USING ERRCODE='22023';
  END IF;
  start_at:=(excerpt->>'start')::integer; end_at:=(excerpt->>'end')::integer;
  IF NOT public.knowledge_utf16_excerpt_matches(source.content,start_at,end_at,excerpt->>'text') THEN
   RAISE EXCEPTION 'KNOWLEDGE_SOURCE_QUOTE_CHANGED' USING ERRCODE='40001';
  END IF;
  total_units:=total_units+end_at-start_at;
  IF total_units>12000 THEN RAISE EXCEPTION 'KNOWLEDGE_SOURCE_INVALID' USING ERRCODE='22023'; END IF;
  excerpts:=excerpts||jsonb_build_array(jsonb_build_object('start',start_at,'end',end_at,'text',excerpt->>'text'));
 END LOOP;
 RETURN jsonb_build_object('status','available','reference',reference,'title',source.title,'excerpts',excerpts,
  'factConfirmation','not_asserted','originalFileEvidence','unavailable');
END $binding$;
REVOKE ALL ON FUNCTION public.lock_knowledge_source_evidence(uuid,uuid,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
DO $source_installed$
DECLARE expected record; f record; target oid;
BEGIN
 FOR expected IN SELECT * FROM (VALUES
  ('public.knowledge_utf16_excerpt_matches(text,integer,integer,text)','615d47584f14264053a80397dcce74ee','plpgsql','i','s','boolean',false,0,NULL::text,ARRAY[]::text[]),
  ('public.lock_knowledge_source_evidence(uuid,uuid,jsonb,jsonb)','c875eff4e94775dfeb6e140957d47507','plpgsql','v','u','jsonb',false,0,NULL::text,ARRAY[]::text[])
 ) v(signature,body_hash,language,volatility,parallel,return_type,definer,defaults_count,defaults_text,grantees) LOOP
  target:=to_regprocedure(expected.signature);
  IF target IS NULL THEN RAISE EXCEPTION 'KNOWLEDGE_SOURCE_INSTALL_DRIFT'; END IF;
  SELECT * INTO STRICT f FROM pg_proc WHERE oid=target;
  IF md5(f.prosrc)<>expected.body_hash OR f.proowner<>current_user::regrole
   OR f.prolang IS DISTINCT FROM (SELECT oid FROM pg_language WHERE lanname=expected.language)
   OR f.prokind<>'f' OR f.prorettype<>expected.return_type::regtype OR f.proretset
   OR f.provolatile::text<>expected.volatility OR f.proparallel::text<>expected.parallel
   OR f.prosecdef IS DISTINCT FROM expected.definer OR f.proisstrict OR f.proleakproof
   OR f.pronargdefaults<>expected.defaults_count
   OR pg_get_expr(f.proargdefaults,0) IS DISTINCT FROM expected.defaults_text
   OR f.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
   OR EXISTS(SELECT 1 FROM unnest(expected.grantees) r WHERE NOT has_function_privilege(r,f.oid,'EXECUTE'))
   OR EXISTS(SELECT 1 FROM aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a
    WHERE a.privilege_type<>'EXECUTE' OR a.grantor<>f.proowner
     OR (a.grantee<>f.proowner AND NOT EXISTS(SELECT 1 FROM unnest(expected.grantees) r WHERE a.grantee=r::regrole::oid))
     OR (a.grantee<>f.proowner AND a.is_grantable)) THEN
   RAISE EXCEPTION 'KNOWLEDGE_SOURCE_INSTALL_DRIFT';
  END IF;
 END LOOP;
END $source_installed$;
COMMIT;
