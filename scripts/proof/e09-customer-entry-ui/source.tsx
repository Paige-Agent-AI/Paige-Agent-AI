import {createRoot} from "react-dom/client";
import {MemoryRouter,Route,Routes} from "react-router-dom";
import {HelmetProvider} from "react-helmet-async";
import JoinWorkspace from "../../../src/pages/JoinWorkspace";
createRoot(document.getElementById("root")!).render(<HelmetProvider><MemoryRouter initialEntries={["/join/synthetic-entry-token"]}><Routes><Route path="/join/:token" element={<JoinWorkspace/>}/></Routes></MemoryRouter></HelmetProvider>);
