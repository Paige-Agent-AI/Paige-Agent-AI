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

export interface DocumentWindowController {
  ready: boolean;
  open(target: DocumentWindowTarget, opener: HTMLButtonElement): void;
}

export const DocumentWindowContext = createContext<DocumentWindowController | null>(null);
export const usePaigeDocumentWindow = () => useContext(DocumentWindowContext);
