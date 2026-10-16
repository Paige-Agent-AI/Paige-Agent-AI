import React from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TenantCommandCenterShell } from "../../../src/components/tenant-shell/TenantCommandCenterShell";
import { TenantRelationshipsClientsWorkspace } from "../../../src/components/tenant-relationships/TenantRelationshipsClientsWorkspace";
import { ProofPresence, useAgentPresence } from "./adapter";
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
function Screen() {
  const presence = useAgentPresence();
  return <TenantCommandCenterShell accountName="Test Service Studio" accountType="standalone" userRole="admin" onSignOut={() => {}} brandHomeHref="/solo/1234567/command-center" soloPaigeWorkspace={<p style={{ padding: 22 }}>Synthetic PAIGE presence. No Chat execution.</p>}>
    <TenantRelationshipsClientsWorkspace routeTier="solo" openPaige={presence.expandRail} />
  </TenantCommandCenterShell>;
}
createRoot(document.getElementById("root")!).render(<QueryClientProvider client={client}><ProofPresence><MemoryRouter initialEntries={["/solo/1234567/clients/portal"]}><Routes><Route path="/solo/:account/*" element={<Screen />} /></Routes></MemoryRouter></ProofPresence></QueryClientProvider>);
