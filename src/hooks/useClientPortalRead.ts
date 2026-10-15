import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/** Per-mount lifetime for native customer reads; no cached identity or authority. */
export function useClientPortalRead<T>(readValue: () => Promise<T>, empty: T): { data: T; loading: boolean } {
  const [state, setState] = useState({ data: empty, loading: true });

  useEffect(() => {
    let cancelled = false;
    let sequence = 0;
    let actor: string | null = null;
    let signedOut = false;
    const clear = (loading: boolean) => setState({ data: empty, loading });
    const read = async (expectedActor?: string) => {
      const request = ++sequence;
      const current = () => !cancelled && request === sequence && !signedOut;
      clear(true);
      try {
        const { data: { user }, error } = await supabase.auth.getUser();
        if (!current() || error || !user || (expectedActor && user.id !== expectedActor)) return;
        actor = user.id;
        const value = await readValue();
        if (current()) setState({ data: value, loading: false });
      } catch {
        if (current()) clear(false);
      } finally {
        if (current()) setState(previous => ({ ...previous, loading: false }));
      }
    };
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return;
      const next = session?.user.id ?? null;
      if (event === "INITIAL_SESSION" && next === actor) return;
      sequence += 1;
      actor = next;
      signedOut = event === "SIGNED_OUT";
      clear(!!next && !signedOut);
      if (!next || signedOut) return;
      const scheduled = sequence;
      // Do not call SDK Auth/RPC methods while its Auth callback holds the lock.
      queueMicrotask(() => {
        if (!cancelled && sequence === scheduled) void read(next);
      });
    });
    const onFocus = () => { if (!cancelled && !signedOut) void read(); };
    window.addEventListener("focus", onFocus);
    void read();
    return () => {
      cancelled = true;
      sequence += 1;
      subscription.unsubscribe();
      window.removeEventListener("focus", onFocus);
    };
  }, [readValue, empty]);

  return state;
}
