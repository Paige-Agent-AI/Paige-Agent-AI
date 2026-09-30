// Comms C-2s-B — number MARKETPLACE search. JWT-gated; a tenant admin searches
// Twilio's Available Phone Numbers by area code, and each result is tagged with the retail
// price (Twilio wholesale + a flat $0.05 platform fee) from platform_number_pricing. The
// tenant never sees the word "Twilio" (§36) — they search an area code, see numbers with a
// price, and (via comms-purchase-number) click Buy.
//
// DOCTRINE
//  §9  tenant is server-DERIVED from the caller JWT (current_user_tenant_id()), NEVER a
//      body-supplied tenant/subaccount. The search authenticates as the tenant's OWN
//      Twilio subaccount, resolved via resolveTwilioCreds (Vault) under the service-role
//      client. A body cannot widen scope or point at another tenant's subaccount.
//  §38 Paige is a resale platform (#150): the price shown = retail_monthly_cents from
//      platform_number_pricing = the Twilio wholesale cost ($1.15) PLUS a flat $0.05 platform
//      fee (~4.3% on the standard number). A number is a Paige-held rail (tenant pays Paige,
//      Paige pays Twilio); the $0.05 is a Paige-held platform fee, NOT Stripe Connect. This fn
//      only READS the retail price to display it; the charge leg is not here (see
//      comms-purchase-number's honest note). wholesale_cents stays the true Twilio cost and is
//      NOT shown to the tenant.
//  §36 5-min test: the only filter is area code; results carry a plain dollar price and
//      capabilities are shown as icons (display, never a pre-filter). No Twilio vocabulary
//      leaks to the caller.
//  §18 Reuses the ONE Twilio seam (_shared/twilio.ts listAvailableNumbers) — no inline
//      Twilio REST, no second client.
//  §13 needs_config (not a fake list) when the tenant has no subaccount provisioned or
//      master/subaccount creds are missing. A missing price row degrades to a null
//      retail_price on that result (honest), never a guessed number. The displayed price
//      is the DB retail_monthly_cents column read live (data-driven) — never a hardcoded
//      amount, because both Twilio's wholesale and the fee are operator-maintained on the row.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { listAvailableNumbers, resolveTwilioCreds, type SupabaseAdminLike } from "../_shared/twilio.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Request body — ONLY search filters. Tenant/subaccount are NEVER read from here (§9).
 * §37 dual-contract: the marketplace UI (NumbersTab) now sends only { area_code } — it no
 * longer pre-picks a channel (§36, bug #149: capabilities are display, not a gate). A
 * Paige-headless caller may still send the fuller shape { area_code | areaCode, contains,
 * country, number_type, sms_enabled | sms/mms/voice }. All are accepted so the one seam
 * serves both producers without either breaking.
 */
interface SearchBody {
  /** UI shape: 3-digit area code. */
  areaCode?: string;
  /** Optional capability constraints for a deliberate headless caller (the UI omits them). */
  sms?: boolean;
  mms?: boolean;
  voice?: boolean;
  /** Headless shape (aliases + extra filters). */
  area_code?: string;
  contains?: string;
  /** ISO-3166 alpha-2 country. Defaults to US. */
  country?: string;
  /** Marketplace number type. Defaults to local. `tollfree` is how an 800/833/844… is found. */
  number_type?: "local" | "tollfree" | "mobile";
  /**
   * Two-letter state, e.g. `GA`. Passed to Twilio as `InRegion`.
   *
   * Every other filter here was already reaching Twilio and simply had no control on any
   * surface. Region was different: `listAvailableNumbers` did not pass it at all, so
   * searching by state was impossible rather than merely unexposed.
   */
  in_region?: string;
  /** City, e.g. `Atlanta`. Twilio's `InLocality`. */
  in_locality?: string;
  /**
   * Digits the number must BEGIN with, after the country and area code.
   *
   * Twilio has no "starts with" parameter — it has `Contains`, where `*` is a
   * single-character wildcard. So this is padded to a full 10-digit pattern here rather
   * than asking a person to type `555*******`, which is a Twilio implementation detail
   * and exactly the kind of thing that must not leak to a tenant (§36).
   */
  starts_with?: string;
  /**
   * Optionally require SMS-capable numbers. UNSET by default (§36, bug #149): the caller
   * never has to pre-pick a channel to see numbers — capabilities are DISPLAY, not a gate.
   * Only a caller that deliberately sets this constrains the result set.
   */
  sms_enabled?: boolean;
}

/** Case-tolerant read of a Twilio capability flag (Available numbers use {SMS}/{MMS}/{voice}). */
function hasCap(caps: Record<string, unknown>, cap: "sms" | "mms" | "voice"): boolean {
  const lower = caps[cap];
  const upper = caps[cap.toUpperCase()];
  return Boolean(lower ?? upper);
}

/** Map our marketplace vocabulary onto Twilio's AvailablePhoneNumbers path segment. */
function toTwilioType(t: SearchBody["number_type"]): "Local" | "TollFree" | "Mobile" {
  if (t === "tollfree") return "TollFree";
  if (t === "mobile") return "Mobile";
  return "Local";
}

/**
 * The retail price attached to each result (§38). monthly_cents is retail_monthly_cents —
 * the Twilio wholesale cost plus a flat $0.05 platform fee (#150) — the price the tenant
 * actually pays. null when no operator price row exists.
 */
interface RetailPrice {
  monthly_cents: number;
  onetime_cents: number | null;
  currency: string;
}

interface NumberOption {
  phone_number: string;
  friendly_name: string | null;
  locality: string | null;
  region: string | null;
  capabilities: Record<string, boolean>;
  /**
   * §37: ONE canonical shape — the {monthly_cents, onetime_cents, currency} object the
   * NumbersTab UI reads (fmtPrice). null only when no operator price row exists for this
   * (type, country); the row still returns (numbers are NOT hidden), the UI shows "—" and
   * a "pricing pending" note (§13 honest — a missing price never fabricates a number).
   */
  retail_price: RetailPrice | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // ── AuthN + admin gate (§9). Tenant is derived from the JWT, never the body. ──
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth) return json({ error: "unauthorized" }, 401);
  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: auth } } });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json({ error: "unauthorized" }, 401);

  const admin = createClient(supabaseUrl, serviceKey);

  // Platform owner OR a tenant admin may search (same authority that may buy).
  const { data: isOwner } = await userClient.rpc("is_platform_owner");
  const { data: isAdmin } = await admin.rpc("has_role", { _user_id: user.id, _role: "admin" });
  if (isOwner !== true && isAdmin !== true) {
    return json({ error: "forbidden" }, 403);
  }

  // §9: the tenant is the caller's OWN tenant (JWT-scoped), never a body value.
  const { data: tenantId } = await userClient.rpc("current_user_tenant_id");
  if (!tenantId || typeof tenantId !== "string") {
    return json({ needs_config: true, error: "tenant_not_resolved", numbers: [] });
  }

  let body: SearchBody = {};
  try { body = (await req.json()) as SearchBody; } catch { body = {}; }

  const country = (body.country && body.country.trim()) ? body.country.trim().toUpperCase() : "US";
  const numberType: SearchBody["number_type"] = body.number_type ?? "local";
  const areaCode = (body.areaCode ?? body.area_code ?? "").trim() || undefined;
  // Capabilities are DISPLAY, not a gate (§36, bug #149): the caller never pre-picks a
  // channel to see numbers. smsEnabled stays UNDEFINED unless a caller deliberately set it
  // (UI `sms`, headless `sms_enabled`) — undefined omits the Twilio SmsEnabled param, so
  // the search returns ALL capability numbers by default.
  const smsEnabled = body.sms ?? body.sms_enabled;
  // MMS/voice remain OPTIONAL post-filters for a deliberate headless caller only (the UI
  // no longer sends them). When explicitly set they KEEP only matching numbers.
  const requireMms = body.mms === true;
  const requireVoice = body.voice === true;

  // ── Resolve the tenant's OWN Twilio subaccount creds (Vault). needs_config if unprovisioned. ──
  const creds = await resolveTwilioCreds(admin as unknown as SupabaseAdminLike, tenantId);
  if (!creds.ok || !creds.data) {
    return json({
      needs_config: true,
      error: creds.needs_config ? "twilio_subaccount_not_provisioned" : (creds.error ?? "twilio_creds_unavailable"),
      message: creds.needs_config
        ? "This practice isn't set up to buy numbers yet. Once provisioning is complete you'll be able to search and buy."
        : "Number search is temporarily unavailable.",
      numbers: [],
    });
  }

  // ── Search Twilio's Available Phone Numbers as the subaccount (§18 one seam). ──
  // `starts_with` becomes a Contains pattern, and the AREA CODE IS PART OF IT.
  //
  // Twilio matches Contains from position 1 of the ten-digit national number, so a bare
  // `555*******` means "area code 555", not "555 after the area code". Sending that
  // alongside AreaCode=404 asked for a number whose area code is both 404 and 555 —
  // mutually exclusive, so the search returned nothing, every time, and reported it as
  // "no numbers matched those filters. Try a wider search." Widening could never help.
  //
  // So the pattern is built from areaCode + starts_with together. With both, "404" and
  // "555" become `404555****`; with starts_with alone it keeps its previous meaning
  // (digits the number begins with, area code included). An explicit `contains` from a
  // headless caller still wins — it is already a Twilio pattern and re-padding a
  // deliberate one would corrupt it.
  const startsWith = (body.starts_with ?? "").replace(/\D/g, "");
  const prefixDigits = `${areaCode ?? ""}${startsWith}`.replace(/\D/g, "");
  const containsPattern = body.contains
    ?? (startsWith ? prefixDigits.slice(0, 10).padEnd(10, "*") : undefined);

  const search = await listAvailableNumbers(creds.data.accountSid, creds.data.authToken, {
    areaCode,
    contains: containsPattern,
    country,
    type: toTwilioType(numberType),
    smsEnabled,
    inRegion: (body.in_region ?? "").trim().toUpperCase() || undefined,
    inLocality: (body.in_locality ?? "").trim() || undefined,
  }, creds.data.apiKeySid); // C-2a: SK… as the Basic-auth username (API-Key auth)
  if (!search.ok || !search.data) {
    return json({
      needs_config: search.needs_config === true,
      error: search.error ?? "number_search_failed",
      numbers: [],
    }, search.needs_config ? 200 : 502);
  }

  // ── Look up the operator pricing row for this (type, country). One row or none. ──
  // §38 resale platform (#150): the DISPLAYED price is retail_monthly_cents — the Twilio
  // wholesale cost PLUS a flat $0.05 platform fee — the price the tenant actually pays. We
  // read the column live (data-driven); we never hardcode the amount, because both the Twilio
  // wholesale and the fee are operator-maintained on the row. wholesale_cents is the true
  // Twilio cost (for margin / accounting) and is NOT surfaced to the tenant.
  const { data: priceRow } = await admin
    .from("platform_number_pricing")
    .select("retail_monthly_cents, retail_onetime_cents, currency, active")
    .eq("number_type", numberType)
    .eq("country", country)
    .eq("active", true)
    .maybeSingle();

  const retailDetail: RetailPrice | null = priceRow
    ? {
      monthly_cents: priceRow.retail_monthly_cents as number,
      onetime_cents: (priceRow.retail_onetime_cents as number | null) ?? null,
      currency: (priceRow.currency as string) ?? "usd",
    }
    : null;

  // Twilio returns available_phone_numbers[]. Attach the retail price object to each (same
  // price for every result of this type/country), then apply the MMS/voice capability filters.
  const raw = (search.data as { available_phone_numbers?: unknown[] }).available_phone_numbers ?? [];
  const numbers: NumberOption[] = raw.map((n) => {
    const r = n as Record<string, unknown>;
    return {
      phone_number: String(r.phone_number ?? ""),
      friendly_name: (r.friendly_name as string | undefined) ?? null,
      locality: (r.locality as string | undefined) ?? null,
      region: (r.region as string | undefined) ?? null,
      capabilities: (r.capabilities as Record<string, boolean> | undefined) ?? {},
      retail_price: retailDetail,
    };
  }).filter((n) => {
    if (n.phone_number.length === 0) return false;
    if (requireMms && !hasCap(n.capabilities, "mms")) return false;
    if (requireVoice && !hasCap(n.capabilities, "voice")) return false;
    return true;
  });

  // §13 (S1 fix): needs_config means "this practice CAN'T buy yet" (no subaccount) — that
  // path already returned above. A subaccount EXISTS here, so a missing price row does NOT
  // set needs_config (that wrongly hid real numbers behind "set up messaging"). We return
  // the numbers with a null retail_price + price_configured:false so the UI shows them with
  // a "—" price + an operator nudge, never a fabricated price.
  return json({
    numbers,
    needs_config: false,
    price_configured: retailDetail !== null,
  });
});
