import original from '../../../src/solo/sales/fixtures/agreement-document-source.json';
import {prepareAgreementFields} from '../../../supabase/functions/_shared/agreements/field-preparation';
import {projectPreparedSignatureReview} from '../../../supabase/functions/_shared/agreements/prepared-signature-review-contract';
export const fixture={mode:'ready',calls:[] as string[],actor:'a1111111-0000-4000-8000-000000000001',pending:null as null|(()=>void),record:null as Record<string,unknown>|null};
const bytes=Uint8Array.from(atob(original.bytes),c=>c.charCodeAt(0));
export function reset(mode:string){fixture.mode=mode;fixture.calls=[];fixture.pending=null;fixture.record=null;}
async function retained(){
  if(fixture.record)return structuredClone(fixture.record);
  const fields=fixture.mode==='issues'?[]:original.signers.map((s,index)=>({id:`f111111${index}-0000-4000-8000-000000000001`,signer_id:s.id,kind:'signature',page:1,x:40,y:400+index*70,width:200,height:42,required:true,label:s.full_name+' signature'}));
  const prepared=await prepareAgreementFields(original.source,original.document,fields),s=original.source;
  fixture.record={state:'retained',title:'Neutral supplied source',source:structuredClone(s),can_prepare:true,preparation_hold:null,document_signers:structuredClone(original.signers),can_edit:true,
    preparation:{id:'b1111111-0000-4000-8000-000000000001',agreement_id:s.agreement_id,client_id:s.client_id,revision_no:2,source_version:s.version,source_updated_at:s.updated_at,actor_user_id:fixture.actor,
      document_sha256:original.document.sha256,document_byte_length:bytes.length,manifest:prepared.manifest,preparation_sha256:prepared.preparation_sha256,event_id:'f1111111-0000-4000-8000-000000000001',is_selected:true,created_at:s.updated_at,source_scope:'agreement_and_parties',source_matches:true,commercial_verification:'not_applicable'}};
  return structuredClone(fixture.record);
}
const error=(code:string)=>({data:null,error:{context:new Response(JSON.stringify({code}),{headers:{'Content-Type':'application/json'}})}});
export const supabase={auth:{getSession:async()=>({data:{session:{user:{id:fixture.actor,is_anonymous:false},access_token:'synthetic-local-only'}},error:null})},functions:{invoke:async(name:string,args:{method:string;body?:Record<string,unknown>})=>{
  const q=new URL('https://local-fixture.invalid/'+name).searchParams,mode=q.get('preparation');fixture.calls.push(args.method+':'+(mode??'write'));
  const value=await retained(),s=original.source,p=value.preparation as Record<string,unknown>;
  if(args.method==='POST'){
    const c=args.body!,fields=c.action==='retain_fields'?c.fields:[],prepared=await prepareAgreementFields(s,original.document,fields);
    const next={...p,id:c.request_id,revision_no:Number(p.revision_no)+1,event_id:crypto.randomUUID(),manifest:prepared.manifest,preparation_sha256:prepared.preparation_sha256};
    fixture.record={...value,preparation:next};
    if(fixture.mode==='save_unknown')return error('unconfirmed');
    return {data:{ok:true,view:structuredClone(fixture.record),receipt:{state:'recorded',historical_receipt:true,id:next.id,event_id:next.event_id,revision_no:next.revision_no,document_sha256:next.document_sha256,preparation_sha256:next.preparation_sha256,is_selected:true}},error:null};
  }
  if(mode==='metadata'){
    if(fixture.mode==='empty'){const {preparation:_preparation,can_edit:_canEdit,...empty}=value;void _preparation;void _canEdit;return {data:{ok:true,view:{...empty,state:'none'}},error:null};}
    return {data:{ok:true,view:value},error:null};
  }
  if(mode==='pdf')return {data:new Blob([bytes],{type:'application/pdf'}),error:null};
  if(mode==='signing_review'){
    if(fixture.mode==='loading')await new Promise<void>(resolve=>{fixture.pending=resolve;});
    if(fixture.mode==='network')throw Error('Synthetic offline read');
    if(fixture.mode==='source_changed')return error('source_changed');
    if(fixture.mode==='access_denied')return error('access_unverified');
    const review=await projectPreparedSignatureReview({tenant_id:s.tenant_id,agreement_id:s.agreement_id,preparation_id:p.id,preparation_sha256:p.preparation_sha256,expected_source:{client_id:s.client_id,version:s.version,updated_at:s.updated_at}},value);
    return {data:{ok:true,review},error:null};
  }
  return error('invalid_request');
}},rpc:()=>({setHeader(){return this;},abortSignal:async()=>({data:{items:[],has_more:false},error:null})})};
