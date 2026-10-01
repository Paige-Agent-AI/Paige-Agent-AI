/** Local transport fixtures only. Real Solo components and hooks remain under measurement. */
import { currentHarnessTenantId } from './tenant-context-stub';
const mode = () => new URLSearchParams(window.location.search).get('data') || 'empty';
const apiRows = new Map<string, Record<string, unknown>>();
const mcpRows = new Map<string, Record<string, unknown>>();
// Synthetic canonical records for shared-form browser proof. Never retain submitted secrets.
const savedGatewayRows = new Map<string, Array<Record<string, unknown>>>();
const gatewayCalls: Array<{ action: unknown; connectionId?: unknown }> = [];
Object.defineProperty(window, '__mcpHarnessCalls', { get: () => gatewayCalls });
const none = () => ({ configured: false, status: 'unconfigured' });
const emptyApi = (tenant: string) => ({tenant_id:tenant,can_write:mode()!=='readonly',configured:false,label:null,base_url:null,health:'not_configured',failure_code:null,workflow_count:null,checked_at:null,last_success_at:null});
function apiRow() {
 const tenant=currentHarnessTenantId();
 if(!apiRows.has(tenant))apiRows.set(tenant,tenant.endsWith('-b')||mode()==='empty'?emptyApi(tenant):{...emptyApi(tenant),configured:true,label:'Harness instance',base_url:'https://harness.example.invalid',health:mode()==='connected'?'connected':mode()==='saved-only'||mode()==='pending'?'saved_unverified':'needs_attention',failure_code:mode()==='connected'||mode()==='saved-only'||mode()==='pending'?null:'authentication_rejected',workflow_count:mode()==='connected'?0:null,checked_at:mode()==='saved-only'?null:'2026-09-03T12:00:00Z',last_success_at:mode()==='connected'?'2026-09-03T12:00:00Z':null});
 return apiRows.get(tenant);
}
function mcpRow(){
 const tenant=currentHarnessTenantId();
 if(!mcpRows.has(tenant))mcpRows.set(tenant,tenant.endsWith('-b')||mode()==='empty'?none():{configured:true,enabled:true,status:mode()==='connected'||mode()==='readonly'?'connected':'error',auth_kind:'bearer',transport:'http',server_url_host:'harness.example.invalid',last_probed_at:'2026-09-03T12:00:00Z',tool_count:mode()==='connected'?2:null,approved_capabilities:mode()==='connected'?['fixture_read']:[],pinned_count:mode()==='connected'?1:0});
 return mcpRows.get(tenant);
}
/** Gateway tool rows, keyed to the same `?data=` vocabulary the rest of this stub uses. */
function gatewayRows(){
 const tenant=currentHarnessTenantId();
 if(savedGatewayRows.has(tenant)) return mode()==='readback-fail' ? [] : savedGatewayRows.get(tenant)!;
 if(tenant.endsWith('-b')||mode()==='empty')return [];
 const base={provider_key:'generic-remote',transport:'http',auth_kind:'bearer',configured:true,enabled:true,visibility:'tenant',granted_scopes:[] as string[]};
 if(mode()==='oauth-return')return [{...base,connection_id:'00000000-0000-4000-8000-000000000021',label:'Test service',auth_kind:'none',status:'pending_verification',health:'unknown',server_url_host:'service.example',last_checked_at:null,tool_count:0,approved_count:0}];
 // ?data=held — the duplicate-tile case the owner reported. Two connections to vendors the
 // catalogue NAMES, carrying labels of the shape the one-time backfill composed per tenant.
 // The labels are invented for this fixture on purpose: a real account's name never becomes
 // example data (§63), and the point being rendered is that a composed label is not a tool name.
 if(mode()==='held')return [
  {...base,provider_key:'zapier',auth_kind:'oauth',connection_id:'harness-held-z',label:'workspace-Zapier',status:'connected',health:'healthy',server_url_host:'mcp.zapier.com',last_checked_at:'2026-09-20T10:00:00Z',tool_count:4,approved_count:1},
  {...base,provider_key:'n8n',auth_kind:'api_key',connection_id:'harness-held-n',label:'n8n- workspace',status:'connected',health:'healthy',server_url_host:'team.app.n8n.cloud',last_checked_at:'2026-09-20T10:00:00Z',tool_count:3,approved_count:0},
 ];
 return [
  {...base,connection_id:'harness-tool-1',label:'Scheduling tool',status:'connected',health:'healthy',server_url_host:'scheduling.example.invalid',last_checked_at:'2026-09-20T10:00:00Z',tool_count:6,approved_count:2},
  {...base,connection_id:'harness-tool-2',label:'Docs tool',status:'pending_verification',health:'unknown',server_url_host:'docs.example.invalid',last_checked_at:null,tool_count:0,approved_count:0},
  {...base,connection_id:'harness-tool-3',label:'Billing tool',status:'error',health:'needs_attention',server_url_host:'billing.example.invalid',last_checked_at:'2026-09-19T08:00:00Z',tool_count:0,approved_count:0},
 ];
}
/**
 * The per-action catalogue behind the gateway's `tools` action, keyed by connection so the
 * drawer's three fixture connections each render a DIFFERENT honest state:
 *   harness-tool-1 (connected, last_checked_at set) — a real list spanning every row state.
 *   harness-tool-2 (pending_verification)           — no list at all; the drawer's own banner.
 *   harness-tool-3 (error, rows survive the failure) — a dated list under the stale-read warning.
 * Every field mirrors what `get_mcp_connection_tools` projects; the approval verdicts are
 * SERVER-computed there and are therefore fixtures here rather than anything the surface derives.
 */
