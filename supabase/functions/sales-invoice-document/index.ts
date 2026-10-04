import {createClient} from 'https://esm.sh/@supabase/supabase-js@2';
import {overRateLimit,trustedClientIp} from '../_shared/rateLimit.ts';
import {sha256Hex} from '../_shared/agreements/token.ts';
import {renderSalesInvoiceDocument} from '../_shared/sales-invoice-document.ts';
const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Cache-Control':'no-store','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",'X-Content-Type-Options':'nosniff'};
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
async function collectLedger(client:{rpc:(name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:unknown}>},name:string,args:Record<string,unknown>):Promise<unknown>{
  let first:Record<string,unknown>|null=null;const rows:unknown[]=[];let cursor:unknown=null;
  for(let page=0;page<10;page++){
    const result=await client.rpc(name,{...args,_limit:100,_cursor:cursor});
    if(result.error||!record(result.data)||!record(result.data.payment_ledger)||!Array.isArray(result.data.payment_ledger.rows))return null;
    const data=result.data,ledger=data.payment_ledger as Record<string,unknown>;
    if(!first)first=data;
    else if(data.version!==first.version||data.current_invoice_number!==first.current_invoice_number||ledger.as_of!==(first.payment_ledger as Record<string,unknown>).as_of)return null;
    if((ledger.rows as unknown[]).length>100)return null;
    rows.push(...ledger.rows as unknown[]);
    if(data.has_more!==true){const complete=rows.length===ledger.count;return {...first,payment_ledger:{...first.payment_ledger as Record<string,unknown>,rows,complete},ledger_complete:complete};}
    if(!data.next_cursor)return null;cursor=data.next_cursor;
  }
  return first?{...first,payment_ledger:{...first.payment_ledger as Record<string,unknown>,rows,complete:false},ledger_complete:false}:null;
}
const refuse=()=>new Response('This invoice link is unavailable. Ask the business for a new link.',{status:404,headers});
Deno.serve(async req=>{
  if(req.method==='OPTIONS')return new Response(null,{headers});
  if(req.method!=='GET')return new Response('GET only',{status:405,headers});
  const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
  if(await overRateLimit(db,`sales-invoice:ip:${trustedClientIp(req)}`,30,60))return new Response('Please wait and retry.',{status:429,headers});
  const url=new URL(req.url);const token=url.searchParams.get('token');let projection:unknown;
  if(token){
    if(!/^[0-9a-f]{64}$/.test(token))return refuse();
    projection=await collectLedger(db,'read_public_sales_invoice_payment_ledger',{_token_hash:await sha256Hex(token)});
    if(!projection)return refuse();
  }else{
    const invoiceId=url.searchParams.get('invoice_id');const tenantId=url.searchParams.get('tenant_id');
    const authorization=req.headers.get('authorization');
    if(!invoiceId||!tenantId||!authorization?.startsWith('Bearer '))return refuse();
    const caller=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_ANON_KEY')!,{auth:{persistSession:false},global:{headers:{Authorization:authorization}}});
    projection=await collectLedger(caller,'read_sales_invoice_payment_ledger',{_expected_tenant_id:tenantId,_invoice_id:invoiceId});
    if(!projection)return refuse();
  }
  const html=renderSalesInvoiceDocument(projection);if(!html)return refuse();
  return new Response(html,{headers:{...headers,'Content-Type':'text/html; charset=utf-8'}});
});
