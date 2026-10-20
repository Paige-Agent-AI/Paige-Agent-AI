// DEVELOPMENT ONLY. Every data boundary is synthetic and the backend transport refuses all calls.
import { createContext, useCallback, useContext, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { TEST_BUSINESS_REVIEW, TEST_REVIEW_TENANT } from "@/test/fixtures/business-review";
export { businessDateLabel, businessCalendarHeldNote } from "@/solo/data/useBusinessTimeZone";
const Presence = createContext({ railExpanded: false, expandRail: () => {}, collapseRail: () => {} });
export function HarnessPresence({ children }: { children: React.ReactNode }) {
  const [railExpanded, set] = useState(new URLSearchParams(location.search).get("paige") === "open");
  const expandRail = useCallback(() => set(true), []), collapseRail = useCallback(() => set(false), []);
  return <Presence.Provider value={{ railExpanded, expandRail, collapseRail }}>{children}</Presence.Provider>;
}
export const useAgentPresence = () => useContext(Presence);
function params() { return new URLSearchParams(useLocation().search); }
const noop = () => {};
export const supabase = { rpc: () => { throw Error("HARNESS_NO_BACKEND"); }, from: () => { throw Error("HARNESS_NO_BACKEND"); }, functions: { invoke: () => { throw Error("HARNESS_NO_BACKEND"); } } };
export function useTenantContext() { const p = params(); return { activeTenantId: p.get("workspace") === "b" ? "test-tenant-b" : TEST_REVIEW_TENANT, activeUserId: "test-owner" }; }
export function useTierFeatures() { return { has: () => true, loading: false }; }
export function useBusinessReview() {
  const p = params(), variant = p.get("state");
  if (variant === "loading") return { state: "loading", refresh: noop };
  if (variant === "error" || variant === "member") return { state: "failed", message: variant === "member" ? "This business review is not authorized for this role." : "Your business review could not be read right now. Nothing was changed.", refresh: noop };
  const snapshot = structuredClone(TEST_BUSINESS_REVIEW);
  if (variant === "unavailable") for (const d of snapshot.requested) snapshot.domains[d] = { status: "degraded", data: null, reason: "scope_changed" };
  if (p.get("workspace") === "b") { snapshot.tenant_id = "test-tenant-b"; snapshot.domains.clients.data!.headline = [{ ...snapshot.domains.clients.data!.headline[0], value: 2 }]; }
  return { state: "ready", snapshot, refresh: noop };
}
export function useSoloPendingActions() {
  const state = params().get("state");
  return { items: state === "empty" || state === "error" ? [] : Array.from({ length: 10 }, (_, i) => ({ id: "test-action-" + i, title: ["Review a service proposal", "Prepare a client check-in", "Revisit a recorded deadline"][i % 3], department: ["Sales", "Client Success", "Operations"][i % 3] })), total: state === "empty" ? 0 : 37, loading: state === "loading", error: state === "error" ? "unavailable" : null, refresh: noop };
}
export function useSoloActivityFeed() {
  const state = params().get("state");
  return { status: state === "loading" ? "loading" : state === "member" ? "forbidden" : state === "error" ? "unavailable" : "ready", items: state === "empty" ? [] : [
    { id: "test-record-1", title: "Business time zone saved", summary: "The owner's recorded setting was read back.", byPaige: false, byPerson: true, actorAgent: null, occurredAt: "2026-10-13T14:00:00Z" },
    { id: "test-record-2", title: "Business review read", summary: "A read only; no business action was executed.", byPaige: true, byPerson: false, actorAgent: null, occurredAt: "2026-10-13T14:00:00Z" },
  ], refresh: noop };
}
export const elapsedLabel = () => "in the synthetic record";
export function useBusinessGamePlanMissions() {
  const state = params().get("state");
  return { status: state === "loading" ? "loading" : state === "member" ? "forbidden" : state === "error" ? "error" : "ready", items: state === "empty" ? [] : [
    { id: "test-play-1", state: "active", stageLabel: "Active", title: "Prepare the next service launch", desired_outcome: "A clear offer and a verified customer journey", deadline_on: "2026-11-06", next_action: "Review the service scope" },
    { id: "test-play-2", state: "proposed", stageLabel: "Draft", title: "Strengthen the client handoff", desired_outcome: "Make the next step clear for every client", deadline_on: null },
  ], refresh: noop };
}
export function useBusinessCalendarDay() { return { day: { kind: "withheld", reason: "missing", canSet: true }, refresh: noop }; }
const Placeholder = ({ name }: { name: string }) => <section style={{ padding: 24 }}><h2>{name}</h2><p>This preserved destination is a placeholder in this synthetic walkthrough. Its authenticated owning view is tested separately.</p><Link to="/solo/1234567/command-center/executive">Return to Executive</Link></section>;
export const SoloMindWorkspace = () => <Placeholder name="Mind" />;
export const SoloSystemsCheckWorkspace = () => <Placeholder name="Systems Check" />;
export const SoloGamePlanWorkspace = () => <Placeholder name="Business Game Plan" />;
export const TrustCompass = () => <Placeholder name="Trust Compass" />;
export const DialPadTrigger = () => null;
export const PaigeAIChat = () => <p>Conversation is synthetic in this walkthrough.</p>;
