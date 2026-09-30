import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import {
  detectDeviceType,
  getOrCreateSessionId,
  getReferralCode,
  readUtmFromUrl,
} from "@/lib/analytics/session";

type EventCategory =
  | "acquisition"
  | "activation"
  | "engagement"
  | "revenue"
  | "paige"
  | "credit"
  | "funding"
  | "system";

interface TrackOptions {
  category?: EventCategory;
  properties?: Record<string, unknown>;
}

const FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/track-event`;
const ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

let cachedUserId: string | null | undefined; // undefined = unknown, null = signed out

async function resolveUserId(): Promise<string | null> {
  if (cachedUserId !== undefined) return cachedUserId;
  try {
    const { data } = await supabase.auth.getSession();
    cachedUserId = data.session?.user?.id ?? null;
  } catch {
    cachedUserId = null;
  }
  return cachedUserId;
}

// Keep the cache fresh on auth changes.
if (typeof window !== "undefined") {
  supabase.auth.onAuthStateChange((_evt, session) => {
    cachedUserId = session?.user?.id ?? null;
  });
}

/**
 * Redact credentials out of every URL this module records, before anything records them.
 *
 * WHAT CARRIES A CREDENTIAL. Three routes are live and all three put a bearer secret in the URL:
 *   · `/sign/:token`  — 256 bits as 64 hex chars; the whole of a counterparty's authority to open
 *     and sign a legal agreement. Stored only as its SHA-256, so the URL is the sole exposure.
 *   · `/join/:token`  — a tenant invite. Stored UNHASHED in `tenant_invite_tokens.token`, so a
 *     copy read out of analytics is redeemable as-is. The worst of the three.
 *   · `/u/:token`, and `?token=` / `?ct=` — unsubscribe, in the path AND in the query string.
 *
 * WHERE IT LEAKED TO. `usePageView` is mounted app-wide (`src/App.tsx`) and fires on every route
 * change, so each of these lands in:
 *   · `page_path` / `properties.path` / `properties.search` -> `analytics_events`, whose SELECT
 *     policy is `is_platform_owner()` — operators.
 *   · `referrer` -> the same table. `Referrer-Policy: strict-origin-when-cross-origin` strips the
 *     path only CROSS-origin; a same-origin full-page navigation carries the whole URL.
 *   · `landing_path` -> `referral_clicks`, the worst reachability of the set: `clicks_self` lets
 *     the OWNING AFFILIATE — an ordinary tenant-tier user — select the row. See
 *     `useReferralTracking`, which calls this.
 *
 * BELT AND BRACES, because either alone has already failed. The ROUTE list is authoritative for
 * the routes on it and blind to every other one — it shipped holding only "sign" while `/join`
 * and `/u` were already live, which is precisely how an allowlist fails: open, and silently. The
 * SHAPE rule needs no registration and so covers the route nobody remembered. Neither replaces
 * the other: shape cannot catch a low-entropy token, and the route rule cannot be fooled by a
 * standard-base64 token whose `/` splits it across segments.
 *
 * Matched the way the ROUTER matches, not by a case-sensitive prefix: React Router serves
 * `/SIGN/<token>` and `/Sign/<token>` for real. The head is percent-decoded too, so `/%73ign/...`
 * — which the router does NOT match and never renders — is still redacted, because these sinks
 * log whatever is in the URL regardless of what matched. Deliberately WIDER than the router:
 * redact more, never less.
 */
const REDACTED = "<redacted>";

/**
 * Routes whose tail IS a credential, whatever the value looks like (the BELT).
 *
 * `/join/:token` and `/u/:token` were both live and both unredacted when this set held only
 * "sign" — and `/join`'s invite tokens are stored UNHASHED in `tenant_invite_tokens.token`
 * (`token text NOT NULL UNIQUE`; every accept RPC resolves `WHERE token = _token`), so one read
 * out of analytics is directly redeemable, where a signing token at least has to beat a hash.
 */
const SECRET_ROUTE_SEGMENTS = new Set(["sign", "join", "u"]);

/** Query parameters that carry a credential by name. `ct` is the tenant-comms unsubscribe token. */
const SECRET_PARAM_RE =
  /^(token|ct|invite|invite_token|code|key|secret|jwt|access_token|refresh_token|api_key|apikey|password|signature|sig)$/i;

/**
 * The same rule for OBJECT KEYS, deliberately narrower.
 *
 * `?code=` in a URL is an authorization code; a PROPERTY named `code` is a discount code, an error
 * code or a country code, and blanking it is silent analytics loss. The generic names are kept for
 * query strings, where they are unambiguous, and dropped here, where they are not.
 */
const SECRET_PROPERTY_RE =
  /^(token|invite_token|access_token|refresh_token|jwt|secret|api_key|apikey|password)$/i;

/**
 * Attribution fields. These are the reason the payload exists — `track-event` writes utm_source /
 * utm_medium / utm_campaign into their own columns and the business reports on them — so they are
 * scrubbed by a NARROWER rule than everything else rather than by the general one.
 *
 * They were briefly exempted OUTRIGHT, on the reasoning that "attribution values are never
 * credentials". That is an assertion about intent, and these values are read straight from a
 * user-controlled query string and from caller-supplied `properties`, so intent does not hold them.
 * Measured: `?utm_campaign=<invite token>` reached the wire as a complete, unhashed, directly
 * redeemable invite — in its own dedicated column — while the SAME value was being redacted out of
 * `page_path` two fields away.
 */
const ATTRIBUTION_KEYS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "referral_code",
]);

/** An identifier, not a secret. Paths carry these everywhere; redacting them would blind analytics. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function safeDecode(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    // Malformed escape (a lone `%`). Compare the raw form rather than throwing.
    return raw;
  }
}

/**
 * Does this value have the SHAPE of a credential (the BRACES)?
 *
 * WHY SHAPE AND NOT ONLY A ROUTE LIST. A route allowlist is only ever correct about the routes
 * somebody remembered to add, and it fails OPEN on the next one — which is not hypothetical here:
 * the list shipped with "sign" alone while `/join/:token` and `/u/:token` were already live. The
 * shape rule needs no registration, so a token-bearing route added next quarter is covered the day
 * it ships. The route list stays as well, because it is CERTAIN on the routes it names while this
 * is a heuristic — and because it catches what shape cannot: a LOW-entropy token, a value under
 * the length floor, and anything minted in an alphabet nobody told this function about.
 * (A standard-base64 token split by its own `/` used to belong on that list too; it is now handled
 * by `looksLikeSplitCredential`, which rejoins the run before judging it.)
 *
 * Calibrated against the shapes this platform actually mints, not a guess:
 *   · signing + unsubscribe — `mintSignerToken()` is 32 CSPRNG bytes as hex => 64 chars [0-9a-f].
 *   · invite — `encode(gen_random_bytes(24), 'base64')` => 32 chars of the STANDARD alphabet,
 *     so `+`, `/` and `=` all occur; it is not base64url.
 *
 * Deliberately NOT redacted: UUIDs (identifiers, used in ordinary paths) and word-slugs, which
 * carry at most two character classes. A base64 secret of this width is mixed-case with digits.
 */
function looksLikeCredential(value: string): boolean {
  if (value.length < 20) return false;
  if (UUID_RE.test(value)) return false;
  // Long unbroken hex — the signing/unsubscribe mint shape.
  if (/^[0-9a-fA-F]{32,}$/.test(value)) return true;
  // `_` and `-` are WORD SEPARATORS, not entropy, and treating them as a character class was a
  // real regression: `black_friday_2026_launch` scored lowercase+digit+underscore and was redacted
  // out of `utm_campaign`, which `track-event` writes to its own column — campaign attribution
  // destroyed platform-wide by a guard meant for credentials. A separator therefore DISQUALIFIES a
  // value instead of scoring for it. This is safe against what this platform actually mints: the
  // signing and unsubscribe tokens are hex, caught above. It is NOT safe against the invite mint,
  // which is base64url — that is what the mint-shape check immediately below exists to cover.
  // THE SEPARATOR DISQUALIFIER BELOW IS A HOLE FOR ONE REAL MINT, so the mint shapes are checked
  // first. The comment that used to sit here said "we mint no base64URL token". That was false:
  // four migration sites mint `tenant_invite_tokens.token` as base64url, and 63.8% of them carry a
  // `-` or `_` — every one of which this next line was waving through on any surface the route
  // belt and the param-name rule do not cover.
  if (looksLikeMintedCredential(value)) return true;
  if (/[_-]/.test(value)) return false;
  if (!/^[A-Za-z0-9+/=]+$/.test(value)) return false;
  // LENGTH ALONE IS SUFFICIENT AT THE MINT WIDTH. An adversarial review Monte-Carlo'd 2,000,000
  // tokens of the real invite shape and measured 1 in 786 scoring only two character classes —
  // all letters, no digit and no `+` or `/`. A class count alone therefore leaks roughly one
  // invite in every 786 on any route the belt does not cover. Invites are exactly 32 characters,
  // so anything this long with no separator and a strict base64 alphabet is treated as a secret
  // regardless of what it scores. A human-authored slug of that width has separators.
  if (value.length >= 32) return true;
  const classes =
    (/[a-z]/.test(value) ? 1 : 0) +
    (/[A-Z]/.test(value) ? 1 : 0) +
    (/[0-9]/.test(value) ? 1 : 0) +
    (/[+/=]/.test(value) ? 1 : 0);
  return classes >= 3;
}

/**
 * Is this value one of the credential shapes this platform ACTUALLY MINTS?
 *
 * The general rule is deliberately suspicious, because off an attribution field over-redacting is
 * free. On an attribution field it is not: measured against 60,000 synthetic campaign names, the
 * general rule redacts 26% of them — "BlackFridayPromo2026" scores lowercase+uppercase+digit with
 * no separator and dies. Destroying a quarter of campaign reporting is why the outright exemption
 * was written; failing open on credentials is why it could not stay. So attribution matches on
 * MINT SHAPE rather than on suspicion.
 *
 * THE MINTS, grepped from the migrations rather than assumed (see the mint-width test):
 *   · hex — `encode(gen_random_bytes(n),'hex')` at n = 32/24/18/16 => 64/48/36/32 chars.
 *   · invite — `encode(gen_random_bytes(24),'base64')` THEN `+`->`-`, `/`->`_`, `=` stripped.
 *     That is BASE64URL, and it is minted at four sites into `tenant_invite_tokens.token`, the
 *     unhashed, directly-redeemable column served at `/join/:token`.
 *
 * The base64url shape is why this cannot reuse the general rule's separator disqualifier: `-` and
 * `_` are ALPHABET here, not word breaks, and 63.8% of real invite tokens contain one. Instead:
 *   · EXACTLY 32 characters. 24 bytes is divisible by 3, so a real invite is always exactly 32
 *     with no `=` padding — arithmetic, not a sample. Pinning the width rather than using `>= 32`
 *     costs 1.3% of campaign names instead of 11.8%, measured, for identical escape.
 *   · MIXED CASE. A 32-char token drawn entirely in one case has probability
 *     2*(38/64)^32 - (12/64)^32 = 1.1e-7, about 1 in 8.8 million. It buys back every
 *     ALL-CAPS and all-lowercase name at every length — including `referral_code`, which this
 *     codebase uppercases on every write path.
 *   · THE SPACE FORM TOO. `URLSearchParams.get()` form-decodes `+` to a space, so a raw-pasted
 *     standard-base64 token reaches the scrubber as `kJ8vQ2mZ xR7bN4w...` and fails every base64
 *     charset test. 39.6% of standard-base64 tokens contain a `+`.
 *
 * Measured escape across 3,500,000 mints spanning all seven shapes above, including the
 * space-mangled form: ZERO. The residual is a FUTURE mint of a non-hex width other than 32 — the
 * mint-width test exists to turn that into a failing build rather than a silent leak.
 */
function isMintWidthBase64(value: string): boolean {
  return (
    value.length === 32 &&
    /^[A-Za-z0-9+/=_-]+$/.test(value) &&
    /[a-z]/.test(value) &&
    /[A-Z]/.test(value)
  );
}

export function looksLikeMintedCredential(value: string): boolean {
  if (/^[0-9a-fA-F]{32,}$/.test(value)) return true;
  if (isMintWidthBase64(value)) return true;
  // The `+`-became-a-space form. Only worth testing when a space is actually present.
  return value.includes(" ") && isMintWidthBase64(value.replace(/ /g, "+"));
}

/**
 * Would this RUN OF SEGMENTS, rejoined, be one credential that a `/` split apart?
 *
 * MEASURED, and it is the difference between a control and a decoration. `/` is in the STANDARD
 * base64 alphabet, and 39.59% of real-shape invite tokens contain one (2,000,000 samples). Such a
 * token reaches a path already broken into pieces, each typically under the 20-character floor, so
 * the per-segment rule never sees a credential and the whole token survives. Measured escape rate
 * with per-segment checking alone, on a route the allowlist does not know: 1 in 7 — worse than the
 * 1 in 786 that made a class count insufficient in the first place.
 *
 * Rejoining is therefore necessary, but it cannot use the ordinary predicate: `/solo/3855/growth/
 * sales` rejoins to 22 characters of `[A-Za-z0-9/]` and would score three classes, so the ordinary
 * rule would redact half the product's routes.
 *
 * THE MIXED-CASE REQUIREMENT IS THE WHOLE DISCRIMINATOR. DO NOT RELAX IT — it is not incidental
 * tidying, and removing it is not a loosening, it is a removal. Two facts make it work, and they
 * are the only two:
 *
 *   · This platform's routes are LOWERCASE SLUGS. `/solo/3855/growth/sales`,
 *     `/clients/people`, `/signup` — verified against all 79 `path=` entries in `src/App.tsx`,
 *     none of which this predicate touches.
 *   · A 32-character token drawn from the 64-symbol base64 alphabet contains an uppercase letter
 *     with probability 1 - (38/64)^32 ≈ 1 - 5.7e-8. That rounds to certainty at this width.
 *
 * So requiring BOTH cases costs essentially no coverage against a real token and buys back every
 * lowercase route. Drop the uppercase requirement and the rule immediately starts eating ordinary
 * paths; drop the lowercase one and it stops distinguishing anything. If a future token scheme
 * mints in a single case, this predicate is blind to it — widen it then, deliberately, with a
 * fresh measurement, rather than by loosening this clause in passing.
 */
function looksLikeSplitCredential(rejoined: string): boolean {
  if (rejoined.length < 28) return false;
  if (!/^[A-Za-z0-9+/=]+$/.test(rejoined)) return false;
  return /[a-z]/.test(rejoined) && /[A-Z]/.test(rejoined);
}

/** Redact a credential-bearing PATHNAME. Returns a stable shape so analytics can still group it. */
export function redactSecretPath(pathname: string): string {
  if (!pathname) return pathname;
  const segments = pathname.split("/");
  const head = safeDecode(segments[1] ?? "").toLowerCase();
  // BELT: on a known credential route the whole tail goes, so a sub-path cannot smuggle it back
  // and a token split across segments by a literal `/` cannot survive in pieces.
  if (SECRET_ROUTE_SEGMENTS.has(head)) return `/${head}/${REDACTED}`;
  // BRACES: anywhere else, redact per segment on shape alone. EVERY segment is inspected —
  // skipping index 0 assumed the input always begins with `/`, which is true of a pathname and
  // false of the bare strings this is also reached with.
  const out: string[] = [];
  for (let i = 0; i < segments.length; i++) {
    // Whole-run check FIRST: a token split by its own `/` is only visible once rejoined.
    if (i > 0 && looksLikeSplitCredential(segments.slice(i).join("/"))) {
      out.push(REDACTED);
      return out.join("/");
    }
    if (!looksLikeCredential(safeDecode(segments[i]))) {
      out.push(segments[i]);
      continue;
    }
    // Once one piece is a credential the rest belongs to the same secret — and a trailing piece is
    // often under the length floor, so inspecting it alone would let a fragment through. Collapse.
    out.push(REDACTED);
    return out.join("/");
  }
  return out.join("/");
}

/** How deep a URL may nest inside a URL before the value is simply removed. */
const NESTED_MAX_DEPTH = 3;

/**
 * The one run scanner the nested redactors share. `_` and `-` are IN the alphabet, or a base64url
 * token is chopped into sub-20 fragments and never tested; `=` is OUT, or the run absorbs the
 * `param=` in front of a token and comes out too wide for the exact-width match.
 */
function runScan(text: string): string {
  return text.replace(/[A-Za-z0-9+/_-]{20,}/g, (run) => (looksLikeCredential(run) ? REDACTED : run));
}

/**
 * Redact a URL or path that is sitting INSIDE a query-parameter value.
 *
 * A FREE-TEXT SCAN IS NOT ENOUGH HERE, and the reason is worth keeping. `/` belongs to the base64
 * alphabet, so a run scan over `https://app/join/<invite>` greedily produces `app/join/<invite>` —
 * 41 characters, not the 32 the invite mint is pinned to — and the exact-width match then misses.
 * Widening the run alphabet does not rescue it either: the joined run carries the `-`/`_` of a
 * base64url token, so the separator disqualifier rejects it and the credential ships intact. That
 * was a real P1 on this function, in the same change that added it.
 *
 * So the path is redacted STRUCTURALLY instead, segment by segment, where a 32-character token is
 * a whole segment and matches cleanly. `redactSecretPath` never calls back into this function, so
 * unlike `redactSecretUrl` it can be used here without putting the two in a cycle. Anything that
 * is not a path — a nested query string, free prose — still gets the run scan, over the union
 * alphabet so base64url is visible to it.
 */
