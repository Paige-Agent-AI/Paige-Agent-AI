// Onboarding gate — /onboarding
//
// Where a signed-in user with no workspace yet stands one up. This is the
// landing target `resolveLandingRoute` hands role-less, client-less, tenant-less
// users (e.g. accounts created before the tenant front door existed). It reuses
// the same WorkspaceProvisioner the signup flow uses, so there is exactly one
// path from "account" to "owns a tenant."
//
// Self-forwarding: if the user already has a workspace (or is platform staff),
// there's nothing to onboard — send them straight to /admin. Unauthenticated
// visitors are bounced to the front door.
//
// Cancel (Task #187): a user who signed in but hasn't provisioned yet is only a
// pre-signup shell. They can remove it here (signup-cancel edge function) so an
// abandoned account never gets stuck in the database.
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { PageHead } from "@/components/seo/PageHead";
import { WorkspaceProvisioner } from "@/components/onboarding/WorkspaceProvisioner";
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Loader2 } from "lucide-react";
import { isSoloBetaPlan } from "@/lib/auth/soloBetaAcquisition";
import { resolveLandingRoute } from "@/lib/auth/resolveLandingRoute";
import { fetchOperatorStanding, isOperator } from "@/lib/auth/operatorStanding";

export default function Onboarding() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState<"checking" | "ready">("checking");
  const [cancelling, setCancelling] = useState(false);

  // A plan chosen on /pricing rides in as ?plan=solo&billing=monthly. The page
  // fails closed to pricing without that fixed paid offer; there is no public
  // planless, free-provisioning, or alternate-account path.
  const planSlug = searchParams.get("plan");

  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data: sess } = await supabase.auth.getSession();
      const uid = sess.session?.user?.id;
      if (!uid) {
        navigate("/signup", { replace: true });
        return;
      }

      // A resumed tab must not expose identity deletion once Checkout may have
      // begun. The server is the authority; all post-checkout and uncertain
      // states recover through Welcome instead of the pre-checkout shell.
      const { data: enrollmentData, error: enrollmentError } = await supabase.functions.invoke(
        "solo-beta-enrollment-status",
      );
      const enrollmentState = (enrollmentData as { state?: string } | null)?.state;
      if (enrollmentError || !enrollmentState) {
        navigate("/welcome?checkout=success", { replace: true });
        return;
      }
      if (!["needs_intake", "needs_checkout"].includes(enrollmentState)) {
        navigate("/welcome?checkout=success", { replace: true });
        return;
      }

      // Already a tenant operator (staff, owner, or member) or a REAL linked
      // client? Then there's nothing to provision — forward to their real home.
      // NOTE: handle_new_user autocreates a self-linked clients row (source
      // 'signup') for EVERY signup, so "has a clients row" does NOT mean "is a
      // real client" — we must exclude the autocreated signup contact, or a
      // brand-new owner would be shunted into /app and never reach the
      // provisioner (and loop against RequireCompleteSignup). A genuine invited
      // client's row has source <> 'signup'.
      const [standing, { data: owned }, { data: member }, { data: clientRows }, agencyRes] = await Promise.all([
        // The one server answer to operator standing. A failed read (null) is not "operator".
        fetchOperatorStanding(),
        supabase.from("tenants").select("id").eq("owner_user_id", uid).limit(1).maybeSingle(),
        supabase.from("tenant_members").select("tenant_id").eq("user_id", uid).limit(1).maybeSingle(),
        supabase.from("clients").select("id, source").eq("linked_user_id", uid).limit(10),
        // Agency-team invitees have no tenant_members row — they'd otherwise
        // fall through and be shown WorkspaceProvisioner. Forward them to /agency.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase.from("agency_team_members" as any) as any)
          .select("agency_tenant_id")
          .eq("user_id", uid)
          .eq("status", "active")
          .limit(1)
          .maybeSingle(),
      ]);
      if (!mounted) return;
      if (isOperator(standing) || owned?.id || member?.tenant_id) {
        window.location.assign(await resolveLandingRoute(uid));
        return;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((agencyRes as any)?.data?.agency_tenant_id) {
        window.location.assign(await resolveLandingRoute(uid));
        return;
      }
      const realClient = (clientRows ?? []).find((c) => (c.source ?? "") !== "signup");
      if (realClient) {
        window.location.assign(await resolveLandingRoute(uid));
        return;
      }
      if (!isSoloBetaPlan(planSlug)) {
        navigate("/pricing", { replace: true });
        return;
      }
      setStatus("ready");
    })();
    return () => { mounted = false; };
  }, [navigate, planSlug]);

  const cancelSignup = async () => {
    setCancelling(true);
    try {
      const { data, error } = await supabase.functions.invoke("signup-cancel");
      // The edge function returns a structured error in the body on refusal.
      const body = (data ?? {}) as { success?: boolean; error?: string };
      if (error || body.error || !body.success) {
        throw new Error(body.error || error?.message || "Could not cancel your sign-up.");
      }
      // The auth user is gone; clear the local session and return to the front door.
      await supabase.auth.signOut();
      toast({ title: "Sign-up cancelled", description: "Your sign-up was removed. You can start over anytime." });
      window.location.assign("/");
    } catch (e) {
      toast({
        title: "Couldn't cancel",
        description: e instanceof Error ? e.message : "Please try again.",
        variant: "destructive",
      });
      setCancelling(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <PageHead
        title="Set up your workspace"
        description="Stand up your own Paige workspace — pick how you'll run it and name your business."
        path="/onboarding"
      />
      <div className="max-w-2xl mx-auto px-6 py-12">
        {status === "checking" ? (
          <div className="flex items-center gap-3 text-muted-foreground py-20 justify-center">
            <Loader2 className="h-5 w-5 animate-spin" /> Getting things ready…
          </div>
        ) : (
          <>
            <header className="mb-8">
              <h1 className="font-[Playfair_Display] text-4xl md:text-5xl tracking-tight">
                Let's set up your workspace.
              </h1>
              <p className="mt-3 text-muted-foreground">
                Tell us about your business, review the Solo agreement, then start your 30-day trial. After the trial, Paige Solo renews at $74.50/month unless you cancel before your first paid renewal.
              </p>
            </header>
            <WorkspaceProvisioner
              planSlug={planSlug}
            />

            <div className="mt-8 pt-6 border-t border-border flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                Not ready yet? Before Checkout starts, you can remove this identity and saved setup.
              </p>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <button
                    type="button"
                    disabled={cancelling}
                    className="text-sm text-muted-foreground hover:text-destructive underline underline-offset-2 disabled:opacity-50 shrink-0"
                  >
                    {cancelling ? "Cancelling…" : "Cancel & remove my sign-up"}
                  </button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Remove your sign-up?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This deletes the identity and setup you just started, then signs you out. This
                      option is available only before Checkout begins; you can sign up again anytime.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel disabled={cancelling}>Keep my sign-up</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={(e) => { e.preventDefault(); void cancelSignup(); }}
                      disabled={cancelling}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                      {cancelling ? "Removing…" : "Yes, remove it"}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
