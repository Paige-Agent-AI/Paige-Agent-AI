// EXP10's SAME NEXUS connected-marketing-intelligence DM consumer (ANT-164, owner directive
// 385a54eb; contract efa6d22f on ANT-161). The doctrine's adoption-owners line names "EXP10 NEXUS
// primary with contextual domain support", and NEXUS's approved responsibility includes connected
// marketing intelligence — this read is that half of the remit: WHICH channels and providers are
// connected and their recorded status, so NEXUS answers "can I post there / is my email connected"
// from the workspace's real state instead of "I can't see it from Team Hub yet".
//
// Unmounted-foundation discipline (the merged vera-metric-read.ts pattern): the Team Hub turn owns
// offers, posting and receipts; this module owns eligibility, the bounded read and the honest
// envelope. The executor is the SAME invoker-scoped projection PAIGE chat calls
// (public.list_integration_surface — RLS bounds every row to the asker's own authority, no tenant
// parameter exists to get wrong), run under the ASKER's own JWT, so the turn never holds a wider
// credential than the person asking. integrations_health has no live chat executor and is NOT
// offered here; no write, provider call or connection action exists anywhere in this module.
//
// Pure apart from its injected clients, so Node, Deno and the tests all load it.

import { INTEGRATIONS_READ_TOOLS } from "../paige-spine/domains/integrations_surface.ts";
import { resolveWorkspaceAuthority, NO_WORKSPACE_AUTHORITY } from "../workspace-authority.ts";
import { recordCapabilityRun, stableRunId } from "../capability-record.ts";

export const NEXUS_CONNECTION_READ_TOOL = "integrations_list";
export const NEXUS_CONNECTION_READ_TIMEOUT_MS = 5000;
const DEFINITION = INTEGRATIONS_READ_TOOLS[0];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Server-resolved offer scope; never model/request-body fields. */
export type NexusConnectionScope = Readonly<{
  agent: string;
  where: string;
  tenantId: string;
  actorId: string;
  workspaceAdmin: boolean;
  storedTools: readonly string[] | null;
}>;

/** The tool's definition, a fresh copy per call (the host may decorate what it is handed). */
export function nexusConnectionToolDef(): { type: "function"; function: { name: string; description: string; parameters: unknown } } {
  return JSON.parse(JSON.stringify(DEFINITION)) as { type: "function"; function: { name: string; description: string; parameters: unknown } };
}

function eligible(s: NexusConnectionScope): boolean {
  return s.agent === "nexus" && s.where === "agent_dm" && s.workspaceAdmin === true
    && UUID.test(s.tenantId) && UUID.test(s.actorId)
    && Array.isArray(s.storedTools) && s.storedTools.includes(NEXUS_CONNECTION_READ_TOOL);
}

/** The definitions a turn may offer: the one read when every gate holds, nothing otherwise. */
export function nexusConnectionReadTools(scope: NexusConnectionScope): ReturnType<typeof nexusConnectionToolDef>[] {
  return eligible(scope) ? [nexusConnectionToolDef()] : [];
}

/**
 * The host's offer gate: resolve the asker's authority in this workspace, then decide. The
 * authority is asked ONLY when the stored DM scope already names the read (the namesA2bTool
 * precedent), so a scope that never carries it costs nothing. Fails closed: any error is no
 * authority, and the invoker-scoped RPC bounds the data even if this gate were stale.
 */
export async function offerNexusConnectionRead(
  deps: { caller: unknown; service: unknown; userId: string; tenantId: string },
  storedTools: readonly string[] | null,
): Promise<boolean> {
  if (!Array.isArray(storedTools) || !storedTools.includes(NEXUS_CONNECTION_READ_TOOL)) return false;
  let authority;
  try {
    authority = await resolveWorkspaceAuthority(deps.caller, deps.service, deps.userId, deps.tenantId);
  } catch {
    authority = NO_WORKSPACE_AUTHORITY;
  }
  return authority.workspaceAdmin === true;
}

