// Dedicated n8n OAuth boundary. GET handles launch and callback entirely server-side.
// POST authenticates a JWT; tenant expectations can refuse, never select a workspace.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { OAuthError,createPkce,createState,registerClient,buildAuthorizationUrl,exchangeCode,refreshTokens,revokeToken,isExpired,isGrantWithdrawn,discoverAuthorizationServer, type AuthorizationServer, type ClientRegistration, type TokenSet } from '../_shared/mcp-oauth.ts';
import { N8N_OAUTH_SCOPES,N8nSafeError,validateN8nResource,discoverN8n,validateServer,assertScopedTokens,hashOpaque,discoverWorkflowPreviews,validateApproval } from '../_shared/n8n-oauth.ts';
import { McpError } from '../_shared/mcp-client.ts';
const SUPABASE_URL=Deno.env.get('SUPABASE_URL')!;
const CALLBACK=`${SUPABASE_URL}/functions/v1/tenant-n8n-oauth`;
const PUBLIC_BASE=(Deno.env.get('PUBLIC_SITE_URL')??'https://paigeagent.ai').replace(/\/$/,'');
const ALLOWED_ORIGINS=new Set((Deno.env.get('N8N_OAUTH_ALLOWED_ORIGINS')??`${PUBLIC_BASE},https://app.paigeagent.ai`).split(',').map(value=>value.trim()));
const COOKIE='__Host-paige-n8n-oauth';
const HEADERS={'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST,GET,OPTIONS','Vary':'Origin'};


