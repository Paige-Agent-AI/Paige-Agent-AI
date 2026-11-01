-- Runs AFTER every original A2b historical assertion/mutant; no earlier assertion is weakened.
-- Native synthetic source protocol only: no provider/model/usage invoice or customer execution.
RESET ROLE;
\ir ../../migrations/20271126100008_exp08_team_hub_actor_lifecycle.sql
\if :{?exp08_uncapped_baseline}
 \if :exp08_uncapped_baseline
  \echo 'BASELINE: new uncapped assertion against original cost allowance'
 \else
  \ir ../../migrations/20271126110008_exp08_team_hub_uncapped_consumption.sql
 \endif
\else
 \ir ../../migrations/20271126110008_exp08_team_hub_uncapped_consumption.sql
\endif

SELECT pg_temp.post(:'u5',:'ta',:'z5dm','Continue the same legitimate work')#>>'{message,id}' AS uq \gset
SELECT pg_temp.accept(:'ta',:'u5',:'z5dm',:'uq','zion','dm',pg_temp.tok('uncapped-0')) AS ua \gset
SELECT pg_temp.check((:'ua')::jsonb->>'ok'='true',
 'uncapped: a legitimate turn after the original30 starts is accepted; no model is invoked');

CREATE TEMP TABLE uncapped_metadata AS SELECT oid,prosrc,pg_get_functiondef(oid) definition,to_jsonb(p)-'prosrc' metadata
 FROM pg_proc p WHERE oid='public.team_hub_accept_agent_turn(uuid,uuid,uuid,uuid,text,text,text)'::regprocedure;
CREATE TEMP TABLE uncapped_replay AS SELECT (SELECT count(*) FROM public.team_hub_agent_turns) turns,
 (SELECT count(*) FROM public.team_hub_messages) messages;
\ir ../../migrations/20271126110008_exp08_team_hub_uncapped_consumption.sql
SELECT pg_temp.check((SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid=(SELECT oid FROM uncapped_metadata))=(SELECT metadata FROM uncapped_metadata)
 AND (SELECT count(*) FROM public.team_hub_agent_turns)=(SELECT turns FROM uncapped_replay)
 AND (SELECT count(*) FROM public.team_hub_messages)=(SELECT messages FROM uncapped_replay),
 'uncapped: exact replay preserves metadata and creates no turn/message');

