/**
 * Where a provider's consent redirect lands.
 *
 * This page carries no authority of its own. It reads the two values the provider echoed
 * back — the authorization code and the state — and hands them to `tenant-mcp-connect`,
 * which is where every decision is made: the state is redeemed exactly once in SQL, the
 * PKCE verifier is read server-side, the tenant comes from the stored flow rather than
 * from this browser, and the code is exchanged without either secret ever existing here.
 *
 * A code is single-use and short-lived, so this page must not be re-runnable: React
 * StrictMode mounts effects twice in development, and a second exchange of a spent code
 * fails at the provider. The guard below makes the exchange happen once per mount.
 *
 * Nothing is stored, logged, or put in the URL by this page. The query string is cleared
 * as soon as it has been read, so a copied address, a screenshot or a shared browser
 * history cannot carry an authorization code.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { readFunctionErrorBody } from "@/lib/integrations/connectError";
import { takeOAuthReturn } from "@/solo/data/oauthReturn";
import "./McpOAuthCallback.css";

type Phase =
  | { kind: "working" }
  | { kind: "done"; connected: boolean }
  /** Owner-language only. A provider's own error text never reaches this screen. */
  | { kind: "failed"; message: string };

/** The provider may report its own refusal instead of returning a code. */
function describeProviderRefusal(error: string): string {
  if (error === "access_denied") return "The connection was not approved, so nothing was changed.";
  if (error === "invalid_scope") return "The connection asked for access this account cannot grant.";
  return "The provider did not complete the connection, so nothing was changed.";
}

function describeFailure(code: string | undefined): string {
  switch (code) {
    case "oauth_store_unconfirmed":
      return "The connection’s final status could not be confirmed. Review the existing connection in Integrations before reconnecting.";
    case "oauth_state_invalid":
      return "That link has already been used or has expired. Start the connection again from Integrations.";
    case "oauth_bad_callback":
      return "That link is incomplete. Start the connection again from Integrations.";
    case "forbidden":
      return "Only a workspace admin can connect this.";
    case "issuer_mismatch":
    case "malformed_metadata":
      return "The provider's sign-in service did not identify itself correctly, so the connection was refused.";
    default:
      return "The connection could not be completed. Start it again from Integrations.";
  }
}

export default function McpOAuthCallback() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>({ kind: "working" });
  // A code may be exchanged once. Without this, StrictMode's double mount spends it on
  // the first call and fails on the second, reporting a failure for a connection that
  // actually succeeded.
  const started = useRef(false);

  const complete = useCallback(async (code: string, state: string) => {
    const { data, error } = await supabase.functions.invoke("tenant-mcp-connect", {
      body: { provider: "zapier", action: "oauth_complete", code, state },
    });
    // On a non-2xx the body is on the error, not on `data`. Without this the callback
    // reported the generic failure for every refusal, including the ones a person can act
    // on — an expired authorization, a state that had already been spent.
    const failure = await readFunctionErrorBody(error, data);
    if (error || typeof failure?.error === "string") {
      const code = typeof failure?.code === "string" ? failure.code : undefined;
      const reason = typeof failure?.error === "string" ? failure.error : undefined;
      setPhase({ kind: "failed", message: describeFailure(code ?? reason) });
      return;
    }
    // Granted is not the same as working: the probe decides. Both are honest outcomes and
    // are worded differently, because a connection that is stored but failing needs
    // attention and one that is proven does not.
    setPhase({ kind: "done", connected: (data as { status?: string })?.status === "connected" });
  }, []);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const code = params.get("code");
    const state = params.get("state");
    const providerError = params.get("error");

    // Clear the query string before anything else. An authorization code in an address
    // bar outlives its usefulness immediately and outlives its secrecy for as long as the
    // history entry exists.
    setParams(new URLSearchParams(), { replace: true });

    if (providerError) { setPhase({ kind: "failed", message: describeProviderRefusal(providerError) }); return; }
    if (!code || !state) { setPhase({ kind: "failed", message: describeFailure("oauth_bad_callback") }); return; }
    void complete(code, state);
  }, [complete, params, setParams]);

  // NOT during render. takeOAuthReturn clears as it reads, and StrictMode replays the
  // render with fresh hook state -- so a read in the body is consumed by the throwaway pass
  // and the committed one sees nothing. Measured, not assumed: the first render returned
  // the path and the committed render returned null, which in development left every
  // successful connection stranded on the interstitial with its button falling back to "/".
  // Raised by Codex on this PR.
  //
  // Effects run only after a commit, so this ref is on an instance React has kept and it
  // survives the cleanup-and-rerun that StrictMode performs.
  const [back, setBack] = useState<string | null>(null);
  const took = useRef(false);
  useEffect(() => { if (took.current) return; took.current = true; setBack(takeOAuthReturn()); }, []);
  const goBack = useCallback(() => navigate(back ?? "/"), [navigate, back]);

  // A CONNECTED result has nothing left to tell anyone: the surface it came from shows the
  // state, the Rail records it, and stopping here made the owner read a page, press a
  // button, and land on the public marketing site. Success returns straight to where the
  // connection was started. A FAILURE still stops, because the reason is only on this page.
  useEffect(() => {
    if (phase.kind === "done" && phase.connected && back) navigate(back, { replace: true });
  }, [phase, navigate, back]);

  return (
    <main className="mcp-cb" role="status" aria-live="polite">
      <div className="mcp-cb-card">
        {phase.kind === "working" && <>
          <h1>Finishing the connection…</h1>
          <p>This takes a moment. You can leave this page open.</p>
        </>}

        {phase.kind === "done" && <>
          <h1>{phase.connected ? "Connected" : "Saved, but not working yet"}</h1>
          <p>
            {phase.connected
              ? "Zapier is connected. Paige can see the tools you approve for her."
              : "The connection was stored, but the check did not succeed. Open it in Integrations to try again."}
          </p>
          <button type="button" className="mcp-cb-btn" onClick={goBack}>Back to Integrations</button>
        </>}

        {phase.kind === "failed" && <>
          <h1>That did not connect</h1>
          <p>{phase.message}</p>
          <button type="button" className="mcp-cb-btn" onClick={goBack}>Back to Integrations</button>
        </>}
      </div>
    </main>
  );
}