export type NexusConnectionDeps = Readonly<{
  /** The asker's own client (their JWT): the projection runs under their authority. */
  caller: { rpc(name: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: { code?: unknown } | null } | { data: unknown; error: null }> };
  service: Parameters<typeof recordCapabilityRun>[0];
  userId: string;
  tenantId: string;
  /** The turn's stable reference, so the receipt's run id can never collide across calls. */
  turnRef: string;
  signal?: AbortSignal;
  /** Test seam for the deadline; the default is the shipped bound. */
  timeoutMs?: number;
}>;

type RpcResult = { data?: unknown; error?: { code?: unknown } | null } | null;

const UNAVAILABLE = (): Record<string, unknown> => ({
  status: "unavailable",
  message: "I couldn't read this workspace's connections right now. Say plainly that you can't see them from here; never guess a provider or status.",
});

/** A transport-shaped loss: no SQLSTATE and no PostgREST code — the outcome is unknown. */
function isTransportError(result: RpcResult): boolean {
  if (!result) return true;
  if (!result.error) return false;
  const code = typeof result.error.code === "string" ? result.error.code.trim() : "";
  return !(/^[0-9A-Z]{5}$/.test(code) || /^PGRST/.test(code));
}

function object(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/**
 * The one read. Takes NO parameters — anything the model passes is refused as needs_input so it
 * calls back clean, never silently ignored. The RPC is asked at most twice (an idempotent pure
 * projection, retried only when the first answer was transport-lost); a refusal or a database
 * error is reported honestly as unavailable, never retried into a guess. On success the envelope
 * is the SAME shape PAIGE chat returns for this tool — {success, count, integrations} — so the
 * same question gets the same semantics on both surfaces.
 */
export async function readNexusConnections(deps: NexusConnectionDeps, input: unknown): Promise<Record<string, unknown>> {
  try {
    const args = object(input);
    if (input !== undefined && input !== null && (!args || Object.keys(args).length > 0)) {
      return { status: "needs_input", message: "This read takes no arguments. Call it with none." };
    }
    if (deps.signal?.aborted) return UNAVAILABLE();

    const timeoutMs = deps.timeoutMs ?? NEXUS_CONNECTION_READ_TIMEOUT_MS;
    const lifetime = { retired: false };
    const expires = performance.now() + timeoutMs;
    const stopped = () => lifetime.retired || deps.signal?.aborted || performance.now() >= expires;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abort: (() => void) | undefined;
    const deadline = new Promise<null>(resolve => {
      abort = () => { lifetime.retired = true; resolve(null); };
      timer = setTimeout(abort, timeoutMs);
      deps.signal?.addEventListener("abort", abort, { once: true });
      if (deps.signal?.aborted) abort();
    });
    const ask = async (): Promise<RpcResult | "stopped"> => {
      const first = await deps.caller.rpc("list_integration_surface");
      if (stopped()) return "stopped";
      if (isTransportError(first)) {
        // The answer was lost, not refused: ask once more with the same arguments (idempotent read).
        const second = await deps.caller.rpc("list_integration_surface");
        if (stopped()) return "stopped";
        if (isTransportError(second)) return null;
        return second as RpcResult;
      }
      return first as RpcResult;
    };
    let result: RpcResult | "stopped";
    try {
      result = await Promise.race([ask(), deadline]);
    } finally {
      lifetime.retired = true;
      if (timer !== undefined) clearTimeout(timer);
      if (abort) deps.signal?.removeEventListener("abort", abort);
    }
    if (deps.signal?.aborted || result === "stopped" || result === null) return UNAVAILABLE();
    if (result.error) return UNAVAILABLE();
    const rows = Array.isArray(result.data) ? result.data : null;
    if (!rows) return UNAVAILABLE();

    // The receipt is evidence, not a gate: the read returns even if the receipt fails to record.
    recordCapabilityRun(deps.service, {
      tenantId: deps.tenantId, actorId: deps.userId, capabilityKey: NEXUS_CONNECTION_READ_TOOL,
      outcome: "capability_succeeded",
      runId: await stableRunId([NEXUS_CONNECTION_READ_TOOL, deps.tenantId, `team_hub_agent:${deps.turnRef}`]),
      detail: { channel: "team_hub_agent", tool: NEXUS_CONNECTION_READ_TOOL, read_only: true },
    }).catch(() => false);
    return { success: true, count: rows.length, integrations: rows };
  } catch {
    return UNAVAILABLE();
  }
}
