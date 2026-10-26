import {UUID} from './contract.ts';

/** A read contract, never an amount calculator or caller assertion. The scoped native reader
 * establishes a total from the original terms and, for negotiated installments, their immutable
 * fixed-creation receipt. Older readers carry no such evidence and remain unverified.
 */
export type CollectionAmountBasis='total'|'per_cycle'|'per_installment'|'unverified';
export type CollectionTermKind='one_time'|'recurring'|'installment'|'deposit'|'custom_quote';
/** Exact native refusal vocabulary; never display arbitrary backend diagnostics as this message. */
export const FIXED_COLLECTION_TOTAL_REFUSAL='The original commercial amount is not a verified engagement total. Review its original terms before saving a finite collection schedule.';
export type AcceptedCollectionTotalEvidence={
 schema_version:1;kind:'accepted_effective_principal';tenant_id:string;commercial_terms_id:string;
 client_id:string;offer_id:string;principal_minor:number;currency:string;
 current_terms_version:number;accepted_terms_version:number;signing_id:string;signing_version:number;
 source_digest:string;operation_id:string;receipt_id:string;
};
const totalEvidenceKeys=['schema_version','kind','tenant_id','commercial_terms_id','client_id','offer_id','principal_minor','currency','current_terms_version','accepted_terms_version','signing_id','signing_version','source_digest','operation_id','receipt_id'];
/** Validate only an original scoped native read. This object is never execution authority.
 * Absence stays unverified; a label or mismatched/stale source cannot supply accepted proof.
 * The native writer must independently re-read the original accepted record/operation/Rail.
 */
export function readAcceptedCollectionTotalEvidence(value:Record<string,unknown>):AcceptedCollectionTotalEvidence|null{
 const evidence=value.agreed_amount_total_evidence;
 if(evidence===undefined||evidence===null)return null;
 const fail=():never=>{throw new TypeError('COLLECTION_TOTAL_EVIDENCE_UNVERIFIED');};
 if(typeof evidence!=='object'||Array.isArray(evidence))return fail();
 const e=evidence as Record<string,unknown>,keys=Object.keys(e);
 if(keys.length!==totalEvidenceKeys.length||keys.some(key=>!totalEvidenceKeys.includes(key))
  ||e.schema_version!==1||e.kind!=='accepted_effective_principal')return fail();
 const validId=(v:unknown):v is string=>typeof v==='string'&&UUID.test(v);
 for(const key of ['tenant_id','commercial_terms_id','client_id','offer_id','signing_id','operation_id','receipt_id'])if(!validId(e[key]))return fail();
 for(const [proofKey,rowKey] of [['tenant_id','tenant_id'],['commercial_terms_id','id'],['client_id','client_id'],['offer_id','offer_id']]){
  if(!validId(value[rowKey])||(e[proofKey] as string).toLowerCase()!==(value[rowKey] as string).toLowerCase())return fail();
 }
 if(!Number.isSafeInteger(e.principal_minor)||Number(e.principal_minor)<=0||Number(e.principal_minor)>2147483647
  ||e.principal_minor!==value.agreed_amount_minor||typeof e.currency!=='string'||!/^[a-z]{3}$/.test(e.currency)||e.currency!==value.agreed_currency
  ||!Number.isSafeInteger(e.current_terms_version)||Number(e.current_terms_version)<0||e.current_terms_version!==value.collection_terms_version
  ||!Number.isSafeInteger(e.accepted_terms_version)||Number(e.accepted_terms_version)<0||Number(e.accepted_terms_version)>Number(e.current_terms_version)
  ||!Number.isSafeInteger(e.signing_version)||Number(e.signing_version)<1
  ||typeof e.source_digest!=='string'||!/^[a-f0-9]{64}$/.test(e.source_digest))return fail();
 return e as AcceptedCollectionTotalEvidence;
}
export function readCollectionAmountBasis(value:Record<string,unknown>):CollectionAmountBasis {
 const kind=value.term_kind,basis=value.agreed_amount_basis;
 if(kind===undefined&&basis===undefined)return 'unverified';
 if(typeof kind!=='string'||typeof basis!=='string'
  ||!['one_time','recurring','installment','deposit','custom_quote'].includes(kind)
  ||!['total','per_cycle','per_installment','unverified'].includes(basis)
  ||basis==='total'&&kind!=='one_time'&&kind!=='installment'
  ||basis==='per_cycle'&&kind!=='recurring'
  ||basis==='per_installment'&&kind!=='installment')throw new TypeError('COLLECTION_AMOUNT_BASIS_UNVERIFIED');
 return basis as CollectionAmountBasis;
}
