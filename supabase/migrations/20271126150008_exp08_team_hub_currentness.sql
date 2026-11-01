-- EXP08 forward currentness repair: ORIGINAL three admission helpers and seven Hub writers.
-- No new table, authority/approval engine, role/grant, Auth/profile/domain writer or provider effect.
-- Atomic guard/application/replay; applied native140008 and all prior history remain untouched.
BEGIN;
-- Original reviewed piece: exp08-team-hub-identity-currentness-patch.sql
SET LOCAL lock_timeout='2s';
DO $identity_currentness$
DECLARE r record; p pg_proc; target regprocedure; current_source text; next_definition text;
 before_metadata jsonb; marker constant text:='exp08_current_identity_v1';
BEGIN
 IF EXISTS(SELECT 1 FROM (VALUES ('id','uuid'),('deleted_at','timestamptz'),('banned_until','timestamptz')) c(name,kind)
  WHERE NOT EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid=to_regclass('auth.users')
   AND a.attname=c.name AND a.atttypid=to_regtype(c.kind) AND a.attnum>0 AND NOT a.attisdropped)) THEN
  RAISE EXCEPTION 'EXP08 identity currentness original Auth columns missing or drifted';
 END IF;
 FOR r IN SELECT * FROM (VALUES
  ('public._team_hub_is_active(uuid,uuid)','c290399dc80d95d16116a0f88b0abd8c',
   $old$WHERE m.tenant_id=p_tenant AND m.user_id=p_user AND m.status='active'$old$,
   $new$WHERE m.tenant_id=p_tenant AND m.user_id=p_user AND m.status='active'
   AND EXISTS(SELECT 1 FROM auth.users u WHERE u.id=p_user AND u.deleted_at IS NULL
    AND (u.banned_until IS NULL OR u.banned_until<=now())) /* exp08_current_identity_v1 */$new$,
   's','sql',ARRAY['p_tenant','p_user']::text[]),
  ('public._team_hub_participates(uuid,uuid)','4f2fb69d09f7b362027edf195a37da83',
   $old$WHERE m.tenant_id=p_tenant AND m.user_id=p_user AND m.status='active' AND m.team_hub_access$old$,
   $new$WHERE m.tenant_id=p_tenant AND m.user_id=p_user AND m.status='active' AND m.team_hub_access
   AND public._team_hub_is_active(p_tenant,p_user) /* exp08_current_identity_v1 */$new$,
   's','sql',ARRAY['p_tenant','p_user']::text[]),
  ('public._team_hub_hold_seats(uuid,uuid[])','af0dee455ee0413ee5b907505ff89acd',
   $old$FROM public.tenant_members m
  WHERE m.tenant_id=p_tenant AND m.user_id=ANY(p_users) AND m.status='active' AND m.team_hub_access ORDER BY m.user_id FOR SHARE$old$,
   $new$FROM public.tenant_members m JOIN auth.users u ON u.id=m.user_id
  WHERE m.tenant_id=p_tenant AND m.user_id=ANY(p_users) AND m.status='active' AND m.team_hub_access
   AND u.deleted_at IS NULL AND (u.banned_until IS NULL OR u.banned_until<=now())
  ORDER BY m.user_id FOR SHARE OF m,u /* exp08_current_identity_v1 */$new$,
   'v','plpgsql',ARRAY['p_tenant','p_users']::text[])
 ) AS candidates(signature,expected_hash,old_span,new_span,volatility,language_name,argnames) LOOP
  target:=to_regprocedure(r.signature);
  IF target IS NULL THEN RAISE EXCEPTION 'EXP08 identity currentness original function missing: %',r.signature; END IF;
  SELECT * INTO STRICT p FROM pg_proc WHERE oid=target;
  IF p.proowner<>'postgres'::regrole OR p.prosecdef OR p.provolatile::text<>r.volatility
   OR p.prolang<>(SELECT oid FROM pg_language WHERE lanname=r.language_name)
   OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u' OR p.prokind<>'f'
   OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
   OR p.prorettype<>'boolean'::regtype OR p.proretset OR p.pronargdefaults<>0
   OR p.proargnames IS DISTINCT FROM r.argnames OR p.proargmodes IS NOT NULL
   OR EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    WHERE a.grantee<>'postgres'::regrole OR a.privilege_type<>'EXECUTE' OR a.is_grantable)
   OR NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    WHERE a.grantee='postgres'::regrole AND a.privilege_type='EXECUTE' AND NOT a.is_grantable) THEN
   RAISE EXCEPTION 'EXP08 identity currentness original metadata drift: %',r.signature;
  END IF;
  current_source:=p.prosrc;
  IF position(marker IN current_source)>0 THEN
   IF (length(current_source)-length(replace(current_source,r.new_span,'')))/length(r.new_span)<>1
    OR md5(replace(current_source,r.new_span,r.old_span))<>r.expected_hash THEN
    RAISE EXCEPTION 'EXP08 identity currentness partial or drifted source: %',r.signature;
   END IF;
  ELSE
   IF md5(current_source)<>r.expected_hash
    OR (length(current_source)-length(replace(current_source,r.old_span,'')))/length(r.old_span)<>1 THEN
    RAISE EXCEPTION 'EXP08 identity currentness original source drift: %',r.signature;
   END IF;
   SELECT pg_get_functiondef(target),to_jsonb(f)-'prosrc' INTO next_definition,before_metadata FROM pg_proc f WHERE oid=target;
   EXECUTE replace(next_definition,r.old_span,r.new_span);
   IF (SELECT to_jsonb(f)-'prosrc' FROM pg_proc f WHERE oid=target) IS DISTINCT FROM before_metadata
    OR (SELECT md5(replace(prosrc,r.new_span,r.old_span)) FROM pg_proc WHERE oid=target)<>r.expected_hash THEN
    RAISE EXCEPTION 'EXP08 identity currentness source or metadata conservation failed: %',r.signature;
   END IF;
  END IF;
 END LOOP;
