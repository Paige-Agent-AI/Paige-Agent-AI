import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.75.0';
import { adminClient, json } from '../_shared/systems-check-http.ts';
import { downloadKnowledgeText, ExtractionError, ExtractionSubmissionUnknown, submitKnowledgeExtraction } from '../_shared/knowledge-extraction.ts';
import { KnowledgeIngestScopeError, type KnowledgeScopeCaller } from '../_shared/knowledge-ingest-scope.ts';
import type { ExtractionRpc } from '../_shared/knowledge-extraction.ts';
Deno.serve(async (req: Request) => {
 if(req.method==='OPTIONS') return json(200,{ok:true});
 if(req.method!=='POST') return json(405,{error:'method_not_allowed'});
 const auth=req.headers.get('Authorization');
 if(!auth?.startsWith('Bearer ')) return json(401,{error:'unauthenticated'});
 const url=Deno.env.get('SUPABASE_URL')!; const key=Deno.env.get('SUPABASE_ANON_KEY')!;
 const client=createClient(url,key,{global:{headers:{Authorization:auth}}});
 // Function-member adapters: relating the supabase-js generic from()/rpc() signatures to the
 // shared ports structurally trips TS2589 under deno check, so each member instantiates here.
 const caller: KnowledgeScopeCaller={
  auth: client.auth,
  readActiveTenant:(userId: string)=>client.from('profiles').select('active_tenant_id').eq('user_id',userId).maybeSingle(),
  rpc:(name: string,args?: Record<string,unknown>)=>client.rpc(name,args as never),
 };
 const service=adminClient();
 const admin: ExtractionRpc={rpc:(name: string,args: Record<string,unknown>)=>service.rpc(name,args as never)};
 try {
  const reader=req.body?.getReader(); if(!reader) return json(400,{error:'input_invalid'});
  const parts: Uint8Array[]=[]; let size=0; let timedOut=false;
  const timer=setTimeout(()=>{timedOut=true; void reader.cancel();},30000);
  try { for(;;){const part=await reader.read(); if(part.done) break; size+=part.value.length; if(size>2100000) throw new ExtractionError('input_invalid'); parts.push(part.value);} }
  finally { clearTimeout(timer); await reader.cancel().catch(()=>{}); reader.releaseLock(); }
  if(timedOut) throw new ExtractionError('input_invalid');
  const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
  const body=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  const result=await submitKnowledgeExtraction(JSON.parse(body),caller,admin,path=>downloadKnowledgeText(`${url}/storage/v1/object/authenticated/tenant-knowledge/${path.split('/').map(encodeURIComponent).join('/')}`,{Authorization:auth,apikey:key}));
  return json(200,{ok:true,...result as Record<string,unknown>});
 } catch(error) {
  if(error instanceof ExtractionSubmissionUnknown) return json(503,{ok:false,error:'submission_outcome_unknown',intent_id:error.intentId,reconciliation:'replay_same_intent'});
  if(error instanceof KnowledgeIngestScopeError) return json(error.status,{error:'workspace_access_changed'});
  if(error instanceof ExtractionError || error instanceof SyntaxError) return json(400,{error:error instanceof ExtractionError?error.code:'input_invalid'});
  return json(409,{error:'extraction_not_accepted'});
 }
});