CREATE FUNCTION pg_temp.uncapped_repeat(tenant text,actor text,channel text,source text,turn_id text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE r jsonb; n integer; token text; before_count bigint; q text;
BEGIN
 SELECT count(*) INTO before_count FROM public.team_hub_agent_turns;
 r:=pg_temp.accept(tenant,actor,channel,source,'zion','dm',pg_temp.tok('uncapped-0'));
 PERFORM pg_temp.check(r->>'repeated'='true' AND r->>'turn_id'=turn_id,'uncapped: same invocation repeats same original turn');
 r:=pg_temp.accept(tenant,actor,channel,source,'zion','dm',pg_temp.tok('different-inflight'));
 PERFORM pg_temp.check(r->>'code'='in_flight','uncapped: distinct invocation still waits, never duplicates');
 FOR n IN 1..40 LOOP
  token:=pg_temp.tok('uncapped-'||(n-1));
  r:=pg_temp.j(NULL,format('public.team_hub_end_agent_turn(%L::uuid,%L)',turn_id,pg_temp.h(token)),'service_role');
  PERFORM pg_temp.check(r->>'ok'='true','uncapped: original token ends original turn');
  token:=pg_temp.tok('uncapped-'||n);
  r:=pg_temp.accept(tenant,actor,channel,source,'zion','dm',token);
  PERFORM pg_temp.check(r->>'ok'='true' AND r->>'rearmed'='true' AND r->>'turn_id'=turn_id,'uncapped: rearm stays same operation beyond30');
 END LOOP;
 PERFORM pg_temp.check((SELECT count(*) FROM public.team_hub_agent_turns)=before_count,'uncapped:40 rearms create no second turn');
 r:=pg_temp.j(NULL,format('public.team_hub_end_agent_turn(%L::uuid,%L)',turn_id,pg_temp.h(pg_temp.tok('uncapped-0'))),'service_role');
 PERFORM pg_temp.check(r->>'ok' IS DISTINCT FROM 'true','uncapped: stale token cannot end current invocation');
 FOR n IN 1..40 LOOP
  q:=pg_temp.post(actor,tenant,channel,'Next legitimate ask '||n)#>>'{message,id}';
  r:=pg_temp.accept(tenant,actor,channel,q,'zion','dm',pg_temp.tok('uncapped-distinct-'||n));
  PERFORM pg_temp.check(r->>'ok'='true','uncapped: distinct legitimate asks remain admitted after30');
  r:=pg_temp.j(NULL,format('public.team_hub_end_agent_turn(%L::uuid,%L)',r->>'turn_id',pg_temp.h(pg_temp.tok('uncapped-distinct-'||n))),'service_role');
  PERFORM pg_temp.check(r->>'ok'='true','uncapped: synthetic invocation ends without fabricated agent output');
 END LOOP;
END $$;
SELECT pg_temp.uncapped_repeat(:'ta',:'u5',:'z5dm',:'uq',(:'ua')::jsonb->>'turn_id');
SELECT pg_temp.check(NOT has_function_privilege('authenticated','public.team_hub_accept_agent_turn(uuid,uuid,uuid,uuid,text,text,text)','EXECUTE')
 AND NOT has_function_privilege('anon','public.team_hub_accept_agent_turn(uuid,uuid,uuid,uuid,text,text,text)','EXECUTE'),
 'uncapped: native service-only admission is unchanged');
SELECT pg_temp.check(pg_temp.accept(:'tb',:'u5',:'z5dm',:'uq','zion','dm',pg_temp.tok('wrong-tenant'))->>'ok' IS DISTINCT FROM 'true'
 AND pg_temp.accept(:'ta',:'u2',:'z5dm',:'uq','zion','dm',pg_temp.tok('wrong-actor'))->>'ok' IS DISTINCT FROM 'true',
 'uncapped: tenant/asker/source/DM gates still refuse');
BEGIN;
UPDATE public.tenant_members SET status='suspended' WHERE tenant_id=:'ta'::uuid AND user_id=:'u5'::uuid;
SELECT pg_temp.check(pg_temp.accept(:'ta',:'u5',:'z5dm',:'uq','zion','dm',pg_temp.tok('revoked'))->>'ok' IS DISTINCT FROM 'true',
 'uncapped: suspended actor cannot use the old conversation');
ROLLBACK;
-- Execute the ACTUAL migration guard, not a second copy of its policy.
\set uncappedguardsql `sed -n '/^DO \$uncapped\$/,/^END \$uncapped\$;/p' supabase/migrations/20271126110008_exp08_team_hub_uncapped_consumption.sql`
CREATE FUNCTION pg_temp.uncapped_drift(guard text) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE target regprocedure:='public.team_hub_accept_agent_turn(uuid,uuid,uuid,uuid,text,text,text)'::regprocedure;
 definition text:=pg_get_functiondef(target); mutation text; answer text; before text; count integer:=0;
 actor_definition text:=pg_get_functiondef('public._team_hub_refusal(uuid)'::regprocedure);
BEGIN
 FOREACH mutation IN ARRAY ARRAY[
  replace(definition,'BEGIN',E'BEGIN\n PERFORM 1;'),
  replace(definition,'exp08_uncapped_consumption_v1:','exp08_uncapped_consumption_v1 partial:'),
  'GRANT EXECUTE ON FUNCTION public.team_hub_accept_agent_turn(uuid,uuid,uuid,uuid,text,text,text) TO authenticated',
  'REVOKE EXECUTE ON FUNCTION public.team_hub_accept_agent_turn(uuid,uuid,uuid,uuid,text,text,text) FROM service_role',
  'GRANT EXECUTE ON FUNCTION public.team_hub_accept_agent_turn(uuid,uuid,uuid,uuid,text,text,text) TO service_role WITH GRANT OPTION',
  'ALTER FUNCTION public.team_hub_accept_agent_turn(uuid,uuid,uuid,uuid,text,text,text) OWNER TO service_role',
  'ALTER FUNCTION public.team_hub_accept_agent_turn(uuid,uuid,uuid,uuid,text,text,text) SECURITY INVOKER',
  'ALTER FUNCTION public.team_hub_accept_agent_turn(uuid,uuid,uuid,uuid,text,text,text) SET search_path=public',
  'ALTER FUNCTION public.team_hub_accept_agent_turn(uuid,uuid,uuid,uuid,text,text,text) STABLE',
  'ALTER FUNCTION public.team_hub_accept_agent_turn(uuid,uuid,uuid,uuid,text,text,text) STRICT',
  'ALTER FUNCTION public.team_hub_accept_agent_turn(uuid,uuid,uuid,uuid,text,text,text) PARALLEL SAFE'
 ] LOOP
  PERFORM pg_temp.check(mutation IS NOT NULL,'uncapped: mutation exists');
  EXECUTE mutation;before:=pg_get_functiondef(target);answer:=pg_temp.try(guard);
  PERFORM pg_temp.check(answer LIKE 'EXP08 uncapped %','uncapped: unknown source/metadata must refuse: '||coalesce(answer,'null'));
  PERFORM pg_temp.check(pg_get_functiondef(target)=before,'uncapped: refusal must preserve unknown implementation');
  ALTER FUNCTION public.team_hub_accept_agent_turn(uuid,uuid,uuid,uuid,text,text,text) OWNER TO postgres;
  EXECUTE definition;
  REVOKE ALL ON FUNCTION public.team_hub_accept_agent_turn(uuid,uuid,uuid,uuid,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
  GRANT EXECUTE ON FUNCTION public.team_hub_accept_agent_turn(uuid,uuid,uuid,uuid,text,text,text) TO service_role;
  count:=count+1;
 END LOOP;
 EXECUTE replace(actor_definition,'BEGIN',E'BEGIN\n PERFORM 1;');
 answer:=pg_temp.try(guard);
 PERFORM pg_temp.check(answer LIKE 'EXP08 uncapped %','uncapped: unknown current-actor prerequisite refuses');
 EXECUTE actor_definition;count:=count+1;
 ALTER FUNCTION public._team_hub_refusal(uuid) STRICT;
 answer:=pg_temp.try(guard);
 PERFORM pg_temp.check(answer LIKE 'EXP08 uncapped %','uncapped: strict actor prerequisite refuses');
 EXECUTE actor_definition;count:=count+1;
 PERFORM pg_temp.check(pg_temp.try(guard)='ran','uncapped: exact restored source replays');
 RETURN count;
END $$;
SELECT pg_temp.check(pg_temp.uncapped_drift(:'uncappedguardsql')=13,'uncapped:13 actual source/metadata/prerequisite drift controls refuse');
SELECT pg_temp.check((SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid=(SELECT oid FROM uncapped_metadata))=(SELECT metadata FROM uncapped_metadata),
 'uncapped: final original metadata conserved after controls');
\o
SELECT md5(prosrc) AS uncapped_accept_body FROM pg_proc WHERE oid=(SELECT oid FROM uncapped_metadata);
\o /dev/null
\echo 'PASS: uncapped native admission,40same-operation rearms,40distinct asks, replay, duplicate/inflight/stale-token/tenant/actor/suspension/ACL negatives; no model or billing proof'