END $identity_currentness$;

-- Original reviewed piece: exp08-team-hub-member-add-currentness-patch.sql
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

-- Original reviewed piece: exp08-team-hub-post-currentness-patch.sql
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

-- Original reviewed piece: exp08-team-hub-create-currentness-patch.sql
SET LOCAL lock_timeout='2s';
DO $create_currentness$
DECLARE target regprocedure:=to_regprocedure('public.team_hub_create_channel(uuid,text,text,uuid[],uuid)');
 p pg_proc; dependency record; helper pg_proc; current_source text; before_metadata jsonb; definition text;
 old_span constant text:=$old$ PERFORM pg_advisory_xact_lock(hashtextextended(p_expected_tenant::text||':'||actor::text||':'||channel_name,0));$old$;
 new_span constant text:=$new$ PERFORM pg_advisory_xact_lock(hashtextextended(p_expected_tenant::text||':'||actor::text||':'||channel_name,0));
 -- exp08_create_current_actor_v1: an advisory-name wait cannot retain an obsolete workspace.
 -- Ordered existing identity parents precede seat/profile locks, including missing-profile fallback.
 PERFORM u.id FROM auth.users u WHERE u.id=ANY(actor||members) ORDER BY u.id FOR UPDATE;
 IF NOT public._team_hub_hold_seats(p_expected_tenant,actor||members) THEN
  RETURN jsonb_build_object('ok',false,'code',CASE WHEN public._team_hub_participates(p_expected_tenant,actor)
   THEN 'invalid' WHEN public._team_hub_is_active(p_expected_tenant,actor) THEN 'conversations_off'
   ELSE 'not_member' END);
 END IF;
 PERFORM 1 FROM public.profiles current_actor_profile WHERE current_actor_profile.user_id=actor FOR SHARE;
 refusal:=public._team_hub_refusal(p_expected_tenant);
 IF refusal IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'code',refusal); END IF;$new$;
