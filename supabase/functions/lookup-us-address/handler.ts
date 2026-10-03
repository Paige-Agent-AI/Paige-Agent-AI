/** Human explicit search only. No CRM read/write, agent tool or deliverability claim. */
export interface LookupDependencies {
 verifiedUser():Promise<{id:string;anonymous:boolean}|null>;
 currentTenant():Promise<unknown>;
 isAdmin():Promise<unknown>;
 /** Created/used only after caller tenant/admin authorization. Strict true required. */
 allowBucket(bucket:string,max:number,windowSeconds:number):Promise<unknown>;
 transport(url:string,init:RequestInit,options:{timeoutMs:number;maxBytes:number}):Promise<{status:number;body:string;truncated:boolean}>;
}
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
const json=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}});
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const text=(v:unknown,max:number)=>typeof v==='string'&&v.length>0&&v.length<=max&&!Array.from(v).some(c=>c.charCodeAt(0)<32||c.charCodeAt(0)===127);
async function body(req:Request){const length=req.headers.get('content-length');if(length&&(!/^\d+$/.test(length)||Number(length)>4096))throw Error('size');if(!req.body)throw Error('body');const reader=req.body.getReader();let expired=false;const timer=setTimeout(()=>{expired=true;void reader.cancel().catch(()=>{})},5000);let size=0;const chunks:Uint8Array[]=[];try{for(;;){const{done,value}=await reader.read();if(expired||req.signal.aborted)throw Error('cancelled');if(done)break;size+=value.byteLength;if(size>4096)throw Error('size');chunks.push(value)}const joined=new Uint8Array(size);let at=0;for(const chunk of chunks){joined.set(chunk,at);at+=chunk.length}return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(joined))}finally{clearTimeout(timer);try{await reader.cancel()}catch{/* no payload logging */}reader.releaseLock()}}
/** The house number comes from matchedAddress, NEVER fromAddress/toAddress range endpoints. */
function normalize(value:unknown){if(!object(value)||!object(value.result)||!Array.isArray(value.result.addressMatches)||value.result.addressMatches.length>20)throw Error('shape');return value.result.addressMatches.map(raw=>{if(!object(raw)||!text(raw.matchedAddress,400)||!object(raw.addressComponents))throw Error('match');const match=String(raw.matchedAddress).match(/^(.+),\s*([^,]+),\s*([A-Z]{2}),\s*(\d{5}(?:-\d{4})?)$/);if(!match||!/^\d+[A-Za-z]?(?:-\d+)?\s+/.test(match[1])||!text(match[1],200)||!text(match[2],100)||raw.addressComponents.city!==match[2]||raw.addressComponents.state!==match[3]||raw.addressComponents.zip!==match[4])throw Error('components');return{label:String(raw.matchedAddress),line1:match[1],city:match[2],region:match[3],postal_code:match[4],country:'US' as const}})}
export async function handleAddressLookup(req:Request,d:LookupDependencies):Promise<Response>{
 if(req.method==='OPTIONS')return new Response(null,{headers:cors});if(req.method!=='POST')return json(405,{error:'post_required'});if(req.signal.aborted)return json(499,{error:'cancelled'});if(!/^Bearer\s+\S+$/i.test(req.headers.get('Authorization')??''))return json(401,{error:'sign_in_required'});
 try{
  const user=await d.verifiedUser();if(!user||user.anonymous)return json(401,{error:'sign_in_required'});
  const tenant=await d.currentTenant();if(typeof tenant!=='string'||!uuid.test(tenant))return json(403,{error:'workspace_unavailable'});
  let input:unknown;try{input=await body(req)}catch{return json(400,{error:'invalid_request'})}
  if(!object(input)||Object.keys(input).some(k=>!['expected_tenant_id','country','address'].includes(k))||typeof input.expected_tenant_id!=='string'||!uuid.test(input.expected_tenant_id)||!text(input.address,300))return json(400,{error:'invalid_request'});
  if(input.expected_tenant_id.toLowerCase()!==tenant.toLowerCase())return json(409,{error:'workspace_changed'});
  if(await d.isAdmin()!==true)return json(403,{error:'tenant_admin_required'});
  if(input.country!=='US')return json(422,{error:'country_unavailable'});
  if(req.signal.aborted)return json(499,{error:'cancelled'});
  if(await d.allowBucket(`address-lookup:tenant:${tenant}`,20,60)!==true||await d.allowBucket(`address-lookup:actor:${tenant}:${user.id}`,10,60)!==true)return json(429,{error:'rate_limited'});
  if(req.signal.aborted)return json(499,{error:'cancelled'});
  const url=new URL('https://geocoding.geo.census.gov/geocoder/locations/onelineaddress');url.searchParams.set('address',String(input.address).trim());url.searchParams.set('benchmark','Public_AR_Current');url.searchParams.set('format','json');
  // safeFetch owns the ten-second outbound deadline. Request cancellation suppresses the
  // response; it does NOT abort an already started provider request (shared transport contract).
  const res=await d.transport(url.href,{method:'GET',headers:{Accept:'application/json'},credentials:'omit',referrerPolicy:'no-referrer'},{timeoutMs:10000,maxBytes:65536});
  if(req.signal.aborted)return json(499,{error:'cancelled'});
  if(res.status!==200||res.truncated||new TextEncoder().encode(res.body).byteLength>65536)return json(502,{error:'lookup_invalid_response'});
  try{return json(200,{source:'census_geocoding_suggestion',verification:'not_postal_verified',candidates:normalize(JSON.parse(res.body))})}catch{return json(502,{error:'lookup_invalid_response'})}
 }catch{return json(req.signal.aborted?499:503,{error:req.signal.aborted?'cancelled':'lookup_unavailable'})}
}
