// Whether the app should offer a signed-in person the first-run setup (OnboardingFlow). It is offered
// to someone whose profile is still mostly empty: no street address and no phone. The phone is their
// primary phone contact method (`user_contact_methods`), not a profile column.

import { supabase } from "@/integrations/supabase/client";
import { readUserPrimaryAddresses } from "@/lib/userPrimaryContact";

/**
 * True only when both reads succeed and show neither an address nor a primary phone. A contact list
 * that couldn't be read is not "no phone": nothing is offered rather than a guess.
 */
export async function shouldOfferOnboarding(userId: string): Promise<boolean> {
  const [{ data: profile, error: profileError }, contact] = await Promise.all([
    supabase.from("profiles").select("full_name, address").eq("user_id", userId).maybeSingle(),
    readUserPrimaryAddresses(userId),
  ]);
  if (profileError || !profile || contact.error) return false;
  return !contact.phone && !profile.address;
}
