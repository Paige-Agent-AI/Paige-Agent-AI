import { commsProviderExecutionAllowed } from "../_shared/comms-provider-boundary.ts";
// Comms C-2s-B — number MARKETPLACE purchase. JWT-gated; a tenant admin buys a
// specific number into the tenant's OWN Twilio subaccount, then records it as a
// tenant_phone_numbers row (source='marketplace'). The tenant never touches Twilio (§36):
// they click Buy in the marketplace UI and get a working number.
//
// DOCTRINE
//  §9  tenant is server-DERIVED from the caller JWT (current_user_tenant_id()), NEVER a
//      body value. Only the phone_number to buy comes from the body. The purchase
//      authenticates as the tenant's OWN subaccount (resolveTwilioCreds via Vault under
//      service role). The inserted tenant_phone_numbers.tenant_id is set by the
//      set_tenant_phone_number_tenant trigger FROM the subaccount parent — the body can
//      never widen scope.
//  §37 NEW PRODUCER of tenant_phone_numbers, alongside import_tenant_phone_number (the
//      §10 import RPC, source='imported') and provision-tenant-twilio's subaccount rows.
//      This is the source='marketplace' producer. Both producers set subaccount_id +
//      let the trigger derive tenant_id; both are idempotent on the global phone_number
//      UNIQUE. No third numbers home (§18).
//  §38 Paige-HELD rail (#150, resale pricing). The number is bought into the tenant's
//      subaccount under the platform master account — Paige pays Twilio the WHOLESALE cost
//      (platform_number_pricing.wholesale_cents, $1.15), the tenant pays Paige the RETAIL
//      price (retail_monthly_cents = wholesale + a flat $0.05 platform fee, ~4.3% on the
//      $1.15 base — we're a resale platform). The price the marketplace DISPLAYS
//      (comms-search-numbers now returns retail_monthly_cents) and the price the tenant is
//      CHARGED are the SAME retail value — never a shown-vs-charged mismatch. This is a
//      Paige-held platform fee, NOT Stripe Connect. §13 HONESTY: the CHARGE leg (billing the
//      tenant the retail price for this purchase) is NOT wired in this slice — this fn does
//      the Twilio buy + records the number; the money settlement is a later Money-Spine
//      concern, and when wired it MUST bill retail_monthly_cents to match the display. The
//      response says so (`charge_wired: false`) so no caller mistakes "bought" for "billed".
//  §18 Reuses the ONE Twilio seam (_shared/twilio.ts purchaseNumber) — no inline REST.
//  §13 Reports the REAL Twilio PN SID from the purchase response only; on any failure it
//      returns the real error, never a fabricated number/SID. needs_config when the
//      tenant has no subaccount.
import { stampedWebhookUrls } from "../_shared/twilio-webhook-auth.ts";
import { providerExecutionBlocked, QA_BOUNDARY_REFUSAL_NOTE, QA_NO_PROVIDER_EXECUTION_CODE } from "../_shared/inbox-intelligence/provider-boundary.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { purchaseNumber, resolveTwilioCreds, type SupabaseAdminLike } from "../_shared/twilio.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Request body — the number to buy + an optional label. Tenant is NEVER read here (§9).
 * §37 dual-contract: the marketplace UI (NumbersTab.buy) sends { phone_number }; a
 * Paige-headless caller may send { phoneNumber }. Both are accepted.
 */
interface PurchaseBody {
  /** E.164 number the tenant chose from comms-search-numbers (e.g. +14155550123). */
  phoneNumber?: string;
  phone_number?: string;
  /** Optional human label for the number. */
  friendly_name?: string;
  /**
   * The retail monthly price, in cents, that the caller ALREADY SHOWED THE HUMAN before
   * asking them to approve this purchase. Optional, and the reason it is optional is a §37
   * producer fact rather than a preference: the marketplace UI shows the price on the same
   * screen as the Buy button, so the human cannot approve a number without seeing what it
   * costs, and that path sends nothing here and is unchanged.
   *
   * An agent caller is different. It composes its own confirmation sentence, so nothing
   * structurally ties the amount a human approved to the amount they will be billed — the
   * model could omit the price, or state one that was never real. When this field IS present
   * it is verified against `platform_number_pricing` BEFORE any money is spent, and a
   * mismatch refuses the purchase. That makes the number in the confirmation binding instead
   * of decorative: a human cannot be shown one price and charged another, and cannot be asked
   * to approve an amount nobody ever quoted.
   */
  agreed_monthly_cents?: number;
}

/**
 * The NANP toll-free SACs. Used only to pick which `platform_number_pricing` row governs a
 * number, and deliberately not to decide anything else — a number we cannot classify simply
 * has no verifiable price, which is reported rather than guessed (§13).
 */
