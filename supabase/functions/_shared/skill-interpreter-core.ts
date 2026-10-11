// _shared/skill-interpreter-core.ts — the PURE decision logic of the Skills S1b steps-interpreter
// (concept 1 in docs/doctrine/skills-vocabulary.md — an executable `paige_skills` recipe).
//
// This file is DELIBERATELY Deno-free (no esm.sh/URL imports, no Deno.env) so it can be unit-tested
// by vitest from src/ exactly like `_shared/contact-search.ts` (hotfix #127). The Deno orchestrator
// that wires these helpers to the real `forge()` seam + the DB lives in `_shared/skill-interpreter.ts`.
//
// WHY an interpreter (§16/§26): the shipped skill-runner dispatches with a switch(slug) + one bespoke
// handler per skill. That doesn't scale — every new skill Paige forges would need hand-written Deno.
// The interpreter reads the skill ROW (steps + methodology_anchor + allowed_tools + autonomy_lane +
// tier_availability) and drives a generic, doctrine-clean run through the EXISTING prompt-forge seam.
// It is ADDITIVE (§58): the 4 shipped skills stay on their bespoke handlers untouched; the interpreter
// only runs for slugs that today hit the default case (which just throws "no runtime handler").

// ── Types ──────────────────────────────────────────────────────────────────────────────────────
export type AutonomyLane = "auto" | "confirm" | "off";

/** How a skill run resolves after generation, derived from its autonomy_lane (§16). */
export type ExecutionMode =
  | "execute"   // 🟢 auto — return the output (and safe INTERNAL writes only; never an external send)
  | "approval"  // 🟡 confirm — file a draft to paige_pending_approvals for a human to approve
  | "brief";    // 🔴 off — hand back a brief only; write nothing, execute nothing

/** The only generation modality a skill forges today (§17 vocabulary — there is no "copy" modality). */
export type SkillModality = "text";

/** The router tiers a skill may forge at (§17). external-send-risk content escalates to frontier. */
export type SkillTier = "frontier" | "open-flexible";

/** §51/§60 tier keys. `null` = the caller's tier was not resolved server-side (UI is the primary gate). */
export type CallerTier = "god" | "agency" | "enterprise" | "sub_account" | "solo" | null;

export interface SkillStep {
  id?: string;
  tool?: string;
  desc?: string;
  // ── S1b browser-dispatch fields (all OPTIONAL) — a `tool:"browser"` step carries the page to
  //    observe + optional read-only observation steps for the paige-browser /self-verify contract. ──
  url?: string;
  /** Read-only observation steps passed through to paige-browser (assertSelector|assertText|readText). */
  steps?: unknown[];
  waitForSelector?: string;
  waitMs?: number;
  // ── S3b public-web browse fields ── a `tool:"browser"` step with `mode:"public"` routes to the
  //    paige-browser /browse-public-url endpoint (arbitrary public URL research), NOT /self-verify.
  //    The URL comes from RUNTIME INPUT (inputs.url) at dispatch; a static `url` here is a fallback.
  mode?: string;
  maxContentBytes?: number;
}

/** The subset of a `paige_skills` row the interpreter reasons over. */
export interface SkillRow {
  slug: string;
  name: string;
  category: string | null;
  risk_level: string | null;
  autonomy_lane: string | null;                      // may be null on a legacy row
  methodology_anchor: string | null;
  scoping: string | null;                            // 'platform' | 'tenant' — drives the §2 finance guard
  tier_availability: Record<string, unknown> | null; // per-skill §61 doc, added #466
  steps: SkillStep[] | null;
  allowed_tools: string[] | null;
}

// ── S1b browser-dispatch seam types (§18 — mirrors the forge seam; the outbound fetch lives in the HOST) ──
/** The args the interpreter hands the injected browse dep — the paige-browser /self-verify contract subset. */
export interface BrowseArgs {
  url: string;
  steps?: unknown[];
  waitForSelector?: string;
  waitMs?: number;
}

