import {createClient} from 'npm:@supabase/supabase-js@2';
import {decideDeclaredCapability} from '../_shared/capability-kit/decision.ts';
import {confirmFingerprint} from '../_shared/confirm-fingerprint.ts';
import {recordCapabilityRun,stableRunId} from '../_shared/capability-record.ts';
import {commsProviderExecutionAllowed} from '../_shared/comms-provider-boundary.ts';
import {runPreSend} from '../_shared/pre-send-pipeline.ts';
import {PORTAL_INVITATION_CAPABILITY,PORTAL_INVITATION_TOOL} from '../_shared/paige-spine/domains/client_portal.ts';
import {sendCanonicalPortalInvite,deliveryReceipt,savedDelivery,type Options} from './canonical-delivery.ts';

type Data=Record<string,unknown>;
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const object=(v:unknown):v is Data=>!!v&&typeof v==='object'&&!Array.isArray(v);
const sameKeys=(v:Data,keys:string[])=>Object.keys(v).length===keys.length&&Object.keys(v).every(k=>keys.includes(k));
const json=(status:number,body:Data)=>new Response(JSON.stringify({ok:false,delivery_confirmed:false,...body}),{status,headers:{'Access-Control-Allow-Origin':'*','Content-Type':'application/json','Cache-Control':'no-store'}});
const refuse=(status:number,code:string,outcome='refused')=>json(status,{outcome,code});
const operationKeys=['actor_id','tenant_id','operation_id','found','invitation_id','contact_id','recipient','proposal_hash','receipt_id','created_at','expires_at','state'];

