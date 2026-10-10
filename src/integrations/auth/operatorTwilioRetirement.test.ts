import { afterEach, describe, expect, it, vi } from 'vitest';
import { retireTwilioSubaccount } from '../../../supabase/functions/_shared/operator-retirement.ts';
import { twilioRequest } from '../../../supabase/functions/_shared/twilio.ts';
const parent='AC'+'a'.repeat(32), child='AC'+'b'.repeat(32), other='AC'+'c'.repeat(32);
const credentials={accountSid:parent,authToken:'synthetic-secret',apiKeySid:'SK'+'d'.repeat(32)};
const account=(status:string,sid=child,owner=parent)=>({sid,owner_account_sid:owner,status});
afterEach(()=>vi.unstubAllGlobals());
function responses(...bodies:unknown[]) {
 const fetch=vi.fn();for(const body of bodies)fetch.mockResolvedValueOnce(new Response(JSON.stringify(body),{status:200}));
 vi.stubGlobal('fetch',fetch);return fetch;
}
describe('canonical Twilio subaccount retirement',()=>{
 it('preserves ordinary callers transient retry while retirement can explicitly disable it',async()=>{
  const fetch=vi.fn().mockResolvedValueOnce(new Response('temporary',{status:503})).mockResolvedValueOnce(new Response(JSON.stringify({sid:'synthetic-response'})));
  vi.stubGlobal('fetch',fetch);
  expect((await twilioRequest(parent,'synthetic-secret','/2010-04-01/Accounts.json','POST',{Status:'suspended'})).ok).toBe(true);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch.mock.calls[0][1].body).toBe('Status=suspended');
  expect(fetch.mock.calls[0][1].signal).toBeUndefined();
  expect(fetch.mock.calls[0][1].redirect).toBeUndefined();
  fetch.mockReset().mockResolvedValueOnce(new Response('temporary',{status:503}));
  expect((await twilioRequest(parent,'synthetic-secret','/2010-04-01/Accounts.json','POST',{},undefined,{retryTransient:false,timeoutMs:1000})).ok).toBe(false);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  expect(fetch.mock.calls[0][1].redirect).toBe('error');
 });
 it('refuses completion when a call begins between preflight and suspension',async()=>{
  responses(account('active'),{calls:[]},{calls:[]},{calls:[]},account('suspended'),account('suspended'),{calls:[{status:'queued'}]});
  expect(await retireTwilioSubaccount(child,'suspended',credentials)).toEqual({state:'unknown',reason:'twilio_calls_in_flight'});
 });
 it('suspends only the verified child then independently reads its provider state',async()=>{
  const fetch=responses(account('active'),{calls:[]},{calls:[]},{calls:[]},account('suspended'),account('suspended'),{calls:[]},{calls:[]},{calls:[]});
  expect(await retireTwilioSubaccount(child,'suspended',credentials)).toEqual({state:'verified',provider_status:'suspended'});
  const writes=fetch.mock.calls.filter(c=>c[1]?.method==='POST');expect(writes).toHaveLength(1);
  expect(writes[0][0]).toBe(`https://api.twilio.com/2010-04-01/Accounts/${child}.json`);
  expect(writes[0][1].body).toBe('Status=suspended');
  expect(fetch.mock.calls.at(-1)?.[1]?.method).toBe('GET');
 });
 it('closes an approved child with readback and never closes the platform parent',async()=>{
  const fetch=responses(account('suspended'),{calls:[]},{calls:[]},{calls:[]},account('closed'),account('closed'),{calls:[]},{calls:[]},{calls:[]});
  expect(await retireTwilioSubaccount(child,'closed',credentials)).toEqual({state:'verified',provider_status:'closed'});
  expect(fetch.mock.calls.find(c=>c[1]?.method==='POST')?.[1].body).toBe('Status=closed');
  fetch.mockClear();expect((await retireTwilioSubaccount(parent,'closed',credentials)).state).toBe('blocked');expect(fetch).not.toHaveBeenCalled();
 });
 it.each([account('active',other),account('active',child,other)])('refuses a mismatched or foreign provider identity before any write',async body=>{
  const fetch=responses(body);expect((await retireTwilioSubaccount(child,'closed',credentials)).state).toBe('blocked');
  expect(fetch.mock.calls.some(c=>c[1]?.method==='POST')).toBe(false);
 });
 it('refuses in-flight calls and preserves the provider account',async()=>{
  const fetch=responses(account('active'),{calls:[{status:'queued'}]});
  expect(await retireTwilioSubaccount(child,'suspended',credentials)).toEqual({state:'blocked',reason:'twilio_calls_in_flight'});
  expect(fetch.mock.calls.some(c=>c[1]?.method==='POST')).toBe(false);
 });
 it('reconciles an uncertain POST by GET without repeating the consequential request',async()=>{
  const fetch=responses(account('active'),{calls:[]},{calls:[]},{calls:[]});fetch.mockRejectedValueOnce(new Error('transport disconnected'));
  fetch.mockResolvedValueOnce(new Response(JSON.stringify(account('closed'))));
  for(let i=0;i<3;i++)fetch.mockResolvedValueOnce(new Response(JSON.stringify({calls:[]})));
  expect(await retireTwilioSubaccount(child,'closed',credentials)).toEqual({state:'verified',provider_status:'closed'});
  expect(fetch.mock.calls.filter(c=>c[1]?.method==='POST')).toHaveLength(1);
 });
 it('does not confuse accepted update with provider readback or leak provider errors',async()=>{
  const fetch=responses(account('active'),{calls:[]},{calls:[]},{calls:[]},account('closed'));
  fetch.mockResolvedValueOnce(new Response('private-provider-payload',{status:503}));
  const result=await retireTwilioSubaccount(child,'closed',credentials);expect(result).toEqual({state:'unknown',reason:'twilio_readback_unavailable'});
  expect(JSON.stringify(result)).not.toContain('private-provider-payload');expect(fetch.mock.calls.filter(c=>c[1]?.method==='POST')).toHaveLength(1);
 });
 it('already closed/suspended resources require no further mutation and read-only recovery sends no POST',async()=>{
  const fetch=responses(account('closed'),{calls:[]},{calls:[]},{calls:[]});
  expect(await retireTwilioSubaccount(child,'closed',credentials,true)).toEqual({state:'verified',provider_status:'closed'});
  expect(fetch.mock.calls.filter(c=>c[1]?.method==='POST')).toHaveLength(0);
  responses(account('active'));expect(await retireTwilioSubaccount(child,'closed',credentials,true)).toEqual({state:'unknown',reason:'twilio_retirement_not_verified'});
 });
 it('rechecks operator authority immediately before the provider write',async()=>{
  const fetch=responses(account('active'),{calls:[]},{calls:[]},{calls:[]});
  expect(await retireTwilioSubaccount(child,'closed',credentials,false,async()=>false)).toEqual({state:'blocked',reason:'operator_authority_changed'});
  expect(fetch.mock.calls.some(c=>c[1]?.method==='POST')).toBe(false);
 });
});
