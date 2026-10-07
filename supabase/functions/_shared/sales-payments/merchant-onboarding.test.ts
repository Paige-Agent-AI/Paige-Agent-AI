import {describe,it,expect} from 'vitest';
import {merchantStatus,returnTarget,hostedUrl} from './merchant-onboarding.ts';
const tenant='test-tenant-a';
const row={tenant_id:tenant,stripe_account_id:'acct_testA',provider_environment:'test',binding_version:1,charges_enabled:true,payouts_enabled:true,details_submitted:true,sales_payment_permission:true,sales_readback_at:'2026-10-06T12:00:00Z'};
describe('merchant onboarding safety',()=>{
 it('never calls a stale stored connection ready',()=>expect(merchantStatus(tenant,row,true,'test',Date.parse('2026-10-06T12:06:00Z')).state).toBe('unverified'));
 it('fails environment mismatch closed',()=>expect(merchantStatus(tenant,row,true,'live',Date.parse('2026-10-06T12:00:01Z')).state).toBe('unverified'));
 it('keeps an unresolved creation unknown',()=>expect(merchantStatus(tenant,{...row,stripe_account_id:null,onboarding_id:'operation'},true,'test',Date.now()).state).toBe('outcome_unknown'));
 it('returns only closed public fields',()=>expect(Object.keys(merchantStatus(tenant,row,true,'test',Date.parse('2026-10-06T12:00:01Z')))).toEqual(['tenant_id','connected','can_manage','provider_environment','binding_version','charges_enabled','payouts_enabled','details_submitted','sales_payment_permission','checked_at','state','recovery_reason']));
 it.each(['http://app.paigeagent.ai/solo/1/settings/integrations?stripe_setup=return','https://evil.test/solo/1/settings/integrations?stripe_setup=return','https://app.paigeagent.ai/solo/2/settings/integrations?stripe_setup=return','https://app.paigeagent.ai/solo/1/settings/integrations?stripe_setup=return&token=secret'])('rejects unsafe return %s',url=>expect(()=>returnTarget(url,'1',['https://app.paigeagent.ai'])).toThrow());
 it('accepts only the expected settings return',()=>expect(returnTarget('https://app.paigeagent.ai/solo/1/settings/integrations?stripe_setup=return','1',['https://app.paigeagent.ai'])).toContain('/solo/1/'));
 it.each(['https://connect.stripe.com.evil.test/a','javascript:alert(1)','https://user:pass@connect.stripe.com/a'])('rejects provider link %s',url=>expect(()=>hostedUrl(url)).toThrow());
});
import {resolveOnboarding,type OnboardingPort} from './merchant-onboarding.ts';
const pending={...row,stripe_account_id:null,onboarding_id:'c52a0717-e922-4f6a-80c9-3b381820c825',onboarding_claim:'83671a47-367d-4c92-84d3-341ee6c4d6dd',onboarding_started_at:'2026-10-06T12:00:00Z'};
function port(){const calls:string[]=[];const account={id:'acct_testA',metadata:{tenant_id:tenant,onboarding_id:pending.onboarding_id,provider_environment:'test'}};return {calls,account,adapter:{scope:async()=>{calls.push('scope');},create:async(key,metadata)=>{calls.push('POST');expect(key).toBe(`sales-merchant-${pending.onboarding_id}`);expect(Object.keys(metadata)).toEqual(['tenant_id','onboarding_id','provider_environment']);return account;},list:async()=>{calls.push('GET');return {data:[account],has_more:false};},persist:async(binding,found)=>{calls.push('persist+receipt');return {...binding,stripe_account_id:found.id,binding_version:2};}}} as {calls:string[];account:typeof account;adapter:OnboardingPort};}
describe('one dispatch claim execution',()=>{
 it('dispatches one immutable request then scopes before atomic persist',async()=>{const p=port();expect((await resolveOnboarding(pending,true,p.adapter)).binding_version).toBe(2);expect(p.calls).toEqual(['scope','POST','scope','scope','persist+receipt']);});
 it('a losing/retried claim only uses GET recovery',async()=>{const p=port();await resolveOnboarding(pending,false,p.adapter);expect(p.calls.includes('POST')).toBe(false);expect(p.calls).toContain('GET');});
 it('timeout stays unknown and never persists/retries',async()=>{const p=port();p.adapter.create=async()=>{p.calls.push('POST');throw Error('timeout secret');};await expect(resolveOnboarding(pending,true,p.adapter)).rejects.toThrow();expect(p.calls).toEqual(['scope','POST']);});
 it('no account found does not redispatch',async()=>{const p=port();p.adapter.list=async()=>({data:[],has_more:false});expect(await resolveOnboarding(pending,false,p.adapter)).toEqual(pending);expect(p.calls).not.toContain('persist+receipt');expect(p.calls).not.toContain('POST');});
 it('bounded incomplete recovery never binds a partial match',async()=>{const p=port();let pages=0;p.adapter.list=async()=>{pages++;return {data:[p.account],has_more:true};};expect(await resolveOnboarding(pending,false,p.adapter)).toEqual(pending);expect(pages).toBe(5);});
 it.each(['tenant_id','onboarding_id','provider_environment'])('refuses wrong %s before binding',async key=>{const p=port();p.account.metadata[key]='foreign';await expect(resolveOnboarding(pending,true,p.adapter)).rejects.toThrow('PROVIDER_PROVENANCE_UNVERIFIED');expect(p.calls).not.toContain('persist+receipt');});
 it('scope loss after provider await prevents bind',async()=>{const p=port();let checks=0;p.adapter.scope=async()=>{if(++checks===2)throw Error('workspace switched');};await expect(resolveOnboarding(pending,true,p.adapter)).rejects.toThrow('workspace switched');expect(p.calls).not.toContain('persist+receipt');});
 it('receipt/storage failure is not returned as a successful binding',async()=>{const p=port();p.adapter.persist=async()=>{throw Error('receipt transaction rolled back');};await expect(resolveOnboarding(pending,true,p.adapter)).rejects.toThrow('receipt transaction rolled back');expect(pending.stripe_account_id).toBeNull();});
});


