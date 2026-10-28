// @vitest-environment node
import {describe,expect,it} from 'vitest';
import {effectiveStandingFixture} from './fixtures/exp04-effective-standing-source';
import {composeClientEngagementStatus} from '../../supabase/functions/_shared/client-engagement/status';
import {standingRecordLinks} from '../../supabase/functions/_shared/client-engagement/labels';
import {readRecordLinks,mergeRecordLinks} from '../../supabase/functions/_shared/paige-turn/record-links';
import {workspaceLinkTargets} from '../lib/links/workspaceLinks';

const account={account_type:'standalone',parent_tenant_id:null,account_number:3123};
const signing='e4000000-0000-4000-8000-0000000d0001';

describe('original agreement references across answer persistence and workspace changes',()=>{
 it('retains only the document UUID and builds the existing receiver from the current account',()=>{
  const saved=JSON.parse(JSON.stringify([{destination:'sales_agreements',record_id:signing.toUpperCase(),
   subject:'Private wording',url:'https://foreign.invalid',account:9999,approved:true,token:'private'}]));
  const links=readRecordLinks(saved);
  expect(links).toEqual([{destination:'sales_agreements',record_id:signing}]);
  for(const account_number of [3123,9786])expect(workspaceLinkTargets(links,{...account,account_number})).toEqual([
   {label:'Open terms & agreements',status:'exact',to:`/solo/${account_number}/sales/agreements?agreement=${signing}`}]);
  expect(mergeRecordLinks(links,links)).toHaveLength(1);
 });
 it('keeps malformed and older surface references at the register and refuses unmounted account classes',()=>{
  for(const record_id of [null,'',`${signing}?token=private`,'../other']){
   const links=readRecordLinks([{destination:'sales_agreements',record_id}]);
   expect(workspaceLinkTargets(links,account)).toEqual([{label:'Open terms & agreements',status:'surface_only',to:'/solo/3123/sales/agreements'}]);
  }
  const links=readRecordLinks([{destination:'sales_agreements',record_id:signing}]);
  for(const account_type of ['sub_account','agency','enterprise'])expect(workspaceLinkTargets(links,{...account,account_type})).toEqual([]);
  expect(workspaceLinkTargets(links,{...account,account_number:null})).toEqual([]);
 });
 it('links the original effectuated signing even when it is outside the bounded title list',()=>{
  const {source,accepted}=effectiveStandingFixture();source.signings=[];source.signings_has_more=true;
  const status=composeClientEngagementStatus(source),before=structuredClone(status);
  expect(standingRecordLinks(status).find(l=>l.destination==='sales_agreements')).toEqual({destination:'sales_agreements',record_id:accepted.signing_id});
  expect(status).toEqual(before);
 });
 it('does not substitute commercial terms identity or a malformed signing for a document',()=>{
  const {source}=effectiveStandingFixture();const status=composeClientEngagementStatus(source);
  for(const record_id of [null,'../other']){
   const changed={...status,agreement:{...status.agreement,signing_id:record_id}};
   expect(standingRecordLinks(changed).find(l=>l.destination==='sales_agreements')).toEqual({destination:'sales_agreements',record_id:null});
  }
  const changed={...status,agreement:{...status.agreement,state:'none' as const}};
  expect(standingRecordLinks(changed).find(l=>l.destination==='sales_agreements')).toEqual({destination:'sales_agreements',record_id:null});
 });
});
