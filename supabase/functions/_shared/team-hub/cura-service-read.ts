// EXP09's business-team CURA adapter. NOT the external customer's private assistant.
// The existing Team Hub turn owns admission, posting and receipts; the original
// caller-JWT commercial reader owns permissions, client resolution and all facts.
import {
  CLIENT_ENGAGEMENT_TOOLS, dispatchClientStandingChat,
  type EngagementCaller, type EngagementChatResult, type EngagementReadKey,
} from "../client-engagement/chat.ts";
import type { ReadRecordLink } from "../paige-turn/record-links.ts";

export const CURA_SERVICE_READ_TOOL = "read_client_engagement_status";
export const CURA_SERVICE_READ_TIMEOUT_MS = 5000;
const DEFINITION = CLIENT_ENGAGEMENT_TOOLS.find(t => t.function.name === CURA_SERVICE_READ_TOOL)!;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const object = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null;

/** Server-resolved original turn scope, never fields accepted from a model/request body. */
export type CuraServiceScope = Readonly<{
  agent: string; where: string; audience: string; tenantId: string; actorId: string;
  workspaceAdmin: boolean; storedTools: readonly string[] | null;
}>;
export type CuraServiceReadEvidence = Readonly<{ name: EngagementReadKey; serverRecorded: boolean }>;
export type CuraServiceReadDeps = Readonly<{
  caller: EngagementCaller;
  /** Existing turn's current actor/tenant/DM/authority check, including cancellation. */
  isCurrent: (scope: CuraServiceScope) => Promise<boolean>;
  /** Existing receipt path must acknowledge every governed read before facts reach the model. */
  recordReads: (reads: readonly CuraServiceReadEvidence[]) => Promise<boolean>;
  signal?: AbortSignal;
}>;
export type CuraServiceRead = Readonly<{
  model: Omit<EngagementChatResult, "record_links">;
  /** Original references only; presentation consumes them separately, never the model. */
  recordLinks: readonly ReadRecordLink[];
  /** Must succeed immediately before the original turn posts. No new post/retry engine. */
  revalidate: () => Promise<boolean>;
}>;

function eligible(scope: CuraServiceScope): boolean {
  return scope.agent === "cura" && scope.where === "agent_dm" && scope.audience === "business_team"
    && scope.workspaceAdmin === true && UUID.test(scope.tenantId) && UUID.test(scope.actorId)
    && Array.isArray(scope.storedTools) && scope.storedTools.includes(CURA_SERVICE_READ_TOOL);
}

/** Reuse the ONE canonical schema. Even a poisoned shared allowlist cannot offer this private read. */
export function curaServiceReadTools(scope: CuraServiceScope): (typeof DEFINITION)[] {
  return eligible(scope) ? [DEFINITION] : [];
}

const withheld = (): CuraServiceRead => ({
  model: { status: "unavailable", message: "I couldn't verify this client's current records. Nothing was changed. Try the original client record again." },
  recordLinks: [], revalidate: async () => false,
});

function captureScope(scope: CuraServiceScope): CuraServiceScope {
  return Object.freeze({ agent: scope.agent, where: scope.where, audience: scope.audience, tenantId: scope.tenantId,
    actorId: scope.actorId, workspaceAdmin: scope.workspaceAdmin,
    storedTools: scope.storedTools ? Object.freeze([...scope.storedTools]) : null });
}

function argumentsForRead(input: unknown): Record<string, string> | null {
  const row = object(input);
  if (!row || Object.keys(row).some(k => k !== "client" && k !== "client_id")) return null;
  if (row.client !== undefined && (typeof row.client !== "string" || [...row.client].length > 120)) return null;
  if (row.client_id !== undefined && (typeof row.client_id !== "string" || !UUID.test(row.client_id))) return null;
  return { ...(typeof row.client === "string" ? { client: row.client } : {}),
    ...(typeof row.client_id === "string" ? { client_id: row.client_id } : {}) };
}

