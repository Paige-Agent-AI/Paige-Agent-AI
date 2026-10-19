import { createContext, useContext, useState, type ReactNode } from "react";

const Presence = createContext({ railExpanded: false, expandRail: () => {}, collapseRail: () => {} });
export function ProofPresence({ children }: { children: ReactNode }) {
  const [railExpanded, setExpanded] = useState(false);
  return <Presence.Provider value={{ railExpanded, expandRail: () => setExpanded(true), collapseRail: () => setExpanded(false) }}>{children}</Presence.Provider>;
}
export const useAgentPresence = () => useContext(Presence);
export const useScopedUserId = () => "test-actor";
export const DialPadTrigger = () => null;
export function PaigeAIChat(): never { throw new Error("Provider-backed Chat is outside this isolated render proof"); }
