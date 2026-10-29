// Original domain readers own facts and permissions; Team Hub owns model execution,
// posting and receipts. This private MERIT adapter creates no domain writer.
import { AGREEMENT_TOOLS } from "../paige-spine/domains/agreement.ts";
import { AGREEMENT_STATUSES, readAgreements, type AgreementReadDiagnostics,
  type AgreementReadResult, type AgreementReadRpcPort } from "../agreements/chat-read.ts";
import { CLIENT_ENGAGEMENT_TOOLS, dispatchClientStandingChat,
  type EngagementChatResult, type EngagementReadKey } from "./chat.ts";
import { readRecordLinks, type ReadRecordLink } from "../paige-turn/record-links.ts";

export const MERIT_SERVICE_READ_KEYS = ["agreement_list", "agreement_status", "read_client_engagement_status"] as const;
export const MERIT_SERVICE_READ_TIMEOUT_MS = 5000;
const DEFS = [...AGREEMENT_TOOLS, ...CLIENT_ENGAGEMENT_TOOLS]
  .filter(t => (MERIT_SERVICE_READ_KEYS as readonly string[]).includes(t.function.name));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const object = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null;
export type MeritServiceScope = Readonly<{
  agent: string; where: string; audience: string; tenantId: string; actorId: string;
  workspaceAdmin: boolean; storedTools: readonly string[] | null;
}>;
export type MeritServiceReadEvidence = Readonly<{
  name: "agreement_list" | "agreement_status" | EngagementReadKey; serverRecorded: boolean;
}>;
export type MeritServiceReadDeps = Readonly<{
  caller: AgreementReadRpcPort; isCurrent: (scope: MeritServiceScope) => Promise<boolean>;
  recordReads: (reads: readonly MeritServiceReadEvidence[]) => Promise<boolean>;
  diagnostics?: AgreementReadDiagnostics; signal?: AbortSignal;
}>;
export type MeritServiceRead = Readonly<{
  model: AgreementReadResult | Omit<EngagementChatResult, "record_links">;
  recordLinks: readonly ReadRecordLink[]; revalidate: () => Promise<boolean>;
}>;
function eligible(s: MeritServiceScope): boolean {
  return s.agent === "merit" && s.where === "agent_dm" && s.audience === "business_team"
    && s.workspaceAdmin === true && UUID.test(s.tenantId) && UUID.test(s.actorId) && Array.isArray(s.storedTools);
}
/** Exact original schemas; stored scope narrows these reads and cannot admit another tool. */
export function meritServiceReadTools(s: MeritServiceScope) {
  return eligible(s) ? DEFS.filter(t => s.storedTools!.includes(t.function.name)) : [];
}
const withheld = (): MeritServiceRead => ({ model: { status: "unavailable",
  message: "I couldn't verify the current commercial records. Nothing was changed. Try the original record again." },
  recordLinks: [], revalidate: async () => false });
