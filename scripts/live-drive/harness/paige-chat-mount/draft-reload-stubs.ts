// Synthetic account/view facts only; no authentication or production permissions.
import {setScopedUserId} from '@/lib/scopedUser';
export const mode=new URLSearchParams(location.search).get('mode')??'ordinary';
if(mode==='effective')setScopedUserId('harness-effective');
const context={loading:mode==='unresolved',accountContextLoading:mode==='unresolved',
 accountContextStatus:mode==='unresolved'?'resolving':mode==='error'?'error':'ready',
 activeUserId:mode==='unresolved'?null:'harness-owner',activeTenantId:mode==='unresolved'?null:'harness-tenant',
 activeTenant:mode==='unresolved'?null:{id:'harness-tenant',name:'Synthetic business',account_number:'1701',account_type:'standalone',parent_tenant_id:null},
 isPlatformStaff:mode==='operator',isPlatformOwner:mode==='operator',soloShellEnabled:true};
export const useTenantContext=()=>context;
export const useOptionalTenantContext=useTenantContext;
export const useScopedUserId=()=>mode==='unresolved'?null:mode==='effective'?'harness-effective':'harness-owner';
export const useImpersonation=()=>({isImpersonating:mode==='effective',target:null});
