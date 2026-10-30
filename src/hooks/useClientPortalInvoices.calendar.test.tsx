import {beforeEach,expect,it,vi} from "vitest";
import {parseInvoicePage,readPortalInvoices,type PortalBillingReadContext} from "./useClientPortalInvoices";
import captured from "./fixtures/client-portal-invoices.local-db.json";

const f=vi.hoisted(()=>({reply:vi.fn(),calls:[] as Array<{name:string;args:Record<string,unknown>;headers:Record<string,string>}>}));
vi.mock("@/integrations/supabase/client",()=>({supabase:{rpc:(name:string,args:Record<string,unknown>)=>{
 const headers:Record<string,string>={};const query={setHeader:(key:string,value:string)=>{headers[key]=value;return query;},
  then:(resolve:(v:unknown)=>unknown,reject?:(e:unknown)=>unknown)=>Promise.resolve().then(()=>{
   const call={name,args,headers:{...headers}};f.calls.push(call);return f.reply(call);
  }).then(resolve,reject)};return query;
 },auth:{getUser:async()=>({data:{user:{id:actor}},error:null}),
  getSession:async()=>({data:{session:{user:{id:actor},access_token:"synthetic-invoice-calendar"}},error:null})}}}));
const actor="e0998100-0000-4000-8000-000000000001",tenant="e0998100-0000-4000-8000-000000000002",client="e0998100-0000-4000-8000-000000000003";
const context:PortalBillingReadContext={scope:{actorId:actor,tenantId:tenant,clientId:client},current:()=>true};
function page(){return{schema_version:2,tenant_id:tenant,business_name:"Test Advisory",invoices:[{
 id:"e0998100-0000-4000-8000-000000000004",invoice_number:"TEST-001",status:"issued",currency:"usd",issued_at:"2026-10-29T00:15:00Z",
 due_date:"2026-10-28",amount_minor:"10000",remaining_minor:"10000",provider_verified_minor:"0",manual_recorded_minor:"0",test_provider_minor:"0",
 payable:false,past_due:false,issued_snapshot_version:2}],balances:[{currency:"usd",remaining_minor:"10000",provider_verified_minor:"0",manual_recorded_minor:"0",test_provider_minor:"0"}],
 invoice_count:1,open_count:1,has_more:false,next_cursor:null,read_at:"2026-10-29T00:15:00Z",
 calendar:{state:"configured",zone:"America/Los_Angeles",local_date:"2026-10-28"}};}
beforeEach(()=>{f.calls=[];f.reply.mockReset();f.reply.mockResolvedValue({data:page(),error:null});});

