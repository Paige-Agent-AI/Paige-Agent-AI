import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const UI_EXTENSIONS = /\.(?:tsx|jsx|css|scss|sass|less|html)$/i;
const UI_TYPESCRIPT_PATH = /^(?:src\/(?:components|pages|routes|solo)\/|src\/operator\/(?:ia|shell|surfaces)\/|src\/lib\/routing\/).+\.ts$/i;
const UI_ASSET_EXTENSIONS = /\.(?:svg|png|jpe?g|webp|gif|avif|ico|woff2?|ttf|otf|mp4|webm|glb|gltf|splinecode)$/i;
const PUBLIC_UI_EXTENSIONS = /\.(?:html|css|js|mjs|svg|png|jpe?g|webp|gif|avif|ico|woff2?|ttf|otf|mp4|webm|glb|gltf|splinecode)$/i;
const UI_CONFIG_FILES = new Set([
  "postcss.config.js",
  "tailwind.config.ts",
]);
const ROOT_UI_FILES = new Set([
  "analytics-drive.html",
  "auth.html",
  "index.html",
  "privacy.html",
  "sms-terms.html",
  "solo-drive.html",
]);
const TEST_ONLY = /(?:^|\/)(?:__tests__|test|tests|fixtures|snapshots)(?:\/|$)|\.(?:test|spec|stories)\.[^.]+$/i;
const EVIDENCE_PATH = /^docs\/evidence\/ui-delivery\/(?!TEMPLATE\.md$).+\.md$/i;
let integrationRegistryNames;

const CORE_FIELDS = [
  "FLOW_BY_FLOW",
  "PAIGE_UI_DESIGN",
  "MATERIAL_FLOW_CHANGE",
  "FLOW_PROTOTYPE",
  "PURPOSE_AUDIENCE_PRIMARY_ACTION",
  "VISUAL_DIRECTION",
  "AUTOMATED_EVIDENCE",
  "STATIC_EVIDENCE",
  "RENDERED_EVIDENCE",
  "BEHAVIORAL_EVIDENCE",
  "AUTHENTICATED_RUNTIME",
  "KEYBOARD_FOCUS",
  "ZOOM_REFLOW",
  "REDUCED_MOTION",
  "STATE_COVERAGE",
  "TRUTHFUL_STATE_LABELS",
  "SOLO_UI",
  "UNVERIFIED",
];

const RELEASE_FIELDS = [
  "INTERNAL_BUILD_IDENTITY",
  "RELEASE_CHANNEL",
  "RELEASE_CLASSIFICATION",
  "CUSTOMER_RELEASE_IDENTITY",
  "RELEASE_NOTE_REQUIRED",
  "RELEASE_TRUTH_BOUNDARY",
  "RELEASE_RECOVERY",
];

const SOLO_FIELDS = [
  "SOLO_1536X770_PAIGE_CLOSED",
  "SOLO_1536X770_PAIGE_OPEN",
  "SOLO_1366X768_PAIGE_CLOSED",
  "SOLO_1366X768_PAIGE_OPEN",
  "SOLO_1024X768_PAIGE_CLOSED",
  "SOLO_1024X768_PAIGE_OPEN",
  "SOLO_900X1000_PAIGE_CLOSED",
  "SOLO_900X1000_PAIGE_OPEN",
];
// The five-skill Experience-Quality modules' fields. RECOGNIZED but NOT required:
// validated for substance only when present, so a record that omits them still passes
// and no in-flight UI PR breaks. Phase 3 of the Harness upgrade adds the recognition;
// a dated, announced cutover (never silent) is what would later make any of them required.
const OPTIONAL_FIELDS = [
  "OWNER_INTENT",
  "MUST_NOT_HAPPEN",
  "MUST_PRESERVE",
  "ACCEPTANCE_CRITERIA",
  "MOTION_PURPOSE",
  "PROTECTED_SEAMS",
];
// Backend/contract surfaces (edge functions, migrations/RPC/RLS/entitlement, provider
// webhooks). A change here is in scope for this standard ONLY when the author DECLARES a
// visible-flow impact (a `Visible-Flow-Impact: yes` commit trailer); an undeclared backend
// change is unaffected — declaration is the trigger, review catches an omitted one.
const BACKEND_CONTRACT_PATH = /^supabase\/(?:functions|migrations)\//i;
const PINNED_BUNDLE = new Map([
  [".agents/skills/paige-ui-design/vendor/frontend-design/SKILL.md", "e7c8e7fd0bde8eb8a7d9f024fe20eeab4b6cde3f612e8d253334b806c09ca1ff"],
  [".agents/skills/paige-ui-design/vendor/frontend-design/references/accessibility-checklist.md", "de10179e21fa2cf7c098a01dbef5a5e9eed0b262a0526fd9c1b20ad0058e988c"],
  [".agents/skills/paige-ui-design/vendor/frontend-design/scripts/contrast-checker.py", "fa5dfa8258ee2de0cd86b42cbd88d6d2f51f1ee9f700085095e2ace4f9c6fcf6"],
  [".agents/skills/paige-ui-design/vendor/frontend-design/LICENSE.txt", "5b30a24f635a0e31fff6d399e127b67b7a38e1bcaa439bdae8e4f619b25b06af"],
  [".agents/skills/paige-ui-design/vendor/frontend-design/LICENSE-APACHE-2.0.txt", "b87a529a13d5294f97bb847936a82f39e4f8adae2425a3a5fb5f1a7b75d43e6a"],
  [".agents/skills/paige-ui-design/vendor/frontend-design/LICENSE-GITHUB-MIT.txt", "2510b446bc1f0cf9702453075d20cd88631e20e5642658edb7325d9c1eb534f7"],
  [".agents/skills/paige-ui-design/vendor/frontend-design/THIRD_PARTY_NOTICES.md", "912317539cc833b96d789481668a7227a840c6f44e35bcdb3fcaeb1591e76571"],
]);
export const pinnedBundlePaths = Object.freeze([...PINNED_BUNDLE.keys()]);

