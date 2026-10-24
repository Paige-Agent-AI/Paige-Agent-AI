// Original explicit synthetic ports, reused for current-parent component proof.
// No real session, native record, provider or business permission is supplied.
export * from './root-fixtures';
import {useOperationsPeople as originalPeople,useTenantContext} from './root-fixtures';
import {supabase} from './root-fixtures';
// Current Work subscribes to Auth lifecycle changes. The old proof port omitted
// this structural SDK member; do not change production Auth to accommodate it.
Object.assign(supabase.auth,{onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})});
export function useTierFeatures(){return {has:()=>true,tierKey:'solo',soloStandalone:true,loading:false};}
export function useOperationsPeople(){const people=originalPeople(),actor=useTenantContext().activeUserId;return new URLSearchParams(location.search).get('single')==='1'?{...people,members:people.members.filter(m=>m.user_id===actor)}:people;}