/** The honest structured observation paige-browser returns (HTTP 200 either way; `ok:false` on failure). */
export interface BrowseObservation {
  ok: boolean;
  url?: string;
  final_url?: string;
  http_status?: number | null;
  title?: string;
  text_excerpt?: string;
  steps?: Array<{ kind?: string | null; ok?: boolean; detail?: string }>;
  screenshot_b64?: string | null;
  duration_ms?: number | null;
  error?: string;
}

/** Honest degrade — the browse seam is unconfigured (no PAIGE_BROWSER_URL/SECRET on the host). */
export interface BrowseNeedsConfig { needs_config: true }

export type BrowseResult = BrowseObservation | BrowseNeedsConfig;

/** The injected browse dep (the actual outbound fetch lives in the HOST — skill-runner — never the pure core). */
export type BrowseFn = (args: BrowseArgs) => Promise<BrowseResult>;

// ── S1b browser-dispatch decision helpers (PURE — unit-tested; the orchestrator wires them to the seam) ──
/**
 * The first SELF-VERIFY `tool:"browser"` step (i.e. NOT `mode:"public"`), or null. Excluding the
 * public-browse mode keeps `verify_deployed_surface` (mode-less) routing to /self-verify byte-unchanged
 * (§58) while a `mode:"public"` step is handled by the separate S3b path below.
 */
export function pickBrowserStep(skill: SkillRow): SkillStep | null {
  if (!Array.isArray(skill.steps)) return null;
  return skill.steps.find(
    (s) => (s?.tool ?? "").toLowerCase() === "browser" && String((s as SkillStep)?.mode ?? "").toLowerCase() !== "public",
  ) ?? null;
}

/**
 * §37 — is "browser" in the skill's allowed_tools? This makes allowed_tools ACTUALLY EXECUTED for the
 * first time: a browser step present in the plan is NOT dispatched unless the grant is present too.
 */
export function browserToolAllowed(skill: SkillRow): boolean {
  return (skill.allowed_tools ?? []).map((t) => String(t ?? "").trim().toLowerCase()).includes("browser");
}

/**
 * §16 risk floor consulted BEFORE navigating. A browse (a side-effecting, cost-bearing dispatch) runs
 * only when the run is cleared to auto-execute — i.e. resolveExecutionMode resolves to "execute". A
 * write-class skill (risk mutating/external_send) can NEVER resolve to execute (the structural floor),
 * so its browse is gated and the run lands as approval/brief per the clamp — the browse never fires
 * ahead of the human. Reuses the SAME floor as the landing clamp; no second risk vocabulary.
 */
export function browseGatePermits(lane: string | null | undefined, riskLevel?: string | null): boolean {
  return resolveExecutionMode(lane, riskLevel) === "execute";
}

/**
 * Fold an HONEST browser observation into a plaintext block for the forge context (§13 — only the
 * fields the browse actually returned; never an invented result). Returns "" when there is nothing
 * real to report. On a failed observation it reports the failure honestly rather than a fake success.
 */
export function foldBrowserObservation(obs: BrowseObservation): string {
  const lines: string[] = ["Browser observation (read-only self-verify):"];
  if (!obs.ok) {
    lines.push(`- status: FAILED${obs.error ? ` — ${String(obs.error).slice(0, 400)}` : ""}`);
  }
  if (obs.final_url) lines.push(`- final_url: ${obs.final_url}`);
  if (obs.http_status !== undefined && obs.http_status !== null) lines.push(`- http_status: ${obs.http_status}`);
  if (obs.title) lines.push(`- title: ${String(obs.title).slice(0, 300)}`);
  if (obs.text_excerpt) lines.push(`- excerpt: ${String(obs.text_excerpt).slice(0, 1200)}`);
  if (Array.isArray(obs.steps)) {
    for (const s of obs.steps) {
      lines.push(`- step[${s?.kind ?? "?"}]: ${s?.ok ? "ok" : "not ok"}${s?.detail ? ` — ${String(s.detail).slice(0, 300)}` : ""}`);
    }
  }
  // Nothing real beyond the header (e.g. an ok:true with no fields) → emit nothing rather than a stub.
  return lines.length > 1 ? lines.join("\n") : "";
}

