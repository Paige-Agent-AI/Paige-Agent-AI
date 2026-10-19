import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { readClientPortalSelfProfile } from "@/lib/client-portal-self-profile";

/**
 * useMyContactId — resolve the signed-in CLIENT's own `clients.id` (their
 * contact_id) from `auth.uid()`.
 *
 * The canonical reader resolves an active, unmerged relationship from verified
 * Auth identity. Never search raw CRM, match email, or borrow a preview identity.
 * The resulting ID selects an existing Rail; it does not grant Rail authority.
 *
 * Kept deliberately small and read-only so any client surface that needs
 * "my own contact_id" (the activity rail, a portal widget, …) can reuse it
 * instead of re-querying `clients` inline. Auth/scope changes retire old reads.
 *
 * @param enabled  Pass false when the caller already has the contact_id (e.g. a
 *                 parent that loaded it via `useMyActions`) to skip the query.
 */
export function useMyContactId(enabled = true): { contactId: string | null; loading: boolean } {
  const [contactId, setContactId] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(enabled);

  useEffect(() => {
    if (!enabled) {
      setContactId(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    let sequence = 0;
    let actor: string | null = null;
    const read = async (expectedActor?: string) => {
      const request = ++sequence;
      const current = () => !cancelled && request === sequence;
      setContactId(null);
      setLoading(true);
      try {
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (!current()) return;
        if (authError || !user || (expectedActor && user.id !== expectedActor)) return;
        actor = user.id;
        const { data, error } = await supabase.rpc("client_portal_self_profile");
        if (!current() || error) return;
        const profile = readClientPortalSelfProfile(data, user.id);
        setContactId(profile?.id ?? null);
      } catch {
        if (current()) setContactId(null);
      } finally {
        if (current()) setLoading(false);
      }
    };
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return;
      if (event === "SIGNED_OUT") {
        sequence += 1;
        actor = null;
        setContactId(null);
        setLoading(false);
        return;
      }
      const next = session?.user.id ?? null;
      if (event === "INITIAL_SESSION" && next === actor) return;
      sequence += 1;
      const scheduled = sequence;
      actor = next;
      setContactId(null);
      setLoading(true);
      // Auth callbacks hold the SDK lock; verify outside the callback.
      queueMicrotask(() => {
        if (!cancelled && scheduled === sequence) void read(next ?? undefined);
      });
    });
    const onFocus = () => { if (!cancelled) void read(); };
    window.addEventListener("focus", onFocus);
    void read();
    return () => {
      cancelled = true;
      sequence += 1;
      subscription.unsubscribe();
      window.removeEventListener("focus", onFocus);
    };
  }, [enabled]);

  // A caller with an explicit contact must never render the old self-scope for
  // the commit before passive effect cleanup runs.
  return enabled ? { contactId, loading } : { contactId: null, loading: false };
}