describe('status truth across new and legacy merchants',()=>{
 it('offers configured server environment on an unconnected tenant',()=>expect(merchantStatus(tenant,null,true,'test',Date.now())).toMatchObject({connected:false,provider_environment:'test',state:'not_connected'}));
 it('does not adopt key environment for an unproven legacy binding',()=>expect(merchantStatus(tenant,{...row,provider_environment:null},true,'test',Date.now())).toMatchObject({connected:true,provider_environment:null,state:'unverified'}));
 it('treats future readback as unverified',()=>expect(merchantStatus(tenant,row,true,'test',Date.parse('2026-10-06T11:59:59Z')).state).toBe('unverified'));
 it('exposes completion before permitted charges truthfully',()=>expect(merchantStatus(tenant,{...row,details_submitted:false},true,'test',Date.parse('2026-10-06T12:00:01Z')).state).toBe('setup_incomplete'));
 it('needs fresh provider card capability permission',()=>expect(merchantStatus(tenant,{...row,sales_payment_permission:false},true,'test',Date.parse('2026-10-06T12:00:01Z')).state).toBe('restricted'));
 it('does not allow a return target without server workspace identity',()=>expect(()=>returnTarget('https://paigeagent.ai/solo/1/settings/integrations?stripe_setup=return',null,['https://paigeagent.ai'])).toThrow('RETURN_URL_INVALID'));
});

