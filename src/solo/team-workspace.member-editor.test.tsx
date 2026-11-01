import { act, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemberEditor } from "./team-workspace";
import type { TeamMemberRecord, TeamWorkspaceRecord } from "./team-workspace-contract";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getUser: async () => ({ data: { user: { id: "viewer-under-test" } } }) }, from: () => ({ select: () => ({ eq: async () => ({ data: [], error: null }) }) }), rpc: mocks.rpc, functions: { invoke: vi.fn() } },
}));

vi.mock("@/hooks/useTenantContext", () => ({
  useTenantContext: () => ({ activeTenantId: "tenant-1", loading: false }),
}));

vi.mock("sonner", () => ({
  toast: { success: mocks.success, error: mocks.error, warning: vi.fn() },
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const member: TeamMemberRecord = {
  membership_id: "membership-1",
  user_id: "member-1",
  full_name: null,
  email: "member@example.com",
  avatar_url: null,
  status: "active",
  permission: "member",
  is_owner: false,
  job_title: "Client Coordinator",
  responsibilities: "Owns client handoffs.",
  last_sign_in_at: null,
};

const workspace: TeamWorkspaceRecord = {
  tenant_id: "tenant-1",
  tenant_name: "Example Team",
  viewer_permission: "owner",
  can_manage_profiles: true,
  can_manage_invitations: true,
  can_change_permissions: true,
  total_members: 1,
  members: [member],
  invitations: [],
};

function setValue(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("Solo Team member work-details dialog", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    mocks.rpc.mockReset();
    mocks.success.mockReset();
    mocks.error.mockReset();
  });

  it("shows email for a member without a verified name and opens in a truthful Save state", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);

    await act(async () => root.render(<MemberEditor member={member} workspace={workspace} onClose={vi.fn()} onSaved={vi.fn()} />));

    expect(host.textContent).toContain("member@example.com");
    expect(host.textContent).not.toContain("Name not provided");
    expect(host.textContent).not.toContain("Edit work details");
    expect(Array.from(host.querySelectorAll("button")).some((button) => button.textContent?.trim() === "Save work details")).toBe(true);
    expect(host.querySelector<HTMLInputElement>('input[placeholder="e.g. Client Success Manager"]')?.disabled).toBe(false);
    expect(host.querySelector<HTMLTextAreaElement>('textarea[placeholder="What this person owns, decides, and hands off."]')?.disabled).toBe(false);

    await act(async () => root.unmount());
  });

  it("labels unsaved work-details abandonment as Cancel and performs no write", async () => {
    const onClose = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(<MemberEditor member={member} workspace={workspace} onClose={onClose} onSaved={vi.fn()} />));

    const title = host.querySelector<HTMLInputElement>('input[placeholder="e.g. Client Success Manager"]')!;
    expect(Array.from(host.querySelectorAll("button")).some((button) => button.textContent?.trim() === "Close")).toBe(true);
    await act(async () => setValue(title, "Delivery Lead"));
    const cancel = Array.from(host.querySelectorAll("button")).find((button) => button.textContent?.trim() === "Cancel") as HTMLButtonElement;
    expect(cancel).toBeTruthy();
    await act(async () => cancel.click());

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).not.toHaveBeenCalled();
    await act(async () => root.unmount());
  });

  it("labels abandoning unsaved contact edits as Cancel too, not Close", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(<MemberEditor member={member} workspace={workspace} onClose={vi.fn()} onSaved={vi.fn()} />));
    await act(async () => { for (let i = 0; i < 4; i++) await Promise.resolve(); });
    const footer = () => host.querySelector(".stw-modal-actions button")?.textContent?.trim();
    expect(footer()).toBe("Close");
    await act(async () => (host.querySelector('[data-ctm-add="email"]') as HTMLButtonElement).click());
    await act(async () => setValue(host.querySelector<HTMLInputElement>('.stw-contact input[type="email"]')!, "member.two@example.com"));
    expect(footer()).toBe("Cancel");
    await act(async () => root.unmount());
  });

  it("keeps saved values visible and never changes permission during a work-details save", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: { membership_id: member.membership_id, job_title: "Operations Lead", responsibilities: "Owns delivery and weekly planning." },
      error: null,
    });
    const onSaved = vi.fn().mockResolvedValue(undefined);
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(<MemberEditor member={member} workspace={workspace} onClose={vi.fn()} onSaved={onSaved} />));

    const title = host.querySelector<HTMLInputElement>('input[placeholder="e.g. Client Success Manager"]')!;
    const responsibilities = host.querySelector<HTMLTextAreaElement>('textarea[placeholder="What this person owns, decides, and hands off."]')!;
    const save = Array.from(host.querySelectorAll("button")).find((button) => button.textContent?.trim() === "Save work details") as HTMLButtonElement;
    expect(save.disabled).toBe(true);

    await act(async () => {
      setValue(title, "Operations Lead");
      setValue(responsibilities, "Owns delivery and weekly planning.");
    });
    expect(save.disabled).toBe(false);
    await act(async () => save.click());

    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith("set_solo_team_member_work_profile", {
      _member_user_id: member.user_id,
      _job_title: "Operations Lead",
      _responsibilities: "Owns delivery and weekly planning.",
      _expected_tenant_id: workspace.tenant_id,
      _expected_membership_id: member.membership_id,
    });
    expect(mocks.rpc).not.toHaveBeenCalledWith("set_solo_team_member_permission", expect.anything());
    expect(title.value).toBe("Operations Lead");
    expect(responsibilities.value).toBe("Owns delivery and weekly planning.");
    expect(save.disabled).toBe(true);
    expect(host.querySelector('[role="status"]')?.textContent).toContain("Work details saved");
    expect(host.textContent).not.toContain("Edit work details");
    expect(onSaved).toHaveBeenCalledTimes(1);

    await act(async () => root.unmount());

    const reopenedHost = document.createElement("div");
    document.body.append(reopenedHost);
    const reopenedRoot = createRoot(reopenedHost);
    const persistedMember = {
      ...member,
      job_title: "Operations Lead",
      responsibilities: "Owns delivery and weekly planning.",
    };
    await act(async () => reopenedRoot.render(<MemberEditor member={persistedMember} workspace={{ ...workspace, members: [persistedMember] }} onClose={vi.fn()} onSaved={vi.fn()} />));

    expect(reopenedHost.querySelector<HTMLInputElement>('input[placeholder="e.g. Client Success Manager"]')?.value).toBe("Operations Lead");
    expect(reopenedHost.querySelector<HTMLTextAreaElement>('textarea[placeholder="What this person owns, decides, and hands off."]')?.value).toBe("Owns delivery and weekly planning.");
    expect(reopenedHost.querySelector(".stw-permission-change [role='radio'][aria-checked='true']")?.textContent).toContain("Member");
    expect(mocks.rpc).toHaveBeenCalledTimes(1);

    await act(async () => reopenedRoot.unmount());
  });
  it("keeps unsaved values visible and reports the error when the save fails", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: "Work details could not be saved." } });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(<MemberEditor member={member} workspace={workspace} onClose={vi.fn()} onSaved={vi.fn()} />));

    const title = host.querySelector<HTMLInputElement>('input[placeholder="e.g. Client Success Manager"]')!;
    await act(async () => setValue(title, "Delivery Lead"));
    const save = Array.from(host.querySelectorAll("button")).find((button) => button.textContent?.trim() === "Save work details") as HTMLButtonElement;
    await act(async () => save.click());

    expect(title.value).toBe("Delivery Lead");
    expect(host.querySelector('[role="status"]')).toBeNull();
    expect(mocks.error).toHaveBeenCalledWith("Work details could not be saved.");
    expect(mocks.success).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledTimes(1);

    await act(async () => root.unmount());
  });
});