BEGIN
 IF target IS NULL THEN RAISE EXCEPTION 'EXP08 create currentness original writer missing'; END IF;
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
  RAISE EXCEPTION 'EXP08 create currentness original profile identity FK drift';
 END IF;
 FOR dependency IN SELECT * FROM (VALUES
  ('public._team_hub_is_active(uuid,uuid)','0bb50fd64a0410d09df23e7e6e29ab2d','s','sql','boolean',false,ARRAY['p_tenant','p_user']::text[]),
  ('public._team_hub_participates(uuid,uuid)','508c4d54cf9bbc3a233afbdad68e4325','s','sql','boolean',false,ARRAY['p_tenant','p_user']::text[]),
  ('public._team_hub_hold_seats(uuid,uuid[])','f607181e3473a846718ac317751d6af5','v','plpgsql','boolean',false,ARRAY['p_tenant','p_users']::text[]),
  ('public._team_hub_refusal(uuid)','1c2ef63537cb340106b95b730e3f05f1','s','plpgsql','text',false,ARRAY['p_expected_tenant']::text[]),
  ('public._team_hub_visible(uuid,uuid,uuid)','28a7e5c90f2a29b19b4481c4850a414f','s','sql','public.team_hub_channels',true,ARRAY['p_tenant','p_actor','p_channel']::text[])
 ) d(signature,body_hash,volatility,language_name,result_type,result_set,argnames) LOOP
  IF to_regprocedure(dependency.signature) IS NULL THEN
   RAISE EXCEPTION 'EXP08 create currentness admission dependency missing: %',dependency.signature;
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
   RAISE EXCEPTION 'EXP08 create currentness admission dependency drift: %',dependency.signature;
  END IF;
 END LOOP;
 SELECT * INTO STRICT p FROM pg_proc WHERE oid=target;
 IF p.proowner<>'postgres'::regrole OR NOT p.prosecdef OR p.provolatile<>'v'
  OR p.prolang<>(SELECT oid FROM pg_language WHERE lanname='plpgsql') OR p.prorettype<>'jsonb'::regtype OR p.proretset
  OR p.prokind<>'f' OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u' OR p.provariadic<>0
  OR p.pronargs<>5 OR p.pronargdefaults<>0 OR p.proargmodes IS NOT NULL
  OR p.proargnames IS DISTINCT FROM ARRAY['p_expected_tenant','p_name','p_visibility','p_member_ids','p_client_request_id']::text[]
  OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
  OR EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
   WHERE a.grantee NOT IN ('postgres'::regrole,'authenticated'::regrole) OR a.privilege_type<>'EXECUTE' OR a.is_grantable)
  OR NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
   WHERE a.grantee='postgres'::regrole AND a.privilege_type='EXECUTE' AND NOT a.is_grantable)
  OR NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
   WHERE a.grantee='authenticated'::regrole AND a.privilege_type='EXECUTE' AND NOT a.is_grantable) THEN
  RAISE EXCEPTION 'EXP08 create currentness original writer metadata drift';
 END IF;
 current_source:=p.prosrc;
 IF position('exp08_create_current_actor_v1' IN current_source)>0 THEN
  IF (length(current_source)-length(replace(current_source,new_span,'')))/length(new_span)<>1
   OR md5(replace(current_source,new_span,old_span))<>'66c82c0a843b9bf98aa8e18f7ab4c2a2' THEN
   RAISE EXCEPTION 'EXP08 create currentness partial or drifted writer';
  END IF;
 ELSE
  IF md5(current_source)<>'66c82c0a843b9bf98aa8e18f7ab4c2a2'
   OR (length(current_source)-length(replace(current_source,old_span,'')))/length(old_span)<>1 THEN
   RAISE EXCEPTION 'EXP08 create currentness original writer source drift';
  END IF;
  SELECT pg_get_functiondef(target),to_jsonb(f)-'prosrc' INTO definition,before_metadata FROM pg_proc f WHERE oid=target;
  EXECUTE replace(definition,old_span,new_span);
  IF (SELECT to_jsonb(f)-'prosrc' FROM pg_proc f WHERE oid=target) IS DISTINCT FROM before_metadata
   OR (SELECT md5(replace(prosrc,new_span,old_span)) FROM pg_proc WHERE oid=target)<>'66c82c0a843b9bf98aa8e18f7ab4c2a2' THEN
   RAISE EXCEPTION 'EXP08 create currentness source or metadata conservation failed';
  END IF;
 END IF;
END $create_currentness$;

-- Original reviewed piece: exp08-team-hub-join-currentness-patch.sql
SET LOCAL lock_timeout='2s';
DO $join_currentness$
DECLARE target regprocedure:=to_regprocedure('public.team_hub_join_channel(uuid,uuid)');
 p pg_proc; dependency record; helper pg_proc; current_source text; before_metadata jsonb; definition text;
 old_span constant text:=$old$ IF NOT public._team_hub_hold_seats(p_expected_tenant,ARRAY[actor]) THEN RETURN jsonb_build_object('ok',false,'code','not_member'); END IF;$old$;
 new_span constant text:=$new$ -- exp08_join_current_actor_v1: retain original actor/context through admission and effect.
 -- Existing removal orders identity, membership, then profile. Keep that same order.
 PERFORM u.id FROM auth.users u WHERE u.id=actor FOR UPDATE;
 IF NOT public._team_hub_hold_seats(p_expected_tenant,ARRAY[actor]) THEN RETURN jsonb_build_object('ok',false,'code','not_member'); END IF;
 PERFORM 1 FROM public.profiles current_actor_profile WHERE current_actor_profile.user_id=actor FOR SHARE;
 refusal:=public._team_hub_refusal(p_expected_tenant);
 IF refusal IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'code',refusal); END IF;
 SELECT c.* INTO ch FROM public.team_hub_channels c
  WHERE c.id=p_channel_id AND c.tenant_id=p_expected_tenant AND c.kind='channel'
   AND c.visibility='team' AND c.archived_at IS NULL FOR SHARE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','not_found'); END IF;
 SELECT c.* INTO ch FROM public._team_hub_visible(p_expected_tenant,actor,p_channel_id) c;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','not_found'); END IF;$new$;
