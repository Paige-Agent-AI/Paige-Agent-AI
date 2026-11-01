// INERT release-artifact composition only. No database connection or activation.
// Original component SQL/writers remain authoritative; one outer transaction.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const digest=(kind,value)=>createHash(kind).update(value).digest('hex');
const quote=s=>"'"+s.replaceAll("'","''")+"'";
const names=['exp08-owner-recovery-provenance.sql','exp08-owner-recovery-writers.sql',
 'exp02-billing-recovery.sql','exp08-owner-recovery-revoke.sql','exp08-owner-recovery-doors.sql'];
function read(name){const bytes=readFileSync(new URL('./'+name,import.meta.url));return {name,sha256:digest('sha256',bytes),sql:bytes.toString('utf8').replace(/\r\n/g,'\n')};}
function unwrap(part){
 const starts=[...part.sql.matchAll(/^BEGIN;$/gm)],ends=[...part.sql.matchAll(/^COMMIT;$/gm)];
 if(part.name==='exp08-owner-recovery-writers.sql'){
  assert.equal(starts.length,0);assert.equal(ends.length,0);return part.sql;
 }
 assert.equal(starts.length,1,part.name+' outer BEGIN');assert.equal(ends.length,1,part.name+' outer COMMIT');
 assert.match(part.sql.slice(0,starts[0].index),/^(?:\s|--[^\n]*\n)*$/);
 assert.equal(part.sql.slice(ends[0].index+'COMMIT;'.length).trim(),'');
 return part.sql.slice(0,starts[0].index)+part.sql.slice(starts[0].index+'BEGIN;'.length,ends[0].index);
}
export function buildOwnerRecoveryBundle(){
 const parts=names.map(read);
 // Received original E02 producer, byte-identical; reconcile with its owner if it changes.
 assert.equal(parts[2].sha256,'b2638ef3001dc5bcbea5a418fd9cf9bae046b9c2f00b8685fc26018b39e9cdb3','Original E02 component changed: renew receiving contract');
 const base=parts[1].sql,specs=[];
 const header=/^CREATE OR REPLACE FUNCTION public\.(_exp08_[a-z_]+)\(([\s\S]*?)\)\s*RETURNS (uuid|void|jsonb) LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''\s*AS \$function\$/gm;
 for(const m of base.matchAll(header)){
  const end=base.indexOf('$function$;',m.index+m[0].length);assert.ok(end>=0,m[1]);
  const args=m[2].trim()?m[2].trim().split(',').map(x=>x.trim()):[];
  for(const a of args)assert.match(a,/^_[a-z_]+\s+(?:uuid|text|boolean)$/);
  specs.push({signature:`public.${m[1]}(${args.map(a=>a.split(/\s+/)[1]).join(',')})`,
   names:args.map(a=>a.split(/\s+/)[0]),result:m[3],hash:digest('md5',base.slice(m.index+m[0].length,end))});
 }
 assert.equal(specs.length,11,'All original statically declared private helpers must be admitted');
 assert.equal(new Set(specs.map(s=>s.signature)).size,11);
 const values=specs.map(s=>`(${quote(s.signature)},${quote(s.hash)},${quote(s.result)},${s.names.length?'ARRAY['+s.names.map(quote).join(',')+']':'NULL::text[]'})`).join(',\n');
 const allSignatures=[...specs.map(s=>s.signature),'public._exp08_grant_co_owner(uuid,uuid,boolean)','public._exp08_revoke_co_owner(uuid,uuid,uuid)',
  'public.grant_co_owner(uuid,uuid)','public.revoke_co_owner(uuid,uuid)'];
 const ownedNames=allSignatures.map(s=>s.slice('public.'.length,s.indexOf('(')));
 const preflight=`DO $exp08_bundle_preflight$
DECLARE s record; p pg_proc; present integer:=0; kernels integer; doors integer;
BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'EXP08 recovery bundle requires postgres';END IF;
 IF EXISTS(SELECT 1 FROM pg_proc f JOIN pg_namespace n ON n.oid=f.pronamespace
  WHERE n.nspname='public' AND f.proname=ANY(ARRAY[${ownedNames.map(quote).join(',')}])
   AND NOT (f.oid::regprocedure=ANY(array_remove(ARRAY[${allSignatures.map(s=>'to_regprocedure('+quote(s)+')').join(',')}],NULL)))) THEN
  RAISE EXCEPTION 'EXP08 recovery bundle unsupported original/private overload';
 END IF;
 FOR s IN SELECT * FROM (VALUES ${values}) v(signature,body_hash,result_type,argument_names) LOOP
  SELECT * INTO p FROM pg_proc WHERE oid=to_regprocedure(s.signature);
  IF FOUND THEN
   present:=present+1;
   IF md5(p.prosrc)<>s.body_hash OR p.proowner<>'postgres'::regrole OR NOT p.prosecdef
    OR p.prokind<>'f' OR p.prolang<>(SELECT oid FROM pg_language WHERE lanname='plpgsql')
    OR p.provolatile<>'v' OR p.prorettype IS DISTINCT FROM to_regtype(s.result_type)
    OR p.proretset OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u'
    OR p.prosupport<>0 OR p.probin IS NOT NULL OR p.prosqlbody IS NOT NULL
    OR p.proargnames IS DISTINCT FROM s.argument_names OR p.proallargtypes IS NOT NULL OR p.proargmodes IS NOT NULL
    OR p.pronargdefaults<>0 OR p.proargdefaults IS NOT NULL OR p.provariadic<>0 OR p.procost<>100 OR p.prorows<>0
    OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
    OR EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      WHERE a.grantee<>p.proowner OR a.privilege_type<>'EXECUTE' OR a.is_grantable) THEN
     RAISE EXCEPTION 'EXP08 recovery bundle preflight drift: %',s.signature;
   END IF;
  END IF;
 END LOOP;
 -- The two kernels retain original search_path/ABI and are conserved by their
 -- component guards. Validate their complete execution metadata before any DDL,
 -- alongside the original public owner doors whose OID/ACL must be preserved.
 FOR s IN SELECT * FROM (VALUES
  ('public.grant_co_owner(uuid,uuid)',ARRAY['_tenant','_user'],false),
  ('public.revoke_co_owner(uuid,uuid)',ARRAY['_tenant','_user'],false),
  ('public._exp08_grant_co_owner(uuid,uuid,boolean)',ARRAY['_tenant','_user','_recovery'],true),
  ('public._exp08_revoke_co_owner(uuid,uuid,uuid)',ARRAY['_tenant','_user','_recovery_request'],true)
 ) v(signature,argument_names,is_private) LOOP
  SELECT * INTO p FROM pg_proc WHERE oid=to_regprocedure(s.signature);
  IF NOT FOUND THEN
   IF NOT s.is_private THEN RAISE EXCEPTION 'EXP08 recovery bundle original owner door missing: %',s.signature;END IF;
   CONTINUE;
  END IF;
  IF p.proowner<>'postgres'::regrole OR NOT p.prosecdef OR p.prokind<>'f'
   OR p.prolang<>(SELECT oid FROM pg_language WHERE lanname='plpgsql') OR p.provolatile<>'v' OR p.prorettype<>'void'::regtype
   OR p.proretset OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u' OR p.prosupport<>0
   OR p.probin IS NOT NULL OR p.prosqlbody IS NOT NULL OR p.proargnames IS DISTINCT FROM s.argument_names
   OR p.proallargtypes IS NOT NULL OR p.proargmodes IS NOT NULL OR p.pronargdefaults<>0 OR p.proargdefaults IS NOT NULL
   OR p.provariadic<>0 OR p.procost<>100 OR p.prorows<>0 OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public']::text[]
   OR EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    WHERE NOT(a.grantee=ANY(CASE WHEN s.is_private THEN ARRAY[p.proowner] ELSE ARRAY[p.proowner,'authenticated'::regrole,'service_role'::regrole] END))
     OR a.privilege_type<>'EXECUTE' OR a.is_grantable)
   OR (NOT s.is_private AND (NOT has_function_privilege('authenticated',p.oid,'EXECUTE') OR NOT has_function_privilege('service_role',p.oid,'EXECUTE'))) THEN
    RAISE EXCEPTION 'EXP08 recovery bundle original/kernel metadata drift: %',s.signature;
  END IF;
 END LOOP;
 SELECT count(*) INTO kernels FROM pg_proc WHERE oid IN(
  to_regprocedure('public._exp08_grant_co_owner(uuid,uuid,boolean)'),to_regprocedure('public._exp08_revoke_co_owner(uuid,uuid,uuid)'));
 SELECT count(*) INTO doors FROM pg_proc f JOIN pg_namespace n ON n.oid=f.pronamespace
  WHERE n.nspname='public' AND f.proname IN('platform_owner_recovery','platform_owner_recovery_receipt','get_owner_recovery_notice');
 IF NOT ((present=0 AND kernels=0 AND doors=0) OR (present=11 AND kernels=2 AND doors=4)) THEN
  RAISE EXCEPTION 'EXP08 recovery bundle partial installation: reconcile before changing source';
 END IF;
END $exp08_bundle_preflight$;`;
 const sql='-- INERT compiled original recovery bundle; not a versioned migration or activation.\nBEGIN;\nSET LOCAL lock_timeout=\'2s\';\nSET LOCAL search_path=pg_catalog;\n'+preflight+'\n'+parts.map(p=>'-- ORIGINAL COMPONENT '+p.name+' SHA256 '+p.sha256+'\n'+unwrap(p)).join('\n')+'\nCOMMIT;\n';
 assert.equal([...sql.matchAll(/^BEGIN;$/gm)].length,1);assert.equal([...sql.matchAll(/^COMMIT;$/gm)].length,1);
 return {sql,sources:parts.map(({name,sha256})=>({name,sha256})),privateSpecifications:specs};
}