describe("original approved owner work-profile admission and truthful receipt", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    mocks.rpc.mockReset(); mocks.success.mockReset(); mocks.error.mockReset();
  });
  async function mountOwner(override: Partial<TeamWorkspaceRecord> = {}, viewerId = "viewer-under-test") {
    const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
    const owner = { ...member, is_owner: true, permission: "owner" };
    await act(async () => root.render(<MemberEditor member={owner} workspace={{ ...workspace, ...override }} viewerId={viewerId} onClose={vi.fn()} onSaved={vi.fn()} />));
    return { host, root };
  }
  for (const holder of [false, undefined]) it(`keeps another owner's work details read-only when holder=${holder}`, async () => {
    const {host,root}=await mountOwner({viewer_is_account_holder:holder});
    expect(host.querySelector<HTMLInputElement>('input[placeholder="e.g. Client Success Manager"]')!.readOnly).toBe(true);
    expect(Array.from(host.querySelectorAll('button')).some(b=>b.textContent==='Save work details')).toBe(false);
    expect(host.textContent).toContain('account holder');
    expect(document.activeElement).toBe(host.querySelector('h2'));
    await act(async()=>root.unmount());
  });
  it("allows the confirmed current holder to edit another owner's work details", async()=>{
    const {host,root}=await mountOwner({viewer_is_account_holder:true});
    expect(host.querySelector<HTMLInputElement>('input[placeholder="e.g. Client Success Manager"]')!.readOnly).toBe(false);
    expect(host.textContent).toContain('Save work details');await act(async()=>root.unmount());
  });
  it("allows an owner to edit their own work details without guessing holder status", async()=>{
    const {host,root}=await mountOwner({},member.user_id);
    expect(host.querySelector<HTMLInputElement>('input[placeholder="e.g. Client Success Manager"]')!.readOnly).toBe(false);
    expect(host.textContent).toContain('Save work details');await act(async()=>root.unmount());
  });
  for(const data of [null,{membership_id:'another-membership',job_title:'Delivery Lead',responsibilities:member.responsibilities}])
    it(`does not turn an unconfirmed receipt into Saved (${data===null?'missing':'foreign'})`,async()=>{
      mocks.rpc.mockResolvedValueOnce({data,error:null});
      const host=document.createElement('div');document.body.append(host);const root=createRoot(host);const saved=vi.fn();
      await act(async()=>root.render(<MemberEditor member={member} workspace={workspace} onClose={vi.fn()} onSaved={saved}/>));
      await act(async()=>setValue(host.querySelector<HTMLInputElement>('input[placeholder="e.g. Client Success Manager"]')!,'Delivery Lead'));
      const save=Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='Save work details')!;
      await act(async()=>save.click());expect(mocks.success).not.toHaveBeenCalled();expect(saved).not.toHaveBeenCalled();
      expect(mocks.error).toHaveBeenCalledWith(expect.stringMatching(/Reopen Team/));expect(save.disabled).toBe(true);
      expect(host.querySelector<HTMLInputElement>('input[placeholder="e.g. Client Success Manager"]')!.value).toBe('Delivery Lead');
      await act(async()=>save.click());expect(mocks.rpc).toHaveBeenCalledTimes(1);await act(async()=>root.unmount());
    });
  it("withdraws an old completion when the editor has closed",async()=>{
    let resolve!:(value:unknown)=>void;mocks.rpc.mockReturnValueOnce(new Promise(r=>{resolve=r;}));
    const host=document.createElement('div');document.body.append(host);const root=createRoot(host);const saved=vi.fn();
    await act(async()=>root.render(<MemberEditor member={member} workspace={workspace} onClose={vi.fn()} onSaved={saved}/>));
    await act(async()=>setValue(host.querySelector<HTMLInputElement>('input[placeholder="e.g. Client Success Manager"]')!,'Delivery Lead'));
    await act(async()=>Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='Save work details')!.click());
    await act(async()=>root.unmount());await act(async()=>resolve({data:{membership_id:member.membership_id,job_title:'Delivery Lead',responsibilities:member.responsibilities},error:null}));
    expect(mocks.success).not.toHaveBeenCalled();expect(saved).not.toHaveBeenCalled();
  });
});