// ── S3b public-web browse seam (§18 — a SECOND browse contract: /browse-public-url research shape) ──
/** Args for the public-browse dep — the paige-browser /browse-public-url request subset. */
export interface PublicBrowseArgs {
  url: string;
  waitForSelector?: string;
  maxContentBytes?: number;
}

/** The structured research content /browse-public-url returns (blocked_reason non-null when guarded). */
export interface PublicBrowseObservation {
  ok: boolean;
  url?: string;
  final_url?: string;
  http_status?: number | null;
  blocked_reason?: string | null;
  title?: string;
  meta_description?: string | null;
  h1_headers?: string[];
  body_text?: string;
  links_inventory?: Array<{ text?: string; href?: string }>;
  content_bytes?: number | null;
  honest_verdict?: string;
  duration_ms?: number | null;
  error?: string;
}

export type PublicBrowseResult = PublicBrowseObservation | BrowseNeedsConfig;
/** The injected public-browse dep (the actual outbound fetch + 30s cap + retry lives in the HOST). */
export type PublicBrowseFn = (args: PublicBrowseArgs) => Promise<PublicBrowseResult>;

/** The first `tool:"browser"` step with `mode:"public"` (routes to /browse-public-url), or null. */
export function pickPublicBrowseStep(skill: SkillRow): SkillStep | null {
  if (!Array.isArray(skill.steps)) return null;
  return skill.steps.find(
    (s) => (s?.tool ?? "").toLowerCase() === "browser" && String((s as SkillStep)?.mode ?? "").toLowerCase() === "public",
  ) ?? null;
}

/** True for a well-formed http(s) URL — the only scheme the public-browse endpoint accepts. */
export function isHttpUrl(u: string | null | undefined): boolean {
  if (typeof u !== "string" || !u.trim()) return false;
  try {
    const p = new URL(u.trim()).protocol;
    return p === "http:" || p === "https:";
  } catch {
    return false;
  }
}

/**
 * Fold a public-browse observation into a plaintext block for the forge context (§13 — only real
 * returned fields; on a blocked/failed fetch report the honest denial reason, never a fake page).
 */
export function foldPublicBrowse(obs: PublicBrowseObservation): string {
  const lines: string[] = ["Public web observation (read-only browse):"];
  // PC-1 (review fix): EVERY url-shaped value in the fold goes through the audit redactor —
  // query strings carry OAuth codes/state, reset tokens and session ids, and links_inventory
  // hrefs arrive raw from the page. Same shape as the rail: scheme+host+path + count marker.
  const foldUrl = (u: unknown) => (typeof u === "string" && u ? redactUrlForAudit(u) : String(u ?? ""));
  if (!obs.ok) {
    const why = obs.blocked_reason || obs.error || "unknown";
    lines.push(`- status: BLOCKED/FAILED — ${String(why).slice(0, 300)}`);
    if (obs.final_url) lines.push(`- final_url: ${foldUrl(obs.final_url)}`);
    return lines.join("\n"); // an honest denial IS worth folding so the forge can explain it to the user
  }
  if (obs.final_url) lines.push(`- final_url: ${foldUrl(obs.final_url)}`);
  if (obs.http_status !== undefined && obs.http_status !== null) lines.push(`- http_status: ${obs.http_status}`);
  if (obs.title) lines.push(`- title: ${String(obs.title).slice(0, 300)}`);
  if (obs.meta_description) lines.push(`- meta: ${String(obs.meta_description).slice(0, 400)}`);
  if (Array.isArray(obs.h1_headers) && obs.h1_headers.length) {
    lines.push(`- headings: ${obs.h1_headers.slice(0, 12).map((h) => String(h).slice(0, 120)).join(" | ")}`);
  }
  if (obs.body_text) lines.push(`- content: ${String(obs.body_text).slice(0, 4000)}`);
  if (Array.isArray(obs.links_inventory) && obs.links_inventory.length) {
    const links = obs.links_inventory.slice(0, 20).map((l) => `${String(l?.text ?? "").slice(0, 60)} → ${foldUrl(l?.href)}`.trim());
    lines.push(`- links: ${links.join(" ; ")}`);
  }
  return lines.length > 1 ? lines.join("\n") : "";
}

