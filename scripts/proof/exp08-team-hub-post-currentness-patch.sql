-- INERT EXP08 original post currentness candidate. No migration version or applied history.
-- Only the original writer changes. All existing roles, duplicate handling and admission remain.
BEGIN;
SET LOCAL lock_timeout='2s';
DO $post_currentness$
DECLARE target regprocedure:=to_regprocedure('public.team_hub_post_message(uuid,uuid,text,uuid,uuid,uuid[],uuid[],text[],text)');
 p pg_proc; dependency record; helper pg_proc; current_source text; before_metadata jsonb; definition text;
 before_defaults text; before_default_expression text;
 old_span constant text:=$old$ -- A DM keeps reaching the other person. If their seat ended and they were re-invited, the seat$old$;
 new_span constant text:=$new$ -- exp08_post_current_actor_v1: resolve the original actor/context again after attachment waits.
 -- Order both original DM identities before seat locks, avoiding opposing-DM actor/recipient inversion.
 other:=CASE WHEN ch.kind='dm' THEN CASE split_part(ch.dm_key,':',1)
  WHEN actor::text THEN split_part(ch.dm_key,':',2)::uuid ELSE split_part(ch.dm_key,':',1)::uuid END ELSE NULL END;
 PERFORM u.id FROM auth.users u WHERE u.id=ANY(array_remove(ARRAY[actor,other],NULL)) ORDER BY u.id FOR UPDATE;
 IF NOT public._team_hub_hold_seats(p_expected_tenant,ARRAY[actor]) THEN
  refusal:=public._team_hub_refusal(p_expected_tenant);
  RETURN jsonb_build_object('ok',false,'code',coalesce(refusal,'not_member'));
 END IF;
 PERFORM 1 FROM public.profiles current_actor_profile WHERE current_actor_profile.user_id=actor FOR SHARE;
 refusal:=public._team_hub_refusal(p_expected_tenant);
 IF refusal IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'code',refusal); END IF;
 SELECT c.* INTO ch FROM public.team_hub_channels c
  WHERE c.id=p_channel_id AND c.tenant_id=p_expected_tenant AND c.archived_at IS NULL FOR SHARE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','not_found'); END IF;
 -- A changed DM identity cannot use the earlier pair's locks as authority.
 IF other IS DISTINCT FROM (CASE WHEN ch.kind='dm' THEN CASE split_part(ch.dm_key,':',1)
  WHEN actor::text THEN split_part(ch.dm_key,':',2)::uuid ELSE split_part(ch.dm_key,':',1)::uuid END ELSE NULL END)
  OR (ch.kind='dm' AND (other IS NULL OR other=actor OR ch.dm_key IS DISTINCT FROM
   least(actor::text,other::text)||':'||greatest(actor::text,other::text))) THEN
  RETURN jsonb_build_object('ok',false,'code','not_found'); END IF;
 IF ch.visibility='private' THEN
  PERFORM 1 FROM public.team_hub_channel_members current_actor_member
   WHERE current_actor_member.channel_id=ch.id AND current_actor_member.tenant_id=p_expected_tenant
    AND current_actor_member.user_id=actor FOR SHARE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','not_found'); END IF;
 END IF;
 SELECT c.* INTO ch FROM public._team_hub_visible(p_expected_tenant,actor,p_channel_id) c;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','not_found'); END IF;
 -- A DM keeps reaching the other person. If their seat ended and they were re-invited, the seat$new$;
