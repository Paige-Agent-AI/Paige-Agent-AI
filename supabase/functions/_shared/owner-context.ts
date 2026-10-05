// =============================================================================
// §52 — SUPER-ADMIN OWNER RUNTIME CONTEXT composer (Phase 1).
//
// WHY THIS EXISTS (§36 anchoring miss, 2026-08-09): the God/Super-Admin Paige
// chat opened a session and asked the FOUNDER who he was. Catastrophic for an
// AI-COO — Paige must open EVERY operator session ALREADY knowing who the
// operator is + the live platform state, the same way a real chief of staff
// walks in already briefed.
//
// WHAT THIS BUILDS: ONE compact system block, assembled from FOUR sources, in
// priority order (owner identity first, master excerpt last):
//   1. OWNER IDENTITY / PREFERENCES / PRIORITIES / PERMISSIONS — read from
//      paige_owner_memory rows (§10 config-as-data — the owner's identity is
//      NEVER hardcoded in this edge code; it lives in data the operator can
//      rewrite). If there are NO rows, the whole composer returns null and the
//      caller NO-OPs — Phase 1 never fabricates an operator identity.
//   2. LIVE PLATFORM STATE — REAL queries (tenant counts by revenue_class; real
//      ARR from live Stripe-backed platform subscriptions). Every query has an
//      HONEST fallback line ("not available") — NEVER a fabricated number (§13).
//   3. DOCTRINE §-INDEX — a COMPILED CONSTANT (an edge function cannot read
//      CLAUDE.md at runtime, so the load-bearing §-index is versioned WITH this
//      code, not "read from repo" — §13/§32 honesty).
//   4. MASTER / OWNER-TRILOGY EXCERPT — a COMPILED CONSTANT (Vision · MVP · the
//      4 platform pillars · current gaps), same honesty constraint as (3).
//
// §2/§9 CLEAN: this block ships ONLY to the tenant-less platform owner (the God
// account). It stays coaching-generic — zero credit/funding vertical content —
// exactly like every other platform default. The owner's own memory rows are
// operator/platform-identity content (seeded coaching-generic), never a vertical.
//
// §18 one home: this is the ONE composer for operator runtime context. The
// caller (paige-ai-chat) imports it; it does not fork a second copy.
// =============================================================================

// Structural supabase-js slice — kept loose (mirrors _shared/client-context.ts's
// `supabase: any`) so the module needs no supabase-js import and stays trivially
// unit-testable with a mock client. This is ALWAYS the SERVICE-ROLE client passed
// by the caller (RLS-free reads of operator-only tables); the userId is resolved
// upstream from the VERIFIED JWT (auth.uid()), never a request body (§51/§588).
type AdminClient = any;

interface OwnerMemoryRow {
  memory_type: string;
  content: string;
  created_at?: string;
}

// The memory_type buckets Phase 1 renders, in display order. Rows of any other
// memory_type are ignored here (open vocab, §10 — future types render later).
const MEMORY_SECTIONS: Array<{ type: string; heading: string }> = [
  { type: "identity", heading: "WHO YOU'RE WORKING WITH" },
  { type: "preference", heading: "HOW HE LIKES TO WORK" },
  { type: "active_priority", heading: "WHAT'S ON THE TABLE RIGHT NOW" },
  { type: "permission_note", heading: "WHAT YOU'RE CLEARED TO DO" },
  { type: "known_context", heading: "CONTEXT YOU ALREADY HAVE" },
];

// ── (3) COMPILED DOCTRINE §-INDEX — the load-bearing sections, one line each. ──
// Versioned WITH the code (an edge fn can't read CLAUDE.md at runtime, §13). Keep
// SHORT — this is a pointer index, not the doctrine itself.
const DOCTRINE_INDEX = `DOCTRINE §-INDEX (the standing rules you operate under — the full text lives in the repo's CLAUDE.md; this is your working pointer):
- §1/§14 — never work solo; convene a right-sized crew with a verifier. Paige orchestrates a team; she doesn't grind alone.
- §2 — client-based service businesses, never consumer-finance defaults. Funding/credit is an opt-in tenant preset, never a platform default.
- §3 — voice: direct, confident, mogul-founder. Cut tired AI-marketing buzzwords; say what Paige actually does, plainly.
- §4 — merge-on-verified; pre-launch ships straight to live. Don't ask permission to merge verified work.
- §5/§39 — two passes before every ship: adversarial verifier + compliance officer; plus an independent read of the real diff.
- §7/§8 — Paige is the two-way intelligent client portal; she orchestrates two departments (Owner-Ops + Client-Experience) over an action bus.
- §9/§51 — always separate platform (Super-Admin, us) from tenant; every change gets a per-tier availability check.
- §10 — everything stays Paige-governable: every action has a callable seam, config-as-data over hardcoding.
- §11/§25 — world-class is the floor; gold only on the act; see it before you ship it.
- §13/§32 — build like the best; a green build is not a working render; report what actually happened, never a hoped-for result.
- §16 — Paige runs a 10-department $100M org; §17 — the $1B growth map is the revenue north star.
- §18 — search before you scaffold; one home per capability.
- §36 — intuitiveness is the moat: Paige surfaces the work; the operator never has to know how to ask.`;

