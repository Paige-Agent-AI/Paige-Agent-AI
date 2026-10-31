// @vitest-environment node
import {describe,it,expect,vi} from "vitest";
import {dispatchInboxIntelligenceChat} from "../../supabase/functions/_shared/inbox-intelligence/chat";
const id="55555555-5555-4555-8555-555555555555",contact="22222222-2222-4222-8222-222222222222";
const source={message_id:id,updated_at:"2026-10-31T04:00:00.123456+00:00"};
const base={ok:true,id,contact_id:contact,direction:"outbound",channel:"email",status:"draft",subject:"Saved reply",body_text:"ordinary bounded text",body_truncated:false};
async function read(result:unknown){const rpc=vi.fn(async()=>({data:result,error:null}));return{result:await dispatchInboxIntelligenceChat("read_message_content",{message_id:id},{caller:{rpc}}),rpc};}
describe("original gated content reader supplies saved-email context",()=>{
 it("provides the exact raw source and complete long draft text without changing ordinary clipped fields",async()=>{
  const full="A".repeat(9000);const {result,rpc}=await read({...base,body_text:full.slice(0,8000),body_truncated:true,saved_email_draft:{source,body_text:full,body_html:"<p>original format</p>"}});
  expect(rpc).toHaveBeenCalledExactlyOnceWith("read_message_content",{p_message_id:id});
  expect(result).toMatchObject({success:true,message:{draft_source:source,draft_body_text:full,draft_body_complete:true,body_truncated:true}});
  expect(JSON.stringify(result)).not.toContain("saved_email_draft");expect(JSON.stringify(result)).not.toContain("original format");
 });
 it("reuses the original HTML-only readable body projection and never returns raw HTML to the model",async()=>{
  const {result}=await read({...base,body_text:null,saved_email_draft:{source,body_text:null,body_html:"<p><strong>Saved original words.</strong></p>"}});
  expect(result).toMatchObject({message:{draft_source:source,draft_body_text:"Saved original words.",draft_body_complete:true}});
  expect(JSON.stringify(result)).not.toContain("<strong>");
 });
 it.each(["foreign-id","missing-version","overlong-text","overlong-html","missing-contact"])("does not offer a guessed or incomplete source for %s",async kind=>{
  const message={...base,saved_email_draft:{source:{...source},body_text:"Full words.",body_html:"<p>Full words.</p>"}};
  if(kind==="foreign-id")message.saved_email_draft.source.message_id=contact;
  if(kind==="missing-version")message.saved_email_draft.source.updated_at="";
  if(kind==="overlong-text")message.saved_email_draft.body_text="a".repeat(10001);
  if(kind==="overlong-html")message.saved_email_draft.body_html="a".repeat(100001);
  if(kind==="missing-contact")message.contact_id="";
  const {result}=await read(message);expect(result.message).not.toHaveProperty("draft_source");expect(result.message).not.toHaveProperty("draft_body_text");expect(JSON.stringify(result)).not.toContain("saved_email_draft");
 });
 it.each(["PERSONAL_MAILBOX_NOT_OWNER","MAILBOX_INACTIVE","WORKSPACE_ROLE_REQUIRED"])("cannot expose draft context on an original %s refusal",async code=>{
  const {result}=await read({ok:false,code,saved_email_draft:{source,body_text:"Private draft",body_html:"<p>Private draft</p>"}});
  expect(result.success).toBe(false);expect(result).not.toHaveProperty("message");expect(JSON.stringify(result)).not.toContain("Private draft");
 });
 it("preserves an ordinary message read without turning it into a saved-email source",async()=>{
  const {result}=await read({...base,direction:"inbound",status:"received"});expect(result).toEqual({success:true,message:{...base,direction:"inbound",status:"received"}});
 });
});
