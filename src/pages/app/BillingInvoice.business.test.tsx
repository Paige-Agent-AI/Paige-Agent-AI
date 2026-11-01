import {act} from "react";
import {createRoot,type Root} from "react-dom/client";
import {MemoryRouter,Route,Routes} from "react-router-dom";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import BillingInvoice from "./BillingInvoice";
import type {ClientPortalInvoicesState,PortalBillingReadContext} from "@/hooks/useClientPortalInvoices";
const f=vi.hoisted(()=>({state:null as unknown as ClientPortalInvoicesState,payment:vi.fn(),authority:vi.fn(),user:vi.fn(),session:vi.fn(),pdf:vi.fn(),download:vi.fn()}));
vi.mock("@/hooks/useClientPortalInvoices",async orig=>({...await orig<typeof import("@/hooks/useClientPortalInvoices")>(),useClientPortalInvoices:()=>f.state,readPortalInvoicePayment:(...a:unknown[])=>f.payment(...a),verifyPortalInvoiceAccess:(...a:unknown[])=>f.authority(...a)}));
vi.mock("@/hooks/useClientPortalBrand",()=>({useClientPortalBrand:()=>({tenant_name:"Test practice"})}));
vi.mock("@/integrations/supabase/client",()=>({supabase:{auth:{getUser:(...a:unknown[])=>f.user(...a),getSession:()=>f.session()}}}));
vi.mock("@/solo/sales/invoicePdf",()=>({readInvoicePdf:(...a:unknown[])=>f.pdf(...a),downloadInvoicePdf:(...a:unknown[])=>f.download(...a)}));
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const actor="e0919901-0000-4000-8000-000000000001",tenant="e0929901-0000-4000-8000-000000000001",client="e0939901-0000-4000-8000-000000000001",invoiceId="e0949901-0000-4000-8000-000000000001";
const scope=(contact=client,current:()=>boolean=()=>true):PortalBillingReadContext=>({scope:{actorId:actor,tenantId:tenant,clientId:contact},current});
const pending=<T,>()=>{let resolve!:(v:T)=>void;return {promise:new Promise<T>(r=>{resolve=r;}),resolve:(v:T)=>resolve(v)};};
const ready=()=>({state:"ready",request:{amountMinor:2000,currency:"usd",state:"customer_action_required",url:"https://checkout.stripe.com/c/pay/cs_test_scope",remainingMinor:2000,expiresAt:Date.now()+3_600_000},remainingMinor:2000,testProviderMinor:0,environment:"test"});
let root:Root,host:HTMLDivElement,network:ReturnType<typeof vi.fn>;const flush=async()=>{for(let i=0;i<80;i++)await Promise.resolve();};
const render=async()=>act(async()=>{root.render(<MemoryRouter initialEntries={['/app/billing/'+invoiceId]}><Routes><Route path="/app/billing/:invoiceId" element={<BillingInvoice/>}/></Routes></MemoryRouter>);await flush();});
beforeEach(()=>{vi.clearAllMocks();f.state={invoices:[{id:invoiceId,invoice_number:"TEST-1",status:"issued",currency:"usd",issued_at:"2026-01-01T00:00:00Z",due_date:null,amount_minor:2000,remaining_minor:2000,provider_verified_minor:0,manual_recorded_minor:0,test_provider_minor:0,payable:true,past_due:false}],balances:[],openCount:1,pastDueCount:0,invoiceCount:1,hasMore:false,businessName:"Test practice",loading:false,loadingMore:false,error:null,unavailable:false,multipleBusinesses:false,tenantId:tenant,scopeEpoch:0,loaded:true,requestContext:scope(),refresh:vi.fn().mockResolvedValue(undefined),loadMore:vi.fn().mockResolvedValue(undefined)};f.payment.mockResolvedValue(ready());f.authority.mockResolvedValue(undefined);f.user.mockResolvedValue({data:{user:{id:actor}},error:null});f.session.mockResolvedValue({data:{session:{user:{id:actor},access_token:"synthetic-invoice-actor"}},error:null});f.pdf.mockResolvedValue(new Blob(["%PDF-1.4 test"],{type:"application/pdf"}));network=vi.fn().mockImplementation(()=>Promise.resolve(new Response("<html><body>Original issued test invoice</body></html>",{headers:{"content-type":"text/html"}})));vi.stubGlobal("fetch",network);host=document.createElement("div");document.body.append(host);root=createRoot(host);});
afterEach(()=>{act(()=>root.unmount());host.remove();vi.unstubAllGlobals();vi.useRealTimers();});
it("the original payment read receives the exact selected customer context",async()=>{await render();expect(f.payment).toHaveBeenCalledWith({invoiceId,tenantId:tenant,context:f.state.requestContext});expect(host.querySelector('[data-testid=pay-now]')?.getAttribute('href')).toContain('cs_test_scope');});
it("the original HTML renderer is guarded before and after and captures only its supported Auth headers",async()=>{await render();expect(f.authority).toHaveBeenCalledTimes(2);expect(f.authority).toHaveBeenCalledWith(invoiceId,f.state.requestContext);expect(network.mock.calls[0][1].headers).toMatchObject({Authorization:"Bearer synthetic-invoice-actor"});expect(network.mock.calls[0][1].headers['x-client-portal-business']).toBeUndefined();expect(host.querySelector('iframe')?.getAttribute('srcdoc')).toContain('Original issued');});
it("replacement of the selected customer hides the old link and HTML before fresh requests settle",async()=>{await render();const old=pending<unknown>();f.payment.mockReturnValue(old.promise);f.authority.mockReturnValue(old.promise);f.state={...f.state,scopeEpoch:1,requestContext:scope("e0939901-0000-4000-8000-000000000002")};await render();expect(host.querySelector('[data-testid=pay-now]')).toBeNull();expect(host.querySelector('iframe')).toBeNull();old.resolve(ready());await act(flush);});
it("a late HTML response for the old selected customer cannot render",async()=>{const old=pending<Response>();network.mockReturnValueOnce(old.promise);await render();f.state={...f.state,scopeEpoch:1,invoices:[],loading:true,loaded:false};await render();old.resolve(new Response("<html>Old private invoice</html>",{headers:{"content-type":"text/html"}}));await act(flush);expect(host.querySelector('iframe')).toBeNull();expect(host.textContent).not.toContain('Old private invoice');});
it("an old PDF result cannot download after the customer context changes",async()=>{await render();const old=pending<Blob>();f.pdf.mockReturnValueOnce(old.promise);const button=Array.from(host.querySelectorAll('button')).find(x=>x.textContent?.includes('Download PDF'))!;await act(async()=>{button.click();await flush();});expect(f.pdf).toHaveBeenCalledTimes(1);f.state={...f.state,scopeEpoch:1,invoices:[],loading:true,loaded:false};await render();old.resolve(new Blob(['%PDF-1.4 retired'],{type:'application/pdf'}));await act(flush);expect(f.download).not.toHaveBeenCalled();});
it("an invalid current scope never begins renderer, PDF or payment work",async()=>{f.state={...f.state,requestContext:scope(client,()=>false)};await render();expect(network).not.toHaveBeenCalled();expect(f.payment).not.toHaveBeenCalled();expect(host.querySelector('iframe')).toBeNull();expect(host.querySelector('[data-testid=pay-now]')).toBeNull();});
it("an interrupted renderer times out with explicit recovery",async()=>{vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});network.mockReturnValue(new Promise(()=>{}));await render();await act(async()=>{vi.advanceTimersByTime(20_001);await flush();});expect(host.textContent).toContain("We couldn't open the invoice document");expect(Array.from(host.querySelectorAll('button')).some(x=>x.textContent==='Try again')).toBe(true);expect(host.querySelector('iframe')).toBeNull();});