// Only observation/receipt identity varies between equal original reads. Keep EVERY
// business fact, customer id, date/zone, truncation flag, source version and record reference.
function stableSource(data: unknown): string {
  const row = object(data);
  if (!row) return JSON.stringify(data);
  const { read_at: _observation, receipt_id: _receipt, ...facts } = row;
  return JSON.stringify(facts);
}

/** A bounded original read; timeout/abort is no proof of server cancellation and never causes a retry. */
export async function readCuraServiceStanding(scopeInput: CuraServiceScope, deps: CuraServiceReadDeps, input: unknown): Promise<CuraServiceRead> {
  const scope = captureScope(scopeInput), args = argumentsForRead(input);
  if (!eligible(scope) || !args || deps.signal?.aborted) return withheld();
  try {
    const read = async (lifetime: { retired: boolean }) => {
      if (lifetime.retired || deps.signal?.aborted || !await deps.isCurrent(scope)
        || lifetime.retired || deps.signal?.aborted) return null;
      const evidence: CuraServiceReadEvidence[] = [], sources: string[] = [];
      let failed = false, refused = false;
      const caller: EngagementCaller = { rpc: async (name, nativeArgs) => {
        if (lifetime.retired || deps.signal?.aborted || !["find_clients_for_status", CURA_SERVICE_READ_TOOL].includes(name))
          return { data: null, error: { code: "42501" } };
        const result = await deps.caller.rpc(name, nativeArgs);
        if (result.error) { failed = true; refused ||= result.error.code === "42501"; }
        if (!result.error) {
          const data = object(result.data);
          if (name === CURA_SERVICE_READ_TOOL && (data?.tenant_id !== scope.tenantId
            || typeof data.contact_id !== "string" || !UUID.test(data.contact_id)
            || data.contact_id !== nativeArgs?._contact_id
            || (args.client_id !== undefined && data.contact_id !== args.client_id)))
            { failed = true; refused = true; return { data: null, error: { code: "42501" } }; }
          sources.push(stableSource(result.data));
        }
        return result;
      } };
      const result = await dispatchClientStandingChat({ tenantId: scope.tenantId,
        onRead: (name, serverRecorded) => evidence.push({ name, serverRecorded }) }, caller, args);
      if (lifetime.retired || deps.signal?.aborted || !await deps.isCurrent(scope)
        || lifetime.retired || deps.signal?.aborted
        || (evidence.length > 0 && !await deps.recordReads(evidence))) return null;
      if (lifetime.retired || deps.signal?.aborted || !await deps.isCurrent(scope)
        || lifetime.retired || deps.signal?.aborted) return null;
      return { result, identity: JSON.stringify(sources), failed, refused };
    };
    const boundedRead = async () => {
      const lifetime = { retired: false };
      let timer: ReturnType<typeof setTimeout> | undefined;
      try { return await Promise.race([read(lifetime), new Promise<null>(resolve => {
        timer = setTimeout(() => { lifetime.retired = true; resolve(null); }, CURA_SERVICE_READ_TIMEOUT_MS);
      })]); }
      finally { lifetime.retired = true; if (timer !== undefined) clearTimeout(timer); }
    };
    const first = await boundedRead();
    if (!first || deps.signal?.aborted) return withheld();
    // The original UI reader may describe an inaccessible explicit id as needs_input.
    // That is not a successful revalidated source or a publishable financial answer.
    if (first.failed) return first.refused
      ? { model: { status: "refused", message: "I can't read that client from your current business account. Nothing was changed." },
        recordLinks: [], revalidate: async () => false }
      : withheld();
    const { record_links: links, ...model } = first.result;
    if (model.status !== "available" && model.status !== "needs_input")
      return { model, recordLinks: [], revalidate: async () => false };
    return { model, recordLinks: links ? structuredClone(links) : [], revalidate: async () => {
      try {
        const current = await boundedRead();
        return !!current && !current.failed && !deps.signal?.aborted && current.result.status === first.result.status
          && current.identity === first.identity;
      } catch { return false; }
    } };
  } catch { return withheld(); }
}
