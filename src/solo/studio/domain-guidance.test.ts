import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  MAIL_AND_AUTHORITY_RECORDS,
  PROVIDER_PROFILES,
  HOST_PATH_PACKAGE,
  HOST_PATH_COST_LINE,
  DNS_PRESERVATION_LINE,
  classifyWebDomain,
  type WebDomainObservations,
} from "./domain-guidance";

/** The honest starting point everywhere in EXP06 today: no custom address anywhere. */
const base: WebDomainObservations = {
  reservedAddress: "acme-coaching.paigeagent.ai",
  reservedWebLive: true,
  customDomain: null,
  ownershipTxtSeen: false,
  dnsAuthorityElsewhere: null,
  routingRecordSeen: false,
  sslVerified: false,
  recordConflict: false,
  revoked: false,
  ownerAuthorization: "none",
};

const custom = (over: Partial<WebDomainObservations>): WebDomainObservations => ({
  ...base, customDomain: "www.acme-coaching.com", ...over,
});

describe("classifyWebDomain — the ladder and its truths", () => {
  it("no custom address: a held reserved address is never called a website", () => {
    const r = classifyWebDomain({ ...base, reservedWebLive: false });
    expect(r.state).toBe("not_started");
    expect(r.headline).toContain("held");
    expect(r.detail).toContain("serves nothing");
    // The word "live" may not appear as a claim about the held address.
    expect(r.headline.toLowerCase()).not.toContain("live");
  });

  it("no custom address, reserved address live: says so without implying a custom one exists", () => {
    const r = classifyWebDomain(base);
    expect(r.state).toBe("not_started");
    expect(r.headline).toContain("Serving at your reserved address");
  });

  it("no custom address, reserved status UNOBSERVED (the card's default): claims nothing either way", () => {
    // A publication receipt proves the artifact's URL, not that the reserved host root serves —
    // so the unobserved default may not say "serving" OR "held" (both would be invented facts).
    const r = classifyWebDomain({ ...base, reservedWebLive: null });
    expect(r.state).toBe("not_started");
    expect(r.headline).toBe("Your reserved address (acme-coaching.paigeagent.ai)");
    expect(r.detail).toContain("isn't checked from this panel");
    expect(r.detail).toContain("the address at the top of this card");
    expect(r.headline.toLowerCase()).not.toContain("serving");
    expect(r.headline.toLowerCase()).not.toContain("held");
    expect(`${r.headline} ${r.detail}`.toLowerCase()).not.toContain("live at");
  });

  it("custom address, TXT unseen: ownership pending, at the AUTHORITATIVE answerer", () => {
    const r = classifyWebDomain(custom({}));
    expect(r.state).toBe("ownership_pending");
    expect(r.detail).not.toContain("not the seller"); // no authority fact observed → no claim about it
  });

  it("ownership pending + authority elsewhere: the record goes to the DNS provider, not the seller", () => {
    const r = classifyWebDomain(custom({ dnsAuthorityElsewhere: true }));
    expect(r.state).toBe("ownership_pending");
    expect(r.detail).toContain("not managed where you bought the domain");
    expect(r.detail).toContain("not the seller");
  });

  it("TXT seen, routing unseen: routing pending, mail records named in the next step", () => {
    const r = classifyWebDomain(custom({ ownershipTxtSeen: true }));
    expect(r.state).toBe("routing_pending");
    expect(r.nextStep).toContain("MX");
    expect(r.nextStep).toContain("DMARC");
  });

  it("routing seen, HTTPS unverified: ssl pending — never called live yet", () => {
    const r = classifyWebDomain(custom({ ownershipTxtSeen: true, routingRecordSeen: true }));
    expect(r.state).toBe("ssl_pending");
    expect(r.headline.toLowerCase()).not.toContain("live at");
  });

  it("all technical checks pass without owner authorization: gated, with the exact decision named", () => {
    const r = classifyWebDomain(custom({ ownershipTxtSeen: true, routingRecordSeen: true, sslVerified: true }));
    expect(r.state).toBe("gated_ready");
    expect(r.detail).toContain("explicit approval");
    const requested = classifyWebDomain(custom({ ownershipTxtSeen: true, routingRecordSeen: true, sslVerified: true, ownerAuthorization: "requested" }));
    expect(requested.state).toBe("gated_ready");
    expect(requested.nextStep).toContain("approval request");
  });

  it("only granted + verified earns the word live", () => {
    const r = classifyWebDomain(custom({ ownershipTxtSeen: true, routingRecordSeen: true, sslVerified: true, ownerAuthorization: "granted" }));
    expect(r.state).toBe("live_verified");
    expect(r.headline).toBe("Live at www.acme-coaching.com");
    // And recovery stays honest in the live state itself.
    expect(r.nextStep).toContain("never keeps calling a dead address live");
  });

  it("conflict outranks the ladder: an address with a colliding record is never 'almost ready'", () => {
    const r = classifyWebDomain(custom({ ownershipTxtSeen: true, routingRecordSeen: true, sslVerified: true, recordConflict: true }));
    expect(r.state).toBe("conflict");
    expect(r.detail).toContain("never overwritten");
  });

  it("revocation outranks the ladder: withdrawn is not retry-pending", () => {
    const r = classifyWebDomain(custom({ ownershipTxtSeen: true, revoked: true }));
    expect(r.state).toBe("revoked");
    expect(r.detail).toContain("fresh decision");
  });
});

