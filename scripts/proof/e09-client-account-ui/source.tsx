import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import AppShell from "@/pages/AppShell";
import { ProfileSettings } from "@/components/dashboard/ProfileSettings";

createRoot(document.getElementById("root")!).render(<MemoryRouter initialEntries={["/app/settings?view=client-account"]}><Routes>
  <Route path="/app" element={<AppShell />}><Route path="settings" element={<ProfileSettings />} /></Route>
  <Route path="/auth" element={<p role="status">Sign-in route test double</p>} />
  <Route path="/choose-account" element={<p role="status">Workspace chooser route test double</p>} />
</Routes></MemoryRouter>);
