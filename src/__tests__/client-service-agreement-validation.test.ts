import {describe,it,expect} from "vitest";
import {clientServiceAgreementMatches} from "../../supabase/functions/_shared/client-service-agreement-validation";
import {DEFAULT_AGREEMENT_TEMPLATE,renderAgreementBody} from "../pages/onboard/agreement-default";
const now=new Date("2026-10-16T23:59:59Z"),profile={id:"client-a",first_name:"Test",last_name:"Customer"};
const source={tenant_name:"Test Service",agreement_body:null};
const submission={client_id:profile.id,agreement_template_key:"platform_default",agreement_version:"default-v1",
 agreement_text_snapshot:renderAgreementBody(DEFAULT_AGREEMENT_TEMPLATE,{tenant_name:source.tenant_name,client_full_legal_name:"Test Customer",effective_date:"2026-10-16",signature_date:"2026-10-16"})};
describe("exact service-agreement binding shared by signup and its native signing endpoint",()=>{
 it("accepts the exact canonical template, current customer and UTC presentation date",()=>{
  expect(clientServiceAgreementMatches(profile,source,submission,now)).toBe(true);
 });
 it.each([{client_id:"foreign"},{agreement_template_key:"tenant_custom"},{agreement_version:"forged-version"},{agreement_text_snapshot:"An attacker-supplied contract"}])("refuses mismatched identity/content/version %j",patch=>{
  expect(clientServiceAgreementMatches(profile,source,{...submission,...patch},now)).toBe(false);
 });
 it("a changed tenant document invalidates the earlier presentation",()=>{
  expect(clientServiceAgreementMatches(profile,{...source,agreement_body:"Updated service contract"},submission,now)).toBe(false);
 });
 it("a changed canonical customer name cannot reuse the earlier rendered document",()=>{
  expect(clientServiceAgreementMatches({...profile,last_name:"Changed"},source,submission,now)).toBe(false);
 });
 it("refuses a stale previous-day presentation and requires review again",()=>{
  expect(clientServiceAgreementMatches(profile,source,submission,new Date("2026-10-17T00:00:00Z"))).toBe(false);
 });
 it("the tenant-authored template has the same exact-content boundary",()=>{
  const custom={tenant_name:"Test Service",agreement_body:"Services for {{client_full_legal_name}} from {{tenant_name}} on {{effective_date}}."};
  expect(clientServiceAgreementMatches(profile,custom,{...submission,agreement_template_key:"tenant_custom",agreement_version:"tenant-v1",agreement_text_snapshot:"Services for Test Customer from Test Service on 2026-10-16."},now)).toBe(true);
 });
});
