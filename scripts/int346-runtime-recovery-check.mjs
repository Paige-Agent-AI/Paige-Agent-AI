import assert from 'node:assert/strict';
import {interactiveRuntimeIdentity,interactiveRecoveryReadAllowed} from '../supabase/functions/_shared/paige-turn/interactive.ts';
import {PAIGE_SPINE_CAPABILITIES} from '../supabase/functions/_shared/paige-spine/registry.ts';
import {readInteractiveOutcomeStatus} from '../supabase/functions/_shared/paige-turn/outcome-status.ts';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const reads=new Set(['read_business_metric','get_business_snapshot','read_client_engagement_status','read_business_time_zone','read_calendar_booking','crm_get_task']);
const deployment=`abcdefghijklmnopqrst_${id(82)}_441`;
let passed=0;const check=(name,fn)=>{fn();console.log(`ok ${++passed} - ${name}`);};
check('server identity records separate per-request nonce in a shared isolate',()=>{
 const a=interactiveRuntimeIdentity(id(80),deployment,id(81)),b=interactiveRuntimeIdentity(id(80),deployment,id(82));
 assert.equal(a.executionId,b.executionId);assert.notEqual(a.requestNonce,b.requestNonce);
});
for(const [execution,dep,nonce] of [[null,deployment,id(81)],[id(80),null,id(81)],['browser',deployment,id(81)],[id(80),'other-provider',id(81)],[id(80),deployment,'not-uuid']])
 check('missing/malformed hosted identity stays unbound',()=>assert.equal(interactiveRuntimeIdentity(execution,dep,nonce),null));
for(const tool of reads)check(`actual Spine read intersection ${tool}`,()=>assert.equal(interactiveRecoveryReadAllowed(tool,reads,PAIGE_SPINE_CAPABILITIES),true));
for(const tool of ['propose_action','pipeline_archive_preview','crm_create_task','send_email','knowledge_delete','document_generate','schedule_reminder','unclassified_tool'])
 check(`no recovered authority for ${tool}`,()=>assert.equal(interactiveRecoveryReadAllowed(tool,reads,PAIGE_SPINE_CAPABILITIES),false));
const target=PAIGE_SPINE_CAPABILITIES.find(c=>c.action?.chatTool==='crm_get_task');
for(const action of [{classification:'mutate'},{riskPolicyKey:'money_move'},{approvalAuthority:'confirm'}])
 check('changed server declaration fails closed',()=>assert.equal(interactiveRecoveryReadAllowed('crm_get_task',reads,[{...target,action:{...target.action,...action}}]),false));
check('duplicate declaration refuses ambiguous authority',()=>assert.equal(interactiveRecoveryReadAllowed('crm_get_task',reads,[target,target]),false));
check('allowlist membership cannot replace Spine metadata',()=>assert.equal(interactiveRecoveryReadAllowed('crm_get_task',reads,[]),false));
const status=await readInteractiveOutcomeStatus({state:async()=>({executor:id(1),terminal:false,stopped:true,recovery_read_only:true})});
check('status exposes native read-only hold without pretending Stop settled producer',()=>{assert.equal(status.recovery_read_only,true);assert.equal(status.settled,false);});
const legacy=await readInteractiveOutcomeStatus({state:async()=>({executor:null,terminal:true})});
check('legacy status shape is preserved without invented recovery metadata',()=>assert.deepEqual(legacy,{executor_active:false,settled:true}));
console.log(`PASS ${passed} pure actual-registry controls / 0 failed`);
