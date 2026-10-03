import{createClient}from'https://esm.sh/@supabase/supabase-js@2.57.2';
import{safeFetch}from'../_shared/ssrfGuard.ts';
import{handleAddressLookup}from'./handler.ts';
Deno.serve(async(req:Request)=>{
 const url=Deno.env.get('SUPABASE_URL')??'',anon=Deno.env.get('SUPABASE_ANON_KEY')??'';
 // Constructing a caller client is not a service-role or provider operation.
 const caller=createClient(url,anon,{global:{headers:{Authorization:req.headers.get('Authorization')??''}},auth:{persistSession:false}});
 let admin:ReturnType<typeof createClient>|null=null;
 return handleAddressLookup(req,{
  verifiedUser:async()=>{const{data,error}=await caller.auth.getUser();return !error&&data.user?{id:data.user.id,anonymous:data.user.is_anonymous===true}:null},
  currentTenant:async()=>{const{data,error}=await caller.rpc('current_user_tenant_id');if(error)throw Error('tenant_unavailable');return data},
  isAdmin:async()=>{const{data,error}=await caller.rpc('is_current_user_tenant_admin');if(error)throw Error('authority_unavailable');return data},
  allowBucket:async(bucket,max,windowSeconds)=>{
   // Lazily created: handler has already verified user, tenant match and admin.
   admin??=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')??'',{auth:{persistSession:false}});
   const{data,error}=await admin.rpc('check_public_rate_limit',{_bucket:bucket,_max:max,_window_seconds:windowSeconds});if(error)throw Error('limiter_unavailable');return data;
  },transport:safeFetch,
 });
});