function argumentsFor(name: string, input: unknown): Record<string, string> | null {
  const a = object(input);
  if (!a) return null;
  if (name === "read_client_engagement_status") {
    if (Object.keys(a).some(k => k !== "client" && k !== "client_id")
      || (a.client !== undefined && (typeof a.client !== "string" || [...a.client].length > 120))
      || (a.client_id !== undefined && (typeof a.client_id !== "string" || !UUID.test(a.client_id)))) return null;
  } else {
    if (Object.keys(a).some(k => k !== "status" && !(name === "agreement_status" && k === "contactId"))
      || (a.status !== undefined && (typeof a.status !== "string" || !(AGREEMENT_STATUSES as readonly string[]).includes(a.status)))
      || (name === "agreement_status" && (typeof a.contactId !== "string" || !UUID.test(a.contactId)))) return null;
  }
  return structuredClone(a) as Record<string, string>;
}
// Retain original facts/versions/caps. Observation/receipt identity alone may vary.
function stableSource(value: unknown): string {
  const row = object(value);
  if (!row) return JSON.stringify(value);
  const { read_at: _read, receipt_id: _receipt, ...facts } = row;
  return JSON.stringify(facts);
}
export async function readMeritService(inputScope: MeritServiceScope, deps: MeritServiceReadDeps,
  name: string, input: unknown): Promise<MeritServiceRead> {
  const s = Object.freeze({ ...inputScope, storedTools: inputScope.storedTools ? Object.freeze([...inputScope.storedTools]) : null });
  const args = argumentsFor(name, input);
  if (!args || !meritServiceReadTools(s).some(t => t.function.name === name) || deps.signal?.aborted) return withheld();
  try {
    const read = async (life: { retired: boolean }) => {
      const alive = () => !life.retired && !deps.signal?.aborted;
      if (!alive() || !await deps.isCurrent(s) || !alive()) return null;
      const evidence: MeritServiceReadEvidence[] = [], sources: string[] = [];
      let failed = false;
      const caller: AgreementReadRpcPort = { rpc: async (rpcName, nativeArgs) => {
        if (!alive() || nativeArgs?._expected_tenant_id !== s.tenantId
          || !["paige_agreement_overview", "find_clients_for_status", "read_client_engagement_status"].includes(rpcName))
          return { data: null, error: { code: "42501" } };
        const result = await deps.caller.rpc(rpcName, nativeArgs);
        if (!alive()) return { data: null, error: { code: "42501" } };
        failed ||= !!result.error;
        if (!result.error) {
          const data = object(result.data);
          const valid = rpcName === "paige_agreement_overview"
            ? Array.isArray(result.data) && result.data.every(raw => {
              const row = object(raw);
              return !!row && typeof row.id === "string" && UUID.test(row.id)
                && (args.contactId === undefined || row.contact_id === args.contactId)
                && (args.status === undefined || row.status === args.status);
            })
            : rpcName !== "read_client_engagement_status" || (data?.tenant_id === s.tenantId
              && typeof data.contact_id === "string" && UUID.test(data.contact_id)
              && data.contact_id === nativeArgs?._contact_id && (args.client_id === undefined || data.contact_id === args.client_id));
          if (!valid) { failed = true; return { data: null, error: { code: "42501" } }; }
          sources.push(stableSource(result.data));
        }
        return result;
      } };
      let model: MeritServiceRead["model"], links: ReadRecordLink[] = [];
      if (name === "read_client_engagement_status") {
        const result = await dispatchClientStandingChat({ tenantId: s.tenantId,
          onRead: (key, serverRecorded) => evidence.push({ name: key, serverRecorded }) }, caller, args);
        const { record_links, ...forModel } = result;
        model = forModel; links = readRecordLinks(record_links);
        failed ||= result.status !== "available" && result.status !== "needs_input";
      } else {
        let contactPresence: boolean | null = null;
        model = await readAgreements({ caller, expectedTenantId: s.tenantId, contactId: args.contactId,
          status: args.status, requireContact: name === "agreement_status", diagnostics: {
            ...deps.diagnostics, contactExists: async id => {
              contactPresence = await deps.diagnostics?.contactExists?.(id) ?? null;
              return contactPresence;
            },
          } });
        failed ||= !model.success;
        if (model.success) {
          if (name === "agreement_status" && model.count === 0 && contactPresence === null) failed = true;
          evidence.push({ name: name as "agreement_list" | "agreement_status", serverRecorded: false });
          links = readRecordLinks(model.agreements.map(a => ({ destination: "sales_agreements", record_id: a.id })));
          if (!links.length && model.emptyReason !== "contact_not_found") links = [{ destination: "sales_agreements", record_id: null }];
        }
      }
      if (failed || !alive() || !await deps.isCurrent(s) || !alive()
        || (evidence.length > 0 && !await deps.recordReads(evidence)) || !alive()
        || !await deps.isCurrent(s) || !alive()) return null;
      return { model, links, identity: JSON.stringify(sources) };
    };
    const boundedRead = async () => {
      const life = { retired: false };
      let timer: ReturnType<typeof setTimeout> | undefined;
      let onAbort: (() => void) | undefined;
      try { return await Promise.race([read(life), new Promise<null>(resolve => {
        const retire = () => { life.retired = true; resolve(null); };
        timer = setTimeout(retire, MERIT_SERVICE_READ_TIMEOUT_MS);
        onAbort = retire; deps.signal?.addEventListener("abort", retire, { once: true });
        if (deps.signal?.aborted) retire();
      })]); }
      finally {
        life.retired = true; if (timer !== undefined) clearTimeout(timer);
        if (onAbort) deps.signal?.removeEventListener("abort", onAbort);
      }
    };
    const first = await boundedRead();
    if (!first || deps.signal?.aborted) return withheld();
    return { model: first.model, recordLinks: structuredClone(first.links), revalidate: async () => {
      try {
        const current = await boundedRead();
        return !!current && !deps.signal?.aborted && current.identity === first.identity
          && (name === "read_client_engagement_status"
            ? "status" in current.model && "status" in first.model && current.model.status === first.model.status
            : JSON.stringify(current.model) === JSON.stringify(first.model));
      } catch { return false; }
    } };
  } catch { return withheld(); }
}