describe("original work-profile unknown and current-context recovery",()=>{
  beforeEach(()=>{document.body.innerHTML="";mocks.rpc.mockReset();mocks.success.mockReset();mocks.error.mockReset();});
  async function edit(isCurrent=()=>true){
    const host=document.createElement('div');document.body.append(host);const root=createRoot(host);const saved=vi.fn();const closed=vi.fn();
    await act(async()=>root.render(<MemberEditor member={member} workspace={workspace} isCurrent={isCurrent} onClose={closed} onSaved={saved}/>));
    await act(async()=>setValue(host.querySelector<HTMLInputElement>('input[placeholder="e.g. Client Success Manager"]')!,'Delivery Lead'));
    const save=Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='Save work details')!;
    return{host,root,saved,save,closed};
  }
  it("requires reconciliation after a transport rejection and preserves the draft",async()=>{
    mocks.rpc.mockRejectedValueOnce(new Error('private backend detail'));
    const {host,root,saved,save,closed}=await edit();await act(async()=>save.click());
    expect(save.disabled).toBe(true);expect(mocks.error).toHaveBeenCalledWith(expect.stringMatching(/Reopen Team/));
    expect(mocks.error.mock.calls.flat().join(' ')).not.toContain('private backend detail');
    expect(host.querySelector<HTMLInputElement>('input[placeholder="e.g. Client Success Manager"]')!.value).toBe('Delivery Lead');
    await act(async()=>save.click());expect(mocks.rpc).toHaveBeenCalledTimes(1);expect(saved).not.toHaveBeenCalled();
    await act(async()=>host.querySelector<HTMLButtonElement>('.stw-modal-actions .secondary')!.click());expect(closed).toHaveBeenCalledWith(true);await act(async()=>root.unmount());
  });
  it("keeps every ordinary close route disabled until the pending save settles",async()=>{
    let resolve!:(value:unknown)=>void;mocks.rpc.mockReturnValueOnce(new Promise(r=>{resolve=r;}));
    const {host,root,save,closed}=await edit();await act(async()=>save.click());
    expect(host.querySelector<HTMLButtonElement>('[aria-label="Close"]')!.disabled).toBe(true);
    expect(host.querySelector<HTMLButtonElement>('.stw-modal-actions .secondary')!.disabled).toBe(true);
    await act(async()=>window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true})));
    expect(closed).not.toHaveBeenCalled();
    await act(async()=>resolve({data:{membership_id:member.membership_id,job_title:'Delivery Lead',responsibilities:member.responsibilities},error:null}));
    expect(host.querySelector<HTMLButtonElement>('[aria-label="Close"]')!.disabled).toBe(false);
    await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="Close"]')!.click());expect(closed).toHaveBeenCalledWith(false);
    await act(async()=>root.unmount());
  });
  it("refuses the write when the original host context has departed",async()=>{
    const {root,save}=await edit(()=>false);await act(async()=>save.click());expect(mocks.rpc).not.toHaveBeenCalled();await act(async()=>root.unmount());
  });
  it("does not publish an in-flight result after the host context has departed",async()=>{
    let live=true;let resolve!:(value:unknown)=>void;mocks.rpc.mockReturnValueOnce(new Promise(r=>{resolve=r;}));
    const {root,saved,save}=await edit(()=>live);await act(async()=>save.click());live=false;
    await act(async()=>resolve({data:{membership_id:member.membership_id,job_title:'Delivery Lead',responsibilities:member.responsibilities},error:null}));
    expect(mocks.success).not.toHaveBeenCalled();expect(saved).not.toHaveBeenCalled();await act(async()=>root.unmount());
  });
});