const gatewayTools:Record<string,Array<Record<string,unknown>>>={
 'harness-tool-1':[
  {tool_name:'list_events',app:'Scheduling',action_type:'calendar.list',effects:['read'],observed_at:'2026-09-20T10:00:00Z',approved:false,approved_at:null,expires_at:null,approval_expired:false,approval_stale:false,approved_by_you:false,approval_blocked_reason:null},
  {tool_name:'send_invite',app:'Scheduling',action_type:'calendar.invite',effects:['read'],observed_at:'2026-09-20T10:00:00Z',approved:false,approved_at:null,expires_at:null,approval_expired:false,approval_stale:false,approved_by_you:false,approval_blocked_reason:null},
  {tool_name:'create_booking',app:'Scheduling',action_type:'calendar.create',effects:['create'],observed_at:'2026-09-20T10:00:00Z',approved:true,approved_at:'2026-09-20T11:00:00Z',expires_at:'2026-10-20T11:00:00Z',approval_expired:false,approval_stale:false,approved_by_you:true,approval_blocked_reason:null},
  {tool_name:'cancel_booking',app:'Scheduling',action_type:'calendar.cancel',effects:['delete'],observed_at:'2026-09-20T10:00:00Z',approved:true,approved_at:'2026-09-01T11:00:00Z',expires_at:'2026-09-02T11:00:00Z',approval_expired:true,approval_stale:false,approved_by_you:true,approval_blocked_reason:'approval_expired'},
  {tool_name:'reschedule',app:'Scheduling',action_type:'calendar.move',effects:['update'],observed_at:'2026-09-20T10:00:00Z',approved:true,approved_at:'2026-09-10T11:00:00Z',expires_at:'2026-10-10T11:00:00Z',approval_expired:false,approval_stale:true,approved_by_you:false,approval_blocked_reason:'contract_changed'},
  {tool_name:'charge_deposit',app:'Scheduling',action_type:'billing.charge',effects:['send'],observed_at:'2026-09-20T10:00:00Z',approved:true,approved_at:'2026-09-18T11:00:00Z',expires_at:'2026-10-18T11:00:00Z',approval_expired:false,approval_stale:false,approved_by_you:true,approval_blocked_reason:'endpoint_changed'},
  {tool_name:'weather_hint',app:'Scheduling',action_type:'ext.weather',effects:[],observed_at:'2026-09-20T10:00:00Z',approved:false,approved_at:null,expires_at:null,approval_expired:false,approval_stale:false,approved_by_you:false,approval_blocked_reason:null},
 ],
 'harness-tool-2':[],
 'harness-tool-3':[
  {tool_name:'list_invoices',app:'Billing',action_type:'invoice.list',effects:['read'],observed_at:'2026-09-14T08:00:00Z',approved:false,approved_at:null,expires_at:null,approval_expired:false,approval_stale:false,approved_by_you:false,approval_blocked_reason:null},
  {tool_name:'charge_card',app:'Billing',action_type:'invoice.charge',effects:['send'],observed_at:'2026-09-14T08:00:00Z',approved:false,approved_at:null,expires_at:null,approval_expired:false,approval_stale:false,approved_by_you:false,approval_blocked_reason:null},
 ],
};
const ok=(data:unknown=null)=>Promise.resolve({data,error:null});
const fail=(message:string)=>Promise.resolve({data:null,error:{message}});
const pending:Array<()=>void>=[];
window.addEventListener('n8n-harness-finish',()=>pending.splice(0).forEach(f=>f()));
const delayed=(run:()=>Record<string,unknown>)=>mode()==='pending'?new Promise(resolve=>pending.push(()=>resolve({data:run(),error:null}))):ok(run());
export const supabase={
 rpc:(name:string,args:Record<string,unknown>={})=>{
  if(name==='get_n8n_connection_readiness')return mode()==='error'||mode()==='mcp-error'?fail('fixture-read-refused'):ok({tenant_id:currentHarnessTenantId(),can_manage:mode()!=='readonly',api:{},mcp:{state:mcpRow()?.configured?'oauth_needed':'not_configured',auth_kind:mcpRow()?.auth_kind??null,oauth_readiness:'ready',approved_workflow_count:0,approved_tool_count:0,server_url:'https://harness.example.invalid/mcp-server/http'}});
  if(name==='get_tenant_n8n_api_readiness')return mode()==='error'||mode()==='api-error'?fail('fixture-read-refused'):ok(apiRow());
  if(name==='get_tenant_mcp_connections')return mode()==='error'||mode()==='mcp-error'?fail('fixture-read-refused'):ok({n8n:mcpRow(),zapier:none()});
  // The registry-native MCP gateway read (G1b). Host + aggregates only, exactly as
  // `get_mcp_connections_v2` projects it — no secret is representable in this shape.
  if(name==='get_mcp_connections_v2')return mode()==='error'||mode()==='gateway-error'?fail('fixture-read-refused'):ok(gatewayRows());
  if(name==='is_current_user_tenant_admin')return ok(mode()!=='readonly');
 // The retry flow in ?data=signin-fail genuinely calls this one. A catch-all `ok()` answered it
 // with {data:null}, which trips the hook's acknowledgement guard, so the harness silently
 // rendered a generic refusal on a path the unit tests prove works — a wrong SHAPE, not a
 // wrong value, and therefore invisible.
 if(name==='set_mcp_connection_endpoint'){
  const tenant=currentHarnessTenantId();
  const rows=gatewayRows();const found=rows.find(row=>row.connection_id===args._connection_id);
  if(!found)return ok({ok:false,error:'not_found'});
  const generation=Number(found.config_generation??0)+1;
  Object.assign(found,{config_generation:generation,address_configured:true,credentials_configured:Boolean(args._auth_token),custom_header_count:Object.keys(args._custom_headers as object??{}).length,auth_kind:args._auth_kind,status:'pending_verification',last_checked_at:null});
  savedGatewayRows.set(tenant,rows);
  return ok({connection_id:args._connection_id,config_generation:generation});
 }
 // Anything else is a gap in this fixture or a bug in the caller. It must be loud: a silent
 // null-shaped success is how a renamed RPC passes for a working one.
 return fail('unstubbed rpc: '+name);
 },
 functions:{invoke:(name:string,options:{body?:Record<string,unknown>})=>{
  const body=options?.body??{};const tenant=currentHarnessTenantId();
  if(body.expected_tenant_id!==tenant||mode()==='readonly'||mode()==='refused')return ok({error:'forbidden'});
  if(name==='tenant-mcp-connect'&&body.action==='disconnect'){mcpRows.set(tenant,none());return ok({ok:true});}
  // The registry-native gateway door (Slice ④). Only the two actions the catalogue sign-in flow
  // spends are served, and deliberately so: `create` acknowledges the credential-less shell row,
  // and `oauth_begin` REFUSES under ?data=signin-fail so the retry state — the one where the name
  // is locked because `set_mcp_connection_endpoint` carries no label — can be rendered at all.
  // Without a refusal the flow navigates to a provider and the state is unreachable in a harness.
  if(name==='mcp-gateway'){
   gatewayCalls.push({action:body.action,connectionId:body.connection_id});
   if(body.action==='create'){
    if(mode()==='gateway-save-fail')return ok({ok:false,error:'MCP_FORBIDDEN'});
    const rows=gatewayRows(); const id='harness-saved-'+(rows.length+1);
    savedGatewayRows.set(tenant,[...rows,{connection_id:id,label:body.label,provider_key:'generic-remote',transport:'http',auth_kind:body.auth_kind,configured:true,enabled:true,status:'pending_verification',health:'unknown',server_url_host:new URL(String(body.server_url)).hostname,config_generation:1,address_configured:true,credentials_configured:Boolean(body.auth_token),custom_header_count:Object.keys(body.custom_headers as object??{}).length,last_checked_at:null,tool_count:0,approved_count:0}]);
    return ok({connection_id:id,config_generation:1,status:'pending_verification'});
   }
   if(body.action==='verify'){
    const found=gatewayRows().find(row=>row.connection_id===body.connection_id);
    if(!found)return ok({ok:false,error:'not_found'});
    Object.assign(found,{status:'connected',health:'healthy',last_checked_at:'2026-09-29T12:00:00Z'});
    return ok({ok:true,connection_id:body.connection_id,tool_count:0});
   }
   if(body.action==='oauth_begin')return mode()==='signin-fail'
    ?ok({error:'discovery_failed'})
    :ok({authorize_url:'https://provider.example.invalid/authorize?harness=1'});
   // Door 1's read. `?data=tools-refused` drives the refusal branch, which must NOT render as an
   // empty list — "we couldn't read this" and "this offers nothing" are different sentences.
   if(body.action==='tools'){
    if(mode()==='tools-refused')return ok({error:'not_found'});
    const rows=gatewayTools[String(body.connection_id)]??[];
    const seen=rows.map(r=>String(r.observed_at)).sort().at(-1)??null;
    return ok({ok:true,connection_id:body.connection_id,tools:rows.map(r=>({
     name:r.tool_name,effects:r.effects,app:r.app,actionType:r.action_type,
     // The APPROVAL POLICY IS THE SERVER'S and is applied in the edge, so the fixture states the
     // decision rather than re-deriving it — including the case the policy exists for:
     // `send_invite` is labelled `["read"]` by its provider and is raised anyway by its name.
     requiresApproval:!(Array.isArray(r.effects)&&r.effects.length>0&&(r.effects as string[]).every(e=>e==='read')&&!/^(send|delete|create|update|post|write|remove|cancel|charge)_/.test(String(r.tool_name))),
     approvalBasis:Array.isArray(r.effects)&&(r.effects as string[]).length===0?'effects_undeclared'
      :/^(send|delete|cancel|charge)_/.test(String(r.tool_name))?'server_name_floor'
      :(r.effects as string[]).every(e=>e==='read')?null:'provider_declared_effect',
     approved:r.approved,approvedAt:r.approved_at,expiresAt:r.expires_at,
     approvalExpired:r.approval_expired,approvalStale:r.approval_stale,approvedByYou:r.approved_by_you,
     approvalBlockedReason:r.approval_blocked_reason??null,
     observedAt:r.observed_at,
    })),tool_count:rows.length,approved_count:rows.filter(r=>r.approved&&!r.approval_blocked_reason).length,observed_at:seen});
   }
   if(body.action==='approve'){
    if(mode()==='approve-refused')return ok({error:'tool_not_verified'});
    const rows=gatewayTools[String(body.connection_id)]??[];
    const hit=rows.find(r=>r.tool_name===body.tool_name);
    if(hit){hit.approved=true;hit.approved_at=new Date().toISOString();hit.expires_at=String(body.expires_at??'');hit.approval_expired=false;hit.approval_stale=false;hit.approved_by_you=true;}
    return ok({ok:true,connection_id:body.connection_id,tool_name:body.tool_name,approved:true});
   }
   // An action this stub does not serve is a BUG in the caller or a gap in the fixture, and it
   // answers the way the real function does — `unsupported_action`, the code the edge raises —
   // so a harness run can never make a mis-named action look like a working one.
   return ok({error:'unsupported_action'});
  }
  if(name!=='tenant-n8n-api-connect')return ok({error:'unavailable'});
  if(body.action==='disconnect'){apiRows.set(tenant,emptyApi(tenant));return ok({ok:true,outcome:'disconnected',connection:apiRow()});}
  if(body.action!=='save'&&body.action!=='validate')return ok({error:'operation_failed'});
  let address=String(apiRow()?.base_url??'');
  if(body.action==='save'){
   let url:URL;try{url=new URL(String(body.base_url));}catch{return ok({error:'save_failed'});}
   if(url.protocol!=='https:'||url.username||url.password)return ok({error:'save_failed'});
   address=url.origin;
  }
  // The submitted fixture key is neither retained nor returned.
  return delayed(()=>{
   if(tenant!==currentHarnessTenantId())return {ok:true,outcome:'stale',connection:apiRow()};
   const failed=['save-refused','permission-refused','endpoint-error','provider-error'].includes(mode());
   const failure=mode()==='save-refused'?'authentication_rejected':mode()==='permission-refused'?'request_refused':mode()==='endpoint-error'?'endpoint_not_found':'provider_unavailable';
   const connection={...emptyApi(tenant),configured:true,label:'Harness instance',base_url:address,health:failed?'needs_attention':'connected',failure_code:failed?failure:null,workflow_count:failed?null:0,checked_at:'2026-09-03T23:59:00Z',last_success_at:failed?null:'2026-09-03T23:59:00Z'};
   apiRows.set(tenant,connection);return {ok:true,saved:body.action==='save',outcome:failed?'needs_attention':'connected',connection};
  });
 }}
};
export default {supabase};
