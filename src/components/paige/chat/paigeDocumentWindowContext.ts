import { createContext, useContext } from "react";

export interface DocumentWindowScope {
  key: string;
  actorId: string;
  tenantId: string;
}

export interface DocumentWindowTarget {
  id: string;
  title: string;
  tenantId: string;
}

export const DocumentWindowContext = createContext<((target: DocumentWindowTarget, opener: HTMLButtonElement) => void) | null>(null);
export const usePaigeDocumentWindow = () => useContext(DocumentWindowContext);
