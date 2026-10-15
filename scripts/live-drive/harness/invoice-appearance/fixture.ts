// Deterministic local adapters only. No authenticated tenant, upload, invoice or send is performed.
import {supabase as existing} from '../sales-invoice-lifecycle/fixture';
import {DEFAULT_INVOICE_APPEARANCE} from '../../../../src/solo/sales/invoicePreferences';
const tenant='11111111-1111-4111-8111-111111111111';
let version=0,settings={...DEFAULT_INVOICE_APPEARANCE};
const mode=new URLSearchParams(location.search).get('state');
export function useSoloBusiness(){return {name:'Example Studio',brand:{support_email:'studio@example.test',business_phone:null,website:'example.test',logo_url:null,primary_color:'#4931ac'}}}
export const supabase={...existing,rpc:async(name:string,args:Record<string,unknown>)=>{
 if(name==='read_sales_invoice_preferences')return mode==='error'?{data:null,error:{message:'Fixture read unavailable'}}:{data:{tenant_id:tenant,version,settings,can_manage:mode!=='readonly'},error:null};
 return existing.rpc(name,args);
},functions:{invoke:async(name:string,input:{body:Record<string,unknown>})=>{const command=input.body.command as Record<string,unknown>;
 if(command?.action==='invoice.settings_update'){
  if(mode==='save-error')return {data:{outcome:'refused',message:'Fixture version changed. Reload preferences before retrying.'},error:null};
  if(mode==='unknown')throw Error('Fixture network interruption');
  if(input.body.approved_fingerprint){settings=command.settings as typeof settings;version++;return {data:{ok:true,preferences:{tenant_id:tenant,version,settings,can_manage:true}},error:null};}
  return {data:{outcome:'approval_required',fingerprint:'0123456789abcdef',summary:'Save these invoice defaults for future invoices. Existing issued documents retain their original numbering and appearance.',preview:{version,settings:command.settings}},error:null};
 }
 return existing.functions.invoke(name,input);
}}};
