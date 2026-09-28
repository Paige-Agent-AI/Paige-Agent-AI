import { appUrl } from "@/lib/hostRouting";
import { soloBetaSignupPath } from "@/lib/auth/soloBetaAcquisition";

/**
 * Where the public site's two acts go. Both are the unchanged, test-pinned enrollment seams:
 * signup → `/auth?mode=signup&plan=solo&billing=monthly`, login → `/auth`, both born on the app
 * origin via `appUrl` (a relative path while the host split is off).
 */
export const trialHref = () => appUrl(soloBetaSignupPath());
export const loginHref = () => appUrl("/auth");

export type SiteLink = { label: string; to: string };

/** Header navigation. Only pages that exist are listed — no link ever points at a page to come. */
export const PRIMARY_NAV: SiteLink[] = [
  { label: "Pricing", to: "/pricing" },
  { label: "About", to: "/about" },
];

export const FOOTER_NAV: { heading: string; links: SiteLink[] }[] = [
  {
    heading: "Paige",
    links: [
      { label: "Home", to: "/" },
      { label: "Pricing", to: "/pricing" },
    ],
  },
  {
    heading: "Company",
    links: [
      { label: "About", to: "/about" },
      { label: "Resources", to: "/blog" },
    ],
  },
  {
    heading: "Legal",
    links: [
      { label: "Terms of Service", to: "/terms" },
      { label: "Privacy Policy", to: "/privacy" },
      { label: "SMS Terms", to: "/sms-terms" },
    ],
  },
];
