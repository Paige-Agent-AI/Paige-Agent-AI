import { createContext, useContext } from 'react';
import type { PortalReleasedWork } from '@/lib/client-delivery-portal';

export type ClientWorkView = { actorId: string | null; loading: boolean; result: PortalReleasedWork | null };
export type ClientDeliveryPortalView = {
  work: ClientWorkView; opening: string | null; notice: string; preview: boolean;
  attachList: (actorId: string) => () => void;
  refresh: (actorId: string) => void;
  open: (actorId: string, releaseId: string, opener: HTMLElement) => Promise<void>;
};

/** Ephemeral UI projection, never an identity, permission, decision or receipt store. */
export const ClientDeliveryPortalContext = createContext<ClientDeliveryPortalView | null>(null);
export const useClientDeliveryPortal = () => useContext(ClientDeliveryPortalContext);
