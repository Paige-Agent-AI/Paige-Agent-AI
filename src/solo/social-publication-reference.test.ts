import {expect,it} from "vitest";
import {socialConversationReturn,socialPublicationTarget} from "./social-publication-reference";
const reference={schema:1 as const,tenant_id:"11111111-1111-4111-8111-111111111111",content_id:"22222222-2222-4222-8222-222222222222",
 content_revision:"2026-11-13T12:00:00Z",publication_id:"33333333-3333-4333-8333-333333333333"};
const message="44444444-4444-4444-8444-444444444444",account={account_type:"standalone",parent_tenant_id:null,account_number:1234567};
it("keeps the same original post/receipt and returns through the existing protected Hub message route",()=>{
 const target=socialPublicationTarget(reference,reference.tenant_id,account,message)!;
 const query=target.slice(target.indexOf("?"));expect(query).toContain(`publication=${reference.publication_id}`);expect(query).toContain(`social_piece=${reference.content_id}`);
 expect(socialConversationReturn(query,"1234567")).toBe(`/solo/1234567/team-hub?message=${message}`);
});
it("refuses foreign workspace navigation and malformed or ambiguous conversation pointers",()=>{
 expect(socialPublicationTarget(reference,"foreign",account,message)).toBeNull();
 for(const search of ["", "social_return_message=https://foreign.example",`social_return_message=${message}&social_return_message=${message}`])expect(socialConversationReturn(search,"1234567")).toBeNull();
 expect(socialConversationReturn(`social_return_message=${message}`,"../foreign")).toBeNull();
});
