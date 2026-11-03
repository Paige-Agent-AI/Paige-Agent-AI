import { readFileSync,writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const path='scripts/proof/exp01-reviewed-setup-candidate.sql',source=readFileSync(path,'utf8').replaceAll('\r\n','\n');
const signatures=[
 ['lock_solo_reviewed_setup_scope','uuid,uuid',false,[]],
 ['lock_solo_reviewed_setup_facts','uuid,uuid,jsonb',false,[]],
 ['stage_solo_reviewed_business_facts','uuid,uuid,uuid,text,bigint,jsonb',true,['authenticated']],
 ['inspect_solo_reviewed_business_facts','uuid,uuid,uuid',true,['authenticated']],
 ['save_solo_reviewed_business_facts','uuid,uuid,uuid,uuid,text,bigint,jsonb,text',true,['authenticated']],
 ['read_solo_reviewed_business_facts','uuid,uuid',true,['authenticated']],
];
const rows=signatures.map(([name,args,definer,grantees])=>{
 const start=new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\(`).exec(source);assert.ok(start);
 const tail=source.slice(start.index),delimiter=/\bAS (\$\w+\$)/.exec(tail);assert.ok(delimiter);
 const begin=delimiter.index+delimiter[0].length,end=tail.indexOf(delimiter[1],begin);assert.ok(end>begin);
 const hash=createHash('md5').update(tail.slice(begin,end)).digest('hex');
 return `  ('public.${name}(${args})','${hash}',${definer},ARRAY[${grantees.map(x=>`'${x}'`).join(',')}]::text[])`;
});
const guard=`DO $owned_existing$
DECLARE expected record; f record; installed integer:=0;
BEGIN
 FOR expected IN SELECT * FROM (VALUES
${rows.join(',\n')}
 ) v(signature,body_hash,definer,grantees) LOOP
  SELECT * INTO f FROM pg_proc WHERE oid=to_regprocedure(expected.signature);
  IF NOT FOUND THEN CONTINUE; END IF;
  installed:=installed+1;
  IF md5(f.prosrc)<>expected.body_hash OR f.proowner<>current_user::regrole
   OR f.prolang<>(SELECT oid FROM pg_language WHERE lanname='plpgsql') OR f.prokind<>'f'
   OR f.provolatile<>'v' OR f.proparallel<>'u' OR f.prorettype<>'jsonb'::regtype
   OR f.proretset OR f.proisstrict OR f.proleakproof OR f.pronargdefaults<>0
   OR f.prosecdef IS DISTINCT FROM expected.definer OR f.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
   OR EXISTS(SELECT 1 FROM unnest(expected.grantees) r WHERE NOT has_function_privilege(r,f.oid,'EXECUTE'))
   OR EXISTS(SELECT 1 FROM aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a
    WHERE a.privilege_type<>'EXECUTE' OR a.grantor<>f.proowner
    OR (a.grantee<>f.proowner AND NOT EXISTS(SELECT 1 FROM unnest(expected.grantees) r WHERE a.grantee=r::regrole::oid))
    OR (a.grantee<>f.proowner AND a.is_grantable)) THEN
   RAISE EXCEPTION 'SETUP_REVIEW_INSTALLED_DRIFT';
  END IF;
 END LOOP;
 IF installed NOT IN (0,6) THEN RAISE EXCEPTION 'SETUP_REVIEW_PARTIAL_INSTALL'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='public.paige_audit_log'::regclass AND relrowsecurity) THEN
  RAISE EXCEPTION 'SETUP_REVIEW_AUDIT_DRIFT'; END IF;
 IF (SELECT count(*) FROM pg_policy WHERE polrelid='public.paige_audit_log'::regclass
  AND polname='exp01_reviewed_facts_server_events')<>(CASE WHEN installed=0 THEN 0 ELSE 1 END) THEN
  RAISE EXCEPTION 'SETUP_REVIEW_PARTIAL_INSTALL'; END IF;
 IF EXISTS(SELECT 1 FROM pg_policy WHERE polrelid='public.paige_audit_log'::regclass AND polname='exp01_reviewed_facts_server_events'
  AND (polpermissive OR polcmd<>'a' OR polroles IS DISTINCT FROM ARRAY['authenticated'::regrole::oid]
   OR polqual IS NOT NULL OR pg_get_expr(polwithcheck,polrelid) IS DISTINCT FROM
   '(action <> ALL (ARRAY[''solo_setup.reviewed_facts_staged''::text, ''solo_setup.reviewed_facts_approved''::text]))')) THEN
  RAISE EXCEPTION 'SETUP_REVIEW_AUDIT_DRIFT'; END IF;
 IF EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.tenant_setup_business_context_meta'::regclass
  AND attname IN ('reviewed_fact_proposal','reviewed_fact_approval') AND NOT attisdropped
  AND (atttypid<>'jsonb'::regtype OR attnotnull OR atthasdef)) THEN
  RAISE EXCEPTION 'SETUP_REVIEW_COLUMN_DRIFT'; END IF;
 IF (SELECT count(*) FROM pg_attribute WHERE attrelid='public.tenant_setup_business_context_meta'::regclass
   AND attname IN ('reviewed_fact_proposal','reviewed_fact_approval') AND NOT attisdropped)
   IS DISTINCT FROM (CASE WHEN installed=0 THEN 0 ELSE 2 END) THEN
  RAISE EXCEPTION 'SETUP_REVIEW_PARTIAL_INSTALL'; END IF;
END $owned_existing$;`;
const begin='-- E01_OWNED_INSTALL_GUARD_BEGIN',end='-- E01_OWNED_INSTALL_GUARD_END';
assert.equal(source.split(begin).length,2);assert.equal(source.split(end).length,2);
const result=source.slice(0,source.indexOf(begin)+begin.length)+'\n'+guard+'\n'+source.slice(source.indexOf(end));
if(process.argv.includes('--check'))assert.equal(result,source,'native source guard must match exact current bodies');
else writeFileSync(path,result);
console.log('Exact six-function install/replay guard '+(process.argv.includes('--check')?'PASS':'generated'));
