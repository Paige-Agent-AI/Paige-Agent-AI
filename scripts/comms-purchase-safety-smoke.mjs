#!/usr/bin/env node
/**
 * comms-purchase-number — the four decisions that surround SPENDING MONEY.
 *
 * Vitest covers `src/**` only and no edge function carries a test, so this is the §32 smoke
 * for the function that starts a recurring charge. It drives the REAL shipped handler: the
 * module is bundled, `Deno.serve` is captured, and actual `Request` objects go in and actual
 * `Response` objects come out. Only the two seams a local run genuinely cannot supply are
 * substituted — the Supabase client and the Twilio purchase — and both substitutes record what
 * they were asked to do so the assertions can be about behaviour rather than about a mock.
 *
 * WHY EACH ASSERTION EXISTS. Every one below corresponds to a defect an adversarial review
 * found in code that had already passed a green proof, and every one is paired with the state
 * that would have made the old code wrong:
 *
 *   1. `code` on the charged-but-unrecorded path. `error` interpolates the database message,
 *      so a consumer comparing it for equality never matched and the "money already spent"
 *      signal was silently lost on the one path where money had left.
 *   2. An audit row on EVERY money-spent exit. `twilio_purchase_missing_sid` returns after
 *      Twilio accepted the purchase and used to write nothing at all, so a charge could exist
 *      with no trace in either `tenant_phone_numbers` or `audit_logs`.
 *   3. A quoted price is VERIFIED before the buy, not after. An agent composes its own
 *      approval sentence, so without this the amount a human approved and the amount they are
 *      billed were unrelated.
 *   4. The UI producers, which send no price, are untouched — a half-applied guard that 4xxs a
 *      legitimate caller is worse than no guard (§37).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "comms-purchase-safety-"));

/** Everything the substituted seams were asked to do during one request. */
let calls;
const reset = () => {
  calls = { purchases: [], audits: [], inserts: [], pricingLookups: [] };
};

/* ── The substituted seams, written as files so esbuild can alias to them ───────── */

fs.writeFileSync(path.join(outDir, "supabase-stub.mjs"), `
export function createClient() {
  const g = globalThis.__smoke;
  const q = (table) => {
    const state = { table, filters: {} };
    const api = {
      select() { return api; },
      eq(col, val) { state.filters[col] = val; return api; },
      insert(row) { state.insert = row; return api; },
      maybeSingle() { return Promise.resolve(g.read(state)); },
      then(res) { return Promise.resolve(g.read(state)).then(res); },
    };
    return api;
  };
  return {
    auth: { getUser: () => Promise.resolve({ data: { user: { id: "user-1" } } }) },
    rpc: (name) => Promise.resolve(g.rpc(name)),
    from: (t) => q(t),
  };
}
`);

fs.writeFileSync(path.join(outDir, "twilio-stub.mjs"), `
export function resolveTwilioCreds() {
  return Promise.resolve({ ok: true, data: { accountSid: "ACtest", authToken: "tok", apiKeySid: "SKtest" } });
}
export function purchaseNumber(_a, _b, phoneNumber) {
  const g = globalThis.__smoke;
  g.calls.purchases.push(phoneNumber);
  return Promise.resolve(g.twilioResult(phoneNumber));
}
`);

const outFile = path.join(outDir, "mod.mjs");
await build({
  entryPoints: ["supabase/functions/comms-purchase-number/index.ts"],
  outfile: outFile,
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  // `alias` rejects a URL key, so both redirects go through one resolver plugin. The Supabase
  // client and the Twilio purchase are the only two seams substituted; every other import —
  // including `_shared/twilio-webhook-auth.ts`, which stamps the webhook URLs — is the real one.
  plugins: [{
    name: "substitute-two-seams",
    setup(b) {
      b.onResolve({ filter: /^https:\/\/esm\.sh\/@supabase\/supabase-js/ },
        () => ({ path: path.join(outDir, "supabase-stub.mjs") }));
      b.onResolve({ filter: /_shared\/twilio\.ts$/ },
        () => ({ path: path.join(outDir, "twilio-stub.mjs") }));
    },
  }],
});

/* ── Capture the handler instead of serving it ──────────────────────────────────── */
let handler = null;
globalThis.Deno = {
  env: {
    get: (k) => ({
      SUPABASE_URL: "https://x.test",
      SUPABASE_ANON_KEY: "anon",
      SUPABASE_SERVICE_ROLE_KEY: "service",
    }[k]),
  },
  serve: (h) => { handler = h; },
};

