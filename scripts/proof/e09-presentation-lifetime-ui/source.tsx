import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import type { User } from "@supabase/supabase-js";
import { AppNav } from "@/components/app/AppNav";

const user = { id: "test-actor-a", email: "client@example.test" } as User;
createRoot(document.getElementById("root")!).render(<MemoryRouter initialEntries={["/app"]}><AppNav user={user} /></MemoryRouter>);
