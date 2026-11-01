-- INERT EXP08 original member-add currentness candidate. No migration version or applied history.
-- Only the original writer changes. All existing roles, duplicate handling and admission remain.
BEGIN;
SET LOCAL lock_timeout='2s';
DO $member_add_currentness$
DECLARE target regprocedure:=to_regprocedure('public.team_hub_add_members(uuid,uuid,uuid[])');
 p pg_proc; dependency record; helper pg_proc; current_source text; before_metadata jsonb; definition text;
 old_span constant text:=$old$ IF NOT public._team_hub_hold_seats(p_expected_tenant,p_user_ids) THEN RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;$old$;
 new_span constant text:=$new$ -- exp08_member_add_current_actor_v1: retain original actor, context and private-channel authority through the effect.
 -- The existing validated profiles identity FK takes KEY SHARE on this parent for an INSERT.
 -- Ordered parent UPDATE locks precede every seat lock, also covering a legitimately absent profile.
 PERFORM u.id FROM auth.users u WHERE u.id=ANY(actor||p_user_ids) ORDER BY u.id FOR UPDATE;
 IF NOT public._team_hub_hold_seats(p_expected_tenant,actor||p_user_ids) THEN
  refusal:=public._team_hub_refusal(p_expected_tenant);
  RETURN jsonb_build_object('ok',false,'code',coalesce(refusal,'invalid'));
 END IF;
 PERFORM 1 FROM public.profiles current_actor_profile WHERE current_actor_profile.user_id=actor FOR SHARE;
 refusal:=public._team_hub_refusal(p_expected_tenant);
 IF refusal IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'code',refusal); END IF;
 SELECT c.* INTO ch FROM public.team_hub_channels c
  WHERE c.id=p_channel_id AND c.tenant_id=p_expected_tenant AND c.kind='channel'
   AND c.visibility='private' AND c.archived_at IS NULL FOR SHARE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','not_found'); END IF;
 PERFORM 1 FROM public.team_hub_channel_members current_actor_member
  WHERE current_actor_member.channel_id=ch.id AND current_actor_member.tenant_id=p_expected_tenant
   AND current_actor_member.user_id=actor FOR SHARE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','not_found'); END IF;
 -- The existing visibility predicate remains the authority, after its source rows are held.
 SELECT c.* INTO ch FROM public._team_hub_visible(p_expected_tenant,actor,p_channel_id) c;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','not_found'); END IF;$new$;
BEGIN
 IF target IS NULL THEN RAISE EXCEPTION 'EXP08 member-add currentness original writer missing'; END IF;
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
  RAISE EXCEPTION 'EXP08 member-add currentness original profile identity FK drift';
 END IF;
 FOR dependency IN SELECT * FROM (VALUES
  ('public._team_hub_is_active(uuid,uuid)','0bb50fd64a0410d09df23e7e6e29ab2d','s','sql','boolean',false,ARRAY['p_tenant','p_user']::text[]),
  ('public._team_hub_participates(uuid,uuid)','508c4d54cf9bbc3a233afbdad68e4325','s','sql','boolean',false,ARRAY['p_tenant','p_user']::text[]),
  ('public._team_hub_hold_seats(uuid,uuid[])','f607181e3473a846718ac317751d6af5','v','plpgsql','boolean',false,ARRAY['p_tenant','p_users']::text[]),
  ('public._team_hub_refusal(uuid)','1c2ef63537cb340106b95b730e3f05f1','s','plpgsql','text',false,ARRAY['p_expected_tenant']::text[]),
  ('public._team_hub_visible(uuid,uuid,uuid)','28a7e5c90f2a29b19b4481c4850a414f','s','sql','public.team_hub_channels',true,ARRAY['p_tenant','p_actor','p_channel']::text[])
 ) d(signature,body_hash,volatility,language_name,result_type,result_set,argnames) LOOP
  IF to_regprocedure(dependency.signature) IS NULL THEN
   RAISE EXCEPTION 'EXP08 member-add currentness admission dependency missing: %',dependency.signature;
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
   RAISE EXCEPTION 'EXP08 member-add currentness admission dependency drift: %',dependency.signature;
  END IF;
 END LOOP;
 SELECT * INTO STRICT p FROM pg_proc WHERE oid=target;
 IF p.proowner<>'postgres'::regrole OR NOT p.prosecdef OR p.provolatile<>'v'
  OR p.prolang<>(SELECT oid FROM pg_language WHERE lanname='plpgsql') OR p.prorettype<>'jsonb'::regtype OR p.proretset
  OR p.prokind<>'f' OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u' OR p.provariadic<>0
  OR p.pronargs<>3 OR p.pronargdefaults<>0 OR p.proargmodes IS NOT NULL
  OR p.proargnames IS DISTINCT FROM ARRAY['p_expected_tenant','p_channel_id','p_user_ids']::text[]
  OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
  OR EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
   WHERE a.grantee NOT IN ('postgres'::regrole,'authenticated'::regrole) OR a.privilege_type<>'EXECUTE' OR a.is_grantable)
  OR NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
   WHERE a.grantee='postgres'::regrole AND a.privilege_type='EXECUTE' AND NOT a.is_grantable)
  OR NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
   WHERE a.grantee='authenticated'::regrole AND a.privilege_type='EXECUTE' AND NOT a.is_grantable) THEN
  RAISE EXCEPTION 'EXP08 member-add currentness original writer metadata drift';
 END IF;
 current_source:=p.prosrc;
 IF position('exp08_member_add_current_actor_v1' IN current_source)>0 THEN
  IF (length(current_source)-length(replace(current_source,new_span,'')))/length(new_span)<>1
   OR md5(replace(current_source,new_span,old_span))<>'25bac1def127e3998036368329e4c80d' THEN
   RAISE EXCEPTION 'EXP08 member-add currentness partial or drifted writer';
  END IF;
 ELSE
  IF md5(current_source)<>'25bac1def127e3998036368329e4c80d'
   OR (length(current_source)-length(replace(current_source,old_span,'')))/length(old_span)<>1 THEN
   RAISE EXCEPTION 'EXP08 member-add currentness original writer source drift';
  END IF;
  SELECT pg_get_functiondef(target),to_jsonb(f)-'prosrc' INTO definition,before_metadata FROM pg_proc f WHERE oid=target;
  EXECUTE replace(definition,old_span,new_span);
  IF (SELECT to_jsonb(f)-'prosrc' FROM pg_proc f WHERE oid=target) IS DISTINCT FROM before_metadata
   OR (SELECT md5(replace(prosrc,new_span,old_span)) FROM pg_proc WHERE oid=target)<>'25bac1def127e3998036368329e4c80d' THEN
   RAISE EXCEPTION 'EXP08 member-add currentness source or metadata conservation failed';
  END IF;
 END IF;
END $member_add_currentness$;
COMMIT;
