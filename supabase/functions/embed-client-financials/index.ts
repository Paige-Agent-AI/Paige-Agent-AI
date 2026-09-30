// embed-client-financials
// ----------------------------------------------------------------------
// Builds a redacted, embedded knowledge-base brief whenever a Phase 3
// financial table row changes. One rag_documents row per (source_table,
// source_row_id) — upserted on the dedupe_key in metadata.
//
// Reconciled to the ACTUAL Phase 3 schema:
//   paige_business_credit_profiles(scores jsonb, trade_lines jsonb,
//     business_name, ein, last_pulled_at, history jsonb)
//   paige_owner_credit_snapshots(bureau, score, pulled_at, factors jsonb,
//     alerts_triggered jsonb)
//   paige_bank_connections(institution_name, status, accounts jsonb,
//     connected_at, last_synced_at)
//   paige_bank_transactions(bank_connection_id, date, amount_cents, name,
//     category jsonb, pending)
//   paige_cash_flow_snapshots(period_start, period_end,
//     total_deposits_cents, total_withdrawals_cents,
//     avg_daily_balance_cents, runway_days, funding_readiness_score)
//
// Body: { source_table, source_row_id, contact_id }
// Auth: service-role only.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { embeddingsCompat } from "../_shared/voyage.ts";
import { CLIENT_CONTACT_METHODS_EMBED, withPrimaryAddresses } from "../_shared/contact-methods.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Body = {
  source_table: string;
  source_row_id: string;
  contact_id: string;
};

const TABLE_TO_TYPE: Record<string, string> = {
  paige_business_credit_profiles: "business_credit_snapshot",
  paige_owner_credit_snapshots: "owner_credit_snapshot",
  paige_bank_connections: "banking_snapshot",
  paige_bank_transactions: "banking_transaction",
  paige_cash_flow_snapshots: "cash_flow_snapshot",
};

async function embed(text: string, key: string): Promise<number[] | null> {
  try {
    const trimmed = text.length > 8000 ? text.slice(0, 8000) : text;
    const r = await embeddingsCompat("voyage", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "text-embedding-3-small", input: trimmed }),
    });
    if (!r.ok) return null;
    const j = await r.json();
    return j.data?.[0]?.embedding ?? null;
  } catch {
    return null;
  }
}

function fmt(n: unknown): string {
  if (n == null || n === "") return "—";
  if (typeof n === "number") return n.toLocaleString();
  return String(n);
}

function dollars(cents: unknown): string {
  if (cents == null || cents === "") return "—";
  const n = typeof cents === "number" ? cents : Number(cents);
  if (!Number.isFinite(n)) return "—";
  return (n / 100).toLocaleString(undefined, { style: "currency", currency: "USD" });
}

function maskEin(ein: unknown): string {
  if (!ein) return "—";
  const s = String(ein).replace(/\D/g, "");
  if (s.length < 4) return "***";
  return `***-**-${s.slice(-4)}`;
}

function pick(obj: any, ...keys: string[]): unknown {
  if (!obj || typeof obj !== "object") return null;
  for (const k of keys) {
    const v = obj[k];
    if (v != null && v !== "") return v;
  }
  return null;
}

