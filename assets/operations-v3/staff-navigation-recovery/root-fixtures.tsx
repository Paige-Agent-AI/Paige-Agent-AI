// Explicit synthetic ports only. Production never imports these fixtures.
import {supabase as preparation} from '../staff-preparation/root-fixtures';
import {supabase as review} from '../staff-review/root-fixtures';
const reviewing=new URLSearchParams(location.search).get('role')==='review';
let revoked=false,replaced=false;const calls:Array<{name:string;args:unknown}>=[];
export const supabase={auth:(reviewing?review:preparation).auth,rpc:async(name:string,args:Record<string,unknown>)=>{
 calls.push({name,args});if(revoked&&['operations_delivery_artifact_scoped','list_studio_sessions','list_artifact_versions'].includes(name))return{data:null,error:{code:'42501'}};
 const result=await(reviewing?review:preparation).rpc(name,args);
 if(replaced&&name==='operations_delivery_list_scoped'&&result.data&&'submissions' in result.data){const data=result.data as {submissions:Array<Record<string,unknown>>};return{...result,data:{...result.data,submissions:data.submissions.map(r=>({...r,id:'ed550000-0000-4000-8000-000000000012',artifact_version_id:'ed550000-0000-4000-8000-000000000013',artifact_digest:'b'.repeat(64),revision_no:2}))}};}
 if(replaced&&name==='operations_delivery_artifact_scoped'&&result.data)return{...result,data:{...result.data,submission_id:'ed550000-0000-4000-8000-000000000012',artifact_version_id:'ed550000-0000-4000-8000-000000000013',artifact_digest:'b'.repeat(64),revision_no:2,title:'Different authorized source',body:'Current second source body'}};
 return result;
}};
Object.assign(window,{__navigationRecoveryFixture:{calls:()=>calls,revoke:()=>{revoked=true;},replace:()=>{replaced=true;}}});
