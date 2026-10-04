import {createClient} from 'https://esm.sh/@supabase/supabase-js@2';
import {overRateLimit,trustedClientIp} from '../_shared/rateLimit.ts';
import {sha256Hex} from '../_shared/agreements/token.ts';
import {renderSalesInvoiceDocument} from '../_shared/sales-invoice-document.ts';
const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Cache-Control':'no-store','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",'X-Content-Type-Options':'nosniff'};
const refuse=()=>new Response('This invoice link is unavailable. Ask the business for a new link.',{status:404,headers});
Deno.serve(async req=>{
  if(req.method==='OPTIONS')return new Response(null,{headers});
  if(req.method!=='GET')return new Response('GET only',{status:405,headers});
  const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
  if(await overRateLimit(db,`sales-invoice:ip:${trustedClientIp(req)}`,30,60))return new Response('Please wait and retry.',{status:429,headers});
  const url=new URL(req.url);const token=url.searchParams.get('token');let projection:unknown;
  if(token){
    if(!/^[0-9a-f]{64}$/.test(token))return refuse();
    const result=await db.rpc('read_public_sales_invoice',{_token_hash:await sha256Hex(token)});
    if(result.error||!result.data)return refuse();projection=result.data;
  }else{
    const invoiceId=url.searchParams.get('invoice_id');const tenantId=url.searchParams.get('tenant_id');
    const authorization=req.headers.get('authorization');
    if(!invoiceId||!tenantId||!authorization?.startsWith('Bearer '))return refuse();
    const caller=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_ANON_KEY')!,{auth:{persistSession:false},global:{headers:{Authorization:authorization}}});
    const result=await caller.rpc('read_sales_invoice',{_expected_tenant_id:tenantId,_invoice_id:invoiceId});
    if(result.error||!result.data?.document)return refuse();projection=result.data;
  }
  const html=renderSalesInvoiceDocument(projection);if(!html)return refuse();
  return new Response(html,{headers:{...headers,'Content-Type':'text/html; charset=utf-8'}});
});
