export const fixture={mode:new URLSearchParams(location.search).get('mode')??'ready',token:'a'.repeat(64),release:()=>{},navigate:async(_token:string,_mode:string)=>{},calls:[] as string[],requests:[] as {name:string;body:unknown}[]};
(window as unknown as {signingFixture:typeof fixture}).signingFixture=fixture;
const row=()=>({document_title:'Synthetic service agreement',document_body:fixture.mode.startsWith('text')?'Historical text-only agreement. Read and inspect this retained wording.':null,document_path:fixture.mode.startsWith('text')?null:'retained-document',business_name:'Synthetic service business',brand:{},signer_display_name:'Synthetic Signer',amount_minor:fixture.mode.startsWith('text')?null:350000,amount_currency:fixture.mode.startsWith('text')?null:'usd',term_summary:'custom',expires_at:'2099-10-15T00:00:00Z',signature_state:'sent',is_valid:true});
const receipt=(completed:boolean,audit=true)=>({ok:true,state:'recorded',signed_at:'2026-10-23T12:00:00Z',audit_complete:audit,replayed:false,completed});
export const supabase={
  rpc:async(name:string)=>{
    fixture.calls.push(name);
    if(name==='decline_agreement_signing'&&fixture.mode==='decline-refused')return {data:{ok:false},error:null};
    if(name==='decline_agreement_signing'&&fixture.mode==='decline-confirmed')return {data:{ok:true},error:null};
    if(name!=='peek_agreement_signing')throw new Error('No synthetic signing/decline act is permitted');
    if(fixture.mode==='denied')return {data:[],error:null};
    if(fixture.mode==='error')return {data:null,error:{message:'Synthetic transport unavailable'}};
    return {data:[row()],error:null};
  },
  functions:{invoke:async(name:string,options?:{body?:Record<string,unknown>})=>{
    fixture.calls.push(name);
    fixture.requests.push({name,body:options?.body});
    if(name==='sign-agreement'&&options?.body?.check_only===true){
      if(fixture.mode==='text-recover-recorded')return {data:{...receipt(false),replayed:true},error:null};
      if(fixture.mode==='text-recover-completed')return {data:{...receipt(true),replayed:true},error:null};
      if(fixture.mode==='text-recover-audit')return {data:{...receipt(false,false),replayed:true},error:null};
      if(fixture.mode==='text-recover-refused')return {data:null,error:{context:new Response(JSON.stringify({ok:false}),{status:404})}};
      return {data:null,error:null};
    }
    if(name==='sign-agreement'&&fixture.mode.startsWith('text-recover'))return {data:null,error:null};
    if(name==='sign-agreement'&&fixture.mode==='signature-recorded')return {data:receipt(false),error:null};
    if(name==='sign-agreement'&&fixture.mode==='completed')return {data:receipt(true),error:null};
    if(name==='sign-agreement'&&fixture.mode==='uncertain')return {data:null,error:null};
    if(!name.startsWith('agreement-document?token='))throw new Error('No provider, notification or signature act is permitted');
    if(fixture.mode==='failed')return {data:null,error:{message:'Synthetic document unavailable'}};
    if(fixture.mode==='pending')await new Promise<void>(resolve=>{fixture.release=resolve;});
    const response=await fetch('/scripts/proof/e04-signing-ui/fixtures/retained.pdf');
    return {data:await response.blob(),error:null};
  }},
};
