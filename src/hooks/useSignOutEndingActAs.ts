import { useCallback } from "react";
import { toast } from "sonner";
import { useTenantContext } from "@/hooks/useTenantContext";
import { performSignOut } from "@/lib/auth/signOut";

type SignOutOptions = Parameters<typeof performSignOut>[0];

/**
 * A chosen sign-out from a tenant shell. Signing out clears this browser, not the server, so an
 * operator acting as the tenant would leave the act-as open with no exit receipt. The act-as is
 * ended through the audited exit first; if it will not end, or Paige cannot tell whether it is
 * open, the person stays signed in and is told why. A member signs out exactly as before.
 *
 * Involuntary sign-outs (an expired session) cannot reach the server and do not come through here.
 */
export function useSignOutEndingActAs(): (options?: SignOutOptions) => Promise<boolean> {
  const { endActAsBeforeSignOut } = useTenantContext();
  return useCallback(async (options?: SignOutOptions) => {
    const outcome = await endActAsBeforeSignOut();
    if (outcome === "refused") {
      toast.error("Couldn't end your act-as in this tenant, so you're still signed in. Try again.");
      return false;
    }
    if (outcome === "unknown") {
      toast.error("Paige couldn't confirm whether your act-as is still open, so you're still signed in. Try again.");
      return false;
    }
    await performSignOut(options);
    return true;
  }, [endActAsBeforeSignOut]);
}
