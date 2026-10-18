import React, { createContext, useContext, useState } from "react";

// Read-only, neutral test transport. It cannot call a service or execute a business action.
type Fixture = { theme: string; open: boolean; tenant: string; state: string };
const options: Fixture = (window as unknown as { portalProof: Fixture }).portalProof;
const Presence = createContext({ railExpanded: options.open, expandRail: () => {}, collapseRail: () => {} });
export function ProofPresence({ children }: { children: React.ReactNode }) { const [open, setOpen] = useState(options.open); return <Presence.Provider value={{ railExpanded: open, expandRail: () => setOpen(true), collapseRail: () => setOpen(false) }}>{children}</Presence.Provider>; }
export const useAgentPresence = () => useContext(Presence);
export const useTheme = () => ({ resolvedTheme: options.theme, setTheme: () => {} });
export const DialPadTrigger = () => null;
export const PaigeAIChat = () => <p>Synthetic PAIGE content. No conversation or execution.</p>;
export const useTierFeatures = () => ({ has: () => true, loading: false });
export const useTenantContext = () => ({ activeTenantId: options.tenant, activeUserId: "test-actor-a", activeTenant: { id: options.tenant, name: "Test Service Studio", account_type: "standalone", parent_tenant_id: null }, accountContextStatus: "ready", accountContextLoading: false, refresh: async () => {} });
const proofModules = [{ key: "home", label: "Home" }, { key: "learn", label: "Learning" }, { key: "agreements", label: "Agreements" }, { key: "actions", label: "Action items" }];
export const usePlaybook = () => ({ portal: { modules: proofModules } });
// E09 Slice M: the owner-side catalog read the menu editor and dashboard preview use (same synthetic catalog).
export const usePortalCatalogInput = () => ({ data: { slug: null, authoredUsable: true, modules: proofModules }, isLoading: false, isError: false, refetch: async () => {} });
const rejectWrite = async () => { throw new Error("Source proof never executes a business action."); };
const brand = { product_name: "Test Service Studio", primary_color: "#2f463b", accent_color: "#ddb578", font: null, tagline: "Space to move your work forward.", logo_url: null };
export const useBrandKit = () => ({ state: { own: {}, effective: brand, tenantName: "Test Service Studio" }, isLoading: false, isError: false, saving: false, refetch: async () => {}, save: rejectWrite, setLogo: rejectWrite, clearLogo: rejectWrite });
export const usePortalConfig = () => ({ config: { welcome: { headline: "Your next step starts here.", subhead: "Your work, conversations and commitments, together." } }, isLoading: false, isError: false, saving: false, refetch: async () => {}, save: rejectWrite });
export const usePortalInvitations = () => ({ data: [{ id: "invite-a", contact_id: "test-contact-2", email: "second@example.test", created_at: "2026-10-14T12:00:00Z", expires_at: "2099-10-30T12:00:00Z", last_used_at: null, revoked_at: null }], isLoading: false, isError: options.state === "error", refetch: async () => {}, invalidate: async () => {} });
export const useRailEvents = () => ({ historyStatus: options.state === "error" ? "unavailable" : "ready", events: options.state === "empty" || options.state === "error" ? [] : [
  { id: "event-a", audience: "both", visibility: "client_visible", title: "A shared document was added", occurred_at: "2026-10-15T09:20:00Z" },
  { id: "event-b", audience: "client", visibility: "client_visible", title: "A deliverable was approved", occurred_at: "2026-10-14T16:40:00Z" },
  { id: "event-c", audience: "both", visibility: "client_visible", title: "A session was booked", occurred_at: "2026-10-14T14:10:00Z" },
] });
export const useTenantRelationshipsData = () => ({ people: options.state === "empty" ? [] : ["Test Client", "Second Client", "Long Client Name for Responsive Verification", "Fourth Client"].map((name, index) => ({ id: `test-contact-${index + 1}`, firstName: name, lastName: "", name, recordType: "person", email: `${index === 1 ? "second" : "client" + index}@example.test`, phone: null, company: ["Test Studio", "Independent Client", "A longer company name", "Test Practice"][index], contactMethods: [{ kind: "email", value: `client${index}@example.test` }], status: "active", doNotContact: index === 3, sharedContextConsent: false, linkedUserId: index === 2 ? "test-linked-user" : null, primaryOffer: index === 2 ? "Recorded service" : null, relationship: "client", owner: "Unassigned", tags: [] })), peopleLoading: options.state === "loading", peopleError: options.state === "error", retryPeople: async () => {}, peopleAvailable: true, ...{ portalConfig: usePortalConfig().config, portalLoading: false, portalError: false, retryPortal: async () => {} } });
export const supabase = { auth: { getUser: async () => ({ data: { user: { id: "test-actor-a" } }, error: null }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }) }, rpc: async (name: string) => name === "can_manage_tenant_brand" ? { data: true, error: null } : rejectWrite(), from: rejectWrite, functions: { invoke: rejectWrite } };
export const ClientStanding = () => <p>Existing client standing surface</p>;
export const PeopleContactEditor = () => null;
export const TenantCanonicalCalendarWorkspace = () => null;
export const ContactPortalPanel = () => null;
export default function UnmountedOwner() { return null; }
