import React from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { TenantCommandCenterShell } from "../../../src/components/tenant-shell/TenantCommandCenterShell";
import { TenantRelationshipsClientsWorkspace } from "../../../src/components/tenant-relationships/TenantRelationshipsClientsWorkspace";
import { ProofPresence, useAgentPresence } from "./adapter";

function Screen() {
  const presence = useAgentPresence();
  return <TenantCommandCenterShell accountName="Test Service Studio" accountType="standalone" userRole="admin" onSignOut={() => {}} brandHomeHref="/solo/1234567/command-center" soloPaigeWorkspace={<div style={{ padding: 22 }}>Read-only source proof. PAIGE content is a synthetic placeholder.</div>}>
    <TenantRelationshipsClientsWorkspace routeTier="solo" openPaige={presence.expandRail} />
  </TenantCommandCenterShell>;
}
createRoot(document.getElementById("root")!).render(<ProofPresence><MemoryRouter initialEntries={["/solo/1234567/clients/portal"]}><Routes><Route path="/solo/:account/*" element={<Screen />} /></Routes></MemoryRouter></ProofPresence>);
