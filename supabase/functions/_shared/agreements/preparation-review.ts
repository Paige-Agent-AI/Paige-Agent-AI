import {object,only} from '../sales-collections/primitives.ts';
import {commercialPreparationCommand,readCommercialPreparationConsequence,type CommercialPreparationCommand} from '../sales-commercial/preparation-command.ts';
import {canonicalPresentationJson,type PreparedCommercialPresentation} from './commercial-presentation.ts';
import {decodeRetainedCommercialPresentation} from './retained-presentation.ts';

/** Human-only review DTO. Neither pending confirmations nor recovery intent
 * receives this body. C1 remains the sole composer/financial validator. */
export async function preparationReviewDocument(value:{presentation:PreparedCommercialPresentation;presented_body_markdown:string}){
 const suffix='\n\n'+value.presentation.appendix;
 if(value.presentation.payload.schema_version!==2||!value.presented_body_markdown.endsWith(suffix))throw Error('PREPARATION_REVIEW_UNAVAILABLE');
 // Exact inverse of C1's concatenation, not prose/PDF/economics inference.
 const original=value.presented_body_markdown.slice(0,-suffix.length);
 const checked=await decodeRetainedCommercialPresentation(value.presentation.payload,value.presentation.payload_digest,original,value.presented_body_markdown);
 if(!checked)throw Error('PREPARATION_REVIEW_UNAVAILABLE');
 return {payload:checked.payload,payload_digest:checked.payload_digest,body_markdown:original,presented_body_markdown:value.presented_body_markdown};
}
export async function readPreparationReviewDocument(value:unknown,command:CommercialPreparationCommand,rawConsequence:unknown):Promise<string|null>{
 try{
  if(!object(value))return null;only(value,['payload','payload_digest','body_markdown','presented_body_markdown']);
  const checked=await decodeRetainedCommercialPresentation(value.payload,value.payload_digest,value.body_markdown,value.presented_body_markdown);
  if(!checked||checked.payload.schema_version!==2||canonicalPresentationJson(commercialPreparationCommand(checked))!==canonicalPresentationJson(command))return null;
  const consequence=readCommercialPreparationConsequence(rawConsequence,command);
  if(!consequence||consequence.principal_minor!==checked.payload.principal_minor||consequence.currency!==checked.payload.currency
   ||canonicalPresentationJson(consequence.engagement)!==canonicalPresentationJson(checked.payload.engagement))return null;
  return value.presented_body_markdown as string;
 }catch{return null;}
}