// ── PC-1 redaction — URLs and secret-shaped text never reach the rail or the model fold ──────────
/**
 * Redact a URL for audit persistence (paige_browser_usage) BEFORE it is written. Query strings and
 * fragments can carry tokens/session ids/one-time codes; userinfo can carry basic-auth credentials.
 * The auditable shape is scheme + host + path, with a COUNT marker where a query/fragment existed
 * so analysts still know a parameterized URL was requested. Over-redaction is the safe direction.
 */
export function redactUrlForAudit(raw: string): string {
  try {
    const u = new URL(String(raw));
    const params = [...u.searchParams.keys()];
    const q = params.length ? `?_redacted=${params.length}` : "";
    const frag = u.hash ? "#_redacted" : "";
    const path = u.pathname.length > 300 ? `${u.pathname.slice(0, 300)}…` : u.pathname;
    return `${u.protocol}//${u.host}${path}${q}${frag}`;
  } catch {
    return "_unparseable_url_redacted";
  }
}

// Secret-shaped patterns scrubbed from page-derived text before it is folded into the model context.
// Deliberately broad: a false positive costs a cosmetic "[redacted]" in research text; a false
// negative costs a credential in a transcript. Bounded replacements so a hostile page cannot
// balloon the work; the count is reported so truncation is visible.
const SECRET_KEY_VALUE_RE = /\b(api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|secret|token|password|passwd|pwd|authorization|session[_-]?id|sessionid|csrf|xsrf|otp|verification[_-]?code|one[_-]?time[_-]?code|magic[_-]?link|sig|signature|nonce|credential)s?["']?\s*[:=]\s*["']?[^&\s"'<>]{4,}/gi;
const BEARER_RE = /\b(Bearer|Basic)\s+[A-Za-z0-9\-._~+/]+=*/gi;
const OPAQUE_RUN_RE = /\b[A-Za-z0-9+/_-]{40,}={0,2}\b/g;
const CARDISH_RE = /\b(?:\d[ -]*?){13,19}\b/g;
// JWTs literally start "eyJ" (base64 of '{"') as three dot-separated base64url segments — catches
// tokens UNDER the 40-char opaque threshold (proven leak class: the kv rule eats the "Bearer"
// scheme word and orphans the bare token).
const JWT_SHAPE_RE = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g;

export function scrubSecretLikeText(text: string, maxReplacements = 200): { scrubbed: string; replacements: number; truncated: boolean } {
  let replacements = 0;
  let out = String(text ?? "");
  // Order matters (proven by the failing-first harness run): Bearer/Basic FIRST — otherwise the
  // key=value rule consumes the scheme word ("Authorization: Bearer") and orphans the bare token.
  out = out.replace(BEARER_RE, (_m, scheme: string) => {
    replacements++;
    return `${scheme} [redacted]`;
  });
  if (replacements < maxReplacements) out = out.replace(JWT_SHAPE_RE, () => { replacements++; return "[redacted]"; });
  out = out.replace(SECRET_KEY_VALUE_RE, (_m, keyName: string) => {
    replacements++;
    return `${keyName}=[redacted]`;
  });
  if (replacements < maxReplacements) out = out.replace(OPAQUE_RUN_RE, () => { replacements++; return "[redacted]"; });
  if (replacements < maxReplacements) out = out.replace(CARDISH_RE, () => { replacements++; return "[redacted]"; });
  return { scrubbed: out, replacements, truncated: replacements > maxReplacements };
}

