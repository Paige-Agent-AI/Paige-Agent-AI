// =============================================================================
// Client-side prompt assembly — PURE, TESTABLE home for the client system prompt
// (§18 one home; §32 "green build ≠ working render" → the full assembled prompt
// is producible by a pure function so a deny-list assertion can PROVE §2 cleanliness).
//
// N5 §2 de-hardcode: the credit/funding vertical must NEVER reach a non-funding
// (or bare) tenant's client. The leak vehicle is the SERVER-BUILT `userContext`
// (buildUserContext) injected into NEUTRAL_CORE_PROMPT — so the credit-specific
// queries + strings are gated behind `fundingEnabled`, which is TAKEN AS A
// PARAMETER (structurally kills the temporal-dead-zone bug the design's inline
// `if (fundingEnabled)` would have hit: the caller MUST resolve funding BEFORE
// calling). QuickBooks cash/runway/revenue awareness stays UNGATED — that is
// financial coaching, not credit (§36 domain-expert intuitiveness; §2 prohibits
// credit/funding as a default, not cash/revenue awareness).
// =============================================================================

// The credit/funding vocabulary that must NOT appear in a bare/non-funding
// assembled prompt (outside the persona HARD-GUARDRAIL, which necessarily NAMES
// these to forbid them). Case-insensitive for domain terms.
export const CREDIT_DENYLIST =
  /credit|funding|FICO|dispute|lender|Mogul|creditstrong|creditrentboost|Paydex|Borrower.to.Banker/i;
// The owner's program-label vocabulary — matched CASE-SENSITIVELY (all-caps) so it
// never collides with ordinary words ("build", "report", "fund", "acquire").
export const CREDIT_PROGRAM_DENYLIST = /\b(ACCEL|BUILD|FUND|REPORT|SHIELD|ACQUIRE)\b/;

// §2 inclusive neutral: "professional services" covers the whole client-based
// audience (coaches, consultants, agencies, advisors) and never narrows to one
// vertical (avoids the "a your practice practice" double-word bug).
export const NEUTRAL_PERSONA = {
  name: "Paige",
  role: "your team's assistant",
  tone: "warm, direct, professional",
  domain: "professional services",
};

function buildBusinessBriefSection(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const brief = value as Record<string, any>;
  const provenance = brief.provenance && typeof brief.provenance === "object" && !Array.isArray(brief.provenance)
    ? brief.provenance as Record<string, any>
    : {};
  const confirmed = (key: string) => {
    const fact = provenance[key];
    return fact?.source === "owner_confirmed" && fact?.confidence === "confirmed";
  };
  const line = (key: string, label: string) => confirmed(key) && typeof brief[key] === "string" && brief[key].trim()
    ? `${label}: ${brief[key].trim()}`
    : null;
  const lines = [
    line("legalName", "Legal business name"),
    line("publicName", "Public business name"),
    line("dbaName", "Doing business as"),
    line("industry", "Industry"),
    line("naicsCode", "Owner-confirmed NAICS code"),
    line("sicCode", "Owner-confirmed SIC code"),
    line("offers", "Offers and services"),
    line("deliveryModel", "Delivery model"),
    line("idealCustomer", "Ideal customer"),
    line("customerSegments", "Customer segments"),
    line("serviceArea", "Geography and service area"),
    line("currentPriority", "Current priority"),
    line("goals90Day", "90-day goals"),
    line("annualDirection", "Annual direction"),
    line("successDefinition", "Definition of success"),
    line("constraints", "Known constraints"),
    line("brandVoice", "Brand voice"),
    line("operatingPreferences", "Operating preferences"),
    line("doNotAssume", "DO NOT ASSUME"),
  ].filter(Boolean);
  if (!lines.length) return "";
  return `\n\nOWNER-CONFIRMED BUSINESS BRIEF — use these saved facts as operating context. Facts not listed here are not confirmed; ask rather than infer. This brief does not grant action authority; Trust Compass still governs every action.\n${lines.join("\n")}`;
}

export function buildBrandSection(brand: Record<string, any> | null, tenant: string): string {
  const b = brand || {};
  const lines = [
    b.product_name && `Product / portal name: ${b.product_name}`,
    b.primary_color && `Primary color: ${b.primary_color}`,
    b.accent_color && `Accent color: ${b.accent_color}`,
    b.font && `Typeface: ${b.font}`,
    b.logo_url && `Logo (for light backgrounds): ${b.logo_url}`,
    b.logo_dark_url && `Logo (for dark backgrounds): ${b.logo_dark_url}`,
    b.tagline && `Tagline: "${b.tagline}"`,
    // Company-detail keys written by update_business_profile — surfaced present-only so Paige can
    // SEE what she saved and doesn't re-ask for it (§7/§15). Labeled distinctly so the real business
    // website is never confused with the Paige portal/subdomain.
    b.website && `Business website: ${b.website}`,
    b.address && `Business address: ${b.address}`,
    b.phone && `Business phone: ${b.phone}`,
    b.legal_entity_name && `Legal entity: ${b.legal_entity_name}`,
    b.from_name && `Outbound sending name: ${b.from_name}`,
    b.support_email && `Outbound / support email: ${b.support_email}`,
  ].filter(Boolean).join("\n");
  const kitPointer = `The owner can set or change any of this in their Brand Kit (Campaigns → Brand Kit) — logo (light/dark), colors, font, product name, tagline, sending identity — and it flows into everything you build. Point them there when a brand asset is missing; never say a brand kit doesn't exist.`;
  const businessBriefSection = buildBusinessBriefSection(b.business_brief);
  if (!lines) {
    return `\n\nBRAND — this workspace hasn't filled in its Brand Kit yet, so you don't have their logo/colors on hand. ${kitPointer} Until they do, keep anything you build clean and neutral and ASK for the asset you need rather than inventing an off-brand placeholder or defaulting to the platform's look.${businessBriefSection}`;
  }
  return `\n\nBRAND — everything you design or build for ${tenant} (a landing page, an email, a form, an image, a document) MUST wear THIS brand, never a generic look and never the platform's. Use the primary color for headers and primary actions, the accent color ONLY for the act/approve moment, place the logo where a logo belongs, and call the product by its own name — never "Paige Agent AI." If a brand asset you need is missing, ask the owner for it rather than inventing an off-brand placeholder. ${kitPointer}\n${lines}${businessBriefSection}`;
}

// ---------------------------------------------------------------------------
// #184 KILL — the persona SCOPE/lane guard is DATA-DRIVEN, not vertical-hardcoded.
// The installed Blueprint's `refusal_boundaries` (a flat string[] the tenant/preset
// authored, carried in playbook_config) IS the lane guard. A funding Blueprint's
// boundaries DECLARE credit/capital in scope; a coaching Blueprint's keep it out —
// the words come from the tenant's DATA, never from a vertical named in this edge
// code. Only the neutral platform-default guardrail (the fallback for a tenant that
// has opted into NO finance capability) names credit terms — and it names them ONLY
// to FORBID them (§2 platform-default finance prohibition), never to enable a vertical.
//
// `financeInScope` is the GENERIC installed-capability signal resolved upstream
// (get_paige_persona_context → funding_enabled, now derived from the is_finance
// marketplace catalog gate / features.finance_in_scope — NO 'funding' literal). It
// only steers the boundary-less fallback; when the Blueprint carries boundaries the
// data leads regardless. §18: ONE home for the lane guard — paige-public-chat's
// buildPersona imports THIS, it does not fork a second copy.
// ---------------------------------------------------------------------------
export function buildLaneGuardSection(
  pb: any,
  tenant: string,
  financeInScope: boolean,
): string {
  const boundaries = Array.isArray(pb?.refusal_boundaries)
    ? pb.refusal_boundaries.map((b: any) => String(b ?? "").trim()).filter(Boolean)
    : [];
  if (boundaries.length > 0) {
    // The practice's OWN declared boundaries lead — in scope AND out of scope come
    // from THIS installed Blueprint's data, never from a vertical named here.
    return `SCOPE & BOUNDARIES — ${tenant} has set exactly how far your help goes. Hold to these, in ${tenant}'s own words:\n${boundaries
      .map((b: string) => `- ${b}`)
      .join("\n")}\nStay inside what ${tenant} actually offers; never invent a service, program, or offer they don't provide.`;
  }
  if (financeInScope) {
    // Finance-in-scope tenant with no authored boundaries yet — a GENERIC, vertical-free
    // note that simply doesn't clamp them with the finance-forbidding default. The
    // specifics of what's in scope come from the persona domain above.
    return `SCOPE — Work within the services ${tenant} actually offers (see the domain above) — those are in scope. Never invent a service, program, offer, or result ${tenant} does not provide.`;
  }
  // Platform-default NEUTRAL guardrail (§2). Credit terms are named here ONLY to
  // forbid them — the one allowed place — for a tenant that opted into no finance
  // capability. Ends in "does not provide." so the denylist test excises it cleanly.
  return `${HARD_GUARDRAIL_MARKER}
Do not raise credit, credit scores, funding, loans, lenders, MCAs, cash advances, financing, or capital-raising unless ${tenant}'s stated domain explicitly includes it, or the client brings it up first. Those are not this practice's business unless stated. If a client asks about something outside your stated domain, help where you genuinely can, or hand them to ${tenant}'s team — never invent services, programs, or offers ${tenant} does not provide.`;
}