it("keeps the original schema1 consumer and original captured financial facts compatible",()=>{
 const p=parseInvoicePage(captured.list)!;expect(p.invoices).toHaveLength(captured.list.invoices.length);
 expect(p.invoice_count).toBe(captured.list.invoice_count);expect(p.open_count).toBe(captured.list.open_count);
 expect(p).not.toHaveProperty("calendar");
});
it("reads original business date and overdue facts rather than using the customer's or UTC date",()=>{
 const source=page(),p=parseInvoicePage(source)!;
 expect(p).toMatchObject({calendar:source.calendar,read_at:source.read_at,invoices:[{past_due:false,issued_snapshot_version:2,remaining_minor:10000}]});
 expect(source.invoices[0].remaining_minor).toBe("10000");
});
for(const state of ["missing","invalid"] as const)it("keeps an "+state+" business calendar and unknown overdue status without losing invoice balances",()=>{
 const source={...page(),calendar:{state,zone:null,local_date:null},invoices:[{...page().invoices[0],past_due:null}]};
 expect(parseInvoicePage(source)).toMatchObject({calendar:source.calendar,invoices:[{past_due:null}],open_count:1,balances:[{remaining_minor:10000}]});
});
it("retains original paid, void and undated false-overdue semantics with unknown calendar",()=>{
 const source=page();const unknown={state:"missing",zone:null,local_date:null};
 for(const invoice of [{...source.invoices[0],remaining_minor:"0"},{...source.invoices[0],status:"void"},{...source.invoices[0],due_date:null}])
  expect(parseInvoicePage({...source,calendar:unknown,invoices:[invoice]})).toMatchObject({invoices:[{past_due:false}]});
});
it("accepts source-backed past due after the original business day has changed",()=>{
 const source=page();source.calendar.local_date="2026-10-29";source.invoices[0].past_due=true;
 expect(parseInvoicePage(source)?.invoices[0].past_due).toBe(true);
});
it("requests the versioned calendar admission using the same verified actor and relationship",async()=>{
 const p=await readPortalInvoices({context});expect(p).toMatchObject({calendar:page().calendar});
 expect(f.calls).toHaveLength(1);expect(f.calls[0]).toEqual({name:"client_portal_invoices_calendar_scoped",
  args:{p_tenant_id:tenant,p_expected_client_id:client,p_limit:20,p_after:null},
  headers:{"x-client-portal-business":tenant,Authorization:"Bearer synthetic-invoice-calendar"}});
});
it("never falls back to UTC or another unscoped request when the opt-in contract is missing",async()=>{
 f.reply.mockResolvedValue({data:null,error:{code:"42883",message:"Missing contract"}});
 await expect(readPortalInvoices({context})).rejects.toMatchObject({code:"42883"});expect(f.calls).toHaveLength(1);
 expect(f.calls[0].name).toBe("client_portal_invoices_calendar_scoped");
});
it("a legacy payload cannot silently satisfy the selected business-calendar read",async()=>{
 f.reply.mockResolvedValue({data:{...captured.list,tenant_id:tenant},error:null});await expect(readPortalInvoices({context})).rejects.toThrow();expect(f.calls).toHaveLength(1);
});
it("legacy consumers retain the original RPC parameters without the opt-in",async()=>{
 f.reply.mockResolvedValue({data:captured.list,error:null});await readPortalInvoices();
 expect(f.calls[0]).toEqual({name:"client_portal_invoices",args:{p_tenant_id:null,p_limit:20,p_after:null},headers:{}});
});
for(const [name,change]of [
 ["invented calendar zone",(p:ReturnType<typeof page>)=>({...p,calendar:{state:"missing",zone:"UTC",local_date:null}})],
 ["invented calendar day",(p:ReturnType<typeof page>)=>({...p,calendar:{state:"invalid",zone:null,local_date:"2026-10-29"}})],
 ["impossible calendar date",(p:ReturnType<typeof page>)=>({...p,calendar:{...p.calendar,local_date:"2026-02-30"}})],
 ["calendar controls",(p:ReturnType<typeof page>)=>({...p,calendar:{...p.calendar,zone:"UTC\u0000"}})],
 ["unminimized calendar",(p:ReturnType<typeof page>)=>({...p,calendar:{...p.calendar,owner_notes:"private"}})],
 ["unminimized financial source",(p:ReturnType<typeof page>)=>({...p,_native_sources:{all_facts_identity:"private"}})],
 ["false overdue knowledge",(p:ReturnType<typeof page>)=>({...p,calendar:{state:"missing",zone:null,local_date:null},invoices:[{...p.invoices[0],past_due:true}]})],
 ["unknown date mislabeled not overdue",(p:ReturnType<typeof page>)=>({...p,calendar:{state:"missing",zone:null,local_date:null}})],
 ["known date mislabeled unknown",(p:ReturnType<typeof page>)=>({...p,invoices:[{...p.invoices[0],past_due:null}]})],
 ["invalid issued version",(p:ReturnType<typeof page>)=>({...p,invoices:[{...p.invoices[0],issued_snapshot_version:0}]})],
] as const)it("refuses "+name+" without manufacturing financial facts",()=>{expect(()=>parseInvoicePage(change(page()))).toThrow();});
