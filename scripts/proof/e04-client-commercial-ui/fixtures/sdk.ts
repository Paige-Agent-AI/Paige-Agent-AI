// Work-only synthetic SDK transport. Never imported by a production build.
export const id=(n:number)=>`ec041105-0000-4000-8000-${String(n).padStart(12,'0')}`;
export const actor=id(1),tenant=id(2),client=id(3),invoice=id(4);
const date='2026-10-14T12:00:00+00:00';
let phase='ready';let signedIn=true;
const listeners=new Set<(event:string,session:{user:{id:string}}|null)=>void>();
export function scenario(value:string){phase=value;signedIn=value!=='denied';}
export function signOut(){signedIn=false;for(const listener of listeners)listener('SIGNED_OUT',null);}
export const supabase={
 auth:{getUser:async()=>({data:{user:signedIn?{id:actor}:null},error:null}),
  getSession:async()=>({data:{session:signedIn?{user:{id:actor},access_token:'synthetic-browser-transport-only'}:null},error:null}),
  onAuthStateChange:(listener:(event:string,session:{user:{id:string}}|null)=>void)=>{listeners.add(listener);return {data:{subscription:{unsubscribe:()=>listeners.delete(listener)}}};}},
 from:()=>{throw Error('Raw CRM transport is not available in this fixture');},
 rpc:async(name:string,args:Record<string,unknown>)=>{
  if(phase==='loading')return new Promise(()=>{});
  if(phase==='offline')return {data:null,error:{code:'NETWORK'}};
  if(!signedIn)return {data:null,error:{code:'42501'}};
  if(name==='client_portal_self_profile')return {data:{id:client,tenant_id:tenant,linked_user_id:actor},error:null};
  const page=Boolean(args.p_after),empty=phase==='empty',hasMore=phase==='partial'&&!page,test=phase==='test';
  const row={id:page?id(5):invoice,invoice_number:page?'SYN-2':'SYN-1',status:'issued',currency:'usd',issued_at:date,due_date:'2026-10-15',issued_snapshot_version:1,
   amount_minor:'350000',allocated_minor:'45000',remaining_minor:'305000',manual_recorded_minor:'2000',provider_verified_minor:'43000',test_provider_minor:test?'3000':'0',document_available:true};
  return {data:{schema_version:1,actor_id:actor,tenant_id:tenant,client_id:client,invoices:empty?[]:[row],invoice_count:empty?0:hasMore?2:1,has_more:hasMore,
   next_cursor:hasMore?{issued_at:date,id:invoice}:null,balances:empty?[]:[{currency:'usd',remaining_minor:phase==='large'?'9007199254740993123456':'305000',manual_recorded_minor:'2000',provider_verified_minor:'43000',test_provider_minor:test?'3000':'0'}],invoice:null,
   next_payment:{state:'unavailable',reason:'effective_due_obligation_not_recorded'},engagement_completion:{state:'not_evaluated'},balance_basis:'canonical_invoice_allocations',read_at:date},error:null};
 }
};
