// Custom web-domain guidance (EXP06 PR7 — WEB-05/06/07, matrix rows 9/11).
//
// What this is: the ONE pure model of what a custom web address's readiness actually is, plus
// the guidance content (six provider profiles, the mail records that are never touched, and the
// owner-gated host path). What this is NOT: a DNS client, a provider integration, or a second
// publishing authority — EXP06 never mutates DNS, never provisions hosting, and never calls a
// provider from this module. Observations arrive as facts (what the owner or PAIGE has actually
// seen at the authoritative nameserver); classification is deterministic over those facts.
//
// Vocabulary discipline (tenant-domain-and-communications-spine.md): a reserved address is
// ALLOCATED, not connected — "reserved" never renders as live. Only `web_live` means the address
// serves the published site, and only after real routing + HTTPS readback.

/** DNS records that carry EMAIL and identity. PAIGE never edits these; changing them can break
 *  a tenant's mail. Any DNS change at all is owner-approved, and these specifically are called
 *  out so guidance can never quietly walk past them. */
export const MAIL_AND_AUTHORITY_RECORDS: readonly string[] = [
  "MX", "SPF (TXT)", "DKIM (TXT)", "DMARC (TXT)", "Nameserver (NS)", "DNSSEC",
] as const;

/** What has actually been observed about one custom web address. All facts, no aspirations:
 *  the classifier may only say what these say. */
export interface WebDomainObservations {
  /** The tenant's canonical reserved address, e.g. "acme.paigeagent.ai". */
  reservedAddress: string;
  /** Spine state for the RESERVED address: routing attached and smoke-tested (web_live).
   *  null = NOT observed from this surface — the classifier then claims nothing about it
   *  (publishing an artifact proves the artifact's own URL, never that the reserved
   *  host root serves; the spine forbids calling reserved infrastructure live). */
  reservedWebLive: boolean | null;
  /** The custom address the owner wants to serve the site from, once they state one. */
  customDomain: string | null;
  /** The ownership TXT record was seen at the custom domain's AUTHORITATIVE nameserver
   *  (not the registrar's page — where the account lives and where DNS answers can differ). */
  ownershipTxtSeen: boolean;
  /** The registrar is NOT where DNS is answered (e.g. domain bought at Wix, DNS on Cloudflare):
   *  guidance must send the owner to the authoritative DNS provider, not the seller. */
  dnsAuthorityElsewhere: boolean | null;
  /** The routing record (CNAME or A) pointing the custom address at the host was observed. */
  routingRecordSeen: boolean;
  /** A valid TLS certificate was observed serving HTTPS at the custom address. */
  sslVerified: boolean;
  /** An existing record collides with the one guidance would add (a live A/CNAME/TXT conflict). */
  recordConflict: boolean;
  /** The custom address previously served the site and that permission was withdrawn. */
  revoked: boolean;
  /** The owner's gate for any REAL effect (DNS change, host provisioning, deployment). */
  ownerAuthorization: "none" | "requested" | "granted";
}

/** Readiness states for a custom web address. Deliberately granular: a generic "Ready" is the
 *  lie this module exists to prevent. Order matters — the ladder a healthy connection climbs. */
export type WebDomainState =
  | "not_started"        // no custom address stated; the reserved address is the whole truth
  | "ownership_pending"  // TXT not yet seen at the authoritative NS
  | "routing_pending"    // ownership proven; routing record not yet seen
  | "ssl_pending"        // traffic reaches the host; HTTPS not yet verified
  | "conflict"           // an existing record blocks the change — shown, never auto-overwritten
  | "revoked"            // it worked and was withdrawn; re-entry needs explicit re-consent
  | "gated_ready"        // every technical check passed; any real effect awaits owner authorization
  | "live_verified";     // owner approved AND the address serves HTTPS — the only state called live

export interface WebDomainClassification {
  state: WebDomainState;
  /** One short line naming the state in plain words. Never "connected" unless sslVerified. */
  headline: string;
  /** What this state means for the person reading it. */
  detail: string;
  /** The single next step that moves the state forward, or what it is waiting on. */
  nextStep: string;
}

/** Deterministic classification. Conflict and revocation win over the ladder (an observer must
 *  never read a conflicting or withdrawn address as "almost ready"). */
