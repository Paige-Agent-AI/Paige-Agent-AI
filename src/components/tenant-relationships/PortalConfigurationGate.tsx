import { useEffect, useRef, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTenantContext } from "@/hooks/useTenantContext";

type Verdict = "checking" | "allowed" | "denied" | "error";
type Access = { scope: string | null; verdict: Verdict };

/** Presentation gate for the existing brand/config writers, never a server grant. */
export function PortalConfigurationGate({ tenantId, children }: { tenantId: string; children: ReactNode }) {
  const { activeTenantId, activeUserId, accountContextLoading, accountContextStatus } = useTenantContext();
  const context = !accountContextLoading && accountContextStatus === "ready" && activeUserId && activeTenantId === tenantId
    ? `${activeUserId}:${tenantId}` : null;
  const boundary = useRef({ context, generation: 0 });
  if (boundary.current.context !== context) boundary.current = { context, generation: boundary.current.generation + 1 };
  const scope = context ? `${context}:${boundary.current.generation}` : null;
  const [access, setAccess] = useState<Access>({ scope: null, verdict: "checking" });
  const [attempt, setAttempt] = useState(0);
  const focusAfterRetry = useRef<string | null>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!scope || !activeUserId) return;
    let cancelled = false;
    let sequence = 0;
    let retired = false;
    const read = async () => {
      const request = ++sequence;
      const current = () => !cancelled && request === sequence;
      setAccess({ scope, verdict: "checking" });
      try {
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (!current()) return;
        if (authError) { setAccess({ scope, verdict: "error" }); return; }
        if (!user || user.id !== activeUserId) { setAccess({ scope, verdict: "denied" }); return; }
        retired = false;
        const { data, error } = await supabase.rpc("can_manage_tenant_brand", { _tenant_id: tenantId });
        if (!current()) return;
        setAccess({ scope, verdict: error || typeof data !== "boolean" ? "error" : data ? "allowed" : "denied" });
      } catch {
        if (current()) setAccess({ scope, verdict: "error" });
      }
    };
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return;
      if (event === "SIGNED_OUT") {
        focusAfterRetry.current = null;
        retired = true;
        sequence += 1;
        setAccess({ scope, verdict: "denied" });
        return;
      }
      // Routine same-actor refreshes must not remount an editor with unsaved work.
      if (!retired && session?.user.id === activeUserId) return;
      focusAfterRetry.current = null;
      retired = true;
      const scheduled = ++sequence;
      setAccess({ scope, verdict: "checking" });
      // Auth callbacks hold the SDK lock. Session data retires a read; it cannot grant one.
      queueMicrotask(() => { if (!cancelled && scheduled === sequence) void read(); });
    });
    void read();
    return () => { cancelled = true; sequence += 1; subscription.unsubscribe(); };
  }, [scope, tenantId, activeUserId, attempt]);

  const verdict = scope && access.scope === scope ? access.verdict : "checking";
  useEffect(() => {
    if (!scope || focusAfterRetry.current !== scope || (verdict !== "allowed" && verdict !== "denied")) return;
    focusAfterRetry.current = null;
    // Only continue an intentional keyboard retry; never take focus back from another control.
    if (document.activeElement === document.body) (verdict === "allowed" ? editorRef.current : stateRef.current)?.focus();
  }, [scope, verdict]);
  if (verdict === "allowed") return <div ref={editorRef} role="region" aria-label="Portal configuration editor" tabIndex={-1}>{children}</div>;
  return (
    <section ref={stateRef} tabIndex={-1} className="trc-state" role={verdict === "error" ? "alert" : "status"} aria-busy={verdict === "checking"}>
      <h2>{verdict === "checking" ? "Checking configuration access" : verdict === "error" ? "We couldn’t check configuration access" : "Configuration access required"}</h2>
      <p>{verdict === "checking" ? "The editor will open after your access to this workspace is verified." : verdict === "error" ? "The editor will stay closed until this check succeeds. Try again." : "This account does not have permission to change this portal’s appearance or content."}</p>
      {(verdict === "error" || (verdict === "checking" && scope && focusAfterRetry.current === scope)) && <button type="button" aria-disabled={verdict !== "error"} onClick={(event) => {
        if (verdict !== "error") return;
        focusAfterRetry.current = document.activeElement === event.currentTarget ? scope : null;
        setAttempt((value) => value + 1);
      }}>Retry access check</button>}
    </section>
  );
}
