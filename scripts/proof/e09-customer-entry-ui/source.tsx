import {createRoot} from "react-dom/client";
import {MemoryRouter,Route,Routes} from "react-router-dom";
import {HelmetProvider} from "react-helmet-async";
import JoinWorkspace from "../../../src/pages/JoinWorkspace";
createRoot(document.getElementById("root")!).render(<HelmetProvider><MemoryRouter initialEntries={["/join/synthetic-entry-token"]}><Routes><Route path="/join/:token" element={<JoinWorkspace/>}/><Route path="/app" element={<main><h1>Verified portal test destination</h1><p>Offline route target only. Actual customer shell is not represented in this capsule.</p></main>}/></Routes></MemoryRouter></HelmetProvider>);