function buildContent(
  table: string,
  row: Record<string, any>,
  contact: { full_name?: string | null; email?: string | null } | null,
): { title: string; content: string; summary: string; metadata: Record<string, unknown> } {
  const who = contact?.full_name || contact?.email || "Client";
  const meta: Record<string, unknown> = {
    source_table: table,
    source_row_id: row.id,
  };

  if (table === "paige_business_credit_profiles") {
    const scores = (row.scores ?? {}) as Record<string, any>;
    const paydex = pick(scores, "paydex", "PAYDEX", "dnb_paydex");
    const intelliscore = pick(scores, "intelliscore", "intelliscore_plus", "experian_intelliscore");
    const dnbDelinquency = pick(scores, "dnb_delinquency", "delinquency");
    const experianFsr = pick(scores, "experian_fsr", "fsr");
    const eqxDelinq = pick(scores, "equifax_business_delinquency", "equifax_delinquency");
    const eqxFailure = pick(scores, "equifax_business_failure", "equifax_failure");
    const tl = Array.isArray(row.trade_lines) ? row.trade_lines : [];
    const tlCount = tl.length;
    const tlBalanceCents = tl.reduce(
      (sum: number, t: any) =>
        sum + (typeof t?.balance_cents === "number" ? t.balance_cents : 0),
      0,
    );

    const lines = [
      `Business Credit Snapshot — ${who}`,
      `Business: ${row.business_name ?? "—"} (EIN: ${maskEin(row.ein)})`,
      `Dun & Bradstreet Paydex: ${fmt(paydex)} | D&B Delinquency: ${fmt(dnbDelinquency)}`,
      `Experian Intelliscore: ${fmt(intelliscore)} | Experian FSR: ${fmt(experianFsr)}`,
      `Equifax Business Delinquency: ${fmt(eqxDelinq)} | Equifax Failure: ${fmt(eqxFailure)}`,
      `Trade lines reported: ${fmt(tlCount)} | Total tradeline balance: ${tlBalanceCents ? dollars(tlBalanceCents) : "—"}`,
      `Last pulled: ${row.last_pulled_at ?? "—"} | Nav profile: ${row.nav_profile_id ?? "—"}`,
    ];
    Object.assign(meta, {
      paydex,
      intelliscore,
      trade_lines_count: tlCount,
      last_pulled_at: row.last_pulled_at,
    });
    return {
      title: `Business credit — ${who}`,
      content: lines.join("\n"),
      summary: `Paydex ${fmt(paydex)} · Intelliscore ${fmt(intelliscore)} · ${fmt(tlCount)} trades`,
      metadata: meta,
    };
  }

  if (table === "paige_owner_credit_snapshots") {
    const factors = row.factors ?? {};
    const utilization = pick(factors, "revolving_utilization_pct", "utilization", "util");
    const inquiries = pick(factors, "inquiries_12mo", "hard_inquiries_12mo");
    const openAccts = pick(factors, "open_accounts_count", "open_accounts");
    const negatives = pick(factors, "negative_items_count", "derogatories");
    const topFactors = Array.isArray(factors?.top_factors)
      ? factors.top_factors
      : Array.isArray(factors?.score_factors)
      ? factors.score_factors
      : [];

    const lines = [
      `Owner Credit Snapshot — ${who}`,
      `Bureau: ${row.bureau ?? "—"} | Score: ${fmt(row.score)}`,
      `Utilization: ${fmt(utilization)}% | Inquiries (12mo): ${fmt(inquiries)}`,
      `Open accounts: ${fmt(openAccts)} | Negative items: ${fmt(negatives)}`,
      `Top factors: ${topFactors.length ? topFactors.join(" · ") : "—"}`,
      `Pulled at: ${row.pulled_at ?? "—"}`,
      `Note: read-only — Paige does not run dispute workflows (Doctrine §84).`,
    ];
    Object.assign(meta, {
      bureau: row.bureau,
      score: row.score,
      pulled_at: row.pulled_at,
    });
    return {
      title: `Owner credit (${row.bureau ?? "?"}) — ${who}`,
      content: lines.join("\n"),
      summary: `${row.bureau ?? "?"} ${fmt(row.score)} · util ${fmt(utilization)}%`,
      metadata: meta,
    };
  }

  if (table === "paige_bank_connections") {
    const accounts = Array.isArray(row.accounts) ? row.accounts : [];
    const lines = [
      `Banking Connection — ${who}`,
      `Institution: ${row.institution_name ?? "—"} | Status: ${row.status ?? "—"}`,
      `Accounts linked: ${fmt(accounts.length)} | Item: ${row.plaid_item_id ?? "—"}`,
      `Connected: ${row.connected_at ?? "—"} | Last sync: ${row.last_synced_at ?? "—"}`,
    ];
    Object.assign(meta, {
      institution: row.institution_name,
      status: row.status,
      accounts_count: accounts.length,
    });
    return {
      title: `Banking — ${row.institution_name ?? "Plaid"} — ${who}`,
      content: lines.join("\n"),
      summary: `${row.institution_name ?? "Bank"} · ${row.status ?? "?"} · ${accounts.length} accts`,
      metadata: meta,
    };
  }

  if (table === "paige_bank_transactions") {
    const lines = [
      `Bank Transaction — ${who}`,
      `Date: ${row.date ?? "—"} | Amount: ${dollars(row.amount_cents)}`,
      `Description: ${row.name ?? "—"} | Pending: ${row.pending ? "yes" : "no"}`,
      `Category: ${Array.isArray(row.category) ? row.category.join(" / ") : "—"}`,
    ];
    Object.assign(meta, {
      date: row.date,
      amount_cents: row.amount_cents,
      pending: row.pending,
    });
    return {
      title: `Transaction ${row.date ?? ""} — ${who}`,
      content: lines.join("\n"),
      summary: `${row.date ?? "?"} · ${dollars(row.amount_cents)} · ${row.name ?? "—"}`,
      metadata: meta,
    };
  }

  if (table === "paige_cash_flow_snapshots") {
    const netCents =
      (typeof row.total_deposits_cents === "number" ? row.total_deposits_cents : 0) -
      (typeof row.total_withdrawals_cents === "number" ? row.total_withdrawals_cents : 0);
    const periodDays =
      row.period_start && row.period_end
        ? Math.max(
            1,
            Math.round(
              (new Date(row.period_end).getTime() - new Date(row.period_start).getTime()) /
                (1000 * 60 * 60 * 24),
            ),
          )
        : null;

    const lines = [
      `Cash-Flow Snapshot — ${who}`,
      `Period: ${row.period_start ?? "—"} → ${row.period_end ?? "—"}${periodDays ? ` (${periodDays} days)` : ""}`,
      `Total deposits: ${dollars(row.total_deposits_cents)} | Total withdrawals: ${dollars(row.total_withdrawals_cents)}`,
      `Net flow: ${dollars(netCents)} | Avg daily balance: ${dollars(row.avg_daily_balance_cents)}`,
      `Runway: ${fmt(row.runway_days)} days | Funding readiness score: ${fmt(row.funding_readiness_score)}/100`,
    ];
    Object.assign(meta, {
      runway_days: row.runway_days,
      funding_readiness_score: row.funding_readiness_score,
      net_flow_cents: netCents,
      period_end: row.period_end,
    });
    return {
      title: `Cash flow — ${who}`,
      content: lines.join("\n"),
      summary: `${fmt(row.runway_days)}d runway · readiness ${fmt(row.funding_readiness_score)}/100`,
      metadata: meta,
    };
  }

  return { title: who, content: JSON.stringify(row).slice(0, 4000), summary: who, metadata: meta };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const openaiKey = "unused" ?? "";
    const auth = req.headers.get("Authorization") ?? "";

    if (!auth.includes(serviceKey)) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = (await req.json()) as Body;
    const docType = TABLE_TO_TYPE[body.source_table];
    if (!docType) {
      return new Response(JSON.stringify({ error: "Unsupported source_table" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(supabaseUrl, serviceKey);

    const { data: row, error: rowErr } = await admin
      .from(body.source_table)
      .select("*")
      .eq("id", body.source_row_id)
      .maybeSingle();
    if (rowErr || !row) {
      return new Response(JSON.stringify({ error: "Row not found", detail: rowErr?.message }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // bank_transactions doesn't carry contact_id directly — derive via bank_connection
    let resolvedContactId = body.contact_id;
    if (body.source_table === "paige_bank_transactions" && !resolvedContactId && row.bank_connection_id) {
      const { data: bc } = await admin
        .from("paige_bank_connections")
        .select("contact_id")
        .eq("id", row.bank_connection_id)
        .maybeSingle();
      resolvedContactId = (bc as any)?.contact_id ?? resolvedContactId;
    }

    // Resolve contact -> client (auth user) for RLS gating. `clients` is the
    // canonical contact table in Paige; some flows still pass through "contacts"
    // alias. Try clients first.
    const { data: client } = await admin
      .from("clients")
      .select(`full_name, linked_user_id, owner_user_id, ${CLIENT_CONTACT_METHODS_EMBED}`)
      .eq("id", resolvedContactId)
      .maybeSingle();
    // `email` on the contact is its PRIMARY email.
    const contact: any = withPrimaryAddresses(client);
    const clientUserId: string | null =
      contact?.linked_user_id ?? contact?.owner_user_id ?? null;

    const built = buildContent(body.source_table, row, contact);
    const dedupeKey = `${body.source_table}:${body.source_row_id}`;
    const metadata = {
      ...built.metadata,
      contact_id: resolvedContactId,
      dedupe_key: dedupeKey,
    };

    const embedding = openaiKey ? await embed(`${built.title}\n\n${built.content}`, openaiKey) : null;

    const { data: existing } = await admin
      .from("rag_documents")
      .select("id")
      .filter("metadata->>dedupe_key", "eq", dedupeKey)
      .maybeSingle();

    if (existing) {
      const { error: updErr } = await admin
        .from("rag_documents")
        .update({
          title: built.title,
          content: built.content,
          summary: built.summary,
          embedding,
          metadata,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id);
      if (updErr) throw updErr;
      return new Response(JSON.stringify({ updated: existing.id, embedded: !!embedding }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: ins, error: insErr } = await admin
      .from("rag_documents")
      .insert({
        document_type: docType,
        title: built.title,
        content: built.content,
        summary: built.summary,
        embedding,
        metadata,
        source: "financial_sync",
        client_id: clientUserId,
        is_anonymized: false,
        is_published: true,
        quality_score: 0.7,
      })
      .select("id")
      .single();
    if (insErr) throw insErr;

    return new Response(JSON.stringify({ inserted: ins.id, embedded: !!embedding }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("embed-client-financials error:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
