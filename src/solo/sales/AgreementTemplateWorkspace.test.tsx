import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const ports=vi.hoisted(()=>({context:{} as Record<string,unknown>,list:vi.fn(),read:vi.fn(),recover:vi.fn(),save:vi.fn()}));
vi.mock('@/hooks/useTenantContext',()=>({useTenantContext:()=>ports.context}));
vi.mock('./agreementTemplateApi',async importOriginal=>({...await importOriginal<typeof import('./agreementTemplateApi')>(),listAgreementTemplates:ports.list,readAgreementTemplate:ports.read,recoverTemplateCreation:ports.recover,saveTemplateVersion:ports.save}));
vi.mock('./AgreementBodyEditor',()=>({AgreementBodyEditor:({value,onChange,readOnly}:{value:string;onChange:(value:string)=>void;readOnly:boolean})=><label>Agreement content<textarea value={value} readOnly={readOnly} onChange={event=>onChange(event.target.value)}/></label>}));
import {AgreementTemplateWorkspace} from './AgreementTemplateWorkspace';
import {unspecifiedTemplateOptions,type AgreementTemplateVersion} from './agreementTemplateApi';
// Use the repository's native React DOM test idiom; no extra test runtime.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root;
function render(element: React.ReactNode) {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  act(() => root.render(element));
  return { rerender: (next: React.ReactNode) => act(() => root.render(next)) };
}
const matches = (actual: string, expected: string | RegExp) => typeof expected === 'string' ? actual.trim() === expected : expected.test(actual);
function text(expected: string | RegExp) {
  return [...document.body.querySelectorAll<HTMLElement>('*')].find(node => matches(node.textContent ?? '', expected) && ![...node.children].some(child => matches(child.textContent ?? '', expected))) ?? null;
}
function required<T>(value: T | null): T { if (!value) throw new Error('Expected visible test element'); return value; }
function label(expected: string) {
  return [...document.querySelectorAll('label')].find(node => [...node.childNodes].filter(child => child.nodeType === Node.TEXT_NODE).map(child => child.textContent).join('').trim() === expected)?.control ?? null;
}
function role(expected: string, name?: string) {
  const selector = expected === 'button' ? 'button' : `[role="${expected}"]`;
  return [...document.querySelectorAll<HTMLElement>(selector)].find(node => !name || matches(node.getAttribute('aria-label') ?? node.textContent ?? '', name)) ?? null;
}
async function waitFor<T>(assertion: () => T): Promise<T> {
  const deadline = Date.now() + 1500;
  while (true) {
    try { return assertion(); } catch (error) {
      if (Date.now() >= deadline) throw error;
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
    }
  }
}
const screen = {
  getByLabelText: (name: string, _options?: unknown) => required(label(name)),
  queryByLabelText: (name: string) => label(name),
  getByRole: (name: string, options?: { name?: string }) => required(role(name, options?.name)),
  findByRole: (name: string, options?: { name?: string }) => waitFor(() => required(role(name, options?.name))),
  getByText: (name: string | RegExp) => required(text(name)),
  queryByText: (name: string | RegExp) => text(name),
  findByText: (name: string | RegExp) => waitFor(() => required(text(name))),
};
const fireEvent = {
  click: (node: HTMLElement) => act(() => node.click()),
  change: (node: HTMLElement, event: { target: { value: string } }) => act(() => {
    const prototype = node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : node instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(node, event.target.value);
    node.dispatchEvent(new Event(node instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  }),
};


const tenant='aaaaaaaa-0000-4000-8000-000000000001',other='aaaaaaaa-0000-4000-8000-000000000002',actor='bbbbbbbb-0000-4000-8000-000000000001';
const version='cccccccc-0000-4000-8000-000000000001',request='dddddddd-0000-4000-8000-000000000001',at='2026-10-21T20:00:00.123456+00:00';
const original=():AgreementTemplateVersion=>({id:version,template_slug:'service-'+version,title:'Supplied service wording',body_markdown:'Original business words.\n',version:1,is_active:true,source_mode:'tenant_fork',preparation_options:{...unspecifiedTemplateOptions},preparation_purpose:'client_engagement',source_template_version_id:null,source_template_updated_at:null,has_uploaded_source:false,created_at:at,updated_at:at});
const props=()=>({tenantId:tenant,canManage:true,authorityUnknown:false,authorizationReady:true,selection:'new',requestId:request,requestTenantId:tenant,sourceId:null as string|null,freshlyOpened:true,onAttempted:vi.fn(),onClose:vi.fn(),onOpenVersion:vi.fn(),onNewVersion:vi.fn(),onUseVersion:vi.fn(),onRefresh:vi.fn()});
const change=(name:string,value:string)=>fireEvent.change(screen.getByLabelText(name),{target:{value}});
const click=(name:string)=>fireEvent.click(screen.getByRole('button',{name}));
const fill=()=>{change('Template title','Supplied client wording');change('Agreement content','Private business wording.\n\tPreserve its line breaks.\n');};
const ready=()=>screen.findByRole('button',{name:'Save template version'});
const pending=<T,>()=>{let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return {promise,resolve};};
beforeEach(()=>{ports.context={accountContextStatus:'ready',activeUserId:actor,activeTenantId:tenant};ports.list.mockReset().mockResolvedValue({ok:true,value:{items:[],next_cursor:null}});ports.read.mockReset().mockResolvedValue({ok:true,value:original()});ports.recover.mockReset().mockResolvedValue({ok:true,value:{state:'unconfirmed'}});ports.save.mockReset().mockResolvedValue({ok:true,value:{id:request}});history.replaceState(null,'','/');});
afterEach(()=>{act(()=>root?.unmount());host?.remove();vi.useRealTimers();});
describe('original template workspace authority and durable intent',()=>{
 it('opens fresh internal preparation without native creation or fabricated wording',async()=>{render(<AgreementTemplateWorkspace {...props()}/>);await ready();expect((screen.getByLabelText('Agreement content') as HTMLTextAreaElement).value).toBe('');expect(ports.save).not.toHaveBeenCalled();expect(ports.recover).not.toHaveBeenCalled();expect(localStorage.getItem('template-wording')).toBeNull();});
 it('focuses missing title then actual supplied wording',async()=>{render(<AgreementTemplateWorkspace {...props()}/>);await ready();click('Save template version');expect(document.activeElement).toBe(screen.getByLabelText('Template title'));change('Template title','Supplied title');click('Save template version');expect(document.activeElement).toBe(screen.getByLabelText('Agreement content'));expect(ports.save).not.toHaveBeenCalled();});
 it('stores exact supplied words with unspecified options and opens the native original ID',async()=>{const p=props();render(<AgreementTemplateWorkspace {...p}/>);await ready();fill();click('Save template version');await waitFor(()=>expect(p.onOpenVersion).toHaveBeenCalledExactlyOnceWith(request));expect(ports.save.mock.calls[0][0]).toMatchObject({tenantId:tenant,versionId:request,title:'Supplied client wording',body:'Private business wording.\n\tPreserve its line breaks.\n',options:unspecifiedTemplateOptions});expect(p.onAttempted).toHaveBeenCalledWith(request);});
 it('retains requested jurisdiction/review routing without a completed-review assertion',async()=>{render(<AgreementTemplateWorkspace {...props()}/>);await ready();fill();change('Jurisdiction','Business jurisdiction');change('Requested wording review','qualified_legal');change('Reviewer or review team','Designated team');click('Save template version');await waitFor(()=>expect(ports.save).toHaveBeenCalledOnce());expect(ports.save.mock.calls[0][0].options).toEqual({jurisdiction:'Business jurisdiction',review_route:'qualified_legal',reviewer:'Designated team'});expect(JSON.stringify(ports.save.mock.calls[0])).not.toContain('review_completed');});
 it('clears the reviewer when removing the requested route',async()=>{render(<AgreementTemplateWorkspace {...props()}/>);await ready();fill();change('Requested wording review','business');change('Reviewer or review team','Designated team');change('Requested wording review','unspecified');expect(screen.queryByLabelText('Reviewer or review team')).toBeNull();click('Save template version');await waitFor(()=>expect(ports.save).toHaveBeenCalledOnce());expect(ports.save.mock.calls[0][0].options.reviewer).toBeNull();});
 it('keeps an unknown proposal readonly and retries the same captured command',async()=>{ports.save.mockResolvedValueOnce({ok:false,reason:'unconfirmed',message:'Synthetic response lost'}).mockResolvedValueOnce({ok:true,value:{id:request}});const p=props();render(<AgreementTemplateWorkspace {...p}/>);await ready();fill();click('Save template version');await screen.findByRole('button',{name:'Retry same reviewed request'});expect((screen.getByLabelText('Agreement content') as HTMLTextAreaElement).readOnly).toBe(true);const command=ports.save.mock.calls[0][0];click('Retry same reviewed request');await waitFor(()=>expect(p.onOpenVersion).toHaveBeenCalledWith(request));expect(ports.save.mock.calls[1][0]).toBe(command);expect(Object.isFrozen(command)).toBe(true);});
 it('recovers the exact reviewed original without another write',async()=>{ports.save.mockResolvedValue({ok:false,reason:'unconfirmed',message:'Synthetic response lost'});const p=props();render(<AgreementTemplateWorkspace {...p}/>);await ready();fill();click('Save template version');await screen.findByRole('button',{name:'Check original template request'});const command=ports.save.mock.calls[0][0];ports.recover.mockResolvedValue({ok:true,value:{state:'recovered',version_record:{...original(),id:request,template_slug:'service-'+request,title:command.title,body_markdown:command.body}}});click('Check original template request');await screen.findByText('The exact original template request was recovered. Review its retained wording below.');expect(ports.save).toHaveBeenCalledOnce();expect(screen.getByText('No completed wording review is recorded by these options.')).not.toBeNull();});
 it('does not attribute a different retained intent to the unknown proposal',async()=>{ports.save.mockResolvedValue({ok:false,reason:'unconfirmed',message:'Synthetic response lost'});render(<AgreementTemplateWorkspace {...props()}/>);await ready();fill();click('Save template version');await screen.findByRole('button',{name:'Check original template request'});ports.recover.mockResolvedValue({ok:true,value:{state:'recovered',version_record:{...original(),id:request}}});click('Check original template request');await screen.findByRole('button',{name:'Inspect recovered version'});expect((screen.getByLabelText('Agreement content') as HTMLTextAreaElement).value).toContain('Private business wording');expect(screen.queryByText('The exact original template request was recovered. Review its retained wording below.')).toBeNull();});
 it('reload reconciles an opaque original request and never recreates its missing words',async()=>{render(<AgreementTemplateWorkspace {...props()} freshlyOpened={false}/>);await screen.findByRole('button',{name:'Check original template request'});expect(screen.queryByLabelText('Agreement content')).toBeNull();expect(ports.recover).toHaveBeenCalledExactlyOnceWith(tenant,request);expect(ports.save).not.toHaveBeenCalled();expect(role('button','Retry same reviewed request')).toBeNull();});
 it('loads the exact original source/time once and creates a new version, never overwrites it',async()=>{render(<AgreementTemplateWorkspace {...props()} sourceId={version}/>);await ready();expect((screen.getByLabelText('Agreement content') as HTMLTextAreaElement).value).toBe(original().body_markdown);change('Agreement content','Revised supplied words.');click('Save template version');await waitFor(()=>expect(ports.save).toHaveBeenCalledOnce());expect(ports.save.mock.calls[0][0]).toMatchObject({previousVersionId:version,expectedSourceUpdatedAt:at,expectedVersion:2,body:'Revised supplied words.'});});
 it('withholds uploaded replacement instead of treating absent text as a blank draft',async()=>{ports.read.mockResolvedValue({ok:true,value:{...original(),has_uploaded_source:true,source_mode:'tenant_upload',body_markdown:null}});render(<AgreementTemplateWorkspace {...props()} sourceId={version}/>);await screen.findByText('This retained source needs its original document preparation path. It cannot be replaced with text here.');expect(screen.queryByLabelText('Agreement content')).toBeNull();expect(ports.save).not.toHaveBeenCalled();});
 it('a source conflict keeps words readonly and offers no same-request overwrite',async()=>{ports.save.mockResolvedValue({ok:false,reason:'conflict',message:'Synthetic stale source'});render(<AgreementTemplateWorkspace {...props()} sourceId={version}/>);await ready();fill();click('Save template version');await screen.findByRole('button',{name:'Inspect original source version'});expect((screen.getByLabelText('Agreement content') as HTMLTextAreaElement).readOnly).toBe(true);expect(role('button','Retry same reviewed request')).toBeNull();expect(ports.save).toHaveBeenCalledOnce();});
 it('dirty leave supports stay and explicit discard',async()=>{const p=props();render(<AgreementTemplateWorkspace {...p}/>);await ready();fill();click('Return to agreements');expect(screen.getByRole('alertdialog')).not.toBeNull();click('Continue editing');expect((screen.getByLabelText('Agreement content') as HTMLTextAreaElement).value).toContain('Private');click('Return to agreements');click('Discard changes');expect(p.onClose).toHaveBeenCalledOnce();expect(ports.save).not.toHaveBeenCalled();});
 it('unknown leave explains that an earlier save may still finish',async()=>{ports.save.mockResolvedValue({ok:false,reason:'unconfirmed',message:'Synthetic response lost'});render(<AgreementTemplateWorkspace {...props()}/>);await ready();fill();click('Save template version');await screen.findByRole('button',{name:'Retry same reviewed request'});click('Return to agreements');expect(screen.getByText('An earlier save may still complete. You can check the original request when you return.')).not.toBeNull();click('Continue editing');expect((screen.getByLabelText('Agreement content') as HTMLTextAreaElement).readOnly).toBe(true);});
 it('locks duplicate submission and departure while a native save is pending',async()=>{const task=pending<unknown>();ports.save.mockReturnValue(task.promise);const p=props();render(<AgreementTemplateWorkspace {...p}/>);await ready();fill();click('Save template version');click('Agreements and terms');expect(p.onClose).not.toHaveBeenCalled();expect(ports.save).toHaveBeenCalledOnce();await act(async()=>task.resolve({ok:true,value:{id:request}}));});
 it('transient unknown role hides RAM then restores exact unsaved words without reloading its source',async()=>{const p=props(),view=render(<AgreementTemplateWorkspace {...p} sourceId={version}/>);await ready();fill();view.rerender(<AgreementTemplateWorkspace {...p} sourceId={version} authorityUnknown/>);expect(screen.queryByLabelText('Agreement content')).toBeNull();view.rerender(<AgreementTemplateWorkspace {...p} sourceId={version}/>);await ready();expect((screen.getByLabelText('Agreement content') as HTMLTextAreaElement).value).toContain('Private business wording');expect(ports.read).toHaveBeenCalledOnce();});
 it('conclusive native refusal retires private wording and notifies original permission reads',async()=>{ports.save.mockResolvedValue({ok:false,reason:'refused',refusal:'authority',message:'Synthetic refusal'});const p=props();render(<AgreementTemplateWorkspace {...p}/>);await ready();fill();click('Save template version');await screen.findByText('Template access changed');expect(screen.queryByLabelText('Agreement content')).toBeNull();expect(p.onRefresh).toHaveBeenCalledOnce();expect(p.onOpenVersion).not.toHaveBeenCalled();click('Agreements and terms');expect(screen.getByRole('alertdialog')).not.toBeNull();click('Leave and check later');expect(p.onClose).toHaveBeenCalledOnce();});
 it('late save result after role loss never navigates or restores retired words',async()=>{const task=pending<unknown>();ports.save.mockReturnValue(task.promise);const p=props(),view=render(<AgreementTemplateWorkspace {...p}/>);await ready();fill();click('Save template version');view.rerender(<AgreementTemplateWorkspace {...p} canManage={false}/>);await act(async()=>task.resolve({ok:true,value:{id:request}}));expect(p.onOpenVersion).not.toHaveBeenCalled();expect(screen.queryByLabelText('Agreement content')).toBeNull();});
 it('business and actor switches retire the proposal and withhold cross-business requests',async()=>{const p=props(),view=render(<AgreementTemplateWorkspace {...p}/>);await ready();fill();ports.context={accountContextStatus:'ready',activeUserId:actor,activeTenantId:other};view.rerender(<AgreementTemplateWorkspace {...p}/>);expect(screen.queryByLabelText('Agreement content')).toBeNull();expect(ports.save).not.toHaveBeenCalled();ports.context={accountContextStatus:'ready',activeUserId:version,activeTenantId:tenant};view.rerender(<AgreementTemplateWorkspace {...p}/>);await ready();expect((screen.getByLabelText('Agreement content') as HTMLTextAreaElement).value).toBe('');});
 it('active prepared retained version offers original-ID use, not a legal approval',async()=>{const p=props();render(<AgreementTemplateWorkspace {...p} selection={version}/>);await screen.findByRole('button',{name:'Use this version'});click('Use this version');expect(p.onUseVersion).toHaveBeenCalledExactlyOnceWith(version);expect(screen.getByText('No completed wording review is recorded by these options.')).not.toBeNull();});
 it.each([{is_active:false},{preparation_purpose:null,preparation_options:null},{has_uploaded_source:true}])('withholds inappropriate agreement handoff %j',async patch=>{ports.read.mockResolvedValue({ok:true,value:{...original(),...patch}});render(<AgreementTemplateWorkspace {...props()} selection={version}/>);await screen.findByText('Retained template version');expect(role('button','Use this version')).toBeNull();expect(ports.save).not.toHaveBeenCalled();});
 it('paged list and local title filter never invent a global result count',async()=>{const row=original(),{body_markdown:_,...summary}=row;ports.list.mockResolvedValueOnce({ok:true,value:{items:[summary],next_cursor:{created_at:at,id:version}}}).mockResolvedValueOnce({ok:true,value:{items:[],next_cursor:null}});render(<AgreementTemplateWorkspace {...props()} selection='list'/>);await screen.findByRole('button',{name:'New template'});expect(screen.getByText('1 returned version · titles filter only these records.')).not.toBeNull();click('Read more versions');await waitFor(()=>expect(ports.list).toHaveBeenCalledTimes(2));expect(ports.list.mock.calls[1]).toEqual([tenant,{created_at:at,id:version},true]);});
 it('actual read-only preview preserves words when returning to editing',async()=>{render(<AgreementTemplateWorkspace {...props()}/>);await ready();fill();click('Preview template wording');expect(document.querySelector('[aria-label="Proposed template wording"]')?.textContent).toContain('Private business wording');expect(screen.queryByLabelText('Agreement content')).toBeNull();click('Return to template editing');expect((screen.getByLabelText('Agreement content') as HTMLTextAreaElement).value).toContain('Preserve its line breaks');});
});


describe('interrupted template reads remain recoverable',()=>{
 it('changing retained-version scope retires the old page read and permits the new cursor',async()=>{
  const {body_markdown:unused,...summary}=original();void unused;
  const page=Array.from({length:20},(_,index)=>({...summary,id:'eeeeeeee-0000-4000-8000-'+String(19-index).padStart(12,'0')}));
  const cursor={created_at:at,id:page.at(-1)!.id},old=pending<unknown>();
  ports.list.mockResolvedValueOnce({ok:true,value:{items:page,next_cursor:cursor}}).mockReturnValueOnce(old.promise)
   .mockResolvedValueOnce({ok:true,value:{items:page,next_cursor:cursor}});
  render(<AgreementTemplateWorkspace {...props()} selection='list'/>);await screen.findByRole('button',{name:'Read more versions'});click('Read more versions');
  fireEvent.click(screen.getByLabelText('Include earlier retained versions'));
  await screen.findByRole('button',{name:'New template'});
  expect((screen.getByRole('button',{name:'Read more versions'}) as HTMLButtonElement).disabled).toBe(false);
  await act(async()=>old.resolve({ok:true,value:{items:[],next_cursor:null}}));
  expect((screen.getByRole('button',{name:'Read more versions'}) as HTMLButtonElement).disabled).toBe(false);
  expect(ports.list.mock.calls[2]).toEqual([tenant,null,false]);
 });
 it('transient authority interruption releases a pending recovery read without publishing its late result',async()=>{
  ports.save.mockResolvedValue({ok:false,reason:'unconfirmed',message:'Synthetic response lost'});const task=pending<unknown>();ports.recover.mockReturnValue(task.promise);
  const p=props(),view=render(<AgreementTemplateWorkspace {...p}/>);await ready();fill();click('Save template version');await screen.findByRole('button',{name:'Check original template request'});click('Check original template request');
  view.rerender(<AgreementTemplateWorkspace {...p} authorityUnknown/>);view.rerender(<AgreementTemplateWorkspace {...p}/>);
  expect((screen.getByRole('button',{name:'Check original template request'}) as HTMLButtonElement).disabled).toBe(false);
  await act(async()=>task.resolve({ok:true,value:{state:'recovered',version_record:{...original(),id:request}}}));
  expect((screen.getByLabelText('Agreement content') as HTMLTextAreaElement).value).toContain('Private business wording');
  expect(screen.queryByText('The exact original template request was recovered. Review its retained wording below.')).toBeNull();
 });
});
