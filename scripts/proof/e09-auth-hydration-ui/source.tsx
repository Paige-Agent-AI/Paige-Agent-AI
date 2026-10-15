import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import AppShell from "@/pages/AppShell";

createRoot(document.getElementById("root")!).render(<MemoryRouter initialEntries={["/app"]}><Routes>
  <Route path="/app/*" element={<AppShell />} />
  <Route path="/auth" element={<p className="p-6" role="status">Sign-in destination — route test double</p>} />
  <Route path="/admin" element={<p className="p-6" role="status">Staff destination — route test double</p>} />
</Routes></MemoryRouter>);
