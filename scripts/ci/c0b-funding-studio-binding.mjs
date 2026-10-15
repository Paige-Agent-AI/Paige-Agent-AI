// Static, bounded source-contract evidence. This module executes no handler/provider.
// Endpoint and workspace bindings are proved here; arbitrary attachment fetch safety,
// provider availability, factual data accuracy and authenticated acceptance are NOT.
import ts from 'typescript';
const printer=ts.createPrinter({removeComments:true});
const walk=(n,p)=>{const out=[];const visit=x=>{if(p(x))out.push(x);ts.forEachChild(x,visit);};visit(n);return out;};
const print=n=>n?printer.printNode(ts.EmitHint.Unspecified,n,n.getSourceFile()).replace(/\s/g,''):'';
const id=n=>n&&ts.isIdentifier(n)?n.text:'';
const str=n=>n&&ts.isStringLiteral(n)?n.text:null;
const prop=(n,key)=>n&&ts.isObjectLiteralExpression(n)?n.properties.find(p=>ts.isPropertyAssignment(p)&&(id(p.name)||str(p.name))===key)?.initializer:undefined;
const decl=(n,name)=>walk(n,x=>(ts.isVariableDeclaration(x)||ts.isParameter(x)||ts.isFunctionDeclaration(x))&&id(x.name)===name);
const bindingNames=n=>!n?[]:ts.isIdentifier(n)?[n]:ts.isObjectBindingPattern(n)||ts.isArrayBindingPattern(n)?n.elements.flatMap(e=>ts.isBindingElement(e)?bindingNames(e.name):[]):[];
const call=(n,name)=>ts.isCallExpression(n)&&print(n.expression)===name;
const specs=[
 ['get_current_rates','funding_optin.current_rates',false,true,false],['search_funding_marketplace','funding_optin.marketplace_scaffold',false,false,false],
 ['search_regional_lenders','funding_optin.regional_lenders',false,true,false],['search_sba_lenders','funding_optin.sba_lenders',false,true,false],
 ['marketplace_browse','integrations_mcp.marketplace_browse',false,true,false],['draft_marketing_content','marketing.draft_content',false,true,true],
 ['ask_choices','vibe_studio.ask_choices',false,false,false],['generate_image','vibe_studio.generate_image',true,true,true],
 ['growth_funnel_generate','vibe_studio.funnel_generate',false,false,true],['growth_list','vibe_studio.growth_list',false,true,true],['growth_page_generate','vibe_studio.page_generate',false,false,true],
];
function inspect(chatText,sources){
 const findings=[],tools=new Map();const require=(ok,label)=>{if(!ok)findings.push(`funding/studio binding: ${label}`);};
 const parse=(text,name)=>{const s=ts.createSourceFile(name,text??'',ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);require(!!text&&!s.parseDiagnostics.length,`${name}: source parses`);return s;};
 const chat=parse(chatText,'chat.ts');const adapters=Object.fromEntries(Object.entries(sources).map(([k,v])=>[k,parse(v,`${k}.ts`)]));
 // Resolve lexical symbols without loading imports or executing the application.
 // Exact spellings are insufficient: every protected receiver/identity reference
 // must bind to the single reviewed enclosing variable, including destructuring.
 const host={getSourceFile:name=>name==='chat.ts'?chat:undefined,getDefaultLibFileName:()=>'',writeFile:()=>{},getCurrentDirectory:()=>'',getDirectories:()=>[],fileExists:name=>name==='chat.ts',readFile:()=>undefined,getCanonicalFileName:name=>name,useCaseSensitiveFileNames:()=>true,getNewLine:()=> '\n'};
 const checker=ts.createProgram(['chat.ts'],{noLib:true,noResolve:true},host).getTypeChecker();
 const protectedNames=['supabaseClient','supabase','authHeader','supabaseServiceKey','personaCtx','user'];
 const symbols=new Map(protectedNames.map(name=>{const names=walk(chat,ts.isVariableDeclaration).flatMap(n=>bindingNames(n.name)).filter(n=>id(n)===name);require(names.length===1,`${name}: single canonical enclosing binding`);return [name,names.length===1?checker.getSymbolAtLocation(names[0]):undefined];}));
 const client=decl(chat,'supabaseClient');
 require(decl(chat,'supabase').some(n=>print(n.initializer)==='createClient(supabaseUrl,supabaseServiceKey)')&&decl(chat,'supabaseServiceKey').some(n=>print(n.initializer)==='Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!')&&decl(chat,'authHeader').some(n=>call(n.initializer,'req.headers.get')&&str(n.initializer.arguments[0])==='Authorization'),'canonical service client/key and incoming bearer');
 require(walk(chat,ts.isVariableDeclaration).some(n=>bindingNames(n.name).some(b=>id(b)==='user')&&print(n.initializer)==='awaitsupabaseClient.auth.getUser()'),'canonical verified caller user binding');
 require(client.length===1&&print(client[0].initializer.expression)==='createClient'&&print(client[0].initializer.arguments[1])==='supabaseKey'&&print(prop(prop(prop(client[0].initializer.arguments[2],'global'),'headers'),'Authorization'))==='authHeader','canonical caller-JWT client');
 require(decl(chat,'supabaseKey').some(n=>print(n.initializer)==='Deno.env.get("SUPABASE_ANON_KEY")!'),'caller anon key');
 require(walk(chat,ts.isImportDeclaration).some(n=>str(n.moduleSpecifier)==='https://esm.sh/@supabase/supabase-js@2.75.0'&&n.importClause?.namedBindings&&ts.isNamedImports(n.importClause.namedBindings)&&n.importClause.namedBindings.elements.some(e=>id(e.name)==='createClient'&&!e.propertyName))&&decl(chat,'createClient').length===0,'canonical unshadowed client factory');
 const bodyFor=tool=>{const branches=walk(chat,ts.isIfStatement).filter(n=>print(n.expression)===`tc.function.name==="${tool}"`);require(branches.length===1,`${tool}: exact dispatch selector`);return branches[0]?.thenStatement;};
 const bodies=new Map(specs.filter(([t])=>t!=='ask_choices').map(([t])=>[t,bodyFor(t)]));
 const io=body=>walk(body,n=>ts.isCallExpression(n)&&(/\.(?:rpc|from|invoke)$/.test(print(n.expression))||print(n.expression)==='fetch'));
 const endpoint=(body,path,authorization)=>{const calls=walk(body,n=>call(n,'fetch'));require(calls.length===1&&ts.isTemplateExpression(calls[0].arguments[0])&&calls[0].arguments[0].templateSpans.length===1&&id(calls[0].arguments[0].templateSpans[0].expression)==='supabaseUrl'&&calls[0].arguments[0].templateSpans[0].literal.text===`/functions/v1/${path}`&&print(prop(prop(calls[0].arguments[1],'headers'),'Authorization'))===authorization,`${path}: exact endpoint and existing bearer`);};
 const funding=walk(chat,ts.isIfStatement).filter(n=>print(n.expression)==='!fundingEnabled&&(tc.function.name==="search_regional_lenders"||tc.function.name==="search_sba_lenders"||tc.function.name==="get_current_rates"||tc.function.name==="search_funding_marketplace")');
 require(funding.length===1&&io(funding[0].thenStatement).length===0&&funding[0].pos<bodies.get('search_regional_lenders').pos,'funding opt-in refusal precedes all four adapters');
 endpoint(bodies.get('search_regional_lenders'),'search-local-lenders','`Bearer${supabaseServiceKey}`');
 endpoint(bodies.get('search_sba_lenders'),'search-sba-lenders','authHeader');
 endpoint(bodies.get('get_current_rates'),'fetch-economic-rates','`Bearer${supabaseServiceKey}`');
 require(walk(bodies.get('get_current_rates'),n=>call(n,'supabase.from')&&str(n.arguments[0])==='economic_rates_cache').length===1,'rates shared cache is explicit');
 const scaffold=bodies.get('search_funding_marketplace');require(io(scaffold).length===0&&walk(scaffold,n=>ts.isPropertyAssignment(n)&&id(n.name)==='status'&&str(n.initializer)==='coming_soon').length===2,'scaffold is coming-soon in both flag branches without provider call');
 const marketplace=bodies.get('marketplace_browse');const read=walk(marketplace,n=>call(n,'supabase.rpc')&&str(n.arguments[0])==='marketplace_catalog_for_tenant');
 const resolver=decl(chat,'resolveCurrentMarketplaceTenant');
 require(resolver.length===1&&walk(resolver[0],n=>ts.isCallExpression(n)&&print(n)==='supabase.from("profiles").select("active_tenant_id").eq("user_id",user.id).maybeSingle()').length===1&&walk(resolver[0],n=>ts.isCallExpression(n)&&print(n)==='supabase.from("tenant_members").select("tenant_id").eq("user_id",user.id).eq("tenant_id",structurallyCurrentTenant).eq("status","active")').length===1,'marketplace fresh actor profile and active membership');
 require(read.length===1&&print(prop(read[0].arguments[1],'_actor_user_id'))==='user.id'&&print(prop(read[0].arguments[1],'_tenant_id'))==='dispatchMarketplaceTenantId','marketplace canonical actor overload');
 for(const [name,expected] of [['dispatchMarketplaceTenantId','marketplaceTenantId'],['returnedMarketplaceTenantId','dispatchMarketplaceTenantId']]){
  const d=decl(marketplace,name);require(d.length===1&&call(d[0].initializer,'retainActiveMarketplaceTenant')&&print(d[0].initializer.arguments[0])===expected&&print(d[0].initializer.arguments[1])==='awaitresolveCurrentMarketplaceTenant()',`marketplace ${name}: current tenant revalidation`);
  require(walk(marketplace,ts.isIfStatement).some(n=>print(n.expression)===`!${name}`&&walk(n.thenStatement,ts.isContinueStatement).length),`marketplace ${name}: refusal stops projection`);
 }
 for(const [tool,endpointName] of [['draft_marketing_content','content-draft'],['growth_page_generate','growth-page-draft'],['growth_funnel_generate','growth-funnel-draft']]){
  const body=bodies.get(tool);const calls=walk(body,n=>call(n,'supabaseClient.functions.invoke'));
  require(calls.length===1&&str(calls[0].arguments[0])===endpointName&&print(prop(prop(calls[0].arguments[1],'body'),'tenant_id'))==='personaCtx?.tenant_id??null',`${tool}: caller-JWT exact draft route and server tenant`);
 }
 const list=bodies.get('growth_list');require(walk(list,n=>ts.isCallExpression(n)&&ts.isPropertyAccessExpression(n.expression)&&n.expression.name.text==='eq'&&str(n.arguments[0])==='tenant_id'&&id(n.arguments[1])==='_listTid').length===1&&decl(list,'_listTid').some(n=>print(n.initializer)==='personaCtx?.tenant_id??null'),'growth list exact server tenant pin');
 const image=bodies.get('generate_image');const media=walk(image,n=>call(n,'supabaseClient.functions.invoke')&&str(n.arguments[0])==='paige-media');
 require(media.length===1&&print(prop(prop(media[0].arguments[1],'body'),'request_id'))==='awaitstableRunId(["studio-chat-image",payloadThreadId??"",tc.id])','Studio image existing request correlation');
 const legacyImages=walk(image,n=>call(n,'supabaseClient.functions.invoke')&&str(n.arguments[0])==='generate-image');
 require(legacyImages.length===2&&legacyImages.every(n=>print(prop(prop(n.arguments[1],'body'),'tenant_id'))==='personaCtx?.tenant_id??null'),'both legacy image caller routes and server tenants');
 require(walk(image,n=>ts.isCallExpression(n)&&print(n.expression).endsWith('.functions.invoke')).length===3,'image routes have no additional unbound invocation');
 require(walk(chat,n=>call(n,'buildAskRecord')&&print(prop(n.arguments[1],'askId'))==='crypto.randomUUID()'&&print(prop(n.arguments[1],'freeForm'))==='mainChatAsks').length===1&&walk(chat,n=>call(n,'turnTracker.choicesAsked')).length===1,'choices server-id and canonical ASK_USER state');
 for(const name of ['contentDraft','pageDraft','funnelDraft']){
  const source=adapters[name];require(walk(source,n=>call(n,'resolveStudioCaller')&&print(n.arguments[0])==='authed'&&print(n.arguments[1])==='body?.tenant_id').length===1,`${name}: shared current-workspace authority`);
  require(walk(source,n=>call(n,'authed.auth.getUser')).length===1,`${name}: fresh caller authentication`);
  require(!walk(source,n=>ts.isCallExpression(n)&&ts.isPropertyAccessExpression(n.expression)&&['insert','update','upsert'].includes(n.expression.name.text)).length,`${name}: no direct business artifact writer`);
  if(name!=='contentDraft')require(walk(source,n=>ts.isBinaryExpression(n)&&id(n.left)==='tenantId'&&print(n.right)==='caller.tenantId').length===1,`${name}: caller-resolved tenant assignment`);
 }
 const studio=adapters.studioCaller;require(walk(studio,n=>call(n,'authed.rpc')&&str(n.arguments[0])==='current_user_tenant_id').length===1&&walk(studio,n=>call(n,'authed.rpc')&&str(n.arguments[0])==='is_tenant_admin'&&print(prop(n.arguments[1],'_tenant'))==='tenantId').length===1&&walk(studio,n=>call(n,'authed.rpc')&&str(n.arguments[0])==='agency_can_manage_child'&&print(prop(n.arguments[1],'_child'))==='tenantId').length===1,'Studio same-tenant role/agency checks');
 const rates=adapters.rates;require(walk(rates,n=>ts.isCallExpression(n)&&ts.isPropertyAccessExpression(n.expression)&&n.expression.name.text==='upsert'&&print(prop(n.arguments[1],'onConflict'))==='"series_id"').length===1,'rates series-keyed cache write accounted');
 const sba=adapters.sba;require(walk(sba,n=>call(n,'supabase.auth.getClaims')&&print(n.arguments[0])==='token').length===1&&decl(sba,'token').some(n=>print(n.initializer)==='authHeader.replace("Bearer","")')&&walk(sba,ts.isIfStatement).some(n=>print(n.expression)==='claimsErr||!claims?.claims'&&walk(n.thenStatement,ts.isReturnStatement).length===1),'SBA caller token verified with refusal');
 for(const [tool,key,write,selfDescribe,admin] of specs){const body=bodies.get(tool);if(body)require(walk(body,ts.isIdentifier).filter(n=>protectedNames.includes(n.text)&&!(ts.isPropertyAccessExpression(n.parent)&&n.parent.name===n)&&!(ts.isPropertyAssignment(n.parent)&&n.parent.name===n)).every(n=>!!symbols.get(n.text)&&checker.getSymbolAtLocation(n)===symbols.get(n.text)),`${tool}: canonical lexical caller/scope binding`);tools.set(tool,{key,write,executor:'edge.paige-ai-chat',seatAuthority:admin?'workspace-admin':'member',selfDescribe,chatBinding:tool==='search_funding_marketplace'?'UNAVAILABLE':'LIVE'});}
 return {findings,tools};
}
export function validateFundingStudioBindings(chatText,sources){try{return inspect(chatText,sources);}catch{return {findings:['funding/studio binding: malformed or unavailable source shape'],tools:new Map()};}}
export function validateFundingStudioDeclarations(capabilities,proof){
 const findings=[...proof.findings];for(const cap of capabilities){const tool=cap.action?.chatTool;const binding=proof.tools.get(tool);if(!binding||cap.key!==binding.key||cap.action.executor!==binding.executor)findings.push(`${tool}: exact composite executor binding required`);if(/no side effects|writes nothing|ssrf.safe|no provider calls/i.test(cap.action?.idempotency??''))findings.push(`${tool}: unproved zero-effect or SSRF claim`);if(binding&&cap.chatBinding!==binding.chatBinding)findings.push(`${tool}: unavailable scaffold cannot claim live`);}return findings;
}
