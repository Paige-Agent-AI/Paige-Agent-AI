import { act, cloneElement, type ReactElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CustomerSelector } from "./CustomerSelector";
const db=vi.hoisted(()=>({from:vi.fn(),rpc:vi.fn(),filters:[] as unknown[][],pending:null as null|((v:unknown)=>void)}));
vi.mock("@/integrations/supabase/client",()=>({supabase:{from:db.from,rpc:db.rpc}}));
vi.mock("@/components/ui/popover",()=>({Popover:({children,open,onOpenChange}:{children:ReactNode;open:boolean;onOpenChange:(v:boolean)=>void})=><div data-open={open} onClick={()=>!open&&onOpenChange(true)}>{children}</div>,PopoverTrigger:({children}:{children:ReactElement})=>cloneElement(children),PopoverContent:({children}:{children:ReactNode})=><div>{children}</div>}));
vi.mock("@/components/ui/command",()=>({Command:({children}:{children:ReactNode})=><div>{children}</div>,CommandList:({children}:{children:ReactNode})=><div>{children}</div>,CommandGroup:({children}:{children:ReactNode})=><div>{children}</div>,CommandEmpty:({children}:{children:ReactNode})=><div>{children}</div>,CommandInput:({value,onValueChange}:{value:string;onValueChange:(v:string)=>void})=><input value={value} onChange={e=>onValueChange(e.target.value)} />,
  CommandItem:({children,onSelect}:{children:ReactNode;onSelect:()=>void})=><button onClick={onSelect}>{children}</button>}));
(globalThis as typeof globalThis&{IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const tenant="11111111-1111-4111-8111-111111111111",actor="22222222-1111-4111-8111-111111111111";
const row={id:"33333333-1111-4111-8111-111111111111",tenant_id:tenant,first_name:"Existing",last_name:"Contact",entity_name:null,lifecycle_stage:"lead",created_at:"2026-11-01",client_contact_methods:[{kind:"email",value:"recipient@tests.invalid",is_primary:true}]};
let host:HTMLDivElement,root:Root;const selected=vi.fn();
function result(value:unknown){db.from.mockImplementation(table=>{const query:Record<string,unknown>={};for(const method of ["select","not","order","limit","eq","or","ilike","in"])query[method]=(...args:unknown[])=>{db.filters.push([table,method,...args]);return query;};query.then=(done:(v:unknown)=>unknown)=>Promise.resolve({data:table==="clients"?value:[],error:null}).then(done);return query;});}
async function render(t:string|null=tenant,a=actor){await act(async()=>root.render(<CustomerSelector tenantId={t} scopeKey={a} onSelect={selected}/>));}
async function search(){await act(async()=>host.querySelector<HTMLButtonElement>('[role="combobox"]')!.click());await act(async()=>{await vi.advanceTimersByTimeAsync(260);});}
beforeEach(()=>{vi.useFakeTimers();db.filters=[];db.from.mockReset();db.rpc.mockReset().mockResolvedValue({data:{tenant_id:tenant},error:null});selected.mockReset();result([row]);host=document.createElement("div");document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.useRealTimers();});
it("scoped recipient search filters original contact reads and verifies actual workspace before and after",async()=>{
  await render();await search();expect(host.textContent).toContain("Existing Contact");
  expect(db.filters).toContainEqual(["clients","eq","tenant_id",tenant]);expect(db.rpc).toHaveBeenCalledTimes(2);
  const pick=Array.from(host.querySelectorAll("button")).find(b=>b.textContent?.includes("Existing Contact"));await act(async()=>pick!.click());
  expect(selected).toHaveBeenCalledWith(expect.objectContaining({id:row.id,email:"recipient@tests.invalid"}));
});
it("a foreign row is an unavailable read, never selectable or a false no-results answer",async()=>{
  result([{...row,tenant_id:actor}]);await render();await search();
  expect(host.textContent).toContain("Couldn’t load contacts");expect(host.textContent).not.toContain("Existing Contact");expect(selected).not.toHaveBeenCalled();
});
it("wrong active workspace refuses before querying contacts",async()=>{
  db.rpc.mockResolvedValue({data:{tenant_id:actor},error:null});await render();await search();
  expect(db.from).not.toHaveBeenCalled();expect(host.textContent).toContain("Couldn’t load contacts");
});
it("explicitly unresolved workspace performs no read",async()=>{
  db.from.mockClear();await render(null);expect(host.querySelector<HTMLButtonElement>('[role="combobox"]')?.disabled).toBe(true);
  await act(async()=>{await vi.advanceTimersByTimeAsync(300);});expect(db.rpc).not.toHaveBeenCalled();expect(db.from).not.toHaveBeenCalled();
});
it("an actor change remounts and clears the old picker even in the same tenant",async()=>{
  await render();await search();expect(host.textContent).toContain("Existing Contact");await render(tenant,tenant);
  expect(host.textContent).not.toContain("Existing Contact");expect(host.querySelector('[role="combobox"]')?.getAttribute("aria-expanded")).toBe("false");
});
it("a read that resolves after A→B→A cannot restore retired contact results",async()=>{
  let release!:(v:unknown)=>void;db.rpc.mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));
  await render();await search();await render(actor);await render(tenant);
  await act(async()=>{release({data:{tenant_id:tenant},error:null});await Promise.resolve();});
  expect(host.textContent).not.toContain("Existing Contact");expect(selected).not.toHaveBeenCalled();
});
