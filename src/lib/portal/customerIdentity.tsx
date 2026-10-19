import { createContext, useContext, useMemo, type ReactNode } from "react";
import { customerAgentName } from "../../../supabase/functions/_shared/client-portal-identity";
import type { useClientPortalFrame } from "@/hooks/useClientPortalFrame";

/**
 * Who a customer is talking to, read once by the /app shell and shared with every customer surface.
 *
 * Owner ruling (2026-10-19): the customer's agent is Cura, assigned under PAIGE. PAIGE is the owner's
 * COO and never appears in the Customer Portal. The agent's name comes from the business's own
 * assistant setting through customerAgentName, which refuses PAIGE and falls back to Cura. When a
 * sentence is about the business rather than the assistant, it names the business.
 *
 * The one exception is a viewer who is not a customer here but is STAFF (an admin previewing /app, staff
 * viewing as a client, a platform operator on ?stay=1): the chat beside them is the owner's own
 * assistant, so the page names that assistant too (viewer "staff", agentName = the owner's Playbook
 * persona). Anyone else with no customer frame is "inactive": their access is not active.
 *
 * This is presentation only. It reads the frame the shell already resolved; it grants nothing.
 */
type FrameState = ReturnType<typeof useClientPortalFrame>;
/** customer: a live customer frame. staff: no frame, staff standing. inactive: no frame, not staff. unknown: still checking. */
export type PortalViewer = "customer" | "staff" | "inactive" | "unknown";
export type CustomerIdentity = {
  /** The name the reader sees for their assistant. Never PAIGE for a customer. */
  agentName: string;
  /** The business the customer belongs to, or null until the frame says. */
  businessName: string | null;
  /** The customer's own name on their record at this business (person, else entity), or null. */
  customerName: string | null;
  /** The frame read, for the home that also needs its portal config. */
  frame: FrameState["frame"];
  phase: FrameState["phase"];
  viewer: PortalViewer;
};

export type CustomerIdentityState = Pick<FrameState, "frame" | "phase"> & {
  /** Staff standing when the frame is "not-client": true, false, or null while unknown. */
  staff?: boolean | null;
  /** The owner's own assistant name, used only for a staff viewer. */
  staffAssistantName?: string | null;
};

const CustomerIdentityContext = createContext<CustomerIdentity | null>(null);

export function customerIdentityFrom(state: CustomerIdentityState): CustomerIdentity {
  const frame = state.frame;
  const viewer: PortalViewer = frame ? "customer"
    : state.phase !== "not-client" ? "unknown"
      : state.staff === true ? "staff" : state.staff === false ? "inactive" : "unknown";
  const staffName = state.staffAssistantName?.trim();
  return {
    agentName: viewer === "staff" && staffName ? staffName : customerAgentName(frame?.config.assistant?.display_name),
    businessName: frame?.brand.tenant_name?.trim() || null,
    customerName: personName(frame),
    frame,
    phase: state.phase,
    viewer,
  };
}

function personName(frame: FrameState["frame"]): string | null {
  const p = frame?.profile;
  if (!p) return null;
  const person = [p.first_name, p.last_name].map(v => v?.trim()).filter(Boolean).join(" ");
  return person || p.entity_name?.trim() || null;
}

export function CustomerIdentityProvider({ state, children }: { state: CustomerIdentityState; children: ReactNode }) {
  const value = useMemo(() => customerIdentityFrom(state), [state.frame, state.phase, state.staff, state.staffAssistantName]); // eslint-disable-line react-hooks/exhaustive-deps
  return <CustomerIdentityContext.Provider value={value}>{children}</CustomerIdentityContext.Provider>;
}

/**
 * The customer's identity. Outside the /app shell (a test, a staff preview that mounts a customer
 * component on its own) it is the neutral default: Cura, and no business name. Never PAIGE.
 */
export function useCustomerIdentity(): CustomerIdentity {
  return useContext(CustomerIdentityContext) ?? NEUTRAL;
}

/**
 * The assistant's name for a component that both the Customer Portal and an owner surface mount (the
 * funding screens, Planning). Inside the /app shell it is the customer's agent (or, for a staff viewer,
 * the owner's assistant); outside it — an owner or staff surface — it is the owner's own assistant.
 */
export function useAssistantName(): string {
  const identity = useContext(CustomerIdentityContext);
  return identity ? identity.agentName : OWNER_ASSISTANT;
}

// customer-identity-exempt: owner surfaces only — returned only outside CustomerIdentityProvider, which wraps every /app route
const OWNER_ASSISTANT = "Paige";
const NEUTRAL: CustomerIdentity = { agentName: customerAgentName(undefined), businessName: null, customerName: null, frame: null, phase: "loading", viewer: "unknown" };
