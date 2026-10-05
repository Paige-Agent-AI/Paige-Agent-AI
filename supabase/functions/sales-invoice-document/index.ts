import {collectInvoiceLedger} from '../_shared/sales-invoice-ledger.ts';
import {createClient} from 'https://esm.sh/@supabase/supabase-js@2';
import {overRateLimit,trustedClientIp} from '../_shared/rateLimit.ts';
import {sha256Hex} from '../_shared/agreements/token.ts';
import {renderSalesInvoiceDocument} from '../_shared/sales-invoice-document.ts';
import {renderDocumentPdf} from '../_shared/document-pdf.ts';
const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Cache-Control':'no-store','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",'X-Content-Type-Options':'nosniff'};
const refuse=()=>new Response('This invoice link is unavailable. Ask the business for a new link.',{status:404,headers});
Deno.serve(async req=>{
  if(req.method==='OPTIONS')return new Response(null,{headers});
  if(req.method!=='GET')return new Response('GET only',{status:405,headers});
  const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
  if(await overRateLimit(db,`sales-invoice:ip:${trustedClientIp(req)}`,30,60))return new Response('Please wait and retry.',{status:429,headers});
  const url=new URL(req.url);const token=url.searchParams.get('token');let projection:unknown;
  if(token){
    if(!/^[0-9a-f]{64}$/.test(token))return refuse();
    if(url.searchParams.get('format')==='payment-request'){
      const {data,error}=await db.rpc('read_public_sales_invoice_payment_request',{_token_hash:await sha256Hex(token)});
      if(error||!data)return refuse();
      return new Response(JSON.stringify(data),{headers:{...headers,'Content-Type':'application/json'}});
    }
    projection=await collectInvoiceLedger(db,'read_public_sales_invoice_payment_ledger',{_token_hash:await sha256Hex(token)});
    if(!projection)return refuse();
  }else{
    const invoiceId=url.searchParams.get('invoice_id');const tenantId=url.searchParams.get('tenant_id');
    const authorization=req.headers.get('authorization');
    if(!invoiceId||!tenantId||!authorization?.startsWith('Bearer '))return refuse();
    const caller=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_ANON_KEY')!,{auth:{persistSession:false},global:{headers:{Authorization:authorization}}});
    projection=await collectInvoiceLedger(caller,'read_sales_invoice_payment_ledger',{_expected_tenant_id:tenantId,_invoice_id:invoiceId});
    if(!projection)return refuse();
  }
  const html=renderSalesInvoiceDocument(projection);if(!html)return refuse();
  if(url.searchParams.get('format')==='pdf'){
    // renderDocumentPdf creates this full-view Uint8Array from response.arrayBuffer().
    try {const bytes=await renderDocumentPdf(html);return new Response(bytes.buffer as ArrayBuffer,{headers:{...headers,'Content-Type':'application/pdf','Content-Disposition':'attachment; filename="invoice.pdf"'}});}
    catch{return new Response('PDF could not be prepared. Retry the current invoice.',{status:503,headers});}
  }
  return new Response(html,{headers:{...headers,'Content-Type':'text/html; charset=utf-8'}});
});