// ── resolveExecutionMode — the §16 autonomy clamp ────────────────────────────────────────────────
/**
 * Map a skill's autonomy_lane (+ a STRUCTURAL risk floor) to how the run resolves. Two guarantees:
 *
 *   1. The default for a missing/unknown lane is the SAFE middle — "approval" — so a mis-seeded skill
 *      never silently auto-executes (§13/§16).
 *   2. A RISK FLOOR that does NOT depend on the lane being seeded correctly: a skill whose risk is
 *      external_send or mutating can NEVER resolve to "execute", regardless of its autonomy_lane. The
 *      lane→mode chain alone was a one-time backfill (external_send→confirm) that a future manual/forge/
 *      MCP INSERT could violate by writing risk="external_send" with lane="auto"; the floor makes the
 *      §16 human-in-the-loop invariant STRUCTURAL, not backfill-dependent. (read_only/draft may honor
 *      auto→execute; the interpreter still has no external-send call site either way.)
 */
export function resolveExecutionMode(lane: string | null | undefined, riskLevel?: string | null): ExecutionMode {
  let mode: ExecutionMode;
  switch ((lane ?? "").trim().toLowerCase()) {
    case "auto":
      mode = "execute";
      break;
    case "off":
      mode = "brief";
      break;
    case "confirm":
      mode = "approval";
      break;
    default:
      mode = "approval"; // unknown/missing lane → safest posture (§16)
      break;
  }
  // Risk floor (§16 structural invariant): high-risk work can never auto-execute — force human review.
  const risk = (riskLevel ?? "").trim().toLowerCase();
  if (mode === "execute" && (risk === "external_send" || risk === "mutating")) {
    return "approval";
  }
  return mode;
}

/**
 * Map a `paige_skills.risk_level` (read_only|draft|mutating|external_send) to the DISJOINT
 * `paige_pending_approvals.risk_level` vocabulary (low|medium|high|blocker|null). Passing the skill's
 * own value would violate `paige_pending_approvals_risk_chk` and throw the approval INSERT.
 */
export function mapApprovalRisk(riskLevel: string | null | undefined): "low" | "medium" | "high" | null {
  switch ((riskLevel ?? "").trim().toLowerCase()) {
    case "external_send":
    case "mutating":
      return "high";
    case "draft":
      return "medium";
    case "read_only":
      return "low";
    default:
      return null;
  }
}

// ── tierAllowsSkill — the §60/§61 per-skill tier gate ────────────────────────────────────────────
/**
 * Server-side belt for the §60/§61 tier lock — whether the caller's tier may SELF-RUN this skill. The
 * PRIMARY gate is the UI (`hasFeature('skills')`, #466) — a Deno edge function cannot import the
 * frontend helper, so this reads the per-skill `tier_availability` jsonb doc instead. It is
 * defense-in-depth (§13), not the sole enforcement.
 *
 * §61 CRITICAL: "resell" is NOT self-run. tier_availability values are yes | yes+resell | resell | no.
 * Only "yes"/"yes+resell" permit the tier to self-execute; "resell" means the tier may RESELL the
 * skill via the Marketplace but NEVER run it itself (the §61 agency posture), and "no" denies outright.
 * A null caller tier (not resolved server-side) or an unspecified tier key is allowed through — the
 * authoritative gate already ran in the UI.
 */
export function tierAllowsSkill(
  tierAvailability: Record<string, unknown> | null | undefined,
  callerTier: CallerTier,
): boolean {
  if (!callerTier) return true;                                   // UI is the primary gate (#466)
  if (!tierAvailability || typeof tierAvailability !== "object") return true; // no per-skill doc → unrestricted here
  const v = tierAvailability[callerTier];
  if (v === undefined || v === null) return true;                 // tier key unspecified → unrestricted here
  const s = String(v).trim().toLowerCase();
  return s.startsWith("yes"); // "yes"/"yes+resell" self-run; "resell" (marketplace-only, §61) + "no" deny
}

// ── needsFormat — Slice 4 (S1d) format-picker ────────────────────────────────────────────────────
export const FORMAT_OPTIONS = ["Word", "Google Doc", "PDF", "Markdown"] as const;
export const FORMAT_PROMPT = "What format would you like this in — Word, Google Doc, PDF, or Markdown?";

/**
 * A document-generating skill asks the user for a format BEFORE generating (§15 — Paige probes for
 * what she can't know; §36 — draft-first, one clear choice). True when the skill is a document skill
 * (category "documents" OR a step renders a doc) AND the caller hasn't already chosen a format.
 */