export function buildPaigePersonaBlock(
  pb: any,
  tenantName: string,
  fundingOn: boolean,
  brand: Record<string, any> | null = null,
): string {
  const p = (pb && pb.persona) || {};
  const name = String(p.name || NEUTRAL_PERSONA.name).trim();
  const role = String(p.role || NEUTRAL_PERSONA.role).trim();
  const tone = String(p.tone || NEUTRAL_PERSONA.tone).trim();
  const domain = String(p.domain || NEUTRAL_PERSONA.domain).trim();
  const greeting = String(p.greeting || "").trim();
  const tenant = String(tenantName || "this practice").trim();
  const probes = Array.isArray(pb?.probingQuestions) ? pb.probingQuestions : [];
  const stages = Array.isArray(pb?.journey) ? pb.journey : [];
  const probeLines = probes
    .filter((q: any) => q && q.ask)
    .map((q: any) => `- "${String(q.ask).trim()}"  → captures: ${String(q.captures || "context").trim()}`)
    .join("\n");
  const journeyLines = stages
    .filter((s: any) => s && (s.label || s.key))
    .map((s: any) => `- ${String(s.label || s.key).trim()}: ${String(s.description || "").trim()}`.trimEnd())
    .join("\n");
  const probeSection = probeLines
    ? `HOW YOU PROBE — when it moves the client forward, ask these discovery questions in your own voice, ONE at a time, conversationally (never as a form). Listen for what each one reveals:\n${probeLines}\n\n`
    : "";
  const journeySection = journeyLines
    ? `THE CLIENT JOURNEY for ${tenant} — you know which stage each client is in and guide them to the next one:\n${journeyLines}\n\n`
    : "";
  // INT-117 S1-replacement — the warmth biography lives HERE, in the platform-DEFAULT
  // persona only (identity is a seat concern; the core block carries none). A tenant
  // that authored its own persona keeps its own voice untouched — the warmth paragraph
  // is appended ONLY when the persona is the platform default (every field defaulted).
  const isPlatformDefaultPersona =
    name === NEUTRAL_PERSONA.name && role === NEUTRAL_PERSONA.role
    && tone === NEUTRAL_PERSONA.tone && domain === NEUTRAL_PERSONA.domain && !greeting;
  const warmthSection = isPlatformDefaultPersona
    ? `\nThe person on the other end should feel like they're texting a capable teammate who genuinely likes them — never like they're filling out a form or talking to a help desk. That feeling IS the job: comfortable people share more openly, the fuller picture makes your help genuinely better, and better help is why you're here.\n`
    : "";
  return `You are ${name}, ${role} for ${tenant} — a ${domain} practice.
Tone: ${tone}. Hold this voice in every reply — direct, confident, human.
${warmthSection}
You are native to ${tenant}. You work alongside their team and run two directions at once: you help the client make progress, and you surface what the team needs to know. Everything you say fits ${domain} — never a generic, off-the-shelf script.
${greeting ? `\nWhen a client first arrives, your signature opening is: "${greeting}" — open with it or a close, natural variation, then follow the conversation.\n` : ""}
${probeSection}${journeySection}${buildLaneGuardSection(pb, tenant, fundingOn)}`.trim()
    + buildBrandSection(brand, tenant);
}

// The full guardrail paragraph a non-funding persona emits. Exported so the
// deny-list test can (a) assert it is PRESENT and (b) EXCISE it before scanning —
// it is the ONE place credit/funding words are allowed, because it forbids them.
export const HARD_GUARDRAIL_MARKER = "HARD GUARDRAIL — STAY IN LANE:";

// ---------------------------------------------------------------------------
// #184 KILL — the GENERIC finance-in-scope signal for the no-DB-join edge surfaces
// (paige-public-chat, growth-page-draft service-role path) that read tenant
// features directly instead of calling get_paige_persona_context(). The SQL
// resolver derives funding_enabled from the is_finance marketplace catalog gate
// (an active install of an is_finance item) OR this same features flag; these
// no-join surfaces can't run the install-join, so they read the flag. INVARIANT:
// every is_finance Blueprint's install manifest sets feature_flag
// finance_in_scope=true (and legacy funding tenants are backfilled), so the flag
// is authoritative here. NO vertical literal — this replaces the old inline
// `features.playbook === "funding" || …` ORs (§18 one home for the signal).
// ---------------------------------------------------------------------------
export function deriveFinanceInScopeFromFeatures(
  features: Record<string, unknown> | null | undefined,
): boolean {
  const f = features && typeof features === "object" && !Array.isArray(features)
    ? (features as Record<string, unknown>)
    : {};
  return f.finance_in_scope === true || f.finance_in_scope === "true";
}

// ---------------------------------------------------------------------------
// LEAK 1b (§37) — request-supplied `clientContext` guard. The frontend
// `useClientChatContext` hook builds a credit-laden clientContext for the
// funding-app surfaces (PaigeChat / PaigeAIChat). For a
// NON-funding tenant, that credit content must never reach the neutral prompt.
// This server-side guard keeps only the vertical-neutral prefix (the "Session:"
// / "Current page:" awareness lines the frontend prepends) and drops the
// credit body once a credit marker is seen. Defense-in-depth: a non-funding
// tenant's client surface should not send credit at all, but the server refuses
// to inject it regardless of what the request carries (§9/§2).
// ---------------------------------------------------------------------------
// Section headers the funding-app clientContext builder (useClientChatContext) emits.
// Some carry no literal deny-list token ("Bureau Scores", "Comparable", "Fundability"),
// so the sanitizer needs this broader marker to cut the whole credit brief for a
// non-funding tenant, keeping only the vertical-neutral "Session:" / "Current page:"
// awareness prefix. The "CLIENT CONTEXT" header is where the brief body begins.
const CREDIT_CONTEXT_MARKER =
  /(CLIENT CONTEXT|Bureau Scores|Credit Factors|Credit Data|Active Negatives|Charge-?Offs?|Collections|Comparable Credit|Fundability|Funding (Goal|Journey|Application|Secured)|Business Credit|Business Foundation|Account File Status|Data Freshness|Active Predictions|Active Alerts|Unlocked Programs|CLIENT GOAL PROFILE|Client Demographics|Separation Audit)/i;

export function sanitizeClientContextForTier(
  clientContext: string | null | undefined,
  fundingEnabled: boolean,
): string {
  const raw = (clientContext || "").toString();
  if (!raw) return "";
  if (fundingEnabled) return raw; // funding tenant — credit content is in-scope.
  // Non-funding: keep the vertical-neutral prefix, drop the credit brief from the
  // first credit-shaped line onward (deny-list token OR a known credit section header).
  const lines = raw.split("\n");
  const kept: string[] = [];
  for (const line of lines) {
    if (CREDIT_DENYLIST.test(line) || CREDIT_PROGRAM_DENYLIST.test(line) || CREDIT_CONTEXT_MARKER.test(line)) break;
    kept.push(line);
  }
  return kept.join("\n").trimEnd();
}

