// mcp-timeout-ratelimit.test.ts — the safeFetch timeout pin + the 429 closed code (EXP10 PR14).
//
// WHAT THIS FILE PINS. The AWS remain-in-place ruling named exactly one justified performance
// improvement in EXP10 scope: the timeout/429 closed-code TEST PIN. Two properties:
//   1. safeFetch's wall-clock ceiling covers the WHOLE call — DNS, connect, body. The DNS
//      phase was the hole: the signal was only inspected AFTER the resolver await completed,
//      so a never-settling resolver hung safeFetch past its own timeout (the comment claimed
//      the deadline started before the guard; nothing enforced it mid-guard until the race).
//   2. A 429 provider refusal maps to its own closed code (http_rate_limited) — transient,
//      "wait and retry," distinct from mcp_http_error's "check the credential" — so the
//      recorded last_error_code, the chat answer and the scheduled health loop can say the
//      true remediation instead of sending the owner to reconnect.
//
// FAILING-FIRST, both: run against the pre-PR14 sources, the DNS test fails via its own
// bail (the call never returns) and the 429 test fails with mcp_http_error. Demonstrated on
// this branch before the fix landed (see the PR thread).
//
// NO NETWORK: Deno.resolveDns and globalThis.fetch are stubbed per test and restored in
// finally. The CI permissions mirror that (--deny-net).

import { assertEquals, assertRejects } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { safeFetch, SsrfError } from "./ssrfGuard.ts";
import { describeMcpError, mcpProbe } from "./mcp-client.ts";

const PUBLIC_URL = "https://example.com/rpc";
const PUBLIC_A = ["93.184.216.34"]; // example.com's real v4 — as a stub VALUE; no lookup happens

/** Stub the module-level DNS seam (ssrfGuard calls Deno.resolveDns) and restore. */
async function withDns(
  resolver: (host: string, kind: "A" | "AAAA") => Promise<string[]>,
  fn: () => Promise<void>,
): Promise<void> {
  const real = Deno.resolveDns;
  // deno-lint-ignore no-explicit-any
  (Deno as any).resolveDns = resolver;
  try {
    await fn();
  } finally {
    // deno-lint-ignore no-explicit-any
    (Deno as any).resolveDns = real;
  }
}

/** Stub globalThis.fetch (safeFetch calls the bare global) and restore. */
async function withFetch(
  fetcher: (input: string, init?: RequestInit) => Promise<Response>,
  fn: () => Promise<void>,
): Promise<void> {
  const real = globalThis.fetch;
  // deno-lint-ignore no-explicit-any
  (globalThis as any).fetch = (input: unknown, init?: RequestInit) =>
    fetcher(String(input), init);
  try {
    await fn();
  } finally {
    // deno-lint-ignore no-explicit-any
    (globalThis as any).fetch = real;
  }
}

/** A fetch that behaves like the real one on deadline: never answers on its own, rejects
 *  the moment the caller aborts. A stub that ignores the signal would hang past the very
 *  deadline under test. */
const fetchHangsUntilAborted = (_input: string, init?: RequestInit) =>
  new Promise<Response>((_, reject) => {
    const sig = init?.signal;
    if (!sig) return; // never settles
    const refuse = () => reject(new DOMException("aborted", "AbortError"));
    if (sig.aborted) {
      refuse();
      return;
    }
    sig.addEventListener("abort", refuse, { once: true });
  });

const resolvesPublic = (_host: string, kind: "A" | "AAAA") =>
  Promise.resolve(kind === "A" ? PUBLIC_A : []);

