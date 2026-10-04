import { readInvoiceDeliveryReadiness, type InvoiceReadinessAdmin } from "../_shared/sales-invoice-delivery/readiness-reader.ts";
import { PAIGE_APP_ORIGIN } from "../_shared/canonical-app-url.ts";
import { invoicePublicOriginReady } from "../_shared/sales-invoice-delivery/binding.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.75.0';
import { parseSalesInvoiceCommand, UUID } from '../_shared/sales-invoice-command/contract.ts';
const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,x-client-info,apikey,content-type','Content-Type':'application/json','Cache-Control':'no-store'};
const respond=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers});
// Eligibility/read-only door. All execution remains in the canonical governed command endpoint.
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers});
 if(req.method!=='POST')return respond(405,{ok:false,code:'METHOD_NOT_ALLOWED'});
 const url=Deno.env.get('SUPABASE_URL')!,caller=createClient(url,Deno.env.get('SUPABASE_ANON_KEY')!,{global:{headers:{Authorization:req.headers.get('Authorization')??''}}});
 const {data:{user},error}=await caller.auth.getUser();
 if(error||!user||user.is_anonymous===true)return respond(401,{ok:false,code:'UNAUTHENTICATED'});
 let command:ReturnType<typeof parseSalesInvoiceCommand>,expected:string;
 try{const raw=await req.text();if(raw.length>4096)throw Error();const body=JSON.parse(raw);if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!['expected_tenant_id','command'].includes(k))||typeof body.expected_tenant_id!=='string'||!UUID.test(body.expected_tenant_id))throw Error();expected=body.expected_tenant_id;command=parseSalesInvoiceCommand(body.command);if(!['invoice.email_send','invoice.sms_send'].includes(command.action))throw Error()}catch{return respond(400,{ok:false,code:'DELIVERY_REQUEST_INVALID'})}
 const {data:tenant,error:tenantError}=await caller.rpc('current_user_tenant_id');
 if(tenantError||tenant!==expected)return respond(409,{ok:false,code:'WORKSPACE_CHANGED'});
 const admin=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
 const {data:member,error:memberError}=await admin.from('tenant_members').select('role,status').eq('user_id',user.id).eq('tenant_id',tenant).eq('status','active').maybeSingle();
 if(memberError||!['owner','admin'].includes(member?.role??''))return respond(403,{ok:false,code:'DELIVERY_FORBIDDEN'});
 if(!invoicePublicOriginReady(PAIGE_APP_ORIGIN))return respond(200,{ok:true,eligible:false,outcome:"needs_setup",code:"INVOICE_PUBLIC_ORIGIN_UNAVAILABLE",provider_execution_verified:false});
 const {data:preview,error:previewError}=await admin.rpc('preview_sales_invoice_delivery_command',{_actor_user_id:user.id,_expected_tenant_id:tenant,_command:command});
 if(previewError||!preview||typeof preview!=='object')return respond(503,{ok:false,code:'DELIVERY_ELIGIBILITY_UNAVAILABLE'});
 const {data:invoice,error:invoiceError}=await admin.rpc('_sales_invoice_read',{_tenant:tenant,_invoice:command.invoice_id});
 if(invoiceError)return respond(503,{ok:false,code:'DELIVERY_READINESS_UNAVAILABLE'});
 const readiness=await readInvoiceDeliveryReadiness(admin as unknown as InvoiceReadinessAdmin,{tenantId:tenant,invoice,channel:String(command.action)==='invoice.sms_send'?'sms':'email',connectorId:typeof command.connector_id==='string'?command.connector_id:null},key=>Deno.env.get(key));
 return respond(200,{ok:true,readiness,eligible:preview.eligible===true&&readiness.eligible,summary:typeof preview.summary==='string'?preview.summary:'Invoice email eligibility unavailable.',remaining_cents:preview.remaining_cents??null,provider_execution_verified:false});
});