describe("original scoped membership refusal",()=>{
  beforeEach(()=>{document.body.innerHTML="";mocks.rpc.mockReset();mocks.success.mockReset();mocks.error.mockReset();});
  it("retains the draft, requires a fresh Team read and never retries a replaced membership",async()=>{
    mocks.rpc.mockResolvedValueOnce({data:null,error:{message:'this team membership changed before this could run; nothing was changed'}});
    const host=document.createElement('div');document.body.append(host);const root=createRoot(host);const saved=vi.fn();
    await act(async()=>root.render(<MemberEditor member={member} workspace={workspace} onClose={vi.fn()} onSaved={saved}/>));
    await act(async()=>setValue(host.querySelector<HTMLInputElement>('input[placeholder="e.g. Client Success Manager"]')!,'Delivery Lead'));
    const save=Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='Save work details')!;
    await act(async()=>save.click());expect(save.disabled).toBe(true);expect(mocks.error).toHaveBeenCalledWith("This person's team membership changed. Reopen Team before trying again.");
    expect(mocks.rpc).toHaveBeenCalledWith('set_solo_team_member_work_profile',expect.objectContaining({_expected_tenant_id:workspace.tenant_id,_expected_membership_id:member.membership_id}));
    expect(mocks.success).not.toHaveBeenCalled();expect(saved).not.toHaveBeenCalled();await act(async()=>save.click());expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(host.querySelector<HTMLInputElement>('input[placeholder="e.g. Client Success Manager"]')!.value).toBe('Delivery Lead');await act(async()=>root.unmount());
  });
});