BEGIN
 IF target IS NULL THEN RAISE EXCEPTION 'EXP08 join currentness original writer missing'; END IF;
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
  RAISE EXCEPTION 'EXP08 join currentness original profile identity FK drift';
 END IF;
 FOR dependency IN SELECT * FROM (VALUES
  ('public._team_hub_is_active(uuid,uuid)','0bb50fd64a0410d09df23e7e6e29ab2d','s','sql','boolean',false,ARRAY['p_tenant','p_user']::text[]),
  ('public._team_hub_participates(uuid,uuid)','508c4d54cf9bbc3a233afbdad68e4325','s','sql','boolean',false,ARRAY['p_tenant','p_user']::text[]),
  ('public._team_hub_hold_seats(uuid,uuid[])','f607181e3473a846718ac317751d6af5','v','plpgsql','boolean',false,ARRAY['p_tenant','p_users']::text[]),
  ('public._team_hub_refusal(uuid)','1c2ef63537cb340106b95b730e3f05f1','s','plpgsql','text',false,ARRAY['p_expected_tenant']::text[]),
  ('public._team_hub_visible(uuid,uuid,uuid)','28a7e5c90f2a29b19b4481c4850a414f','s','sql','public.team_hub_channels',true,ARRAY['p_tenant','p_actor','p_channel']::text[])
 ) d(signature,body_hash,volatility,language_name,result_type,result_set,argnames) LOOP
  IF to_regprocedure(dependency.signature) IS NULL THEN
   RAISE EXCEPTION 'EXP08 join currentness admission dependency missing: %',dependency.signature;
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
   RAISE EXCEPTION 'EXP08 join currentness admission dependency drift: %',dependency.signature;
  END IF;
 END LOOP;
 SELECT * INTO STRICT p FROM pg_proc WHERE oid=target;
 IF p.proowner<>'postgres'::regrole OR NOT p.prosecdef OR p.provolatile<>'v'
  OR p.prolang<>(SELECT oid FROM pg_language WHERE lanname='plpgsql') OR p.prorettype<>'jsonb'::regtype OR p.proretset
  OR p.prokind<>'f' OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u' OR p.provariadic<>0
  OR p.pronargs<>2 OR p.pronargdefaults<>0 OR p.proargmodes IS NOT NULL
  OR p.proargnames IS DISTINCT FROM ARRAY['p_expected_tenant','p_channel_id']::text[]
  OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
  OR EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
   WHERE a.grantee NOT IN ('postgres'::regrole,'authenticated'::regrole) OR a.privilege_type<>'EXECUTE' OR a.is_grantable)
  OR NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
   WHERE a.grantee='postgres'::regrole AND a.privilege_type='EXECUTE' AND NOT a.is_grantable)
  OR NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
   WHERE a.grantee='authenticated'::regrole AND a.privilege_type='EXECUTE' AND NOT a.is_grantable) THEN
  RAISE EXCEPTION 'EXP08 join currentness original writer metadata drift';
 END IF;
 current_source:=p.prosrc;
 IF position('exp08_join_current_actor_v1' IN current_source)>0 THEN
  IF (length(current_source)-length(replace(current_source,new_span,'')))/length(new_span)<>1
   OR md5(replace(current_source,new_span,old_span))<>'b28a684657c15f092295c9a3b9f124c5' THEN
   RAISE EXCEPTION 'EXP08 join currentness partial or drifted writer';
  END IF;
 ELSE
  IF md5(current_source)<>'b28a684657c15f092295c9a3b9f124c5'
   OR (length(current_source)-length(replace(current_source,old_span,'')))/length(old_span)<>1 THEN
   RAISE EXCEPTION 'EXP08 join currentness original writer source drift';
  END IF;
  SELECT pg_get_functiondef(target),to_jsonb(f)-'prosrc' INTO definition,before_metadata FROM pg_proc f WHERE oid=target;
  EXECUTE replace(definition,old_span,new_span);
  IF (SELECT to_jsonb(f)-'prosrc' FROM pg_proc f WHERE oid=target) IS DISTINCT FROM before_metadata
   OR (SELECT md5(replace(prosrc,new_span,old_span)) FROM pg_proc WHERE oid=target)<>'b28a684657c15f092295c9a3b9f124c5' THEN
   RAISE EXCEPTION 'EXP08 join currentness source or metadata conservation failed';
  END IF;
 END IF;
