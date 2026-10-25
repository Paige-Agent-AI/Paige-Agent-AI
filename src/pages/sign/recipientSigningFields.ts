import {object,UUID} from '../../../supabase/functions/_shared/sales-collections/primitives';
import {readAgreementPdfDocument,readRecipientDisplayFields} from '../../../supabase/functions/_shared/agreements/field-preparation';
import {MAX_BODY_BYTES} from '../../../supabase/functions/_shared/agreements/signing-guard';

export type RecipientFieldPacket={kind:'prepared';preparation_id:string;preparation_sha256:string;
 document:ReturnType<typeof readAgreementPdfDocument>;fields:ReturnType<typeof readRecipientDisplayFields>};
export type RecipientFieldAnswer={field_id:string;value:string|boolean};
const fail=():never=>{throw new TypeError('AGREEMENT_RECIPIENT_REVIEW_UNAVAILABLE');};
const closed=(v:unknown,keys:string[]):v is Record<string,unknown>=>object(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.prototype.hasOwnProperty.call(v,k));

/** Parse the existing token-derived response using the original field/document
 * constructors. This does not authorize a recipient or verify a full manifest. */
export function readRecipientFieldReply(value:unknown):{kind:'legacy'}|RecipientFieldPacket{
 let r:unknown;try{r=structuredClone(value);}catch{return fail();}
 if(closed(r,['kind'])&&r.kind==='legacy')return {kind:'legacy'};
 if(!closed(r,['kind','preparation_id','preparation_sha256','document','fields'])||r.kind!=='prepared'
   ||typeof r.preparation_id!=='string'||!UUID.test(r.preparation_id)
   ||typeof r.preparation_sha256!=='string'||!/^[a-f0-9]{64}$/.test(r.preparation_sha256))return fail();
 const document=readAgreementPdfDocument(r.document),fields=readRecipientDisplayFields(document,r.fields);
 if(!fields.some(f=>f.kind==='signature'))return fail();
 for(const f of fields)Object.freeze(f);Object.freeze(fields);
 for(const p of document.pages)Object.freeze(p);Object.freeze(document.pages);Object.freeze(document);
 return Object.freeze({kind:'prepared',preparation_id:r.preparation_id,preparation_sha256:r.preparation_sha256,document,fields});
}

/** UI validation only; the native act must revalidate the retained preparation,
 * recipient, exact values and server-recorded signing time atomically. */
export function recipientFieldAnswers(packet:RecipientFieldPacket,answers:Record<string,unknown>):RecipientFieldAnswer[]{
 if(!object(answers))return fail();
 const editable=packet.fields.filter(f=>f.kind!=='signature'&&f.kind!=='signed_date');
 if(Object.keys(answers).some(id=>!editable.some(f=>f.id===id)))return fail();
 const values:RecipientFieldAnswer[]=[];
 for(const f of packet.fields){
   if(f.kind==='signed_date')continue;
   if(f.kind==='signature'){values.push({field_id:f.id,value:true});continue;}
   if(!Object.prototype.hasOwnProperty.call(answers,f.id)){if(f.required)return fail();continue;}
   const value=answers[f.id];
   if(f.kind==='checkbox'?typeof value!=='boolean':typeof value!=='string'||f.required&&!value.trim())return fail();
   values.push({field_id:f.id,value:value as string|boolean});
 }
 if(new TextEncoder().encode(JSON.stringify(values)).length>MAX_BODY_BYTES)return fail();
 return values;
}