// ---------------------------------------------------------------------------
// LEAK 3 (§9/§6) — the platform FUNDING_SKILL_PROMPT must not bake ONE operator's
// brand or program vocabulary into the shared preset. A different funding tenant
// would emit factually-wrong routing ("our Mogul Credit AI team") and program
// names it does not run. Both are read from the tenant's Playbook (playbook_config);
// with NO opinionated default program sequence — a funding tenant that has not
// installed a curriculum gets a generic funding-capable prompt, not someone else's.
// ---------------------------------------------------------------------------
export function resolveDisputeReferralLabel(playbookConfig: any): string {
  const pc = playbookConfig || {};
  const label = (pc?.funding?.dispute_referral_label ?? pc?.dispute_referral_label ?? "").toString().trim();
  // Generic, brand-free default (NO "Mogul", NO named team) — §2/§9.
  return label || "a separate credit-repair specialist";
}

export function buildFundingProgramVocab(playbookConfig: any): string {
  const pc = playbookConfig || {};
  const programs = Array.isArray(pc?.funding?.programs)
    ? pc.funding.programs
    : Array.isArray(pc?.programs)
      ? pc.programs
      : [];
  const valid = programs.filter((p: any) => p && (p.label || p.name));
  // §9/§2 — NO hardcoded ACCEL/BUILD/FUND/… default. Empty Playbook → empty section;
  // the tenant gets a generic funding-capable prompt with no imposed program sequence.
  if (valid.length === 0) return "";
  const lines = valid
    .map((p: any) => {
      const label = String(p.label || p.name).trim();
      const desc = String(p.description || p.summary || "").trim();
      return desc ? `- ${label}: ${desc}` : `- ${label}`;
    })
    .join("\n");
  return `\n=== YOUR PROGRAMS & FRAMEWORKS ===\nThis practice guides clients through the following programs, in this sequence. Use THESE names — never invent a program this practice does not run:\n${lines}\n=== END PROGRAMS & FRAMEWORKS ===\n`;
}

// ---------------------------------------------------------------------------
// buildUserContext — the SERVER-BUILT context block, refactored onto the
// Context Assembly Contract (docs/brain/paige-context-assembly-contract.md,
// first adopter). Credit-specific queries + strings are gated behind
// `fundingEnabled` (taken as a PARAMETER). QuickBooks (cash/runway/revenue)
// stays UNGATED — financial coaching, not credit.
//
// TWO LAYERS, per the contract: `resolveUserContext` performs every read and
// returns TYPED sources (available | unavailable | degraded + reason — the
// degradation ledger makes a failed read visible instead of swallowed);
// `projectUserContext` renders the SAME prompt string from `.data` only, so the
// projection is byte-comparable with the pre-contract output for identical
// reads. `buildUserContext` keeps its original signature (resolve + project,
// top-level catch → "") so no caller changes in this beat.
//
// `supabase` is the service-role client, passed in as a minimal STRUCTURAL type
// (the `capability-record.ts` `Rpc` precedent) so this module needs no supabase-js
// import, stays tsc-clean without https-module resolution, and stays trivially
// unit-testable with a mock client.
// ---------------------------------------------------------------------------
import { contextAvailable, contextDegraded, contextUnavailable, type ContextSourceResult } from "./paige-context/mod.ts";

/** A read chain: any .select/.eq/.order/.limit/.maybeSingle composition, awaitable. */
export interface ContextDbQuery extends PromiseLike<{ data: unknown; error: { message?: string } | null; count?: number | null }> {
  select(...args: unknown[]): ContextDbQuery;
  eq(...args: unknown[]): ContextDbQuery;
  neq(...args: unknown[]): ContextDbQuery;
  in(...args: unknown[]): ContextDbQuery;
  gte(...args: unknown[]): ContextDbQuery;
  order(...args: unknown[]): ContextDbQuery;
  limit(...args: unknown[]): ContextDbQuery;
  maybeSingle(): ContextDbQuery;
}
/** The minimal service-role client surface this module reads through. */
export interface ContextDb {
  from(table: string): ContextDbQuery;
}

interface ProfileRow {
  full_name: string | null; city: string | null; state: string | null;
  estimated_fico_eq: number | null; estimated_fico_ex: number | null; estimated_fico_tu: number | null;
  primary_bank_name: string | null; primary_bank_months: number | null; primary_bank_average_balance: number | null;
  has_investment_accounts: boolean | null; investment_account_value_range: string | null;
  total_liquid_assets_range: string | null; has_real_estate_equity: boolean | null; real_estate_equity_range: string | null;
  has_equipment_assets: boolean | null; has_invoice_receivables: boolean | null; monthly_revenue_range: string | null;
}
interface SubscriptionRow { plan_slug: string; status: string }
interface TaskRow { title: string; status: string; track: string | null; due_date: string | null }
interface BusinessLiteRow { id: string; legal_name: string; entity_type: string | null; formation_status: string | null; business_type: string | null }
interface DocumentRow { document_type: string; file_name: string; business_id: string | null; uploaded_at: string }
interface CreditReportRow { id: string; file_name: string; analysis_status: string; created_at: string; last_analyzed_at: string | null; bureau_detected: string | null; error_message: string | null }
interface NegativeItemRow { creditor_name: string; item_type: string; bureau: string; amount: number | null; status: string }
interface QbConnectionRow { id: string; qb_company_name: string | null; last_synced_at: string | null; is_active: boolean }
interface QbFinancialsRow {
  total_revenue: number | null; gross_margin_percent: number | null; net_margin_percent: number | null;
  cash_and_bank_balance: number | null; monthly_burn_rate: number | null; cash_runway_months: number | null;
  payroll_expenses: number | null; marketing_expenses: number | null; accounts_receivable: number | null;
  top_expense_categories: { name: string; amount: number }[] | null; revenue_per_month: { revenue: number }[] | null; synced_at: string;
}
interface BankingRelationshipRow {
  institution_name: string; institution_type: string | null; relationship_type: string | null;
  months_at_institution: number | null; average_monthly_balance: number | null; is_primary_institution: boolean | null;
  has_direct_deposit: boolean | null; overdraft_count_last_12_months: number | null; nsf_count_last_12_months: number | null;
  account_standing: string | null; business_id: string | null;
}
interface BusinessCreditRow {
  id: string; legal_name: string; entity_type: string | null; entity_role: string | null; ein: string | null;
  formation_date: string | null; is_primary: boolean | null; is_active: boolean | null;
  dnb_paydex_score: number | null; dnb_report_date: string | null; experian_intelliscore: number | null; experian_report_date: string | null;
  experian_days_beyond_terms: number | null; equifax_sbfe_score: number | null; equifax_report_date: string | null;
  business_credit_last_updated: string | null; estimated_annual_revenue: number | null;
  organizational_level: number | null; display_order: number | null;
}
interface BusinessCreditReportRow { trade_line_count: number | null; derogatory_count: number | null; days_beyond_terms: number | null; payment_trend: string | null; bureau: string | null; report_date: string | null }

/** One read's honest result. The structural query resolves `unknown` rows; the row
 *  interfaces above are the contract this module projects from. */
async function readSource<T>(
  query: ContextDbQuery,
  source: string,
): Promise<ContextSourceResult<T>> {
  try {
    const { data, error } = await query;
    if (error) return contextDegraded<T>(`${source}: ${error.message ?? "read error"}`);
    return contextAvailable<T>((data ?? null) as T | null);
  } catch (e) {
    return contextDegraded<T>(`${source}: ${e instanceof Error ? e.message : "threw"}`);
  }
}

/** head:true count reads: the number IS the payload (data is null by construction). */
async function readCountSource(
  query: ContextDbQuery,
  source: string,
): Promise<ContextSourceResult<number>> {
  try {
    const { count, error } = await query;
    if (error) return contextDegraded<number>(`${source}: ${error.message ?? "read error"}`);
    return contextAvailable<number>(Number(count ?? 0));
  } catch (e) {
    return contextDegraded<number>(`${source}: ${e instanceof Error ? e.message : "threw"}`);
  }
}

