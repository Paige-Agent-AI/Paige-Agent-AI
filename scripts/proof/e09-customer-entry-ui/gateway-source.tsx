import {createRoot} from "react-dom/client";
import {MemoryRouter,Route,Routes} from "react-router-dom";
import {HelmetProvider} from "react-helmet-async";
import PortalGateway from "../../../src/pages/PortalGateway";
// Destination is an explicit test double; this is gateway proof, not portal QA.
createRoot(document.getElementById("root")!).render(<HelmetProvider><MemoryRouter initialEntries={["/portal/test-service"]}><Routes><Route path="/portal/:tenantSlug" element={<PortalGateway/>}/><Route path="/app" element={<p>Verified gateway test destination</p>}/></Routes></MemoryRouter></HelmetProvider>);
