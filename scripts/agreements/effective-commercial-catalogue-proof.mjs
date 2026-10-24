import assert from 'node:assert/strict';

/** Reuse the directory-fenced original Agreements DB. Actual original catalogue
 * base and latest additive wrapper, with existing synthetic Auth stand-ins.
 * Other historical rows are additionally covered by the unchanged full-chain
 * catalogue guard; this is not actual hosted authorization/customer acceptance. */
export function proveEffectiveCommercialCatalogue({sql,read,tenant,actor}){
 let checks=0;
 const equal=(actual,expected,why)=>{assert.deepEqual(actual,expected,why);checks++;};
 const source='supabase/migrations/20271113830004_e04_effective_terms_catalogue.sql';
 const original=read('supabase/migrations/20271112130000_experience05_confirmed_weekly_draft.sql');
 const start=original.indexOf('-- Extend the incumbent Settings catalogue;');
 const end=original.indexOf("DO $$ BEGIN\n  IF to_regprocedure('public._workspace_event_display_before_weekly_draft",start);
 assert(start>=0&&end>start,'Exact original catalogue section');
 sql(read('supabase/migrations/20261020300000_tool_autonomy_catalogue_covers_the_gate.sql'));
 sql(original.slice(start,end));
 const scope=`SET test.uid='${actor}';SET test.tenant='${tenant}';SET test.owner='false';`;
 const key='sales_effectuate_commercial_terms',foreign='bbbbbbbb-0000-4000-8000-000000000002';
 const rows=(prefix=scope,requested='NULL')=>JSON.parse(sql(prefix+`SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY tool_key),'[]') FROM list_tool_autonomy(${requested}) c;`));
 const before=rows();
 equal(before.some(row=>row.tool_key===key),false,'Original catalogue genuinely lacks the new classified action');
 assert(before.length>=40,'Positive original catalogue control');checks++;
 const originalDefinition=sql("SELECT pg_get_functiondef('list_tool_autonomy(uuid)'::regprocedure);");
 const grantsBefore=sql("SELECT proacl::text FROM pg_proc WHERE oid='list_tool_autonomy(uuid)'::regprocedure;");
 const modesBefore=sql('SELECT count(*) FROM tenant_tool_autonomy;');
 sql(read(source));sql(read(source));
 equal(rows().filter(row=>row.tool_key!==key),before,'Every original row/mode survives migration and replay');
 equal(rows().filter(row=>row.tool_key===key),[{tool_key:key,label:'Make accepted commercial terms effective',category:'Payments',mode:'confirm',is_default:true,updated_at:null}],'Missing override remains confirm; no grant written');
 equal(sql('SELECT count(*) FROM tenant_tool_autonomy;'),modesBefore,'Catalogue installation creates no standing grant');
 const retained=sql("SELECT pg_get_functiondef('_list_tool_autonomy_before_e04_effectuation(uuid)'::regprocedure);");
 equal(retained,originalDefinition.replace('public.list_tool_autonomy(', 'public._list_tool_autonomy_before_e04_effectuation('),'Incumbent body/identity metadata retained by rename');
 equal(sql("SELECT proacl::text FROM pg_proc WHERE oid='list_tool_autonomy(uuid)'::regprocedure;"),grantsBefore,'Public callable grant posture unchanged');
 const metadata=JSON.parse(sql("SELECT jsonb_build_object('definer',prosecdef,'volatility',provolatile,'config',proconfig,'defaults',pronargdefaults,'result',pg_get_function_result(oid)) FROM pg_proc WHERE oid='list_tool_autonomy(uuid)'::regprocedure;"));
 equal(metadata,{definer:true,volatility:'s',config:['search_path=pg_catalog, public'],defaults:1,result:'TABLE(tool_key text, label text, category text, mode text, is_default boolean, updated_at timestamp with time zone)'},'Closed ABI and pinned stable definer metadata');
 for(const role of ['anon','authenticated','service_role']){
  equal(sql(`SELECT has_function_privilege('${role}','_list_tool_autonomy_before_e04_effectuation(uuid)','EXECUTE');`),'f','Private predecessor cannot become a second callable door');
 }
 equal(sql("SELECT has_function_privilege('anon','list_tool_autonomy(uuid)','EXECUTE');"),'f','Anonymous public call stays denied');
 for(const role of ['authenticated','service_role'])equal(sql(`SELECT has_function_privilege('${role}','list_tool_autonomy(uuid)','EXECUTE');`),'t','Original public callers retained');
 assert.throws(()=>rows(scope+"SET ROLE authenticated;",`'${foreign}'`),/AUTONOMY_FORBIDDEN: tenant mismatch/);checks++;
 equal(rows(scope+'SET ROLE authenticated;').filter(row=>row.tool_key!==key),before,'Ordinary original caller retains original rows');
 const stamp='2026-10-24T00:00:00+00:00';
 for(const mode of ['off','auto','confirm']){
  sql(`INSERT INTO tenant_tool_autonomy VALUES('${tenant}','${key}','${mode}','${stamp}');`);
  const row=rows(scope+'SET ROLE authenticated;').find(row=>row.tool_key===key);
  equal([row.mode,row.is_default],[mode,false],'Report the stored original mode without rewriting or granting');
  equal(Date.parse(row.updated_at),Date.parse(stamp),'Preserve the stored timestamp instant across native session time-zone formatting');
  sql(`DELETE FROM tenant_tool_autonomy WHERE tenant_id='${tenant}' AND tool_key='${key}';`);
 }
 sql(`INSERT INTO tenant_tool_autonomy VALUES('${foreign}','${key}','off','${stamp}');`);
 equal(rows().find(row=>row.tool_key===key).mode,'confirm','Other tenant mode never leaks into current tenant');
 equal(rows(scope+"SET test.owner='true';",`'${foreign}'`).find(row=>row.tool_key===key).mode,'off','Original platform-owner explicit-tenant semantics preserved in synthetic proof');
 equal(rows("SET test.uid='';SET ROLE service_role;",`'${foreign}'`).find(row=>row.tool_key===key).mode,'off','Original service-role requested-tenant semantics retained');
 sql(`DELETE FROM tenant_tool_autonomy WHERE tenant_id='${foreign}' AND tool_key='${key}';`);
 equal(sql('SELECT count(*) FROM tenant_tool_autonomy;'),modesBefore,'Synthetic mode controls cleaned up, no lasting grants');
 return {checks,migrationReplay:2,originalRows:before.length,scope:'Actual native catalogue source with synthetic Auth; no hosted/customer/admission or business action proof'};
}
