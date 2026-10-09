// INT-345 K-4 — READ-ONLY Twilio subaccount inventory (SUPER-ADMIN ONLY).
//
// The authorized reconciliation's inspection step: which subaccounts exist at the
// provider, and which of them have no tenant_twilio_subaccounts row (orphan
// candidates for ADOPTION before any creation). Reads only — no writes, no
// secrets, no tenant identifiers beyond what the DB rows themselves carry.
// The raw backfill (provision-tenant-twilio) stays the ONLY writer; this fn
// exists so "inspect before you create" is a first-class privileged operation
// instead of a console eyeball.
//
// DOCTRINE
//  §9  is_platform_owner() on the caller JWT — identical gate to the backfill.
//  §13 Honest: needs_config when master creds are absent; real SIDs/names only;
//      unmatched provider accounts are REPORTED, never adopted or changed here.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { listSubaccounts, masterCreds } from "../_shared/twilio.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  if (req.method !== "GET" && req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // ── Super-admin gate (§9) — the same authority the backfill requires. ──
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth) return json({ error: "unauthorized" }, 401);
  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: auth } } });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json({ error: "unauthorized" }, 401);
  const { data: isOwner } = await userClient.rpc("is_platform_owner");
  if (isOwner !== true) return json({ error: "forbidden" }, 403);

  if (!masterCreds()) {
    return json({
      needs_config: true,
      error: "twilio_master_not_configured",
      message: "The master Twilio credentials are not set as edge secrets. Nothing was read or changed.",
    });
  }

  // Provider-side inventory (read-only).
  const listed = await listSubaccounts();
  if (!listed.ok || !listed.data) {
    return json({ error: listed.error ?? "twilio_list_failed" }, 502);
  }
  const payload = listed.data as { accounts?: Array<Record<string, unknown>>; subaccount_users?: unknown };
  // Subaccounts come back under `accounts` (or `subaccount_users` on some shapes).
  const accounts = Array.isArray(payload.accounts)
    ? payload.accounts
    : Array.isArray(payload.subaccount_users)
      ? (payload.subaccount_users as Array<Record<string, unknown>>)
      : [];

  // DB-side rows (read-only, service role).
  const admin = createClient(supabaseUrl, serviceKey);
  const { data: rows, error: rowsErr } = await admin
    .from("tenant_twilio_subaccounts")
    .select("tenant_id, twilio_subaccount_sid, friendly_name, status, active, api_key_sid, twiml_app_sid");
  if (rowsErr) return json({ error: `subaccounts_read_failed: ${rowsErr.message}` }, 500);
  type SubRow = { tenant_id: string; twilio_subaccount_sid: string; friendly_name: string | null; status: string; active: boolean; api_key_sid: string | null; twiml_app_sid: string | null };
  const bySid = new Map<string, SubRow>((rows ?? []).map((r: SubRow) => [r.twilio_subaccount_sid, r]));

  const master = masterCreds();
  const inventory = accounts.map((a) => {
    const sid = String(a.sid ?? "");
    // The listing includes the MASTER account itself — it is not an orphan candidate.
    if (master && sid === master.accountSid) {
      return {
        subaccount_sid: sid,
        friendly_name: typeof a.friendly_name === "string" ? a.friendly_name : null,
        provider_status: typeof a.status === "string" ? a.status : null,
        binding: "master_account",
        tenant_id: null,
        row_status: null,
        has_api_key: null,
        has_twiml_app: null,
      };
    }
    const row: SubRow | undefined = bySid.get(sid);
    return {
      subaccount_sid: sid,
      friendly_name: typeof a.friendly_name === "string" ? a.friendly_name : null,
      provider_status: typeof a.status === "string" ? a.status : null,
      // MATCHED: a DB row binds this provider subaccount to a tenant.
      // UNMATCHED (orphan candidate): exists at the provider, no row — the K-4
      // adoption decision input. Reported only; nothing is adopted here.
      binding: row ? "matched" : "unmatched",
      tenant_id: row?.tenant_id ?? null,
      row_status: row?.status ?? null,
      has_api_key: row ? !!row.api_key_sid : null,
      has_twiml_app: row ? !!row.twiml_app_sid : null,
    };
  });

  return json({
    provider_count: inventory.length,
    matched: inventory.filter((i) => i.binding === "matched").length,
    unmatched: inventory.filter((i) => i.binding === "unmatched").length,
    // Honest bound: the listing page holds 400 — at the cap the inventory may be
    // truncated and the unmatched count is a FLOOR, not a total (round-3 P3).
    possibly_truncated: accounts.length >= 400,
    // No secrets, no auth tokens — identifiers and states only (§13/§34).
    inventory,
  });
});