describe("guidance content — the six providers and the never-touch rules", () => {
  it("exactly the six owner-named providers, each with TXT + routing + an authority note", () => {
    expect(PROVIDER_PROFILES.map((p) => p.id)).toEqual([
      "cloudflare", "namecheap", "godaddy", "squarespace", "porkbun", "wix",
    ]);
    for (const p of PROVIDER_PROFILES) {
      expect(p.txtWhere.length).toBeGreaterThan(10);
      expect(p.routingWhere).toMatch(/CNAME|ALIAS|A record/);
      expect(p.authorityNote.length).toBeGreaterThan(10);
    }
  });

  it("WIX: a bought domain can point anywhere, and external DNS authority sends you there", () => {
    const wix = PROVIDER_PROFILES.find((p) => p.id === "wix")!;
    expect(wix.authorityNote).toContain("outside Wix");
    expect(wix.authorityNote).toContain("not in Wix");
  });

  it("the mail/authority record list is complete and specific", () => {
    expect(MAIL_AND_AUTHORITY_RECORDS).toEqual([
      "MX", "SPF (TXT)", "DKIM (TXT)", "DMARC (TXT)", "Nameserver (NS)", "DNSSEC",
    ]);
  });

  it("host path: four steps, the owner gate named in step 2, cost line keeps spend owner-gated", () => {
    expect(HOST_PATH_PACKAGE).toHaveLength(4);
    expect(HOST_PATH_PACKAGE[1].detail).toContain("owner-approved");
    expect(HOST_PATH_PACKAGE[3].detail).toContain("never a move");
    expect(HOST_PATH_COST_LINE).toContain("free tier");
    expect(HOST_PATH_COST_LINE).toContain("BEFORE activation");
    expect(HOST_PATH_COST_LINE).toContain("never provisions hosting");
  });

  it("cost line follows the billing supersession: verified free/unlimited facts, metered — never a ceiling", () => {
    // 2026-10-27 supersession (ANT-162 2010d550): no owner-set ceilings; usage is attributed + metered.
    expect(HOST_PATH_COST_LINE).toContain("static-asset requests are free and unlimited");
    expect(HOST_PATH_COST_LINE).toContain("metered, not capped");
    expect(HOST_PATH_COST_LINE).not.toContain("ceiling with alerts");
    expect(HOST_PATH_COST_LINE).not.toMatch(/owner-set ceiling/);
  });

  it("preservation line names every never-touch family and the owner approval", () => {
    for (const rec of ["MX", "SPF", "DKIM", "DMARC", "nameservers", "DNSSEC"]) {
      expect(DNS_PRESERVATION_LINE).toContain(rec);
    }
    expect(DNS_PRESERVATION_LINE).toContain("never changes your DNS");
  });
});

describe("domain-guidance module purity — guidance only, never a DNS client", () => {
  it("the module contains no network or provider-call surface", () => {
    const src = readFileSync("src/solo/studio/domain-guidance.ts", "utf8");
    expect(src).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|WebSocket|supabase|\.rpc\(/);
    // No provider API credentials or mutation vocabulary anywhere in the guidance.
    expect(src).not.toMatch(/api[_-]?key|Bearer|DELETE|PUT https?:/i);
  });
});