BEGIN
 IF target IS NULL THEN RAISE EXCEPTION 'EXP08 post currentness original writer missing'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint c
  WHERE c.contype='f' AND c.conrelid=to_regclass('public.profiles') AND c.confrelid=to_regclass('auth.users')
   AND c.convalidated AND NOT c.condeferrable AND NOT c.condeferred
   AND c.confmatchtype='s' AND c.confupdtype='a' AND c.confdeltype='c'
   AND c.conkey=ARRAY[(SELECT a.attnum FROM pg_attribute a WHERE a.attrelid=c.conrelid AND a.attname='user_id' AND a.attnum>0 AND NOT a.attisdropped)]::smallint[]
   AND c.confkey=ARRAY[(SELECT a.attnum FROM pg_attribute a WHERE a.attrelid=c.confrelid AND a.attname='id' AND a.attnum>0 AND NOT a.attisdropped)]::smallint[]
   AND (SELECT count(*) FROM pg_trigger t WHERE t.tgconstraint=c.oid)=4
   AND NOT EXISTS(SELECT 1 FROM (VALUES
    (c.conrelid,'RI_FKey_check_ins',5),(c.conrelid,'RI_FKey_check_upd',17),
    (c.confrelid,'RI_FKey_cascade_del',9),(c.confrelid,'RI_FKey_noaction_upd',17)
   ) expected(relation_id,routine,event_type) WHERE NOT EXISTS(
    SELECT 1 FROM pg_trigger t WHERE t.tgconstraint=c.oid AND t.tgrelid=expected.relation_id
     AND t.tgfoid=to_regprocedure('pg_catalog.'||quote_ident(expected.routine)||'()')
     AND t.tgtype=expected.event_type AND t.tgenabled IN ('O','A') AND t.tgisinternal
     AND NOT t.tgdeferrable AND NOT t.tginitdeferred AND t.tgnargs=0 AND t.tgqual IS NULL
     AND cardinality(t.tgattr::smallint[])=0
     AND t.tgconstrrelid=CASE WHEN expected.relation_id=c.conrelid THEN c.confrelid ELSE c.conrelid END))) THEN
  RAISE EXCEPTION 'EXP08 post currentness original profile identity FK drift';
 END IF;
 FOR dependency IN SELECT * FROM (VALUES
  ('public._team_hub_is_active(uuid,uuid)','0bb50fd64a0410d09df23e7e6e29ab2d','s','sql','boolean',false,ARRAY['p_tenant','p_user']::text[]),
  ('public._team_hub_participates(uuid,uuid)','508c4d54cf9bbc3a233afbdad68e4325','s','sql','boolean',false,ARRAY['p_tenant','p_user']::text[]),
  ('public._team_hub_hold_seats(uuid,uuid[])','f607181e3473a846718ac317751d6af5','v','plpgsql','boolean',false,ARRAY['p_tenant','p_users']::text[]),
  ('public._team_hub_refusal(uuid)','1c2ef63537cb340106b95b730e3f05f1','s','plpgsql','text',false,ARRAY['p_expected_tenant']::text[]),
  ('public._team_hub_visible(uuid,uuid,uuid)','28a7e5c90f2a29b19b4481c4850a414f','s','sql','public.team_hub_channels',true,ARRAY['p_tenant','p_actor','p_channel']::text[])
 ) d(signature,body_hash,volatility,language_name,result_type,result_set,argnames) LOOP
  IF to_regprocedure(dependency.signature) IS NULL THEN
   RAISE EXCEPTION 'EXP08 post currentness admission dependency missing: %',dependency.signature;
  END IF;
  SELECT * INTO STRICT helper FROM pg_proc WHERE oid=to_regprocedure(dependency.signature);
  IF md5(helper.prosrc)<>dependency.body_hash OR helper.proowner<>'postgres'::regrole OR helper.prosecdef
   OR helper.provolatile::text<>dependency.volatility OR helper.prolang<>(SELECT oid FROM pg_language WHERE lanname=dependency.language_name)
   OR helper.prorettype<>to_regtype(dependency.result_type) OR helper.proretset<>dependency.result_set
   OR helper.prokind<>'f' OR helper.proisstrict OR helper.proleakproof OR helper.proparallel<>'u'
   OR helper.provariadic<>0 OR helper.pronargdefaults<>0 OR helper.proargmodes IS NOT NULL
   OR helper.pronargs<>cardinality(dependency.argnames) OR helper.proargnames IS DISTINCT FROM dependency.argnames
   OR helper.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
   OR NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(helper.proacl,acldefault('f',helper.proowner))) a
    WHERE a.grantee='postgres'::regrole AND a.privilege_type='EXECUTE' AND NOT a.is_grantable)
   OR EXISTS(SELECT 1 FROM aclexplode(coalesce(helper.proacl,acldefault('f',helper.proowner))) a
    WHERE a.grantee<>'postgres'::regrole OR a.privilege_type<>'EXECUTE' OR a.is_grantable) THEN
   RAISE EXCEPTION 'EXP08 post currentness admission dependency drift: %',dependency.signature;
  END IF;
 END LOOP;
 SELECT * INTO STRICT p FROM pg_proc WHERE oid=target;
 IF p.proowner<>'postgres'::regrole OR NOT p.prosecdef OR p.provolatile<>'v'
  OR p.prolang<>(SELECT oid FROM pg_language WHERE lanname='plpgsql') OR p.prorettype<>'jsonb'::regtype OR p.proretset
  OR p.prokind<>'f' OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u' OR p.provariadic<>0
  OR p.pronargs<>9 OR p.pronargdefaults<>5 OR p.proargmodes IS NOT NULL
  OR pg_get_expr(p.proargdefaults,0) IS DISTINCT FROM $defaults$NULL::uuid, '{}'::uuid[], '{}'::uuid[], '{}'::text[], NULL::text$defaults$
  OR p.proargnames IS DISTINCT FROM ARRAY['p_expected_tenant','p_channel_id','p_body','p_client_request_id','p_parent_message_id','p_mention_ids','p_file_ids','p_agent_mention_keys','p_broadcast_mention']::text[]
  OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
  OR EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
   WHERE a.grantee NOT IN ('postgres'::regrole,'authenticated'::regrole) OR a.privilege_type<>'EXECUTE' OR a.is_grantable)
  OR NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
   WHERE a.grantee='postgres'::regrole AND a.privilege_type='EXECUTE' AND NOT a.is_grantable)
  OR NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
   WHERE a.grantee='authenticated'::regrole AND a.privilege_type='EXECUTE' AND NOT a.is_grantable) THEN
  RAISE EXCEPTION 'EXP08 post currentness original writer metadata drift';
 END IF;
 current_source:=p.prosrc;
 IF position('exp08_post_current_actor_v1' IN current_source)>0 THEN
  IF (length(current_source)-length(replace(current_source,new_span,'')))/length(new_span)<>1
   OR md5(replace(current_source,new_span,old_span))<>'2b9e0270f28b6c17fd3adb37d5b554d8' THEN
   RAISE EXCEPTION 'EXP08 post currentness partial or drifted writer';
  END IF;
 ELSE
  IF md5(current_source)<>'2b9e0270f28b6c17fd3adb37d5b554d8'
   OR (length(current_source)-length(replace(current_source,old_span,'')))/length(old_span)<>1 THEN
   RAISE EXCEPTION 'EXP08 post currentness original writer source drift';
  END IF;
  -- CREATE OR REPLACE reparses defaults. Observed parser locations change, not their values.
  -- Conserve every other field exactly and both the complete normalized AST and expression.
  SELECT pg_get_functiondef(target),to_jsonb(f)-'prosrc'-'proargdefaults',
   regexp_replace(f.proargdefaults::text,':location -?[0-9]+',':location -1','g'),pg_get_expr(f.proargdefaults,0)
   INTO definition,before_metadata,before_defaults,before_default_expression FROM pg_proc f WHERE oid=target;
  EXECUTE replace(definition,old_span,new_span);
  IF (SELECT to_jsonb(f)-'prosrc'-'proargdefaults' FROM pg_proc f WHERE oid=target) IS DISTINCT FROM before_metadata
   OR (SELECT regexp_replace(f.proargdefaults::text,':location -?[0-9]+',':location -1','g') FROM pg_proc f WHERE oid=target) IS DISTINCT FROM before_defaults
   OR (SELECT pg_get_expr(f.proargdefaults,0) FROM pg_proc f WHERE oid=target) IS DISTINCT FROM before_default_expression
   OR (SELECT md5(replace(prosrc,new_span,old_span)) FROM pg_proc WHERE oid=target)<>'2b9e0270f28b6c17fd3adb37d5b554d8' THEN
   RAISE EXCEPTION 'EXP08 post currentness source or metadata conservation failed';
  END IF;
 END IF;
END $post_currentness$;
COMMIT;
