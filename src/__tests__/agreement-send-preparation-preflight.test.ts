// @vitest-environment node
import {readFileSync} from 'node:fs';
import {transpileModule,ModuleKind,ScriptTarget} from 'typescript';
import {it,expect} from 'vitest';
import {verifyRetainedAgreementPdf} from '../../supabase/functions/_shared/agreements/retained-document';
import {sha256Hex} from '../../supabase/functions/_shared/agreements/token';
import {e04Id} from '../test/fixtures/e04-commercial-presentation';
const source=readFileSync('supabase/functions/agreement-send/index.ts','utf8').replace(/^import .*;\r?\n/gm,'');
const compiled=transpileModule(source,{compilerOptions:{module:ModuleKind.None,target:ScriptTarget.ES2022}}).outputText;
type Options={ready?:boolean;download?:'missing'|'wrong'|'throw';legacy?:boolean;provider?:boolean;admin?:boolean};
async function setup(options:Options={}){
 const tenant=e04Id(1),actor=e04Id(9),agreement=e04Id(4),calls:Array<{name:string;args?:unknown}>=[];
 // Synthetic storage bytes test preflight control flow, not the actual PDF renderer.
 const bytes=new TextEncoder().encode('%PDF-synthetic-retained-fixture'),hash=await sha256Hex(bytes);
 const row={id:agreement,tenant_id:tenant,title:'Synthetic retained agreement',body_source:'paige_draft',body_markdown:'Recorded text',status:'completed',commercial_terms_id:options.legacy?null:e04Id(5),content_storage_key:'synthetic-owned-key',content_sha256:hash};
 const caller={auth:{getUser:async()=>({data:{user:{id:actor}},error:null})},rpc:async(name:string)=>({data:name==='current_user_tenant_id'?tenant:options.admin!==false,error:null})};
 const admin={rpc:async(name:string,args:unknown)=>{calls.push({name,args});if(name!=='check_sales_agreement_preparation')throw Error('Unexpected mutation RPC');return {data:options.ready!==false,error:null};},
  from:(table:string)=>{calls.push({name:'from:'+table});const q:Record<string,unknown>={};q.select=()=>q;q.eq=()=>q;q.maybeSingle=async()=>({data:table==='tenants'?{name:'Synthetic',account_type:'solo'}:row,error:null});return q;},
  storage:{from:(bucket:string)=>({download:async(key:string)=>{calls.push({name:'download',args:{bucket,key}});if(options.download==='throw')throw Error('Private storage failure');return {data:options.download==='missing'?null:new Blob([options.download==='wrong'?'%PDF-different':bytes]),error:null};}})},
 };
 let handler!:(request:Request)=>Promise<Response>;
 const forbidden=()=>{throw Error('No preflight test may mint, render, mutate or send');};
 const bindings={Deno:{serve:(fn:typeof handler)=>handler=fn,env:{get:(key:string)=>key==='PUBLIC_SITE_URL'?undefined:key==='RESEND_API_KEY'&&options.provider===false?undefined:key}},
  createClient:(_url:string,key:string)=>key==='SUPABASE_ANON_KEY'?caller:admin,verifyRetainedAgreementPdf,
  overRateLimit:async()=>{calls.push({name:'rate_limit'});return false;},renderPresentedPdf:forbidden,hashDocument:forbidden,assertDocumentIsRenderable:forbidden,assertNamesAreStampable:forbidden,
  inspectUploadedPdf:forbidden,isOwnedByTenant:forbidden,planPresentedDocument:forbidden,UnrenderableDocumentError:Error,UnrenderableNameError:Error,
  expiryFromNow:forbidden,mintSignerToken:forbidden,sha256Hex,SIGNING_TOKEN_TTL_DAYS:30,tenantContactForDisclosure:forbidden,
 };
 new Function(...Object.keys(bindings),compiled)(...Object.values(bindings));
 return {tenant,actor,agreement,calls,invoke:async(body:unknown={agreementId:agreement,expectedTenantId:tenant})=>{const response=await handler(new Request('https://synthetic.invalid/agreement-send',{method:'POST',headers:{Authorization:'Bearer synthetic'},body:JSON.stringify(body)}));return {status:response.status,body:await response.json()};}};
}
it('refuses a stale expected workspace before rate counter, document, storage, token or send',async()=>{
 const h=await setup(),r=await h.invoke({agreementId:h.agreement,expectedTenantId:e04Id(99)});expect(r.status).toBe(409);expect(h.calls.map(c=>c.name)).toEqual(['from:tenants']);
});
it.each([null,[],false])('refuses malformed request %s without consequential effects',async body=>{const h=await setup(),r=await h.invoke(body);expect(r.status).toBe(400);expect(h.calls.map(c=>c.name)).toEqual(['from:tenants']);});
it('refuses a linked unprepared agreement before downloading or reaching signers',async()=>{
 const h=await setup({ready:false}),r=await h.invoke();expect(r.status).toBe(422);expect(h.calls.find(c=>c.name==='check_sales_agreement_preparation')!.args).toEqual({_actor_user_id:h.actor,_expected_tenant_id:h.tenant,_agreement_id:h.agreement});expect(h.calls.some(c=>c.name==='download'||c.name==='from:paige_agreement_signers')).toBe(false);
});
it.each(['missing','wrong','throw'] as const)('refuses actual retained storage %s before signer, token or provider work',async download=>{
 const h=await setup({download}),r=await h.invoke();expect(r.status).toBe(422);expect(r.body.error).toContain('could not be verified');expect(JSON.stringify(r.body)).not.toContain('Private storage failure');expect(h.calls.some(c=>c.name==='download')).toBe(true);expect(h.calls.some(c=>c.name==='from:paige_agreement_signers')).toBe(false);
});
it('verifies actual bytes before preserving the original status refusal',async()=>{
 const h=await setup(),r=await h.invoke();expect(r.status).toBe(409);expect(r.body.error).toContain('already completed');expect(h.calls.some(c=>c.name==='download')).toBe(true);
});
it('preserves the unlinked legacy status path without requiring commercial preparation',async()=>{
 const h=await setup({legacy:true}),r=await h.invoke({agreementId:h.agreement});expect(r.status).toBe(409);expect(r.body.error).toContain('already completed');expect(h.calls.some(c=>c.name==='check_sales_agreement_preparation'||c.name==='download')).toBe(false);
});
it('preserves provider and owner authority holds before business work',async()=>{
 for(const options of [{provider:false},{admin:false}]){const h=await setup(options),r=await h.invoke();expect([403,503]).toContain(r.status);expect(h.calls.some(c=>c.name==='from:paige_agreements'||c.name==='rate_limit'||c.name==='download')).toBe(false);}
});
