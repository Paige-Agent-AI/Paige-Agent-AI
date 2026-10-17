// Gmail OAuth callback (#141b) — mirrors GoogleCalendarCallback. Reads ?code&state,
// invokes gmail-oauth-callback to exchange the code + provision the tenant's Gmail
// connector, then lands back on the Email integration surface. Honest states (§13):
// a Google error, a missing param, or a callback error each show a real message —
// never a silent success.
import { useEffect, useRef, useState } from "react";
import { takeOAuthReturn } from "@/solo/data/oauthReturn";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";
import { readFunctionErrorBody, resolveFunctionError } from "@/lib/integrations/connectError";

function safeReturnOrigin(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const allowed =
      (url.protocol === "http:" && host === "localhost") ||
      (url.protocol === "https:" && (
        host === "paigeagent.ai" ||
        host === "www.paigeagent.ai" ||
        host === "app.paigeagent.ai" ||
        host.endsWith(".vercel.app")
      ));
    return allowed ? url.origin : null;
  } catch {
    return null;
  }
}

// Human-readable messages for the honest error codes the callback returns (§36 — a
// non-technical coach should never see a raw code).
const ERROR_COPY: Record<string, string> = {
  gmail_oauth_not_configured: "Gmail connect isn't switched on yet — we're finishing the Google sign-in setup. Try again shortly.",
  gmail_already_connected_elsewhere: "This Gmail address is already connected to another workspace. Use a different address, or disconnect it there first.",
  token_exchange_failed: "Google didn't return a lasting connection. Please try connecting again and approve offline access.",
  no_tenant_for_user: "We couldn't match your account to a workspace. Contact support so we can finish the connection.",
  state_expired: "That sign-in link timed out. Please start the Gmail connect again.",
  state_user_mismatch: "That sign-in didn't match your account. Please start the Gmail connect again.",
  gmail_email_unavailable: "Google didn't share your email address. Please try again and grant the email permission.",
  invalid_state: "That Google sign-in could not be verified. Return to Connections and start it again.",
  state_origin_mismatch: "That sign-in returned to a different page. Return to the original workspace's Connections.",
  workspace_changed: "Your workspace or access changed. Return to the original workspace and check its Connections before trying again.",
  forbidden: "A workspace owner or administrator must connect this Google account.",
  gmail_connection_conflict: "This Google account conflicts with an existing connection. Inspect Connections before trying another account.",
  gmail_already_personal_to_another_user: "This address is already a teammate's private inbox. It was not reconnected by this request.",
  gmail_shared_connector_conflict: "This address is the shared workspace mailbox. It was not changed to a personal inbox.",
  gmail_address_connector_conflict: "This address already has a connection. Inspect Connections before trying again.",
  gmail_connector_lookup_failed: "The existing connection could not be checked. Return to Connections and refresh it before trying again.",
  COMMS_PROVIDER_EXECUTION_DISABLED: "Google connection requests are unavailable for this workspace. Check its Connections status.",
};
const UNKNOWN_COPY = "The Google connection could not be confirmed. It may have completed. Inspect the original workspace's Connections before reconnecting.";
const SAVED_COPY = "The Google connection was saved in the original workspace. Its details cannot be shown here. Refresh that workspace's Connections before reconnecting.";
const record = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object"
  && !Array.isArray(value) ? value as Record<string, unknown> : null;
async function responseBody(data: unknown, error: unknown): Promise<Record<string, unknown> | null> {
  return record(data) ?? await readFunctionErrorBody(error, data);
}

export default function GmailCallback() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [state, setState] = useState<"working" | "ok" | "saved" | "unknown" | "error">("working");
  const [message, setMessage] = useState<string>("Finishing your Gmail connection...");
  // One in-memory invocation per current consent round survives StrictMode effect
  // replay. It is not a durable nonce store or automatic retry/recovery mechanism.
  const attempt = useRef<{ key: string; result: ReturnType<typeof supabase.functions.invoke> } | null>(null);

  useEffect(() => {
    let current = true;
    let redirectTimer: ReturnType<typeof setTimeout> | undefined;
    const retire = () => { current = false; if (redirectTimer !== undefined) clearTimeout(redirectTimer); };
    const code = params.get("code");
    const stateParam = params.get("state");
    const error = params.get("error");
    if (error) {
      setState("error");
      setMessage(`Google returned an error: ${error}`);
      return retire;
    }
    if (!code || !stateParam) {
      setState("error");
      setMessage("Missing code or state parameter.");
      return retire;
    }
    setState("working");
    setMessage("Finishing your Gmail connection...");
    void (async () => {
      try {
        const key = JSON.stringify([code, stateParam, window.location.origin]);
        if (attempt.current?.key !== key) attempt.current = { key,
          result: supabase.functions.invoke("gmail-oauth-callback", {
            body: { code, state: stateParam, origin: window.location.origin },
          }) };
        const { data, error: invokeErr } = await attempt.current.result;
        if (!current) return;
        const body = await responseBody(data, invokeErr);
        if (!current) return;
        const errCode = typeof body?.error === "string" ? body.error : null;
        if (errCode === "gmail_connection_saved_result_withheld" && body?.connection_saved === true) {
          setState("saved"); setMessage(SAVED_COPY); return;
        }
        if (invokeErr || errCode) {
          const resolved = await resolveFunctionError({ data: body, error: invokeErr, action: "connect a Google account" });
          if (!current) return;
          const copy = resolved.code ? ERROR_COPY[resolved.code] : null;
          setState(copy ? "error" : "unknown"); setMessage(copy ?? UNKNOWN_COPY); return;
        }
        const addr = typeof body?.gmail_address === "string" ? body.gmail_address.trim() : "";
        // Preserve the existing valid legacy success envelope; contradictory or
        // incomplete responses never become a connection/redirect claim.
        if (body?.ok !== true || !addr || ("connection_saved" in body && body.connection_saved !== true)) {
          setState("unknown"); setMessage(UNKNOWN_COPY); return;
        }
        setState("ok");
        setMessage(`Connected as ${addr}. Redirecting...`);
        toast.success("Gmail connected");
        const returnOrigin = safeReturnOrigin(body.return_origin);
        // Preserve the incumbent recorded Connections return and allowlisted origin.
        // takeOAuthReturn is read-and-clear and accepts only a same-origin path.
        const dest = takeOAuthReturn() ?? "/app/settings?tab=accounts";
        redirectTimer = setTimeout(() => {
          if (!current) return;
          if (returnOrigin && returnOrigin !== window.location.origin) {
            window.location.replace(`${returnOrigin}${dest}`);
            return;
          }
          navigate(dest, { replace: true });
        }, 1200);
      } catch {
        if (current) { setState("unknown"); setMessage(UNKNOWN_COPY); }
      }
    })();
    return retire;
  }, [params, navigate]);

  return (
    <div className="min-h-dvh flex items-center justify-center p-6 bg-background">
      <Card className="max-w-md w-full">
        <CardContent className="pt-6 flex flex-col items-center gap-3 text-center">
          {state === "working" && <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />}
          {(state === "ok" || state === "saved") && <CheckCircle2 className="h-8 w-8 text-[hsl(var(--success))]" />}
          {state === "unknown" && <XCircle className="h-8 w-8 text-muted-foreground" />}
          {state === "error" && <XCircle className="h-8 w-8 text-destructive" />}
          <p className="text-sm">{message}</p>
        </CardContent>
      </Card>
    </div>
  );
}