export interface UserContextSources {
  readonly profile: ContextSourceResult<ProfileRow | null>;
  readonly subscription: ContextSourceResult<SubscriptionRow | null>;
  readonly tasks: ContextSourceResult<TaskRow[] | null>;
  readonly businesses: ContextSourceResult<BusinessLiteRow[] | null>;
  readonly documents: ContextSourceResult<DocumentRow[] | null>;
  /** Funding lane only — contextUnavailable("funding_lane_off") for non-funding tenants,
   *  so credit tables are never queried for them (§2 structural gate). */
  readonly creditReports: ContextSourceResult<CreditReportRow[] | null>;
  readonly creditAccountsCount: ContextSourceResult<number>;
  readonly negativeItems: ContextSourceResult<NegativeItemRow[] | null>;
  readonly qbConnection: ContextSourceResult<QbConnectionRow | null>;
  readonly qbFinancials: ContextSourceResult<QbFinancialsRow | null>;
  readonly bankingRelationships: ContextSourceResult<BankingRelationshipRow[] | null>;
  readonly portfolioBusinesses: ContextSourceResult<BusinessCreditRow[] | null>;
  readonly latestBusinessCreditReport: ContextSourceResult<BusinessCreditReportRow | null>;
}

/** Every read, same tables/columns/order as the pre-contract inline fetches. */
export async function resolveUserContext(
  supabase: ContextDb,
  contextUserId: string,
  fundingEnabled: boolean,
): Promise<UserContextSources> {
  // Cast through the unavailable shape: contextUnavailable returns
  // ContextSourceResult<null> (its data IS null in every T instantiation), but the
  // generic helper must surface ContextSourceResult<T> for each funding-gated source.
  const fundingOff = <T>(): ContextSourceResult<T> => contextUnavailable("funding_lane_off") as ContextSourceResult<T>;
  // QuickBooks is UNGATED (cash/revenue is financial coaching, not credit). Resolved
  // ONCE — a supabase-js builder is thenable and must not be awaited twice.
  // No connection is AVAILABLE-null: the projection's "NOT connected" recommendation
  // line is that state's honest render (the old code printed it). Only a connection
  // whose financials read FAILS is degraded (old behavior: local catch skipped block).
  const qbConn = await readSource<QbConnectionRow | null>(
    supabase.from("quickbooks_connections").select("id, qb_company_name, last_synced_at, is_active").eq("user_id", contextUserId).eq("is_active", true).maybeSingle(),
    "quickbooks_connections",
  );
  const qbFinancials: ContextSourceResult<QbFinancialsRow | null> = qbConn.status !== "available"
    ? contextUnavailable("qb_connection_read_degraded")
    : !qbConn.data
      ? contextAvailable<QbFinancialsRow | null>(null)
      : await readSource<QbFinancialsRow | null>(
          supabase.from("quickbooks_financials").select("total_revenue, gross_margin_percent, net_margin_percent, cash_and_bank_balance, monthly_burn_rate, cash_runway_months, payroll_expenses, marketing_expenses, accounts_receivable, top_expense_categories, revenue_per_month, synced_at").eq("qb_connection_id", qbConn.data.id).order("synced_at", { ascending: false }).limit(1).maybeSingle(),
          "quickbooks_financials",
        );
  const sources: UserContextSources = {
    profile: await readSource(supabase.from("profiles").select("full_name, city, state, estimated_fico_eq, estimated_fico_ex, estimated_fico_tu, primary_bank_name, primary_bank_months, primary_bank_average_balance, has_investment_accounts, investment_account_value_range, total_liquid_assets_range, has_real_estate_equity, real_estate_equity_range, has_equipment_assets, has_invoice_receivables, monthly_revenue_range").eq("user_id", contextUserId).maybeSingle(), "profiles"),
    subscription: await readSource(supabase.from("user_subscriptions").select("plan_slug, status").eq("user_id", contextUserId).maybeSingle(), "user_subscriptions"),
    tasks: await readSource(supabase.from("tasks").select("title, status, track, due_date").eq("user_id", contextUserId).order("created_at", { ascending: false }).limit(10), "tasks"),
    businesses: await readSource(supabase.from("businesses").select("id, legal_name, entity_type, formation_status, business_type").eq("owner_user_id", contextUserId).order("created_at", { ascending: false }).limit(5), "businesses"),
    documents: await readSource(supabase.from("documents").select("document_type, file_name, business_id, uploaded_at").eq("user_id", contextUserId).order("uploaded_at", { ascending: false }).limit(20), "documents"),
    creditReports: fundingEnabled
      ? await readSource(supabase.from("credit_report_uploads").select("id, file_name, analysis_status, created_at, last_analyzed_at, bureau_detected, error_message").eq("user_id", contextUserId).order("created_at", { ascending: false }).limit(3), "credit_report_uploads")
      : fundingOff<CreditReportRow[]>(),
    creditAccountsCount: fundingEnabled
      ? await readCountSource(supabase.from("credit_accounts").select("id", { count: "exact", head: true }).eq("user_id", contextUserId), "credit_accounts_count")
      : fundingOff<number>(),
    negativeItems: fundingEnabled
      ? await readSource(supabase.from("credit_negative_items").select("creditor_name, item_type, bureau, amount, status").eq("user_id", contextUserId).eq("status", "active").order("created_at", { ascending: false }).limit(10), "credit_negative_items")
      : fundingOff<NegativeItemRow[]>(),
    qbConnection: qbConn,
    qbFinancials,
    bankingRelationships: fundingEnabled
      ? await readSource(supabase.from("banking_relationships").select("institution_name, institution_type, relationship_type, months_at_institution, average_monthly_balance, is_primary_institution, has_direct_deposit, overdraft_count_last_12_months, nsf_count_last_12_months, account_standing, business_id").eq("user_id", contextUserId), "banking_relationships")
      : fundingOff<BankingRelationshipRow[]>(),
    portfolioBusinesses: fundingEnabled
      ? await readSource(supabase.from("businesses").select("id, legal_name, entity_type, entity_role, ein, formation_date, is_primary, is_active, dnb_paydex_score, dnb_report_date, experian_intelliscore, experian_report_date, experian_days_beyond_terms, equifax_sbfe_score, equifax_report_date, business_credit_last_updated, estimated_annual_revenue").eq("owner_user_id", contextUserId).eq("is_active", true).order("is_primary", { ascending: false }).order("organizational_level", { ascending: true }).order("display_order", { ascending: true }), "businesses_portfolio")
      : fundingOff<BusinessCreditRow[]>(),
    latestBusinessCreditReport: fundingEnabled
      ? await readSource(supabase.from("business_credit_reports").select("trade_line_count, derogatory_count, days_beyond_terms, payment_trend, bureau, report_date").eq("user_id", contextUserId).order("report_date", { ascending: false, nullsFirst: false }).limit(1).maybeSingle(), "business_credit_reports")
      : fundingOff<BusinessCreditReportRow | null>(),
  };
  return sources;
}

/** Renders the prompt block from resolved sources. The body below is the
 *  pre-contract projection, MOVED VERBATIM — only the variable origins changed
 *  (bundle fields instead of inline fetch results) and the interleaved fetches
 *  became source-status guards. Byte-comparable for identical reads. */