it("an interrupted PDF Auth check finishes with recovery and cannot dispatch a late PDF",async()=>{vi.useFakeTimers({toFake:["setTimeout","clearTimeout"]});await render();const old=pending<{data:{user:{id:string}};error:null}>();f.user.mockReturnValue(old.promise);const button=Array.from(host.querySelectorAll("button")).find(x=>x.textContent?.includes("Download PDF"))!;await act(async()=>{button.click();await flush();});await act(async()=>{vi.advanceTimersByTime(20_001);await flush();});expect(host.textContent).toContain("The PDF couldn't be opened");expect(f.pdf).not.toHaveBeenCalled();old.resolve({data:{user:{id:actor}},error:null});await act(flush);expect(f.pdf).not.toHaveBeenCalled();expect(f.download).not.toHaveBeenCalled();});

const actualInvoice=(patch:Partial<ClientPortalInvoicesState['invoices'][number]>={})=>{f.state={...f.state,invoices:[{...f.state.invoices[0],payment_evidence_version:2,issued_snapshot_version:1,...patch}]};};
it('legacy payment balance cannot turn an actual TEST-only outstanding invoice into a settlement',async()=>{
 actualInvoice({test_provider_minor:2000});f.payment.mockResolvedValue({...ready(),remainingMinor:0,testProviderMinor:2000,request:null});
 await render();expect(host.querySelector('[data-testid=payment-owed]')?.textContent).toContain('20.00');expect(host.querySelector('[data-testid=payment-test-settled]')).toBeNull();expect(host.querySelector('[data-testid=payment-paid]')).toBeNull();expect(host.querySelector('[data-testid=pay-now]')).toBeNull();
 expect(host.textContent).toContain("couldn't check for a payment link");expect(f.state.refresh).toHaveBeenCalledTimes(1);
});
it('fully LIVE-paid actual invoice remains paid despite historical TEST evidence',async()=>{
 actualInvoice({remaining_minor:0,provider_verified_minor:2000,test_provider_minor:2000,payable:false});await render();
 expect(host.querySelector('[data-testid=payment-paid]')).not.toBeNull();expect(host.querySelector('[data-testid=payment-test-settled]')).toBeNull();expect(host.textContent).toContain('payment provider');expect(host.textContent).toContain('did not reduce');expect(f.payment).not.toHaveBeenCalled();
});
it('a current native actual payment request keeps the correct amount and original hosted destination',async()=>{
 actualInvoice({remaining_minor:1000,provider_verified_minor:1000,test_provider_minor:500});f.payment.mockResolvedValue({...ready(),paymentEvidenceVersion:2,remainingMinor:1000,testProviderMinor:500,environment:'live',request:{...ready().request,amountMinor:1000,remainingMinor:1000}});
 await render();expect(host.querySelector('[data-testid=payment-owed]')?.textContent).toContain('10.00');expect(host.querySelector('[data-testid=pay-now]')?.getAttribute('href')).toContain('cs_test_scope');expect(host.querySelector('[data-testid=test-link]')).toBeNull();expect(f.state.refresh).not.toHaveBeenCalled();
});
it.each([
 {remainingMinor:0,testProviderMinor:0,request:null},
 {remainingMinor:1000,testProviderMinor:0,request:{...ready().request,remainingMinor:1000}},
 {remainingMinor:2000,testProviderMinor:10,request:ready().request},
 {remainingMinor:2000,testProviderMinor:0,request:{...ready().request,currency:'eur'}},
])('a conflicting actual request cannot override current invoice money or expose a stale link',async patch=>{
 actualInvoice();f.payment.mockResolvedValue({...ready(),paymentEvidenceVersion:2,...patch});await render();
 expect(host.querySelector('[data-testid=payment-owed]')?.textContent).toContain('20.00');expect(host.querySelector('[data-testid=pay-now]')).toBeNull();expect(host.querySelector('[data-testid=payment-paid]')).toBeNull();expect(host.textContent).toContain("couldn't check for a payment link");expect(f.state.refresh).toHaveBeenCalledTimes(1);
});
it('new actual payment evidence cannot silently reinterpret a legacy list balance',async()=>{
 f.payment.mockResolvedValue({...ready(),paymentEvidenceVersion:2});await render();expect(host.querySelector('[data-testid=pay-now]')).toBeNull();expect(host.textContent).toContain("couldn't check for a payment link");expect(f.state.refresh).toHaveBeenCalledTimes(1);
});
it('representation changes re-read the original payment request even if amount and link flag are unchanged',async()=>{
 await render();expect(f.payment).toHaveBeenCalledTimes(1);actualInvoice();f.payment.mockResolvedValue({...ready(),paymentEvidenceVersion:2});await render();expect(f.payment).toHaveBeenCalledTimes(2);expect(host.querySelector('[data-testid=pay-now]')).not.toBeNull();
});
it('voided actual invoices preserve the original refusal to collect even with TEST and stale request evidence',async()=>{
 actualInvoice({status:'void',test_provider_minor:2000,payable:false});await render();expect(host.querySelector('[data-testid=payment-void]')).not.toBeNull();expect(host.querySelector('[data-testid=pay-now]')).toBeNull();expect(f.payment).not.toHaveBeenCalled();
});
it('an actual manual correction reopens the native amount rather than the historical TEST settlement',async()=>{
 actualInvoice({test_provider_minor:2000});f.payment.mockResolvedValue({...ready(),paymentEvidenceVersion:2,remainingMinor:2000,testProviderMinor:2000,request:{...ready().request,state:'settled',url:null}});await render();
 expect(host.querySelector('[data-testid=payment-owed]')?.textContent).toContain('20.00');expect(host.querySelector('[data-testid=payment-test-settled]')).toBeNull();expect(host.querySelector('[data-testid=payment-paid]')).toBeNull();expect(host.textContent).toContain('moved no money');
});