END $join_currentness$;

-- Original reviewed piece: exp08-team-hub-agent-dm-currentness-patch.sql
SET LOCAL lock_timeout='2s';
DO $agent_dm_currentness$
DECLARE target regprocedure:=to_regprocedure('public.team_hub_open_agent_dm(uuid,text)');
 p pg_proc; dependency record; helper pg_proc; current_source text; before_metadata jsonb; definition text;
 old_span constant text:=$old$ IF NOT public._team_hub_hold_seats(p_expected_tenant,ARRAY[actor]) THEN
  RETURN jsonb_build_object('ok',false,'code',CASE WHEN public._team_hub_is_active(p_expected_tenant,actor)
   THEN 'conversations_off' ELSE 'not_member' END); END IF;$old$;
 new_span constant text:=$new$ -- exp08_agent_dm_current_actor_v1: retain original actor/context through admission and effect.
 -- Existing removal orders identity, membership, then profile. Keep that same order.
 PERFORM u.id FROM auth.users u WHERE u.id=actor FOR UPDATE;
 IF NOT public._team_hub_hold_seats(p_expected_tenant,ARRAY[actor]) THEN
  RETURN jsonb_build_object('ok',false,'code',CASE WHEN public._team_hub_is_active(p_expected_tenant,actor)
   THEN 'conversations_off' ELSE 'not_member' END); END IF;
 PERFORM 1 FROM public.profiles current_actor_profile WHERE current_actor_profile.user_id=actor FOR SHARE;
 refusal:=public._team_hub_refusal(p_expected_tenant);
 IF refusal IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'code',refusal); END IF;
$new$;
BEGIN
 IF target IS NULL THEN RAISE EXCEPTION 'EXP08 agent-dm currentness original writer missing'; END IF;
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
  RAISE EXCEPTION 'EXP08 agent-dm currentness original profile identity FK drift';
 END IF;
 FOR dependency IN SELECT * FROM (VALUES
  ('public._team_hub_is_active(uuid,uuid)','0bb50fd64a0410d09df23e7e6e29ab2d','s','sql','boolean',false,ARRAY['p_tenant','p_user']::text[]),
  ('public._team_hub_participates(uuid,uuid)','508c4d54cf9bbc3a233afbdad68e4325','s','sql','boolean',false,ARRAY['p_tenant','p_user']::text[]),
  ('public._team_hub_hold_seats(uuid,uuid[])','f607181e3473a846718ac317751d6af5','v','plpgsql','boolean',false,ARRAY['p_tenant','p_users']::text[]),
  ('public._team_hub_refusal(uuid)','1c2ef63537cb340106b95b730e3f05f1','s','plpgsql','text',false,ARRAY['p_expected_tenant']::text[]),
  ('public._team_hub_visible(uuid,uuid,uuid)','28a7e5c90f2a29b19b4481c4850a414f','s','sql','public.team_hub_channels',true,ARRAY['p_tenant','p_actor','p_channel']::text[])
 ) d(signature,body_hash,volatility,language_name,result_type,result_set,argnames) LOOP
  IF to_regprocedure(dependency.signature) IS NULL THEN
   RAISE EXCEPTION 'EXP08 agent-dm currentness admission dependency missing: %',dependency.signature;
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
   RAISE EXCEPTION 'EXP08 agent-dm currentness admission dependency drift: %',dependency.signature;
  END IF;
 END LOOP;
 SELECT * INTO STRICT p FROM pg_proc WHERE oid=target;
 IF p.proowner<>'postgres'::regrole OR NOT p.prosecdef OR p.provolatile<>'v'
  OR p.prolang<>(SELECT oid FROM pg_language WHERE lanname='plpgsql') OR p.prorettype<>'jsonb'::regtype OR p.proretset
  OR p.prokind<>'f' OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u' OR p.provariadic<>0
  OR p.pronargs<>2 OR p.pronargdefaults<>0 OR p.proargmodes IS NOT NULL
  OR p.proargnames IS DISTINCT FROM ARRAY['p_expected_tenant','p_agent_key']::text[]
  OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
  OR EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
   WHERE a.grantee NOT IN ('postgres'::regrole,'authenticated'::regrole) OR a.privilege_type<>'EXECUTE' OR a.is_grantable)
  OR NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
   WHERE a.grantee='postgres'::regrole AND a.privilege_type='EXECUTE' AND NOT a.is_grantable)
  OR NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
   WHERE a.grantee='authenticated'::regrole AND a.privilege_type='EXECUTE' AND NOT a.is_grantable) THEN
  RAISE EXCEPTION 'EXP08 agent-dm currentness original writer metadata drift';
 END IF;
 current_source:=p.prosrc;
 IF position('exp08_agent_dm_current_actor_v1' IN current_source)>0 THEN
  IF (length(current_source)-length(replace(current_source,new_span,'')))/length(new_span)<>1
   OR md5(replace(current_source,new_span,old_span))<>'84c7aed2b04bf0098c77105f6e7ea1d8' THEN
   RAISE EXCEPTION 'EXP08 agent-dm currentness partial or drifted writer';
  END IF;
 ELSE
  IF md5(current_source)<>'84c7aed2b04bf0098c77105f6e7ea1d8'
   OR (length(current_source)-length(replace(current_source,old_span,'')))/length(old_span)<>1 THEN
   RAISE EXCEPTION 'EXP08 agent-dm currentness original writer source drift';
  END IF;
  SELECT pg_get_functiondef(target),to_jsonb(f)-'prosrc' INTO definition,before_metadata FROM pg_proc f WHERE oid=target;
  EXECUTE replace(definition,old_span,new_span);
  IF (SELECT to_jsonb(f)-'prosrc' FROM pg_proc f WHERE oid=target) IS DISTINCT FROM before_metadata
   OR (SELECT md5(replace(prosrc,new_span,old_span)) FROM pg_proc WHERE oid=target)<>'84c7aed2b04bf0098c77105f6e7ea1d8' THEN
   RAISE EXCEPTION 'EXP08 agent-dm currentness source or metadata conservation failed';
  END IF;
 END IF;
