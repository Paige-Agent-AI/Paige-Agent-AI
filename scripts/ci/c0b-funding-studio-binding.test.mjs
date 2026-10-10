import {test} from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {validateFundingStudioBindings,validateFundingStudioDeclarations} from './c0b-funding-studio-binding.mjs';
const read=p=>readFileSync(new URL(`../../${p}`,import.meta.url),'utf8');
const chat=read('supabase/functions/paige-ai-chat/index.ts');
const sources={contentDraft:read('supabase/functions/content-draft/index.ts'),pageDraft:read('supabase/functions/growth-page-draft/index.ts'),funnelDraft:read('supabase/functions/growth-funnel-draft/index.ts'),studioCaller:read('supabase/functions/_shared/studio-caller.ts'),rates:read('supabase/functions/fetch-economic-rates/index.ts')};
sources.sba=read('supabase/functions/search-sba-lenders/index.ts');
test('actual eleven composite source bindings are bounded',()=>{const p=validateFundingStudioBindings(chat,sources);assert.deepEqual(p.findings,[]);assert.equal(p.tools.size,11);assert.equal(p.tools.get('search_funding_marketplace').chatBinding,'UNAVAILABLE');});
for(const [label,mutate] of [
 ['caller key uses service',s=>s.replace('createClient(supabaseUrl, supabaseKey, {','createClient(supabaseUrl, supabaseServiceKey, {')],
 ['funding dispatch guard removed',s=>s.replace('!fundingEnabled &&\n          (tc.function.name === "search_regional_lenders"','false &&\n          (tc.function.name === "search_regional_lenders"')],
 ['SBA caller JWT swapped',s=>s.replace('headers: { Authorization: authHeader, "Content-Type": "application/json" },\n              body: JSON.stringify({\n                state: args.state','headers: { Authorization: "service", "Content-Type": "application/json" },\n              body: JSON.stringify({\n                state: args.state')],
 ['regional endpoint swapped',s=>s.replace('/functions/v1/search-local-lenders','/functions/v1/send-message')],
 ['rate refresh endpoint swapped',s=>s.replace('/functions/v1/fetch-economic-rates','/functions/v1/send-message')],
 ['marketplace verified actor removed',s=>s.replace('_tenant_id: dispatchMarketplaceTenantId,\n            _actor_user_id: user.id','_tenant_id: dispatchMarketplaceTenantId,\n            _actor_user_id: a.actorId')],
 ['marketplace final active tenant bypassed',s=>s.replace('dispatchMarketplaceTenantId,\n            await resolveCurrentMarketplaceTenant(),','dispatchMarketplaceTenantId,\n            dispatchMarketplaceTenantId,')],
 ['growth list tenant pin replaced',s=>s.replace('.eq("tenant_id", _listTid)','.eq("tenant_id", args.tenant_id)')],
 ['page draft writer substituted',s=>s.replace('functions.invoke("growth-page-draft"','functions.invoke("growth-publish-command"')],
 ['funnel draft writer substituted',s=>s.replace('functions.invoke("growth-funnel-draft"','functions.invoke("growth-publish-command"')],
 ['content draft caller client substituted',s=>s.replace('supabaseClient.functions.invoke("content-draft"','supabase.functions.invoke("content-draft"')],
 ['image request correlation removed',s=>s.replace('request_id: await stableRunId(["studio-chat-image", payloadThreadId ?? "", tc.id])','request_id: args.request_id')],
 ['choice uses model supplied id',s=>s.replace('askId: crypto.randomUUID(), freeForm: mainChatAsks','askId: a.askId, freeForm: mainChatAsks')],
 ['funding placeholder claims ready',s=>s.replaceAll('status: "coming_soon"','status: "ready"')],
 ['marketplace current actor profile replaced',s=>s.replace('.select("active_tenant_id")\n          .eq("user_id", user.id)','.select("active_tenant_id")\n          .eq("user_id", a.actorId)')],
 ['legacy regeneration tenant replaced',s=>{const p=s.indexOf('supabaseClient.functions.invoke("generate-image"',s.indexOf('supabaseClient.functions.invoke("generate-image"')+1);return s.slice(0,p)+s.slice(p).replace('tenant_id: personaCtx?.tenant_id ?? null','tenant_id: a.tenant_id');}],
])test(`source mutation rejected: ${label}`,()=>{const changed=mutate(chat);assert.notEqual(changed,chat);assert.ok(validateFundingStudioBindings(changed,sources).findings.length);});
for(const [label,key,mutate] of [
 ['content workspace bypass','contentDraft',s=>s.replace('resolveStudioCaller(authed, body?.tenant_id)','resolveStudioCaller(authed, null)')],
 ['page workspace chosen from body','pageDraft',s=>s.replace('tenantId = caller.tenantId','tenantId = body.tenant_id')],
 ['funnel workspace chosen from body','funnelDraft',s=>s.replace('tenantId = caller.tenantId','tenantId = body.tenant_id')],
 ['Studio role predicate changed','studioCaller',s=>s.replace('authed.rpc("is_tenant_admin", { _tenant: tenantId })','authed.rpc("is_platform_owner", {})')],
 ['rate cache key changed','rates',s=>s.replace('onConflict: "series_id"','onConflict: "tenant_id"')],
 ['artifact writer added to draft','pageDraft',s=>s+'\nadmin.from("growth_pages").insert({});'],
 ['SBA token verification bypassed','sba',s=>s.replace('supabase.auth.getClaims(token)','supabase.auth.getClaims("unrelated-token")')],
])test(`adapter mutation rejected: ${label}`,()=>{const changed=mutate(sources[key]);assert.notEqual(changed,sources[key]);assert.ok(validateFundingStudioBindings(chat,{...sources,[key]:changed}).findings.length);});
test('malformed source fails closed',()=>assert.ok(validateFundingStudioBindings('(',sources).findings.length));
for(const [tool,binding] of [['draft_marketing_content','supabaseClient'],['marketplace_browse','supabase'],['get_current_rates','supabase'],['search_regional_lenders','supabaseServiceKey'],['get_current_rates','supabaseServiceKey'],['search_sba_lenders','authHeader'],['marketplace_browse','user'],['growth_page_generate','personaCtx']]){
 test(`lexical shadow rejected: ${tool}/${binding}`,()=>{const marker=`if (tc.function.name === "${tool}") {`;const changed=chat.replace(marker,`${marker}\nconst ${binding} = attacker;`);assert.notEqual(changed,chat);assert.ok(validateFundingStudioBindings(changed,sources).findings.length);});
}
test('destructured forged user shadow rejected',()=>{const marker='if (tc.function.name === "marketplace_browse") {';const changed=chat.replace(marker,`${marker}\nconst { user } = attacker;`);assert.notEqual(changed,chat);assert.ok(validateFundingStudioBindings(changed,sources).findings.length);});
test('metadata cannot invent public RPC or zero effect guarantees',()=>{const p=validateFundingStudioBindings(chat,sources);for(const c of [{key:'funding_optin.current_rates',action:{chatTool:'get_current_rates',executor:'public.get_current_rates',idempotency:'no side effects'}},{key:'vibe_studio.page_generate',action:{chatTool:'growth_page_generate',executor:'edge.paige-ai-chat',idempotency:'SSRF-safe, writes nothing'}}])assert.ok(validateFundingStudioDeclarations([c],p).length);});