export function classifyWebDomain(o: WebDomainObservations): WebDomainClassification {
  if (o.recordConflict) {
    return {
      state: "conflict",
      headline: "An existing record is in the way",
      detail: `Something already answers for ${o.customDomain ?? "this address"} — an A, CNAME or TXT record the change would collide with. It is shown, never overwritten: it may be serving your current site or email.`,
      nextStep: "Decide with Paige what the existing record is for before anything replaces it. PAIGE will not overwrite it.",
    };
  }
  if (o.revoked) {
    return {
      state: "revoked",
      headline: "This address was disconnected",
      detail: `${o.customDomain ?? "This address"} served your site before and the connection was withdrawn. Reconnecting is a fresh decision, not an automatic retry.`,
      nextStep: "Say the word and Paige will start the checks again from ownership — with your approval at each step that changes anything.",
    };
  }
  if (!o.customDomain) {
    // Three truths, never two: OBSERVED serving, OBSERVED held, or NOT observed from here.
    // A publication receipt proves the artifact's own URL — not that the reserved host
    // root serves — so the unobserved case must claim nothing in either direction.
    return {
      state: "not_started",
      headline: o.reservedWebLive === null
        ? `Your reserved address (${o.reservedAddress})`
        : o.reservedWebLive
          ? `Serving at your reserved address (${o.reservedAddress})`
          : `Your reserved address is held (${o.reservedAddress})`,
      detail: o.reservedWebLive === null
        ? "It's held for this workspace. Whether it's serving isn't checked from this panel — what's live today is the address at the top of this card."
        : o.reservedWebLive
          ? "Your published site answers at this address today. A custom address of your own is an addition, never a replacement requirement."
          : "The address is allocated to your workspace and serves nothing until your site is actually live on it — a held address is not a website.",
      nextStep: "Want your own address (like www.yourbusiness.com)? Tell Paige the domain and the registrar you bought it from.",
    };
  }
  if (!o.ownershipTxtSeen) {
    return {
      state: "ownership_pending",
      headline: "Proving you own the address",
      detail: `A TXT record proves ${o.customDomain} is yours. It has not been seen where DNS actually answers${o.dnsAuthorityElsewhere ? " — and your DNS is not managed where you bought the domain, so the record goes at your DNS provider, not the seller" : ""}.`,
      nextStep: o.dnsAuthorityElsewhere
        ? `Add the TXT record at your DNS provider (not the store you bought the name from), then ask Paige to check again.`
        : "Add the TXT record your registrar shows for verification, then ask Paige to check again.",
    };
  }
  if (!o.routingRecordSeen) {
    return {
      state: "routing_pending",
      headline: "Ownership proven; pointing the address",
      detail: `${o.customDomain} is proven yours. Next, a CNAME (or A) record sends visitors from it to the host that serves your site.`,
      nextStep: "Add the routing record Paige gives you, and keep every mail record (MX, SPF, DKIM, DMARC) exactly as it is.",
    };
  }
  if (!o.sslVerified) {
    return {
      state: "ssl_pending",
      headline: "Almost there — the security certificate",
      detail: `${o.customDomain} reaches the host. HTTPS is the last technical check: a valid certificate must serve your site at that address, and it is only called live when it does.`,
      nextStep: "Ask Paige to verify HTTPS at the address. This usually settles on its own once the host sees traffic.",
    };
  }
  if (o.ownerAuthorization !== "granted") {
    return {
      state: "gated_ready",
      headline: "Every check passed — waiting on your go",
      detail: `${o.customDomain} passed ownership, routing and HTTPS checks. Making it THE address visitors use is a real change (DNS and hosting effects), so it only happens with your explicit approval — as owner of this workspace you get the exact change, its cost and how to undo it, before anything moves.`,
      nextStep: o.ownerAuthorization === "requested"
        ? "Your approval request is with the workspace owner."
        : "Ask Paige to prepare the exact change for the owner's approval.",
    };
  }
  return {
    state: "live_verified",
    headline: `Live at ${o.customDomain}`,
    detail: "Ownership, routing and HTTPS are verified, and the owner approved the change. This address serves the published site.",
    nextStep: "Renewal and recovery stay visible here: if the certificate or DNS record ever fails, this card says so — it never keeps calling a dead address live.",
  };
}

/** The six registrars/DNS providers an owner realistically holds (owner addendum, Oct 18).
 *  Guidance content only — names and where records live, from public knowledge. No OAuth, no
 *  paid integration, no API. */