END $agent_dm_currentness$;

-- Original reviewed piece: exp08-team-hub-human-dm-currentness-patch.sql
SET LOCAL lock_timeout='2s';
DO $human_dm_currentness$
DECLARE target regprocedure:=to_regprocedure('public.team_hub_open_dm(uuid,uuid)');
 p pg_proc; dependency record; helper pg_proc; current_source text; before_metadata jsonb; definition text;
 old_span constant text:=$old$ IF NOT public._team_hub_hold_seats(p_expected_tenant,ARRAY[actor,p_user_id]) THEN
  RETURN jsonb_build_object('ok',false,'code',CASE WHEN public._team_hub_participates(p_expected_tenant,actor)
   THEN 'invalid' WHEN public._team_hub_is_active(p_expected_tenant,actor) THEN 'conversations_off'
   ELSE 'not_member' END); END IF;$old$;
 new_span constant text:=$new$ -- exp08_human_dm_current_actor_v1: retain the original asker context through a pair wait.
 -- Ordered existing identities precede original seats, then profile, matching departure order.
 PERFORM u.id FROM auth.users u WHERE u.id IN (actor,p_user_id) ORDER BY u.id FOR UPDATE;
 IF NOT public._team_hub_hold_seats(p_expected_tenant,ARRAY[actor,p_user_id]) THEN
  RETURN jsonb_build_object('ok',false,'code',CASE WHEN public._team_hub_participates(p_expected_tenant,actor)
   THEN 'invalid' WHEN public._team_hub_is_active(p_expected_tenant,actor) THEN 'conversations_off'
   ELSE 'not_member' END); END IF;
 PERFORM 1 FROM public.profiles current_actor_profile WHERE current_actor_profile.user_id=actor FOR SHARE;
 refusal:=public._team_hub_refusal(p_expected_tenant);
 IF refusal IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'code',refusal); END IF;$new$;