describe('original scoped permission change and unknown recovery',()=>{
 beforeEach(()=>{document.body.innerHTML='';mocks.rpc.mockReset();mocks.success.mockReset();mocks.error.mockReset();});
 const button=(host:HTMLElement,text:string)=>Array.from(host.querySelectorAll('button')).find(b=>b.textContent?.trim()===text)!;
 async function editor(props:Partial<ComponentProps<typeof MemberEditor>>={}){
  const host=document.createElement('div');document.body.append(host);const root=createRoot(host);const saved=vi.fn(),closed=vi.fn();
  await act(async()=>root.render(<MemberEditor member={member} workspace={workspace} viewerId="viewer-1" onSaved={saved} onClose={closed} {...props}/>));
  const admin=Array.from(host.querySelectorAll<HTMLButtonElement>('[role="radio"]')).find(b=>b.textContent?.includes('Admin'))!;
  await act(async()=>admin.click());
  return {host,root,saved,closed,admin,confirm:()=>button(host,'Confirm access change')};
 }
 it('uses the original scoped writer and reports only verified current access',async()=>{
  mocks.rpc.mockResolvedValue({data:{membership_id:member.membership_id,permission:'admin'},error:null});
  const e=await editor();await act(async()=>e.confirm().click());
  expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('set_solo_team_member_permission',{_member_user_id:member.user_id,_new_permission:'admin',_expected_tenant_id:workspace.tenant_id,_expected_membership_id:member.membership_id});
  expect(e.saved).toHaveBeenCalledWith({membership_id:member.membership_id,permission:'admin'});
  expect(mocks.success).toHaveBeenCalledWith('Admin access confirmed.');expect(e.closed).toHaveBeenCalledWith(true);await act(async()=>e.root.unmount());
 });
 it.each([null,{membership_id:'foreign-seat',permission:'admin'},{membership_id:member.membership_id,permission:'member'}])('withholds success and requires reopen after unconfirmed receipt %#',async data=>{
  mocks.rpc.mockResolvedValue({data,error:null});const e=await editor();await act(async()=>e.confirm().click());
  expect(mocks.success).not.toHaveBeenCalled();expect(e.saved).not.toHaveBeenCalled();expect(e.closed).not.toHaveBeenCalled();expect(e.confirm().disabled).toBe(true);expect(e.admin.disabled).toBe(true);
  expect(e.host.textContent).toContain('Close these details');await act(async()=>e.confirm().click());expect(mocks.rpc).toHaveBeenCalledTimes(1);
  await act(async()=>button(e.host,'Close').click());expect(e.closed).toHaveBeenCalledWith(true);await act(async()=>e.root.unmount());
 });
 it('never sends through a retired context',async()=>{
  const e=await editor({isCurrent:()=>false});expect(e.confirm()).toBeUndefined();expect(mocks.rpc).not.toHaveBeenCalled();await act(async()=>e.root.unmount());
 });
 it('withdraws late permission output after the original context retires',async()=>{
  let current=true;let resolve!:(value:unknown)=>void;mocks.rpc.mockImplementation(()=>new Promise(r=>{resolve=r;}));const e=await editor({isCurrent:()=>current});
  await act(async()=>e.confirm().click());current=false;await act(async()=>resolve({data:{membership_id:member.membership_id,permission:'admin'},error:null}));
  expect(mocks.success).not.toHaveBeenCalled();expect(e.saved).not.toHaveBeenCalled();expect(e.closed).not.toHaveBeenCalled();await act(async()=>e.root.unmount());
 });
 it('holds one in-flight original change and disables all permission choices',async()=>{
  let resolve!:(value:unknown)=>void;mocks.rpc.mockImplementation(()=>new Promise(r=>{resolve=r;}));const e=await editor();const confirm=e.confirm();
  await act(async()=>{confirm.click();confirm.click();});expect(mocks.rpc).toHaveBeenCalledTimes(1);expect(e.admin.disabled).toBe(true);
  await act(async()=>resolve({data:{membership_id:member.membership_id,permission:'admin'},error:null}));await act(async()=>e.root.unmount());
 });
 it('preserves unsaved work details when permission is verified',async()=>{
  mocks.rpc.mockResolvedValue({data:{membership_id:member.membership_id,permission:'admin'},error:null});const e=await editor();
  await act(async()=>setValue(e.host.querySelector<HTMLInputElement>('input[placeholder="e.g. Client Success Manager"]')!,'Unsent work draft'));
  await act(async()=>e.confirm().click());expect(e.closed).not.toHaveBeenCalled();expect(e.saved).toHaveBeenCalledWith({membership_id:member.membership_id,permission:'admin'});
  expect(e.host.querySelector<HTMLInputElement>('input[placeholder="e.g. Client Success Manager"]')!.value).toBe('Unsent work draft');await act(async()=>e.root.unmount());
 });
 it('sanitizes unknown transport failure and prevents all Team retries before reopen',async()=>{
  mocks.rpc.mockRejectedValue(Error('private SQL and customer text'));const e=await editor();await act(async()=>e.confirm().click());
  expect(mocks.error.mock.calls.at(-1)?.[0]).not.toContain('private');expect(mocks.error.mock.calls.at(-1)?.[0]).toContain('Reopen Team');expect(e.confirm().disabled).toBe(true);expect(mocks.success).not.toHaveBeenCalled();await act(async()=>e.root.unmount());
 });
});
