export const fixture={mode:new URLSearchParams(location.search).get('mode')??'ready',token:'a'.repeat(64),release:()=>{},navigate:async(_token:string,_mode:string)=>{},calls:[] as string[]};
(window as unknown as {signingFixture:typeof fixture}).signingFixture=fixture;
const row=()=>({document_title:'Synthetic service agreement',document_body:fixture.mode==='text'?'Historical text-only agreement. Read and inspect this retained wording.':null,document_path:fixture.mode==='text'?null:'retained-document',business_name:'Synthetic service business',brand:{},signer_display_name:'Synthetic Signer',amount_minor:fixture.mode==='text'?null:350000,amount_currency:fixture.mode==='text'?null:'usd',term_summary:'custom',expires_at:'2099-10-15T00:00:00Z',signature_state:'sent',is_valid:true});
export const supabase={
  rpc:async(name:string)=>{
    fixture.calls.push(name);
    if(name!=='peek_agreement_signing')throw new Error('No synthetic signing/decline act is permitted');
    if(fixture.mode==='denied')return {data:[],error:null};
    if(fixture.mode==='error')return {data:null,error:{message:'Synthetic transport unavailable'}};
    return {data:[row()],error:null};
  },
  functions:{invoke:async(name:string)=>{
    fixture.calls.push(name);
    if(!name.startsWith('agreement-document?token='))throw new Error('No provider, notification or signature act is permitted');
    if(fixture.mode==='failed')return {data:null,error:{message:'Synthetic document unavailable'}};
    if(fixture.mode==='pending')await new Promise<void>(resolve=>{fixture.release=resolve;});
    const response=await fetch('/scripts/proof/e04-signing-ui/fixtures/retained.pdf');
    return {data:await response.blob(),error:null};
  }},
};
