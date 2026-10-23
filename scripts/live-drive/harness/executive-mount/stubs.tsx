// DEVELOPMENT ONLY. Every data boundary is synthetic and the backend transport refuses all calls.
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { TEST_BUSINESS_REVIEW, TEST_REVIEW_TENANT } from "@/test/fixtures/business-review";
import { SECOND_REVIEW_TENANT, withTargetAndFinanceFixtures } from "./slice-fixtures";
import { reportFixtureFrom } from "./report-fixture";
export { businessDateLabel, businessCalendarHeldNote } from "@/solo/data/useBusinessTimeZone";
const Presence = createContext({ railExpanded: false, expandRail: () => {}, collapseRail: () => {} });
export function HarnessPresence({ children }: { children: React.ReactNode }) {
  const [railExpanded, set] = useState(new URLSearchParams(location.search).get("paige") === "open");
  const expandRail = useCallback(() => set(true), []), collapseRail = useCallback(() => set(false), []);
  return <Presence.Provider value={{ railExpanded, expandRail, collapseRail }}>{children}</Presence.Provider>;
}
export const useAgentPresence = () => useContext(Presence);
function useHarnessParams() { return new URLSearchParams(useLocation().search); }
const noop = () => {};
export const supabase = { rpc: () => { throw Error("HARNESS_NO_BACKEND"); }, from: (table: string) => { if (import.meta.env.E2_HARNESS_SLICE === "report") return reportFixtureFrom(table); throw Error("HARNESS_NO_BACKEND"); }, functions: { invoke: () => { throw Error("HARNESS_NO_BACKEND"); } } };
export function useTenantContext() { const p = useHarnessParams(); return { activeTenantId: p.get("workspace") === "b" ? SECOND_REVIEW_TENANT : TEST_REVIEW_TENANT, activeUserId: "test-owner" }; }
export const useOptionalTenantContext = useTenantContext;
export function useTierFeatures() { return { has: () => true, loading: false }; }
export function useBusinessReview() {
  const p = useHarnessParams(), variant = p.get("state");
  if (variant === "loading") return { state: "loading", refresh: noop };
  if (variant === "error" || variant === "member") return { state: "failed", message: variant === "member" ? "This business review is not authorized for this role." : "Your business review could not be read right now. Nothing was changed.", refresh: noop };
  const input = structuredClone(TEST_BUSINESS_REVIEW);
  if (p.get("gap") === "missing") input.domains.campaigns = { status: "unavailable", data: null, reason: "no_adapter: campaigns" };
  if (p.get("workspace") === "b") { input.tenant_id = SECOND_REVIEW_TENANT; input.domains.clients.data!.headline = [{ ...input.domains.clients.data!.headline[0], value: 2 }]; }
  const snapshot = withTargetAndFinanceFixtures(input, variant ?? "ready", ["finance", "catalogue"].includes(import.meta.env.E2_HARNESS_SLICE));
  if (variant === "unavailable") for (const d of snapshot.requested) snapshot.domains[d] = { status: "degraded", data: null, reason: "scope_changed" };
  return { state: "ready", snapshot, refresh: noop };
}
export function useSoloPendingActions() {
  const state = useHarnessParams().get("state");
  const [rereading, setRereading] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reread = useCallback(() => {
    if (import.meta.env.E2_HARNESS_SLICE !== "desk") return;
    if (timer.current) clearTimeout(timer.current);
    setRereading(true); timer.current = setTimeout(() => setRereading(false), 200);
  }, []);
  useEffect(() => {
    if (import.meta.env.E2_HARNESS_SLICE !== "desk") return;
    // A disclosed synthetic input port. Native keys hold/release a reread while
    // the original modal is open; no test controls enter product components.
    const key = (event: KeyboardEvent) => { if (event.altKey && event.key.toLowerCase() === "r") { event.preventDefault(); if (timer.current) clearTimeout(timer.current); setRereading(value => !value); } };
    window.addEventListener("keydown", key);
    return () => { window.removeEventListener("keydown", key); if (timer.current) clearTimeout(timer.current); };
  }, []);
  if (import.meta.env.E2_HARNESS_SLICE === "desk") return {
    items: state === "empty" ? [] : [
      { id: "test-work-finding", title: "Review the payment processor setup", department: "Operations", summary: "No payment processor connection was recorded. Settlement has not been tested.", draftContent: null, rationale: null, createdAt: state === "missing-date" ? "" : "2026-10-22T09:30:00Z", ...(state === "missing-source" ? {} : { sourceLink: { destination: "systems_check" as const, record_id: "e2000000-0000-4000-8000-000000000006" } }) },
      { id: "test-work-draft", title: "Review the service priorities", department: "Executive", summary: "Confirm the priorities with PAIGE before authorizing work.", draftContent: Array.from({length:12}, (_, i) => `Review point ${i + 1}: inspect the original delivery commitments and confirm the next useful step with the owner.`).join("\n\n"), rationale: "The original draft requires owner review.", createdAt: "2026-10-21T14:00:00Z" },
      { id: "test-work-empty", title: "Inspect the original follow-up", department: "Client Success", summary: null, draftContent: null, rationale: null, createdAt: "" },
    ], total: state === "empty" ? 0 : 37, loading: rereading || state === "loading", error: state === "error" ? "Synthetic read refused" : null, refresh: reread,
  };
  return { items: state === "empty" || state === "error" ? [] : Array.from({ length: 10 }, (_, i) => ({ id: "test-action-" + i, title: ["Review a service proposal", "Prepare a client check-in", "Revisit a recorded deadline"][i % 3], department: ["Sales", "Client Success", "Operations"][i % 3], summary:null, draftContent:null, rationale:null, createdAt:"" })), total: state === "empty" ? 0 : 37, loading: state === "loading", error: state === "error" ? "unavailable" : null, refresh: noop };
}
export function useSoloActivityFeed() {
  const state = useHarnessParams().get("state");
  return { status: state === "loading" ? "loading" : state === "member" ? "forbidden" : state === "error" ? "unavailable" : "ready", items: state === "empty" ? [] : [
    { id: "test-record-1", title: "Business time zone saved", summary: "The owner's recorded setting was read back.", byPaige: false, byPerson: true, actorAgent: null, occurredAt: "2026-10-13T14:00:00Z" },
    { id: "test-record-2", title: "Business review read", summary: "A read only; no business action was executed.", byPaige: true, byPerson: false, actorAgent: null, occurredAt: "2026-10-13T14:00:00Z" },
  ], refresh: noop };
}
export const elapsedLabel = () => "in the synthetic record";
export function useBusinessGamePlanMissions() {
  const state = useHarnessParams().get("state");
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

// Synthetic public registry coverage only. This never registers or executes a skill.
export function useSoloSkills() {
  const state = useHarnessParams().get("state");
  const skills = state === "empty" || state === "error" || state === "loading" ? [] : [
    { slug: "weekly_business_review", n: "Weekly Business Review", d: "Review the available business evidence and its gaps. This synthetic fixture grants no runtime access.", catalogueCoverage: { version: 1, state: "limited" } },
    { slug: "cohort_analysis", n: "Cohort Analysis Read", d: "Cohort comparisons need authoritative acquisition and retention evidence. These are synthetic catalogue inputs.", catalogueCoverage: { version: 1, state: "coming_soon" } },
    { slug: "monthly_qbr_draft", n: "Monthly Business Review Draft", d: "A filed review document and later retrieval require their own verified outcome.", catalogueCoverage: { version: 1, state: "unverified" } },
  ].map(row => ({ ...row, on: true }));
  return { skills, loading: state === "loading", error: state === "error" ? "Synthetic catalogue refusal" : null, empty: state === "empty", refresh: noop };
}