export function needsFormat(skill: SkillRow, inputs: Record<string, unknown> | null | undefined): boolean {
  const isDoc =
    (skill.category ?? "").trim().toLowerCase() === "documents" ||
    (Array.isArray(skill.steps) && skill.steps.some((s) => (s?.tool ?? "").toLowerCase() === "pdf_render"));
  if (!isDoc) return false;
  const fmt = inputs?.format;
  return !(typeof fmt === "string" && fmt.trim().length > 0);
}

// ── pickModality / pickTier — §17 routing choices ────────────────────────────────────────────────
export function pickModality(_skill: SkillRow): SkillModality {
  return "text"; // skills forge text; a doc-render step is a downstream format concern, not the modality
}

/**
 * §17 — content that will become a customer send (external_send risk) is drafted at the frontier tier;
 * everything else drafts at the cheap/flexible open tier (§14 cost-low). The actual send never happens
 * here (it routes through approval), so is_customer_send stays false at the forge call — but drafting
 * the words a client will read still earns the stronger model.
 */
export function pickTier(skill: SkillRow): SkillTier {
  return (skill.risk_level ?? "").trim().toLowerCase() === "external_send" ? "frontier" : "open-flexible";
}

// ── buildForgeIntent — assemble the brief the forge template fills ───────────────────────────────
function firstString(...vals: unknown[]): string {
  for (const v of vals) {
    if (typeof v === "string" && v.trim().length > 0) return v.trim();
  }
  return "";
}

/**
 * Turn the skill row + caller inputs (+ optional gathered context) into the userIntent brief that
 * prompt-forge fills into the tenant's DNA template. The methodology_anchor LEADS so every skill is
 * grounded in a real framework (§35 — "no vibes-based skills"), then the descriptive steps become the
 * plan, then the caller's brief and chosen format. Always non-empty (forge requires a userIntent).
 */
export function buildForgeIntent(
  skill: SkillRow,
  inputs: Record<string, unknown> | null | undefined,
  contextText?: string,
): string {
  const parts: string[] = [`Task: ${skill.name}.`];
  if (skill.methodology_anchor && skill.methodology_anchor.trim()) {
    parts.push(`Ground your work in this methodology: ${skill.methodology_anchor.trim()}.`);
  }
  const plan = Array.isArray(skill.steps)
    ? skill.steps.filter((s) => s?.desc && s.desc.trim()).map((s, i) => `${i + 1}. ${s.desc!.trim()}`).join(" ")
    : "";
  if (plan) parts.push(`Follow this plan: ${plan}`);
  const brief = firstString(inputs?.prompt, inputs?.topic, inputs?.brief, inputs?.request, inputs?.instructions);
  if (brief) parts.push(`Brief: ${brief}`);
  const fmt = typeof inputs?.format === "string" ? inputs.format.trim() : "";
  if (fmt) parts.push(`Deliver the output in ${fmt} format.`);
  if (contextText && contextText.trim()) parts.push(`Relevant context:\n${contextText.trim()}`);
  return parts.join("\n");
}

// ── The set of shipped slugs that keep their bespoke handlers (§58) ──────────────────────────────
/**
 * The 4 skills shipped with bespoke switch(slug) handlers. The interpreter NEVER replaces these unless
 * a caller passes force_interpreter (Slice 3's bespoke-vs-interpreter diff proof). Everything else —
 * every slug Paige forges from here on — flows through the interpreter automatically.
 */
export const BESPOKE_SKILL_SLUGS: ReadonlySet<string> = new Set([
  "verify_business_sos",
  "research_to_concept_brief",
  "build_game_plan",
  "draft_and_email_document",
]);

/** Should this run go through the interpreter? True for any non-bespoke slug, or when explicitly forced. */
export function shouldUseInterpreter(slug: string, forceInterpreter?: boolean): boolean {
  return forceInterpreter === true || !BESPOKE_SKILL_SLUGS.has(slug);
}
