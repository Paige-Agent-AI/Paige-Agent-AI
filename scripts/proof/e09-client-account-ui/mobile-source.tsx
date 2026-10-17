import {createRoot} from "react-dom/client";
import {MemoryRouter,Route,Routes} from "react-router-dom";
import AppShell from "@/pages/AppShell";
createRoot(document.getElementById("root")!).render(<MemoryRouter initialEntries={["/app"]}>
  <Routes><Route path="/app" element={<AppShell/>}><Route path="*" element={<p>Domain destination test double</p>}/></Route></Routes>
</MemoryRouter>);