BEGIN
 IF target IS NULL THEN RAISE EXCEPTION 'EXP08 human-DM currentness original writer missing'; END IF;
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
  RAISE EXCEPTION 'EXP08 human-DM currentness original profile identity FK drift';
 END IF;
 FOR dependency IN SELECT * FROM (VALUES
  ('public._team_hub_is_active(uuid,uuid)','0bb50fd64a0410d09df23e7e6e29ab2d','s','sql','boolean',false,ARRAY['p_tenant','p_user']::text[]),
  ('public._team_hub_participates(uuid,uuid)','508c4d54cf9bbc3a233afbdad68e4325','s','sql','boolean',false,ARRAY['p_tenant','p_user']::text[]),
  ('public._team_hub_hold_seats(uuid,uuid[])','f607181e3473a846718ac317751d6af5','v','plpgsql','boolean',false,ARRAY['p_tenant','p_users']::text[]),
  ('public._team_hub_refusal(uuid)','1c2ef63537cb340106b95b730e3f05f1','s','plpgsql','text',false,ARRAY['p_expected_tenant']::text[]),
  ('public._team_hub_visible(uuid,uuid,uuid)','28a7e5c90f2a29b19b4481c4850a414f','s','sql','public.team_hub_channels',true,ARRAY['p_tenant','p_actor','p_channel']::text[])
 ) d(signature,body_hash,volatility,language_name,result_type,result_set,argnames) LOOP
  IF to_regprocedure(dependency.signature) IS NULL THEN
   RAISE EXCEPTION 'EXP08 human-DM currentness admission dependency missing: %',dependency.signature;
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
   RAISE EXCEPTION 'EXP08 human-DM currentness admission dependency drift: %',dependency.signature;
  END IF;
 END LOOP;
 SELECT * INTO STRICT p FROM pg_proc WHERE oid=target;
 IF p.proowner<>'postgres'::regrole OR NOT p.prosecdef OR p.provolatile<>'v'
  OR p.prolang<>(SELECT oid FROM pg_language WHERE lanname='plpgsql') OR p.prorettype<>'jsonb'::regtype OR p.proretset
  OR p.prokind<>'f' OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u' OR p.provariadic<>0
  OR p.pronargs<>2 OR p.pronargdefaults<>0 OR p.proargmodes IS NOT NULL
  OR p.proargnames IS DISTINCT FROM ARRAY['p_expected_tenant','p_user_id']::text[]
  OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
  OR EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
   WHERE a.grantee NOT IN ('postgres'::regrole,'authenticated'::regrole) OR a.privilege_type<>'EXECUTE' OR a.is_grantable)
  OR NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
   WHERE a.grantee='postgres'::regrole AND a.privilege_type='EXECUTE' AND NOT a.is_grantable)
  OR NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
   WHERE a.grantee='authenticated'::regrole AND a.privilege_type='EXECUTE' AND NOT a.is_grantable) THEN
  RAISE EXCEPTION 'EXP08 human-DM currentness original writer metadata drift';
 END IF;
 current_source:=p.prosrc;
 IF position('exp08_human_dm_current_actor_v1' IN current_source)>0 THEN
  IF (length(current_source)-length(replace(current_source,new_span,'')))/length(new_span)<>1
   OR md5(replace(current_source,new_span,old_span))<>'14363512d49614142c3886a17dea11f6' THEN
   RAISE EXCEPTION 'EXP08 human-DM currentness partial or drifted writer';
  END IF;
 ELSE
  IF md5(current_source)<>'14363512d49614142c3886a17dea11f6'
   OR (length(current_source)-length(replace(current_source,old_span,'')))/length(old_span)<>1 THEN
   RAISE EXCEPTION 'EXP08 human-DM currentness original writer source drift';
  END IF;
  SELECT pg_get_functiondef(target),to_jsonb(f)-'prosrc' INTO definition,before_metadata FROM pg_proc f WHERE oid=target;
  EXECUTE replace(definition,old_span,new_span);
  IF (SELECT to_jsonb(f)-'prosrc' FROM pg_proc f WHERE oid=target) IS DISTINCT FROM before_metadata
   OR (SELECT md5(replace(prosrc,new_span,old_span)) FROM pg_proc WHERE oid=target)<>'14363512d49614142c3886a17dea11f6' THEN
   RAISE EXCEPTION 'EXP08 human-DM currentness source or metadata conservation failed';
  END IF;
 END IF;
END $human_dm_currentness$;

-- Original reviewed piece: exp08-team-hub-discard-currentness-patch.sql
SET LOCAL lock_timeout='2s';
DO $discard_currentness$
DECLARE target regprocedure:=to_regprocedure('public.team_hub_discard_file(uuid,uuid)');
 p pg_proc; dependency record; helper pg_proc; current_source text; before_metadata jsonb; definition text;
 old_span constant text:=$old$ IF f.message_id IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'code','not_allowed'); END IF;$old$;
 new_span constant text:=$new$ -- exp08_discard_current_actor_v1: a file wait cannot retain an obsolete actor/workspace.
 -- Conversation visibility is deliberately not required for an own unposted upload.
 PERFORM u.id FROM auth.users u WHERE u.id=actor FOR UPDATE;
 IF NOT public._team_hub_hold_seats(p_expected_tenant,ARRAY[actor]) THEN
  refusal:=public._team_hub_refusal(p_expected_tenant);
  RETURN jsonb_build_object('ok',false,'code',coalesce(refusal,'not_member'));
 END IF;
 PERFORM 1 FROM public.profiles current_actor_profile WHERE current_actor_profile.user_id=actor FOR SHARE;
 refusal:=public._team_hub_refusal(p_expected_tenant);
 IF refusal IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'code',refusal); END IF;
 IF f.message_id IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'code','not_allowed'); END IF;$new$;