/** Scenario knobs the stubs read. Defaults describe a healthy tenant buying a fresh number. */
let scenario;
globalThis.__smoke = {
  get calls() { return calls; },
  rpc(name) {
    if (name === "comms_provider_execution_allowed") return { data: scenario.providerAllowed !== false };
    if (name === "is_platform_owner") return { data: false };
    if (name === "has_role") return { data: true };          // admin
    if (name === "current_user_tenant_id") return { data: "tenant-1" };
    return { data: null };
  },
  read(state) {
    if (state.table === "tenant_phone_numbers") {
      if (state.insert) {
        calls.inserts.push(state.insert);
        return scenario.insertFails
          ? { data: null, error: { code: "XX000", message: "connection reset by peer" } }
          : { data: { id: "row-1" }, error: null };
      }
      return { data: null };                                  // not already owned
    }
    if (state.table === "tenant_twilio_subaccounts") {
      return { data: { id: "sub-1", inbound_webhook_secret: "s".repeat(64) } };
    }
    if (state.table === "platform_number_pricing") {
      calls.pricingLookups.push({ ...state.filters });
      return { data: scenario.priceRow };
    }
    if (state.table === "audit_logs") {
      calls.audits.push(state.insert);
      return { data: null, error: null };
    }
    return { data: null };
  },
  twilioResult() {
    if (scenario.twilioFails) return { ok: false, error: "number_unavailable" };
    return { ok: true, data: { sid: scenario.omitSid ? undefined : "PN123", phone_number: "+14045550101" } };
  },
};

await import(pathToFileURL(outFile).href);
assert.ok(typeof handler === "function", "the module did not register a handler");

let n = 0;
const check = (label, cond, detail) => {
  n++;
  assert.ok(cond, `FAILED: ${label}${detail ? ` — ${detail}` : ""}`);
  console.log(`  ok  ${label}`);
};

