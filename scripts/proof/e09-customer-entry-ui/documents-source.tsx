import {createRoot} from "react-dom/client";
import {Link,MemoryRouter,Route,Routes} from "react-router-dom";
import ClientDocuments from "../../../src/pages/app/ClientDocuments";
// Actual leaf/hook/primitives/exit guards. This capsule is not the complete shell.
createRoot(document.getElementById("root")!).render(<MemoryRouter initialEntries={["/app/documents"]}>
 <Routes><Route path="/app/documents" element={<main className="p-4 sm:p-8"><Link className="mb-5 inline-flex min-h-[44px] items-center" to="/app">Back to portal</Link><ClientDocuments/></main>}/>
 <Route path="/app" element={<p>Existing portal test destination</p>}/></Routes>
</MemoryRouter>);
