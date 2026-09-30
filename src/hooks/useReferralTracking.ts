// src/hooks/useReferralTracking.ts
// Mount once at the top of the tree (inside App.tsx). On mount:
//   1. Read ?ref=CODE from URL (and any utm_* params)
//   2. Persist to localStorage + cookie for 60 days
//   3. Fire-and-forget the track-referral-click edge function
//   4. Quietly remove ?ref from the URL (keeps clean share links)
//
// Exports getStoredReferralCode() for the signup flow to pass into options.data.

import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client"; // ADJUST-IF-NEEDED
import {
  redactAttributionValue,
  redactSecretPath,
  redactSecretSearch,
} from "./useAnalytics";
import {
  saveReferral,
  loadReferral,
  getStoredReferralCode,
} from "@/lib/referralStorage";

export { getStoredReferralCode };

/** Attribution params, redacted by the shared mint-shape rule before they leave the browser. */
function attribution(url: URL, key: string): string | undefined {
  const raw = url.searchParams.get(key);
  return raw ? redactAttributionValue(raw) : undefined;
}

function readUrlParams(): {
  code: string | null;
  landingPath: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
} {
  if (typeof window === "undefined") {
    return { code: null, landingPath: "/" };
  }
  const url = new URL(window.location.href);
  const code = url.searchParams.get("ref");
  return {
    code: code ? code.trim().toUpperCase() : null,
    // `referral_clicks` RLS lets the OWNING AFFILIATE select this row, so a credential here
    // reaches an ordinary tenant-tier user, not just a platform operator. Redact and keep the
    // attribution — suppressing the click outright would cost this lane its landing data to fix
    // a problem the signing route introduced.
    //
    // The SEARCH half was being appended RAW after the path had been redacted, so `?token=` /
    // `?ct=` (live unsubscribe surfaces) sailed straight through into the most widely-readable
    // of the three sinks. The wiring test did not catch it, because it asserted against SOURCE
    // TEXT: it looked for the fully-unredacted spelling, which this line never had.
    landingPath: redactSecretPath(url.pathname) + redactSecretSearch(url.search),
    // ...and then read RAW out of the very search string the line above had just redacted. This
    // hook posts to `track-referral-click`, a DIFFERENT edge function, so `trackEvent`'s
    // whole-payload scrub never sees these three values — redacting `landingPath` alone left a
    // complete invite token reaching a separate table one line below the fix for it.
    utmSource: attribution(url, "utm_source"),
    utmMedium: attribution(url, "utm_medium"),
    utmCampaign: attribution(url, "utm_campaign"),
  };
}

function stripRefFromUrl() {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (!url.searchParams.has("ref")) return;
  url.searchParams.delete("ref");
  const next = url.pathname + (url.search || "") + url.hash;
  window.history.replaceState({}, "", next);
}

export function useReferralTracking(): void {
  useEffect(() => {
    const { code, landingPath, utmSource, utmMedium, utmCampaign } =
      readUrlParams();

    if (!code) {
      // No new code in URL — keep any existing stored one untouched.
      return;
    }

    // If a different code is already stored, last-touch wins (matches spec).
    const existing = loadReferral();
    if (!existing || existing.code !== code) {
      saveReferral({
        code,
        storedAt: Date.now(),
        landingPath,
        utmSource,
        utmMedium,
        utmCampaign,
      });
    }

    // Fire and forget — never block render.
    void (async () => {
      try {
        await supabase.functions.invoke("track-referral-click", {
          body: {
            referral_code: code,
            landing_path: landingPath,
            utm_source: utmSource,
            utm_medium: utmMedium,
            utm_campaign: utmCampaign,
            user_agent:
              typeof navigator !== "undefined" ? navigator.userAgent : undefined,
          },
        });
      } catch (err) {
        // Silent — tracking failure should never break the app.
        if (typeof console !== "undefined") {
          console.debug("[referral] track-click failed", err);
        }
      }
    })();

    // Clean up the URL so the code doesn't leak into shared links.
    stripRefFromUrl();
  }, []);
}
