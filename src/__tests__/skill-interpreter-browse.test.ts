import { describe, it, expect } from "vitest";
// S1b browser-dispatch DECISION helpers live in the pure core (no Deno imports) so vitest can guard
// them as the CI regression for the §16 risk floor, the §37 allowed_tools gate, and the §13 honest
// fold. The full end-to-end dispatch RUN (deps.browse called, ledger insert+update, needs_config
// degrade) is proven by the Deno smoke — scripts/skill-interpreter-browse-smoke.ts — because the
// orchestrator imports the esm.sh/Deno forge chain that vitest can't resolve.
import {
  pickBrowserStep,
  browserToolAllowed,
  browseGatePermits,
  foldBrowserObservation,
  pickPublicBrowseStep,
  isHttpUrl,
  foldPublicBrowse,
  redactUrlForAudit,
  scrubSecretLikeText,
  type SkillRow,
  type BrowseObservation,
  type PublicBrowseObservation,
} from "../../supabase/functions/_shared/skill-interpreter-core";

function skill(partial: Partial<SkillRow>): SkillRow {
  return {
    slug: "x", name: "X", category: null, risk_level: null, autonomy_lane: null,
    methodology_anchor: null, scoping: null, tier_availability: null, steps: null, allowed_tools: null,
    ...partial,
  };
}

describe("pickBrowserStep — the §18 tool-detection idiom", () => {
  it("finds a tool:'browser' step (case-insensitive) and returns null otherwise", () => {
    const s = skill({ steps: [{ tool: "context" }, { tool: "Browser", url: "https://a.co" }] });
    expect(pickBrowserStep(s)?.url).toBe("https://a.co");
    expect(pickBrowserStep(skill({ steps: [{ tool: "context" }] }))).toBeNull();
    expect(pickBrowserStep(skill({ steps: null }))).toBeNull();
  });
  it("§58 — EXCLUDES a mode:'public' step (that routes to the S3b public path, not self-verify)", () => {
    const s = skill({ steps: [{ tool: "browser", mode: "public", url: "https://pub.co" }] });
    expect(pickBrowserStep(s)).toBeNull();
    // a mixed plan still returns the self-verify (mode-less) step, never the public one
    const mixed = skill({ steps: [{ tool: "browser", mode: "public", url: "https://pub.co" }, { tool: "browser", url: "https://self.co" }] });
    expect(pickBrowserStep(mixed)?.url).toBe("https://self.co");
  });
});

describe("pickPublicBrowseStep — S3b routes ONLY a mode:'public' browser step", () => {
  it("finds the mode:'public' step (case-insensitive) and returns null otherwise", () => {
    const s = skill({ steps: [{ tool: "context" }, { tool: "Browser", mode: "PUBLIC" }] });
    expect(pickPublicBrowseStep(s)).not.toBeNull();
    // a self-verify (mode-less) browser step is NOT a public step
    expect(pickPublicBrowseStep(skill({ steps: [{ tool: "browser", url: "https://a.co" }] }))).toBeNull();
    expect(pickPublicBrowseStep(skill({ steps: null }))).toBeNull();
  });
});

describe("isHttpUrl — only http(s) URLs are dispatchable (§13 honest guard)", () => {
  it("accepts http/https and rejects everything else", () => {
    expect(isHttpUrl("https://example.com/x")).toBe(true);
    expect(isHttpUrl("http://example.com")).toBe(true);
    expect(isHttpUrl("file:///etc/passwd")).toBe(false);
    expect(isHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isHttpUrl("not a url")).toBe(false);
    expect(isHttpUrl("")).toBe(false);
    expect(isHttpUrl(null)).toBe(false);
    expect(isHttpUrl(undefined)).toBe(false);
  });
});

describe("foldPublicBrowse — §13 honest fold of the research shape", () => {
  it("renders only the fields the public browse actually returned", () => {
    const obs: PublicBrowseObservation = {
      ok: true, final_url: "https://a.co/x", http_status: 200, title: "T",
      meta_description: "a page about things", h1_headers: ["Hello", "World"],
      body_text: "the body text", links_inventory: [{ text: "Home", href: "https://a.co" }],
    };
    const out = foldPublicBrowse(obs);
    expect(out).toContain("final_url: https://a.co/x");
    expect(out).toContain("http_status: 200");
    expect(out).toContain("meta: a page about things");
    expect(out).toContain("Hello | World");
    expect(out).toContain("the body text");
    expect(out).toContain("Home → https://a.co");
  });
  it("reports a BLOCKED observation with its honest reason (never a fake page)", () => {
    const out = foldPublicBrowse({ ok: false, blocked_reason: "ssrf:link-local:metadata", final_url: "http://169.254.169.254/" });
    expect(out).toContain("BLOCKED/FAILED");
    expect(out).toContain("ssrf:link-local:metadata");
  });
  it("falls back to error when there is no blocked_reason on a failure", () => {
    const out = foldPublicBrowse({ ok: false, error: "navigation failed" });
    expect(out).toContain("BLOCKED/FAILED");
    expect(out).toContain("navigation failed");
  });
});

describe("browserToolAllowed — §37 allowed_tools is actually executed", () => {
  it("only true when 'browser' is granted in allowed_tools", () => {
    expect(browserToolAllowed(skill({ allowed_tools: ["browser"] }))).toBe(true);
    expect(browserToolAllowed(skill({ allowed_tools: ["BROWSER", "rag"] }))).toBe(true);
    expect(browserToolAllowed(skill({ allowed_tools: ["rag"] }))).toBe(false);
    expect(browserToolAllowed(skill({ allowed_tools: null }))).toBe(false);
  });
});

