// The Trust Compass's reads, as settled fixtures (harness only). Governance keeps the REAL
// derivation, so the domains drawn are the ones the hook would produce from these rows.
import { deriveGovernance } from "@/solo/data/useSoloToolGovernance";

const variant = new URLSearchParams(window.location.search).get("variant") ?? "limits";
const noop = () => undefined;
const row = (tool_key: string, mode: string) => ({ tool_key, label: tool_key, category: "x", mode, is_default: false });

export function useSoloToolGovernance() {
  const d = deriveGovernance([row("crm_create_contact", "confirm"), row("calendar_book_meeting", "off")] as never, {} as never, false);
  return {
    loading: false, configured: true, error: null, domains: d.domains, byTool: d.byTool,
    ceilingLimiting: true,
    ceilingUnconfirmed: variant === "limits",
    canWrite: false,
    authorityUnconfirmed: variant === "limits",
    setDomainMode: async () => ({ ok: true }), setToolMode: async () => ({ ok: true }), refresh: noop,
  };
}

export function useSoloTrust() {
  return { loading: false, configured: true, departments: [], bySlug: {}, error: null };
}

export function usePaigeDeptStatus() {
  return { loading: false, configured: true, departments: [] };
}

export function useSoloPendingActions() {
  return { items: [], loading: false, error: null, refresh: noop };
}

const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();
export function useSoloActivityFeed() {
  return {
    items: [
      { id: "r1", title: "Business time zone changed", summary: null, byPaige: false, byPerson: true, actorAgent: null, departmentSlug: "operations_pmo", occurredAt: at(12) },
      { id: "r2", title: "Client standing checked", summary: null, byPaige: true, byPerson: false, actorAgent: null, departmentSlug: "fulfillment_client_success", occurredAt: at(40) },
    ],
    loading: false, status: "ready", error: null, refresh: noop,
  };
}
export { departmentLabel, elapsedLabel } from "@/solo/data/useSoloActivityFeed";
