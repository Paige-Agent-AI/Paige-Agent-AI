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
 * This is presentation only. It reads the frame the shell already resolved; it grants nothing.
 */
type FrameState = ReturnType<typeof useClientPortalFrame>;
export type CustomerIdentity = {
  /** The name the customer reads for their assistant. Never PAIGE. */
  agentName: string;
  /** The business the customer belongs to, or null until the frame says. */
  businessName: string | null;
  /** The frame read, for the home that also needs its portal config. */
  frame: FrameState["frame"];
  phase: FrameState["phase"];
};

const CustomerIdentityContext = createContext<CustomerIdentity | null>(null);

export function customerIdentityFrom(state: Pick<FrameState, "frame" | "phase">): CustomerIdentity {
  const frame = state.frame;
  return {
    agentName: customerAgentName(frame?.config.assistant?.display_name),
    businessName: frame?.brand.tenant_name?.trim() || null,
    frame,
    phase: state.phase,
  };
}

export function CustomerIdentityProvider({ state, children }: { state: Pick<FrameState, "frame" | "phase">; children: ReactNode }) {
  const value = useMemo(() => customerIdentityFrom(state), [state.frame, state.phase]); // eslint-disable-line react-hooks/exhaustive-deps
  return <CustomerIdentityContext.Provider value={value}>{children}</CustomerIdentityContext.Provider>;
}

/**
 * The customer's identity. Outside the /app shell (a test, a staff preview that mounts a customer
 * component on its own) it is the neutral default: Cura, and no business name. Never PAIGE.
 */
export function useCustomerIdentity(): CustomerIdentity {
  return useContext(CustomerIdentityContext) ?? NEUTRAL;
}

const NEUTRAL: CustomerIdentity = { agentName: customerAgentName(undefined), businessName: null, frame: null, phase: "loading" };
