import type { Plan, PlanItem } from '@/hooks/usePlanList';
import type { TeamMemberRecord } from '@/solo/team-workspace-contract';
const testImage='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="#6554a8"/><text x="40" y="47" text-anchor="middle" fill="white" font-size="18">IMG</text></svg>');
const members=[{membership_id:'test-member-1',user_id:'ee910000-0000-4000-8000-000000000003',full_name:'Sample Person',email:null,avatar_url:testImage,status:'active',job_title:'Delivery lead'},
  {membership_id:'test-member-2',user_id:'ee910000-0000-4000-8000-000000000004',full_name:'Another Person',email:null,avatar_url:'/missing-test-photo.png',status:'active',job_title:'Project manager'}] as TeamMemberRecord[];
const base={updated_at:'2026-10-10T12:00:00.123456Z',tenant_id:'ee910000-0000-4000-8000-000000000002',plan_id:'test-plan',item_type:'task',assigned_to_user_id:'ee910000-0000-4000-8000-000000000003',contact_id:null,summary:'Synthetic component test record',priority:'normal',remind_at:null,remind_target:null,reminded_at:null,created_by:'ee910000-0000-4000-8000-000000000003',linked_action_id:null};
const items=[{...base,id:'test-work-1',title:'Prepare stakeholder review',status:'in_progress',due_at:'2026-10-13T16:00:00Z'},
  {...base,id:'test-work-2',title:'Approve scope decisions',item_type:'milestone',status:'blocked',due_at:'2026-10-08T16:00:00Z'},
  {...base,id:'test-work-3',title:'Complete delivery rehearsal',assigned_to_user_id:'ee910000-0000-4000-8000-000000000004',status:'open',due_at:'2026-10-15T16:00:00Z'},
  {...base,id:'test-work-4',title:'Discovery complete',item_type:'milestone',status:'done',due_at:'2026-10-06T16:00:00Z'}] as PlanItem[];
const plans=[{id:'test-plan',tenant_id:'ee910000-0000-4000-8000-000000000002',updated_at:'2026-10-10T12:00:00.123456Z',title:'Sample client onboarding',summary:'Synthetic visual test — no production records',horizon:'quarter',scope:'team',status:'active',starts_on:'2026-10-06',ends_on:'2026-10-20',owner_user_id:'ee910000-0000-4000-8000-000000000003',created_by:'ee910000-0000-4000-8000-000000000003',items}] as Plan[];
const healthyItems=[{...base,id:'healthy-1',plan_id:'healthy-plan',title:'Review implementation draft',status:'in_progress',due_at:'2026-10-19T16:00:00Z'},
  {...base,id:'healthy-2',plan_id:'healthy-plan',title:'Research approved',item_type:'milestone',status:'done',due_at:'2026-10-07T16:00:00Z'},
  {...base,id:'healthy-3',plan_id:'healthy-plan',title:'Prepare review package',item_type:'milestone',status:'open',due_at:'2026-10-22T16:00:00Z'}] as PlanItem[];
const unscheduledItems=[{...base,id:'unscheduled-1',plan_id:'unscheduled-plan',title:'Confirm workshop responsibilities and participant availability',status:'open',assigned_to_user_id:null,due_at:null},
  {...base,id:'unscheduled-2',plan_id:'unscheduled-plan',title:'Draft workshop agenda',status:'open',assigned_to_user_id:'ee910000-0000-4000-8000-000000000004',due_at:'2026-10-26T16:00:00Z'}] as PlanItem[];
plans.push({...plans[0],id:'healthy-plan',title:'Sample research engagement',ends_on:'2026-10-22',items:healthyItems},
  {...plans[0],id:'unscheduled-plan',title:'Sample leadership workshop',owner_user_id:'ee910000-0000-4000-8000-000000000004',ends_on:null,items:unscheduledItems});
items.push(...healthyItems,...unscheduledItems);
// Keep the first project's nested collection independent of the flattened work collection.
plans[0].items=items.filter(item=>item.plan_id==='test-plan');

export { members, items, plans };