const TOLLFREE_NANP = new Set(["800", "833", "844", "855", "866", "877", "888"]);

/** ({number_type, country}) for the pricing row, or null when this number is unclassifiable. */
function pricingKeyFor(e164: string): { numberType: string; country: string } | null {
  if (!e164.startsWith("+1") || e164.length !== 12) return null; // NANP is all we price today
  const npa = e164.slice(2, 5);
  return { numberType: TOLLFREE_NANP.has(npa) ? "tollfree" : "local", country: "US" };
}

const E164 = /^\+[1-9][0-9]{7,14}$/;

/**
 * The stamped webhook URLs come from `_shared/twilio-webhook-auth.ts` (§18: one
 * home). They previously named `twilio-sms-webhook` and
 * `twilio-sms-status-webhook`, neither of which exists in this repository or is
 * deployed — so every number bought through this path 404'd on inbound, meaning
 * STOP was never recorded, and lost every delivery receipt. The live handlers
 * are `handle-inbound-sms` and `twilio-status-callback`.
 *
 * §13 HONEST LIMIT: this corrects numbers purchased FROM NOW ON. Numbers already
 * bought still carry the dead URLs, and re-stamping them is a provider write —
 * an authorized production action, deliberately not performed here.
 */

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

  const { data: isOwner } = await userClient.rpc("is_platform_owner");
  const { data: isAdmin } = await admin.rpc("has_role", { _user_id: user.id, _role: "admin" });
  if (isOwner !== true && isAdmin !== true) {
    return json({ error: "forbidden" }, 403);
  }

  const { data: tenantId } = await userClient.rpc("current_user_tenant_id");
    // QA #1832: a synthetic QA workspace cannot incur real provider spend.
    if (tenantId && await providerExecutionBlocked(admin as never, tenantId)) {
      return json({ error: QA_NO_PROVIDER_EXECUTION_CODE, note: QA_BOUNDARY_REFUSAL_NOTE }, 403);
    }
  if (!tenantId || typeof tenantId !== "string") {
    return json({ needs_config: true, error: "tenant_not_resolved" });
  }

  if (!await commsProviderExecutionAllowed(admin, { tenantId, actorUserId: user.id })) {
    return json({ error: "COMMS_PROVIDER_EXECUTION_DISABLED" }, 403);
  }
  let body: PurchaseBody = {};
  try { body = (await req.json()) as PurchaseBody; } catch { body = {}; }
  const phoneNumber = (body.phoneNumber ?? body.phone_number ?? "").trim();
  if (!E164.test(phoneNumber)) {
    return json({ error: "phone_number must be E.164 (e.g. +14155550123)" }, 400);
  }
  const friendlyName = (body.friendly_name ?? "").trim() || null;
  const agreedMonthlyCents = typeof body.agreed_monthly_cents === "number"
      && Number.isFinite(body.agreed_monthly_cents)
    ? Math.round(body.agreed_monthly_cents)
    : null;

  // ── Idempotency (pre-purchase): if the tenant already owns this number, return it and
  //    DO NOT re-buy at Twilio. A number held by ANOTHER tenant is a conflict (§9 no-leak). ──
  const { data: existing } = await admin
    .from("tenant_phone_numbers")
    .select("id, tenant_id, twilio_sid, phone_number")
    .eq("phone_number", phoneNumber)
    .maybeSingle();
  if (existing) {
    if (existing.tenant_id !== tenantId) {
      // Do not reveal whose it is (§9). Just refuse.
      return json({ error: "number_unavailable" }, 409);
    }
    return json({
      already_owned: true,
      id: existing.id,
      phone_number: existing.phone_number,
      // §37: the UI reads `sid`. Mirror the real PN SID into both keys (null if this is an
      // imported/master number with no recorded SID — the UI treats null-sid as "didn't go
      // through", acceptable for the rare re-buy-an-owned-number path; §13 no fabrication).
      sid: existing.twilio_sid ?? null,
      twilio_sid: existing.twilio_sid ?? null,
      charge_wired: false,
    });
  }

  // ── Resolve the tenant's subaccount: creds (Vault) + the subaccount ROW id for the FK. ──
  const creds = await resolveTwilioCreds(admin as unknown as SupabaseAdminLike, tenantId);
  if (!creds.ok || !creds.data) {
    return json({
      needs_config: true,
      error: creds.needs_config ? "twilio_subaccount_not_provisioned" : (creds.error ?? "twilio_creds_unavailable"),
      message: creds.needs_config
        ? "This practice isn't set up to buy numbers yet. Once provisioning is complete you'll be able to buy."
        : "Number purchase is temporarily unavailable.",
    });
  }

  const { data: subRow, error: subErr } = await admin
    .from("tenant_twilio_subaccounts")
    .select("id, inbound_webhook_secret")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (subErr || !subRow?.id) {
    return json({ needs_config: true, error: "twilio_subaccount_row_missing" });
  }
  // Refuse rather than stamp an unauthenticatable URL: a number whose webhook
  // carries no secret would land on a handler that now correctly rejects it,
  // which reads as silent inbound loss.
  if (!subRow.inbound_webhook_secret) {
    return json({ needs_config: true, error: "inbound_webhook_secret_missing" });
  }

  // ── The price the human approved must be the price we are about to start charging ──────
  // This runs BEFORE `purchaseNumber`, because a check that happens after the money is spent
  // is not a check. Only when the caller sent an amount: the marketplace UI does not (it shows
  // the price beside the button), so its behaviour is byte-for-byte what it was.
  if (agreedMonthlyCents !== null) {
    const key = pricingKeyFor(phoneNumber);
    const { data: priceRow } = key
      ? await admin
        .from("platform_number_pricing")
        .select("retail_monthly_cents")
        .eq("number_type", key.numberType)
        .eq("country", key.country)
        .eq("active", true)
        .maybeSingle()
      : { data: null };

    // Unverifiable is a REFUSAL, not a pass. If we cannot read the governing price there is
    // nothing to compare the human's approval against, and buying anyway would mean spending
    // on an amount nobody could confirm — the exact thing this parameter exists to stop.
    if (!priceRow || typeof priceRow.retail_monthly_cents !== "number") {
      return json({
        error: "price_unverifiable",
        code: "price_unverifiable",
        message: "This number has no published price right now, so the amount you were quoted can't be confirmed. Nothing was bought.",
        phone_number: phoneNumber,
      }, 409);
    }
    const realCents = priceRow.retail_monthly_cents as number;
    if (realCents !== agreedMonthlyCents) {
      // The real figure is returned so the caller can re-quote honestly rather than retry blind.
      return json({
        error: "price_changed",
        code: "price_changed",
        message: "The monthly price for this number changed since it was quoted. Nothing was bought.",
        phone_number: phoneNumber,
        quoted_monthly_cents: agreedMonthlyCents,
        actual_monthly_cents: realCents,
      }, 409);
    }
  }

  // ── Buy the number into the tenant's subaccount through the ONE seam (§18). ──
  const { smsUrl, statusCallback } = stampedWebhookUrls(supabaseUrl, subRow.inbound_webhook_secret);
  const bought = await purchaseNumber(creds.data.accountSid, creds.data.authToken, phoneNumber, {
    smsUrl,
    statusCallback,
    friendlyName: friendlyName ?? undefined,
  }, creds.data.apiKeySid); // C-2a: SK… as the Basic-auth username (API-Key auth)
  if (!bought.ok || !bought.data) {
    return json({
      needs_config: bought.needs_config === true,
      error: bought.error ?? "number_purchase_failed",
    }, bought.needs_config ? 200 : 502);
  }

  const pnSid = (bought.data as Record<string, unknown>).sid as string | undefined; // REAL PNxxx
  const boughtNumber = ((bought.data as Record<string, unknown>).phone_number as string | undefined) ?? phoneNumber;

  // ── Attributable evidence that money was spent ──────────────────────────────────
  // Called before EVERY exit where Twilio has charged the tenant — there are FOUR. The first
  // version of this wrote only the last one; a review then found two more and stated the count
  // as three, which was still wrong: `twilio_purchase_missing_sid` returns above and is also
  // past the charge. On both `number_bought_but_record_failed` and `twilio_purchase_missing_sid`
  // no `tenant_phone_numbers` row exists at all, so this audit row is the ONLY record anywhere
  // that a charge started. `recorded_on_tenant:false` is what marks those two for reconciliation.
  //
  // The Rail is deliberately not used and cannot be: `record_rail_event` is contact-keyed and
  // raises when the contact does not resolve in the tenant, and a purchased number belongs to
  // the WORKSPACE, not to any one client.
  //
  // Never blocking. A failed audit write must not turn a completed purchase into a reported
  // failure — the number is bought and the charge has started either way. Logged, never
  // swallowed (§32).
  const writePurchaseAudit = async (numberRowId: string | null, recorded: boolean) => {
    const { error: auditErr } = await admin.from("audit_logs").insert({
      user_id: user.id,
      entity: "tenant_phone_number",
      action: "comms:number_purchased",
      entity_id: numberRowId,
      data: {
        tenant_id: tenantId,
        phone_number: boughtNumber,
        twilio_sid: pnSid,
        // Whether the number reached our own records. False is the reconciliation case.
        recorded_on_tenant: recorded,
        // No price: this seam genuinely never receives one — the retail figure lives in
        // `comms-search-numbers`, which reads `platform_number_pricing`. Writing a number this
        // function did not receive would be an audit row inventing its own key field (§13).
        price_recorded: false,
        charge_wired: false,
      },
    });
    if (auditErr) console.error("[comms-purchase-number] audit write failed:", auditErr.message);
  };
  const capabilities = ((bought.data as Record<string, unknown>).capabilities as Record<string, unknown> | undefined) ?? {};
  const twilioFriendly = (bought.data as Record<string, unknown>).friendly_name as string | undefined;

  if (!pnSid) {
    // The buy succeeded HTTP-wise but the response carried no SID — do not fabricate one.
    //
    // THIS IS A MONEY-SPENT EXIT AND WAS MISSING ITS AUDIT ROW. We are past `bought.ok`, so
    // Twilio accepted the purchase and the tenant may already be billed; we simply have no SID
    // to record it under. Returning here without an audit row left the one charged-but-
    // unrecorded case with NO trace anywhere — no `tenant_phone_numbers` row and no audit —
    // which is the precise scenario the helper was written for. The earlier revision counted
    // three such exits; there are four, and this is the one furthest upstream.
    await writePurchaseAudit(null, false);
    return json({
      error: "twilio_purchase_missing_sid",
      code: "twilio_purchase_missing_sid",
      phone_number: boughtNumber,
    }, 502);
  }

  // ── Record the number. subaccount_id set → the trigger derives tenant_id from the
  //    subaccount parent (§9). source='marketplace' (§37 this producer). Idempotent on
  //    the global phone_number UNIQUE (a race returns the existing row). ──
  const { data: inserted, error: insErr } = await admin
    .from("tenant_phone_numbers")
    .insert({
      subaccount_id: subRow.id,               // trigger derives tenant_id from this (§9)
      phone_number: boughtNumber,
      twilio_sid: pnSid,                        // REAL PNxxx from the purchase response
      capabilities,                             // from Twilio's response
      status: "active",
      source: "marketplace",                    // §37: this is the marketplace producer
      friendly_name: friendlyName ?? (twilioFriendly ?? null),
      purchased_at: new Date().toISOString(),
    })
    .select("id")
    .maybeSingle();

  if (insErr) {
    const code = (insErr as { code?: string }).code;
    if (code === "23505") {

      // Race: the row appeared between the pre-check and the insert. Return it idempotently.
      const { data: raced } = await admin
        .from("tenant_phone_numbers")
        .select("id")
        .eq("phone_number", boughtNumber)
        .maybeSingle();
      await writePurchaseAudit((raced?.id as string | null) ?? null, true);
      return json({
        purchased: true,
        id: raced?.id ?? null,
        phone_number: boughtNumber,
        sid: pnSid,                            // §37: UI reads `sid`
        twilio_sid: pnSid,
        charge_wired: false,
        note: "Number bought at Twilio and already recorded (idempotent).",
      });
    }
    // The number IS bought at Twilio but we failed to record it — report BOTH honestly so
    // an operator can reconcile (§13). The real PN SID is included for that reconcile.
    //
    // `code` IS THE CONTRACT; `error` is prose. `error` interpolates the database message so a
    // human reconciling has the cause, which means it is NEVER equal to the bare token — and a
    // consumer that compared it for equality (paige-ai-chat did) silently never matched, so the
    // "money was already spent" flag it gates never reached the model. A caller must not have to
    // parse a sentence to learn which failure this is.
    await writePurchaseAudit(null, false);
    return json({
      error: `number_bought_but_record_failed: ${insErr.message}`,
      code: "number_bought_but_record_failed",
      phone_number: boughtNumber,
      twilio_sid: pnSid,
      charge_wired: false,
    }, 500);
  }

  await writePurchaseAudit((inserted?.id as string | null) ?? null, true);
  return json({
    purchased: true,
    id: inserted?.id ?? null,
    phone_number: boughtNumber,
    sid: pnSid,                                 // §37: the UI reads `sid`. REAL PN SID (§13).
    twilio_sid: pnSid,                          // REAL PN SID only (§13)
    // §38 HONEST: the number is bought + recorded; billing the tenant the retail price
    // (wholesale + $0.05 platform fee, #150) for it is NOT wired in this slice — later
    // Money-Spine, and when wired it charges retail_monthly_cents to match the display.
    charge_wired: false,
  });
});
