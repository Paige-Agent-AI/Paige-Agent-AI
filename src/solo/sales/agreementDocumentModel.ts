import {z} from 'zod';
import type {AgreementPdfPage,AgreementPdfDocument,AgreementField} from '../../../supabase/functions/_shared/agreements/field-preparation';

const finite=z.number().finite();
export const documentPageSchema=z.object({
  page:z.number().int().min(1).max(250),crop_x:finite.min(-14400).max(14400),crop_y:finite.min(-14400).max(14400),
  crop_width:finite.min(1).max(14400),crop_height:finite.min(1).max(14400),
  rotation:z.union([z.literal(0),z.literal(90),z.literal(180),z.literal(270)]),
  width:finite.min(1).max(14400),height:finite.min(1).max(14400),
}).strict();
export const documentDescriptorSchema=z.object({
  sha256:z.string().regex(/^[a-f0-9]{64}$/),byte_length:z.number().int().min(5).max(26214400),
  pages:z.array(documentPageSchema).min(1).max(250),
}).strict();
export const assignedFieldSchema=z.object({
  id:z.string().uuid(),signer_id:z.string().uuid(),kind:z.enum(['signature','initials','signed_date','text','checkbox']),
  page:z.number().int().min(1).max(250),x:finite.min(0).max(14400),y:finite.min(0).max(14400),
  width:finite.min(1).max(14400),height:finite.min(1).max(14400),required:z.boolean(),
  label:z.string().min(1).max(160).refine(value=>value.trim().length>0&&![...value].some(char=>char.charCodeAt(0)<32||char.charCodeAt(0)===127)),
}).strict();
export type DocumentPage=AgreementPdfPage;
export type DocumentDescriptor=AgreementPdfDocument;
export type AssignedField=AgreementField;
export type FieldKind=AssignedField['kind'];
export type DocumentSigner={id:string;full_name:string;email:string;signer_role:string;signing_order:number};
export const FIELD_KINDS:Record<FieldKind,string>={signature:'Signature',initials:'Initials',signed_date:'Signed date',text:'Text',checkbox:'Checkbox'};

/** UI proposals only. The existing server field constructor validates the
 * authoritative map. Never rotate a point twice: native pages already describe
 * the visible rotated crop, with coordinates from its top left. */
export function pointOnDocument(page:DocumentPage,rect:{left:number;top:number;width:number;height:number},clientX:number,clientY:number){
  if(![rect.left,rect.top,rect.width,rect.height,clientX,clientY].every(Number.isFinite)||rect.width<=0||rect.height<=0
    ||Math.abs(rect.width/rect.height-page.width/page.height)>.01)return null;
  const x=(clientX-rect.left)*page.width/rect.width,y=(clientY-rect.top)*page.height/rect.height;
  return x>=0&&y>=0&&x<=page.width&&y<=page.height?{x,y}:null;
}
export function positionField(field:AssignedField,page:DocumentPage,x:number,y:number):AssignedField{
  if(!Number.isFinite(x)||!Number.isFinite(y)||field.width>page.width||field.height>page.height)throw new Error('FIELD_POSITION_UNAVAILABLE');
  return {...field,x:Math.max(0,Math.min(page.width-field.width,x)),y:Math.max(0,Math.min(page.height-field.height,y))};
}
export function newAssignedField(kind:FieldKind,signerId:string,page:DocumentPage,point:{x:number;y:number}):AssignedField{
  const size=kind==='checkbox'?[20,20]:kind==='initials'?[80,32]:kind==='signed_date'?[110,30]:kind==='text'?[160,32]:[140,40];
  const field:AssignedField={id:crypto.randomUUID(),signer_id:signerId,kind,page:page.page,x:0,y:0,width:Math.min(size[0],page.width),height:Math.min(size[1],page.height),required:true,label:FIELD_KINDS[kind]};
  return positionField(field,page,point.x-field.width/2,point.y-field.height/2);
}