/** Drive the real handler. `body` is sent verbatim, so a producer can be reproduced exactly. */
const buy = async (body, sc = {}) => {
  reset();
  scenario = {
    priceRow: { retail_monthly_cents: 120 },
    insertFails: false, twilioFails: false, omitSid: false,
    ...sc,
  };
  const res = await handler(new Request("https://x.test/comms-purchase-number", {
    method: "POST",
    headers: { Authorization: "Bearer jwt", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
  return { status: res.status, body: await res.json() };
};

console.log("comms-purchase-number safety smoke\n");

{
  const r = await buy({ phone_number: "+14045550101", agreed_monthly_cents: 120 }, { providerAllowed: false });
  check("restricted workspace cannot purchase", r.status === 403 && r.body.error === "COMMS_PROVIDER_EXECUTION_DISABLED");
  check("restricted workspace makes zero paid calls", calls.purchases.length === 0);
  check("restricted workspace writes no number or spent audit", calls.inserts.length === 0 && calls.audits.length === 0);
}

/* 1 ── The happy path still works, and is what everything else is measured against. */
{
  const r = await buy({ phone_number: "+14045550101", agreed_monthly_cents: 120 });
  check("a correctly quoted purchase goes through", r.body.purchased === true, JSON.stringify(r.body));
  check("  and it reached Twilio exactly once", calls.purchases.length === 1);
  check("  and it wrote its audit row", calls.audits.length === 1
    && calls.audits[0].data.recorded_on_tenant === true);
}

/* 2 ── §37: the UI producers send NO price. They must be byte-for-byte unaffected. */
{
  const r = await buy({ phone_number: "+14045550101" });   // exactly NumbersTab / useSoloNumbers
  check("a caller that sends no price is NOT blocked", r.body.purchased === true, JSON.stringify(r.body));
  check("  and no price lookup happens for it at all", calls.pricingLookups.length === 0);
}

/* 3 ── A quoted price that is not the real one must refuse BEFORE spending. */
{
  const r = await buy({ phone_number: "+14045550101", agreed_monthly_cents: 99 });
  check("a stale quote is REFUSED", r.status === 409 && r.body.code === "price_changed", JSON.stringify(r.body));
  check("  and NOTHING was bought", calls.purchases.length === 0);
  check("  and the real price is returned so the caller can re-quote",
    r.body.actual_monthly_cents === 120 && r.body.quoted_monthly_cents === 99);
}

/* 4 ── Unverifiable is a refusal, not a pass. Absence of a price is not permission. */
{
  const r = await buy({ phone_number: "+14045550101", agreed_monthly_cents: 120 }, { priceRow: null });
  check("an unverifiable price is REFUSED", r.status === 409 && r.body.code === "price_unverifiable");
  check("  and NOTHING was bought", calls.purchases.length === 0);
}

/* 5 ── Charged but not recorded: the stable code, and the audit row. */
{
  const r = await buy({ phone_number: "+14045550101", agreed_monthly_cents: 120 }, { insertFails: true });
  check("a charged-but-unrecorded purchase carries a STABLE code",
    r.body.code === "number_bought_but_record_failed", JSON.stringify(r.body));
  // The negative control for the defect: `error` is prose and can never be compared for equality.
  check("  and `error` is prose that an equality check could never match",
    typeof r.body.error === "string"
      && r.body.error.startsWith("number_bought_but_record_failed")
      && r.body.error !== "number_bought_but_record_failed",
    r.body.error);
  check("  and the real SID is returned for reconciliation", r.body.twilio_sid === "PN123");
  check("  and an audit row records that the charge is UNRECORDED",
    calls.audits.length === 1 && calls.audits[0].data.recorded_on_tenant === false);
}

/* 6 ── Twilio took the money and returned no SID: the exit that used to write nothing. */
{
  const r = await buy({ phone_number: "+14045550101", agreed_monthly_cents: 120 }, { omitSid: true });
  check("a purchase with no SID is reported, not fabricated",
    r.status === 502 && r.body.code === "twilio_purchase_missing_sid", JSON.stringify(r.body));
  check("  and it STILL writes an audit row — this exit used to write none",
    calls.audits.length === 1 && calls.audits[0].data.recorded_on_tenant === false,
    JSON.stringify(calls.audits));
  check("  and no phone-number row was created", calls.inserts.length === 0);
}

/* 7 ── A refusal at the provider is not a charge, so it must NOT claim one. */
{
  const r = await buy({ phone_number: "+14045550101", agreed_monthly_cents: 120 }, { twilioFails: true });
  check("a provider refusal writes NO audit row", calls.audits.length === 0, JSON.stringify(calls.audits));
  check("  and reports the failure", r.body.error === "number_unavailable");
}

/* 8 ── The pricing row is chosen by the number, not by anything the caller asserts. */
{
  await buy({ phone_number: "+18885550101", agreed_monthly_cents: 120 });
  check("a toll-free number is priced as toll-free",
    calls.pricingLookups[0]?.number_type === "tollfree", JSON.stringify(calls.pricingLookups));
  await buy({ phone_number: "+14045550101", agreed_monthly_cents: 120 });
  check("a geographic number is priced as local",
    calls.pricingLookups[0]?.number_type === "local", JSON.stringify(calls.pricingLookups));
}

/* 9 ── THE AGENT-SIDE QUOTE GUARD, driven against the malformations that caused the finding.
       The seam above is permissive by design: an ABSENT price means "the marketplace UI, which
       shows the price beside the button" and is not verified. That is correct for the UI and it
       is exactly why the agent path must never let a malformed quote decay into an absent one —
       `undefined` there is indistinguishable from the legacy caller, so the purchase proceeds
       unverified, and at `auto` with no confirmation shown at all.

       `paige-ai-chat` has no runtime harness, so the predicate was pulled into `_shared` for
       this reason: the guard on a money path is exercised here rather than asserted about. */
{
  const qOut = path.join(outDir, "quote.mjs");
  await build({
    entryPoints: ["supabase/functions/_shared/purchase-quote.ts"],
    outfile: qOut, bundle: true, format: "esm", platform: "neutral", target: "es2022",
  });
  const { isSpendableQuoteCents: ok } = await import(pathToFileURL(qOut).href);

  check("a whole-cent price is spendable", ok(120) === true);
  // Each of these previously became `undefined` and bought the number unverified.
  check("  a MISSING quote is refused", ok(undefined) === false);
  check("  a STRING quote is refused", ok("120") === false);
  check("  a null quote is refused", ok(null) === false);
  check("  a FRACTIONAL cent is refused", ok(120.5) === false);
  check("  a zero price is refused", ok(0) === false);
  check("  a negative price is refused", ok(-120) === false);
  check("  NaN is refused", ok(NaN) === false);

  // The guard is only worth anything if the shipped call site actually uses it.
  const chat = fs.readFileSync("supabase/functions/paige-ai-chat/index.ts", "utf8");
  const guardAt = chat.indexOf("isSpendableQuoteCents(quoteArgs.monthly_cents)");
  // Anchor on the EXECUTABLE line that opens the gate, not on a comment banner: an earlier
  // "AUTONOMY GATE WIRING" comment elsewhere in the file made an indexOf on the banner match
  // the wrong place and fail this check against correct code.
  // The preceding typed-interruption uncertainty brake also checks MUTATING_TOOLS;
  // anchor this invariant to the existing autonomy gate, not that stricter brake.
  const gateAt = chat.indexOf("if (MUTATING_TOOLS.has(tc.function.name) && !CRM_COMMAND_TOOL_NAMES.has(tc.function.name as any)) {");
  check("the buy path calls it", guardAt > 0);
  check("  and refuses BEFORE the autonomy gate, so `auto` cannot route around it",
    guardAt > 0 && gateAt > 0 && guardAt < gateAt, `guard@${guardAt} gate@${gateAt}`);
}

console.log(`\n${n}/${n} checks passed`);
fs.rmSync(outDir, { recursive: true, force: true });