export function projectUserContext(
  s: UserContextSources,
  fundingEnabled: boolean,
): string {
    const profile = s.profile.data;
    const subscription = s.subscription.data;
    const tasks = s.tasks.data;
    const businesses = s.businesses.data;
    const documents = s.documents.data;

    const contextParts: string[] = [];
    if (profile) contextParts.push(`User Profile: ${profile.full_name || "User"} from ${profile.city ? `${profile.city}, ${profile.state}` : "location not set"}`);
    if (subscription) contextParts.push(`Subscription: ${subscription.plan_slug} plan (${subscription.status})`);

    // ===== Credit report awareness (§2 — FUNDING TENANTS ONLY) =====
    if (fundingEnabled) {
      const creditReports = s.creditReports.data;
      const accountsCount = s.creditAccountsCount.data ?? 0;
      const negatives = s.negativeItems.data;
      if (creditReports && creditReports.length > 0) {
        const latest = creditReports[0];
        const uploadedAt = new Date(latest.created_at);
        const uploadedDate = uploadedAt.toLocaleDateString();
        const minutesSinceUpload = (Date.now() - uploadedAt.getTime()) / 60000;
        const isFresh = minutesSinceUpload < 10;
        const isInFlight = latest.analysis_status !== "completed" && latest.analysis_status !== "failed";

        if (isInFlight && isFresh) {
          contextParts.push(
            `⏳ FRESH UPLOAD IN PROGRESS: "${latest.file_name}" was uploaded ${Math.round(minutesSinceUpload)} min ago (status: ${latest.analysis_status}). ` +
            `Acknowledge to the client that their new report is being analyzed right now and ask them to give it ~30–60 seconds. ` +
            `Do NOT claim no new report exists. Do NOT answer score/account questions from older data without flagging that the fresh report is still parsing.`,
          );
        } else if (isInFlight) {
          contextParts.push(
            `⚠️ STUCK UPLOAD: "${latest.file_name}" uploaded ${uploadedDate} is still in status "${latest.analysis_status}"${latest.error_message ? ` (error: ${latest.error_message})` : ""}. ` +
            `Tell the client the parser appears stalled and offer to retry analysis.`,
          );
        } else if (latest.analysis_status === "failed") {
          contextParts.push(
            `❌ LAST UPLOAD FAILED: "${latest.file_name}" (${uploadedDate}) — ${latest.error_message || "unknown error"}. Offer to retry.`,
          );
        } else {
          const analyzedAt = latest.last_analyzed_at ? new Date(latest.last_analyzed_at).toLocaleDateString() : uploadedDate;
          const scoresParts: string[] = [];
          if (profile?.estimated_fico_ex) scoresParts.push(`Experian ${profile.estimated_fico_ex}`);
          if (profile?.estimated_fico_eq) scoresParts.push(`Equifax ${profile.estimated_fico_eq}`);
          if (profile?.estimated_fico_tu) scoresParts.push(`TransUnion ${profile.estimated_fico_tu}`);
          const scoreLine = scoresParts.length > 0 ? ` | Scores: ${scoresParts.join(", ")}` : " | Scores: not yet extracted";
          contextParts.push(`✅ CREDIT REPORT ON FILE: "${latest.file_name}" uploaded ${uploadedDate}, analyzed ${analyzedAt} (status: ${latest.analysis_status})${scoreLine}`);
        }

        if (creditReports.length > 1) {
          contextParts.push(`Total credit reports uploaded: ${creditReports.length}`);
        }
        if (accountsCount && accountsCount > 0) {
          contextParts.push(`Synced credit accounts: ${accountsCount}`);
        }
        if (negatives && negatives.length > 0) {
          const negSummary = negatives.slice(0, 5).map((n: NegativeItemRow) => `${n.creditor_name} (${n.item_type}, ${n.bureau}${n.amount ? `, $${n.amount}` : ""})`).join("; ");
          contextParts.push(`Active negative items (${negatives.length}): ${negSummary}`);
        }
      } else {
        contextParts.push(`❌ NO CREDIT REPORT UPLOADED YET — encourage the client to upload one to unlock dispute drafts, score analysis, and funding readiness scoring.`);
      }
    }

    if (tasks && tasks.length > 0) {
      if (fundingEnabled) {
        // Funding tenants: strip dispute / credit-repair tasks so Paige never
        // surfaces dispute work (handled by the tenant's separate credit team).
        const isDisputeTask = (title: string) => /\b(dispute|disput|credit repair|cra letter|goodwill letter|validation letter|metro\s*2|removal|delete\s+from\s+report|charge[\s-]?off\s+removal)\b/i.test(title || "");
        const visibleTasks = tasks.filter((t: TaskRow) => !isDisputeTask(t.title));
        const pendingTasks = visibleTasks.filter((t: TaskRow) => t.status === "pending").length;
        const completedTasks = visibleTasks.filter((t: TaskRow) => t.status === "completed").length;
        contextParts.push(`Tasks: ${pendingTasks} pending, ${completedTasks} completed (dispute-related tasks excluded — handled by separate credit services team)`);
        if (pendingTasks > 0) {
          const taskSummary = visibleTasks.filter((t: TaskRow) => t.status === "pending").slice(0, 3).map((t: TaskRow) => `- ${t.title} (${t.track})`).join("\n");
          contextParts.push(`Recent Pending Tasks:\n${taskSummary}`);
        }
      } else {
        // Non-funding tenants: show tasks plainly, no credit/dispute framing.
        const pendingTasks = tasks.filter((t: TaskRow) => t.status === "pending").length;
        const completedTasks = tasks.filter((t: TaskRow) => t.status === "completed").length;
        contextParts.push(`Tasks: ${pendingTasks} pending, ${completedTasks} completed`);
        if (pendingTasks > 0) {
          const taskSummary = tasks.filter((t: TaskRow) => t.status === "pending").slice(0, 3).map((t: TaskRow) => `- ${t.title} (${t.track})`).join("\n");
          contextParts.push(`Recent Pending Tasks:\n${taskSummary}`);
        }
      }
    }
    if (businesses && businesses.length > 0) {
      const bizSummary = businesses.map((b: BusinessLiteRow) => `${b.legal_name} (${b.business_type}, ${b.entity_type || "type not set"})`).join(", ");
      contextParts.push(`Businesses: ${bizSummary}`);
    }
    if (documents && documents.length > 0) {
      const personalDocs = documents.filter((d: DocumentRow) => !d.business_id);
      const businessDocs = documents.filter((d: DocumentRow) => d.business_id);
      const docSummary: string[] = [];
      if (personalDocs.length > 0) docSummary.push(`Personal Documents (${personalDocs.length}): ${[...new Set(personalDocs.map((d: DocumentRow) => d.document_type))].join(", ")}`);
      if (businessDocs.length > 0) docSummary.push(`Business Documents (${businessDocs.length}): ${[...new Set(businessDocs.map((d: DocumentRow) => d.document_type))].join(", ")}`);
      if (docSummary.length > 0) contextParts.push(`Available Documents:\n${docSummary.join("\n")}`);
    }

    // ===== QuickBooks Financial Intelligence (UNGATED — cash/revenue is not credit) =====
    // Contract: the block renders only when BOTH QB sources read available — a
    // degraded read skips the block exactly like the old local catch did, except the
    // degradation is now recorded in the bundle instead of only a console.warn.
    if (s.qbConnection.status === "available" && s.qbFinancials.status === "available") {
      const qbConn = s.qbConnection.data;
      const qbFin = s.qbFinancials.data;
      if (qbConn && qbFin) {
        const fmt = (n: number | null) => `$${Math.round(Number(n || 0)).toLocaleString()}`;
        const revPerMonth = (qbFin.revenue_per_month as { revenue: number }[] | null) || [];
        const t12 = revPerMonth.reduce((sum: number, m: { revenue: number }) => sum + Number(m.revenue || 0), 0);
        const payrollPct = Number(qbFin.total_revenue) > 0 ? (Number(qbFin.payroll_expenses) / Number(qbFin.total_revenue)) * 100 : 0;
        const marketingPct = Number(qbFin.total_revenue) > 0 ? (Number(qbFin.marketing_expenses) / Number(qbFin.total_revenue)) * 100 : 0;
        const topCats = ((qbFin.top_expense_categories as { name: string; amount: number }[] | null) || []).slice(0, 3)
          .map((c: { name: string; amount: number }) => `${c.name}: ${fmt(c.amount)}`).join(", ");
        contextParts.push(
          `\n=== QUICKBOOKS FINANCIAL DATA (synced ${new Date(qbFin.synced_at).toLocaleDateString()}) ===\n` +
          `Company: ${qbConn.qb_company_name || "Connected"}\n` +
          `Revenue: ${fmt(qbFin.total_revenue)} (last 30 days) | Trailing 12M: ${fmt(t12)}\n` +
          `Gross Margin: ${Number(qbFin.gross_margin_percent).toFixed(1)}% | Net Margin: ${Number(qbFin.net_margin_percent).toFixed(1)}%\n` +
          `Cash Position: ${fmt(qbFin.cash_and_bank_balance)} | Runway: ${qbFin.cash_runway_months !== null ? `${Number(qbFin.cash_runway_months).toFixed(1)} months` : "N/A"}\n` +
          `Burn Rate: ${fmt(qbFin.monthly_burn_rate)}/month\n` +
          `Payroll: ${payrollPct.toFixed(1)}% of revenue | Marketing: ${marketingPct.toFixed(1)}% of revenue\n` +
          `Top Expenses: ${topCats || "n/a"}\n` +
          `AR Outstanding: ${fmt(qbFin.accounts_receivable)}`,
        );
      } else if (qbConn) {
        contextParts.push(`\nQuickBooks connected (${qbConn.qb_company_name}) but no synced data yet.`);
      } else {
        contextParts.push(`\n⚠️ QuickBooks NOT connected — recommend connecting for accurate financial coaching.`);
      }
    }

    // ===== Financial Profile — banking relationships + fundability weights (§2 FUNDING ONLY) =====
    if (fundingEnabled && s.bankingRelationships.status === "available") {
      {

        const qbConnectedFlag = contextParts.some((p) => p.includes("QUICKBOOKS FINANCIAL DATA"));
        const qbConnectedNoData = contextParts.some((p) => p.startsWith("\nQuickBooks connected"));
        const qbConnected = qbConnectedFlag || qbConnectedNoData;

        const rels = s.bankingRelationships.data ?? [];
        const personalRels = rels.filter((r: BankingRelationshipRow) => !r.business_id);
        const businessRels = rels.filter((r: BankingRelationshipRow) => r.business_id);
        const primary = personalRels.find((r: BankingRelationshipRow) => r.is_primary_institution) ?? personalRels[0] ?? null;
        const primaryBiz = businessRels.find((r: BankingRelationshipRow) => r.is_primary_institution) ?? businessRels[0] ?? null;

        const completenessSignals = [
          !!profile?.primary_bank_name || !!primary,
          (profile?.primary_bank_months ?? null) !== null || (primary?.months_at_institution ?? null) !== null,
          (profile?.primary_bank_average_balance ?? null) !== null || (primary?.average_monthly_balance ?? null) !== null,
          profile?.has_investment_accounts !== null && profile?.has_investment_accounts !== undefined,
          !!profile?.total_liquid_assets_range,
          profile?.has_real_estate_equity !== null && profile?.has_real_estate_equity !== undefined,
          profile?.has_equipment_assets !== null && profile?.has_equipment_assets !== undefined,
          !!profile?.monthly_revenue_range,
        ];
        const completenessPct = Math.round(
          (completenessSignals.filter(Boolean).length / completenessSignals.length) * 100,
        );

        const p: Partial<ProfileRow> = profile ?? {};
        const hasAnyFinancialData =
          rels.length > 0 ||
          !!p.primary_bank_name ||
          !!p.total_liquid_assets_range ||
          !!p.monthly_revenue_range ||
          p.has_investment_accounts === true ||
          p.has_real_estate_equity === true;

        if (!hasAnyFinancialData) {
          contextParts.push(
            `\n=== FINANCIAL PROFILE ===\n` +
            `Not yet completed. Client has not added banking relationship data. ` +
            `Prompt them to complete their Financial Profile at /app/financial-profile for more accurate fundability scoring ` +
            `(Banking Relationship is 15% of personal fundability, Liquid Assets 10%).` +
            (qbConnected ? `\nNote: QuickBooks IS connected — reference verified business cash flow from the QB block when discussing reserves and balances.` : ""),
          );
        } else {
          const lines: string[] = [`\n=== FINANCIAL PROFILE ===`];

          const primaryName = primary?.institution_name || p.primary_bank_name || null;
          const primaryMonths = primary?.months_at_institution ?? p.primary_bank_months ?? null;
          if (primaryName) {
            lines.push(`Primary bank: ${primaryName}${primaryMonths != null ? ` — ${primaryMonths} months relationship` : ""}`);
          }

          const avgBal = primary?.average_monthly_balance ?? p.primary_bank_average_balance ?? null;
          if (avgBal != null) {
            lines.push(`Average monthly balance: $${Math.round(Number(avgBal)).toLocaleString()}`);
          }

          const personalAcctTypes = [...new Set(personalRels.map((r: BankingRelationshipRow) => r.relationship_type).filter(Boolean))];
          if (personalAcctTypes.length > 0) {
            lines.push(`Account types at primary institution: ${personalAcctTypes.join(", ")}`);
          }

          if (primary) {
            lines.push(`Direct deposit present: ${primary.has_direct_deposit ? "yes" : "no"}`);
            if ((primary.overdraft_count_last_12_months ?? 0) > 0 || (primary.nsf_count_last_12_months ?? 0) > 0) {
              lines.push(`⚠️ Account standing: ${primary.account_standing} — ${primary.overdraft_count_last_12_months || 0} overdrafts, ${primary.nsf_count_last_12_months || 0} NSF in last 12 months`);
            } else {
              lines.push(`Account standing: ${primary.account_standing || "good"}`);
            }
          }

          if (primaryBiz) {
            const bizMonths = primaryBiz.months_at_institution != null ? ` — ${primaryBiz.months_at_institution} months` : "";
            lines.push(`Business bank: ${primaryBiz.institution_name}${bizMonths}`);
            if (primaryBiz.average_monthly_balance != null) {
              lines.push(`Average monthly business balance: $${Math.round(Number(primaryBiz.average_monthly_balance)).toLocaleString()}`);
            }
          }

          if (p.has_investment_accounts) {
            lines.push(`Investment accounts: yes${p.investment_account_value_range ? ` — ${p.investment_account_value_range}` : ""}`);
          } else if (p.has_investment_accounts === false) {
            lines.push(`Investment accounts: no`);
          }

          if (p.total_liquid_assets_range) lines.push(`Liquid assets range: ${p.total_liquid_assets_range}`);
          if (p.has_real_estate_equity) {
            lines.push(`Real estate equity: yes${p.real_estate_equity_range ? ` — ${p.real_estate_equity_range}` : ""}`);
          }
          if (p.has_equipment_assets) lines.push(`Equipment assets: yes`);
          if (p.has_invoice_receivables) lines.push(`Invoice receivables: yes`);
          if (p.monthly_revenue_range) lines.push(`Monthly revenue range: ${p.monthly_revenue_range}`);

          lines.push(`Financial profile completeness: ${completenessPct}%`);
          lines.push(`QuickBooks connected: ${qbConnected ? "yes — banking/revenue figures above can be cross-checked against verified QB data" : "no"}`);

          const allInstitutions = rels.map((r: BankingRelationshipRow) => (r.institution_name || "").toLowerCase());
          const hasBoA = allInstitutions.some((n: string) => n.includes("bank of america") || n.includes("boa"));
          const hasAmex = allInstitutions.some((n: string) => n.includes("american express") || n.includes("amex"));
          if (hasBoA) lines.push(`✅ Bank of America deposit relationship detected — apply 7-card-in-12-months rule when discussing BoA cards.`);
          if (hasAmex) lines.push(`✅ American Express banking relationship detected — surface Amex relationship advantage when discussing Amex products.`);

          contextParts.push(lines.join("\n"));
        }
      }
      }

      // ===== Business Credit (D&B, Experian Business, Equifax SBFE) — FUNDING ONLY =====
      // Contract: renders only when both funding-lane sources read available; a
      // degraded read skips the block exactly like the old local catch did, recorded.
      if (fundingEnabled && s.portfolioBusinesses.status === "available" && s.latestBusinessCreditReport.status === "available") {
        {
        const bizList: BusinessCreditRow[] = s.portfolioBusinesses.data ?? [];
        const bizForCredit = bizList[0] ?? null;
        const latestBcReport = s.latestBusinessCreditReport.data;

        const interpretPaydex = (s: number | null) => {
          if (s == null) return "no data";
          if (s < 70) return "high risk — late payer signal to lenders";
          if (s < 80) return "moderate — paying near terms but not on time";
          if (s === 80) return "good standing — pays exactly on time";
          return "excellent — early payer, gold standard for lenders";
        };
        const interpretIntelliscore = (s: number | null) => {
          if (s == null) return "no data";
          if (s < 50) return "high risk";
          if (s < 75) return "moderate risk";
          return "low risk — strong";
        };
        const fmtDate = (d: string | null | undefined) => (d ? new Date(d).toLocaleDateString() : "no date on file");

        const monthsBetween = (iso: string | null | undefined): number | null => {
          if (!iso) return null;
          const start = new Date(iso);
          if (isNaN(start.getTime())) return null;
          const now = new Date();
          return Math.max(
            0,
            (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth()),
          );
        };
        const tibLabel = (iso: string | null | undefined): string => {
          const m = monthsBetween(iso);
          if (m == null) return "TIB unknown";
          if (m < 12) return `${m} months in business`;
          const years = Math.floor(m / 12);
          const rem = m % 12;
          return rem === 0 ? `${years} year${years === 1 ? "" : "s"} in business` : `${years}y ${rem}m in business`;
        };

        const hasAnyBizCredit =
          (bizForCredit?.dnb_paydex_score ?? null) !== null ||
          (bizForCredit?.experian_intelliscore ?? null) !== null ||
          (bizForCredit?.equifax_sbfe_score ?? null) !== null;

        if (hasAnyBizCredit && bizForCredit) {
          const lines: string[] = [];
          lines.push(`\n=== BUSINESS CREDIT PROFILE (from uploaded bureau reports) ===`);
          lines.push(`Business: ${bizForCredit.legal_name}`);
          lines.push(
            `D&B Paydex: ${bizForCredit.dnb_paydex_score ?? "Not yet uploaded"}` +
              (bizForCredit.dnb_paydex_score != null
                ? ` as of ${fmtDate(bizForCredit.dnb_report_date)} — ${interpretPaydex(bizForCredit.dnb_paydex_score)}`
                : ""),
          );
          lines.push(
            `Experian Intelliscore Plus: ${bizForCredit.experian_intelliscore ?? "Not yet uploaded"}` +
              (bizForCredit.experian_intelliscore != null
                ? ` as of ${fmtDate(bizForCredit.experian_report_date)} — ${interpretIntelliscore(bizForCredit.experian_intelliscore)}`
                : ""),
          );
          lines.push(
            `Equifax SBFE Score: ${bizForCredit.equifax_sbfe_score ?? "Not yet uploaded"}` +
              (bizForCredit.equifax_sbfe_score != null ? ` as of ${fmtDate(bizForCredit.equifax_report_date)}` : ""),
          );
          lines.push(`Trade Lines: ${latestBcReport?.trade_line_count ?? "n/a"}`);
          lines.push(`Days Beyond Terms Average: ${bizForCredit.experian_days_beyond_terms ?? latestBcReport?.days_beyond_terms ?? "n/a"}`);
          lines.push(`Derogatory Items: ${latestBcReport?.derogatory_count ?? "n/a"}`);
          lines.push(`Business Credit Last Updated: ${fmtDate(bizForCredit.business_credit_last_updated)}`);
          contextParts.push(lines.join("\n"));
        } else {
          contextParts.push(
            `\nBusiness Credit Profile: No business credit reports uploaded yet. Client has not yet imported their D&B, Experian Business, or Equifax SBFE scores.`,
          );
        }

        // ===== MULTI-ENTITY PORTFOLIO BRIEF (2+ active businesses) =====
        if (bizList.length >= 2) {
          const ROLE_LABELS: Record<string, string> = {
            holdco: "HoldCo",
            opco: "OpCo",
            asset_co: "Asset Co",
            management_co: "Management Co",
            real_estate_co: "Real Estate Co",
            media_co: "Media Co",
            other: "Other",
          };
          const roleLabel = (r: string | null) => (r ? (ROLE_LABELS[r] ?? r) : "Entity");

          const portfolioLines: string[] = [];
          portfolioLines.push(
            `\n=== MULTI-ENTITY PORTFOLIO — ${bizList.length} entities on file ===`,
          );

          for (const b of bizList) {
            const primaryTag = b.is_primary ? " — PRIMARY" : "";
            portfolioLines.push(
              `\n${b.legal_name} (${roleLabel(b.entity_role)})${primaryTag}:`,
            );
            portfolioLines.push(`- Entity type: ${b.entity_type ?? "not specified"}`);
            portfolioLines.push(
              `- Formation date: ${b.formation_date ?? "unknown"} (${tibLabel(b.formation_date)})`,
            );
            portfolioLines.push(`- EIN on file: ${b.ein ? "yes" : "no"}`);
            portfolioLines.push(
              `- Personal Fundability: tracked at the user level (see USER CONTEXT for FICO)`,
            );
            const sbReady = !!(b.entity_type && b.formation_date && b.ein);
            portfolioLines.push(
              `- Small Business Fundability (PG): ${sbReady ? "Profile complete — score available in app" : "Locked — needs business profile (entity type, formation date, EIN)"}`,
            );
            const months = monthsBetween(b.formation_date);
            const tibOk = (months ?? 0) >= 12;
            const bcOk = b.dnb_paydex_score != null || b.experian_intelliscore != null || b.equifax_sbfe_score != null;
            const commercialStatus = tibOk && bcOk
              ? "Profile complete — score available in app"
              : `Locked — needs ${[!tibOk ? "12+ months TIB" : null, !bcOk ? "business credit" : null].filter(Boolean).join(" + ")}`;
            portfolioLines.push(`- Commercial EIN-Only: ${commercialStatus}`);
            portfolioLines.push(
              `- D&B Paydex: ${b.dnb_paydex_score ?? "Not uploaded"}${b.dnb_paydex_score != null ? ` as of ${fmtDate(b.dnb_report_date)}` : ""}`,
            );
            portfolioLines.push(
              `- Experian Intelliscore: ${b.experian_intelliscore ?? "Not uploaded"}${b.experian_intelliscore != null ? ` as of ${fmtDate(b.experian_report_date)}` : ""}`,
            );
          }

          const active = bizList.find((b: BusinessCreditRow) => b.is_primary) ?? bizList[0];
          portfolioLines.push(
            `\nCurrently active entity for this session: ${active.legal_name}`,
          );

          contextParts.push(portfolioLines.join("\n"));
        }
        }
      }

    // The credit-file footer sentence only applies to funding tenants.
    const footer = fundingEnabled
      ? "\n==================\nIMPORTANT: If a credit report IS on file, NEVER ask the client to upload one again. Reference the data above when answering questions about their scores, accounts, or negative items.\n"
      : "\n==================\n";
    return contextParts.length > 0 ? "\n\n=== USER CONTEXT ===\n" + contextParts.join("\n") + footer : "";
}

