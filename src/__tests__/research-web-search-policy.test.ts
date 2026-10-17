// @vitest-environment node
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { parseResearchSourcePolicy, researchSourceUrl, RESEARCH_SEARCH_LIMIT } from '../../supabase/functions/_shared/research-source-policy';

const source=readFileSync('supabase/functions/paige-web-search/index.ts','utf8');
const ast=ts.createSourceFile('search.ts',source,ts.ScriptTarget.Latest,true);
const code=ts.transpileModule(ast.statements.filter(n=>!ts.isImportDeclaration(n)).map(n=>n.getText(ast)).join('\n'),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
function fixture(options:{missingKey?:boolean;invalidUser?:boolean;hits?:unknown[];shape?:string}={}){
  let handler!:(r:Request)=>Promise<Response>;
  const fetch=vi.fn(async(_url:string,_init:{body:string})=>Response.json({data:options.shape==='legacy'?(options.hits??[]):{web:options.hits??[]}}));
  const scope={serve:(fn:typeof handler)=>{handler=fn;},createClient:()=>({auth:{getClaims:async()=>({data:options.invalidUser?null:{claims:{sub:'fixture-user'}},error:null})}}),
    parseResearchSourcePolicy,researchSourceUrl,RESEARCH_SEARCH_LIMIT,fetch,
    Deno:{env:{get:(name:string)=>({SUPABASE_SERVICE_ROLE_KEY:'fixture-service',SUPABASE_URL:'https://fixture.invalid',SUPABASE_ANON_KEY:'fixture-public',FIRECRAWL_API_KEY:options.missingKey?undefined:'fixture-provider'})[name]}}};
  new Function(...Object.keys(scope),code)(...Object.values(scope));
  return {fetch,run:async(body:unknown={},auth='fixture-service',method='POST')=>{
    const response=await handler(new Request('https://fixture.invalid/search',{method,headers:auth?{Authorization:`Bearer ${auth}`}:{},...(method==='POST'?{body:JSON.stringify({query:'protected fixture query',...(body as object)})}:{})}));
    return {response,body:method==='OPTIONS'?await response.text():await response.json()};
  }};
}
describe('actual existing web-search wrapper source policy',()=>{
  it('sends web-only provider domain constraints and locally filters a provider that ignores them',async()=>{
    const test=fixture({hits:[{url:'https://openai.com.attacker.invalid/a'},{url:'https://OPENAI.COM:443/a#one'},{url:'https://openai.com/a#two'},{url:'https://developers.openai.com/b'},{url:'https://openai.com/c'}]});
    const {response,body}=await test.run({allowed_domains:['OpenAI.com'],limit:2});
    expect(response.status).toBe(200);expect(body.results.map((r:{url:string})=>r.url)).toEqual(['https://openai.com/a','https://developers.openai.com/b']);
    expect(JSON.parse(test.fetch.mock.calls[0][1].body)).toEqual({query:'protected fixture query',limit:2,sources:['web'],includeDomains:['openai.com']});
  });
  it.each(['current','legacy'])('preserves optional defaults and existing result shapes (%s)',async shape=>{
    const test=fixture({shape,hits:Array.from({length:8},(_,n)=>({url:`https://example.com/${n}`}))});
    const {body}=await test.run();expect(body.results).toHaveLength(5);
    expect(JSON.parse(test.fetch.mock.calls[0][1].body)).toEqual({query:'protected fixture query',limit:5,sources:['web']});
  });
  it.each([{limit:0},{limit:6},{limit:'3'},{limit:1.5},{allowed_domains:[]},{allowed_domains:['https://openai.com']}])('rejects invalid constraints before provider invocation (%j)',async policy=>{
    const test=fixture();const {response}=await test.run(policy);expect(response.status).toBe(400);expect(test.fetch).not.toHaveBeenCalled();
  });
  it.each(['','invalid-user'])('preserves missing/invalid ordinary authority (%s)',async auth=>{
    const test=fixture({invalidUser:true});const {response}=await test.run({},auth);expect(response.status).toBe(401);expect(test.fetch).not.toHaveBeenCalled();
  });
  it('retains ordinary authenticated callers and the truthful unconfigured response',async()=>{
    const test=fixture({missingKey:true});const {response,body}=await test.run({},'ordinary-user');
    expect(response.status).toBe(200);expect(body).toMatchObject({configured:false,results:[]});expect(test.fetch).not.toHaveBeenCalled();
  });
  it('preserves harmless CORS preflight without an effect',async()=>{
    const test=fixture();const {response}=await test.run({},'','OPTIONS');expect(response.status).toBe(200);expect(test.fetch).not.toHaveBeenCalled();
  });
});
