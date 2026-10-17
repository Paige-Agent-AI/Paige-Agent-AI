// Explicit offline SDK/context leaves for real AppShell, AppNav and resource source.
// No production transport, customer credentials, analytics or provider effects.
export {normalizePortalConfig} from '../../../src/hooks/useClientPortalConfig';
const seed=(window as unknown as {resourceSeed:{business:string}}).resourceSeed;
const suffix=seed.business==='b'?'2':'1';
const actor='e0918000-0000-4000-8000-000000000001',tenant=`e0928000-0000-4000-8000-00000000000${suffix}`,contact=`e0938000-0000-4000-8000-00000000000${suffix}`;
const documentId=`e0948000-0000-4000-8000-00000000000${suffix}`,share=`e0958000-0000-4000-8000-00000000000${suffix}`;
const title='Your program guide — a practical resource for the next stage',text=('Begin with your weekly reflection. Bring the questions you want to discuss to your next session. 😀\n\n').repeat(180),points=Array.from(text);
const user={id:actor,email:'customer@tests.invalid'},session={user,access_token:'offline-placeholder-not-a-credential'};
const brand={tenant_id:tenant,tenant_name:`Test practice ${suffix==='1'?'A':'B'}`,tenant_slug:'test-practice',logo_url:null,primary_color:'#304E42',support_email:null};
const config={modules:[{key:'resources',visible:true,order:2}],assistant:{enabled:true}};
const snapshot=()=>({actor_id:actor,profile:{id:contact,tenant_id:tenant,linked_user_id:actor,first_name:'Test',last_name:'Customer',entity_name:null,street_address:null,city:null,state:null,zip_code:null,onboarding_stage:'invited',is_signup_contact:false,paige_shared_context_consent:false,paige_shared_context_consent_updated_at:null,updated_at:null,email:user.email,phone:null,contact_methods:[]},brand,config});
const source={share_id:share,share_revision:1,source_fingerprint:'a'.repeat(64),document_id:documentId,document_revision:3,generation_id:null,title,content:null,content_truncated:false};
let available=true;
Object.assign(window,{resourceProof:{withdraw:()=>{available=false;},restore:()=>{available=true;}}});
export const supabase={auth:{getSession:async()=>({data:{session},error:null}),getUser:async()=>({data:{user},error:null}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},
 rpc:async(name:string,args:Record<string,unknown>={})=>{
  if(name==='client_portal_frame')return {data:snapshot(),error:null};
  if(args.p_tenant_id!==tenant)throw Error('Offline source proof refuses a foreign business');
  if(name==='client_portal_knowledge_context')return {data:{actor_id:actor,tenant_id:tenant,contact_id:contact,sources:available?[source]:[],next_offset:available?1:0,page_may_continue:false},error:null};
  if(name==='client_portal_knowledge_document'){
   if(!available)return {data:null,error:{code:'42501'}};
   const offset=Number(args.p_offset),next=Math.min(offset+12000,points.length);
   return {data:{actor_id:actor,tenant_id:tenant,contact_id:contact,source_ref:{share_id:share,share_revision:1,source_fingerprint:'a'.repeat(64)},document:{id:documentId,revision:3,generation_id:null,title},content:points.slice(offset,next).join(''),offset,next_offset:next,total_characters:points.length,has_more:next<points.length},error:null};
  }
  throw Error('Offline source proof refuses unlisted RPC: '+name);
 },from:(table:string)=>{
  if(table!=='profiles')throw Error('Offline source proof refuses non-avatar raw read');
  return {select:()=>({eq:()=>({maybeSingle:async()=>({data:null,error:null})})})};
 }};
export const useCreditFactors=()=>({factors:null});
export const useTenantFeature=()=>({enabled:false,loading:false});
export const useSessionTimeout=()=>({showWarning:false,staySignedIn(){}});
export const useImpersonation=()=>({target:null,isImpersonating:false});
export const usePresenceHeartbeat=()=>{};
export const trackEvent=async()=>{};
export const shouldOfferOnboarding=async()=>false;
export const resolveLandingRoute=async()=>'/app';
export const useDashboardMode=()=>({isAdmin:false,mode:'client',setMode(){}});
export const useUnreadSupportCount=()=>({count:0});
export const usePlaybook=()=>({persona:{name:'PAIGE'},portal:{modules:[{key:'home',label:'Home'},{key:'resources',label:'Resources'},{key:'documents',label:'Documents'}]}});
export const useClientPortalBrandState=()=>({brand,loading:false});
export const useClientPortalConfigState=()=>({config,loading:false});
export const useClientPortalConfig=()=>config;
export const isAvatarBucketUrl=()=>false;
export const NotificationBell=()=> <span aria-hidden className="h-6 w-6"/>;
export const PaigeChat=()=> <section aria-label="Offline Chat geometry placeholder" className="flex h-full min-h-0 flex-col p-4"><p className="text-sm text-muted-foreground">Chat transport is outside this resource layout proof.</p></section>;
export const QuickStatsBar=()=>null;
export const AdminViewBanner=()=>null;
export const SessionTimeoutWarning=()=>null;
export const OnboardingChecklist=()=>null;
export const OnboardingFlow=()=>null;
export const PushNotificationPrompt=()=>null;
export const RequiredConsentsGate=()=>null;
export const ClientHomeTiles=()=>null;
export const ClientActivityFeed=()=>null;
export const UpcomingWidget=()=>null;
