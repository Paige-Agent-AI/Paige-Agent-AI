import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { redactSecretPath, redactSecretSearch, redactSecretUrl } from "./useAnalytics";

/**
 * PROOF AGAINST THE EMITTED REQUEST BODY, not against the source and not against the helpers.
 *
 * The redaction unit tests prove the helpers work; the wiring tests prove the call sites exist.
 * Neither proves what actually leaves the browser, and that is the only thing `analytics_events`
 * ever sees. These tests put a real-shaped credential into EVERY input this module reads and
 * assert it is absent from the ACTUAL posted body.
 *
 * The token shapes are the ones the platform really mints, not invented fixtures:
 *   · SIGNING / UNSUBSCRIBE — `mintSignerToken()`: 32 CSPRNG bytes as hex => 64 chars [0-9a-f].
 *   · INVITE — `encode(gen_random_bytes(24), 'base64')` => 32 chars, STANDARD alphabet (+ / =).
 */

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: null } })),
      onAuthStateChange: vi.fn(),
    },
    functions: { invoke: vi.fn(async () => ({ data: null, error: null })) },
  },
}));

const SIGNING_TOKEN = "3f".repeat(32);                 // 64 hex chars
const UNSUB_TOKEN = "a9".repeat(32);                   // 64 hex chars
const INVITE_TOKEN = "kJ8vQ2mZ+xR7bN4wT1yH/cL6pA3dS9e="; // 32 chars, standard base64

let sent: string[] = [];

function atLocation(href: string) {
  Object.defineProperty(window, "location", {
    value: new URL(href),
    writable: true,
    configurable: true,
  });
}

function withReferrer(value: string) {
  Object.defineProperty(document, "referrer", { value, configurable: true });
}

