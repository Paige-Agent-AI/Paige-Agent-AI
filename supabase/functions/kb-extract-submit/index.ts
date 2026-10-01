import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.75.0';
import { adminClient, json } from '../_shared/systems-check-http.ts';
import { downloadKnowledgeText, ExtractionError, submitKnowledgeExtraction } from '../_shared/knowledge-extraction.ts';
import { KnowledgeIngestScopeError } from '../_shared/knowledge-ingest-scope.ts';
Deno.serve(async (req: Request) => {
 if(req.method==='OPTIONS') return json(200,{ok:true});
 if(req.method!=='POST') return json(405,{error:'method_not_allowed'});
 const auth=req.headers.get('Authorization');
 if(!auth?.startsWith('Bearer ')) return json(401,{error:'unauthenticated'});
 const url=Deno.env.get('SUPABASE_URL')!; const key=Deno.env.get('SUPABASE_ANON_KEY')!;
 const caller=createClient(url,key,{global:{headers:{Authorization:auth}}});
 try {
  const reader=req.body?.getReader(); if(!reader) return json(400,{error:'input_invalid'});
  const parts: Uint8Array[]=[]; let size=0; let timedOut=false;
  const timer=setTimeout(()=>{timedOut=true; void reader.cancel();},30000);
  try { for(;;){const part=await reader.read(); if(part.done) break; size+=part.value.length; if(size>2100000) throw new ExtractionError('input_invalid'); parts.push(part.value);} }
  finally { clearTimeout(timer); await reader.cancel().catch(()=>{}); reader.releaseLock(); }
  if(timedOut) throw new ExtractionError('input_invalid');
  const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
  const body=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  const result=await submitKnowledgeExtraction(JSON.parse(body),caller,adminClient(),path=>downloadKnowledgeText(`${url}/storage/v1/object/authenticated/tenant-knowledge/${path.split('/').map(encodeURIComponent).join('/')}`,{Authorization:auth,apikey:key}));
  return json(200,{ok:true,...result as Record<string,unknown>});
 } catch(error) {
  if(error instanceof KnowledgeIngestScopeError) return json(error.status,{error:'workspace_access_changed'});
  if(error instanceof ExtractionError || error instanceof SyntaxError) return json(400,{error:error instanceof ExtractionError?error.code:'input_invalid'});
  return json(409,{error:'extraction_not_accepted'});
 }
});
