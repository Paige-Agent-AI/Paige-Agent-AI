import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import '/src/index.css';
import {supabase} from '/src/integrations/supabase/client';
import AccountDetailsDialog from '/src/operator/surfaces/AccountDetailsDialog';
const params = new URLSearchParams(location.search), solo = params.has('solo'), archived = params.has('archived');
let row = {id:'synthetic-a',name:solo?'Example Solo':'Example Agency',status:'canceled',account_type:solo?'standalone':'agency',parent_tenant_id:null,version:'local-1',archived_at:archived?'2026-01-01':null,archive_operation_id:archived?'archive-a':null,execution_paused:archived};
let receipt = null, resource = null, deleted = false, files = params.has('files');
const calls=[]; window.fixtureCalls=calls;
const accounts = () => [{id:row.id,name:row.name,status:row.status,account_type:row.account_type,parent_tenant_id:null},...solo?[]:[{id:'synthetic-b',name:'Example Child',status:row.status,account_type:'sub_account',parent_tenant_id:row.id}]];
const review = () => ({tenant_id:row.id,accounts:accounts(),version:files?'with-files':row.version,data_version:row.version,archive_operation_id:row.archive_operation_id,memberships:solo?1:3,shared_identities:1,storage_count:files?2:0,dependencies:[{relation:'clients',count:3,disposition:'delete'},{relation:'paige_llm_trace',count:28,disposition:'preserve'},{relation:'tenant_twilio_subaccounts',count:1,disposition:'delete'}],preserved:['Shared logins and other workspaces','Required audit records and scheduled backups'],warnings:['PAIGE access and data can be retired now. External services and charges may remain; their cleanup is tracked separately.'],blockers:params.has('blocked')?['Independent legal retention must be resolved.']:[],execution_available:!params.has('blocked')});
supabase.rpc = async (name,args) => {
 calls.push(name);
 if(name==='operator_read_account_details')return deleted?{error:{code:'P0002',message:'Absent'}}:{data:{...row}};
 if(name==='operator_preview_account_archive')return {data:{...review(),dependencies:undefined,preserved:undefined,storage_count:undefined,data_version:undefined}};
 if(name==='operator_preview_account_deletion')return {data:files?{...review(),execution_available:false,blockers:['2 tenant-prefixed storage objects require the canonical Storage API cleanup and absence readback.']}:review()};
 if(name==='operator_preview_retirement_resources')return {data:{...review(),mode:'delete',execution_available:!params.has('blocked'),resources:[{provider:'tts_cache',tenant_id:row.id,action:'remove_cache',object_count:1},{provider:'generated_media',tenant_id:row.id,action:'remove_media',object_count:1}]}};
 if(name==='operator_read_retirement_resources')return resource?{data:resource}:{error:{code:'P0002',message:'No file operation'}};
 if(name==='operator_read_archive_receipt')return {data:receipt};
 const state = name==='operator_archive_account'?'archived':name==='operator_restore_archived_account'?'restored':name==='operator_delete_archived_account'?'deleted':null;
 if(!state)throw Error('Unexpected fixture RPC');
 row={...row,archived_at:state==='archived'?'2026-01-01':null,archive_operation_id:state==='archived'?args._operation_id:null,execution_paused:true,version:'local-'+state};
 deleted=state==='deleted';receipt={tenant_id:row.id,operation_id:args._operation_id,state,account_count:accounts().length,external_cleanup_pending:true};
 if(params.has('unknown')&&!window.interrupted){window.interrupted=true;throw Error('Synthetic response lost after commit');}
 return {data:receipt};
};
Object.defineProperty(supabase,'functions',{value:{invoke:async(name,{body})=>{
 if(name!=='operator-account-retirement')throw Error('Unexpected fixture function');calls.push('files:'+body.action);
 resource={tenant_id:row.id,operation_id:body.operation_id,mode:'delete',state:body.action==='prepare'?'resources_preparing':'resources_ready',account_count:accounts().length,results:[{provider:'tts_cache',state:'verified',provider_status:'removed',reason:null},...body.action==='prepare'?[]:[{provider:'generated_media',state:'verified',provider_status:'removed',reason:null}]]};
 if(resource.state==='resources_ready')files=false;
 return {data:resource};
}}});
function Proof(){const [open,setOpen]=useState(false),[dark,setDark]=useState(false),[,refresh]=useState(0);return <main data-pg={dark?'dark':'light'} style={{minHeight:'100vh',background:'var(--pg-canvas)',color:'var(--pg-ink)',padding:24}}>
 <p>Actual Operator component · Synthetic RPC/actor · Remote requests blocked · Live acceptance unverified</p>
 <button onClick={()=>{document.documentElement.classList.toggle('dark',!dark);setDark(!dark);}}>Switch theme</button>
 {!deleted&&<button onClick={()=>setOpen(true)}>Account details</button>}
 {open&&<AccountDetailsDialog tenantId={row.id} onClose={()=>setOpen(false)} onChanged={()=>refresh(n=>n+1)}/>}
 </main>;}
createRoot(document.getElementById('root')!).render(<Proof/>);
