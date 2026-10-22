import {z} from 'zod';
import {callAgreementRpc, type AgreementApiResult} from './agreementPreparationApi';

const uuid=z.string().uuid(),date=z.string().datetime({offset:true});
export const templateOptionsSchema=z.object({
  jurisdiction:z.string().max(200).nullable(),
  review_route:z.enum(['unspecified','business','qualified_legal']),
  reviewer:z.string().max(200).nullable(),
}).strict().refine(value=>(value.jurisdiction===null||Boolean(value.jurisdiction.trim()))
  &&(value.reviewer===null||Boolean(value.reviewer.trim()))
  &&(value.review_route!=='unspecified'||value.reviewer===null));
export type TemplatePreparationOptions=z.infer<typeof templateOptionsSchema>;
export const unspecifiedTemplateOptions:Readonly<TemplatePreparationOptions>=Object.freeze({jurisdiction:null,review_route:'unspecified',reviewer:null});
const metaFields={id:uuid,template_slug:z.string().min(1),title:z.string().min(1),version:z.number().int().positive(),
  is_active:z.boolean(),source_mode:z.enum(['paige_template','tenant_fork','tenant_upload']),
  preparation_options:templateOptionsSchema.nullable(),preparation_purpose:z.literal('client_engagement').nullable(),
  source_template_version_id:uuid.nullable(),source_template_updated_at:date.nullable(),
  has_uploaded_source:z.boolean(),created_at:date,updated_at:date};
const validLineage=(value:{source_template_version_id?:string|null;source_template_updated_at?:string|null;preparation_purpose?:string|null;preparation_options?:unknown;source_mode:string;has_uploaded_source:boolean})=>
  (value.source_template_version_id===null)===(value.source_template_updated_at===null)
  &&(value.preparation_purpose==='client_engagement'
    ?value.preparation_options!==null&&value.source_mode==='tenant_fork'&&!value.has_uploaded_source
    :value.preparation_options===null&&value.source_template_version_id===null&&value.source_template_updated_at===null);
export const templateVersionSchema=z.object({...metaFields,body_markdown:z.string().max(300000).nullable()}).strict().refine(validLineage)
  .refine(value=>value.preparation_purpose!=='client_engagement'||Boolean(value.body_markdown?.trim()));
const summarySchema=z.object(metaFields).strict().refine(validLineage);
const cursorSchema=z.object({created_at:date,id:uuid}).strict();
const listSchema=z.object({items:z.array(summarySchema).max(20),next_cursor:cursorSchema.nullable()}).strict().refine(value=>
  new Set(value.items.map(row=>row.id.toLowerCase())).size===value.items.length
  &&(value.next_cursor===null||(value.items.length===20&&value.items.at(-1)?.id===value.next_cursor.id
    &&value.items.at(-1)?.created_at===value.next_cursor.created_at)));
const recoverySchema=z.discriminatedUnion('state',[
  z.object({state:z.literal('unconfirmed')}).strict(),
  z.object({state:z.literal('recovered'),version_record:templateVersionSchema}).strict(),
]);
export type AgreementTemplateVersion=z.infer<typeof templateVersionSchema>;
export type AgreementTemplateSummary=z.infer<typeof summarySchema>;
export type AgreementTemplatePage=z.infer<typeof listSchema>;
export type AgreementTemplateRecovery=z.infer<typeof recoverySchema>;
export type AgreementTemplateCursor=z.infer<typeof cursorSchema>;
export type TemplateVersionCommand=Readonly<{tenantId:string;versionId:string;previousVersionId:string|null;
  expectedSourceUpdatedAt:string|null;expectedVersion:number;expectedSlug:string;
  title:string;body:string;options:Readonly<TemplatePreparationOptions>}>;
const commandSchema=z.object({tenantId:uuid,versionId:uuid,previousVersionId:uuid.nullable(),expectedSourceUpdatedAt:date.nullable(),
  expectedVersion:z.number().int().positive(),expectedSlug:z.string().min(1),title:z.string().min(1).max(500),
  body:z.string().min(1).max(300000),options:templateOptionsSchema}).strict().refine(value=>
  Boolean(value.title.trim()&&value.body.trim())&&(value.previousVersionId===null)===(value.expectedSourceUpdatedAt===null));
const invalid={ok:false,reason:'refused',message:'Confirm the original business and template version before continuing.'} as const;
const sameId=(left:string|null,right:string|null)=>left?.toLowerCase()===right?.toLowerCase();
const nativeTitle=(value:string)=>value.replace(/^ +| +$/g,'');