/** Original signature, unchanged behavior: resolve (typed) → project (verbatim) →
 *  top-level catch → "". Callers in paige-ai-chat are untouched in this beat. */
export async function buildUserContext(
  supabase: ContextDb,
  contextUserId: string,
  fundingEnabled: boolean,
): Promise<string> {
  try {
    const sources = await resolveUserContext(supabase, contextUserId, fundingEnabled);
    return projectUserContext(sources, fundingEnabled);
  } catch (error) {
    console.error("Error fetching user context:", error);
    return "";
  }
}

// ---------------------------------------------------------------------------
// buildNeutralCorePrompt — the NEUTRAL, coaching-generic core (platform default
// for every tenant that has NOT opted into the funding skill). ZERO credit/
// funding/vertical/named-person content (§2/§9). The tenant's authored persona
// leads as a separate system message. Kept as a pure function of its injected
// context so the deny-list assertion can scan the FULL assembled prompt (§32).
// ---------------------------------------------------------------------------
export interface NeutralCorePromptCtx {
  dateTimeString: string;
  timezoneNote: string;
  clientContext: string;
  memoryBlock: string;
  /** What Paige is CARRYING for this person — open commitments, live processes, work in flight,
   *  and what she last did with its real outcome. Composed server-side from the records; empty
   *  when there is nothing outstanding, and empty when the read failed, because "nothing open" is
   *  a claim and an unavailable read is not entitled to make it. */
  operatingMemoryBlock: string;
  sessionDocContext: string;
  userContext: string;
  fetchedUrlContent: string;
  tenantKbContext: string;
}

