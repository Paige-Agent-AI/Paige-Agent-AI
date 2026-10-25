import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {confirmFingerprint} from '../../supabase/functions/_shared/confirm-fingerprint.ts';
import {canonicalPresentationJson} from '../../supabase/functions/_shared/agreements/preparation-json.ts';
import {PREPARED_SIGNING_LINK_MARKER} from '../../supabase/functions/_shared/agreements/prepared-signature-review-contract.ts';
import {commsEmailBodyHtml} from '../../supabase/functions/_shared/comms-email/contract.ts';

// Reuse the EXISTING native commercial fixture/plan constructor. No parallel
// pricing/date/obligation implementation, provider or customer operation.
export async function preparedCredentialsCommercialFixture({sql,quote,tenant,actor,makeCommercial,issue,claim,register}){
 assert.equal(typeof makeCommercial,'function','Original commercial fixture handoff is required');
 const q=quote,native=s=>'SET ROLE service_role;'+s;
 const json=s=>JSON.parse(sql(s));
 const original=await makeCommercial(),p=original.p,s=p.source,manifest=JSON.parse(p.manifest);
 json(native(`SELECT public._retain_agreement_document_preparation('${actor}','${tenant}','${s.agreement_id}','${s.client_id}',
  ${s.version},${q(s.updated_at)},'${p.id}',NULL,${q(p.storage)},${q(p.manifest)},${q(p.digest)},${q(p.commercial)});`));
 const connector=randomUUID(),operation=randomUUID(),issuedNonce=randomUUID(),cycle=randomUUID();
 sql(`INSERT INTO channel_connectors VALUES('${connector}','${tenant}','email','sendgrid',true,'active');`);
 const title=sql(`SELECT title FROM paige_agreements WHERE id='${s.agreement_id}';`);
 const recipients=s.signers.map(signer=>({id:signer.id,full_name:signer.full_name,email:signer.email,
  signer_role:signer.signer_role,signing_order:signer.signing_order,
  field_count:manifest.fields.filter(f=>f.signer_id===signer.id).length}));
 const body='Please review the original agreement.\n\n'+PREPARED_SIGNING_LINK_MARKER;
 const request={agreementId:s.agreement_id,expectedTenantId:tenant,operationId:operation,preparationId:p.id,
  preparationSha256:p.digest,reviewSha256:'b'.repeat(64),source:{client_id:s.client_id,version:s.version,updated_at:s.updated_at},
  title,document:{sha256:manifest.document.sha256,byte_length:manifest.document.byte_length,page_count:manifest.document.pages.length},
  recipients,requestSchemaVersion:1,sender:{connector_id:connector,provider:'sendgrid',from_address:'business@example.test',from_name:null,reply_to:null},
  messages:recipients.map(signer=>({signer_id:signer.id,to:signer.email,subject:'Review the original agreement',body_text:body,body_html:commsEmailBodyHtml(body)}))};
 const args={request,request_sha256:createHash('sha256').update(canonicalPresentationJson(request)).digest('hex'),
  operation_id:operation,expected_tenant_id:tenant,approval_subject:'agreement.prepared_signature_request:'+s.agreement_id+':'+operation,
  approval_cycle_nonce:cycle};
 const v={a:{id:s.agreement_id},source:s,signer:s.signers[0],preparation:p.id,connector,operation,nonce:issuedNonce,args};
 return approvePreparedCredentialsFixture({sql,quote,tenant,actor,issue,claim,register},
  {...v,terms:original.terms,invoice:original.invoice,manifest});
}

// A second explicitly reviewed intent uses ORIGINAL confirmation and Work APIs.
// This only constructs local proof records, never a new approval implementation.
export async function approvePreparedCredentialsFixture({sql,quote,tenant,actor,issue,claim,register},v){
 const q=quote,native=s=>'SET ROLE service_role;'+s,json=s=>JSON.parse(sql(s));
 const approvedArgs=structuredClone(v.args),operation=v.operation;
 const proposed={...v,args:approvedArgs,fp:await confirmFingerprint('agreement_send',approvedArgs)};
 json(native(issue(proposed)));
 const nonce=randomUUID(),pending=json(native(claim(proposed,nonce))),audit=randomUUID();
 const payload={capability:'agreement_send',decision:'execute',risk:'high',lane_effective:'confirm',operation_id:operation,request_sha256:approvedArgs.request_sha256};
 sql(`INSERT INTO paige_audit_log(id,actor_user_id,actor_role,tenant_id,action,target_type,target_id,payload)
  VALUES('${audit}','${actor}','sales:owner','${tenant}','sales.agreement_signature_request_governed_decision','agreement','${v.a.id}',${q(JSON.stringify(payload))}::jsonb);`);
 const approved={...proposed,nonce,pending,audit};
 json(native(register(approved)));
 return approved;
}
