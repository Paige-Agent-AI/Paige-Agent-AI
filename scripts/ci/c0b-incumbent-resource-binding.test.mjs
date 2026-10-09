import { test } from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {incumbentSourcePaths,validateIncumbentResourceBindings,matchesIncumbentDeclaration,validateIncumbentDeclarations} from './c0b-incumbent-resource-binding.mjs';
const chat=readFileSync('supabase/functions/paige-ai-chat/index.ts','utf8');
const sources=new Map(incumbentSourcePaths.map(path=>[path,readFileSync(path,'utf8')]));
let actual;
test('all 28 reviewed incumbent adapters bind to real dispatch and dependency source',()=>{
 const result=validateIncumbentResourceBindings(chat,sources);actual=result;assert.deepEqual(result.findings,[]);assert.equal(result.tools.size,28);
});
const mutations=[
 ['caller factory changed',s=>s.replace('createClient(supabaseUrl, supabaseKey, {','createClient(supabaseUrl, supabaseServiceKey, {')],
 ['caller JWT replaced',s=>s.replace("const authHeader = req.headers.get('Authorization');","const authHeader = 'Bearer counterfeit';")],
 ['verified actor removed',s=>s.replace('await supabaseClient.auth.getUser()','({data:{user:{id:"counterfeit"}},error:null})')],
 ['verified actor refusal removed',s=>s.replace('if (authError || !user)', 'if (false)')],
 ['Research actor substituted',s=>s.replace(/user_id: user.id,\r?\n                caller: "chat",/,'user_id: args.user_id,\n                caller: "chat",')],
 ['Research persistence changed',s=>s.replace('persist: true,','persist: false,')],
 ['automation grant broadened',s=>s.replace('granted_lane: "confirm",','granted_lane: "auto",')],
 ['number tenant filter removed',s=>s.replace(/\.eq\("tenant_id", crmTenantId\)\r?\n                \.order\("is_primary"/, '.eq("tenant_id", args.tenant_id)\n                .order("is_primary"')],
 ['provider purchase price removed',s=>s.replace('agreed_monthly_cents: typeof args.monthly_cents === "number" ? args.monthly_cents : undefined,','agreed_monthly_cents: undefined,')],
 ['Knowledge caller bearer changed',s=>s.replace('fetch(`${supabaseUrl}/functions/v1/kb-ingest-doc`','fetch(`${supabaseUrl}/functions/v1/counterfeit-kb`')],
 ['registration falsely submitted',s=>s.replace('submitted: false,','submitted: true,')],
 ['CRM target replaced',s=>{const at=s.indexOf('if (tc.function.name === "update_client_data")');return s.slice(0,at)+s.slice(at).replace('target_user_id: scopedClientId || user.id,','target_user_id: args.target_user_id,');}],
 ['unknown effect in inline read',s=>s.replace(/const projection = await gatherCapabilityProjection\(\);\r?\n              result/, 'await supabase.from("messages").insert({});\n              const projection = await gatherCapabilityProjection();\n              result')],
 ['new interceptor cannot bypass reviewed dispatch',s=>s.replace('if (tc.function.name === "update_client_data") {','if (tc.function.name === "update_client_data") { await fetch("https://counterfeit.invalid"); continue; }\n        if (tc.function.name === "update_client_data") {')],
 ['local actor shadow',s=>s.replace('const dr = await drResp.json();','const user = {id: args.user_id}; const dr = await drResp.json();')],
 ['server persona substituted',s=>s.replace('await supabaseClient.rpc("get_paige_persona_context")','({data:{tenant_id:payload.tenant_id},error:null})')],
 ['focused subject isolation removed',s=>s.replace('rowTenant !== callerTenantId','false')],
 ['authentication implementation replaced before verification',s=>s.replace('const { data: { user }, error: authError } = await supabaseClient.auth.getUser();','supabaseClient.auth.getUser = async () => ({data:{user:{id:"forged"}},error:null});\n    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();')],
];
for(const [label,mutate]of mutations)test(`rejects ${label}`,()=>{const changed=mutate(chat);assert.ok(changed!==chat,'fixture must mutate actual source');assert.ok(validateIncumbentResourceBindings(changed,sources).findings.length);});
test('missing or modified endpoint/helper cannot be accepted',()=>{
 assert.ok(incumbentSourcePaths.length>10);
 const path=incumbentSourcePaths[0];const missing=new Map(sources);missing.delete(path);assert.ok(validateIncumbentResourceBindings(chat,missing).findings.length);
 const changed=new Map(sources);changed.set(path,sources.get(path)+'\nconst counterfeitEffect = () => fetch("https://counterfeit.invalid");');assert.ok(validateIncumbentResourceBindings(chat,changed).findings.length);
});
test('malformed source is refused',()=>assert.ok(validateIncumbentResourceBindings('const broken = ;',sources).findings.length));
for(const [label,mutate]of [
 ['metric caller-JWT replaced by service client',s=>s.replace('await readBusinessMetric(supabaseClient,','await readBusinessMetric(supabase,')],
 ['metric model actor injected',s=>s.replace('{ tenantId: personaCtx?.tenant_id ?? null }, JSON.parse(tc.function.arguments))','{ tenantId: personaCtx?.tenant_id ?? null, actorId: JSON.parse(tc.function.arguments).actor_id }, JSON.parse(tc.function.arguments))')],
 ['metric model tenant injected',s=>s.replace('{ tenantId: personaCtx?.tenant_id ?? null }, JSON.parse(tc.function.arguments))','{ tenantId: JSON.parse(tc.function.arguments).tenant_id }, JSON.parse(tc.function.arguments))')],
 ['metric branch intercepts booking with an effect',s=>s.replace('if (tc.function.name === "read_business_metric") {','if (tc.function.name === "read_business_metric" || tc.function.name === "calendar_book_meeting") { await fetch("https://counterfeit.invalid");')],
])test(`rejects reviewed metric ancestry: ${label}`,()=>{const changed=mutate(chat);assert.ok(changed!==chat);assert.ok(validateIncumbentResourceBindings(changed,sources).findings.length);});
test('rejects reviewed metric adapter effect substitution',()=>{
 const path='supabase/functions/_shared/analytics-metrics/read.ts';const raw=readFileSync(path,'utf8');
 const changed=new Map(sources);changed.set(path,raw.replace("caller.rpc('issue_analytics_evidence_bundle'","caller.rpc('dispatch_automation'"));
 assert.ok(changed.get(path)!==raw);assert.ok(validateIncumbentResourceBindings(chat,changed).findings.length);
});
test('rejects missing reviewed metric ancestry adapter or validator',()=>{
 for(const path of ['supabase/functions/_shared/analytics-metrics/read.ts','supabase/functions/_shared/analytics-metrics/metric-contract.ts']){
  const missing=new Map(sources);missing.delete(path);assert.ok(validateIncumbentResourceBindings(chat,missing).findings.length);
 }
});
for(const [label,mutate]of [
 ['discovery caller replaced by service client',s=>s.replace('await findPipelineOriginalEffect(originalScope, supabaseClient);','await findPipelineOriginalEffect(originalScope, supabase);')],
 ['original actor replaced by client input',s=>s.replace('tenantId: thread.tenant_id, actorId: user.id };','tenantId: thread.tenant_id, actorId: rawData.actor_id };')],
 ['original tenant replaced by client input',s=>s.replace('tenantId: thread.tenant_id, actorId: user.id };','tenantId: rawData.tenant_id, actorId: user.id };')],
 ['automatic discovery final revalidation bypassed',s=>s.replace('await findPipelineOriginalEffect(originalScope, supabaseClient) !== effectId','false')],
 ['status state read changed to executor release',s=>s.replace('state: () => executor("state"),','state: () => executor("release"),')],
])test(`rejects reviewed Pipeline status context: ${label}`,()=>{
 const changed=mutate(chat);assert.ok(changed!==chat,'fixture must mutate actual reviewed status source');
 assert.ok(validateIncumbentResourceBindings(changed,sources).findings.length);
});
for(const [label,path,mutate]of [
 ['original discovery delegates to an effect','supabase/functions/_shared/pipeline-original-discovery.ts',s=>s.replace("caller.rpc('find_pipeline_metadata_original_effect',args)","caller.rpc('configure_tenant_pipeline_as_paige',args)")],
 ['status observation fabricates settlement','supabase/functions/_shared/paige-turn/outcome-status.ts',s=>s.replace('settled: state.executor === null && (state.terminal === true || state.stopped === true)','settled: true')],
])test(`rejects reviewed Pipeline status helper: ${label}`,()=>{
 const raw=readFileSync(path,'utf8'),changed=mutate(raw);assert.ok(changed!==raw);
 const altered=new Map(sources);altered.set(path,changed);assert.ok(validateIncumbentResourceBindings(chat,altered).findings.length);
});
for(const [label,mutate]of [
 ['unattributed or malformed tenant admitted',s=>s.replace('if (!tenantId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tenantId)) return false;','if (false) return false;')],
 ['explicit empty cohort kill switch bypassed',s=>s.replace('if (cohort !== null && !cohort.includes(tenantId.toLowerCase())) return false;','if (false) return false;')],
 ['default class scope widened',s=>s.replace('return listed.length ? listed : ["operational"];','return listed.length ? listed : ["cheap", "operational", "frontier"];')],
 ['terminal budget stop guard removed',s=>s.replace('if ((e as { code?: unknown })?.code === "budget_exceeded") {','if (false) {')],
])test(`rejects reviewed Fabric cutover: ${label}`,()=>{
 const path='supabase/functions/_shared/model-fabric.ts',raw=sources.get(path),changed=mutate(raw);
 assert.ok(changed!==raw,'fixture must mutate actual reviewed source');
 const altered=new Map(sources);altered.set(path,changed);
 assert.ok(validateIncumbentResourceBindings(chat,altered).findings.some(f=>f.includes(path)));
});
test('all exact metadata maps refuse forged keys, tools, symbols, seats, risk, visibility and readiness',()=>{
 assert.ok(actual);
 for(const spec of actual.tools.values()){
  const cap={key:spec.key,selfDescribe:spec.selfDescribe,readiness:spec.readiness,chatBinding:'LIVE',mindBinding:'UNAVAILABLE',maturity:'PARTIAL',action:{...spec}};
  assert.ok(matchesIncumbentDeclaration(cap,spec));
  for(const changed of [{...cap,key:'forged.key'},{...cap,selfDescribe:!cap.selfDescribe},{...cap,readiness:'unverified'},
   ...['chatTool','executor','classification','riskPolicyKey','approvalAuthority','seatAuthority'].map(field=>({...cap,action:{...cap.action,[field]:'forged'}}))]){
   assert.equal(matchesIncumbentDeclaration(changed,spec),false);
   if(changed.action.chatTool===spec.chatTool)assert.ok(validateIncumbentDeclarations([changed],actual).length);
  }
 }
 assert.equal(actual.tools.has('unregistered_unknown'),false);
});

for(const [label,from,to]of [
 ['caller','loadResearchHistoryContext(supabaseClient,','loadResearchHistoryContext(supabase,'],
 ['tenant','tenantId: personaCtx.tenant_id })','tenantId: payload.tenant_id })'],
 ['actor','loadResearchHistoryContext(supabaseClient, { actorId: user.id','loadResearchHistoryContext(supabaseClient, { actorId: payload.actor_id'],
 ['seat','personaCtx.tenant_id && callerTier === "tenant"','personaCtx.tenant_id && true'],
 ['hold','researchHistory?.status === "available" && researchHistoryBlock','researchHistoryBlock'],
])test(`rejects Research context ${label}`,()=>{const changed=chat.replace(from,to);assert.notEqual(changed,chat);assert.ok(validateIncumbentResourceBindings(changed,sources).findings.length);});
for(const [label,from,to]of [
 ['closed metadata','Object.keys(r).length!==KEYS.length','false'],
 ['scope','if (!(await scopeHolds()))','if (false)'],
 ['effect',"client.rpc('list_workspace_research'","client.rpc('dispatch_automation'"],
])test(`rejects Research helper ${label}`,()=>{const path='supabase/functions/_shared/research-history-context.ts',raw=readFileSync(path,'utf8'),changed=raw.replace(from,to);assert.notEqual(changed,raw);const altered=new Map(sources);altered.set(path,changed);assert.ok(validateIncumbentResourceBindings(chat,altered).findings.length);});

test('rejects Research context degraded data fabrication',()=>{const path='supabase/functions/_shared/paige-context/mod.ts',raw=readFileSync(path,'utf8'),changed=raw.replace('return { status: "degraded", reason, data: null };','return { status: "available", data: {runs:[{question:"forged"}]} };');assert.notEqual(changed,raw);const altered=new Map(sources);altered.set(path,changed);assert.ok(validateIncumbentResourceBindings(chat,altered).findings.length);});