// ── (4) COMPILED MASTER / OWNER-TRILOGY EXCERPT — Vision · MVP · pillars · gaps. ──
// Also a versioned constant (§13). Kept compact; the full source of truth is the
// repo master doc, which THIS session's operator maintains.
const MASTER_EXCERPT = `PLATFORM SNAPSHOT (your working brief — the full source of truth is docs/PAIGE-MASTER-PROJECT-REFERENCE.md, which the operator maintains):
- VISION: Paige is the intelligent, two-way client portal and the operating system for operational life — an AI COO a non-technical operator can actually run. The intelligence is the moat.
- MVP (Wave 4): the tenant-authored Paige chat + the Vibe Studio (one-session creation of pages/funnels/forms/images) + the Owner-Ops/Client-Experience action bus, per Playbook.
- THE 4 PLATFORM PILLARS: (1) the intelligent portal/chat; (2) the Vibe Studio creation surface; (3) the action-bus orchestration of the two departments; (4) the governance spine (autonomy tiers, audit, tenant isolation, billing taxonomy).
- CURRENT GAPS (as of this build): cross-chat semantic recall is substrate-only (read path unwired); funnel generation depth trails single-artifact drafting; operator runtime-context loading (this feature) is Phase 1.`;

const MAX_CHARS = 12000; // ~3000 tokens target ceiling.

function fmtInt(n: number): string {
  return n.toLocaleString("en-US");
}

// ── §52 by-name greeting — read the operator's name from RUNTIME auth metadata. ──
// The name lives in auth.users user_metadata (full_name), NEVER in this repo (§45 — no owner PII in a
// committed artifact). We read it live via the service-role admin API and greet by FIRST name only;
// on any failure we fall back to a name-less "operator" greeting (§13 — never fabricate a name). The
// name only ever lands in the ephemeral prompt, never in stored/committed content.
async function fetchOperatorFirstName(admin: AdminClient, userId: string): Promise<string | null> {
  try {
    const { data, error } = await admin.auth.admin.getUserById(userId);
    if (error) throw error;
    const full = String(data?.user?.user_metadata?.full_name ?? "").trim();
    if (!full) return null;
    const first = full.split(/\s+/)[0]?.trim();
    return first || null;
  } catch (e) {
    console.warn("[owner-context] operator name read failed:", (e as Error)?.message);
    return null;
  }
}

