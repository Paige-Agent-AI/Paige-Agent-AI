import { createPipelineCanonicalReaders, type PipelineCanonicalCaller, type PipelineCanonicalService } from './pipeline-metadata-canonical-reader.ts';
import { readPipelineMetadataOutcome } from './pipeline-metadata-readback.ts';
export interface PipelineOutcomeClients { caller(authorization: string): PipelineCanonicalCaller; service(): PipelineCanonicalService }
const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
const unknown = () => reply({ outcome: 'outcome_unknown', verified_readback: false });
async function boundedBody(req: Request): Promise<string | null> {
 if (!req.body) return '';
 const reader = req.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
 try {
  while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > 8192) { await reader.cancel(); return null; } chunks.push(value); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder().decode(bytes);
 } finally { reader.releaseLock(); }
}
/** Read-only authenticated consumer; no mutation, admission or receipt issuance. */
export function createPipelineOutcomeHandler(clients: PipelineOutcomeClients) { return async (req: Request) => {
 if (req.method === 'OPTIONS') return new Response(null, { headers });
 if (req.method !== 'POST') return reply({ error: 'method_not_allowed' }, 405);
 const authorization = req.headers.get('authorization');
 if (!authorization || !/^Bearer \S+$/.test(authorization)) return reply({ error: 'unauthorized' }, 401);
 try {
  const caller = clients.caller(authorization); const auth = await caller.auth.getUser();
  if (auth.error || !auth.data.user || !uuid.test(auth.data.user.id)) return reply({ error: 'unauthorized' }, 401);
  const text = await boundedBody(req); if (text === null) return reply({ error: 'request_too_large' }, 413);
  let input: Record<string, unknown>; try { input = JSON.parse(text); } catch { return reply({ error: 'invalid_request' }, 400); }
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['threadId','intentId','effectId'].includes(key)) || ![input.threadId,input.intentId,input.effectId].every(value => typeof value === 'string' && uuid.test(value))) return reply({ error: 'invalid_request' }, 400);
  const tenant = await caller.rpc('current_user_tenant_id');
  if (tenant.error || typeof tenant.data !== 'string' || !uuid.test(tenant.data)) return unknown();
  const binding = { threadId: input.threadId as string, intentId: input.intentId as string, effectId: input.effectId as string, actorId: auth.data.user.id, tenantId: tenant.data };
  const dependencies = createPipelineCanonicalReaders({ caller, service: clients.service(), revalidateScope: async scope => {
   const result = await caller.rpc('read_pipeline_metadata_original', { _thread: scope.threadId, _intent: scope.intentId, _effect: scope.effectId });
   if (result.error || !result.data || typeof result.data !== 'object' || Array.isArray(result.data)) return false;
   const original = result.data as Record<string, unknown>;
   return original.actorId === scope.actorId && original.tenantId === scope.tenantId;
  } });
  return reply(await readPipelineMetadataOutcome(binding, dependencies));
 } catch { return unknown(); }
}; }