Deno.test("timeout: a hanging RESOLVER is bounded by the deadline (the DNS-phase pin)", async () => {
  // The bail is the test's own honesty mechanism: against unfixed code safeFetch never
  // returns here, and a test that hangs CI proves nothing. 5s is two orders of magnitude
  // past the 40ms deadline, so reaching it means the deadline is not enforced.
  await withDns(() => new Promise<string[]>(() => {}), async () => {
    const settled = safeFetch(PUBLIC_URL, {}, { timeoutMs: 40 }).then(
      (v) => ({ kind: "returned" as const, value: v }),
      (e) => ({ kind: "threw" as const, error: e }),
    );
    let bailTimer: ReturnType<typeof setTimeout> | undefined;
    const bail = new Promise((resolve) => {
      bailTimer = setTimeout(() => resolve("bail"), 5_000);
    });
    let outcome: unknown;
    try {
      outcome = await Promise.race([settled, bail]);
    } finally {
      // The green path settles in ~40ms; a live 5s timer past test completion trips Deno's
      // default op sanitizer ("leaking async ops") — clear it either way (review P2).
      clearTimeout(bailTimer);
    }
    if (outcome === "bail") {
      throw new Error("safeFetch did not settle within 5s of a 40ms deadline - the DNS wait is unbounded");
    }
    if (outcome.kind === "returned") {
      throw new Error("unreachable: safeFetch cannot succeed against a hanging resolver");
    }
    if (!(outcome.error instanceof SsrfError) || outcome.error.reason !== "request_timed_out") {
      throw new Error(`expected SsrfError(request_timed_out), received: ${outcome.error}`);
    }
  });
});

Deno.test("timeout: a hanging FETCH is bounded by the deadline", async () => {
  await withDns(resolvesPublic, async () => {
    await withFetch(fetchHangsUntilAborted, async () => {
      const err = await assertRejects(
        () => safeFetch(PUBLIC_URL, {}, { timeoutMs: 40 }),
        SsrfError,
      );
      assertEquals(err.reason, "request_timed_out");
    });
  });
});

Deno.test("redirect: a 3xx is refused, never followed", async () => {
  await withDns(resolvesPublic, async () => {
    await withFetch(async () => new Response(null, { status: 302, headers: { location: "https://elsewhere.example/x" } }), async () => {
      const err = await assertRejects(() => safeFetch(PUBLIC_URL, {}), SsrfError);
      assertEquals(err.reason, "url_redirect_refused");
    });
  });
});

Deno.test("size: the body is capped at maxBytes, not buffered past it", async () => {
  await withDns(resolvesPublic, async () => {
    await withFetch(async () => new Response("x".repeat(5_000)), async () => {
      const res = await safeFetch(PUBLIC_URL, {}, { maxBytes: 1_000 });
      assertEquals(res.truncated, true);
      assertEquals(res.body.length, 1_000);
    });
  });
});

Deno.test("ssrf: a private resolution is refused before any fetch", async () => {
  await withDns((_h, _k) => Promise.resolve(["10.0.0.5"]), async () => {
    let fetched = false;
    await withFetch(async () => {
      fetched = true;
      return new Response("{}");
    }, async () => {
      const err = await assertRejects(() => safeFetch(PUBLIC_URL, {}), SsrfError);
      assertEquals(err.reason, "url_resolves_to_private_address");
      assertEquals(fetched, false);
    });
  });
});

Deno.test("429: a rate-limited provider maps to the http_rate_limited closed code", async () => {
  await withDns(resolvesPublic, async () => {
    await withFetch(async () => new Response("", { status: 429, headers: { "content-type": "application/json" } }), async () => {
      const verdict = await mcpProbe({ serverUrl: PUBLIC_URL, auth: { kind: "none" }, timeoutMs: 2_000 });
      assertEquals(verdict.ok, false);
      if (verdict.ok) return;
      assertEquals(verdict.code, "http_rate_limited");
      assertEquals(verdict.httpStatus, 429);
    });
  });
});

Deno.test("429 copy: the owner answer says wait, not reconnect", () => {
  const copy = describeMcpError("http_rate_limited");
  if (!/wait a moment/i.test(copy)) throw new Error(`copy must say to wait: ${copy}`);
  if (!/reconnecting will not help/i.test(copy)) throw new Error(`copy must rule out reconnecting: ${copy}`);
  if (/check the credential/i.test(copy)) throw new Error(`rate-limit copy must not borrow the credential answer: ${copy}`);
});

Deno.test("other refusals stay mcp_http_error (no over-splitting)", async () => {
  await withDns(resolvesPublic, async () => {
    await withFetch(async () => new Response("", { status: 401, headers: { "content-type": "application/json" } }), async () => {
      const verdict = await mcpProbe({ serverUrl: PUBLIC_URL, auth: { kind: "none" }, timeoutMs: 2_000 });
      assertEquals(verdict.ok, false);
      if (verdict.ok) return;
      assertEquals(verdict.code, "mcp_http_error");
      assertEquals(verdict.httpStatus, 401);
    });
  });
});