// ── (2) LIVE PLATFORM STATE — real queries, honest fallbacks. ─────────────────
async function buildPlatformStateBlock(admin: AdminClient): Promise<string> {
  // Header is neutral (§39 finding #4): each line carries its OWN honesty — a real number when the
  // read succeeds, an explicit "not available" when it degrades. The header never asserts "real
  // numbers" over a line that failed.
  const lines: string[] = ["LIVE PLATFORM STATE (queried live at session open):"];

  // Tenant counts by revenue classification (operator-only table; service-role
  // bypasses RLS). Honest fallback if the read errors or returns nothing.
  try {
    const { data, error } = await admin
      .from("tenant_revenue_classification")
      .select("revenue_class");
    if (error) throw error;
    const rows = Array.isArray(data) ? data : [];
    if (rows.length === 0) {
      lines.push("- Tenants: none classified yet (no revenue-classification rows).");
    } else {
      const counts: Record<string, number> = {};
      for (const r of rows) {
        const k = String((r as any).revenue_class ?? "unknown");
        counts[k] = (counts[k] ?? 0) + 1;
      }
      const paid = counts["paid"] ?? 0;
      const promo = counts["promotional"] ?? 0;
      const test = counts["internal_test"] ?? 0;
      lines.push(
        `- Tenants: ${fmtInt(rows.length)} total — ${fmtInt(paid)} paid, ${fmtInt(promo)} promotional, ${fmtInt(test)} internal-test.`,
      );
    }
  } catch (e) {
    console.warn("[owner-context] tenant classification read failed:", (e as Error)?.message);
    lines.push("- Tenants: count not available right now (classification read failed).");
  }

  // Real ARR — ONLY live Stripe-backed active subs count (a comped 'active' row
  // with a NULL stripe_subscription_id is NOT real revenue — the §13 rule the
  // revenue-integrity chain enforces). Join the plan for the price + billing period.
  try {
    const { data, error } = await admin
      .from("platform_subscriptions")
      .select("status, stripe_subscription_id, billing_period, plan:platform_subscription_plans(monthly_price_cents, annual_price_cents)")
      .eq("status", "active")
      .not("stripe_subscription_id", "is", null);
    if (error) throw error;
    const subs = Array.isArray(data) ? data : [];
    if (subs.length === 0) {
      lines.push("- Real ARR: $0 — no live Stripe-backed paid subscriptions yet (pre-revenue).");
    } else {
      let annualCents = 0;
      for (const s of subs) {
        const plan = (s as any).plan ?? {};
        const monthly = Number(plan.monthly_price_cents ?? 0);
        const annual = Number(plan.annual_price_cents ?? 0);
        annualCents += (s as any).billing_period === "annual"
          ? (annual > 0 ? annual : monthly * 12)
          : monthly * 12;
      }
      lines.push(
        `- Real ARR: $${fmtInt(Math.round(annualCents / 100))} across ${fmtInt(subs.length)} live paid subscription${subs.length === 1 ? "" : "s"} (Stripe-backed, status=active).`,
      );
    }
  } catch (e) {
    console.warn("[owner-context] ARR read failed:", (e as Error)?.message);
    lines.push("- Real ARR: not available right now (subscription read failed).");
  }

  // Platform health — the latest OPERATOR-scope Systems Check sweep (tenant_id IS NULL).
  // Owner directive 2026-08-19: every capability wires back to Paige's brain, so she opens the
  // session already knowing whether the machine is running — not needing to be asked to look.
  //
  // §13 — SKIPS ARE NAMED, NEVER ABSORBED. The operator scan runs 10 checks but only ~5 are
  // assessable; the rest skip for real reasons (a canary that has never run, two drift checks a
  // Deno function structurally cannot perform, and two with no traffic yet). Reporting "4 passing"
  // and dropping the skips would be the same flattering arithmetic the Systems Check UI was just
  // fixed to stop — so the skipped count ships in the same sentence, and a BLOCKING skip is called
  // out as unassessed rather than quietly folded in with the rest.
  try {
    const { data: runRows, error: runErr } = await admin
      .from("paige_systems_check_run")
      .select("id, started_at")
      .is("tenant_id", null)
      .order("started_at", { ascending: false })
      .limit(1);
    if (runErr) throw runErr;
    const latest = (Array.isArray(runRows) ? runRows : [])[0] as { id: string; started_at: string } | undefined;

    if (!latest) {
      lines.push("- Platform health: no operator Systems Check sweep has been recorded yet.");
    } else {
      const { data: fRows, error: fErr } = await admin
        .from("paige_systems_check_finding")
        .select("check_id, status, severity_at_finding, resolved_at")
        .eq("run_id", latest.id);
      if (fErr) throw fErr;
      const rows = (Array.isArray(fRows) ? fRows : []) as Array<{
        check_id: string; status: string; severity_at_finding: string | null; resolved_at: string | null;
      }>;

      const pass = rows.filter((r) => r.status === "pass").length;
      const skipped = rows.filter((r) => r.status === "skip");
      const openFails = rows.filter((r) => r.status === "fail" && !r.resolved_at);
      const blockingFails = openFails.filter((r) => (r.severity_at_finding ?? "low") === "blocking");
      const blockingSkips = skipped.filter((r) => (r.severity_at_finding ?? "low") === "blocking");

      const mins = Math.max(0, Math.round((Date.now() - new Date(latest.started_at).getTime()) / 60000));
      const ago = mins < 60 ? `${mins}m ago` : `${Math.round(mins / 60)}h ago`;

      const parts = [`${fmtInt(pass)} of ${fmtInt(rows.length)} checks passed`];
      if (openFails.length > 0) {
        parts.push(
          `${fmtInt(openFails.length)} failing (${openFails.map((r) => r.check_id).join(", ")})`,
        );
      }
      if (skipped.length > 0) parts.push(`${fmtInt(skipped.length)} could not run`);
      lines.push(`- Platform health: last operator sweep ${ago} — ${parts.join("; ")}.`);

      if (blockingSkips.length > 0) {
        lines.push(
          `  UNASSESSED (blocking checks that could not run — treat as unknown, never as healthy): ${blockingSkips.map((r) => r.check_id).join(", ")}.`,
        );
      }
      if (blockingFails.length > 0) {
        lines.push(`  BLOCKING failure(s) open right now: ${blockingFails.map((r) => r.check_id).join(", ")}.`);
      }
    }
  } catch (e) {
    console.warn("[owner-context] systems-check read failed:", (e as Error)?.message);
    lines.push("- Platform health: not available right now (systems-check read failed).");
  }

  return lines.join("\n");
}

