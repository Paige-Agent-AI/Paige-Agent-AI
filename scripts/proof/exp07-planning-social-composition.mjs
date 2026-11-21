// TEST COMPOSITION ONLY. The original E05 localhost harness owns the one
// transaction/rollback. This module opens no connection and changes no carrier.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {planningHistorySource} from './exp07-planning-history-source.mjs';
const md5=s=>createHash('md5').update(s).digest('hex');
function body(source,name,expected){
 const matches=[...source.matchAll(new RegExp('CREATE OR REPLACE FUNCTION public\\.'+name+'\\([\\s\\S]*?AS (\\$\\w*\\$)([\\s\\S]*?)\\1','g'))];
 assert.equal(matches.length,1,'One exact original function: '+name);
 assert.equal(md5(matches[0][2]),expected,'Complete immutable native source: '+name);
 return matches[0][2];
}
export function socialPlanningComposition(repo){
 const read=p=>readFileSync(join(repo,p),'utf8').replace(/\r\n/g,'\n');
 const social=existsSync(join(repo,'supabase/migrations/20271133000034_exp07_media_snapshot_receipt_compatibility.sql'));
 const carrier=social?read('supabase/migrations/20271133000034_exp07_media_snapshot_receipt_compatibility.sql'):null;
 const history=planningHistorySource(repo);
 const pairs=social?[
  ['public._team_hub_assert_agent_read_scope(public.team_hub_agent_turns)','_team_hub_assert_agent_read_scope',
   body(read('supabase/tests/fixtures/exp07-social-card-foundation.sql'),'_team_hub_assert_agent_read_scope','5545c370d54a7baef54ba37f9619e729'),
   body(carrier,'_team_hub_assert_agent_read_scope','da16cf7c4a5341338b16a010fdfcc605'),"ARRAY['postgres=X/postgres']",'void','v'],
  ['public.team_hub_post_agent_message(uuid,uuid,text,text,uuid,uuid,uuid,text,text,boolean,uuid,text,jsonb,text)','team_hub_post_agent_message',
   body(read('supabase/migrations/20271126020008_exp08_team_hub_a2b_cards.sql'),'team_hub_post_agent_message','bd0e68f3c3e88976786d716dc4a870a6'),
   body(carrier,'team_hub_post_agent_message','fb04b67134a1323117836978a66c0bfa'),"ARRAY['authenticated=X/postgres','postgres=X/postgres']",'jsonb','v']
 ]:[];
 pairs.push([history.sig,'_team_hub_planning_read_annotations',history.original,history.current,"ARRAY['postgres=X/postgres']",'jsonb','s']);
 const sourceLiterals=[];
 const values=pairs.map(([sig,name,old,current,acl,returns,volatility])=>{
  assert(!old.includes('$e07_old$')&&!current.includes('$e07_current$'));
  sourceLiterals.push(`$e07_old$${old}$e07_old$`,`$e07_current$${current}$e07_current$`);
  return `('${sig}',$e07_old$${old}$e07_old$,$e07_current$${current}$e07_current$,${acl},'${returns}','${volatility}')`;
 }).join(',\n');
 const rewind=`CREATE FUNCTION pg_temp.exp07_social_catalog_row(p pg_proc) RETURNS jsonb LANGUAGE sql AS $$
 SELECT CASE WHEN p.oid='public.team_hub_post_agent_message(uuid,uuid,text,text,uuid,uuid,uuid,text,text,boolean,uuid,text,jsonb,text)'::regprocedure
 THEN jsonb_set(to_jsonb(p),'{proargdefaults}',to_jsonb(regexp_replace(p.proargdefaults::text,':location -?[0-9]+',':location -1','g')))
 ELSE to_jsonb(p) END $$;
CREATE TEMP TABLE exp07_social_entry AS SELECT oid,pg_temp.exp07_social_catalog_row(p) full_metadata,
 pg_get_functiondef(oid) definition FROM pg_proc p WHERE pronamespace='public'::regnamespace;
DO $e07_rewind$
DECLARE sig text; previous text; current text; expected_acl text[]; expected_return text; expected_volatility text; p pg_proc; original_metadata jsonb;
BEGIN
 FOR sig,previous,current,expected_acl,expected_return,expected_volatility IN SELECT * FROM (VALUES ${values}) v(sig,previous,current,acl,returns,volatility) LOOP
  SELECT * INTO p FROM pg_proc WHERE oid=to_regprocedure(sig);
  IF NOT FOUND OR p.prosrc IS DISTINCT FROM current OR p.proowner<>'postgres'::regrole
   OR NOT p.prosecdef OR p.provolatile::text<>expected_volatility OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
   OR p.prokind<>'f' OR p.proretset OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u' OR p.provariadic<>0
   OR p.prolang<>(SELECT oid FROM pg_language WHERE lanname='plpgsql') OR p.prorettype<>expected_return::regtype
   OR (SELECT array_agg(a::text ORDER BY a::text) FROM unnest(p.proacl) a) IS DISTINCT FROM expected_acl
   OR (sig<>'public.team_hub_post_agent_message(uuid,uuid,text,text,uuid,uuid,uuid,text,text,boolean,uuid,text,jsonb,text)' AND
    (p.pronargdefaults<>0 OR p.proargnames IS DISTINCT FROM ARRAY['t']::text[] OR p.proargmodes IS NOT NULL))
   OR (sig='public.team_hub_post_agent_message(uuid,uuid,text,text,uuid,uuid,uuid,text,text,boolean,uuid,text,jsonb,text)' AND
    (p.pronargdefaults<>5 OR pg_get_expr(p.proargdefaults,0) IS DISTINCT FROM 'false, NULL::uuid, NULL::text, NULL::jsonb, NULL::text')) THEN
   RAISE EXCEPTION 'EXP07 exact Social test preimage/metadata is not installed: %',sig; END IF;
  original_metadata:=pg_temp.exp07_social_catalog_row(p)-'prosrc';
  EXECUTE replace(pg_get_functiondef(p.oid),p.prosrc,previous);
  IF original_metadata IS DISTINCT FROM (SELECT pg_temp.exp07_social_catalog_row(q)-'prosrc' FROM pg_proc q WHERE q.oid=p.oid) THEN
   RAISE EXCEPTION 'EXP07 Social proof inverse changed native metadata: %',sig; END IF;
 END LOOP;
END $e07_rewind$;
SELECT ok(NOT EXISTS(SELECT 1 FROM exp07_social_entry b FULL JOIN pg_proc p USING(oid)
 WHERE (b.oid IS NOT NULL OR p.pronamespace='public'::regnamespace) AND (b.full_metadata-'prosrc' IS DISTINCT FROM pg_temp.exp07_social_catalog_row(p)-'prosrc'
  OR (b.full_metadata->>'prosrc' IS DISTINCT FROM p.prosrc AND p.oid NOT IN (${pairs.map(([sig])=>`'${sig}'::regprocedure`).join(',')})))),
 'Exact ${pairs.length}-body Social/Planning test inverse preserves every other source and complete ABI/default/owner/ACL/config');
`;
 const restore=`DO $e07_restore$
DECLARE r record;
BEGIN
 FOR r IN SELECT * FROM exp07_social_entry WHERE oid=ANY(ARRAY[
 ${pairs.map(([sig])=>`'${sig}'::regprocedure`).join(',\n ')}]) LOOP
  EXECUTE r.definition;
 END LOOP;
END $e07_restore$;
SELECT ok(NOT EXISTS(SELECT 1 FROM exp07_social_entry b FULL JOIN pg_proc p USING(oid)
 WHERE (b.oid IS NOT NULL OR p.pronamespace='public'::regnamespace) AND b.full_metadata IS DISTINCT FROM pg_temp.exp07_social_catalog_row(p)),
 'Restored current Social/Planning full catalog source/OID/ABI/default/owner/ACL/config exactly');
`;
 assert(!/^BEGIN;|^COMMIT;|^ROLLBACK;/m.test(rewind+restore));
 return {rewind,restore,sourceLiterals};
}
