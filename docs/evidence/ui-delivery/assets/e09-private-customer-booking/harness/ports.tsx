// Local geometry/interaction evidence only. These are explicit synthetic ports,
// never an authenticated session, consent, model response or provider proof.
import {useEffect} from 'react';
import {supabase as booking,ids,selectCase} from './sdk';
const options=new URLSearchParams(window.location.search);
selectCase(options.get('case')||'saved');
const alternate=options.get('business')==='B';
export const frame={actorId:ids.actor,profile:{id:ids.client,tenant_id:ids.tenant,linked_user_id:ids.actor,first_name:'Avery',last_name:'Example',email:'client@example.test',phone:null},
 brand:{tenant_id:ids.tenant,tenant_name:alternate?'Northwind Studio':'Harbor Lane Advisors',tenant_slug:alternate?'test-tenant-northwind':'test-tenant-harbor',logo_url:null,primary_color:alternate?'#176b55':null,support_email:null},
 config:{assistant:{display_name:'Cura'},entitlements:{finance:false}}};
export const user={id:ids.actor,email:'client@example.test'};
export const session={user,access_token:'synthetic-local-only'};
export function useSharedClientPortalFrame(){return {frame,phase:'ready',checking:false,reload:async()=>{}};}
export const useClientPortalFrame=useSharedClientPortalFrame;
export function useExistingClientPortalFrame(){return {actorId:ids.actor,value:useSharedClientPortalFrame()};}
export function ClientPortalFrameProvider({children}:{children:React.ReactNode}){return children;}
export function useDashboardMode(){return {mode:'client',isAdmin:false,setMode:()=>{}};}
export function useImpersonation(){return {target:null,isImpersonating:false};}
export function useTenantContext(){return {activeTenantId:null,activeTenant:null,activeUserId:ids.actor,loading:false,accountContextLoading:false,accountContextStatus:'ready',isPlatformOwner:false,isPlatformStaff:false,tenants:[],soloShellEnabled:false,agencyShellEnabled:false};}
export const useOptionalTenantContext=useTenantContext;
export function useFinancePortal(){return {open:false,loading:false};}
export function useCreditFactors(){return {factors:null,loading:false};}
export function useTenantFeature(){return {enabled:false,loading:false};}
export function useUnreadSupportCount(){return {count:0};}
export function RequiredConsentsGate({onBlockingChange}:{onBlockingChange:(v:boolean)=>void}){useEffect(()=>onBlockingChange(false),[onBlockingChange]);return null;}
export function PushNotificationPrompt(){return null;}
export const pushTopicsSentence=()=>'';
export async function readCustomerChat(){return {threadId:'e09a0000-0000-4000-8000-000000000011',messages:[],latestRequestIntentId:null};}
export async function readCustomerChatOutcome(){throw new Error('No model or outcome execution in the local booking review');}
function query(){
 const result={data:null,error:null,count:0};
 const q:any={then:(resolve:any,reject:any)=>Promise.resolve(result).then(resolve,reject)};
 for(const name of ['select','eq','neq','is','in','filter','order','limit','range','returns','abortSignal','setHeader'])q[name]=()=>q;
 q.maybeSingle=()=>Promise.resolve(result);q.single=()=>Promise.resolve(result);
 for(const name of ['insert','upsert','update','delete'])q[name]=()=>{throw new Error('Unexpected product write in local shell fixture');};
 return q;
}
export const supabase={...booking,from:()=>query(),channel:()=>({on(){return this},subscribe(){return this},unsubscribe(){}}),removeChannel:async()=>{},storage:{from:()=>({getPublicUrl:()=>({data:{publicUrl:''}})})}};
