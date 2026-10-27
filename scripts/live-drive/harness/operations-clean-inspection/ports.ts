// Neutral UI-only data ports over the original Operations mount. No live identity.
export * from '../operations-release-mount/stubs';
import {ACTOR,TENANT} from '../operations-release-mount/stubs';
export function useOperationsCrmWork(){return{tasks:[{id:'00000000-0000-4000-8000-000000000077',tenant_id:TENANT,user_id:ACTOR,
 title:'Protected neutral CRM inspection',description:'Synthetic read-only interface proof. No real work or provider.',status:'pending',due_date:null,
 updated_at:'2026-10-27T12:00:00.123456Z',created_at:null,deal_id:null,biz_id:null,recorded_priority:null,estimated_minutes:null}],
 loading:false,error:null,forbidden:false,hasMore:false,refresh:async()=>undefined,readTask:async()=>null};}
