import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { takeOAuthReturn, clearOAuthReturn } from "@/solo/data/oauthReturn";
import { useUserRoles } from "@/hooks/useUserRoles";
import { useTenantContext } from "@/hooks/useTenantContext";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";

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

// Where to land when the surface that started the handshake did not say.
// Staff land back on the admin calendar; a client lands on their own Connected
// Accounts settings. Kept in one place so both connect lanes (this page + the
// Zoom edge callback) share the same contract.
//
// A surface that DID say wins over both: it records a same-origin return path
// before leaving (see `oauthReturn`), and honouring it is what keeps someone who
// connected from Settings → Connections → Calendars from being dropped on an
// unrelated page. The role default remains the fallback, unchanged.
// Operators are staff through `isPlatformStaff` (the one server answer), not a role word here.
const STAFF_ROLES = new Set(["admin"]);

export default function GoogleCalendarCallback() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { roles } = useUserRoles();
  const { isPlatformStaff } = useTenantContext();
  const [state, setState] = useState<"working" | "ok" | "error">("working");
  const [message, setMessage] = useState<string>("Finishing Google Calendar connection...");

  // The redirect fires on a timer after the code exchange resolves, so read the
  // freshest role signal via a ref rather than closing over a stale value.
  const isStaff = roles.some((r) => STAFF_ROLES.has(r)) || isPlatformStaff;
  const isStaffRef = useRef(isStaff);
  useEffect(() => { isStaffRef.current = isStaff; }, [isStaff]);

  useEffect(() => {
    const code = params.get("code");
    const stateParam = params.get("state");
    const error = params.get("error");
    // A return address belongs to THIS handshake and dies with it, however it
    // ends. Consuming it only on success left it in storage for its whole TTL
    // after a declined consent screen or a failed exchange — and the next Google
    // connect, started somewhere that asked for no return path at all, would
    // then finish by redirecting to Calendars. Every terminal path below clears
    // it; the success path consumes it.
    if (error) {
      clearOAuthReturn();
      setState("error");
      setMessage(`Google returned an error: ${error}`);
      return;
    }
    if (!code || !stateParam) {
      clearOAuthReturn();
      setState("error");
      setMessage("Missing code or state parameter.");
      return;
    }
    (async () => {
      const { data, error } = await supabase.functions.invoke("google-calendar-oauth-callback", {
        body: { code, state: stateParam, origin: window.location.origin },
      });
      const result = data as { error?: string; google_email?: string; return_origin?: string } | null;
      if (error || result?.error) {
        clearOAuthReturn();
        setState("error");
        setMessage(result?.error ?? error?.message ?? "Failed to complete connection.");
        return;
      }
      // Read once, before the timer, so an unrelated later visit can never
      // replay it — and so a poisoned entry is refused here as well as at write.
      const requestedReturn = takeOAuthReturn();
      setState("ok");
      setMessage(`Connected${result?.google_email ? ` as ${result.google_email}` : ""}. Redirecting...`);
      toast.success("Google Calendar connected");
      const returnOrigin = safeReturnOrigin(result?.return_origin);
      setTimeout(() => {
        const dest = requestedReturn ?? (isStaffRef.current ? "/choose-account" : "/app/settings?tab=accounts");
        if (returnOrigin && returnOrigin !== window.location.origin) {
          window.location.replace(`${returnOrigin}${dest}`);
          return;
        }
        navigate(dest, { replace: true });
      }, 1200);
    })();
  }, [params, navigate]);

  return (
    <div className="min-h-dvh flex items-center justify-center p-6 bg-background">
      <Card className="max-w-md w-full">
        <CardContent className="pt-6 flex flex-col items-center gap-3 text-center">
          {state === "working" && <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />}
          {state === "ok" && <CheckCircle2 className="h-8 w-8 text-[hsl(var(--success))]" />}
          {state === "error" && <XCircle className="h-8 w-8 text-destructive" />}
          <p className="text-sm">{message}</p>
        </CardContent>
      </Card>
    </div>
  );
}
