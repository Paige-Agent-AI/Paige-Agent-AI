import { readOwnerTaskHistory, type OwnerTaskHistoryClients } from './owner-task-history.ts';

export interface OwnerTaskHistoryTransport {
  caller(authorization: string): OwnerTaskHistoryClients['caller'];
  service(): OwnerTaskHistoryClients['service'];
}
const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const reply = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers });
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
async function body(req: Request): Promise<unknown> {
  if (!req.body) return null;
  const reader = req.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  let expired = false;
  const stop = () => { expired = true; void reader.cancel().catch(() => {}); };
  const timer = setTimeout(stop, 5_000);
  req.signal.addEventListener('abort', stop, { once: true });
  try {
    while (true) {
      if (expired || req.signal.aborted) throw Error('cancelled');
      const part = await reader.read(); if (part.done) break;
      size += part.value.byteLength; if (size > 1024) { await reader.cancel(); return null; } chunks.push(part.value);
    }
    if (expired || req.signal.aborted) throw Error('cancelled');
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return JSON.parse(new TextDecoder().decode(bytes));
  } finally { clearTimeout(timer); req.signal.removeEventListener('abort', stop); reader.releaseLock(); }
}
/** Read-only transport over the original execution/approval/result/Rail stores.
 * A new endpoint is not a new approval, history ledger or execution pathway. */
export function createOwnerTaskHistoryHandler(transport: OwnerTaskHistoryTransport) {
  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return new Response(null, { headers });
    if (req.method !== 'POST') return reply(405, { error: 'method_not_allowed' });
    const authorization = req.headers.get('authorization');
    if (!authorization || !/^Bearer \S+$/.test(authorization)) return reply(401, { error: 'unauthorized' });
    try {
      const caller = transport.caller(authorization);
      const auth = await caller.auth.getUser();
      if (auth.error || !uuid(auth.data.user?.id)) return reply(401, { error: 'unauthorized' });
      const input = await body(req);
      if (!object(input) || Object.keys(input).length !== 2 || !Object.keys(input).every(k => ['approvalId', 'tenantId'].includes(k))
        || !uuid(input.approvalId) || !uuid(input.tenantId)) return reply(400, { error: 'invalid_request' });
      // Service credentials stay server-local. This factory does not perform a
      // lookup: the reader first reauthorizes the exact original-JWT companion.
      const result = await readOwnerTaskHistory({ approvalId: input.approvalId, tenantId: input.tenantId },
        { caller, service: transport.service() }, req.signal);
      return reply(result.status === 'refused' ? 403 : 200, result);
    } catch { return reply(200, { status: 'unavailable' }); }
  };
}