/** Capture one exact source and proposal; never adopt a later read as its baseline. */
export function prepareTemplateVersion(tenantId:string,versionId:string,source:AgreementTemplateVersion|null,
  title:string,body:string,options:TemplatePreparationOptions):TemplateVersionCommand|null{
  if(!uuid.safeParse(tenantId).success||!uuid.safeParse(versionId).success||!templateOptionsSchema.safeParse(options).success
    ||(source&&(!templateVersionSchema.safeParse(source).success||source.has_uploaded_source||source.source_mode==='tenant_upload'||source.body_markdown===null)))return null;
  const continuing=source?.preparation_purpose==='client_engagement';
  const command={tenantId,versionId,previousVersionId:source?.id??null,expectedSourceUpdatedAt:source?.updated_at??null,
    expectedVersion:continuing?source.version+1:1,expectedSlug:continuing?source.template_slug:'service-'+versionId.toLowerCase(),
    title,body,options:Object.freeze({...options})};
  return commandSchema.safeParse(command).success?Object.freeze(command):null;
}
export async function listAgreementTemplates(tenantId:string,cursor:AgreementTemplateCursor|null=null,activeOnly=true):Promise<AgreementApiResult<AgreementTemplatePage>>{
  if(!uuid.safeParse(tenantId).success||(cursor&&!cursorSchema.safeParse(cursor).success)||typeof activeOnly!=='boolean')return invalid;
  return callAgreementRpc('list_agreement_template_versions',{_expected_tenant_id:tenantId,
    _before_created_at:cursor?.created_at??null,_before_id:cursor?.id??null,_active_only:activeOnly},listSchema,true);
}
export async function readAgreementTemplate(tenantId:string,versionId:string):Promise<AgreementApiResult<AgreementTemplateVersion>>{
  if(!uuid.safeParse(tenantId).success||!uuid.safeParse(versionId).success)return invalid;
  const result=await callAgreementRpc('read_agreement_template_version',{_expected_tenant_id:tenantId,_version_id:versionId},templateVersionSchema,true);
  if(result.ok===true&&!sameId(result.value.id,versionId))return {ok:false,reason:'unconfirmed',message:'The original template version could not be verified.'};
  return result;
}
export async function recoverTemplateCreation(tenantId:string,versionId:string):Promise<AgreementApiResult<AgreementTemplateRecovery>>{
  if(!uuid.safeParse(tenantId).success||!uuid.safeParse(versionId).success)return invalid;
  const result=await callAgreementRpc('recover_agreement_template_creation',{_expected_tenant_id:tenantId,_version_id:versionId},recoverySchema,true);
  if(result.ok===true&&result.value.state==='recovered'&&!sameId(result.value.version_record.id,versionId))return {ok:false,reason:'unconfirmed',message:'The original template request could not be verified.'};
  return result;
}
const acknowledgment=z.object({id:uuid,template_slug:z.string().min(1),title:z.string(),body_markdown:z.string(),
  version:z.number().int().positive(),is_active:z.boolean(),preparation_options:templateOptionsSchema,
  preparation_purpose:z.literal('client_engagement'),source_template_version_id:uuid.nullable(),source_template_updated_at:date.nullable(),
  created_at:date,updated_at:date}).strict();
export type TemplateVersionReceipt=z.infer<typeof acknowledgment>;
/** Recovery may confirm only this captured intent when its proposal is still in RAM. */
export function sameReviewedTemplateVersion(row:Pick<AgreementTemplateVersion,'id'|'template_slug'|'version'|'source_template_version_id'|'source_template_updated_at'|'title'|'body_markdown'|'preparation_options'|'preparation_purpose'>,command:TemplateVersionCommand):boolean{
  const options=row.preparation_options;
  return commandSchema.safeParse(command).success&&options!==null&&row.preparation_purpose==='client_engagement'
    &&sameId(row.id,command.versionId)&&row.template_slug===command.expectedSlug&&row.version===command.expectedVersion
    &&sameId(row.source_template_version_id,command.previousVersionId)&&row.source_template_updated_at===command.expectedSourceUpdatedAt
    &&row.title===nativeTitle(command.title)&&row.body_markdown===command.body
    &&options.jurisdiction===command.options.jurisdiction&&options.review_route===command.options.review_route&&options.reviewer===command.options.reviewer;
}
export async function saveTemplateVersion(command:TemplateVersionCommand):Promise<AgreementApiResult<TemplateVersionReceipt>>{
  if(!commandSchema.safeParse(command).success)return invalid;
  const result=await callAgreementRpc('create_agreement_template_version',{_expected_tenant_id:command.tenantId,_version_id:command.versionId,
    _previous_version_id:command.previousVersionId,_title:command.title,_body_markdown:command.body,
    _preparation_options:command.options,_expected_source_updated_at:command.expectedSourceUpdatedAt},acknowledgment,true);
  if(result.ok===false)return result;
  if(!sameReviewedTemplateVersion(result.value,command)){
    return {ok:false,reason:'unconfirmed',message:'The saved template acknowledgment could not be verified. Check the same original request before deciding what to do next.'};
  }
  return result;
}
