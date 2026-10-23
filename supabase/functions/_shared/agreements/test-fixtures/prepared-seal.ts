// Synthetic native PDF fixture only. No identity, consent or signing authority.
import {hashDocument} from '../document.ts';
import {prepareAgreementFields,prepareAgreementFieldInput} from '../field-preparation.ts';
import {inspectAgreementPreparationPdf} from '../document-preparation.ts';

export const PREP_TENANT='00000000-0000-4000-8000-000000000001';
export const PREP_CLIENT='00000000-0000-4000-8000-000000000002';
export const PREP_SIGNER='00000000-0000-4000-8000-000000000003';
export const PREP_ID='00000000-0000-4000-8000-000000000004';
export async function preparedSealFixture(){
  const {PDFDocument,degrees}=await import('npm:pdf-lib@1.17.1');
  const pdf=await PDFDocument.create();
  for(const rotation of [0,90,180,270]){const page=pdf.addPage([600,800]);page.setCropBox(20,30,500,700);page.setRotation(degrees(rotation));}
  const bytes=await pdf.save(),digest=await hashDocument(bytes),document=await inspectAgreementPreparationPdf(bytes,digest);
  const source={tenant_id:PREP_TENANT,client_id:PREP_CLIENT,agreement_id:'6f1c2a1e-0000-4000-8000-000000000001',version:1,updated_at:'2026-06-01T10:00:00.000Z',status:'draft',
    signers:[{id:PREP_SIGNER,full_name:'Jordan Avery',email:'jordan@example.com',signer_role:'counterparty',signing_order:1,status:'pending'}]};
  const kinds=['signature','initials','signed_date','text','checkbox'] as const;
  const fields=document.pages.flatMap(page=>kinds.map((kind,i)=>({id:`00000000-0000-4000-8000-${String(page.page*10+i).padStart(12,'0')}`,signer_id:PREP_SIGNER,kind,page:page.page,x:30,y:40+i*65,width:220,height:34,required:true,label:kind})));
  const preparation=await prepareAgreementFields(source,document,fields);
  const values=fields.filter(field=>field.kind!=='signed_date').map(field=>({field_id:field.id,value:field.kind==='signature'?true:field.kind==='checkbox'?field.page%2===0:field.kind==='initials'?'JA':'Approved scope'}));
  const expected={tenant_id:PREP_TENANT,agreement_id:source.agreement_id,client_id:PREP_CLIENT,preparation_id:PREP_ID,preparation_sha256:preparation.preparation_sha256,signer_id:PREP_SIGNER,signed_at:'2026-06-01T12:00:00.000Z'};
  const fieldsInput=await prepareAgreementFieldInput(preparation,expected,values);
  return {presentedBytes:bytes,presentedSha256:digest,presentedKind:'file' as const,agreementTitle:'Neutral field proof',agreementId:source.agreement_id,tenantName:'Example Studio',
    parties:[{signerId:PREP_SIGNER,fullName:'Jordan Avery',email:'jordan@example.com',role:'counterparty',signingOrder:1,status:'signed',typedName:'Jordan Avery',
      signedAt:expected.signed_at,consentAt:'2026-06-01T11:59:40.000Z',consentSlug:'esign-consent',consentVersion:1,
      signingIp:null as string|null,signingUserAgent:null as string|null,signatureImagePng:null as Uint8Array|null}],
    events:[],sealedAtIso:'2026-06-01T12:00:01.000Z',preparedFields:{preparation_id:PREP_ID,preparation,inputs:[fieldsInput]}};
}