import {admitMerchantRequest} from './merchant-onboarding.ts';
describe('endpoint admission',()=>{
 const request={action:'start_onboarding',return_url:'https://paigeagent.ai/solo/1/settings/integrations?stripe_setup=return',refresh_url:'https://paigeagent.ai/solo/1/settings/integrations?stripe_setup=return'};
 it('does not admit onboarding without explicit expected tenant',()=>expect(()=>admitMerchantRequest(request,tenant)).toThrow('EXPECTED_TENANT_REQUIRED'));
 it('requires scope for new Solo onboarding before any reservation',()=>expect(()=>admitMerchantRequest({...request,return_url:'https://paigeagent.ai/solo/1/settings/integrations?stripe_setup=return'},tenant)).toThrow('EXPECTED_TENANT_REQUIRED'));
 it('refuses a foreign expected workspace before provider work',()=>expect(()=>admitMerchantRequest({...request,expected_tenant_id:'foreign'},tenant)).toThrow('WORKSPACE_CHANGED'));
 it('accepts explicit matching workspace identity',()=>expect(admitMerchantRequest({...request,expected_tenant_id:tenant},tenant)).toBe(true));
 it.each([{return_url:undefined},{refresh_url:undefined},{return_url:'https://paigeagent.ai/solo/1/settings/integrations?stripe_setup=return?token=secret'},{return_url:'https://paigeagent.ai/workspace/storefront'},{refresh_url:'https://paigeagent.ai/solo/1/settings/integrations?stripe_setup=return'}])('refuses unscoped onboarding %j',patch=>expect(()=>admitMerchantRequest({...request,...patch},tenant)).toThrow('EXPECTED_TENANT_REQUIRED'));
 it.each(['status','refresh_status','login_link'])('retains original auth-bound %s omission',action=>expect(admitMerchantRequest({action},tenant)).toBe(false));
 it('a disabled fresh provider account cannot be ready',()=>expect(merchantStatus(tenant,{...row,requirements:{disabled_reason:'requirements.past_due'}},true,'test',Date.parse('2026-10-06T12:00:01Z'))).toMatchObject({state:'restricted',recovery_reason:'MERCHANT_PAYMENTS_RESTRICTED'}));
 it('never exposes internal disabled reason or requirements',()=>expect(JSON.stringify(merchantStatus(tenant,{...row,requirements:{disabled_reason:'private-marker'}},true,'test',Date.parse('2026-10-06T12:00:01Z')))).not.toContain('private-marker'));
 it('rejects an untrusted return host',()=>expect(()=>returnTarget('https://evil.test/solo/1/settings/integrations?stripe_setup=return',null,['https://paigeagent.ai'])).toThrow('RETURN_URL_INVALID'));
});

import {recoverPendingMerchant} from './merchant-onboarding.ts';
describe('explicit refresh reconciliation route',()=>{
 it('refresh finds the reserved provider account using GET and CAS, never POST',async()=>{const p=port();expect((await recoverPendingMerchant('refresh_status',pending,p.adapter))?.stripe_account_id).toBe('acct_testA');expect(p.calls).toEqual(['scope','GET','scope','scope','persist+receipt']);});
 it('refresh leaves absent provider account outcome unknown',async()=>{const p=port();p.adapter.list=async()=>({data:[],has_more:false});expect(await recoverPendingMerchant('refresh_status',pending,p.adapter)).toEqual(pending);expect(p.calls).not.toContain('POST');expect(p.calls).not.toContain('persist+receipt');});
 it.each(['status','login_link','start_onboarding'])('%s does not execute refresh recovery',async action=>{const p=port();expect(await recoverPendingMerchant(action,pending,p.adapter)).toEqual(pending);expect(p.calls).toEqual([]);});
 it('refresh on existing merchant leaves saved binding unchanged',async()=>{const p=port();expect(await recoverPendingMerchant('refresh_status',row,p.adapter)).toEqual(row);expect(p.calls).toEqual([]);});
 it('refresh lookup failure never dispatches creation or persists',async()=>{const p=port();p.adapter.list=async()=>{throw Error('provider timeout');};await expect(recoverPendingMerchant('refresh_status',pending,p.adapter)).rejects.toThrow('provider timeout');expect(p.calls).not.toContain('POST');expect(p.calls).not.toContain('persist+receipt');});
});

import {hostedLink} from './merchant-onboarding.ts';
describe('hosted response boundary',()=>{
 it.each([null,undefined,{},{url:42},'https://connect.stripe.com/setup'])('refuses malformed provider response %j',response=>expect(()=>hostedLink(response)).toThrow('PROVIDER_LINK_UNVERIFIED'));
 it('validates the URL within a provider response',()=>expect(hostedLink({url:'https://connect.stripe.com/setup'})).toBe('https://connect.stripe.com/setup'));
});
