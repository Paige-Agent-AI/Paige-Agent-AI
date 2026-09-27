import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";

type DashboardMode = "internal" | "client";

interface DashboardModeContextValue {
  mode: DashboardMode;
  setMode: (mode: DashboardMode) => void;
  isAdmin: boolean;
  loading: boolean;
}

const DashboardModeContext = createContext<DashboardModeContextValue>({
  mode: "client",
  setMode: () => {},
  isAdmin: false,
  loading: true,
});

export const useDashboardMode = () => useContext(DashboardModeContext);

export function DashboardModeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<DashboardMode>("client");
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    initMode();
  }, []);

  const initMode = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }

      // Fetch roles and profile mode preference in parallel
      const [rolesRes, profileRes] = await Promise.all([
        supabase.from("user_roles").select("role").eq("user_id", user.id),
        supabase.from("profiles").select("dashboard_mode").eq("user_id", user.id).maybeSingle(),
      ]);

      const roles: string[] = (rolesRes.data || []).map((r) => r.role);
      const admin = roles.includes("admin");

      setIsAdmin(admin);

      // Determine mode: use saved preference, or default to 'internal' for admins
      const savedMode = profileRes.data?.dashboard_mode as DashboardMode | undefined;
      if (savedMode && (savedMode === "internal" || savedMode === "client")) {
        setModeState(savedMode);
      } else if (admin) {
        setModeState("internal");
        // Persist the default
        await supabase.from("profiles").update({ dashboard_mode: "internal" }).eq("user_id", user.id);
      }
    } catch (err) {
      console.error("Error initializing dashboard mode:", err);
    } finally {
      setLoading(false);
    }
  };

  const setMode = async (newMode: DashboardMode) => {
    setModeState(newMode);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase.from("profiles").update({ dashboard_mode: newMode }).eq("user_id", user.id);
      }
    } catch (err) {
      console.error("Error saving dashboard mode:", err);
    }
  };

  return (
    <DashboardModeContext.Provider value={{ mode, setMode, isAdmin, loading }}>
      {children}
    </DashboardModeContext.Provider>
  );
}
