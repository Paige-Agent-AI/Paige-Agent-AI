import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
// Original catalogue bodies and native metadata only; no simulated caller permission,
// original inherited catalogue execution, provider or customer acceptance.
export function proveFinancialCatalogue({run,read}){
 let checks=0;const check=(name,value)=>{assert(value,name);checks++;console.log('FINANCIAL CATALOGUE PASS '+name);};
 const original=read('supabase/migrations/20271121150000_growth_hosted_deployments.sql');
 const start=original.indexOf('CREATE OR REPLACE FUNCTION public.list_tool_autonomy(');
 const tail=original.slice(start),end=tail.indexOf('END $$;')+'END $$;'.length;assert(start>=0&&end>20);
 run(tail.slice(0,end)+"REVOKE ALL ON FUNCTION public.list_tool_autonomy(uuid) FROM PUBLIC,anon;GRANT EXECUTE ON FUNCTION public.list_tool_autonomy(uuid) TO authenticated,service_role;");
 const value=sql=>JSON.parse(run(sql).split(/\r?\n/).filter(x=>x.startsWith('{')).at(-1));
 const metadata=name=>value("SELECT to_jsonb(p) FROM pg_catalog.pg_proc p WHERE p.oid='"+name+"(uuid)'::regprocedure;");
 const before=metadata('public.list_tool_autonomy');
 check('original actual production catalogue body is installed byte exactly',createHash('md5').update(before.prosrc).digest('hex')==='54b2e4384bdc39729d5a5e7873dc9939');
 const file='supabase/migrations/20271126210004_e04_financial_review_catalogue.sql',source=read(file);
 const sql=source.replace(/^BEGIN;$/m,'').replace(/^COMMIT;$/m,'');
 run('BEGIN;'+sql+'COMMIT;');
 const current=metadata('public.list_tool_autonomy'),prior=metadata('public._list_tool_autonomy_before_e04_financial_review');
 const omit=(v,keys)=>Object.fromEntries(Object.entries(v).filter(([k])=>!keys.includes(k)));
 check('every original catalogue byte and original OID survive in the private predecessor',prior.oid===before.oid&&prior.prosrc===before.prosrc);
 assert.deepEqual(omit(prior,['proname','proacl']),omit(before,['proname','proacl']));check('all original predecessor metadata and defaults remain exact except its deliberate private name and ACL',true);
 check('private predecessor has only its original owner privilege',JSON.stringify(prior.proacl)===JSON.stringify(['postgres=X/postgres']));
 assert.deepEqual(omit(current,['oid','prosrc']),omit(before,['oid','prosrc']));check('same public signature result owner settings flags defaults and ACL are conserved',true);
 check('public catalogue uses the original inherited predecessor',current.prosrc.includes('RETURN QUERY SELECT * FROM public._list_tool_autonomy_before_e04_financial_review(_tenant_id);'));
 check('one additional exact financial-review row defaults to the existing confirmation mode',(current.prosrc.match(/sales_record_provider_disposition/g)||[]).length===1&&current.prosrc.includes("coalesce(a.mode,'confirm')"));
 check('no autonomy setting or provider/financial writer is called',!/(insert|update|delete)\s+(into|from|public\.)/i.test(current.prosrc)&&!current.prosrc.includes('execute_sales_invoice_command'));
 run('BEGIN;'+sql+'COMMIT;');assert.deepEqual(metadata('public.list_tool_autonomy'),current);assert.deepEqual(metadata('public._list_tool_autonomy_before_e04_financial_review'),prior);check('replay preserves original and current OIDs bodies and all native metadata',true);
 for(const [name,mutation] of [
  ['public strictness','ALTER FUNCTION public.list_tool_autonomy(uuid) STRICT;'],
  ['public volatility','ALTER FUNCTION public.list_tool_autonomy(uuid) VOLATILE;'],
  ['public grant','GRANT EXECUTE ON FUNCTION public.list_tool_autonomy(uuid) TO anon;'],
  ['private grant','GRANT EXECUTE ON FUNCTION public._list_tool_autonomy_before_e04_financial_review(uuid) TO authenticated;'],
  ['private volatility','ALTER FUNCTION public._list_tool_autonomy_before_e04_financial_review(uuid) VOLATILE;'],
  ['private strictness','ALTER FUNCTION public._list_tool_autonomy_before_e04_financial_review(uuid) STRICT;']
 ]){assert.throws(()=>run('BEGIN;'+mutation+sql+'ROLLBACK;'),/catalogue authority changed|predecessor changed/);check(name+' drift refuses adoption',true);}
 assert.deepEqual(metadata('public.list_tool_autonomy'),current);assert.deepEqual(metadata('public._list_tool_autonomy_before_e04_financial_review'),prior);check('all refused adoption attempts roll back without metadata changes',true);
 return{proof:'E04_FINANCIAL_CATALOGUE_SELECTED_NATIVE_METADATA',status:'PASS',checks,originalOid:before.oid,publicOid:current.oid,privateOid:prior.oid,originalBody:createHash('md5').update(prior.prosrc).digest('hex'),currentBody:createHash('md5').update(current.prosrc).digest('hex'),source_hashes:Object.fromEntries([file,'scripts/sql/sales-financial-catalogue-proof.mjs'].map(f=>[f,createHash('sha256').update(read(f)).digest('hex')])),boundary:'Original exact native function metadata, replay and hostile drift only. Inherited catalogue dependencies are not invoked; no authenticated caller, UI/provider/financial action or customer acceptance.'};
}