// Closed diagnostic vocabulary only: never serialize an exception or request.
type CallbackStage='callback_validation'|'token_exchange'|'scope_validation'|'mcp_discovery'|'credential_commit';
const CALLBACK_REASONS=new Set(['invalid_callback','expired','provider_scope_refused','provider_unavailable','workflow_inventory_incomplete','workflow_discovery_unavailable','token_exchange_failed','malformed_token_response','mcp_http_error','http_rate_limited','mcp_malformed_response','mcp_protocol_error','request_timed_out','request_failed','response_too_large','url_redirect_refused','url_host_unresolvable','url_resolves_to_private_address','url_host_not_allowed','operation_refused','forbidden','tenant_changed','stale_operation','busy']);
function logCallbackFailure(stage:CallbackStage,error:unknown):void {
 const known=error instanceof OAuthError||error instanceof N8nSafeError||error instanceof McpError;
 const reason=known&&CALLBACK_REASONS.has(error.code)?error.code:'unexpected_failure';
 const status=error instanceof OAuthError||error instanceof McpError?error.httpStatus:undefined;
 console.warn('n8n_oauth_callback_failed',{stage,reason,...(typeof status==='number'&&Number.isInteger(status)&&status>=100&&status<=599?{http_status:status}:{})});
}
const clearCookie=`${COOKIE}=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax`;
const landing=(account:string|undefined,state:string)=>`${PUBLIC_BASE}${account&&/^\d+$/.test(account)?`/solo/${account}/settings/integrations`:'/choose-account'}?n8n_oauth=${state}`;
type Payload={server:AuthorizationServer & {responseIssuerRequired?:boolean};client:ClientRegistration;resource:string;verifier:string;redirect_uri:string;authorization_url:string;requested_scopes?:string[]};
type ServiceResult={expired?:boolean;account_number?:string;authorization_url:string;attempt_id:string;payload:Payload;pin:string;discovery_id:string;revoke?:{token:string;issuer:string;client_id:string;client_secret:string|null;token_type:'access_token'|'refresh_token'}};
// The shape n8n_oauth_service's `acquire` returns. _shared/n8n-management.ts declares its
// OWN copy of this for the same RPC, and the two had drifted: that one carried
// `oauth_scopes` and this one did not, so reading it compiled there and failed only here.
// Two declarations of one response is how that happens (§18); unifying them is tracked
// separately rather than folded into a fix someone is waiting on.
type Lease={lease:string;generation:string;approved_ids:string[];approved_marks:Record<string,string>;discovery_pin:string|null;server_url:string;access_token:string;refresh_token:string|null;expires_at:string|null;issuer:string;client_id:string;client_secret:string|null;oauth_scopes:string[]};
Deno.serve(async req=>{
 const origin=req.headers.get('origin');
 const headers={...HEADERS,...(origin&&ALLOWED_ORIGINS.has(origin)?{'Access-Control-Allow-Origin':origin}:{})};
 const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{...headers,'Content-Type':'application/json'}});
 const redirect=(location:string,cookie?:string)=>new Response(null,{status:303,headers:{...headers,Location:location,...(cookie?{'Set-Cookie':cookie}:{})}});
 if(req.method==='OPTIONS') return new Response(null,{status:origin&&ALLOWED_ORIGINS.has(origin)?204:403,headers});
 if(req.method!=='POST'&&req.method!=='GET') return json({error:'method_not_allowed'},405);
 const admin=createClient(SUPABASE_URL,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
 const rpc=async<T=ServiceResult>(operation:string,input:Record<string,unknown>):Promise<T>=>{
  const {data,error}=await admin.rpc('n8n_oauth_service',{_operation:operation,_input:input});
  if(error){
   const known=['N8N_BUSY','N8N_OAUTH_NEEDED','N8N_DISCOVERY_EXPIRED','N8N_DISCOVERY_CHANGED','N8N_GRANT_GONE','N8N_STALE_OPERATION','N8N_TENANT_CHANGED','N8N_FORBIDDEN'];
   const code=known.find(code=>error.message.includes(code));
   throw new N8nSafeError(code?.toLowerCase().replace(/^n8n_/,'')??'operation_refused');
  }
  return data;
 };
 // A launch is a same-origin top-level form POST using proof returned only from
 // the authenticated begin response. A transferable GET ticket is never accepted.
 if(req.method==='POST'&&req.headers.get('content-type')?.split(';')[0]==='application/x-www-form-urlencoded'){
  try{
   if(!origin||!ALLOWED_ORIGINS.has(origin)||new URL(req.url).search) throw new N8nSafeError('origin_refused');
   if(Number(req.headers.get('content-length')??0)>1024) throw new N8nSafeError('invalid_request');
   const text=await req.text();if(text.length>1024) throw new N8nSafeError('invalid_request');
   const form=new URLSearchParams(text);
   if(form.size!==2||form.getAll('launch_ticket').length!==1||form.getAll('launch_proof').length!==1) throw new N8nSafeError('invalid_request');
   const ticket=form.get('launch_ticket')!;const proof=form.get('launch_proof')!;
   if(!/^[A-Za-z0-9_-]{43}$/.test(ticket)||!/^[A-Za-z0-9_-]{43}$/.test(proof)) throw new N8nSafeError('invalid_request');
   const binding=createState();
   const result=await rpc('launch',{launch_hash:await hashOpaque(ticket),launch_proof_hash:await hashOpaque(proof),binding_hash:await hashOpaque(binding)});
   if(result.expired)return redirect(landing(result.account_number,'expired'),clearCookie);
   return redirect(result.authorization_url,`${COOKIE}=${binding}; Path=/; Max-Age=600; Secure; HttpOnly; SameSite=Lax`);
  }catch{return json({error:'launch_refused'},403);}
 }
 if(req.method==='GET'){
  let stage:CallbackStage='callback_validation';
  let account:string|undefined;
  let attemptId:string|undefined;
  let pendingGrant:{server:AuthorizationServer;client:ClientRegistration;tokens:TokenSet}|undefined;
  try{
   const url=new URL(req.url);
   // Hosted gateway rewrites the public URL to this exact function path.
   // The fixed public CALLBACK remains authoritative for registration and exchange.
   if(![new URL(CALLBACK).pathname,'/tenant-n8n-oauth'].includes(url.pathname))throw new N8nSafeError('invalid_callback');
   // Every parameter is cardinality-checked. No browser JavaScript receives the code.
   for(const key of ['state','code','error','iss']) if(url.searchParams.getAll(key).length>1) throw new N8nSafeError('invalid_callback');
   if([...url.searchParams.keys()].some(key=>!['state','code','error','error_description','error_uri','iss'].includes(key))) throw new N8nSafeError('invalid_callback');
   const state=url.searchParams.get('state')??'';
   const binding=req.headers.get('cookie')?.split(';').map(part=>part.trim()).find(part=>part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length+1)??'';
   if(!/^[A-Za-z0-9_-]{43}$/.test(state)||!/^[A-Za-z0-9_-]{43}$/.test(binding)) throw new N8nSafeError('invalid_callback');
   const consumed=await rpc('consume',{state_hash:await hashOpaque(state),binding_hash:await hashOpaque(binding)});
   account=consumed.account_number;
   if(consumed.expired) return redirect(landing(account,'expired'),clearCookie);
   attemptId=consumed.attempt_id;
   const payload=consumed.payload as Payload;
   if(payload.redirect_uri!==CALLBACK || (payload.server.responseIssuerRequired&&!url.searchParams.has('iss')) || (url.searchParams.has('iss')&&url.searchParams.get('iss')!==payload.server.issuer)) throw new N8nSafeError('invalid_callback');
   if(url.searchParams.has('error')){
    if(url.searchParams.has('code')) throw new N8nSafeError('invalid_callback');
    const outcome=url.searchParams.get('error')==='access_denied'?'refused':'failed';
    await rpc('finish',{attempt_id:attemptId,outcome});
    return redirect(landing(account,outcome),clearCookie);
   }
   const code=url.searchParams.get('code');
   if(!code||code.length>4096) throw new N8nSafeError('invalid_callback');
   stage='token_exchange';
   const tokens=await exchangeCode({server:payload.server,...payload.client,redirectUri:CALLBACK,code,verifier:payload.verifier,resource:payload.resource,requestedScopes:payload.requested_scopes??['workflow:read','workflow:write']});
   pendingGrant={server:payload.server,client:payload.client,tokens};
   stage='scope_validation';
   assertScopedTokens(tokens,payload.requested_scopes??['workflow:read','workflow:write']);
   // Prove the scoped grant actually reaches n8n before replacing a saved working credential.
   stage='mcp_discovery';
   await discoverWorkflowPreviews({serverUrl:payload.resource,auth:{kind:'bearer',token:tokens.accessToken}});
   stage='credential_commit';
   const completed=await rpc('finish',{attempt_id:attemptId,outcome:'success',tokens});
   if(completed.expired) throw new N8nSafeError('expired');
   pendingGrant=undefined;
   return redirect(landing(account,'success'),clearCookie);
  }catch(error){
   logCallbackFailure(stage,error);
   if(pendingGrant) await revokeToken({server:pendingGrant.server,...pendingGrant.client,token:pendingGrant.tokens.refreshToken??pendingGrant.tokens.accessToken,tokenTypeHint:pendingGrant.tokens.refreshToken?'refresh_token':'access_token'});
   if(attemptId) await rpc('finish',{attempt_id:attemptId,outcome:'failed'}).catch(()=>undefined);
   return redirect(landing(account,error instanceof N8nSafeError&&error.code==='expired'?'expired':'failed'),clearCookie);
  }
 }
 try{
  if(origin&&!ALLOWED_ORIGINS.has(origin)) return json({error:'origin_refused'},403);
  if(Number(req.headers.get('content-length')??0)>16384) return json({error:'invalid_request'},400);
  const text=await req.text(); if(text.length>16384) return json({error:'invalid_request'},400);
  const body=JSON.parse(text) as Record<string,unknown>;
  const userClient=createClient(SUPABASE_URL,Deno.env.get('SUPABASE_ANON_KEY')!,{global:{headers:{Authorization:req.headers.get('authorization')??''}},auth:{persistSession:false,autoRefreshToken:false}});
  const {data:{user},error:authError}=await userClient.auth.getUser();
  if(authError||!user) return json({error:'unauthorized'},401);
  const {data:readiness,error:readError}=await userClient.rpc('get_n8n_connection_readiness');
  if(readError||!readiness) return json({error:'forbidden'},403);
  if(body.action==='status') return json(readiness);
  if(readiness.can_manage!==true) return json({error:'forbidden'},403);
  if(typeof body.expected_tenant_id!=='string'||body.expected_tenant_id!==readiness.tenant_id) return json({error:'tenant_changed'},409);
  const context={tenant_id:readiness.tenant_id,actor_id:user.id};
  const fresh=async()=>{const {data,error}=await userClient.rpc('get_n8n_connection_readiness');if(error||data?.tenant_id!==context.tenant_id)throw new N8nSafeError('tenant_changed');return data;};
  if(body.action==='begin'){
   // getUser verified this exact JWT above; decode only its session identifier.
   let sessionId:string;
   try { const encoded=(req.headers.get('authorization')??'').replace(/^Bearer /i,'').split('.')[1];
    sessionId=JSON.parse(atob(encoded.replace(/-/g,'+').replace(/_/g,'/'))).session_id;
   } catch { return json({error:'unauthorized'},401); }
   if(typeof sessionId!=='string'||! /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessionId))return json({error:'unauthorized'},401);
   const resource=validateN8nResource(body.server_url);
   const server=await discoverN8n(resource);
   const requestedScopes=N8N_OAUTH_SCOPES.filter(scope=>server.scopesSupported.includes(scope));
   const client=await registerClient({server,redirectUri:CALLBACK,clientName:'Paige n8n governed access'});
   const pkce=await createPkce(); const state=createState(); const launch=createState(); const launchProof=createState();
   const authorizationUrl=buildAuthorizationUrl({server,clientId:client.clientId,redirectUri:CALLBACK,state,challenge:pkce.challenge,scopes:requestedScopes,resource});
   await rpc('begin',{...context,session_id:sessionId,requested_scopes:requestedScopes,state_hash:await hashOpaque(state),launch_hash:await hashOpaque(launch),launch_proof_hash:await hashOpaque(launchProof),payload:{server,client,resource,requested_scopes:requestedScopes,verifier:pkce.verifier,redirect_uri:CALLBACK,authorization_url:authorizationUrl}});
   return json({launch_url:CALLBACK,launch_ticket:launch,launch_proof:launchProof});
  }
  if(body.action==='cancel'){await rpc('cancel',context);return json(await fresh());}
  if(body.action==='disconnect'){
   const result=await rpc('disconnect',context);
   let revoked=false;
   if(result.revoke?.token){try{
    const server=await discoverAuthorizationServer(result.revoke.issuer);validateServer(server);
    revoked=await revokeToken({server,clientId:result.revoke.client_id,clientSecret:result.revoke.client_secret,token:result.revoke.token,tokenTypeHint:result.revoke.token_type});
   }catch{/* Local disconnection remains authoritative. No provider error is surfaced. */}}
   return json({...(await fresh()),revoked_at_provider:revoked});
  }
  if(!['verify','discover','approve','preview'].includes(String(body.action))) return json({error:'unsupported_action'},400);
  const lease=await rpc<Lease>('acquire',context);
  const bound={...context,lease:lease.lease,generation:lease.generation};
  let accessToken=lease.access_token;
  const activeSecrets=[lease.access_token,lease.refresh_token,lease.client_secret].filter((value):value is string=>!!value);
  try{
   if(isExpired(lease.expires_at)){
    if(!lease.refresh_token) throw new N8nSafeError('token_expired');
    // REVOKING IS FOR A GRANT WE REFUSE, NEVER FOR ONE WE FAILED TO WRITE DOWN.
    //
    // Rotation is destructive: the moment n8n issues the new refresh token the old one is
    // dead. Every failure after that point used to take the same path -- revoke the token
    // just issued -- so a database blip, or a lease that ran out while the provider was
    // slow, destroyed a working connection and the workspace had to reconnect. That is
    // what "we get disconnected every time you update" actually was.
    //
    // The two cases are now separated, because they are opposites:
    //   WE reject the tokens (wrong scopes)  -> revoking what we will not use is correct.
    //   We cannot RECORD them                -> the grant is legitimate and the old token
    //                                           is already gone; revoking guarantees the
    //                                           reconnect instead of leaving it retryable.
    const server=await discoverAuthorizationServer(lease.issuer);validateServer(server);
    let tokens:TokenSet;
    try{
     tokens=await refreshTokens({server,clientId:lease.client_id,clientSecret:lease.client_secret,refreshToken:lease.refresh_token,resource:lease.server_url,grantedScopes:lease.oauth_scopes});
    }catch(error){
     // Only the provider saying invalid_grant means the grant is really gone (the owner
     // revoked us at n8n). Anything else is transient and must leave the row untouched so
     // the next attempt can simply try again.
     console.error('[tenant-n8n-oauth] refresh failed',{withdrawn:isGrantWithdrawn(error)});
     throw new N8nSafeError(isGrantWithdrawn(error)?'token_expired':'provider_unavailable');
    }
    try{ assertScopedTokens(tokens); }
    catch(error){
     await revokeToken({server,clientId:lease.client_id,clientSecret:lease.client_secret,token:tokens.refreshToken??tokens.accessToken,tokenTypeHint:tokens.refreshToken?'refresh_token':'access_token'}).catch(()=>false);
     throw error;
    }
    try{
     await rpc('rotate',{...bound,tokens});
    }catch(error){
     // N8N_GRANT_GONE means the workspace DISCONNECTED (or re-authorized) while this
     // refresh was in flight. The token just issued is then an orphan at n8n, and leaving
     // it live would mean someone pressed Disconnect and still has a working grant there.
     // That one case revokes. Every other refusal is someone else mid-operation or a
     // database blip, and the grant must survive it.
     const gone=error instanceof N8nSafeError&&error.code==='grant_gone';
     if(gone) await revokeToken({server,clientId:lease.client_id,clientSecret:lease.client_secret,token:tokens.refreshToken??tokens.accessToken,tokenTypeHint:tokens.refreshToken?'refresh_token':'access_token'}).catch(()=>false);
     // Loud either way: this path recorded NOTHING before -- last_error stayed NULL and no
     // Rail row was written -- so a workspace losing its connection left no trace at all.
     console.error('[tenant-n8n-oauth] rotation not recorded',{grantGone:gone});
     throw new N8nSafeError(gone?'token_expired':'provider_unavailable');
    }
    accessToken=tokens.accessToken;
    if(tokens.refreshToken)activeSecrets.push(tokens.refreshToken);
   }
   const preview=await discoverWorkflowPreviews({serverUrl:lease.server_url,auth:{kind:'bearer',token:accessToken}});
   if(preview.workflows.some(row=>[accessToken,...activeSecrets].some(secret=>row.name.includes(secret)||row.id.includes(secret))))throw new N8nSafeError('provider_unavailable');
   await rpc('probe',{...bound,state:'connected',pin:preview.pin,marks:preview.marks,inventory_complete:preview.inventory_complete});
   if(body.action==='discover'){
    const snapshot=await rpc('snapshot',{...bound,payload:preview});
    return json({workflows:preview.workflows.map(row=>({...row,approved:lease.approved_ids.includes(row.id)&&!!lease.approved_marks?.[row.id]&&lease.approved_marks[row.id]===preview.marks[row.id]})),discovery_id:snapshot.discovery_id,inventory_complete:preview.inventory_complete,total_count:preview.total_count});
   }
   if(body.action==='approve'){
    if(typeof body.discovery_id!=='string') throw new N8nSafeError('discovery_expired');
    const snapshot=await rpc('read_snapshot',{...bound,discovery_id:body.discovery_id});
    if(snapshot.pin!==preview.pin) throw new N8nSafeError('discovery_changed');
    const ids=validateApproval(body.workflow_ids,preview.workflows);
    await rpc('approve',{...bound,discovery_id:body.discovery_id,pin:preview.pin,workflow_ids:ids,marks:preview.marks});
   }
   if(body.action==='preview'){
    // Judged on THIS workflow's own mark. It used to compare the whole-inventory pin, so a
    // change to any workflow -- or a brand new unrelated one -- made Paige refuse every
    // approved workflow as "not approved" before anything had even been revoked.
    if(typeof body.workflow_id!=='string'
      ||!lease.approved_ids.includes(body.workflow_id)
      ||!lease.approved_marks?.[body.workflow_id]
      ||lease.approved_marks[body.workflow_id]!==preview.marks[body.workflow_id]) throw new N8nSafeError('workflow_not_approved');
    const selected=preview.workflows.find(row=>row.id===body.workflow_id);
    if(!selected) throw new N8nSafeError('workflow_unavailable');
    await fresh();
    return json({workflow:{...selected,mode:'read_preview'},executed:false});
   }
   return json(await fresh());
  }catch(error){
   const expired=error instanceof N8nSafeError&&error.code==='token_expired'||error instanceof McpError&&[401,403].includes(error.httpStatus??0);
   if(expired||!(error instanceof N8nSafeError)||['provider_unavailable','workflow_inventory_incomplete','workflow_discovery_unavailable'].includes(error.code)) await rpc('probe',{...bound,state:expired?'token_expired':'provider_unavailable'}).catch(()=>undefined);
   throw error;
  }finally{await rpc('release',bound).catch(()=>undefined);}
 }catch(error){
  const code=error instanceof N8nSafeError?error.code:'operation_failed';
  return json({error:code},['forbidden','operation_refused'].includes(code)?403:['tenant_changed','stale_operation','busy','discovery_changed'].includes(code)?409:400);
 }
});
