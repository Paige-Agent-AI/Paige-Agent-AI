// Build-time AST evidence only; never executes Chat, the invitation wrapper or providers.
import ts from 'typescript';
const printer=ts.createPrinter({removeComments:true});
const walk=(node,predicate)=>{const out=[];const visit=n=>{if(predicate(n))out.push(n);ts.forEachChild(n,visit);};visit(node);return out;};
const print=n=>n?printer.printNode(ts.EmitHint.Unspecified,n,n.getSourceFile()).replace(/\s/g,''):'';
const id=n=>n&&ts.isIdentifier(n)?n.text:'';
const str=n=>n&&ts.isStringLiteral(n)?n.text:null;
const prop=(n,name)=>n&&ts.isObjectLiteralExpression(n)?n.properties.find(p=>ts.isPropertyAssignment(p)&&(id(p.name)||str(p.name))===name)?.initializer:undefined;
const declarations=(source,name)=>walk(source,n=>(ts.isVariableDeclaration(n)||ts.isParameter(n)||ts.isFunctionDeclaration(n))&&id(n.name)===name);
const scope=node=>{for(let p=node?.parent;p;p=p.parent)if(ts.isFunctionLike(p))return p;};
const call=(n,expression)=>ts.isCallExpression(n)&&print(n.expression)===expression;
const specs=[['team_invite_member','team.invite_member','create','create_solo_team_invite',true],['team_invite_resend','team.invite_resend','resend','resend_solo_team_invite',false],['team_invite_revoke','team.invite_revoke','revoke','revoke_solo_team_invite',false]];
function inspectInvitationBindings(chatText,edgeText){
 const chat=ts.createSourceFile('chat.ts',chatText,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
 const edge=ts.createSourceFile('invites.ts',edgeText,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
 const findings=[],tools=new Map();const require=(yes,message)=>{if(!yes)findings.push(`invitation binding: ${message}`);};
 require(!chat.parseDiagnostics.length&&!edge.parseDiagnostics.length,'sources parse');
 for(const [source,module] of [[chat,'https://esm.sh/@supabase/supabase-js@2.75.0'],[edge,'npm:@supabase/supabase-js@2']]){
  const imports=walk(source,ts.isImportDeclaration).filter(n=>str(n.moduleSpecifier)===module);
  require(imports.length===1&&imports[0].importClause?.namedBindings&&ts.isNamedImports(imports[0].importClause.namedBindings)&&imports[0].importClause.namedBindings.elements.some(n=>id(n.name)==='createClient'&&!n.propertyName)&&declarations(source,'createClient').length===0,'canonical unshadowed client factory');
 }
 const client=declarations(chat,'supabaseClient');
 require(client.length===1&&print(client[0].initializer.expression)==='createClient'&&print(client[0].initializer.arguments[0])==='supabaseUrl'&&print(client[0].initializer.arguments[1])==='supabaseKey'&&print(prop(prop(prop(client[0].initializer.arguments[2],'global'),'headers'),'Authorization'))==='authHeader','canonical caller client and JWT');
 require(declarations(chat,'supabaseKey').some(n=>print(n.initializer)==='Deno.env.get("SUPABASE_ANON_KEY")!'),'anon caller key');
 const header=declarations(chat,'authHeader').filter(n=>scope(n)===scope(client[0]));require(header.length===1&&call(header[0].initializer,'req.headers.get')&&str(header[0].initializer.arguments[0])==='Authorization','request Authorization source');
 const branches=walk(chat,ts.isIfStatement).filter(n=>specs.every(([tool])=>walk(n.expression,ts.isBinaryExpression).some(b=>print(b.left)==='tc.function.name'&&b.operatorToken.kind===ts.SyntaxKind.EqualsEqualsEqualsToken&&str(b.right)===tool)));
 require(branches.length===1,'one exact three-tool dispatch selector');
 if(branches.length===1){
  const body=branches[0].thenStatement;
  const invokes=walk(body,n=>call(n,'supabaseClient.functions.invoke'));
  require(invokes.length===1&&str(invokes[0].arguments[0])==='solo-team-invitations'&&print(prop(prop(invokes[0].arguments[1],'headers'),'Authorization'))==='authHeader'&&print(prop(invokes[0].arguments[1],'body'))==='invokeBody','explicit JWT wrapper invocation');
  require(declarations(body,'supabaseClient').length===0&&declarations(body,'authHeader').length===0,'dispatch cannot shadow caller binding');
  require(declarations(body,'wrongTenant').some(n=>print(n.initializer)==='awaitteamSeamTenantMismatch()')&&walk(body,ts.isIfStatement).some(n=>print(n.expression)==='wrongTenant'&&ts.isThrowStatement(n.thenStatement)),'caller roster tenant mismatch refusal');
  const payload=declarations(body,'invokeBody');const p=payload[0]?.initializer;
  require(payload.length===1&&p&&ts.isConditionalExpression(p)&&print(p.condition)==='tc.function.name==="team_invite_member"'&&str(prop(p.whenTrue,'action'))==='create'&&print(prop(p.whenTrue,'expectedTenantId'))==='personaCtx?.tenant_id??null'&&print(prop(p.whenFalse,'expectedTenantId'))==='personaCtx?.tenant_id??null'&&print(prop(p.whenFalse,'inviteId'))==='args.invitation_id'&&print(prop(p.whenFalse,'action'))==='tc.function.name==="team_invite_resend"?"resend":"revoke"','exact create/resend/revoke and server tenant payload');
 }
 const authed=declarations(edge,'authed');
 require(authed.length===1&&print(authed[0].initializer.expression)==='createClient'&&print(authed[0].initializer.arguments[0])==='url'&&print(authed[0].initializer.arguments[1])==='anonKey'&&print(prop(prop(prop(authed[0].initializer.arguments[2],'global'),'headers'),'Authorization'))==='authorization','wrapper caller-JWT client');
 const auth=walk(edge,n=>call(n,'authed.auth.getUser'));require(auth.length===1,'fresh verified wrapper user');
 require(auth.length===1&&ts.isAwaitExpression(auth[0].parent)&&ts.isVariableDeclaration(auth[0].parent.parent)&&print(auth[0].parent.parent.name)==='{data:{user},error:userError}','verified user is the bound RPC actor');
 const refusal=walk(edge,ts.isIfStatement).filter(n=>print(n.expression)==='userError||!user'&&ts.isReturnStatement(n.thenStatement));
 require(refusal.length===1&&auth[0]?.pos<refusal[0]?.pos,'authentication refusal follows verification');
 require(declarations(edge,'authorization').some(n=>print(n.initializer)==='req.headers.get("Authorization")??""'),'wrapper request bearer source');
 const expected=declarations(edge,'expectedTenantId');require(expected.length===1&&print(expected[0].initializer)==='typeofbody.expectedTenantId==="string"?body.expectedTenantId:null','no inferred/default invitation workspace');
 require(walk(edge,ts.isIfStatement).some(n=>print(n.expression)==='!expectedTenantId'&&walk(n.thenStatement,ts.isReturnStatement).length),'missing named workspace refused');
 for(const [tool,key,action,rpc,selfDescribe] of specs){
  const routes=walk(edge,ts.isIfStatement).filter(n=>print(n.expression)===`body.action==="${action}"`);
  require(routes.length===1,`${tool}: exact wrapper action selector`);
  const calls=routes.length===1?walk(routes[0].thenStatement,n=>call(n,'admin.rpc')&&str(n.arguments[0])===rpc):[];
  require(routes.length===1&&['user','admin','expectedTenantId'].every(name=>declarations(routes[0].thenStatement,name).length===0),`${tool}: no local authority shadow`);
  require(calls.length===1&&print(prop(calls[0].arguments[1],'_actor'))==='user.id'&&print(prop(calls[0].arguments[1],'_expected_tenant_id'))==='expectedTenantId'&&calls[0].pos>refusal[0]?.pos,`${tool}: protected RPC actor and named workspace`);
  if(action!=='create')require(calls.length===1&&print(prop(calls[0].arguments[1],'_invite_id'))==='body.inviteId',`${tool}: exact invitation reference`);
  tools.set(tool,{key,write:true,executor:'edge.solo-team-invitations',seatAuthority:'workspace-admin',selfDescribe});
 }
 return {findings,tools};
}
export function validateInvitationBindings(chatText,edgeText){
 try{return inspectInvitationBindings(chatText,edgeText);}catch{return {findings:['invitation binding: source shape unavailable'],tools:new Map()};}
}

/** Bounded source-contract check of the canonical service-only SQL seam. It is not
 * a SQL execution harness or a general-purpose security analyzer. */
export function validateInvitationAuthoritySql(sqlText){
 const sql=sqlText.replace(/--[^\r\n]*/g,'').replace(/\/\*[\s\S]*?\*\//g,'');
 const findings=[];const require=(yes,label)=>{if(!yes)findings.push(`invitation SQL binding: ${label}`);};
 const body=name=>sql.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?AS \\$function\\$([\\s\\S]*?)\\$function\\$;`,'i'))?.[1]??'';
 const authority=body('solo_team_invite_authority').replace(/\s/g,'');
 require(authority.includes("SELECTtm.tenant_idINTO_tenantFROMpublic.tenant_memberstmWHEREtm.tenant_id=_expected_tenant_idANDtm.user_id=_actorANDtm.status='active'AND(tm.is_ownerORtm.roleIN('owner'::public.tenant_role,'admin'::public.tenant_role));"),'exact actor/workspace active owner/admin predicate');
 require(authority.includes('IF_actorISNULLTHEN')&&authority.includes('IF_expected_tenant_idISNULLTHEN')&&authority.includes('IF_tenantISNULLTHEN'),'missing actor/workspace/membership refusal');
 for(const name of ['solo_team_invite_authority','create_solo_team_invite','resend_solo_team_invite','revoke_solo_team_invite']){
  const grants=[...sql.matchAll(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}\\([^;]*?\\) TO ([^;]+);`,'gi'))];
  require(grants.length>0&&grants.every(m=>m[1].trim()==='service_role'),`${name}: execute is service-only`);
  require(new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}\\([^;]*?\\) FROM PUBLIC, anon, authenticated;`,'i').test(sql),`${name}: browser grants revoked`);
  if(name!=='solo_team_invite_authority')require(body(name).includes('_tenant := public.solo_team_invite_authority(_actor, _expected_tenant_id);'),`${name}: canonical authority first`);
 }
 return findings;
}