/**
 * Build the §52 super-admin owner runtime-context system block.
 *
 * CALLER CONTRACT (§39 finding #3 — the composer does NOT self-gate): this function
 * service-role-reads paige_owner_memory filtered ONLY by `userId`, with no internal
 * owner check. The CALLER MUST have already verified that `userId` is a platform
 * operator (the paige-ai-chat caller dual-gates on is_platform_operator() from the
 * verified JWT before calling). Do NOT call this with an unverified/body-supplied id —
 * a non-operator userId would return that user's own memory rows via the RLS-free client.
 *
 * @param admin  SERVICE-ROLE supabase client (RLS-free reads of operator tables).
 * @param userId the VERIFIED caller user id (auth.uid() upstream — never a body),
 *               already confirmed to be a platform operator by the caller.
 * @returns the assembled block string, or `null` when there are no owner-memory
 *          rows for this user (so the caller can NO-OP safely — Phase 1 never
 *          fabricates an operator identity).
 */
export async function loadOwnerContextBlock(
  admin: AdminClient,
  userId: string,
): Promise<string | null> {
  if (!userId) return null;

  // (1) OWNER IDENTITY / PREFS / PRIORITIES / PERMISSIONS — the owner-memory rows.
  // INT-326: the briefing is the OPERATOR surface, and operator memory is TENANT-LESS. A row this
  // same human holds in a Solo workspace (the platform owner dogfoods — same user_id, tenant_id
  // set) must never become briefing content merely because the identity coincides: the read is
  // restricted to `tenant_id IS NULL`. Tenant-owned rows belong to their Solo surfaces alone.
  let rows: OwnerMemoryRow[] = [];
  try {
    const { data, error } = await admin
      .from("paige_owner_memory")
      .select("memory_type, content, created_at")
      .eq("user_id", userId)
      .eq("is_active", true)
      .is("tenant_id", null)
      .order("memory_type", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) throw error;
    rows = (Array.isArray(data) ? data : []) as OwnerMemoryRow[];
  } catch (e) {
    console.warn("[owner-context] owner-memory read failed:", (e as Error)?.message);
    return null; // fail closed — no fabricated identity (§13).
  }

  if (rows.length === 0) return null; // no seeded identity yet → caller NO-OPs.

  // Render the identity sections in display order, only the types that have rows.
  const identityParts: string[] = [];
  for (const { type, heading } of MEMORY_SECTIONS) {
    const items = rows.filter((r) => r.memory_type === type).map((r) => (r.content || "").trim()).filter(Boolean);
    if (items.length === 0) continue;
    // One-liners render inline; multiple render as a tight list.
    if (items.length === 1) {
      identityParts.push(`${heading}\n${items[0]}`);
    } else {
      identityParts.push(`${heading}\n${items.map((c) => `- ${c}`).join("\n")}`);
    }
  }

  // Greet by first name when the runtime auth metadata has one (§45-clean: name from data, not repo).
  const firstName = await fetchOperatorFirstName(admin, userId);
  const whom = firstName ? `${firstName} — the PLATFORM OPERATOR` : "the PLATFORM OPERATOR";

  const header = `=== OPERATOR BRIEFING (§52 — you already know this; do NOT ask the operator who he is) ===
You are Paige speaking with ${whom} (the God / Super-Admin account — the founder who runs Paige Agent AI itself, not a tenant). You open this session already briefed on who he is, how he works, what's in play, and the live state of the platform. Greet him by name, naturally, the way a chief of staff who has been here for years would — never recite this briefing back as a file, never re-introduce yourself, and NEVER ask him to tell you who he is or what the company does.`;

  const platformState = await buildPlatformStateBlock(admin);

  // Assemble in PRIORITY order. If the total would blow the ceiling, drop from the
  // BOTTOM: identity > platform state > doctrine index > master excerpt.
  const ordered: string[] = [
    header,
    identityParts.join("\n\n"),
    platformState,
    DOCTRINE_INDEX,
    MASTER_EXCERPT,
  ];

  // Greedy assemble from the top; stop adding once we'd exceed the ceiling (the
  // lower-priority tail is what gets dropped, per the §52 priority order).
  const kept: string[] = [];
  let running = 0;
  const SEP = "\n\n";
  for (const part of ordered) {
    if (!part) continue;
    const add = (kept.length === 0 ? 0 : SEP.length) + part.length;
    if (running + add > MAX_CHARS && kept.length > 0) break;
    kept.push(part);
    running += add;
  }

  return kept.join(SEP) + "\n=== END OPERATOR BRIEFING ===";
}
