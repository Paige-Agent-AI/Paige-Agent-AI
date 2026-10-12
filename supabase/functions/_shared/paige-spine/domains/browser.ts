import type { SpineCapability } from "../contracts.ts";

// PC-1 — the governed registration of the EXISTING browse_public_url skill: the 2026-08-16 S3b
// research-browse path (run_skill → skill-runner interpreter → paige-browser /browse-public-url,
// read-only by construction, per-request isolated contexts, connect-time egress proxy, redacted
// audit rail, capability receipts). DECLARATION ONLY — no chat tool exists or is created here
// (the §36 chat-loop integration decision stands; a competing chat tool controller is explicitly
// out of scope for PC-1), which is why chatBinding is UNAVAILABLE rather than LIVE.
//
// The executor names the edge function that hosts the interpreter seam. Risk classification
// matches the seeded Trust Compass action kind tech.browse_public (requires_approval=false,
// record_only) and the skill row's risk_level read_only / autonomy auto: a READ with the
// read_only policy and no approval authority. Activation remains owner-held
// (PAIGE_BROWSER_WILDCARD_ENABLED + the tenant capability flag); with those off the registered
// capability is honestly inert.
export const BROWSER_CAPABILITIES: readonly SpineCapability[] = [
  {
    key: "browser.browse_public_url",
    domain: "browser",
    owner: "paige-skill-runner",
    humanSurface: "PAIGE workspace",
    readiness: "none",
    selfDescribe: false,
    action: {
      classification: "read",
      executor: "edge.skill-runner",
      seatAuthority: "member",
      idempotency:
        "read-only public-URL observation through the existing interpreter; the append-only paige_browser_usage rail row is the durable record; no tenant rows are mutated",
      riskPolicyKey: "read_only",
      approvalAuthority: "none",
    },
    chatBinding: "UNAVAILABLE",
    mindBinding: "UNAVAILABLE",
    sharedPrimitiveChange: "NONE",
    maturity: "PARTIAL",
  },
];
