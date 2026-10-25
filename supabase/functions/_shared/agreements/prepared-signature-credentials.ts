import {object,UUID} from '../sales-collections/primitives.ts';
import {mintSignerToken,sha256Hex,tokenState} from './token.ts';

type Service={rpc(name:string,args:Record<string,unknown>):PromiseLike<{data:unknown;error:unknown}>};
type Scope={actorId:string;tenantId:string;operationId:string;agreementId:string;preparationId:string;
 requestSha256:string;preparationSha256:string;documentSha256:string};
type Credential={signer_id:string;token_hash:string|null;expires_at:string};
type Receipt={kind:'prepared_agreement_credentials';state:'recorded';tenant_id:string;actor_id:string;
 operation_id:string;agreement_id:string;preparation_id:string;request_sha256:string;preparation_sha256:string;
 document_sha256:string;work_id:string;event_id:string;credentials:readonly Readonly<Credential>[]};
type Issued={receipt:Receipt;recovered:boolean;takeCredential(id:string):string|null;dispose():void};
const uuid=(v:unknown):v is string=>typeof v==='string'&&UUID.test(v)&&v===v.toLowerCase();
const hash=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const closed=(v:unknown,keys:string[]):v is Record<string,unknown>=>object(v)
 &&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const fail=(code:'INVALID'|'READBACK_REQUIRED'):never=>{throw Error('PREPARED_AGREEMENT_CREDENTIALS_'+code);};

/** Internal originating server bridge, NOT an approval or execution factory.
 * Genuine authenticated scope, the original HIGH decision/claim/Work and exact
 * current PDF/sender/source preflight must precede this call. Native issuance
 * independently proves current authority and original immutable references.
 * No production caller is mounted here and no provider action is implemented.
 * Actual hashes remain in the original protected signer column. Readable audit
 * history retains only a one-way commitment; original void returns a NULL hash
 * with its retained historical expiry, never a reconstructed credential.
 *
 * Reuses the ORIGINAL CSPRNG/hash/expiry opinion. Only hashes cross the native
 * boundary; raw credentials remain in this invocation's RAM and can be taken
 * once by the future original governed sender. Serializing the result cannot
 * serialize a raw credential. History never rotates or reconstructs a link. */
export function preparedSignatureCredentialStore(service:Service,scope:Scope,recipients:readonly string[]){
 let copy:unknown,ids:unknown;try{copy=structuredClone(scope);ids=structuredClone(recipients);}catch{return fail('INVALID');}
 if(!closed(copy,['actorId','tenantId','operationId','agreementId','preparationId','requestSha256','preparationSha256','documentSha256'])
  ||![copy.actorId,copy.tenantId,copy.operationId,copy.agreementId,copy.preparationId].every(uuid)
  ||![copy.requestSha256,copy.preparationSha256,copy.documentSha256].every(hash)
  ||!Array.isArray(ids)||ids.length<1||ids.length>100||!ids.every(uuid)||new Set(ids).size!==ids.length)return fail('INVALID');
 const bound=copy as Scope,signers=Object.freeze([...ids] as string[]);
 const args=Object.freeze({_actor:bound.actorId,_tenant:bound.tenantId,_operation:bound.operationId,_request_sha256:bound.requestSha256});
 const projection=(data:unknown):Receipt=>{
  let row:unknown;try{row=structuredClone(data);}catch{return fail('READBACK_REQUIRED');}
  if(!closed(row,['kind','state','tenant_id','actor_id','operation_id','agreement_id','preparation_id','request_sha256','preparation_sha256','document_sha256','work_id','event_id','credentials'])
   ||row.kind!=='prepared_agreement_credentials'||row.state!=='recorded'||row.tenant_id!==bound.tenantId
   ||row.actor_id!==bound.actorId||row.operation_id!==bound.operationId||row.agreement_id!==bound.agreementId
   ||row.preparation_id!==bound.preparationId||row.request_sha256!==bound.requestSha256
   ||row.preparation_sha256!==bound.preparationSha256||row.document_sha256!==bound.documentSha256
   ||!uuid(row.work_id)||!uuid(row.event_id)||!Array.isArray(row.credentials)||row.credentials.length!==signers.length)return fail('READBACK_REQUIRED');
  const credentials=row.credentials.map((c,i)=>{
   if(!closed(c,['signer_id','token_hash','expires_at'])||c.signer_id!==signers[i]||(c.token_hash!==null&&!hash(c.token_hash))
    ||typeof c.expires_at!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(c.expires_at)
    ||!Number.isFinite(Date.parse(c.expires_at)))return fail('READBACK_REQUIRED');
   return Object.freeze({signer_id:c.signer_id as string,token_hash:c.token_hash,expires_at:c.expires_at});
  });
  const hashes=credentials.flatMap(c=>c.token_hash===null?[]:[c.token_hash]);
  if(new Set(hashes).size!==hashes.length)return fail('READBACK_REQUIRED');
  return Object.freeze({kind:'prepared_agreement_credentials',state:'recorded',tenant_id:bound.tenantId,actor_id:bound.actorId,
   operation_id:bound.operationId,agreement_id:bound.agreementId,preparation_id:bound.preparationId,
   request_sha256:bound.requestSha256,preparation_sha256:bound.preparationSha256,document_sha256:bound.documentSha256,
   work_id:row.work_id,event_id:row.event_id,credentials:Object.freeze(credentials)});
 };
 const read=async():Promise<Receipt|null>=>{
  try{const reply=await service.rpc('_read_prepared_agreement_credentials',{...args});
   if(!reply||reply.error)return fail('READBACK_REQUIRED');return reply.data===null?null:projection(reply.data);
  }catch{return fail('READBACK_REQUIRED');}
 };
 const result=(receipt:Receipt,recovered:boolean,raw:Map<string,string>):Issued=>Object.freeze({receipt,recovered,
  takeCredential(id:string){const token=raw.get(id);raw.delete(id);const c=receipt.credentials.find(c=>c.signer_id===id);
   return token&&c&&tokenState({token_hash:c.token_hash,token_expires_at:c.expires_at,token_revoked_at:null},new Date()).usable?token:null;
  },dispose(){raw.clear();},
 });
 const issueOnce=async():Promise<Issued>=>{
  const historical=await read();if(historical)return result(historical,true,new Map());
  const raw=new Map<string,string>();
  try{
   const credentials:Array<{signer_id:string;token_hash:string}>=[];
   for(const id of signers){const token=mintSignerToken();raw.set(id,token);credentials.push({signer_id:id,token_hash:await sha256Hex(token)});}
   let recorded:Receipt|null=null;
   try{const reply=await service.rpc('_issue_prepared_agreement_credentials',{...args,_credentials:credentials});
    if(reply&&!reply.error)recorded=projection(reply.data);
   }catch{/* Native commit may have happened; read the SAME original operation once. */}
   if(!recorded)recorded=await read();
   if(!recorded||recorded.credentials.some((c,i)=>c.signer_id!==credentials[i].signer_id||c.token_hash!==credentials[i].token_hash
    ||!tokenState({token_hash:c.token_hash,token_expires_at:c.expires_at,token_revoked_at:null},new Date()).usable))return fail('READBACK_REQUIRED');
   return result(recorded,false,raw);
  }catch{raw.clear();return fail('READBACK_REQUIRED');}
 };
 let attempt:Promise<Issued>|null=null;
 return {read,issue():Promise<Issued>{return attempt??=issueOnce();}};
}