export interface ProviderProfile {
  id: string;
  name: string;
  /** Where the ownership TXT record is added, in one line. */
  txtWhere: string;
  /** Where the routing CNAME/A record is added, in one line. */
  routingWhere: string;
  /** The registrar-vs-authority trap this provider most often presents. */
  authorityNote: string;
}

export const PROVIDER_PROFILES: readonly ProviderProfile[] = [
  {
    id: "cloudflare",
    name: "Cloudflare",
    txtWhere: "DNS › Records › Add record, type TXT, on the name you are verifying.",
    routingWhere: "DNS › Records › Add record, type CNAME (or A), pointing the address at the host Paige names.",
    authorityNote: "If Cloudflare is your DNS, changes happen there even if the name was bought elsewhere.",
  },
  {
    id: "namecheap",
    name: "Namecheap",
    txtWhere: "Domain List › Manage › Advanced DNS › Add New Record, type TXT.",
    routingWhere: "Advanced DNS › Add New Record, type CNAME Record, on the address's host label.",
    authorityNote: "Use Advanced DNS only if Namecheap's default nameservers still answer for the domain; otherwise the DNS provider's panel is the one that matters.",
  },
  {
    id: "godaddy",
    name: "GoDaddy",
    txtWhere: "My Products › DNS › Manage Zones › Add record, type TXT.",
    routingWhere: "DNS › Manage Zones › Add record, type CNAME, on the address's host label.",
    authorityNote: "GoDaddy sells domains and answers DNS only while its nameservers are selected; if you changed nameservers, make the record where they point.",
  },
  {
    id: "squarespace",
    name: "Squarespace Domains",
    txtWhere: "Settings › Domains › your domain › DNS › Custom Records › Add record, type TXT.",
    routingWhere: "The same Custom Records page, type CNAME, on the address's host label.",
    authorityNote: "A Squarespace domain can serve a site hosted anywhere — the records just have to point there.",
  },
  {
    id: "porkbun",
    name: "Porkbun",
    txtWhere: "Domain Management › DNS Records › Add record, type TXT.",
    routingWhere: "DNS Records › Add record, type CNAME (ALIAS at the root), pointing at the host Paige names.",
    authorityNote: "Porkbun is registrar and DNS by default; if you moved nameservers, follow them instead.",
  },
  {
    id: "wix",
    name: "WIX",
    txtWhere: "If DNS is managed in Wix: Domains › your domain › DNS Records › Add record, type TXT.",
    routingWhere: "The same DNS Records page, type CNAME, on the address's host label.",
    authorityNote: "A domain bought at Wix can point to hosting anywhere via A/CNAME records. If its DNS is managed outside Wix, make every change at that DNS provider — not in Wix.",
  },
] as const;

/** The owner-gated host path (WEB-05): how a site leaves the platform when the owner chooses to.
 *  Presented as a package for review — never executed by this module. */
export interface HostPathStep {
  title: string;
  detail: string;
}

export const HOST_PATH_PACKAGE: readonly HostPathStep[] = [
  {
    title: "1 · Export the published version",
    detail: "The Studio's publish panel downloads the exact published page as one static HTML file with its manifest — the same content, tokens and links visitors see today.",
  },
  {
    title: "2 · Host it where you choose (with your approval)",
    detail: "The aligned path is Cloudflare's static hosting (Workers Static Assets / Pages — the platform's existing provider family). Setting it up is a real, owner-approved action: PAIGE presents the exact change, its scope, any cost and how to undo it, and nothing is provisioned until the workspace owner says yes.",
  },
  {
    title: "3 · Verify the real address",
    detail: "The site is called live only when the chosen address serves the exported content over HTTPS — a reserved or purchased name by itself is never a served website.",
  },
  {
    title: "4 · Recover",
    detail: "Taking the hosted copy down is one step (remove the deployment or repoint the record), and the platform's published version keeps running at its reserved address the whole time — the export is a copy, never a move.",
  },
] as const;

export const HOST_PATH_COST_LINE =
  "Static hosting of this shape sits in Cloudflare's free tier today. Anything beyond it is scoped, priced and approved by the workspace owner BEFORE activation — PAIGE never provisions hosting, buys domains, or changes DNS silently, and any spend stays under an owner-set ceiling with alerts.";

/** The one-line promise the guidance surface always keeps in view (WEB-09). */
export const DNS_PRESERVATION_LINE =
  "PAIGE never changes your DNS by itself. Mail and authority records — MX, SPF, DKIM, DMARC, nameservers, DNSSEC — stay exactly as they are; every change is shown to you first and made only with the owner's approval.";
