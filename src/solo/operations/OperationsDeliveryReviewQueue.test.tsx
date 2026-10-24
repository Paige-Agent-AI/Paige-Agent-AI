import {act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const harness=vi.hoisted(()=>({read:vi.fn()}));
vi.mock('./operations-delivery-reviews',()=>({readPendingDeliveryReviews:harness.read}));
vi.mock('./operations-delivery-source',()=>({deliverySourceCaller:{}}));
import {OperationsDeliveryReviewQueue} from './OperationsDeliveryReviewQueue';
const id=(n:number)=>`ed830000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const nomination={submission_id:id(6),work_item_id:id(3),plan_id:id(4),client_id:id(5),artifact_version_id:id(7),artifact_digest:'a'.repeat(64),revision_no:1,submitted_by:id(8),reviewer_user_id:id(1),submission_updated_at:'2026-10-14T12:00:00Z',work_updated_at:'2026-10-14T12:00:00Z',title:'Exact nominated workshop'};
let root:Root,host:HTMLDivElement;
(globalThis as typeof globalThis&{IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
beforeEach(()=>{vi.clearAllMocks();host=document.createElement('div');document.body.append(host);root=createRoot(host)});
afterEach(async()=>{await act(async()=>root.unmount());host.remove()});
const render=async(tenantId=id(2),refreshKey=0,onInspect=vi.fn())=>{await act(async()=>root.render(<OperationsDeliveryReviewQueue actorId={id(1)} tenantId={tenantId} members={[]} refreshKey={refreshKey} onInspect={onInspect}/>));return onInspect};
it('a verified empty queue adds no repeated placeholder above daily work',async()=>{
 harness.read.mockResolvedValue({kind:'ready',reviews:[],unavailableCount:0,hasMore:false});await render();expect(host.textContent).toBe('');
});
it('an unavailable read cannot masquerade as no reviews and exposes recovery',async()=>{
 harness.read.mockResolvedValue({kind:'unavailable'});await render();expect(host.textContent).toContain('Review assignments unavailable');expect(host.textContent).not.toContain('No deliverables awaiting');const refresh=host.querySelector<HTMLButtonElement>('button')!;await act(async()=>refresh.click());expect(harness.read).toHaveBeenCalledTimes(2);
});
it('the nomination passes its exact immutable source scope without a general work edit',async()=>{
 harness.read.mockResolvedValue({kind:'ready',reviews:[nomination],unavailableCount:0,hasMore:false});const inspect=await render();await act(async()=>host.querySelector<HTMLButtonElement>('.ops-view-text-action')!.click());expect(inspect).toHaveBeenCalledWith(nomination);expect(host.textContent).not.toContain('Prepare a version');expect(host.textContent).toContain('Member unavailable');
});
it('partial or truncated nominations remain visible and disclose incomplete coverage',async()=>{
 harness.read.mockResolvedValue({kind:'ready',reviews:[],unavailableCount:1,hasMore:true});await render();expect(host.textContent).toContain('1 nominations could not be inspected');expect(host.textContent).toContain('More nominations are outside this read');
});
it('an old workspace read cannot repopulate the new queue or revive after A B A',async()=>{
 let resolve:(value:unknown)=>void=()=>{};harness.read.mockImplementationOnce(()=>new Promise(done=>{resolve=done})).mockResolvedValue({kind:'ready',reviews:[],unavailableCount:0,hasMore:false});await render();await render(id(12));await render(id(2));await act(async()=>resolve({kind:'ready',reviews:[nomination],unavailableCount:0,hasMore:false}));expect(host.textContent).not.toContain(nomination.title);
});
it('the incumbent refresh epoch rechecks nominations even after a known empty result',async()=>{
 harness.read.mockResolvedValue({kind:'ready',reviews:[],unavailableCount:0,hasMore:false});await render();harness.read.mockResolvedValue({kind:'ready',reviews:[nomination],unavailableCount:0,hasMore:false});await render(id(2),1);expect(host.textContent).toContain(nomination.title);expect(harness.read).toHaveBeenCalledTimes(2);
});
