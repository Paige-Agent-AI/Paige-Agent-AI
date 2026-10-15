import { useEffect, useRef, useState } from "react";
import { Outlet, useNavigate, useLocation } from "react-router-dom";
import { useOnboardingClient } from "./useOnboardingClient";
import { supabase } from "@/integrations/supabase/client";
import { readableTextOn, isColorDark } from "@/lib/brand/contrast";
import type { CSSProperties } from "react";
import "./onboard-theme.css";

export interface OnboardBrand {
  tenant_name: string;
  logo_url: string | null;
  primary_color: string | null;
}

// Pre-portal onboarding is now two steps: welcome + agreement. Everything else
// (intake, docs, etc.) happens inside /workspace under Paige's guidance.
const STAGE_ORDER = ["invited", "signing_agreement"] as const;

const STEP_TO_PATH: Record<string, string> = {
  invited: "/onboard/welcome",
  signing_agreement: "/onboard/agreement",
};

const POST_AGREEMENT_STAGES = new Set([
  "accepting_payment",
  "completing_intake",
  "uploading_docs",
  "completed",
]);

const PATH_TO_STAGE: Record<string, string> = Object.fromEntries(
  Object.entries(STEP_TO_PATH).map(([s, p]) => [p, s]),
);

// Legacy / alias paths from older emails and earlier builds. Anything that
// used to be a post-agreement step now resolves to the workspace so clients
// don't get parked in a pre-portal dead end.
const LEGACY_PATH_ALIASES: Record<string, string> = {
  "/onboard": "/onboard/welcome",
  "/onboard/start": "/onboard/welcome",
  "/onboard/begin": "/onboard/welcome",
  "/onboard/sign": "/onboard/agreement",
  "/onboard/contract": "/onboard/agreement",
  "/onboard/terms": "/onboard/agreement",
  "/onboard/pay": "/app",
  "/onboard/payment": "/app",
  "/onboard/checkout": "/app",
  "/onboard/billing": "/app",
  "/onboard/form": "/app",
  "/onboard/intake": "/app",
  "/onboard/questionnaire": "/app",
  "/onboard/profile": "/app",
  "/onboard/upload": "/app",
  "/onboard/documents": "/app",
  "/onboard/docs": "/app",
  "/onboard/files": "/app",
  "/onboard/complete": "/app",
  "/onboard/done": "/app",
  "/onboard/finish": "/app",
  "/onboard/success": "/app",
};


