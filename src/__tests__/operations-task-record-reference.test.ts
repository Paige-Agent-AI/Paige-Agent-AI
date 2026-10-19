import {describe,expect,it} from "vitest";
import {resolveCanonicalRecordLink} from "../../supabase/functions/_shared/canonical-app-url";
import {readRecordLinks} from "../../supabase/functions/_shared/paige-turn/record-links";
import {crmResultRecordReference,readCrmResultMetadata} from "../../supabase/functions/_shared/paige-turn/crm-result-reference";

const A="11111111-1111-4111-8111-abcdefabcdef",B="22222222-2222-4222-8222-222222222222";
const reference={destination:"operations_work",record_id:A};
const native=()=>({action:"task.update",outcome:"succeeded",receipt_recorded:true,
 readback:{id:A,title:"Private task title",metadata:{private:true}},
 record_locator:{record_id:A,deep_link_status:"exact",deep_link:`/solo/999/operations/work?task=${A}`}});

describe("bounded exact Task references after the native focus consumer",()=>{
 it.each(["tasks","operations_work"] as const)("resolves %s for the current eligible SOLO account",destination=>{
  for(const [tier,account] of [["solo","101"],["standalone","202"]] as const){
   expect(resolveCanonicalRecordLink({actor:"account",tier,account,destination,recordId:A}))
    .toEqual({path:`/solo/${account}/operations/work?task=${A}`,status:"exact"});
  }
 });
 it("uses only the current account and rejects non-UUID focus",()=>{
  for(const recordId of [null,undefined,"bad",`${A}&tenant=foreign`,`/solo/999/task/${A}`]){
   expect(resolveCanonicalRecordLink({actor:"account",tier:"solo",account:"303",destination:"operations_work",recordId}))
    .toEqual({path:"/solo/303/operations/work",status:"surface_only"});
  }
 });
 it("projects only the canonical UUID, with no Task title, locator or URL",()=>{
  expect(readRecordLinks([{...reference,record_id:A.toUpperCase(),subject:"Private task title",url:"https://example.invalid",readback:{private:true}}]))
   .toEqual([reference]);
  expect(readRecordLinks([reference,{...reference,record_id:B},reference,{destination:"operations_work",record_id:null}]))
   .toEqual([reference,{...reference,record_id:B},{destination:"operations_work",record_id:null}]);
 });
 it.each(["task.create","task.update","task.assign","task.reschedule","task.complete","task.reopen","task.cancel"])("keeps a fresh verified exact reference for %s",action=>{
  expect(crmResultRecordReference({...native(),action})).toEqual(reference);
 });
 it("hydrates bounded new history and leaves legacy surface-only history intact",()=>{
  const row={action:"task.update",outcome:"succeeded",receipt_recorded:true};
  expect(readCrmResultMetadata([{...row,record_reference:reference}]))
   .toEqual([{...row,record_reference:reference}]);
  const legacy={destination:"operations_work",record_id:null};
  expect(readCrmResultMetadata([{...row,record_reference:legacy}])).toEqual([{...row,record_reference:legacy}]);
  expect(crmResultRecordReference({...native(),record_locator:{record_id:A,deep_link_status:"surface_only"}})).toEqual(legacy);
  expect(readCrmResultMetadata([native()])).toEqual([row]);
 });
 it("refuses conflicting native IDs, missing receipts, absent records and false exact claims",()=>{
  for(const patch of [{record_locator:{record_id:B,deep_link_status:"exact"}},
   {record_reference:{...reference,record_id:B}},{record_reference:{...reference,record_id:"bad"}},
   {readback:{id:A,absent:true}},{receipt_recorded:false},{outcome:"unknown"},
   {record_locator:{record_id:A,deep_link_status:"unavailable"}}]){
   expect(crmResultRecordReference({...native(),...patch})).toBeNull();
  }
 });
 it("does not reconstruct an exact Task from old raw history or malformed extra fields",()=>{
  const row={action:"task.update",outcome:"succeeded",receipt_recorded:true};
  for(const extra of [{subject:"Private task title"},{url:"/foreign"},{readback:{id:A}}]){
   expect(readCrmResultMetadata([{...row,record_reference:{...reference,...extra}}]))
    .toEqual([row]);
  }
 });
});