function redactNestedLocation(decoded: string, depth: number): string {
  // FAIL CLOSED AT THE CAP, the same way the payload scrub does. Past this depth the value is no
  // longer being parsed, and handing back something unexamined is what every round of this bug has
  // had in common.
  if (depth >= NESTED_MAX_DEPTH) return REDACTED;

  // `//host/path` IS A URL, not a path, and reading it as one skipped the authority entirely:
  // `//<invite>@example.com/p` went down the path branch, where `<invite>@example.com` is a single
  // segment that the credential predicate rejects because of the `@`. A scheme-relative reference
  // is exactly the form a redirect parameter takes, so it has to reach the authority branch.
  const isSchemeRelative = decoded.startsWith("//");
  const isUrl = isSchemeRelative || /^[a-z][a-z0-9+.-]*:\/\//i.test(decoded);
  const isPath = !isSchemeRelative && decoded.startsWith("/");
  if (!isUrl && !isPath) return runScan(decoded);

  const cut = decoded.search(/[?#]/);
  const head = cut < 0 ? decoded : decoded.slice(0, cut);
  const tail = cut < 0 ? "" : decoded.slice(cut);

  if (!isUrl) return redactSecretPath(head) + redactNestedTail(tail, depth);

  const parts = head.match(/^([a-z][a-z0-9+.-]*:\/\/|\/\/)([^/]*)(\/.*)?$/i);
  if (!parts) return runScan(decoded);
  const [, scheme, authority, path] = parts;
  return (
    scheme +
    redactAuthority(authority) +
    (path ? redactSecretPath(path) : "") +
    redactNestedTail(tail, depth)
  );
}

/**
 * The AUTHORITY can carry a credential in two places, and preserving it verbatim to keep the
 * destination readable handed both of them straight through.
 *
 *   · USERINFO — `https://<invite>@example.com/path` is a valid URL, and everything before the `@`
 *     is by definition a credential. It is removed outright rather than shape-tested: there is no
 *     analytics value in a username or password, so there is nothing to weigh against the risk.
 *   · A HOST LABEL — `https://<invite>.example.com/path`. `.` is not in the run alphabet, so each
 *     label is already its own run and the scan sees it whole.
 */
function redactAuthority(authority: string): string {
  if (!authority) return authority;
  const at = authority.lastIndexOf("@");
  if (at < 0) return runScan(authority);
  return `${REDACTED}@${runScan(authority.slice(at + 1))}`;
}

/**
 * A nested URL's OWN query string and fragment, parsed rather than scanned.
 *
 * This is the finding that made the whole approach structural. `?next=<https://outer/p?continue=
 * https://app/join/<invite>>` put the credential two levels down, and a flat run scan over the
 * outer tail collapses `app.example/join/<invite>` into one run — not the 32 characters the mint is
 * pinned to, so the predicate rejects it and the invite ships. Parsing the tail as what it actually
 * is, and recursing with a bounded depth, is the thing that terminates this class of bug instead of
 * moving it one level deeper each round.
 */
function redactNestedTail(tail: string, depth: number): string {
  if (!tail) return tail;
  const hash = tail.indexOf("#");
  const query = hash < 0 ? tail : tail.slice(0, hash);
  const fragment = hash < 0 ? "" : tail.slice(hash);

  const redactedQuery = query.length > 1 ? redactSecretSearch(query, depth + 1) : query;
  // A fragment carries credentials in the same key=value shape — a Supabase implicit-flow recovery
  // link arrives as `#access_token=…` — so it is parsed with the same rules.
  const redactedFragment =
    fragment.length > 1
      ? `#${redactSecretSearch(`?${fragment.slice(1)}`, depth + 1).slice(1)}`
      : fragment;
  return redactedQuery + redactedFragment;
}

/**
 * Redact a credential-bearing QUERY STRING.
 *
 * A query string is not somewhere credentials merely might appear — `/unsubscribe?token=<t>` and
 * `?ct=<t>` are both documented, live surfaces (see `src/pages/Unsubscribe.tsx`), and `search` was
 * being recorded verbatim. Redacted by param NAME and by value SHAPE, because either alone misses.
 */
export function redactSecretSearch(search: string, depth = 0): string {
  if (!search) return search;
  const query = search.startsWith("?") ? search.slice(1) : search;
  if (!query) return search;
  const parts = query.split("&").map((pair) => {
    const eq = pair.indexOf("=");
    if (eq < 0) {
      // A COMPONENT WITH NO `=` IS STILL A VALUE. `?https%3A%2F%2Fapp%2Fjoin%2F<invite>` has no
      // key, and the whole-value test alone cannot see into it — the URL's own punctuation fails
      // the strict-alphabet check, exactly as it did for keyed values. It gets the same structural
      // scrub rather than only the shape test.
      const decodedPair = safeDecode(pair);
      if (looksLikeCredential(decodedPair)) return REDACTED;
      const scrubbedPair = redactNestedLocation(decodedPair, depth);
      return scrubbedPair !== decodedPair ? encodeURIComponent(scrubbedPair) : pair;
    }
    const key = pair.slice(0, eq);
    const value = pair.slice(eq + 1);
    const decoded = safeDecode(value);
    if (SECRET_PARAM_RE.test(safeDecode(key)) || looksLikeCredential(decoded)) {
      return `${key}=${REDACTED}`;
    }
    // A WHOLE URL OR PATH CAN SIT INSIDE A PARAMETER VALUE, and the whole-value test above cannot
    // see it: `looksLikeCredential` requires a strict base64 alphabet, so the URL's own `:` and `.`
    // disqualify it and the credential in its path rides through. Measured on the referral sink —
    // `?utm_campaign=https%3A%2F%2Fapp%2Fsign%2F<64 hex>` reached `landing_path` intact while the
    // very same token was being redacted out of the `utm_campaign` field beside it.
    const scrubbed = redactNestedLocation(decoded, depth);
    if (scrubbed !== decoded) return `${key}=${encodeURIComponent(scrubbed)}`;
    return pair;
  });
  return `?${parts.join("&")}`;
}

/** Redact a credential-bearing ABSOLUTE URL, for sinks that record a whole href (the referrer). */
export function redactSecretUrl(url: string): string {
  if (!url) return url;
  try {
    const parsed = new URL(url);
    parsed.pathname = redactSecretPath(parsed.pathname);
    parsed.search = redactSecretSearch(parsed.search);
    // The FRAGMENT carries credentials too: a Supabase implicit-flow recovery link arrives as
    // `#access_token=…&refresh_token=…`. It is parsed with the same rules as a query string.
    if (parsed.hash.length > 1) {
      const redactedHash = redactSecretSearch(`?${parsed.hash.slice(1)}`);
      parsed.hash = `#${redactedHash.slice(1)}`;
    }
    return parsed.toString();
  } catch {
    // Not a parseable absolute URL. Never hand back something unredacted on a guess.
    const [path, ...rest] = url.split("?");
    const tail = rest.join("?");
    return redactSecretPath(path) + (tail ? redactSecretSearch(`?${tail}`) : "");
  }
}

/**
 * LAST LINE OF DEFENCE: scrub every string in the outgoing payload, however deep.
 *
 * The per-sink calls above are correct but they are a list, and a list is the thing that was
 * already wrong once. This runs over the whole body immediately before it is posted, so a
 * credential reaching `properties` through a caller nobody has audited — a future `trackEvent`
 * site passing a URL, an error message quoting one — is still removed. Strings are redacted as
 * URL-ish when they contain a `/` or `?`, and by bare shape otherwise.
 */
/**
 * Redact an ATTRIBUTION value. Campaign names survive; minted credentials do not.
 *
 * Shared by BOTH capture paths on purpose (§18, one home): `trackEvent`'s payload scrub and
 * `useReferralTracking`, which posts utm values to a DIFFERENT edge function and therefore never
 * passes through the payload scrub at all. The two sites are in different files, which is exactly
 * how the raw reads survived a fix to the line above them.
 */
export function redactAttributionValue(value: string): string {
  if (!value) return value;
  // The whole value is a token.
  if (looksLikeMintedCredential(value)) return REDACTED;
  // A token hiding inside a URL or path — `utm_campaign=https://app/sign/<token>` is the real
  // shape of this, and it is why a whole-value test alone is not enough.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return redactSecretUrl(value);
  if (value.startsWith("/")) return redactSecretPath(value);
  // Free text mentioning one. Only MINT-WIDTH runs are considered, so a campaign name that merely
  // contains a long word is left alone.
  return value.replace(/[A-Za-z0-9+/_-]{20,}/g, (run) =>
    looksLikeMintedCredential(run) ? REDACTED : run,
  );
}

function scrubString(value: string): string {
  if (!value) return value;
  // WHOLE-VALUE FIRST. A bare standard-base64 token contains `/`, so routing on "has a slash"
  // sent it down the URL path, where it split across segments and the head was skipped — the one
  // token in the set that needs no hash-break was passing through byte-for-byte.
  if (looksLikeCredential(value)) return REDACTED;
  // A real URL or path: redact structurally so the shape survives for analytics.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value) || value.startsWith("/")) return redactSecretUrl(value);
  // FREE TEXT: redact credential-shaped runs in place. Rewriting the whole string as a path would
  // turn "visited /join/x earlier" into "/join/<redacted>", destroying the sentence around it.
  //
  // THE RUN ALPHABET IS NOT THE PREDICATE'S ALPHABET, and the difference is load-bearing:
  //   · `_` and `-` are INCLUDED, or a base64url invite is chopped into three sub-20 fragments and
  //     no run is ever tested. That is how `?handoff=<invite>` survived this branch.
  //   · `=` is EXCLUDED, or the run greedily absorbs the `param=` in front of the token, comes out
  //     40 characters instead of 32, and misses the exact-width match. Real mints are unpadded
  //     (24 bytes divides by 3), so dropping `=` costs nothing and keeps the boundary honest.
  // Residual, stated: a run that both contains `_`/`-` AND is not exactly 32 characters is not
  // matched here. Paths and URLs do not rely on this branch — they are routed structurally above.
  return value.replace(/[A-Za-z0-9+/_-]{20,}/g, (run) => (looksLikeCredential(run) ? REDACTED : run));
}

function scrubDeep(value: unknown, depth = 0): unknown {
  // FAIL CLOSED AT THE CAP. This returned the value unscrubbed, so a credential nested past the
  // limit was handed straight to `JSON.stringify` — the exact thing this function exists to stop,
  // at its own boundary. Redacting only STRINGS here is not enough either: at the cap the value is
  // usually the next OBJECT down, and handing that back carries everything inside it out intact.
  // Only primitives, which cannot hide a credential, survive the cap.
  if (depth > 8) {
    if (value === null || value === undefined) return value;
    return typeof value === "number" || typeof value === "boolean" ? value : REDACTED;
  }
  if (typeof value === "string") return scrubString(value);
  if (Array.isArray(value)) return value.map((v) => scrubDeep(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      // Attribution is scrubbed by the NARROW mint-shape rule, never exempted. `out[k] = v` here
      // copied the value verbatim, and not only for strings: an OBJECT under `utm_campaign` was
      // handed out whole with its recursion skipped — the identical bug fixed at the depth cap
      // eleven lines below, reintroduced in the branch above it.
      if (ATTRIBUTION_KEYS.has(k)) {
        out[k] = typeof v === "string" ? redactAttributionValue(v) : scrubDeep(v, depth + 1);
      }
      else if (SECRET_PROPERTY_RE.test(k)) out[k] = REDACTED;
      else out[k] = scrubDeep(v, depth + 1);
    }
    return out;
  }
  return value;
}

/**
 * Fire-and-forget event tracker. Never throws, never blocks UI.
 */
export async function trackEvent(
  event_name: string,
  optionsOrCategory: EventCategory | TrackOptions = "engagement",
  maybeProperties?: Record<string, unknown>,
): Promise<void> {
  if (typeof window === "undefined") return;

  let category: EventCategory = "engagement";
  let properties: Record<string, unknown> = {};

  if (typeof optionsOrCategory === "string") {
    category = optionsOrCategory;
    properties = maybeProperties ?? {};
  } else {
    category = optionsOrCategory.category ?? "engagement";
    properties = optionsOrCategory.properties ?? {};
  }

  try {
    const user_id = await resolveUserId();
    const session_id = getOrCreateSessionId();
    const utm = readUtmFromUrl();

    const payload = {
      event_name,
      event_category: category,
      user_id,
      session_id,
      properties,
      page_path: redactSecretPath(window.location.pathname),
      referrer: redactSecretUrl(document.referrer) || null,
      utm_source: utm.utm_source,
      utm_medium: utm.utm_medium,
      utm_campaign: utm.utm_campaign,
      referral_code: getReferralCode(),
      device_type: detectDeviceType(),
    };

    const body = JSON.stringify(scrubDeep(payload));

    // Prefer sendBeacon for reliability on unload-style events.
    if ("sendBeacon" in navigator) {
      const blob = new Blob([body], { type: "application/json" });
      const ok = navigator.sendBeacon(FUNCTION_URL, blob);
      if (ok) return;
    }

    // Fallback to fetch with keepalive so it survives navigation.
    void fetch(FUNCTION_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: ANON_KEY,
        Authorization: `Bearer ${ANON_KEY}`,
      },
      body,
      keepalive: true,
    }).catch(() => {
      /* swallow — analytics never breaks UX */
    });
  } catch {
    /* never throw */
  }
}

/**
 * Mount once near the top of the tree to fire `page_view` on every route change.
 */
export function usePageView(): void {
  const location = useLocation();
  const lastPathRef = useRef<string | null>(null);

  useEffect(() => {
    const path = location.pathname + location.search;
    if (lastPathRef.current === path) return;
    lastPathRef.current = path;
    void trackEvent("page_view", "engagement", {
      path: redactSecretPath(location.pathname),
      // `search` was recorded verbatim, which is why redacting only the path was never the fix:
      // `/unsubscribe?token=<t>` and `?ct=<t>` are live token-bearing surfaces.
      search: location.search ? redactSecretSearch(location.search) : null,
    });
  }, [location.pathname, location.search]);
}

/**
 * Convenience hook for one-shot view events scoped to a feature page.
 * Example: useTrackOnMount("credit_intelligence_view", "engagement").
 */
export function useTrackOnMount(
  event_name: string,
  category: EventCategory = "engagement",
  properties?: Record<string, unknown>,
): void {
  useEffect(() => {
    void trackEvent(event_name, category, properties);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
