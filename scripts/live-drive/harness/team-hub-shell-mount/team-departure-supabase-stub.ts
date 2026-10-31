// Synthetic read/refusal ports only. No writer, provider or authenticated authority is implemented here.
import { supabase as incumbent } from './supabase-stub';
import { harnessActiveTenant } from './tenant-context-stub';
const attempts: Array<{ tenant: string; target: unknown }> = [];
const names: Record<string,string> = { 't-harbor-lane':'Priya Nair', 't-juniper-row':'Rowan Parker' };
const person = (owner: boolean) => {
  const tenant=harnessActiveTenant();
  return { membership_id:`${tenant.id}-${owner?'owner':'admin'}`,user_id:owner?'u-me':`${tenant.id}-admin`,
    full_name:owner?'Morgan Reyes':names[tenant.id],email:owner?'test-owner@tests.invalid':'test-admin@tests.invalid',
    avatar_url:null,status:'active',permission:owner?'owner':'admin',is_owner:owner,team_hub_access:true,
    job_title:owner?'Founder':'Operations lead',responsibilities:null,last_sign_in_at:null };
};
(window as unknown as { __departureEvidence: { attempts: typeof attempts } }).__departureEvidence={attempts};
export const supabase = { ...incumbent,
  rpc: async (name: string,args: Record<string,unknown>={}) => {
    const tenant=harnessActiveTenant();
    if(name==='get_solo_team_workspace')return {data:{tenant_id:tenant.id,tenant_name:tenant.name,
      viewer_permission:'owner',can_manage_profiles:true,can_manage_invitations:true,can_change_permissions:true,
      total_members:2,members:[person(true),person(false)],invitations:[]},error:null};
    if(name==='team_member_holdings'){
      if(args._expected_tenant_id!==tenant.id||args._member_user_id!==person(false).user_id)
        return {data:null,error:{code:'42501',message:'your active workspace changed'}};
      return {data:{ok:true,member:{user_id:person(false).user_id,display_name:names[tenant.id],role:'admin',status:'active',team_hub_access:true},
        holdings:{work:[],crm_tasks:[],clients:[],deals:[],approvals:[],mailboxes:[]},
        counts:{work:0,crm_tasks:0,clients:0,deals:0,approvals:0,mailboxes:0}},error:null};
    }
    if(name==='remove_solo_team_member'){
      attempts.push({tenant:tenant.id,target:args._member_user_id});
      const identity=new URLSearchParams(window.location.search).get('departure')==='identity';
      return {data:null,error:{code:'42501',message:identity
        ?'TEAM_MEMBER_IDENTITY_UNAVAILABLE: current account access could not be confirmed; nothing was removed'
        :'TEAM_MEMBER_PROTECTED: this Paige account is protected; nothing was changed'}};
    }
    return incumbent.rpc(name,args);
  },
};
export default {supabase};
