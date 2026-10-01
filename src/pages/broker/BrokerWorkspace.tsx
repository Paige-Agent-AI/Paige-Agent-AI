// Broker workspace shell — gates access to /broker/app/*.
// Loads either the broker_profiles row OR a broker_team_members row via
// BrokerContextProvider. Redirects users without broker access to /broker
// (apply page) or /auth (signed out). Renders sidebar + outlet.

import { useEffect, useState } from "react";
import { Navigate, Outlet, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { BrokerSidebar } from "@/components/broker/BrokerSidebar";
import {
  BrokerContextProvider,
  useBrokerContext,
} from "@/hooks/useBrokerContext";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, LogOut } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const BrokerWorkspaceInner = () => {
  const {
    loading,
    activeBrokerId,
    isTeamMember,
    teamMemberName,
    parentBrokerProfile,
  } = useBrokerContext();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [isStaff, setIsStaff] = useState(false);

  // Bounce signed-out users to /auth and detect the admin role for the "Back to Admin" button.
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_evt, sess) => {
      if (!sess) navigate("/auth", { replace: true });
    });
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) {
        navigate("/auth", { replace: true });
        return;
      }
      const { data: roles } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", session.user.id);
      const roleList = (roles || []).map((r: { role: string }) => r.role);
      setIsStaff(roleList.includes("admin"));
    });
    return () => subscription.unsubscribe();
  }, [navigate]);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate("/", { replace: true });
  };

  if (loading) {
    return (
      <div className="min-h-screen p-8 space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  // Signed in but no broker profile or team membership → bounce to apply page.
  if (!activeBrokerId || !parentBrokerProfile) {
    toast({
      title: "Broker account required",
      description: "Apply for the Broker Workspace to access this area.",
    });
    return <Navigate to="/broker" replace />;
  }

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background">
        <BrokerSidebar />
        <div className="flex-1 flex flex-col">
          <header className="h-14 flex items-center justify-between border-b bg-card px-4">
            <div className="flex items-center gap-3">
              <SidebarTrigger />
              <div className="flex flex-col leading-tight">
                <span className="text-sm font-semibold">
                  {parentBrokerProfile.business_name}
                  {isTeamMember && (
                    <span className="text-muted-foreground font-normal"> workspace</span>
                  )}
                </span>
                <span className="text-xs text-muted-foreground">
                  {parentBrokerProfile.referral_code
                    ? `Code: ${parentBrokerProfile.referral_code}`
                    : "Pending setup"}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {isTeamMember && teamMemberName && (
                <div className="flex items-center gap-2 mr-2">
                  <span className="text-sm font-medium">{teamMemberName}</span>
                  <Badge className="bg-primary/10 text-primary border-primary/20 hover:bg-primary/15">
                    Team
                  </Badge>
                </div>
              )}
              {isStaff && (
                <Button variant="outline" size="sm" onClick={() => navigate("/choose-account")}>
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Choose workspace
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={handleSignOut}>
                <LogOut className="h-4 w-4 mr-2" />
                Sign out
              </Button>
            </div>
          </header>
          <main className="flex-1 p-6 overflow-auto">
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
};

const BrokerWorkspace = () => (
  <BrokerContextProvider>
    <BrokerWorkspaceInner />
  </BrokerContextProvider>
);

export default BrokerWorkspace;
