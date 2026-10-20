import {describe, expect, it, vi} from "vitest";
import {readClientPortalChatBinding, sameClientPortalChatBinding} from "../../supabase/functions/_shared/client-portal-chat-scope";

const actor="11111111-1111-4111-8111-111111111111";
const client="22222222-2222-4222-8222-222222222222";
const tenant="33333333-3333-4333-8333-333333333333";
const row={id:client,tenant_id:tenant,linked_user_id:actor};

describe("native customer Chat binding",()=>{
  it("uses the caller's unqualified native self projection and retains identity only",async()=>{
    const rpc=vi.fn().mockResolvedValue({data:{...row,email:"private@example.test",internal_note:"ignored"},error:null});
    await expect(readClientPortalChatBinding({rpc},actor)).resolves.toEqual({actorId:actor,clientId:client,tenantId:tenant});
    expect(rpc).toHaveBeenCalledExactlyOnceWith("client_portal_self_profile");
  });
  it.each([null,undefined,[],[row],{}, {...row,linked_user_id:client},{...row,id:null},{...row,tenant_id:null},
    {...row,id:"short"},{...row,tenant_id:"short"}])("refuses unknown or malformed native binding %#",async data=>{
    await expect(readClientPortalChatBinding({rpc:vi.fn().mockResolvedValue({data,error:null})},actor)).resolves.toBeNull();
  });
  it("refuses errors even with a plausible row, and thrown/ambiguous reads",async()=>{
    await expect(readClientPortalChatBinding({rpc:vi.fn().mockResolvedValue({data:row,error:{code:"42501"}})},actor)).resolves.toBeNull();
    await expect(readClientPortalChatBinding({rpc:vi.fn().mockRejectedValue(new Error("private error"))},actor)).resolves.toBeNull();
  });
  it("requires a verified actor identifier before calling the native reader",async()=>{
    const rpc=vi.fn();
    await expect(readClientPortalChatBinding({rpc},"")).resolves.toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });
  it("compares the whole actor/client/business binding and never matches unknown",()=>{
    const captured={actorId:actor,clientId:client,tenantId:tenant};
    expect(sameClientPortalChatBinding(captured,{...captured})).toBe(true);
    for(const current of [null,{...captured,actorId:client},{...captured,clientId:tenant},{...captured,tenantId:client}]){
      expect(sameClientPortalChatBinding(captured,current)).toBe(false);
    }
    expect(sameClientPortalChatBinding(null,null)).toBe(false);
  });
});