export function verifyPinnedBundle(root = process.cwd()) {
  const errors = [];
  for (const [file, expected] of PINNED_BUNDLE) {
    const content = readFileSync(resolve(root, file), "utf8").replace(/\r\n/g, "\n");
    const actual = createHash("sha256").update(content).digest("hex");
    if (actual !== expected) errors.push(`${file}: expected ${expected}, received ${actual}`);
  }
  return { ok: errors.length === 0, errors };
}

function normalize(path) {
  return path.replaceAll("\\", "/").replace(/^\.\//, "");
}

function isTestOnly(path) {
  return TEST_ONLY.test(path);
}

function isUiFile(path) {
  if (isTestOnly(path)) return false;
  if (ROOT_UI_FILES.has(path)) return true;
  if (UI_CONFIG_FILES.has(path)) return true;
  if (/^src\//.test(path) && UI_EXTENSIONS.test(path)) return true;
  if (UI_TYPESCRIPT_PATH.test(path)) return true;
  if (/^src\/assets\//.test(path) && UI_ASSET_EXTENSIONS.test(path)) return true;
  if (/^public\//.test(path) && PUBLIC_UI_EXTENSIONS.test(path)) return true;
  return false;
}

function isSoloUi(path) {
  return path === "solo-drive.html"
    || /(?:^|[/_.-])solo(?:[/_.-]|$)/i.test(path)
    || /^(?:src\/solo\/|src\/components\/(?:tenant-shell|tenant-relationships|tenant-calendar|growth)\/)/i.test(path)
    || /TenantCommandCenterShell/i.test(path);
}

function isBackendContractFile(path) {
  if (isTestOnly(path)) return false;
  if (isUiFile(path)) return false;
  return BACKEND_CONTRACT_PATH.test(path);
}

function changeRecord(entry) {
  if (typeof entry === "string") return { status: "M", path: normalize(entry) };
  return {
    status: String(entry.status ?? "M").slice(0, 1).toUpperCase(),
    path: normalize(entry.path ?? ""),
  };
}

export function classifyUiChanges(files, { declaredVisibleFlow = false } = {}) {
  const changes = files.map(changeRecord).filter((entry) => entry.path);
  const uiFiles = changes.filter((entry) => isUiFile(entry.path)).map((entry) => entry.path);
  const backendContractFiles = changes.filter((entry) => isBackendContractFile(entry.path)).map((entry) => entry.path);
  // A backend/contract change routes to an evidence record only when a visible-flow impact
  // was declared (the commit trailer). Without the declaration, backend changes are unaffected.
  const backendVisibleFlow = Boolean(declaredVisibleFlow) && backendContractFiles.length > 0;
  return {
    required: uiFiles.length > 0 || backendVisibleFlow,
    solo: uiFiles.some(isSoloUi),
    uiFiles,
    backendContractFiles,
    backendVisibleFlow,
    evidenceFiles: changes.filter((entry) => entry.status === "A" && EVIDENCE_PATH.test(entry.path)).map((entry) => entry.path),
  };
}

function fieldsFrom(text) {
  const fields = new Map();
  for (const line of text.split(/\r?\n/)) {
    const match = /^([A-Z][A-Z0-9_]+):\s*(.+?)\s*$/.exec(line);
    if (match) fields.set(match[1], match[2]);
  }
  return fields;
}

function isEvidenceValue(value) {
  const match = /^(PASS|UNVERIFIED|NOT_APPLICABLE):\s*(\S.+)$/i.exec(value ?? "");
  if (!match) return false;
  return match[1].toUpperCase() === "PASS"
    ? !isUnresolvedEvidence(match[2])
    : !isUnresolvedRestatement(match[2]);
}

export function isRegistryNamedTarget(value, providerNames) {
  try {
    integrationRegistryNames ??= JSON.parse(readFileSync(resolve(process.cwd(), "docs/integration-registry/integration-capability-registry.json"), "utf8"))
      .providers.map((provider) => String(provider.name ?? "").trim().toLowerCase());
  } catch {
    return false;
  }
  const target = String(value ?? "").trim().toLowerCase();
  const names = providerNames?.map((name) => String(name).trim().toLowerCase()) ?? integrationRegistryNames;
  return Boolean(target) && names.some((name) => name === target || name.split(/[^a-z0-9]+/).includes(target));
}

function normalizeSentinel(value) {
  return String(value ?? "").trim().replace(/[^A-Za-z0-9]+/g, " ").replace(/\s+/g, " ").toLowerCase();
}

function hasPlaceholder(value) {
  return /\b(?:todo|tbd|placeholder|replace me|add link|link here)\b/.test(normalizeSentinel(value));
}

function isUnresolvedValue(value) {
  const normalized = normalizeSentinel(value);
  return hasPlaceholder(value) || new Set(["pending", "unknown", "none", "na", "n a", "not applicable", "proof owed"]).has(normalized);
}

function hasUnresolvedToken(value) {
  const normalized = normalizeSentinel(value);
  return hasPlaceholder(value) || /\b(?:pending|unknown|proof owed|none|n a|not applicable)\b/.test(normalized) || normalized === "na";
}

function isUnresolvedEvidence(value) {
  const raw = String(value ?? "").trim();
  const prose = raw
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/(?:^|[\s;])(?:[A-Za-z]:)?[^\s;:]*[\\/]\S+\.[A-Za-z0-9]{1,10}(?:[?#]\S*)?/g, " ")
    .trim();
  if (!prose) return false;
  if (isUnresolvedValue(prose)) return true;
  const normalized = normalizeSentinel(prose);
  const subject = "(?:proof|result|evidence|verification|check|runtime|decision|approval)";
  const unresolved = "(?:pending|unknown|proof owed)";
  return new RegExp(`(?:\\b${subject}\\b.*\\b${unresolved}\\b|\\b${unresolved}\\b.*\\b${subject}\\b)`).test(normalized);
}

function isUnresolvedRestatement(value) {
  if (isUnresolvedValue(value)) return true;
  const raw = String(value ?? "").trim();
  const normalized = normalizeSentinel(raw);
  const subject = "(?:proof|result|evidence|verification|check|runtime|decision|approval)";
  const unresolved = "(?:pending|unknown|proof owed)";
  const pair = new RegExp(`(?:\\b${subject}\\b.*\\b${unresolved}\\b|\\b${unresolved}\\b.*\\b${subject}\\b)`);
  if (!pair.test(normalized)) return false;
  const hasReference = /https?:\/\/\S+/i.test(raw) || /(?:^|[\s;(])(?:[A-Za-z]:)?[^\s;:()]*[\\/]\S+\.[A-Za-z0-9]{1,10}(?:[?#]\S*)?/i.test(raw);
  const substantiveTerms = (clause) => normalizeSentinel(clause)
    .replace(/\b(?:proof|result|evidence|verification|validation|check|runtime|decision|approval|pending|unknown|owed)\b/g, " ")
    .replace(/\b(?:for|the|a|an|of|to|in|on|and|or|is|are|was|were|be|been|being|still|current|currently|remain|remains|remaining|entire|entirely|just|simply|merely|yet|very|much|really|now|ongoing|unresolved|later|tomorrow|someday|eventually|status|state|unchanged|same)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  const causeCondition = /\b(?:unavailable|missing|absent|blocked|denied|failed|failure|outage|disabled|disconnected|unconfigured|expired|revoked|invalid|unreachable|inaccessible|offline|degraded|errored|error|forbidden|unauthorized|prevented|timeout|timed out|rate limit(?:ed)?|requires|required|awaiting|without|lacks|no)\b|\bnot\s+(?:available|connected|configured|deployed|authorized|authenticated|accessible)\b/i;
  const affectedScope = /\b(?:tenants?|accounts?|credentials?|keys?|tokens?|secrets?|certificates?|sessions?|api|oauth|environments?|providers?|permissions?|deployments?|migrations?|edge|integrations?|connections?|workspaces?|owners?|ci|security|production|preview|local|claims?|scope)\b/i;
  const inabilityCondition = /\b(?:cannot|unable|could not|can not)\b/i;
  const connectorClause = /\b(?:because|due to|blocked by|awaiting|for|until|while)\b\s+(.+)$/i.exec(normalized)?.[1] ?? "";
  const hasConnectorReason = substantiveTerms(connectorClause).length >= 2 && (causeCondition.test(connectorClause) || affectedScope.test(connectorClause));
  const hasIndependentCause = raw.split(/[:;,.!?—–]+/).some((clause) => {
    const normalizedClause = normalizeSentinel(clause);
    const inabilityTarget = /\b(?:cannot|could not|can not|unable to)\s+(?:verify|test|access|reach|authenticate(?: to)?|connect(?: to)?)\s+(.+)$/i.exec(clause)?.[1]?.trim() ?? "";
    const targetTerms = substantiveTerms(inabilityTarget);
    const isLyTarget = /\b[A-Za-z]+ly\b/i.test(inabilityTarget);
    const isGroundedLyTarget = /\b(?:Grammarly|Calendly|Fly)\b/.test(inabilityTarget) || isRegistryNamedTarget(inabilityTarget);
    const hasNamedTarget = /\b[A-Z][A-Za-z0-9._-]*\b/.test(inabilityTarget) && targetTerms.length >= 1 && !/\b(?:it|this|that|them|there|here|something|anything|nothing|someone|anyone)\b/i.test(inabilityTarget) && (!isLyTarget || isGroundedLyTarget);
    const hasConcreteTarget = affectedScope.test(inabilityTarget) || hasNamedTarget;
    const hasScopedInability = inabilityCondition.test(normalizedClause) && hasConcreteTarget;
    return normalizedClause && !pair.test(normalizedClause) && (causeCondition.test(normalizedClause) || hasScopedInability) && substantiveTerms(normalizedClause).length >= 2;
  });
  return !(hasReference || hasConnectorReason || hasIndependentCause);
}

function lacksDeploymentIdentity(value) {
  const raw = String(value ?? "").trim();
  const normalized = normalizeSentinel(raw);
  return !normalized
    || hasUnresolvedToken(raw)
    || /^(?:https?:\/\/|refs\/heads\/)/i.test(raw)
    || new Set(["latest", "main", "production", "prod", "current", "head"]).has(normalized);
}

function isPassWithEvidence(value) {
  return /^PASS:\s*\S.+$/i.test(value ?? "") && !isUnresolvedEvidence(String(value ?? "").replace(/^PASS:\s*/i, ""));
}

/**
 * Owner-waiver grammar (governance PR): the ONLY honest alternative to a
 * PASS leg for the gates the owner can waive. A waiver must name the owner
 * decision that granted it and carry a substantive reason — never a
 * placeholder, never "pending"/"unknown"/"none", never bare prose.
 *   WAIVED: owner-decision=<substantive reference>; reason=<substantive reason>
 */
// A recognizable decision reference: a PR/issue/discussion number (with or
// without the hash, labeled or bare), a URL, or a dated ruling — something
// a reviewer can go read, not a bare word.
const OWNER_DECISION_REFERENCE = /(?:(?:PR|issue|discussion)\s*#?\s*[0-9]+|#[0-9]+|https?:\/\/\S+|20\d{2}-\d{2}-\d{2})/i;
// A substantive reason is prose, not an interjection: at least four DISTINCT
// words — "ok ok ok ok" is filler, not prose.
const MIN_REASON_WORDS = 4;
// FLOW_BY_FLOW eligibility (Codex rounds a5163ade → 84e06888): the doctrine
// permits this waiver ONLY when the skill is genuinely unavailable in the
// delivery environment. English negation is adversarial, so the check is
// deliberately FAIL-CLOSED and SUBJECT-SCOPED rather than a natural-language
// parse: the unavailability must be asserted OF THE SKILL within one clause,
// and no clause may affirm the skill's availability.
const NEGATED_AVAILABILITY = /\b(?:not|never|isn[’']?t|no longer)\s+(?:installed|present|available)\b/i;
const ANY_NEGATION = /\b(?:not|never|no|neither|nor|isn[’']?t|isnt|aren[’']?t|wasn[’']?t|weren[’']?t|doesn[’']?t|doesnt|don[’']?t|dont|cannot|cant|can[’']?t|couldnt|couldn[’']?t|won[’']?t|wont|wouldnt|wouldn[’']?t|hardly|barely|scarcely|anything but)\b/i;
const AFFIRMATIVE_UNAVAILABILITY = /\b(?:unavailable|absent)\b/i;
// The unavailability predicate must be BOUND to Flow-by-Flow inside the
// clause: the predicate follows the mention directly, optionally through
// "skill" and a copula. A bare "skill" clause is not identifying ("the
// screenshot skill is unavailable", Codex 1b48c7fb P2), and neither is a
// mere MENTION of Flow-by-Flow whose predicate describes another subject
// ("Flow-by-Flow documents that the screenshot skill is unavailable",
// Codex 5fdbf940 P2) — only a direct assertion of Flow-by-Flow's own
// unavailability qualifies.
const BOUND_UNAVAILABILITY = /\bflow[- ]by[- ]flow(?:\s+skill)?(?:\s+(?:is|was|are|were|remains?)\s+)?(?:unavailable|absent)\b|\bflow[- ]by[- ]flow(?:\s+skill)?(?:\s+(?:is|was|are|were|remains?)\s+)?(?:not\s+|never\s+|no\s+longer\s+)(?:installed|present|available)\b/i;
// Availability affirmations are PREDICATES about a subject — "is installed",
// "remains available", "was present" — not every occurrence of every word
// (Codex 1ed64059 P2): "unavailable at present" (temporal) and "absent from
// the present delivery environment" (adjectival) assert unavailability, not
// availability. "installed"/"available" keep the bare-token veto because
// their bare occurrence in a waiver reason is an availability claim;
// "present" needs a predicative test because of its other senses.
const BARE_AVAILABILITY_CLAIM = /\b(?:installed|available)\b/i;
// A "present" occurrence is NON-predicative only in the temporal/adjectival
// forms ("at present", "the present environment", "present-day tooling").
// The hyphen exemption is the documented "present-day" adjectival compound
// ONLY — a predicative assertion can't hyphenate its way out ("is
// present-here today", Codex e771e911 P2). Every other occurrence is an
// affirmation, whatever ordinary adverbs or verb phrases sit between the
// verb and the word ("is currently present", "continues to be present").
const NON_PREDICATIVE_PRESENT = /\b(?:at|the|this|that|these|those|a|an|our|their|its|his|her)\s+present\b|\bpresent[-–—]day\b/gi;
function affirmsPresent(clause) {
  const occurrences = clause.match(/\bpresent\b/gi) ?? [];
  const exempt = clause.match(NON_PREDICATIVE_PRESENT) ?? [];
  return occurrences.length > exempt.length;
}
function establishesUnavailability(reason) {
  // Canonical form 1 — a negator immediately before an AVAILABILITY word:
  // "not installed", "not present", "not available", "never installed",
  // "no longer available". Strip every occurrence, then sweep the REMAINDER:
  // a contradictory negation riding alongside a canonical phrase ("not
  // installed, but it is not currently unavailable") must still reject.
  const canonical = new RegExp(NEGATED_AVAILABILITY.source, "gi");
  const canonicalMatches = reason.match(canonical) ?? [];
  const remainder = canonicalMatches.length ? reason.replace(canonical, " ") : reason;
  if (ANY_NEGATION.test(remainder)) return false;
  // Canonical form 2 — an affirmative unavailability word in otherwise
  // negation-free prose: "the skill is unavailable…", "absent from…".
  return canonicalMatches.length > 0 || AFFIRMATIVE_UNAVAILABILITY.test(reason);
}
// Binding-scoped eligibility, ANDed with the whole-reason fail-closed check:
// at least one clause must assert FLOW-BY-FLOW'S OWN unavailability (the
// predicate bound to the mention), and NO clause may affirm availability
// after canonical stripping — whether it names the gate, another subject, or
// only a pronoun referring back to it ("unavailable here; it is installed
// and available", Codex b8d6ba27 P2). The reason must stay an unavailability
// statement: editorializing that anything is available rejects the waiver.
function establishesSkillUnavailability(reason) {
  if (!establishesUnavailability(reason)) return false;
  const clauses = reason.split(/[,;]|\bbut\b/i);
  let qualifying = false;
  for (const clause of clauses) {
    if (BOUND_UNAVAILABILITY.test(clause)) qualifying = true;
    const canonical = new RegExp(NEGATED_AVAILABILITY.source, "gi");
    const stripped = clause.replace(canonical, " ");
    if (BARE_AVAILABILITY_CLAIM.test(stripped) || affirmsPresent(stripped)) return false;
  }
  return qualifying;
}

function isWaivedWithOwnerDecision(value, eligibility) {
  const match = /^WAIVED:\s*owner-decision=([^;]+);\s*reason=(\S.+)$/i.exec(String(value ?? "").trim());
  if (!match) return false;
  const [, ownerDecision, reason] = match;
  // Token-level unresolved checks (hasUnresolvedToken): the whole-string
  // isUnresolvedValue compares only the exact normalized value, so an
  // embedded marker ("approval pending from owner") would slip through.
  if (hasUnresolvedToken(ownerDecision) || hasUnresolvedToken(reason)) return false;
  // Substance (Codex c52d3725 P2): the reference must be recognizable and
  // the reason must be meaningful prose — "owner-decision=no; reason=ok" is
  // a bypass, not a recorded owner ruling.
  if (!OWNER_DECISION_REFERENCE.test(ownerDecision)) return false;
  const words = reason.trim().split(/\s+/).filter((word) => word.length > 0);
  const distinct = new Set(words.map((word) => word.toLowerCase().replace(/[^a-z0-9]/g, "")));
  if (distinct.size < MIN_REASON_WORDS) return false;
  // Gate-specific eligibility, when the doctrine ties the waiver to a
  // condition the reason itself must establish.
  if (eligibility && !eligibility(reason)) return false;
  return true;
}

export function validateEvidenceText(text, classification) {
  if (!classification.required) return { ok: true, errors: [] };
  if (!text.trim()) {
    return { ok: false, errors: ["A changed docs/evidence/ui-delivery/*.md UI delivery evidence file is required."] };
  }

  const fields = fieldsFrom(text);
  const errors = [];
  if (fields.get("UI_DELIVERY_EVIDENCE_VERSION") !== "1") {
    errors.push("UI_DELIVERY_EVIDENCE_VERSION must be 1.");
  }
  for (const key of [...CORE_FIELDS, ...RELEASE_FIELDS]) {
    if (!fields.has(key)) errors.push(`${key} is required.`);
  }
  for (const key of RELEASE_FIELDS) {
    const value = fields.get(key);
    if (!value?.trim() || hasPlaceholder(value)) errors.push(`${key} must include a non-placeholder release-governance value.`);
  }
  const buildIdentity = fields.get("INTERNAL_BUILD_IDENTITY") ?? "";
  if (!/\b[0-9a-f]{40}\b/i.test(buildIdentity) || !/\bdeployment\s*=\s*\S+/i.test(buildIdentity) || !/\benvironment\s*=\s*(?:local|development|preview|production)\b/i.test(buildIdentity) || !/\bmigrations\s*=\s*\S+/i.test(buildIdentity) || !/\bedge\s*=\s*\S+/i.test(buildIdentity) || !/\bevidence\s*=\s*\S+/i.test(buildIdentity)) {
    errors.push("INTERNAL_BUILD_IDENTITY must include an exact SHA plus deployment, environment, migrations, edge, and evidence values.");
  }
  const releaseChannel = /^(development|preview|production|staged):\s*\S.+$/i.exec(fields.get("RELEASE_CHANNEL") ?? "")?.[1]?.toLowerCase();
  if (!releaseChannel) errors.push("RELEASE_CHANNEL must name a governed channel and evidence/reason.");
  const buildEnvironment = /\benvironment\s*=\s*(local|development|preview|production)\b/i.exec(buildIdentity)?.[1]?.toLowerCase();
  const deploymentId = /\bdeployment\s*=\s*([^;]+)/i.exec(buildIdentity)?.[1]?.trim();
  const deliveryValue = (field) => new RegExp(`\\b${field}\\s*=\\s*([^;]+)`, "i").exec(buildIdentity)?.[1]?.trim();
  const buildEvidence = deliveryValue("evidence") ?? "";
  if (isUnresolvedEvidence(buildEvidence)) errors.push("INTERNAL_BUILD_IDENTITY evidence must be a substantive link or reproducible reference.");
  for (const field of ["migrations", "edge"]) {
    const value = deliveryValue(field) ?? "";
    const applied = /^APPLIED\(([^)]+)\)$/i.exec(value);
    const proofOwed = /^PROOF_OWED\(([^)]+)\)$/i.exec(value);
    const failed = /^FAILED\(([^)]+)\)$/i.exec(value);
    const allowedState = /^NOT_APPLICABLE$/i.test(value) || Boolean(proofOwed || failed);
    const identifiers = applied?.[1]?.split(",").map((item) => item.trim()).filter(Boolean) ?? [];
    const exactPattern = field === "migrations" ? /^\d{14}_[A-Za-z0-9_-]+$/ : /^[A-Za-z0-9._-]+@v?[A-Za-z0-9._-]+$/;
    const detail = proofOwed?.[1]?.trim() ?? failed?.[1]?.trim();
    if ((!allowedState && !applied) || (detail !== undefined && isUnresolvedValue(detail)) || (applied && (identifiers.length === 0 || identifiers.some((identifier) => !exactPattern.test(identifier) || hasUnresolvedToken(identifier))))) errors.push(`${field} must be NOT_APPLICABLE or a complete APPLIED(exact identifier), PROOF_OWED(boundary), or FAILED(reason) state.`);
  }
  if (releaseChannel === "development" && !["local", "development"].includes(buildEnvironment)) errors.push("Development RELEASE_CHANNEL requires local/development build environment.");
  if (releaseChannel === "preview" && buildEnvironment !== "preview") errors.push("Preview RELEASE_CHANNEL requires preview build environment.");
  if (["production", "staged"].includes(releaseChannel) && (buildEnvironment !== "production" || lacksDeploymentIdentity(deploymentId))) errors.push("Production/staged RELEASE_CHANNEL requires a production build environment and exact deployment ID.");
  const releaseClassification = /^(internal-only|patch|minor-candidate|major-candidate):\s*\S.+$/i.exec(fields.get("RELEASE_CLASSIFICATION") ?? "")?.[1]?.toLowerCase();
  if (!releaseClassification) errors.push("RELEASE_CLASSIFICATION must name a governed classification and reason.");
  const customerIdentity = fields.get("CUSTOMER_RELEASE_IDENTITY") ?? "";
  const noCustomerIdentity = /^none:\s*\S.+$/i.test(customerIdentity);
  const namedCustomerIdentity = /^(\d+\.\d+\.\d+)\s+—\s+([^;]+);\s*owner-decision=(\S+)$/i.exec(customerIdentity);
  if (namedCustomerIdentity && !namedCustomerIdentity[2].trim()) errors.push("CUSTOMER_RELEASE_IDENTITY must include a non-whitespace release name.");
  if (namedCustomerIdentity && normalizeSentinel(namedCustomerIdentity[3]) !== "pending" && hasUnresolvedToken(namedCustomerIdentity[3])) errors.push("CUSTOMER_RELEASE_IDENTITY owner-decision must be PENDING or a substantive decision reference.");
  if (releaseClassification === "internal-only" && !noCustomerIdentity) errors.push("CUSTOMER_RELEASE_IDENTITY must be none: reason for internal-only work.");
  if (releaseClassification === "patch" && !noCustomerIdentity && !/^0\.\d+\.[1-9]\d*$/.test(namedCustomerIdentity?.[1] ?? "")) errors.push("Patch CUSTOMER_RELEASE_IDENTITY must be none: reason or 0.x.y with y greater than zero, a name, and owner-decision reference.");
  if (releaseClassification === "minor-candidate" && !/^0\.[1-9]\d*\.0$/.test(namedCustomerIdentity?.[1] ?? "")) errors.push("Minor-candidate CUSTOMER_RELEASE_IDENTITY must be 0.x.0 with a name and owner-decision reference.");
  if (releaseClassification === "major-candidate" && !/^[1-9]\d*\.0\.0$/.test(namedCustomerIdentity?.[1] ?? "")) errors.push("Major-candidate CUSTOMER_RELEASE_IDENTITY must be x.0.0 with a name and owner-decision reference.");
  if (!releaseClassification && !noCustomerIdentity && !namedCustomerIdentity) errors.push("CUSTOMER_RELEASE_IDENTITY must be none: reason or a structured version, name, and owner-decision reference.");
  const releaseNoteRequired = /^(YES|NO):\s*\S.+$/i.exec(fields.get("RELEASE_NOTE_REQUIRED") ?? "")?.[1]?.toUpperCase();
  if (!releaseNoteRequired) errors.push("RELEASE_NOTE_REQUIRED must be YES: reason or NO: reason.");
  if (["minor-candidate", "major-candidate"].includes(releaseClassification) && releaseNoteRequired !== "YES") errors.push("Minor/major customer candidates require RELEASE_NOTE_REQUIRED: YES with a reason.");
  if (releaseClassification === "internal-only" && releaseNoteRequired !== "NO") errors.push("Internal-only work requires RELEASE_NOTE_REQUIRED: NO with a reason.");
  if (releaseChannel === "staged") {
    const channelEvidence = fields.get("RELEASE_CHANNEL") ?? "";
    for (const key of ["owner-approval", "eligibility", "amount", "start", "stop", "monitoring-owner", "recovery"]) {
      const value = new RegExp(`\\b${key}=([^;]+)`, "i").exec(channelEvidence)?.[1]?.trim();
      if (!value || hasUnresolvedToken(value)) errors.push(`Staged RELEASE_CHANNEL requires a completed non-placeholder ${key}=... value.`);
    }
  }
  const releaseRecovery = fields.get("RELEASE_RECOVERY") ?? "";
  const recoveryParts = /^position=([^;]+);\s*reference=(\S.+)$/i.exec(releaseRecovery);
  if (!recoveryParts || recoveryParts.slice(1).some((value) => !value.trim() || isUnresolvedValue(value))) errors.push("RELEASE_RECOVERY must include substantive position=...; reference=... values.");
  const truthBoundary = /^(?:LIVE|PARTIAL|UNAVAILABLE|PROOF OWED):\s*(\S.+)$/i.exec(fields.get("RELEASE_TRUTH_BOUNDARY") ?? "");
  if (!truthBoundary || isUnresolvedValue(truthBoundary[1])) errors.push("RELEASE_TRUTH_BOUNDARY must name at least one governed status and its claim boundary.");
  // FLOW_BY_FLOW: PASS with evidence, or an explicit owner waiver on record
  // (the honest path when the skill is unavailable and the owner accepts the
  // grounded flow trace in its place). No other value passes — and the
  // waiver's reason must establish the skill's genuine unavailability.
  if (!isPassWithEvidence(fields.get("FLOW_BY_FLOW")) && !isWaivedWithOwnerDecision(fields.get("FLOW_BY_FLOW"), establishesSkillUnavailability)) {
    errors.push("FLOW_BY_FLOW must be PASS: with a non-placeholder evidence reference, or WAIVED: owner-decision=<reference>; reason=<reason establishing the skill's genuine unavailability>.");
  }
  if (!isPassWithEvidence(fields.get("PAIGE_UI_DESIGN"))) errors.push("PAIGE_UI_DESIGN must be PASS: with a non-placeholder evidence reference.");

  const materialFlow = fields.get("MATERIAL_FLOW_CHANGE");
  if (!/^(?:YES|NO):\s*\S.+$/i.test(materialFlow ?? "") || hasPlaceholder(materialFlow)) {
    errors.push("MATERIAL_FLOW_CHANGE must be YES: reason or NO: reason.");
  }
  const flowPrototype = fields.get("FLOW_PROTOTYPE");
  // Record prototype truth; an unrun browser/prototype is not a premerge gate.
  // Retain legacy substantive owner waivers without requiring a new waiver.
  const prototypeRecorded = isPassWithEvidence(flowPrototype)
    || (/^UNVERIFIED:/i.test(flowPrototype ?? "") && isEvidenceValue(flowPrototype));
  const prototypeNotRequired = /^NO:/i.test(materialFlow ?? "")
    && /^NOT_REQUIRED:\s*\S.+$/i.test(flowPrototype ?? "") && !hasPlaceholder(flowPrototype);
  const historicalPrototypeWaiver = /^YES:/i.test(materialFlow ?? "")
    && isWaivedWithOwnerDecision(flowPrototype);
  if (!prototypeRecorded && !prototypeNotRequired && !historicalPrototypeWaiver) {
    errors.push("FLOW_PROTOTYPE must record PASS: evidence or UNVERIFIED: reason; non-material flows may use NOT_REQUIRED: reason, and historical substantive owner waivers remain valid.");
  }

  for (const key of CORE_FIELDS.filter((key) => ![
    "FLOW_BY_FLOW",
    "PAIGE_UI_DESIGN",
    "MATERIAL_FLOW_CHANGE",
    "FLOW_PROTOTYPE",
    "SOLO_UI",
    "UNVERIFIED",
  ].includes(key))) {
    if (fields.has(key) && !isEvidenceValue(fields.get(key))) {
      errors.push(`${key} must begin PASS:, UNVERIFIED:, or NOT_APPLICABLE: and include evidence or a reason.`);
    }
  }

  // Five-skill module fields: optional (never required here), but when an author DOES declare
  // one it must be a non-placeholder statement — a declared-but-empty contract is worse than an
  // absent one. CI enforces non-placeholder ONLY; whether the statement is genuinely substantive
  // is a reviewer judgment, not a CI one. This is the "recognized" half of recognized-but-optional.
  for (const key of OPTIONAL_FIELDS) {
    if (fields.has(key)) {
      const value = fields.get(key);
      if (!value?.trim() || hasPlaceholder(value)) {
        errors.push(`${key} is optional, but when present it must be a non-placeholder declaration (reviewers judge substance).`);
      }
    }
  }

  const soloValue = fields.get("SOLO_UI");
  if (!/^(?:YES|NO):\s*\S.+$/i.test(soloValue ?? "") || hasPlaceholder(soloValue)) {
    errors.push("SOLO_UI must be YES: scope or NO: reason.");
  }
  const unverified = fields.get("UNVERIFIED")?.trim();
  if (!unverified || hasPlaceholder(unverified)) {
    errors.push("UNVERIFIED must name remaining behavior and its reason, or state none with the completed proof boundary.");
  }
  if (classification.solo && !/^YES:/i.test(soloValue ?? "")) {
    errors.push("SOLO_UI must be YES when a recognized Solo UI path changed.");
  }
  if (classification.solo || /^YES:/i.test(soloValue ?? "")) {
    for (const key of SOLO_FIELDS) {
      if (!fields.has(key)) errors.push(`${key} is required for Solo UI work.`);
      else if (!isEvidenceValue(fields.get(key))) errors.push(`${key} must include PASS:, UNVERIFIED:, or NOT_APPLICABLE: with evidence or a reason.`);
    }
  }

  return { ok: errors.length === 0, errors };
}

export function parseNameStatus(output) {
  return output.split(/\r?\n/).filter(Boolean).flatMap((line) => {
    const [status, ...paths] = line.split("\t");
    const kind = status.slice(0, 1);
    if (/^[RC]/.test(status)) return paths.map((path) => ({ status: kind, path }));
    return [{ status: kind, path: paths[0] }];
  });
}

function changedFiles(base, head) {
  const output = execFileSync("git", ["diff", "--name-status", "--diff-filter=ACMRD", `${base}...${head}`], { encoding: "utf8" });
  return parseNameStatus(output);
}

// True when any commit body carries a `Visible-Flow-Impact:` trailer with value yes|true.
// A real git trailer sits at the start of its own line, so the anchor is strict (`^`, no leading
// whitespace) — an indented prose line that merely mentions the phrase does not arm the gate.
// Accepts `yes` or `true`; the `\b` stops `yesterday`/`truer` from matching. Pure + exported so
// the match is unit-tested rather than only traced by review.
export function hasVisibleFlowTrailer(logText) {
  return /^Visible-Flow-Impact:\s*(?:yes|true)\b/im.test(logText || "");
}

// The author declares a backend change's visible-flow impact with a `Visible-Flow-Impact: yes`
// commit trailer. Scans this PR's own commits (base..head). Absent the trailer, backend changes
// are not routed to the evidence gate — the declaration is the trigger (§ the standard's
// "Backend-to-visible routing"). Read-only and fail-safe: any git error yields false.
function declaresVisibleFlowImpact(base, head) {
  try {
    const log = execFileSync("git", ["log", "--format=%B", `${base}..${head}`], { encoding: "utf8" });
    return hasVisibleFlowTrailer(log);
  } catch {
    return false;
  }
}

export function run({ base, head }) {
  const bundle = verifyPinnedBundle();
  if (!bundle.ok) {
    console.error("Paige UI skill bundle integrity: FAIL");
    for (const error of bundle.errors) console.error(`  - ${error}`);
    return 1;
  }

  const files = changedFiles(base, head);
  const classification = classifyUiChanges(files, { declaredVisibleFlow: declaresVisibleFlowImpact(base, head) });
  if (!classification.required) {
    console.log("UI delivery evidence: not required; no recognized UI source changed.");
    return 0;
  }
  if (classification.evidenceFiles.length === 0) {
    console.error("UI delivery evidence: FAIL");
    if (classification.uiFiles.length > 0) {
      console.error("Recognized UI files changed:");
      for (const file of classification.uiFiles) console.error(`  - ${file}`);
    }
    if (classification.backendVisibleFlow) {
      console.error("A backend/contract change declared Visible-Flow-Impact: yes (routed to the evidence gate):");
      for (const file of classification.backendContractFiles) console.error(`  - ${file}`);
    }
    console.error("Add a non-template docs/evidence/ui-delivery/*.md record based on TEMPLATE.md.");
    return 1;
  }

  const failures = [];
  for (const file of classification.evidenceFiles) {
    const result = validateEvidenceText(readFileSync(file, "utf8"), classification);
    if (!result.ok) failures.push({ file, errors: result.errors });
  }
  if (failures.length > 0) {
    console.error("UI delivery evidence: FAIL");
    for (const failure of failures) {
      console.error(`${failure.file}:`);
      for (const error of failure.errors) console.error(`  - ${error}`);
    }
    return 1;
  }

  console.log(`UI delivery evidence: PASS (${classification.uiFiles.length} UI file(s), ${classification.evidenceFiles.length} evidence record(s)).`);
  console.log("This guard validates an attestation record; it does not prove the skill was used or the evidence is truthful.");
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const baseIndex = process.argv.indexOf("--base");
  const headIndex = process.argv.indexOf("--head");
  if (baseIndex < 0 || headIndex < 0 || !process.argv[baseIndex + 1] || !process.argv[headIndex + 1]) {
    console.error("Usage: node scripts/ci/ui-delivery-evidence.mjs --base <sha> --head <sha>");
    process.exit(2);
  }
  process.exit(run({ base: process.argv[baseIndex + 1], head: process.argv[headIndex + 1] }));
}
