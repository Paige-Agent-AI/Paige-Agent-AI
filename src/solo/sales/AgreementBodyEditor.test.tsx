import React, {act} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {AgreementBodyEditor} from './AgreementBodyEditor';

// The installed select uses a native portal outside the editor's React event
// boundary. The real library/keyboard interaction is covered by the source drive.
vi.mock('@mdxeditor/editor',()=>({
  MDXEditor:()=> <button role="combobox" aria-label="Block type" aria-controls="native-heading-menu" aria-expanded="true">Block type</button>,
  headingsPlugin:()=>({}),listsPlugin:()=>({}),quotePlugin:()=>({}),thematicBreakPlugin:()=>({}),toolbarPlugin:()=>({}),
  UndoRedo:()=>null,BoldItalicUnderlineToggles:()=>null,BlockTypeSelect:()=>null,ListsToggle:()=>null,
}));

let host:HTMLDivElement,root:ReturnType<typeof createRoot>,menu:HTMLDivElement,option:HTMLButtonElement,trigger:HTMLButtonElement;
let frames:Map<number,FrameRequestCallback>,nextFrame:number;
const change=vi.fn();
const render=(scopeKey='original',readOnly=false)=>act(()=>root.render(<AgreementBodyEditor scopeKey={scopeKey} value="Original supplied wording" onChange={change} readOnly={readOnly}/>));
beforeEach(()=>{
  frames=new Map();nextFrame=0;change.mockClear();
  vi.stubGlobal('requestAnimationFrame',(callback:FrameRequestCallback)=>{frames.set(++nextFrame,callback);return nextFrame;});
  vi.stubGlobal('cancelAnimationFrame',(id:number)=>frames.delete(id));
  vi.spyOn(document,'visibilityState','get').mockReturnValue('visible');
  host=document.createElement('div');document.body.append(host);root=createRoot(host);render();
  trigger=host.querySelector<HTMLButtonElement>('[role="combobox"]')!;
  menu=document.createElement('div');menu.id='native-heading-menu';menu.setAttribute('role','listbox');
  option=document.createElement('button');option.textContent='Paragraph';option.setAttribute('role','option');menu.append(option);document.body.append(menu);option.focus();
  // This is the native menu's dismissal, outside this React root. It does not
  // restore focus itself, matching the installed primitive's preventDefault.
  option.addEventListener('keydown',event=>{if(event.key==='Escape'){trigger.setAttribute('aria-expanded','false');menu.remove();event.preventDefault();}});
});
afterEach(()=>{act(()=>root.unmount());host.remove();menu.remove();document.querySelector('[data-other-focus]')?.remove();vi.restoreAllMocks();vi.unstubAllGlobals();});
const escape=()=>act(()=>{option.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));});
const finishFrame=()=>act(()=>{for(const [id,callback]of [...frames]){frames.delete(id);callback(0);}});

it('returns a dismissed native portal to its own trigger without changing supplied wording',()=>{
  expect(host.contains(menu)).toBe(false);escape();expect(document.activeElement).toBe(document.body);finishFrame();
  expect(document.activeElement).toBe(trigger);expect(change).not.toHaveBeenCalled();
});
it.each(['unmounted','other source','read-only','text source','other focus','hidden'] as const)('does not take focus after %s context supersedes dismissal',reason=>{
  escape();
  const other=document.createElement('button');other.dataset.otherFocus='true';other.textContent='Other work';document.body.append(other);
  if(reason==='unmounted')act(()=>root.render(null));
  if(reason==='other source')render('different');
  if(reason==='read-only')render('original',true);
  if(reason==='text source')act(()=>[...host.querySelectorAll('button')].find(button=>button.textContent==='Text source')!.click());
  if(reason==='other focus')other.focus();
  if(reason==='hidden')vi.spyOn(document,'visibilityState','get').mockReturnValue('hidden');
  finishFrame();expect(document.activeElement).not.toBe(trigger);if(reason==='other focus')expect(document.activeElement).toBe(other);expect(change).not.toHaveBeenCalled();
});
it('does not adopt another menu through a global keyboard event',()=>{
  menu.id='another-menu';escape();finishFrame();expect(document.activeElement).not.toBe(trigger);expect(change).not.toHaveBeenCalled();
});