describe("browseGatePermits — §16 risk floor BEFORE navigating", () => {
  it("permits a read_only browse under auto, but NEVER a write-class one", () => {
    expect(browseGatePermits("auto", "read_only")).toBe(true);
    expect(browseGatePermits("auto", "draft")).toBe(true);
    // write-class can never resolve to execute → browse gated
    expect(browseGatePermits("auto", "mutating")).toBe(false);
    expect(browseGatePermits("auto", "external_send")).toBe(false);
  });
  it("does not navigate when the run wouldn't auto-execute (confirm/off/unknown lane)", () => {
    expect(browseGatePermits("confirm", "read_only")).toBe(false);
    expect(browseGatePermits("off", "read_only")).toBe(false);
    expect(browseGatePermits(null, "read_only")).toBe(false);
  });
});

describe("foldBrowserObservation — §13 honest fold, never a fabricated result", () => {
  it("renders only the fields the browse actually returned", () => {
    const obs: BrowseObservation = {
      ok: true, final_url: "https://a.co/x", http_status: 200, title: "T",
      text_excerpt: "hello world", steps: [{ kind: "assertText", ok: true, detail: "found" }],
    };
    const out = foldBrowserObservation(obs);
    expect(out).toContain("final_url: https://a.co/x");
    expect(out).toContain("http_status: 200");
    expect(out).toContain("hello world");
    expect(out).toContain("step[assertText]: ok");
  });
  it("reports a FAILED observation honestly (no fake success)", () => {
    const out = foldBrowserObservation({ ok: false, error: "navigation failed" });
    expect(out).toContain("FAILED");
    expect(out).toContain("navigation failed");
  });
  it("emits nothing when there is no real content beyond the header", () => {
    expect(foldBrowserObservation({ ok: true })).toBe("");
  });
});

describe("redactUrlForAudit — PC-1 audit redaction (secrets never reach the rail)", () => {
  it("keeps scheme+host+path and replaces the query with a param-count marker", () => {
    expect(redactUrlForAudit("https://portal.example.gov/filing/123?token=abc123&sig=xyz")).toBe(
      "https://portal.example.gov/filing/123?_redacted=2",
    );
    expect(redactUrlForAudit("https://a.co/x")).toBe("https://a.co/x");
  });
  it("redacts fragments and userinfo (both can carry credentials)", () => {
    expect(redactUrlForAudit("https://a.co/p#access_token=zzz")).toBe("https://a.co/p#_redacted");
    expect(redactUrlForAudit("https://user:pass@a.co/p")).toBe("https://a.co/p");
  });
  it("redacts opaque token-shaped path segments but keeps readable slugs (review follow-up)", () => {
    expect(redactUrlForAudit("https://a.co/invite/eNcRyPtEdToKeN123456")).toBe("https://a.co/invite/[token]");
    expect(redactUrlForAudit("https://a.co/filing/6ba7b810-9dad-11d1-80b4-00c04fd430c8")).toBe("https://a.co/filing/[token]");
    expect(redactUrlForAudit("https://a.co/annual-report-2026")).toBe("https://a.co/annual-report-2026");
    expect(redactUrlForAudit("https://a.co/infrastructure-modernization")).toBe("https://a.co/infrastructure-modernization");
    expect(redactUrlForAudit("https://a.co/filing/123")).toBe("https://a.co/filing/123");
  });
  it("caps runaway paths and answers unparseable input honestly", () => {
    const long = "https://a.co/" + "x".repeat(400);
    expect(redactUrlForAudit(long).length).toBeLessThanOrEqual("https://a.co/".length + 301);
    expect(redactUrlForAudit("not a url")).toBe("_unparseable_url_redacted");
    expect(redactUrlForAudit("https://a.co/x?token=1&code=2&state=3&nonce=4")).toBe("https://a.co/x?_redacted=4");
  });
});

describe("scrubSecretLikeText — PC-1 model-fold scrubbing", () => {
  it("scrubs key=value secrets, bearer headers, opaque runs and card-like digits", () => {
    const page = "Sign in api_key=sk_live_9f3fabcd1234 then Authorization: Bearer eyJhbGciOi.9x card 4111 1111 1111 1111 ok";
    const { scrubbed } = scrubSecretLikeText(page);
    expect(scrubbed).not.toContain("sk_live_9f3fabcd1234");
    expect(scrubbed).not.toContain("eyJhbGciOi.9x");
    expect(scrubbed).not.toContain("4111");
    expect(scrubbed).toContain("api_key=[redacted]");
    expect(scrubbed).toContain("[redacted]"); // the bearer/jwt material is consumed too (double-scrubbed)
  });
  it("leaves ordinary research prose intact", () => {
    const prose = "The Secretary of State portal charges a $50 filing fee and renews annually each April.";
    const { scrubbed, replacements } = scrubSecretLikeText(prose);
    expect(scrubbed).toBe(prose);
    expect(replacements).toBe(0);
  });
  it("reports its replacement count and bounds hostile input", () => {
    const hostile = Array.from({ length: 50 }, (_, i) => `token=abcdef0123456789${i}`).join(" ");
    const { replacements, truncated } = scrubSecretLikeText(hostile, 10);
    expect(replacements).toBeGreaterThanOrEqual(10);
    expect(truncated).toBe(true);
  });
});