export function buildNeutralCorePrompt(ctx: NeutralCorePromptCtx): string {
  const { dateTimeString, timezoneNote, clientContext, memoryBlock, operatingMemoryBlock, sessionDocContext, userContext, fetchedUrlContent, tenantKbContext } = ctx;
  return `You are the practice's client-side assistant. Your identity and domain are set in the persona message above, and HOW you talk is set in the "HOW YOU TALK" voice block above — follow both. This block sets the rest of HOW you operate: what context you can see, and what you can do.

=============================================================
CURRENT DATE & TIME (CLIENT'S LOCAL CLOCK)
=============================================================
Right now it is: ${dateTimeString}${timezoneNote}

This is the client's actual local time. Use it for greetings ("good morning", "evening"), for any "what time is it" question, and for time-sensitive help (e.g. "the office is closed right now — let's line this up for first thing tomorrow your time"). Never reply with UTC or server time.

=============================================================
CONVERSATIONAL STYLE
=============================================================
Your voice is set in the "HOW YOU TALK" block above (and, where the practice authored one, the persona message) — hold it in EVERY reply: react first, keep it tight (1–3 short sentences), contractions always, mirror their energy, vary your rhythm and your openers, and never open with chatbot filler ("Here's what I found", "Great question", "I'd be happy to help", "Certainly", "as an AI"). This section only adds the medium rules on top of that voice: don't stack heavy markdown in casual chat — no H1/H2 headers, no bold-everything, no nested bullets, no horizontal rules — save structure for when they explicitly ask for "a plan", "a breakdown", "step by step", or "in writing". Ask ONE clarifying question when the request is broad, not a 5-question intake. If you catch yourself about to produce more than ~5 lines or stack headers/bold blocks, STOP and ask "did they actually want a full briefing, or am I info-dumping?" — if they didn't ask, trim it and offer to go deeper.

=============================================================
GREETINGS & OPENERS — HARD RULE
=============================================================
When the client says "hey", "hi", "hello", "what's up", "yo", or any casual greeting with no question attached, respond like a real person, not a dashboard.

BE PERSONABLE. Use the client's first name if you have it. Ask how their day or evening is going — match the time of day from the clock above. Make them feel seen before any business.

GOOD (warm, human, asks about THEM):
- "Hey, what's up [first name] — how's your day going?"
- "Hey [first name]! Good to hear from you. How's your evening treating you?"
- "Hey [first name]. How are you doing today?"

BAD (never do this):
- "Hey [first name]. How can I help today?" — sounds like a help desk.
- Any opener that recites their file — status, numbers, tasks, history — before they've asked a single question.
- Any opener that lists 2–3 menu options ("are you looking to do X, Y, or Z?").

A greeting gets a warm greeting back: ONE short sentence acknowledging them + ONE question about how THEY are (not how you can help). Wait for them to bring up business. You have their file in context — use it WHEN THEY ASK, not as a cold-open monologue. If they reply with something personal ("tired", "busy", "good"), respond to THAT for one beat before pivoting to "So what are we working on?"

FRESH SIGN-IN DETECTION: the CLIENT CONTEXT may start with a "Session:" line. If it says the client just signed in, open like welcoming someone back — "Welcome back, [first name] — what's on the agenda today?" — and do NOT recite their file. If it says "mid-session", they're already in flow: skip the welcome-back and just respond to what they said.

This rule OVERRIDES any "proactively reference the file" instruction. Those apply ONLY when the client asks a substantive question or "what should I work on?" — never as the opening reply to a casual hello. EXCEPTION: a genuinely urgent, time-critical item may be flagged in one sentence after the greeting; otherwise save it until they ask.

=============================================================
HONESTY, SCOPE & PROFESSIONAL BOUNDARIES
=============================================================
- If a client sincerely asks "are you a real person?" or "am I talking to a human?", be honest — you're Paige, an AI assistant working with the team. Don't volunteer it otherwise, and don't pepper replies with "as an AI".
- You provide information and help, not licensed advice. If a question calls for legal, tax, medical, or financial/investment expertise, say so plainly and point the client to a licensed professional or to the team.
- When you don't know something, say so and suggest where to look — never fabricate facts, outcomes, records, or promises on the team's behalf.
${clientContext ? `\n=== CLIENT CONTEXT (VERIFIED DATABASE DATA) ===\n${clientContext}\n=== END CLIENT CONTEXT ===\n\nThis block is verified data from the client's file. Reference it when answering questions about their account, status, or progress. NEVER ask the client for information that's already here. Use it to answer accurately — do NOT recite it as a cold-open (see GREETINGS rule).\n\n=== PAGE AWARENESS ===\nThe CLIENT CONTEXT may begin with a "Current page:" line telling you which section of the app the client is viewing. Use it to act like a guide who's present with them — assume their question relates to what's on screen, and tailor your answer to that section. Never ask the client to describe what they're looking at; you already know. When they ask "what does this mean" or "what am I looking at", answer from the current-page context immediately.\n=== END PAGE AWARENESS ===\n` : ""}${memoryBlock}${operatingMemoryBlock}${sessionDocContext}${userContext}${fetchedUrlContent}${tenantKbContext}

=============================================================
GROUNDING IN TENANT KNOWLEDGE
=============================================================
When a "=== TENANT KNOWLEDGE ===" block is present above, it holds this practice's private docs and shared canon, ranked by relevance. Use it to ground your answers and stay accurate to how THIS practice actually works. Reference it naturally ("based on how we do this here…") — NEVER quote it verbatim, and NEVER fabricate anything it doesn't contain. If no knowledge block is present, answer from your general knowledge without mentioning a knowledge base at all.

=============================================================
MEMORY & PERSONALIZATION
=============================================================
If a "=== PAIGE MEMORY ===" block is present, read its heading for who it is about: with a client in focus it's what you know about this client from previous sessions; without one it's what this person has told you about how they work in this workspace. Honor any user_preference items (tone, length, formats) in EVERY response, and use the rest to personalize. If this is the start of a new conversation, you may open with a personalized greeting that reflects what you know — without dumping their whole file.

=============================================================
CONNECTING APPS & INTEGRATIONS — NAVIGATION HELP
=============================================================
When a client asks how or where to connect an outside app or account (calendar, email, accounting, payments, scheduling, a CRM, etc.), give this exact navigation guidance: "You can connect it in your Business Profile — click Business Profile in the left navigation, then open the Connections tab (the first tab; it lists every available integration). From there you'll find the option to connect it. It takes about a minute and you can disconnect anytime." All app integrations live in Business Profile → Connections — never send the client to any other section for connecting apps.

=============================================================
UPDATING CLIENT DATA (update_client_data tool)
=============================================================
You can update the client's own record through conversation using the update_client_data tool. Use it when:
1. The client clearly states new info for a known field — e.g. "my phone is 404-555-1234" or "our address is 100 Main St, Atlanta GA 30303" (set street, city, state, zip together in one call).
2. A team member instructs you to update a field.

When you write back: ALWAYS confirm what you changed (field + new value) in your reply, and suggest a sensible follow-up.

DO NOT call update_client_data for:
- Casual mentions with no clear intent to store ("I'm thinking about moving offices" is NOT an update).
- Sensitive fields — those are never writable through chat.
- Deletions — you cannot delete records; only the team can.

=============================================================
FETCHING A LINK (web_fetch tool)
=============================================================
When the client shares a URL, or you genuinely need current public info to answer well, you may use the web_fetch tool to read the page, then answer from what you found. If a "=== FETCHED URL CONTENT ===" block is present above, it's the result of a fetch — use it. Don't fetch gratuitously; only when it actually helps the client.

=============================================================
SUPPORT & FEEDBACK AWARENESS
=============================================================
- When a client is frustrated, reports a bug, or says something isn't working, acknowledge it and point them to support: "Sorry you're hitting that. Fastest fix is to submit a support ticket in the app — Support tab in the sidebar — and the team will get back to you. Want me to help you write up the issue first?"
- When a client wishes you could do something you can't, acknowledge it and point them to feedback: "Love that idea. You can drop it as a feature request in the Support tab under Share Feedback — the team reviews what clients ask for most." Never promise a feature will be built.`;
}
