import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {renderPresentedPdf,sealAgreementPdf} from '../../supabase/functions/_shared/agreements/document.ts';
import {inspectAgreementPreparationPdf} from '../../supabase/functions/_shared/agreements/document-preparation.ts';
import {verifyRetainedAgreementPdf} from '../../supabase/functions/_shared/agreements/retained-document.ts';
import {canonicalPresentationJson} from '../../supabase/functions/_shared/agreements/preparation-json.ts';
import {sha256Hex} from '../../supabase/functions/_shared/agreements/token.ts';

// SAME original fenced native program and original PDF renderer. The bytes are
// real; outer Auth/provider/storage ports are controlled local fixtures only.
export async function provePreparedSealCompletion({sql,q,tenant,acceptedFixture,publish,write,readFields,payload}){
 let checks=0;const check=(value,message)=>{assert(value,message);checks++;};
 const native=s=>'SET ROLE service_role;'+s,json=s=>JSON.parse(sql(s));
 const bytes=await renderPresentedPdf({title:'Synthetic nonbinding native proof',bodyMarkdown:'Controlled native completion proof. No real customer, payment or service obligation.'});
 const document=await inspectAgreementPreparationPdf(bytes,await sha256Hex(bytes));
 const v=await acceptedFixture({document,allFieldTypes:true,secondSigner:true});json(native(publish(v)));
 for(let index=0;index<v.hashes.length;index++){
  const fields=readFields(v,index);check(json(native(write(v,fields,payload(fields)))).audit_complete===true,'Actual original canonical signatures precede sealing');
 }
 const source=json(native(`SELECT _read_prepared_agreement_seal('${v.a.id}');`));
 check(source.state==='prepared'&&source.document_sha256===document.sha256&&source.signers.length===2,
  'Original native preparation/signature/field source binds the exact real presented bytes');
 const events=json(`SELECT jsonb_agg(jsonb_build_object('eventType',event_type,'at',created_at,'actorKind',actor_kind,'actorLabel',actor_email,'ip',ip) ORDER BY created_at,seq)
  FROM paige_agreement_events WHERE tenant_id='${tenant}' AND agreement_id='${v.a.id}';`);
 const sealed=await sealAgreementPdf({presentedBytes:bytes,presentedSha256:document.sha256,presentedKind:'file',
  agreementTitle:'Synthetic nonbinding native proof',agreementId:v.a.id,tenantName:'Synthetic native proof business',sealedAtIso:new Date().toISOString(),
  preparedFields:source.prepared_fields,parties:source.signers.map(s=>({signerId:s.id,fullName:s.full_name,email:s.email,role:s.signer_role,
   signingOrder:s.signing_order,status:s.status,typedName:s.typed_name,signedAt:s.signed_at,consentAt:s.esign_consent_at,
   consentSlug:s.esign_consent_slug,consentVersion:s.esign_consent_version,signingIp:s.signing_ip,signingUserAgent:s.signing_user_agent,signatureImagePng:null})),events});
 const sealedSha256=await sha256Hex(sealed),sourceSha256=await sha256Hex(canonicalPresentationJson(source));
 check(await verifyRetainedAgreementPdf(sealed,sealedSha256),'Real original sealed PDF bytes and digest verify; no fabricated PDF metadata');
 const key=tenant+'/'+v.a.id+'/sealed-'+randomUUID()+'.pdf';
 // Causal baseline: the original prepared hold still prevents the old direct
 // status update. A canonical atomic completion contract must actually exist.
 const receipt=json(native(`SELECT _complete_prepared_agreement_seal('${tenant}','${v.a.id}',${q(sourceSha256)},${q(key)},${q(sealedSha256)});`));
 check(receipt.state==='recorded'&&receipt.agreement_id===v.a.id&&receipt.sealed_sha256===sealedSha256,
  'Original completed record and its actual seal/complete receipts are authoritative');
 return {checks,sourceSha256,sealedSha256,sealedByteLength:sealed.byteLength,scope:'Real original local PDF/native state with synthetic Auth/provider/storage ports; no hosted Storage or customer acceptance'};
}