/** The canonical confirmation adapter. The provider helper is INTERNAL, never a second HTTP door. */
export async function handlePortalInvitationCommand(req:Request,input:unknown,options:Options):Promise<Response>{
 if(!object(input)||Object.keys(input).some(k=>!['expected_tenant_id','operation_id','contact_id','approved_fingerprint'].includes(k))
  ||!uuid(input.expected_tenant_id)||!uuid(input.operation_id)||!uuid(input.contact_id)
  ||input.approved_fingerprint!==undefined&&(typeof input.approved_fingerprint!=='string'||!/^[0-9a-f]{16}$/.test(input.approved_fingerprint)))return refuse(400,'INVITATION_COMMAND_INVALID');
 const tenant=input.expected_tenant_id.toLowerCase(),contact=input.contact_id.toLowerCase();let operation=input.operation_id.toLowerCase();
 const url=Deno.env.get('SUPABASE_URL'),anon=Deno.env.get('SUPABASE_ANON_KEY'),service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),authorization=req.headers.get('Authorization');
 if(!url||!anon||!service)return refuse(503,'INVITATION_UNAVAILABLE');
 if(!authorization||!/^Bearer\s+\S+$/i.test(authorization))return refuse(401,'UNAUTHENTICATED');
 const caller=createClient(url,anon,{global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false}});
 const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
 let prepared=false,existingInvitation:string|null=null;
 try{
  const auth=await caller.auth.getUser();if(auth.error||!uuid(auth.data.user?.id))return refuse(401,'UNAUTHENTICATED');const actor=auth.data.user.id.toLowerCase();
  const current=async()=>{const a=await caller.auth.getUser();if(a.error||!uuid(a.data.user?.id)||a.data.user.id.toLowerCase()!==actor)return false;const c=await caller.rpc('current_user_tenant_id');return !c.error&&c.data===tenant};
  if(!await current())return refuse(409,'WORKSPACE_CHANGED');
  // Actual caller-JWT native owner check precedes all privileged state/approval access.
  // Read first: an accepted customer is no longer invite-eligible, but the original email result survives.
  const prior=await caller.rpc('read_client_portal_invitation_operation',{p_tenant_id:tenant,p_operation_id:operation});
  if(prior.error||!object(prior.data)||prior.data.actor_id!==actor||prior.data.tenant_id!==tenant||prior.data.operation_id!==operation)return refuse(503,'INVITATION_OPERATION_UNAVAILABLE','outcome_unknown');
  if(prior.data.found===true){
   prepared=true;
   if(!sameKeys(prior.data,operationKeys)||prior.data.contact_id!==contact||!uuid(prior.data.invitation_id)||!uuid(prior.data.receipt_id))return refuse(409,'INVITATION_OPERATION_CHANGED','outcome_unknown');
   const read=await caller.rpc('read_client_portal_invitation_delivery',{p_tenant_id:tenant,p_operation_id:operation});
   if(read.error)return refuse(503,'INVITATION_DELIVERY_UNAVAILABLE','outcome_unknown');
   const delivered=deliveryReceipt(read.data,actor,tenant,operation);
   if(delivered.found===true&&delivered.invitation_id!==prior.data.invitation_id)return refuse(409,'INVITATION_OPERATION_CHANGED','outcome_unknown');
   if(delivered.found===true&&['provider_accepted','failed','refused'].includes(String(delivered.outcome)))return savedDelivery(delivered,true);
   if(prior.data.state!=='prepared')return refuse(409,'INVITATION_NO_LONGER_ACTIVE','outcome_unknown');
   existingInvitation=prior.data.invitation_id;
  }else if(prior.data.found!==false||!sameKeys(prior.data,['actor_id','tenant_id','operation_id','found']))return refuse(503,'INVITATION_OPERATION_UNAVAILABLE','outcome_unknown');
  // Same canonical log, after positive native owner read. A new turn/interface must recover
  // THIS customer's original unknown operation, rather than minting another token/key.
  const pendingDelivery=await admin.from('email_send_log').select('id,tenant_id,idempotency_key,metadata').eq('tenant_id',tenant)
   .eq('template_name','portal_invite').like('idempotency_key','customer-portal-delivery/v1/%').eq('metadata->>contact_id',contact)
   .in('status',['pending','failed']).or('metadata->>outcome.is.null,metadata->>outcome.eq.outcome_unknown').order('created_at',{ascending:false}).limit(2);
  if(pendingDelivery.error||!Array.isArray(pendingDelivery.data))return refuse(503,'INVITATION_RECOVERY_UNAVAILABLE','outcome_unknown');
  if(pendingDelivery.data.length>1)return refuse(409,'INVITATION_RECOVERY_CHOICE_REQUIRED','outcome_unknown');
  if(pendingDelivery.data.length===1){
   const row:unknown=pendingDelivery.data[0];
   if(!object(row)||!uuid(row.id)||row.tenant_id!==tenant||!object(row.metadata)||row.metadata.contact_id!==contact
    ||!uuid(row.metadata.operation_id)||!uuid(row.metadata.invite_id)||row.idempotency_key!==`customer-portal-delivery/v1/${tenant}/${row.metadata.operation_id}`)return refuse(503,'INVITATION_RECOVERY_UNAVAILABLE','outcome_unknown');
   operation=row.metadata.operation_id;existingInvitation=row.metadata.invite_id;prepared=true;
   const original=await caller.rpc('read_client_portal_invitation_delivery',{p_tenant_id:tenant,p_operation_id:operation});
   if(original.error)return refuse(503,'INVITATION_RECOVERY_UNAVAILABLE','outcome_unknown');
   const value=deliveryReceipt(original.data,actor,tenant,operation);
   if(value.found!==true||value.invitation_id!==existingInvitation||value.receipt_id!==row.id)return refuse(503,'INVITATION_RECOVERY_UNAVAILABLE','outcome_unknown');
   if(['provider_accepted','failed','refused'].includes(String(value.outcome)))return savedDelivery(value,true);
  }
  const targetResult=await caller.rpc('prepare_client_portal_invitation',{p_tenant_id:tenant,p_contact_id:contact}),target:unknown=targetResult.data;
  if(targetResult.error||!object(target)||!sameKeys(target,['actor_id','tenant_id','contact_id','recipient','proposal_hash'])
   ||target.actor_id!==actor||target.tenant_id!==tenant||target.contact_id!==contact||typeof target.recipient!=='string'
   ||typeof target.proposal_hash!=='string'||!/^[0-9a-f]{64}$/.test(target.proposal_hash))return refuse(403,'INVITATION_TARGET_UNAVAILABLE',prepared?'outcome_unknown':'refused');
  // An acknowledged token with no email claim can also survive a browser/process interruption.
  // Reuse the actual owned, unused recipient-bound record instead of silently minting another.
  if(!existingInvitation){
   const available=await admin.from('tenant_invite_tokens').select('id,tenant_id,contact_id,email,kind,created_by,portal_operation_id')
    .eq('tenant_id',tenant).eq('contact_id',contact).eq('kind','consumer').eq('email',target.recipient)
    .not('portal_operation_id','is',null)
    .is('revoked_at',null).is('last_used_at',null).eq('uses',0).eq('max_uses',1).gt('expires_at',new Date().toISOString())
    .order('created_at',{ascending:false}).limit(2);
   if(available.error||!Array.isArray(available.data))return refuse(503,'INVITATION_RECOVERY_UNAVAILABLE','outcome_unknown');
   if(available.data.length>1)return refuse(409,'INVITATION_CHOICE_REQUIRED','held');
   if(available.data.length===1){
    const v:unknown=available.data[0];
    if(!object(v)||!uuid(v.id)||v.tenant_id!==tenant||v.contact_id!==contact||v.kind!=='consumer'||v.email!==target.recipient)return refuse(503,'INVITATION_RECOVERY_UNAVAILABLE','outcome_unknown');
    existingInvitation=v.id;prepared=true;
    if(v.created_by===actor&&uuid(v.portal_operation_id)){
     const original=await caller.rpc('read_client_portal_invitation_operation',{p_tenant_id:tenant,p_operation_id:v.portal_operation_id});
     const op:unknown=original.data;
     if(original.error||!object(op)||!sameKeys(op,operationKeys)||op.actor_id!==actor||op.tenant_id!==tenant||op.operation_id!==v.portal_operation_id||op.contact_id!==contact||op.invitation_id!==v.id||op.found!==true||op.state!=='prepared')return refuse(503,'INVITATION_PREPARATION_UNCONFIRMED','outcome_unknown');
     const email=await caller.rpc('read_client_portal_invitation_delivery',{p_tenant_id:tenant,p_operation_id:v.portal_operation_id});
     if(email.error)return refuse(503,'INVITATION_RECOVERY_UNAVAILABLE','outcome_unknown');
     const saved=deliveryReceipt(email.data,actor,tenant,v.portal_operation_id);
     if(saved.found===true&&saved.invitation_id!==v.id)return refuse(503,'INVITATION_RECOVERY_UNAVAILABLE','outcome_unknown');
     // No email attempt or an unknown attempt continues the original operation. A
     // deliberate fresh send after a known result keeps this request's new operation.
     if(saved.found===false||!['provider_accepted','failed','refused'].includes(String(saved.outcome)))operation=v.portal_operation_id;
    }
   }
  }
  if(!options.key||!await commsProviderExecutionAllowed(admin,{tenantId:tenant,actorUserId:actor,recipientEmail:target.recipient}))return refuse(403,'INVITATION_DELIVERY_HELD',prepared?'outcome_unknown':'refused');
  if(!(await runPreSend(admin as unknown as Parameters<typeof runPreSend>[0],{tenantId:tenant,contactId:contact,to:target.recipient,channel:'email'})).proceed)return refuse(409,'INVITATION_POLICY_HELD',prepared?'outcome_unknown':'held');

  const requestArgs:Data={expected_tenant_id:tenant,operation_id:operation,contact_id:contact,invitation_id:existingInvitation,recipient:target.recipient,proposal_hash:target.proposal_hash};
  // The existing trusted proposal is the ONLY approval store. Recovery needs a fresh cycle after consumption.
  if(input.approved_fingerprint===undefined){
   const pending=await admin.from('paige_pending_confirmations').select('args').eq('user_id',actor).eq('tenant_id',tenant)
    .eq('tool_name',PORTAL_INVITATION_TOOL).is('thread_id',null).is('scoped_client_id',null).is('consumed_at',null)
    .not('server_issued_at','is',null).not('issued_in_request','is',null).gt('expires_at',new Date().toISOString())
    .contains('args',{operation_id:operation}).order('server_issued_at',{ascending:false}).limit(1).maybeSingle();
   if(pending.error)return refuse(503,'APPROVAL_STORE_UNAVAILABLE',prepared?'outcome_unknown':'refused');
   if(pending.data){const old:unknown=pending.data.args;
    if(!object(old)||old.expected_tenant_id!==tenant||old.operation_id!==operation||old.contact_id!==contact||old.invitation_id!==existingInvitation||old.recipient!==target.recipient||old.proposal_hash!==target.proposal_hash||!uuid(old.approval_cycle_nonce))return refuse(409,'INVITATION_REVIEW_CHANGED',prepared?'outcome_unknown':'refused');
    requestArgs.approval_cycle_nonce=old.approval_cycle_nonce;
   }else requestArgs.approval_cycle_nonce=crypto.randomUUID();
  }
  const laneResult=await caller.rpc('resolve_tool_autonomy',{_tenant_id:tenant,_tool_key:PORTAL_INVITATION_TOOL});
  const lane=!laneResult.error&&['auto','confirm','off'].includes(laneResult.data)?laneResult.data:'unresolved';
  const nonce=crypto.randomUUID();let claimedArgs:Data|null|undefined;
  if(input.approved_fingerprint!==undefined){
   claimedArgs=null;if(!await current())return refuse(409,'WORKSPACE_CHANGED',prepared?'outcome_unknown':'refused');
   const claimed=await admin.from('paige_pending_confirmations').update({consumed_at:new Date().toISOString()})
    .eq('user_id',actor).eq('tenant_id',tenant).eq('tool_name',PORTAL_INVITATION_TOOL).eq('fingerprint',input.approved_fingerprint)
    .is('thread_id',null).is('scoped_client_id',null).is('consumed_at',null).not('server_issued_at','is',null).not('issued_in_request','is',null)
    .neq('issued_in_request',nonce).gt('expires_at',new Date().toISOString()).select('args').maybeSingle();
   if(!claimed.error&&object(claimed.data?.args))claimedArgs=claimed.data.args;
  }
  const decision=decideDeclaredCapability(PORTAL_INVITATION_CAPABILITY,{
   caller:{authenticated:true,userId:actor,principal:'person',tenantId:tenant,tenantSource:'server',door:'other',access:{allowed:true,reason:'Current native portal owner authority.'}},
   capability:{id:PORTAL_INVITATION_TOOL,effect:'mutate',outcomeChannel:'record_capability_run',availability:'needs_approval'},
   approval:{autonomyLane:lane,...(claimedArgs!==undefined?{claimedArgs,claimedFor:PORTAL_INVITATION_TOOL}:{})},requestArgs,
  });
  const audit=await admin.from('paige_audit_log').insert({actor_user_id:actor,actor_role:'portal:owner_authorized',tenant_id:tenant,action:'client_portal.invitation_governed_decision',target_type:'contact',target_id:contact,
   payload:{capability:PORTAL_INVITATION_TOOL,decision:decision.kind,risk:decision.risk,lane_requested:decision.audit.laneRequested,lane_effective:decision.audit.laneEffective,clamped:decision.audit.clamped}});
  if(decision.kind==='refuse')return refuse(403,decision.code,prepared?'outcome_unknown':'refused');
  if(audit.error)return refuse(503,'INVITATION_DECISION_UNRECORDED',prepared?'outcome_unknown':'refused');
  if(decision.kind==='propose'){
   if(!await current())return refuse(409,'WORKSPACE_CHANGED',prepared?'outcome_unknown':'refused');
   const fingerprint=await confirmFingerprint(PORTAL_INVITATION_TOOL,requestArgs),now=new Date().toISOString();
   const expired=await admin.from('paige_pending_confirmations').update({consumed_at:now}).eq('user_id',actor).eq('tenant_id',tenant).eq('tool_name',PORTAL_INVITATION_TOOL)
    .eq('fingerprint',fingerprint).is('thread_id',null).is('scoped_client_id',null).is('consumed_at',null).not('server_issued_at','is',null).not('issued_in_request','is',null).lte('expires_at',now);
   if(expired.error)return refuse(503,'APPROVAL_STORE_UNAVAILABLE',prepared?'outcome_unknown':'refused');
   const summary=existingInvitation
    ?`Email the existing one-use portal invitation to ${target.recipient}. Delivery and customer acceptance are separate.`
    :`Invite this customer at ${target.recipient}. Portal access only; one use, up to 30 days. Delivery and customer acceptance are separate.`;
   const expires=new Date(Date.now()+10*60000).toISOString();
   let saved=await admin.from('paige_pending_confirmations').insert({user_id:actor,tenant_id:tenant,thread_id:null,scoped_client_id:null,tool_name:PORTAL_INVITATION_TOOL,fingerprint,
    issued_in_request:nonce,server_issued_at:now,args:requestArgs,summary,expires_at:expires}).select('summary,expires_at').maybeSingle();
   if(saved.error?.code==='23505')saved=await admin.from('paige_pending_confirmations').select('summary,expires_at').eq('user_id',actor).eq('tenant_id',tenant)
    .eq('tool_name',PORTAL_INVITATION_TOOL).eq('fingerprint',fingerprint).is('thread_id',null).is('scoped_client_id',null).is('consumed_at',null)
    .not('server_issued_at','is',null).not('issued_in_request','is',null).gt('expires_at',now).maybeSingle();
   if(saved.error||!saved.data)return refuse(503,'APPROVAL_STORE_UNAVAILABLE',prepared?'outcome_unknown':'refused');
   return json(202,{outcome:'approval_required',capability:PORTAL_INVITATION_TOOL,fingerprint,operation_id:operation,summary:saved.data.summary,expires_at:saved.data.expires_at,
    preview:{kind:'customer_invitation',to_address:target.recipient,contact_id:contact,existing_invitation:existingInvitation!==null}});
  }
  // ONLY the atomically claimed server call executes; neither model prose nor request args approve it.
  const stored:unknown=decision.args;
  if(!object(stored)||!sameKeys(stored,['expected_tenant_id','operation_id','contact_id','invitation_id','recipient','proposal_hash','approval_cycle_nonce'])
   ||stored.expected_tenant_id!==tenant||stored.operation_id!==operation||stored.contact_id!==contact||stored.invitation_id!==existingInvitation||stored.recipient!==target.recipient||stored.proposal_hash!==target.proposal_hash||!uuid(stored.approval_cycle_nonce))return refuse(403,'INVITATION_APPROVAL_INVALID',prepared?'outcome_unknown':'refused');
  if(!await current())return refuse(409,'WORKSPACE_CHANGED',prepared?'outcome_unknown':'refused');
  prepared=true;
  let preparationReceipt:string|null=null;
  if(!existingInvitation){
   const made=await caller.rpc('create_client_portal_invitation',{p_tenant_id:tenant,p_contact_id:stored.contact_id,p_proposal_hash:stored.proposal_hash,p_operation_id:stored.operation_id});
   const invitation:unknown=made.data;
   if(made.error||!object(invitation)||!sameKeys(invitation,[...operationKeys,'replayed'])||typeof invitation.replayed!=='boolean'||invitation.actor_id!==actor||invitation.tenant_id!==tenant||invitation.operation_id!==operation||invitation.contact_id!==contact
    ||invitation.proposal_hash!==stored.proposal_hash||invitation.recipient!==stored.recipient||invitation.found!==true||!uuid(invitation.invitation_id)||!uuid(invitation.receipt_id)||invitation.state!=='prepared')return refuse(503,'INVITATION_PREPARATION_UNCONFIRMED','outcome_unknown');
   existingInvitation=invitation.invitation_id;preparationReceipt=invitation.receipt_id;
  }
  const result=await sendCanonicalPortalInvite(req,{expected_tenant_id:tenant,invitation_id:existingInvitation,delivery_operation_id:operation},options,
   {contactId:contact,recipient:String(stored.recipient),proposalHash:String(stored.proposal_hash)});
  const outcome:unknown=await result.json();
  if(!object(outcome))return refuse(503,'INVITATION_OUTCOME_UNCONFIRMED','outcome_unknown');
  const recorded=await recordCapabilityRun(admin,{tenantId:tenant,actorId:actor,capabilityKey:'client.portal_invite',
   outcome:outcome.outcome==='provider_accepted'?'capability_succeeded':outcome.outcome==='failed'?'capability_failed':outcome.outcome==='refused'?'capability_refused':'capability_outcome_unknown',
   runId:await stableRunId(['client.portal_invite',tenant,actor,operation]),detail:{operation_id:operation,invitation_id:existingInvitation,source_receipt_id:outcome.receipt_id??preparationReceipt,outcome:outcome.outcome,delivery_confirmed:false}});
  return json(result.status,{...outcome,operation_id:operation,invitation_id:existingInvitation,invitation_prepared:true,rail_recorded:recorded});
 }catch{return refuse(503,prepared?'INVITATION_OUTCOME_UNCONFIRMED':'INVITATION_UNAVAILABLE',prepared?'outcome_unknown':'refused')}
}
