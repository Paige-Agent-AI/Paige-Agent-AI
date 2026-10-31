// Save an unsent edit on its ORIGINAL message. No provider, approval redemption or send binding.
import { readLeadReplyApproval, type LeadReplyApprovalAdmin, type VerifiedLeadReplyApproval } from "./lead-reply-approval.ts";
import { readCommsEmailDraftProposal } from "../_shared/comms-email/draft-proposal.ts";
import { parseCommsEmailDraftSource, type CommsEmailDraftSource } from "../_shared/comms-email/draft-source.ts";
import { readCommsEmailAttachmentSources, type CommsEmailStorage } from "../_shared/comms-email/attachments.ts";
import { UUID, type CommsEmailCommand } from "../_shared/comms-email/contract.ts";
import type { CommsEmailAdmin } from "../_shared/comms-email/readiness.ts";

export async function saveOriginalEmailDraft(input:{tenantId:string;actorUserId:string;operationId:string;source:CommsEmailDraftSource;
  command:CommsEmailCommand;approvalId?:string;attachments?:unknown;sendAt?:string},
  d:{admin:CommsEmailAdmin & LeadReplyApprovalAdmin;caller:CommsEmailAdmin;storage:CommsEmailStorage;stillCurrent:()=>Promise<boolean>}) {
  const refused=(code:string)=>({ok:false,outcome:"refused",code});
  let originalApproval:VerifiedLeadReplyApproval|undefined;
  if(input.approvalId!==undefined){
    const checked=await readLeadReplyApproval(d.admin,{tenantId:input.tenantId,approvalId:input.approvalId,contactId:input.command.contact_id,savedSourceId:input.source.message_id});
    if(typeof checked==="string")return refused(checked);originalApproval=checked;
  }
  let projectionSource=input.source;
  try {
    // A lost save acknowledgement must reach the SAME native operation even though
    // its successful write advanced updated_at. This marker authorizes no read/write:
    // original RLS/mailbox/approval checks still run, and native verifies the full
    // original request digest plus current saved fields before returning a replay.
    const read=await d.admin.from("messages").select("id,tenant_id,updated_at,meta").eq("tenant_id",input.tenantId).eq("id",input.source.message_id).maybeSingle();
    if(read.error)return refused("COMMS_EMAIL_DRAFT_SOURCE_UNAVAILABLE");
    const m=read.data as Record<string,unknown>|null,meta=m?.meta as Record<string,unknown>|null;
    const saved=meta?.comms_draft_save as Record<string,unknown>|null;
    if(m?.id===input.source.message_id&&m.tenant_id===input.tenantId&&saved?.id===input.operationId&&saved.actor===input.actorUserId)
      projectionSource=parseCommsEmailDraftSource({message_id:m.id,updated_at:m.updated_at});
  }catch{return refused("COMMS_EMAIL_DRAFT_SOURCE_UNAVAILABLE");}
  const draft=await readCommsEmailDraftProposal(d.admin,{tenantId:input.tenantId,actorUserId:input.actorUserId,source:projectionSource,
    command:input.command,attachments:input.attachments,contentReader:d.caller,originalApproval});
  if(draft.ok===false)return refused(draft.code);
  let files:{url:string;name:string;mime:string;size:number}[]=[];
  if(draft.attachmentPaths){
    try{
      const read=await readCommsEmailAttachmentSources(d.storage,{tenantId:input.tenantId,operationId:input.operationId,paths:draft.attachmentPaths});
      if(read.ok===false)return refused(read.code);
      files=read.manifest.map(f=>({url:f.source_path,name:f.name,mime:f.mime,size:f.size}));
    }catch{return refused("COMMS_EMAIL_ATTACHMENT_UNAVAILABLE");}
  }
  try {if(!await d.stillCurrent())return refused("WORKSPACE_CHANGED");}
  catch{return refused("COMMS_EMAIL_AUTHORITY_UNAVAILABLE");}
  const unknown=()=>({ok:false,outcome:"outcome_unknown",code:"COMMS_EMAIL_DRAFT_SAVE_UNVERIFIED",operation_id:input.operationId});
  try{
    const result=await d.admin.rpc("save_comms_email_draft",{_actor:input.actorUserId,_tenant:input.tenantId,_save_id:input.operationId,
      _message_id:input.source.message_id,_expected_updated_at:input.source.updated_at,_contact:input.command.contact_id,
      _connector:draft.connectorId,_subject:input.command.subject,_text:input.command.body,_html:draft.bodyHtml,
      _attachments:files,_send_at:input.sendAt??null,_approval:input.approvalId??null});
    if(result.error){
      const error=result.error as {code?:string;message?:string};
      if(["PGRST202","42883"].includes(error.code??""))return refused("COMMS_EMAIL_DRAFT_SAVE_UNAVAILABLE");
      const code=String(error.message??"").match(/COMMS_EMAIL_[A-Z_]+/)?.[0];
      return code?refused(code):unknown();
    }
    const saved=result.data as Record<string,unknown>|null;
    if(!saved||saved.ok!==true||saved.outcome!=="draft_saved"||saved.message_id!==input.source.message_id||typeof saved.receipt_id!=="string"||!UUID.test(saved.receipt_id))return unknown();
    let source:CommsEmailDraftSource;
    try{source=parseCommsEmailDraftSource({message_id:saved.message_id,updated_at:saved.updated_at});}catch{return unknown();}
    return {ok:true,outcome:"draft_saved",operation_id:input.operationId,draft_source:source,attachments:files,receipt_id:saved.receipt_id,replayed:saved.replayed===true};
  }catch{return unknown();}
}
