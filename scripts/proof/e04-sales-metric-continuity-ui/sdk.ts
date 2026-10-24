// Synthetic, denied-network RPC/Auth port. No real client, secret, database or provider.
type Row=Record<string,unknown>;
export const A='a3400000-0000-4000-8000-000000000011',B='a3400000-0000-4000-8000-000000000022';
let epoch:string|null=A,issued=0,resolved=0;const rows=new Map<string,Row>(),revoked=new Set<string>(),listeners=new Set<()=>void>();
const emit=()=>listeners.forEach(fn=>fn());
export const proof={snapshot:()=>({issued,resolved,epoch}),subscribe:(fn:()=>void)=>{listeners.add(fn);return()=>{listeners.delete(fn);};},recheck:()=>window.dispatchEvent(new Event('online')),revoke:()=>{for(const ref of rows.keys())revoked.add(ref);window.dispatchEvent(new Event('online'));},scope:(next:string|null)=>{epoch=next;emit();}};
export const supabase={auth:{onAuthStateChange:(_fn:()=>void)=>({data:{subscription:{unsubscribe(){}}}})},async rpc(name:string,args:Record<string,string>){
 const owner=epoch;
 if(name==='resolve_analytics_evidence_reference'){
  resolved++;emit();await new Promise(done=>window.setTimeout(done,450));const row=rows.get(args.p_evidence_ref);
  return row&&row.account_epoch===owner&&!revoked.has(args.p_evidence_ref)?{data:structuredClone(row),error:null}:{data:null,error:{code:'42501'}};
 }
 if(name!=='issue_analytics_evidence_bundle')throw new Error('Denied-network fixture: unexpected RPC');
 issued++;emit();await new Promise(done=>window.setTimeout(done,180));if(!owner||args.p_account_epoch!==owner)return{data:null,error:{code:'42501'}};
 const key=args.p_metric_key,money=/pipeline|receivables|cash|allocations|issued_amount/.test(key),empty=/cash|allocations/.test(key),asOf=new Date().toISOString();
 // Every response gets a unique opaque token even while parallel calls complete.
 const token='aneb_v1_'+(rows.size+1).toString(16).padStart(64,'0');
 const row:Row={metric_key:key,metric_version:args.p_metric_version,owner_department:'sales',label:'Canonical '+key.split('.').at(-1),definition:'Synthetic original-record contract for local rendering only.',formula:'Native metric producer supplies the measurement.',range:{key:args.p_range_key,start:args.p_range_start,end:args.p_range_end,bounds:'[start,end)',timezone:'UTC',semantics:'current_snapshot'},dimensions:{},values:money?{kind:'currency_totals',by_currency:empty?[]:[{currency:'usd',amount_minor:key.includes('overdue')?'30000':'350000',record_count:1}],breakdown:[]}:{kind:'count',count:1},unit:money?'currency_minor':'count',source_refs:['local.synthetic_contract'],as_of:asOf,freshness:{queried_at:asOf,source_updated_through:null},coverage:{state:'complete',candidate_count:empty?0:1,contributing_count:empty?0:1,excluded_count:0},exclusions:[],truth_state:'LIVE',caveats:['Synthetic local rendering. No actual business, signing, invoice, cash, provider settlement or service evidence.'],source_revision_ref:'sr_v1_'+'a'.repeat(64),account_epoch:owner,account_epoch_ref:'ae_v1_'+'b'.repeat(64),evidence_ref:token,reference_expires_at:new Date(Date.now()+900000).toISOString()};
 if(key==='sales.receivables.overdue_current'){row.source_refs=['public.paige_invoices','public.tenant_business_time_zones'];row.business_time_zone={state:'configured',zone:'UTC',set_at:new Date(Date.now()-86400000).toISOString(),as_of_date:asOf.slice(0,10)};}
 rows.set(token,structuredClone(row));return{data:row,error:null};
}};