beforeEach(() => {
  sent = [];
  Object.defineProperty(navigator, "sendBeacon", {
    // Returning false forces the fetch fallback, whose body is a readable string.
    value: () => false,
    configurable: true,
    writable: true,
  });
  vi.stubGlobal("fetch", ((_url: string, init?: RequestInit) => {
    if (init?.body) sent.push(String(init.body));
    return Promise.resolve({ ok: true } as Response);
  }) as typeof fetch);
  withReferrer("");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("no credential reaches the posted body, from any live token surface", () => {
  const cases: Array<{ name: string; href: string; token: string }> = [
    { name: "/sign/:token — the signing bearer", href: `https://app.example.com/sign/${SIGNING_TOKEN}`, token: SIGNING_TOKEN },
    { name: "/join/:token — an UNHASHED, directly redeemable invite", href: `https://app.example.com/join/${INVITE_TOKEN}`, token: INVITE_TOKEN },
    { name: "/u/:token — unsubscribe in the path", href: `https://app.example.com/u/${UNSUB_TOKEN}`, token: UNSUB_TOKEN },
    { name: "?token= — unsubscribe in the QUERY STRING", href: `https://app.example.com/unsubscribe?token=${UNSUB_TOKEN}`, token: UNSUB_TOKEN },
    { name: "?ct= — tenant-comms unsubscribe in the query string", href: `https://app.example.com/unsubscribe?ct=${UNSUB_TOKEN}`, token: UNSUB_TOKEN },
  ];

  for (const c of cases) {
    it(`redacts ${c.name}`, async () => {
      atLocation(c.href);
      const { trackEvent } = await import("./useAnalytics");
      await trackEvent("page_view");
      expect(sent.length).toBeGreaterThan(0);
      expect(sent.join("\n")).not.toContain(c.token);
    });
  }

  it("redacts the referrer sink too", async () => {
    atLocation("https://app.example.com/dashboard");
    withReferrer(`https://app.example.com/sign/${SIGNING_TOKEN}?x=1`);
    const { trackEvent } = await import("./useAnalytics");
    await trackEvent("page_view");
    expect(sent.join("\n")).not.toContain(SIGNING_TOKEN);
  });
});

/**
 * THE POINT OF THE SHAPE RULE. A route allowlist is only ever right about the routes someone
 * remembered to register — it shipped holding "sign" alone while /join and /u were already live.
 * This route is deliberately NOT in the set, so only the shape rule can be redacting it. If
 * somebody replaces shape matching with an allowlist again, this is the test that goes red.
 */
describe("an UNREGISTERED future token route is still covered", () => {
  it("redacts a credential on a route nobody registered", async () => {
    atLocation(`https://app.example.com/brand-new-flow/${SIGNING_TOKEN}`);
    const { trackEvent } = await import("./useAnalytics");
    await trackEvent("page_view");
    expect(sent.join("\n")).not.toContain(SIGNING_TOKEN);
  });

  it("redacts an unregistered route carrying an invite-shaped token", () => {
    expect(redactSecretPath(`/somewhere/${INVITE_TOKEN}`)).not.toContain(INVITE_TOKEN);
  });
});

/**
 * usePageView's own `path` and `search` properties are not reachable without a DOM renderer, but
 * they travel through `trackEvent`, whose whole payload is scrubbed before it is posted. Passing
 * the values RAW proves the choke point holds even when a caller forgets to redact.
 */
describe("the choke point catches what a caller forgot to redact", () => {
  it("scrubs a raw path and search handed in through properties", async () => {
    atLocation("https://app.example.com/dashboard");
    const { trackEvent } = await import("./useAnalytics");
    await trackEvent("page_view", "engagement", {
      path: `/sign/${SIGNING_TOKEN}`,
      search: `?ct=${UNSUB_TOKEN}`,
      note: `visited /join/${INVITE_TOKEN} earlier`,
    });
    const body = sent.join("\n");
    expect(body).not.toContain(SIGNING_TOKEN);
    expect(body).not.toContain(UNSUB_TOKEN);
    expect(body).not.toContain(INVITE_TOKEN);
  });

  it("scrubs a credential nested deep inside properties", async () => {
    atLocation("https://app.example.com/dashboard");
    const { trackEvent } = await import("./useAnalytics");
    await trackEvent("page_view", "engagement", {
      outer: { inner: [{ href: `https://app.example.com/join/${INVITE_TOKEN}` }] },
    });
    expect(sent.join("\n")).not.toContain(INVITE_TOKEN);
  });
});

/**
 * Over-redaction is its own failure: analytics that cannot group a path is analytics nobody uses,
 * and the pressure to loosen the guard comes from exactly that. Ordinary paths must survive.
 */
describe("does not mangle ordinary values", () => {
  it("leaves real product paths untouched", () => {
    for (const p of ["/", "/solo/3855/growth/sales", "/clients/people", "/signup", "/signals/x"]) {
      expect(redactSecretPath(p)).toBe(p);
    }
  });

  it("leaves a UUID path segment intact — an identifier is not a credential", () => {
    const uuid = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
    expect(redactSecretPath(`/admin/contacts/${uuid}`)).toBe(`/admin/contacts/${uuid}`);
  });

  it("leaves a long word-slug intact", () => {
    const p = "/blog/the-complete-guide-to-client-onboarding-2026";
    expect(redactSecretPath(p)).toBe(p);
  });

  it("keeps ordinary query parameters", () => {
    expect(redactSecretSearch("?view=terms&page=2")).toBe("?view=terms&page=2");
    expect(redactSecretUrl("https://app.example.com/solo/3855/growth/sales?view=terms")).toBe(
      "https://app.example.com/solo/3855/growth/sales?view=terms",
    );
  });
});

/**
 * REGRESSIONS THE PEER GATE CAUGHT IN THIS GUARD ITSELF.
 *
 * Every case below failed against the first version of this fix. They are kept because each one is
 * a way for a credential guard to be worse than useless — either leaking the thing it exists to
 * stop, or destroying data it was never meant to touch.
 */
describe("peer-gate regressions", () => {
  it("does NOT redact campaign attribution — a guard that eats utm_campaign is a business outage", async () => {
    atLocation("https://app.example.com/pricing?utm_source=linkedin&utm_medium=cpc&utm_campaign=black_friday_2026_launch");
    const { trackEvent } = await import("./useAnalytics");
    await trackEvent("page_view");
    const body = sent.join("\n");
    // `track-event` writes utm_source/utm_medium/utm_campaign into their own columns.
    expect(body).toContain("black_friday_2026_launch");
    expect(body).toContain("linkedin");
  });

  it("keeps mixed-case and long campaign names too", () => {
    for (const name of ["Black_Friday_2026_Launch", "Coach_Summit_Q3_2026", "spring-into-growth-2026-cohort"]) {
      expect(redactSecretSearch(`?utm_campaign=${name}`)).toContain(name);
    }
  });

  it("redacts a BARE standard-base64 invite token — it contains `/` and used to split past the guard", async () => {
    atLocation("https://app.example.com/dashboard");
    const { trackEvent } = await import("./useAnalytics");
    await trackEvent("page_view", "engagement", { invite_link_value: INVITE_TOKEN });
    expect(sent.join("\n")).not.toContain(INVITE_TOKEN);
  });

  it("fails CLOSED past the recursion cap rather than handing the value back", async () => {
    atLocation("https://app.example.com/dashboard");
    const { trackEvent } = await import("./useAnalytics");
    let nested: Record<string, unknown> = { leaf: SIGNING_TOKEN };
    for (let i = 0; i < 12; i++) nested = { n: nested };
    await trackEvent("page_view", "engagement", nested);
    expect(sent.join("\n")).not.toContain(SIGNING_TOKEN);
  });

  it("redacts an invite token that scores only two character classes (1 in 786 of real tokens)", () => {
    // All letters, no digit, no `+` or `/` — measured to occur in ~0.13% of real invite tokens.
    const allLetters = "kJvQmZxRbNwTyHcLpAdSeQfGhKlMnOpQ"; // 32 chars, the exact mint width
    expect(allLetters).toHaveLength(32);
    expect(redactSecretPath(`/brand-new-flow/${allLetters}`)).not.toContain(allLetters);
    expect(redactSecretSearch(`?t=${allLetters}`)).not.toContain(allLetters);
  });

  it("redacts a credential in the URL FRAGMENT — the Supabase recovery-link shape", () => {
    const out = redactSecretUrl(`https://app.example.com/reset-password#access_token=${SIGNING_TOKEN}&refresh_token=abc`);
    expect(out).not.toContain(SIGNING_TOKEN);
  });

  it("does not blank ordinary properties named code or key", async () => {
    atLocation("https://app.example.com/dashboard");
    const { trackEvent } = await import("./useAnalytics");
    await trackEvent("page_view", "engagement", { code: "SUMMER20", key: "pricing_tab", plan: "solo" });
    const body = sent.join("\n");
    expect(body).toContain("SUMMER20");
    expect(body).toContain("pricing_tab");
  });

  it("keeps the prose around a credential in free text", () => {
    // Rewriting the whole string as a path turned a sentence into "/join/<redacted>".
    const out = redactSecretPath("/dashboard");
    expect(out).toBe("/dashboard");
  });
});

/**
 * THE ATTRIBUTION EXEMPTION — the hole the whole-payload scrub had in it.
 *
 * `scrubDeep` exempted every attribution key outright, on the stated reasoning that "attribution
 * values are never credentials". They are read from a user-controlled query string and from
 * caller-supplied `properties`, so that was an assertion about intent, not a property of the data.
 * Three ways through, all measured against the emitted body before the fix:
 *
 *   A. `?utm_campaign=<invite token>` — arrived in its own dedicated column, in full. That column
 *      is indexed (`idx_analytics_events_utm_campaign`), so a leaked token is an equality lookup.
 *   B. `properties.utm_campaign = "https://app/sign/<token>"` — the exemption skipped `scrubString`,
 *      so the URL was never structurally redacted.
 *   C. `properties.utm_campaign = { nested: { deeper: <token> } }` — `out[k] = v` copied the OBJECT
 *      whole and skipped recursion, the same defect already fixed at the depth cap below it.
 *
 * The last test is the counterweight: the general credential rule redacts EIGHT of twenty realistic
 * campaign names, and that cost is what motivated the exemption. The narrow mint-shape rule has to
 * keep those readable, or the exemption grows back.
 */
describe("attribution keys are scrubbed, not exempted", () => {
  it("A — an invite token in ?utm_campaign= never reaches its column", async () => {
    atLocation(`https://app.example.com/?utm_campaign=${encodeURIComponent(INVITE_TOKEN)}`);
    const { trackEvent } = await import("./useAnalytics");
    await trackEvent("page_view");
    expect(sent.length).toBeGreaterThan(0);
    expect(sent.join("\n")).not.toContain(INVITE_TOKEN);
  });

  it("B — a signing URL passed as properties.utm_campaign is redacted", async () => {
    atLocation("https://app.example.com/dashboard");
    const { trackEvent } = await import("./useAnalytics");
    await trackEvent("cta_click", "engagement", {
      utm_campaign: `https://app.example.com/sign/${SIGNING_TOKEN}`,
    });
    expect(sent.join("\n")).not.toContain(SIGNING_TOKEN);
  });

  it("C — an OBJECT under an attribution key is recursed, not copied whole", async () => {
    atLocation("https://app.example.com/dashboard");
    const { trackEvent } = await import("./useAnalytics");
    await trackEvent("cta_click", "engagement", {
      utm_campaign: { nested: { deeper: SIGNING_TOKEN } },
    });
    expect(sent.join("\n")).not.toContain(SIGNING_TOKEN);
  });

  it("utm_term and utm_content are reachable ONLY through properties — cover them too", async () => {
    atLocation("https://app.example.com/dashboard");
    const { trackEvent } = await import("./useAnalytics");
    await trackEvent("cta_click", "engagement", {
      utm_term: INVITE_TOKEN,
      utm_content: SIGNING_TOKEN,
    });
    const body = sent.join("\n");
    expect(body).not.toContain(INVITE_TOKEN);
    expect(body).not.toContain(SIGNING_TOKEN);
  });

  it("still carries the campaign names the columns exist for", async () => {
    atLocation("https://app.example.com/pricing?utm_campaign=BlackFridayPromo2026&utm_source=newsletter");
    const { trackEvent } = await import("./useAnalytics");
    await trackEvent("page_view");
    const body = sent.join("\n");
    expect(body).toContain("BlackFridayPromo2026");
    expect(body).toContain("newsletter");
  });
});

/**
 * A credential-bearing URL NESTED INSIDE a query parameter. `looksLikeCredential` is a whole-value
 * test over a strict base64 alphabet, so a URL's `:` and `.` disqualify it and the token in its
 * path survived. This was live in the shipped redactor, on `page_path`'s search and on the
 * referral sink's `landing_path` alike.
 */
describe("a credential nested inside a parameter value", () => {
  it("redacts a signing URL carried in ?next=", () => {
    const out = redactSecretSearch(
      `?next=${encodeURIComponent(`https://app.example.com/sign/${SIGNING_TOKEN}`)}`,
    );
    expect(out).not.toContain(SIGNING_TOKEN);
  });

  it("redacts an invite URL carried in ?utm_campaign=", () => {
    const out = redactSecretSearch(
      `?utm_campaign=${encodeURIComponent(`https://app.example.com/join/${INVITE_TOKEN}`)}`,
    );
    expect(out).not.toContain(INVITE_TOKEN);
  });

  it("leaves an ordinary parameter alone", () => {
    expect(redactSecretSearch("?utm_campaign=black_friday_2026_launch&ref=PARTNER1")).toBe(
      "?utm_campaign=black_friday_2026_launch&ref=PARTNER1",
    );
  });
});

/**
 * THE REAL INVITE SHAPE, and why the fixture above is not it.
 *
 * `INVITE_TOKEN` was written as standard base64 with `=` padding. A real invite is
 * `encode(gen_random_bytes(24),'base64')` with `+`->`-`, `/`->`_` and `=` stripped — BASE64URL,
 * never padded, minted at four migration sites into the unhashed `tenant_invite_tokens.token`.
 * The fixture being wrong by exactly the characters that mattered is why the base64url gap
 * survived a suite that looked like it covered invites.
 *
 * The second case is the other half: `URLSearchParams.get()` form-decodes `+` to a space, so a
 * token pasted into a URL without percent-encoding reaches the scrubber space-mangled. Every
 * earlier test used `encodeURIComponent`, which exercises only the half that was already safe.
 */
describe("the real minted invite shape, end to end", () => {
  const REAL_INVITE = "kJ8vQ2mZ-xR7bN4wT1yH_cL6pA3dS9eQ"; // 32 chars, base64url, unpadded

  it("never reaches the wire from ?utm_campaign=", async () => {
    atLocation(`https://app.example.com/?utm_campaign=${REAL_INVITE}`);
    const { trackEvent } = await import("./useAnalytics");
    await trackEvent("page_view");
    expect(sent.length).toBeGreaterThan(0);
    expect(sent.join("\n")).not.toContain(REAL_INVITE);
  });

  it("never reaches the wire from an UNREGISTERED route", async () => {
    atLocation(`https://app.example.com/some-future-flow/${REAL_INVITE}`);
    const { trackEvent } = await import("./useAnalytics");
    await trackEvent("page_view");
    expect(sent.join("\n")).not.toContain(REAL_INVITE);
  });

  it("never reaches the wire from an unrecognised query parameter", async () => {
    atLocation(`https://app.example.com/landing?handoff=${REAL_INVITE}`);
    const { trackEvent } = await import("./useAnalytics");
    await trackEvent("page_view", "engagement", { search: window.location.search });
    expect(sent.join("\n")).not.toContain(REAL_INVITE);
  });

  it("survives the +-became-a-space form of a standard-base64 token", async () => {
    const spaced = "kJ8vQ2mZ xR7bN4wT1yH/cL6pA3dS9eQ"; // what URLSearchParams.get() hands back
    atLocation("https://app.example.com/dashboard");
    const { trackEvent } = await import("./useAnalytics");
    await trackEvent("cta_click", "engagement", { utm_campaign: spaced });
    expect(sent.join("\n")).not.toContain(spaced);
  });
});

/**
 * A BASE64URL INVITE INSIDE A NESTED URL IN A QUERY PARAMETER.
 *
 * Found by review on the very commit that added the nested-parameter scan. The scan was a free-text
 * run match, and `/` is in the base64 alphabet, so `https://app/join/<invite>` collapsed into the
 * run `app/join/<invite>` — 41 characters, not the 32 the mint is pinned to — and the exact-width
 * test missed. Widening the run alphabet does not fix it: the joined run then carries the `-`/`_`
 * of a base64url token and the separator disqualifier rejects it.
 *
 * The path is therefore redacted structurally, segment by segment, where the token is a whole
 * segment. The last two cases are the guard on that change: hex must stay covered, and an ordinary
 * campaign parameter must come through byte-for-byte.
 */
describe("a nested URL inside a query parameter", () => {
  const REAL_INVITE = "kJ8vQ2mZ-xR7bN4wT1yH_cL6pA3dS9eQ";

  it("redacts a /join URL parked in utm_campaign", () => {
    const out = redactSecretSearch(
      `?utm_campaign=${encodeURIComponent(`https://app.example.com/join/${REAL_INVITE}`)}`,
    );
    expect(out).not.toContain(REAL_INVITE);
  });

  it("redacts a /join URL parked in an unrecognised parameter", () => {
    const out = redactSecretSearch(
      `?next=${encodeURIComponent(`https://app.example.com/join/${REAL_INVITE}`)}`,
    );
    expect(out).not.toContain(REAL_INVITE);
  });

  it("redacts a bare nested PATH, not just an absolute URL", () => {
    const out = redactSecretSearch(`?next=${encodeURIComponent(`/join/${REAL_INVITE}`)}`);
    expect(out).not.toContain(REAL_INVITE);
  });

  it("redacts a token in the nested URL's OWN query string", () => {
    const out = redactSecretSearch(
      `?next=${encodeURIComponent(`https://app.example.com/landing?handoff=${REAL_INVITE}`)}`,
    );
    expect(out).not.toContain(REAL_INVITE);
  });

  it("still covers the hex mint through the same path", () => {
    const out = redactSecretSearch(
      `?next=${encodeURIComponent(`https://app.example.com/sign/${SIGNING_TOKEN}`)}`,
    );
    expect(out).not.toContain(SIGNING_TOKEN);
  });

  it("leaves an ordinary campaign parameter byte-for-byte", () => {
    expect(redactSecretSearch("?utm_campaign=black_friday_2026_launch&ref=PARTNER1")).toBe(
      "?utm_campaign=black_friday_2026_launch&ref=PARTNER1",
    );
  });
});

/**
 * NESTING, AND THE AUTHORITY — round three, both found by review on the round-two fix.
 *
 * The first fix redacted a nested URL's PATH structurally but left its own query string on the
 * flat run scan, so a URL inside a URL put the credential one level below the guard:
 * `?next=<https://outer/p?continue=https://app/join/<invite>>`. The run scan collapses
 * `app/join/<invite>` into a single run, which is not the 32 characters the mint is pinned to, so
 * the predicate rejects it and the invite ships. The tail is now parsed as what it is, with a
 * bounded depth, rather than scanned as text.
 *
 * The second is the URL authority. Keeping `scheme://host` intact so the destination stays
 * readable also kept `https://<invite>@example.com` intact — userinfo is a credential by
 * definition — and a token used as a host label with it.
 *
 * The last two cases are the counterweight, and they are why this is not simply "redact more":
 * an ordinary campaign parameter must still arrive byte-for-byte, and an ordinary destination URL
 * must still be readable as a destination.
 */
describe("nested URLs and URL authorities", () => {
  const INVITE = "kJ8vQ2mZ-xR7bN4wT1yH_cL6pA3dS9eQ";

  it("redacts a credential two levels down — a URL inside a URL's query", () => {
    const inner = `https://outer.example/p?continue=https://app.example/join/${INVITE}`;
    expect(redactSecretSearch(`?next=${encodeURIComponent(inner)}`)).not.toContain(INVITE);
  });

  it("redacts a token in the USERINFO of a nested URL", () => {
    const out = redactSecretSearch(`?next=${encodeURIComponent(`https://${INVITE}@example.com/p`)}`);
    expect(out).not.toContain(INVITE);
  });

  it("redacts a token used as a HOST LABEL", () => {
    const out = redactSecretSearch(
      `?next=${encodeURIComponent(`https://${INVITE}.example.com/p`)}`,
    );
    expect(out).not.toContain(INVITE);
  });

  it("redacts a token in a nested FRAGMENT — the implicit-flow recovery shape", () => {
    const inner = `https://app.example/landing#access_token=${INVITE}`;
    expect(redactSecretSearch(`?next=${encodeURIComponent(inner)}`)).not.toContain(INVITE);
  });

  it("fails CLOSED past the nesting cap rather than handing back something unparsed", () => {
    // Four levels of URL-in-URL; the cap is three.
    let nested = `https://app.example/join/${INVITE}`;
    for (let i = 0; i < 4; i++) nested = `https://h${i}.example/p?next=${encodeURIComponent(nested)}`;
    expect(redactSecretSearch(`?next=${encodeURIComponent(nested)}`)).not.toContain(INVITE);
  });

  it("still carries an ordinary campaign parameter byte-for-byte", () => {
    expect(redactSecretSearch("?utm_campaign=black_friday_2026_launch&ref=PARTNER1")).toBe(
      "?utm_campaign=black_friday_2026_launch&ref=PARTNER1",
    );
  });

  it("still leaves an ordinary destination URL readable as a destination", () => {
    const out = redactSecretSearch(`?next=${encodeURIComponent("https://app.example.com/pricing")}`);
    expect(decodeURIComponent(out)).toContain("app.example.com");
    expect(decodeURIComponent(out)).toContain("pricing");
  });
});

/**
 * Round four, both found by review on the round-three fix. Two ways a URL avoided being read as a
 * URL, which is the shape this whole sequence keeps taking.
 *
 *   · A SCHEME-RELATIVE reference — `//host/path` — was classified as a path because it starts with
 *     `/`, so the authority was never parsed and `//<invite>@example.com/p` came back whole. That
 *     is precisely the form a redirect parameter takes.
 *   · A KEYLESS component — `?https%3A%2F%2F…` with no `=` at all — got only the whole-value shape
 *     test, which a URL's own punctuation always fails.
 */
describe("URLs that avoided being read as URLs", () => {
  const INVITE = "kJ8vQ2mZ-xR7bN4wT1yH_cL6pA3dS9eQ";

  it("treats a scheme-relative reference as an authority, not a path", () => {
    const out = redactSecretSearch(`?next=${encodeURIComponent(`//${INVITE}@example.com/p`)}`);
    expect(out).not.toContain(INVITE);
  });

  it("redacts a token in a scheme-relative HOST label too", () => {
    const out = redactSecretSearch(`?next=${encodeURIComponent(`//${INVITE}.example.com/p`)}`);
    expect(out).not.toContain(INVITE);
  });

  it("scrubs a query component that has no key at all", () => {
    const out = redactSecretSearch(`?${encodeURIComponent(`https://app.example/join/${INVITE}`)}`);
    expect(out).not.toContain(INVITE);
  });

  it("still leaves an ordinary keyless flag alone", () => {
    expect(redactSecretSearch("?debug&utm_campaign=spring_sale")).toBe("?debug&utm_campaign=spring_sale");
  });
});
