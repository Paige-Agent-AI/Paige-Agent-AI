import { createRoot } from "react-dom/client";
import { PortalConfigurationGate } from "../../../src/components/tenant-relationships/PortalConfigurationGate";
import { ProofTenant } from "./adapter";

createRoot(document.getElementById("root")!).render(<>
  <p className="proof-note">Synthetic source-component verification. No account, session or business operation.</p>
  {["checking", "denied", "error", "allowed"].map((state) => <article key={state} data-proof-state={state}>
    <p className="proof-note">{state}</p>
    <ProofTenant tenantId={`test-tenant-${state}`}>
      <PortalConfigurationGate tenantId={`test-tenant-${state}`}><p data-editor-sentinel>Authorized editor mount — synthetic sentinel only.</p></PortalConfigurationGate>
    </ProofTenant>
  </article>)}
</>);
