import {OwnerPreparationUnavailable,executeOwnerPreparation,readOwnerPreparation,readOwnerPreparationPdf,listOwnerCommercialPreparationSources,reviewOwnerCommercialPreparation,type OwnerPreparationCaller,type OwnerPreparationService} from './owner-preparation.ts';
import {PreparationArtifactUnavailable} from './preparation-artifact.ts';

const maxBody=1048576;
async function boundedJson(req:Request):Promise<unknown>{
  if(!/^application\/json(?:\s*;|$)/i.test(req.headers.get('Content-Type')??''))throw new OwnerPreparationUnavailable('INVALID_REQUEST');
  const reader=req.body?.getReader();if(!reader)throw new OwnerPreparationUnavailable('INVALID_REQUEST');
  let length=0;const chunks:Uint8Array[]=[];
  try{while(true){const next=await reader.read();if(next.done)break;length+=next.value.length;if(length>maxBody){await reader.cancel().catch(()=>{});throw new OwnerPreparationUnavailable('INVALID_REQUEST');}chunks.push(next.value);}}
  finally{reader.releaseLock();}
  const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new OwnerPreparationUnavailable('INVALID_REQUEST');}
}

/** Mounted only in agreement-document's ORIGINAL authenticated business door.
 * Never reached by a signing token or client Portal relationship. Existing
 * public/token/Portal GET bodies are retained byte-for-byte outside this route. */
export async function handleOwnerPreparation(
  req:Request,caller:OwnerPreparationCaller,service:OwnerPreparationService,
  originalHeaders:Record<string,string>,overWriteLimit:(actorId:string)=>Promise<boolean>,
):Promise<Response>{
  const headers={...originalHeaders,'Cache-Control':'no-store, private','Vary':'Authorization','X-Content-Type-Options':'nosniff'};
  const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...headers,'Content-Type':'application/json'}});
  try{
    const url=new URL(req.url),requestedMode=url.searchParams.get('preparation');
    const allowed=req.method!=='GET'?[]:requestedMode==='commercial_sources'?['preparation','businessId','agreementId','beforeId']
      :requestedMode==='commercial_review'?['preparation','businessId','agreementId','invoiceId']
      :['preparation','businessId','agreementId','preparationId','download'];
    // A token/Portal/legacy query never changes doors, including on POST.
    if([...url.searchParams.keys()].some(k=>!allowed.includes(k))||[...url.searchParams.keys()].some(k=>url.searchParams.getAll(k).length!==1))throw new OwnerPreparationUnavailable('INVALID_REQUEST');
    const auth=await caller.auth.getUser();
    if(auth.error||!auth.data.user||auth.data.user.is_anonymous)throw new OwnerPreparationUnavailable('ACCESS_UNVERIFIED');
    if(req.method==='POST'){
      if(await overWriteLimit(auth.data.user.id))return json({ok:false,code:'rate_limited',error:'Too many preparation attempts. Keep the original request and try checking it again later.'},429);
      const input=await boundedJson(req);
      return json({ok:true,...await executeOwnerPreparation(input,caller,service)});
    }
    if(req.method!=='GET')return json({ok:false,error:'GET or POST only'},405);
    const mode=url.searchParams.get('preparation'),tenant=url.searchParams.get('businessId')??'',agreement=url.searchParams.get('agreementId')??'',id=url.searchParams.get('preparationId');
    if(mode==='commercial_sources')return json({ok:true,sources:{tenant_id:tenant,agreement_id:agreement,
      ...await listOwnerCommercialPreparationSources(tenant,agreement,url.searchParams.get('beforeId'),caller,service)}});
    if(mode==='commercial_review')return json({ok:true,review:{tenant_id:tenant,agreement_id:agreement,invoice_id:url.searchParams.get('invoiceId')??'',
      ...await reviewOwnerCommercialPreparation(tenant,agreement,url.searchParams.get('invoiceId')??'',caller,service)}});
    if(mode==='metadata'){
      if(url.searchParams.has('download'))throw new OwnerPreparationUnavailable('INVALID_REQUEST');
      return json({ok:true,view:await readOwnerPreparation(tenant,agreement,id,caller,service)});
    }
    if(mode!=='pdf'||!id||url.searchParams.has('download')&&url.searchParams.get('download')!=='1')throw new OwnerPreparationUnavailable('INVALID_REQUEST');
    const actual=await readOwnerPreparationPdf(tenant,agreement,id,caller,service);
    return new Response(actual.bytes.slice().buffer,{status:200,headers:{...headers,'Content-Type':'application/pdf',
      'Content-Disposition':`${url.searchParams.get('download')==='1'?'attachment':'inline'}; filename="agreement-preparation.pdf"`,
      'X-Agreement-Document-SHA256':actual.sha256,'Access-Control-Expose-Headers':'X-Agreement-Document-SHA256','Content-Security-Policy':"default-src 'none'; sandbox"}});
  }catch(error){
    if(error instanceof OwnerPreparationUnavailable){
      if(error.code==='INVALID_REQUEST')return json({ok:false,code:'invalid_request',error:'Choose the original agreement and preparation request before continuing.'},400);
      if(error.code==='ACCESS_UNVERIFIED')return json({ok:false,code:'access_unverified',error:'Agreement access could not be verified. Check your selected business and sign-in.'},403);
      if(error.code==='SOURCE_CHANGED')return json({ok:false,code:'source_changed',error:'This preparation refers to different or changed work. Inspect the original record before continuing.'},409);
      if(error.code==='COMMERCIAL_REVIEW_REQUIRED')return json({ok:false,code:'commercial_review_required',error:'This agreement needs its original commercial terms review before the exact signing document can be prepared.'},409);
    }
    if(error instanceof PreparationArtifactUnavailable&&error.code==='CONTEXT_RETIRED')return json({ok:false,code:'source_changed',error:'Agreement access or source changed. Reopen the original preparation in its business.'},409);
    if(error instanceof PreparationArtifactUnavailable&&error.code==='DOCUMENT_UNAVAILABLE')return json({ok:false,code:'document_unavailable',error:'The original document could not be prepared as a supported PDF. Review its formatting or supply a PDF, then check the same request.'},422);
    // No raw provider exception, private path, legal words or signer data in
    // logs or errors. An unconfirmed response NEVER proves server rollback.
    return json({ok:false,code:'unconfirmed',error:'The preparation result could not be confirmed. Check this same request; it may already be recorded.'},503);
  }
}
