import assert from 'node:assert/strict';

// Continue the ORIGINAL fenced native program. Synthetic provider acceptance
// reaches the exact retained document before exercising actual signing writes.
// No second signer store, real recipient act, provider operation or QA account.
export async function provePreparedFieldSignature({sql,q,acceptedFixture,publish}){
 let checks=0;const check=(value,message)=>{assert(value,message);checks++;};
 const native=s=>'SET ROLE service_role;'+s,json=s=>JSON.parse(sql(s));
 const v=await acceptedFixture(),published=json(native(publish(v)));
 check(published.state==='recorded'&&published.delivery_confirmed===false,'Original accepted message is recorded without invented delivery');
 const signer=json(native(`SELECT _read_agreement_signing_fields(${q(v.hashes[0].token_hash)});`));
 check(signer.kind==='prepared'&&signer.agreement_id===v.a.id&&signer.signer_id===v.hashes[0].signer_id,'Actual original token-derived assigned fields authorize only this recipient');
 const agreement=json(`SELECT jsonb_build_object('version',version,'sha256',content_sha256,'key',content_storage_key) FROM paige_agreements WHERE id='${v.a.id}';`);
 const values=signer.fields.filter(f=>f.kind!=='signed_date').map(f=>({field_id:f.id,value:f.kind==='signature'?true:f.kind==='checkbox'?false:f.kind==='initials'?'SS':'Synthetic field value'}));
 check(values.length>0&&signer.fields.some(f=>f.kind==='signature'),'Original retained preparation supplies the actual fields; no invented form');
 const prepared={preparation_id:signer.preparation_id,preparation_sha256:signer.preparation_sha256,values};
 // Desired authoritative overload extends the SAME canonical signature writer.
 // Baseline must fail here until its atomic field/consent/evidence contract is
 // implemented. The original13 ABI and all legacy controls remain required.
 const receipt=json(native(`SELECT _record_agreement_signature(${q(v.hashes[0].token_hash)},${agreement.version},${q(agreement.sha256)},${q(agreement.key)},'Synthetic Signer',NULL,true,true,'synthetic-consent',1,repeat('a',64),NULL,'synthetic-local-proof',${q(JSON.stringify(prepared))}::jsonb);`));
 check(receipt.state==='recorded'&&receipt.audit_complete===true,'Actual signature, consent and assigned fields must commit atomically');
 check(sql(`SELECT count(*) FROM paige_agreement_events WHERE agreement_id='${v.a.id}' AND signer_id='${signer.signer_id}' AND event_type='field_values_recorded';`)==='1','One exact original field receipt, never a separate execution ledger');
 return{checks,scope:'Original native prepared field/signature transaction with synthetic provider input; not hosted recipient/provider/customer acceptance'};
}