export default function OnboardLayout() {
  const retryButton = useRef<HTMLButtonElement>(null);
  const restoreRetryFocus = useRef(false);
  const { loading, error, client, userEmail, refresh } = useOnboardingClient();
  const retryRead = () => { restoreRetryFocus.current = true; void refresh(); };
  useEffect(() => {
    if (loading) return;
    if (restoreRetryFocus.current && error) retryButton.current?.focus();
    restoreRetryFocus.current = false;
  }, [loading, error]);
  const navigate = useNavigate();
  const location = useLocation();
  const [brand, setBrand] = useState<OnboardBrand | null>(null);

  // The client can't read the tenants table directly (RLS), so pull their
  // tenant's brand via a SECURITY DEFINER helper. This makes onboarding wear the
  // TENANT's brand (§6/§9), not the platform's.
  useEffect(() => {
    setBrand(null);
    if (!client?.id) return;
    let cancelled = false;
    supabase.rpc("get_client_portal_brand").then(({ data }) => {
      const row = Array.isArray(data) ? data[0] : data;
      if (!cancelled && row) {
        setBrand({
          tenant_name: row.tenant_name,
          logo_url: row.logo_url ?? null,
          primary_color: row.primary_color ?? null,
        });
      }
    });
    return () => { cancelled = true; };
  }, [client?.id]);

  // Self-heal deep links: any /onboard/* hit with a known client gets
  // normalized to the right step.
  //   1. Legacy alias (/onboard/sign → /onboard/agreement)
  //   2. Bare or unknown /onboard path → canonical step for current stage
  //   3. URL is AHEAD of the user's actual stage → push back to current step
  //      (URLs BEHIND the current stage are allowed for review).
  useEffect(() => {
    if (loading || !client) return;
    const path = (location.pathname.replace(/\/+$/, "") || "/onboard");

    const aliasTarget = LEGACY_PATH_ALIASES[path];
    if (aliasTarget && aliasTarget !== path) {
      navigate(aliasTarget + location.search + location.hash, { replace: true });
      return;
    }

    const stage = client.onboarding_stage ?? "invited";

    // Anything past agreement belongs in the workspace, not /onboard/*.
    if (POST_AGREEMENT_STAGES.has(stage)) {
      navigate("/app", { replace: true });
      return;
    }

    const expected = STEP_TO_PATH[stage] ?? "/onboard/welcome";
    const currentStage = PATH_TO_STAGE[path];

    if (path === "/onboard" || (path.startsWith("/onboard/") && !currentStage)) {
      navigate(expected + location.search + location.hash, { replace: true });
      return;
    }

    if (currentStage) {
      const urlIdx = STAGE_ORDER.indexOf(currentStage as (typeof STAGE_ORDER)[number]);
      const stageIdx = STAGE_ORDER.indexOf(stage as (typeof STAGE_ORDER)[number]);
      if (urlIdx > stageIdx && expected !== path) {
        navigate(expected + location.search + location.hash, { replace: true });
      }
    }
  }, [loading, client, location.pathname, location.search, location.hash, navigate]);


  // If we land on /onboard with an authed session but no client record yet,
  // trigger the server-side self-heal RPC once. Covers legacy invites where
  // the client role / linked_user_id wasn't backfilled.
  useEffect(() => {
    if (loading || error !== "no_client_record") return;
    (async () => {
      try {
        const { data: healed } = await supabase.rpc("ensure_client_role_self_heal");
        const row = Array.isArray(healed) ? healed[0] : healed;
        if (row?.healed) refresh();
      } catch {
        /* ignore — UI will keep showing the no_client_record card */
      }
    })();
  }, [loading, error, refresh]);

  if (loading) {
    return (
      <div className="onboard-shell">
        <div className="onboard-container">
          <div className="onboard-card p-10 text-center">Loading your onboarding…</div>
        </div>
      </div>
    );
  }

  if (error === "not_authenticated") {
    return (
      <div className="onboard-shell">
        <div className="onboard-container">
          <div className="onboard-card p-10 text-center space-y-3">
            <h1 className="text-xl font-semibold">Please sign in</h1>
            <p className="text-sm" style={{ color: "rgba(8,20,40,0.7)" }}>
              Use the link in the welcome email {brand?.tenant_name ?? "the workspace that invited you"} sent you.
            </p>
            <a className="underline" href="/auth">Go to sign in</a>
          </div>
        </div>
      </div>
    );
  }

  if (error === "profile_unavailable") {
    return (
      <div className="onboard-shell">
        <div className="onboard-container">
          <div className="onboard-card p-10 text-center space-y-3" role="alert">
            <h1 className="text-xl font-semibold">We couldn't load your onboarding</h1>
            <p className="text-sm" style={{ color: "rgba(8,20,40,0.7)" }}>Try again to load your current account.</p>
            <button ref={retryButton} className="underline" onClick={retryRead}>Try again</button>
          </div>
        </div>
      </div>
    );
  }

  if (error === "no_client_record" || !client) {
    return (
      <div className="onboard-shell">
        <div className="onboard-container">
          <div className="onboard-card p-10 text-center space-y-3">
            <h1 className="text-xl font-semibold">We can't find your account yet</h1>
            <p className="text-sm" style={{ color: "rgba(8,20,40,0.7)" }}>
              {brand?.tenant_name ?? "The workspace that invited you"} hasn't activated your onboarding
              yet, or the email on your account ({userEmail ?? "—"}) doesn't match their records. Please
              reply to your welcome email and they'll sort it out.
            </p>
            <button ref={retryButton} className="underline" onClick={retryRead}>Try again</button>
          </div>
        </div>
      </div>
    );
  }

  // Drive the onboarding accent from the tenant's brand — but only when it stays
  // legible on the dark shell; a dark brand color falls back to gold.
  const shellStyle = (brand?.primary_color && !isColorDark(brand.primary_color)
    ? ({ ["--onboard-accent"]: brand.primary_color } as CSSProperties)
    : undefined);

  return (
    <div className="onboard-shell" style={shellStyle}>
      <div className="onboard-container">
        {brand && (
          <div className="flex items-center gap-3 mb-6">
            {brand.logo_url ? (
              <img src={brand.logo_url} alt={brand.tenant_name} className="h-9 w-auto max-w-[180px] object-contain" />
            ) : (
              <span
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-base font-semibold"
                style={{
                  backgroundColor: brand.primary_color || "#081428",
                  color: readableTextOn(brand.primary_color || "#081428"),
                }}
              >
                {(brand.tenant_name || "?").charAt(0).toUpperCase()}
              </span>
            )}
            <span className="text-lg font-semibold" style={{ color: "#081428" }}>{brand.tenant_name}</span>
          </div>
        )}
        <Outlet context={{ client, refresh, brand }} />
      </div>
    </div>
  );
}
