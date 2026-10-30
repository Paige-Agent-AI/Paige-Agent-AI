import { describe, it, expect } from "vitest";
import { readCommsEmailDraftProposal } from "./draft-proposal.ts";
import { commsEmailBodyHtml } from "./contract.ts";
import type { CommsEmailAdmin } from "./readiness.ts";
const T="10000000-0000-4000-8000-000000000001", A="20000000-0000-4000-8000-000000000001";
const C="30000000-0000-4000-8000-000000000001", M="40000000-0000-4000-8000-000000000001", S="50000000-0000-4000-8000-000000000001";
const source={message_id:M,updated_at:"2026-10-30T16:00:00.123456Z"};
const command={action:"comms.email_send" as const,contact_id:C,connector_id:null,subject:"Hello",body:"Hello & welcome"};
const html="<p><strong>Hello &amp; welcome</strong></p>";
function fixture(message:Record<string,unknown>={},connector:Record<string,unknown>={},fault=""){
 const reads:{table:string;columns:string;filters:Record<string,unknown>;surface:string}[]=[];
 const rows:Record<string,Record<string,unknown>>={messages:{id:M,tenant_id:T,contact_id:C,connector_id:S,channel_type:"email",direction:"outbound",status:"draft",updated_at:source.updated_at,body_text:command.body,body_html:html,attachments:[],meta:{source:"original-draft"},...message},
  channel_connectors:{id:S,tenant_id:T,channel_type:"email",mailbox_class:"shared_support",active:true,status:"active",...connector}};
 const makeAdmin=(surface:string):CommsEmailAdmin=>({from(table){return{select(columns){
  const filters:Record<string,unknown>={};
  const q:ReturnType<ReturnType<CommsEmailAdmin["from"]>["select"]>={
   eq(k,v){filters[k]=v;return q},
   async maybeSingle(){
    reads.push({table,columns,filters,surface});
    if(surface==="authenticated"&&fault==="content_denied")return{data:null,error:null};
    if(surface==="authenticated"&&fault==="content_changed")rows.messages.updated_at=source.updated_at.replace("123456","123457");
    const actual=rows[table],matches=actual&&Object.entries(filters).every(([k,v])=>actual[k]===v);
    return{data:matches?Object.fromEntries(columns.split(",").map(k=>[k,actual[k]])):null,error:table===fault?new Error("sensitive"):null};
   },
   then(onfulfilled,onrejected){return Promise.resolve(q.maybeSingle()).then(onfulfilled,onrejected)},
  };return q;
 }}}});
 return{admin:makeAdmin("service"),contentReader:makeAdmin("authenticated"),reads};
}
describe("original saved draft server projection",()=>{
 it("uses scoped reads and preserves unchanged rich content and raw version",async()=>{
  const f=fixture();expect(await readCommsEmailDraftProposal(f.admin,{tenantId:T,actorUserId:A,contentReader:f.contentReader,source,command})).toEqual({ok:true,source,connectorId:S,bodyHtml:html,attachmentPaths:null});
  expect(f.reads.map(r=>r.filters)).toEqual([{tenant_id:T,id:M},{tenant_id:T,id:S},{tenant_id:T,id:M,connector_id:S,contact_id:C,updated_at:source.updated_at,channel_type:"email",direction:"outbound",status:"draft"}]);
  expect(f.reads[0].columns).not.toMatch(/body_text|body_html|attachments/);
  expect(f.reads.map(r=>r.surface)).toEqual(["service","service","authenticated"]);
  expect(f.reads[0].columns).not.toMatch(/credentials|secret/);expect(f.reads[1].columns).not.toMatch(/credentials|secret/);
 });
 it("reuses the original HTML-only projection, while an edit uses the incumbent encoder",async()=>{
  const f=fixture({body_text:null});expect(await readCommsEmailDraftProposal(f.admin,{tenantId:T,actorUserId:A,contentReader:f.contentReader,source,command})).toMatchObject({ok:true,bodyHtml:html});
  expect(await readCommsEmailDraftProposal(f.admin,{tenantId:T,actorUserId:A,contentReader:f.contentReader,source,command:{...command,body:"Edited <text>"}})).toMatchObject({ok:true,bodyHtml:commsEmailBodyHtml("Edited <text>")});
 });
 it("an ordinary older draft with null optional metadata keeps the same source path",async()=>{
  const f=fixture({meta:null});expect(await readCommsEmailDraftProposal(f.admin,{tenantId:T,actorUserId:A,contentReader:f.contentReader,source,command})).toMatchObject({ok:true,source,bodyHtml:html});
 });
 for(const [key,value] of Object.entries({tenant_id:C,contact_id:A,id:C,channel_type:"sms",direction:"inbound",status:"sent",provider_message_id:"provider-value"}))it(`refuses changed message ${key}`,async()=>{
  const f=fixture({[key]:value});expect(await readCommsEmailDraftProposal(f.admin,{tenantId:T,actorUserId:A,contentReader:f.contentReader,source,command})).toEqual({ok:false,code:"COMMS_EMAIL_DRAFT_SOURCE_UNAVAILABLE"});expect(f.reads.length).toBe(1);
 });
 for(const change of [{mailbox_class:"personal",mailbox_owner_user_id:C},{active:false},{status:"revoked"},{tenant_id:C},{mailbox_class:"unknown"}])it(`keeps mailbox privacy ${JSON.stringify(change)}`,async()=>{
  const f=fixture({},change);expect(await readCommsEmailDraftProposal(f.admin,{tenantId:T,actorUserId:A,contentReader:f.contentReader,source,command})).toEqual({ok:false,code:"COMMS_EMAIL_DRAFT_SOURCE_UNAVAILABLE"});
 });
 it("a personal owner may keep their sender, but moving private content requires its original handoff",async()=>{
  const f=fixture({},{mailbox_class:"personal",mailbox_owner_user_id:A});
  expect(await readCommsEmailDraftProposal(f.admin,{tenantId:T,actorUserId:A,contentReader:f.contentReader,source,command})).toMatchObject({ok:true,connectorId:S});
  expect(await readCommsEmailDraftProposal(f.admin,{tenantId:T,actorUserId:A,contentReader:f.contentReader,source,command:{...command,connector_id:C}})).toEqual({ok:false,code:"COMMS_EMAIL_DRAFT_OWNED_FLOW_REQUIRED"});
 });
 it("does not collapse a microsecond edit into the same version",async()=>{
  const f=fixture({updated_at:source.updated_at.replace("123456","123457")});expect(await readCommsEmailDraftProposal(f.admin,{tenantId:T,actorUserId:A,contentReader:f.contentReader,source,command})).toEqual({ok:false,code:"COMMS_EMAIL_DRAFT_SOURCE_CHANGED"});
 });
 for(const meta of [{comms_email_binding:{}},{sales_invoice_binding:{}},{growth_sequence_binding:{}},{email_campaign_binding:{}}])it(`preserves original owned flow ${Object.keys(meta)[0]}`,async()=>{
  const f=fixture({meta});expect(await readCommsEmailDraftProposal(f.admin,{tenantId:T,actorUserId:A,contentReader:f.contentReader,source,command})).toEqual({ok:false,code:"COMMS_EMAIL_DRAFT_OWNED_FLOW_REQUIRED"});
 });
 it("retains original private upload paths unless this approval explicitly removes them",async()=>{
  const path=`${T}/${A}-original.txt`,f=fixture({attachments:[{url:path,name:"original.txt"}]});
  expect(await readCommsEmailDraftProposal(f.admin,{tenantId:T,actorUserId:A,contentReader:f.contentReader,source,command})).toMatchObject({ok:true,attachmentPaths:[path]});
  expect(await readCommsEmailDraftProposal(f.admin,{tenantId:T,actorUserId:A,contentReader:f.contentReader,source,command,attachments:[]})).toMatchObject({ok:true,attachmentPaths:null});
 });
 it("never fetches foreign/provider URLs or malformed original files",async()=>{
  for(const attachments of [[{url:"https://untrusted.invalid/file"}],[{url:`${C}/${A}-secret.txt`}],{},[{url:"../secret"}]]){
   const f=fixture({attachments});expect(await readCommsEmailDraftProposal(f.admin,{tenantId:T,actorUserId:A,contentReader:f.contentReader,source,command})).toEqual({ok:false,code:"COMMS_EMAIL_ATTACHMENTS_INVALID"});
  }
 });
 it("read failures expose no content or exception",async()=>{
  for(const fault of ["messages","channel_connectors"]){const f=fixture({},{},fault);expect(await readCommsEmailDraftProposal(f.admin,{tenantId:T,actorUserId:A,contentReader:f.contentReader,source,command})).toEqual({ok:false,code:"COMMS_EMAIL_DRAFT_SOURCE_UNAVAILABLE"});}
 });
 it("an authenticated content denial or an intervening version change cannot contribute approved content",async()=>{
  for(const fault of ["content_denied","content_changed"]){const f=fixture({},{},fault);expect(await readCommsEmailDraftProposal(f.admin,{tenantId:T,actorUserId:A,contentReader:f.contentReader,source,command})).toEqual({ok:false,code:"COMMS_EMAIL_DRAFT_SOURCE_UNAVAILABLE"});expect(f.reads.at(-1)?.surface).toBe("authenticated");}
 });
});