BEGIN
 IF target IS NULL THEN RAISE EXCEPTION 'EXP08 discard currentness original writer missing'; END IF;
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
  RAISE EXCEPTION 'EXP08 discard currentness original profile identity FK drift';
 END IF;
 FOR dependency IN SELECT * FROM (VALUES
  ('public._team_hub_is_active(uuid,uuid)','0bb50fd64a0410d09df23e7e6e29ab2d','s','sql','boolean',false,ARRAY['p_tenant','p_user']::text[]),
  ('public._team_hub_participates(uuid,uuid)','508c4d54cf9bbc3a233afbdad68e4325','s','sql','boolean',false,ARRAY['p_tenant','p_user']::text[]),
  ('public._team_hub_hold_seats(uuid,uuid[])','f607181e3473a846718ac317751d6af5','v','plpgsql','boolean',false,ARRAY['p_tenant','p_users']::text[]),
  ('public._team_hub_refusal(uuid)','1c2ef63537cb340106b95b730e3f05f1','s','plpgsql','text',false,ARRAY['p_expected_tenant']::text[]),
  ('public._team_hub_visible(uuid,uuid,uuid)','28a7e5c90f2a29b19b4481c4850a414f','s','sql','public.team_hub_channels',true,ARRAY['p_tenant','p_actor','p_channel']::text[])
 ) d(signature,body_hash,volatility,language_name,result_type,result_set,argnames) LOOP
  IF to_regprocedure(dependency.signature) IS NULL THEN
   RAISE EXCEPTION 'EXP08 discard currentness admission dependency missing: %',dependency.signature;
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
   RAISE EXCEPTION 'EXP08 discard currentness admission dependency drift: %',dependency.signature;
  END IF;
 END LOOP;
 SELECT * INTO STRICT p FROM pg_proc WHERE oid=target;
 IF p.proowner<>'postgres'::regrole OR NOT p.prosecdef OR p.provolatile<>'v'
  OR p.prolang<>(SELECT oid FROM pg_language WHERE lanname='plpgsql') OR p.prorettype<>'jsonb'::regtype OR p.proretset
  OR p.prokind<>'f' OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u' OR p.provariadic<>0
  OR p.pronargs<>2 OR p.pronargdefaults<>0 OR p.proargmodes IS NOT NULL
  OR p.proargnames IS DISTINCT FROM ARRAY['p_expected_tenant','p_file_id']::text[]
  OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
  OR EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
   WHERE a.grantee NOT IN ('postgres'::regrole,'authenticated'::regrole) OR a.privilege_type<>'EXECUTE' OR a.is_grantable)
  OR NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
   WHERE a.grantee='postgres'::regrole AND a.privilege_type='EXECUTE' AND NOT a.is_grantable)
  OR NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
   WHERE a.grantee='authenticated'::regrole AND a.privilege_type='EXECUTE' AND NOT a.is_grantable) THEN
  RAISE EXCEPTION 'EXP08 discard currentness original writer metadata drift';
 END IF;
 current_source:=p.prosrc;
 IF position('exp08_discard_current_actor_v1' IN current_source)>0 THEN
  IF (length(current_source)-length(replace(current_source,new_span,'')))/length(new_span)<>1
   OR md5(replace(current_source,new_span,old_span))<>'702b36cf1a248f80cff0fde4bc084d66' THEN
   RAISE EXCEPTION 'EXP08 discard currentness partial or drifted writer';
  END IF;
 ELSE
  IF md5(current_source)<>'702b36cf1a248f80cff0fde4bc084d66'
   OR (length(current_source)-length(replace(current_source,old_span,'')))/length(old_span)<>1 THEN
   RAISE EXCEPTION 'EXP08 discard currentness original writer source drift';
  END IF;
  SELECT pg_get_functiondef(target),to_jsonb(f)-'prosrc' INTO definition,before_metadata FROM pg_proc f WHERE oid=target;
  EXECUTE replace(definition,old_span,new_span);
  IF (SELECT to_jsonb(f)-'prosrc' FROM pg_proc f WHERE oid=target) IS DISTINCT FROM before_metadata
   OR (SELECT md5(replace(prosrc,new_span,old_span)) FROM pg_proc WHERE oid=target)<>'702b36cf1a248f80cff0fde4bc084d66' THEN
   RAISE EXCEPTION 'EXP08 discard currentness source or metadata conservation failed';
  END IF;
 END IF;
END $discard_currentness$;
COMMIT;
