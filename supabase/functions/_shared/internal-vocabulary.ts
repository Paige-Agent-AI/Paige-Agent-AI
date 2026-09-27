/**
 * internal-vocabulary — the ONE home (§18) for recognising platform-internal text in something PAIGE
 * is about to say to a person: a tool's name, a key the server wrote into her context, the marker of a
 * server-built block, a record id, raw database error text, or operator-only jargon.
 *
 * WHY. Nothing inspected what PAIGE says. Her replies, the drafts she files and the portal chat a
 * client reads were held to "never say internal names" by prompt instructions alone, and every test
 * harness faked the model with a fixed "ok", so no check ever saw a leak or its absence. The one
 * output filter was `summarizeThought` in paige-ai-chat, which drops a whole one-line narration on any
 * snake_case word. That is right for a throwaway line and wrong for a customer's answer: an email
 * address, a booking link or a file name would trip it.
 *
 * DERIVED, NOT HAND-LISTED. The vocabulary is built from what the server actually sends the model on
 * that turn (`deriveInternalVocabulary`), so a new tool, a renamed key or a new context block is
 * covered the moment it ships, with no list to keep in step. Each source is one the platform writes:
 *   - tool NAMES, from the tool definitions;
 *   - JSON keys (never values) in the context blocks the caller VOUCHES for (below);
 *   - the TOP-LEVEL keys of a tool result, which is the platform's own result envelope — never the
 *     keys nested inside it, which for a runner (Zapier, n8n) are whatever a third party returned;
 *   - the names of vouched blocks: a `=== NAME ===` fence line, or a heading whose `END NAME`
 *     terminator is also present;
 *   - the § references in the tool definitions and in any code constant the caller passes, never in
 *     the runtime context, where a tenant's own "§ 1031 exchange" or "§ 1983 claim" also lives.
 * AUTHORSHIP IS DECLARED, NEVER INFERRED. Keys and block names come only from `vouchedTexts`: text the
 * caller declares server-written end to end, where every part is platform code or a value the server
 * encoded (a JSON value, the body of a fenced block). The caller vouches each text explicitly where it
 * builds it, never by default and never inherited, and never vouches a block that pastes in tenant,
 * client, uploaded or fetched prose (persona, brand, address, business description, knowledge), however
 * server-shaped it looks. This module cannot tell who wrote a piece of text from its syntax and does not
 * try: a tenant can write `We offer basic, "gold_tier": true` or a `VIP PLAN … END VIP PLAN` passage
 * into their own persona, and only the code that built that block knows it is theirs.
 *
 * Within vouched text, as defence in depth: JSON values are never read, the body of every fenced block
 * is skipped (a block with no END runs to the next named fence line, or to the end), and a key is read
 * only where JSON grammar puts one, straight after `{` or `,` and before the start of a value, so
 * server prose that quotes a word and puts a colon after it is not a key.
 *
 * Tool PARAMETER names are deliberately not vocabulary. They are the fields of a form — `first_name`,
 * `due_date`, `zip_code` — and those names are also how a business talks about its own data ("name
 * the CSV column first_name"). The internal ones that matter come back in a tool result or a context
 * block, where they are derived.
 *
 * Only identifiers that contain an underscore enter the vocabulary. A single word like `title`,
 * `clients` or `tasks` is how people talk, and is never flagged, even when it is also a key.
 *
 * Three kinds need no vocabulary: a lowercase UUID outside a link or an email address (the form a
 * Postgres record id takes), Postgres/PostgREST error text in wording only those servers produce, and
 * the operator codename the regression lint bans from shipped code. Before scanning, links, email
 * addresses and merge tags (`{{first_name}}`, `{first_name}`) are blanked: each is the reader's to use
 * as written. A § reference is matched only in the platform's own spelling — "§13", no space, not
 * followed by "(" or a sub-number — so a statute ("FLSA § 13(a)(1)", "§ 14(a)") or a lease clause
 * ("§ 13 of your lease") is never read as doctrine.
 *
 * A context key that is also an everyday field name — `tenant_name`, `user_id` — IS flagged when it is
 * written as the identifier. That is a decision, pinned by a test: in a reply to a client the identifier
 * is far more often the leak than the advice, and a property manager's "add a tenant name column" in
 * words passes.
 *
 * THE HONEST LIMIT. This catches known internal vocabulary, not a paraphrase. "Their platform_role is
 * member" is caught; "their access is member" is not, and is not meant to be — that is the plain
 * language the context asks her to use. Nor does it read identifiers the server writes in prose, codes
 * the server sends as JSON values, tool descriptions, or tool parameter names; a heading with no END
 * terminator is not a marker; an uppercase UUID is not treated as a record id; a single-brace merge tag
 * hides whatever identifier it wraps (`{platform_role}`); and "§13" written that way in someone's own
 * lease is still read as doctrine. A key or block name that appears only inside unvouched text is not
 * caught until that text is vouched for. Postgres errors are recognised only in wording no person writes (see
 * DATABASE_ERROR), so an unqualified error with no `ERROR:` prefix can pass. A secret is out of scope
 * because the model is never sent one. A clean result means "none of the known vocabulary", never
 * "nothing internal".
 *
 * PURE: no I/O, no Deno or Node APIs, so the chat handler, the portal chat, the send path and the test
 * harnesses can all run the same code. Every pattern is anchored so that a long draft (an inline image,
 * a pasted export) scans in linear time.
 */

export type InternalLeakKind =
  | "tool_name"
  | "internal_key"
  | "context_marker"
  | "doctrine_ref"
  | "record_id"
  | "database_error"
  | "operator_jargon";

export interface InternalVocabulary {
  readonly toolNames: ReadonlySet<string>;
  readonly keys: ReadonlySet<string>;
  readonly markers: ReadonlySet<string>;
  readonly doctrineRefs: ReadonlySet<string>;
}

export interface InternalLeak {
  kind: InternalLeakKind;
  /** The exact text that matched, as it appears in the input. */
  text: string;
  /** Offset of `text` in the input. */
  index: number;
}

/** A snake_case identifier: lowercase, at least one underscore. The underscore is the whole point. */
const IDENTIFIER = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/;

// ── Deriving the vocabulary ─────────────────────────────────────────────────────────────────────

/** Tool definitions in either wire shape: OpenAI-compatible `{ function: { name, description } }` or
 *  Anthropic-native `{ name, description }`. */
function toolName(tool: unknown): unknown {
  const shape = tool as { function?: { name?: unknown }; name?: unknown } | null | undefined;
  return shape?.function?.name ?? shape?.name;
}

/** Every string in a value, at any depth: a tool definition's descriptions, wherever they sit. */
function stringsIn(value: unknown, depth = 0): string[] {
  if (typeof value === "string") return [value];
  if (!value || typeof value !== "object" || depth > 12) return [];
  return Object.values(value as Record<string, unknown>).flatMap((child) => stringsIn(child, depth + 1));
}

const FENCE_LINE = /^={3,}\s*(.*?)\s*={3,}\s*$/;
const CAPS_PHRASE = /^[A-Z][A-Z0-9&/'’-]*(?: [A-Z0-9&/'’-]+)*$/;
const END_LINE = /^END ([A-Z][A-Z0-9&/'’ -]*[A-Z0-9])\s*$/;

/** The all-caps phrases in a block name: the part before the qualifier, and the qualifier, with any
 *  parenthetical (which can carry a user-supplied file name) removed. One word is never a marker. */
function blockNameParts(name: string): string[] {
  return name
    .replace(/\([^)]*\)/g, " ")
    .split(/\s+[—–]\s+/)
    .map((part) => part.replace(/\s+/g, " ").trim().replace(/^END\s+/, ""))
    .filter((part) => part.length >= 4 && part.includes(" ") && CAPS_PHRASE.test(part));
}

/** A fence line's own name, before its qualifier and without a parenthetical. */
function fenceBaseName(name: string): string {
  return name.replace(/\([^)]*\)/g, " ").split(/\s+[—–]\s+/)[0].replace(/\s+/g, " ").trim().replace(/^END\s+/, "");
}

/**
 * Remove the body of every fenced block and return the block names. A block body is where tenant
 * knowledge, uploaded files, fetched pages and retrieved documents live; nothing inside it is
 * server-authored, so nothing inside it may become vocabulary.
 *
 * An opener (a `=== NAME ===` line with a name) closes at the first END fence whose name it ends with
 * (`=== RELEVANT KNOWLEDGE BASE ===` closes at `=== END KNOWLEDGE BASE ===`). An opener with no such
 * END runs to the next named fence line, or to the end of the text: when the extent is unknown,
 * excluding too much costs a missed word, and excluding too little makes a tenant's words "internal".
 * A bare separator (`======`) opens nothing and closes nothing.
 */
function stripFencedBodies(text: string, markers: Set<string>): string {
  const lines = text.split(/\r?\n/);
  const kept: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const open = lines[i].match(FENCE_LINE);
    if (!open) { kept.push(lines[i]); continue; }
    const name = open[1];
    if (!name) continue;
    for (const part of blockNameParts(name)) markers.add(part);
    if (/^END\b/.test(name)) continue;
    const base = fenceBaseName(name);
    let end = -1;
    let nextFence = -1;
    for (let j = i + 1; j < lines.length; j++) {
      const close = lines[j].match(FENCE_LINE);
      if (!close || !close[1]) continue;
      if (nextFence === -1) nextFence = j;
      if (/^END\b/.test(close[1]) && base.endsWith(fenceBaseName(close[1]))) { end = j; break; }
    }
    if (end !== -1) {
      for (const part of blockNameParts(lines[end].match(FENCE_LINE)![1])) markers.add(part);
      i = end;
    } else {
      i = (nextFence === -1 ? lines.length : nextFence) - 1;
    }
  }
  return kept.join("\n");
}

/** A heading counts as a block name only when its `END NAME` terminator is present too. */
function collectPairedHeadings(text: string, markers: Set<string>): void {
  const lines = text.split(/\r?\n/).map((line) => line.trim());
  for (const line of lines) {
    const end = line.match(END_LINE);
    if (!end) continue;
    const name = end[1].trim();
    const headings = lines.filter((candidate) => candidate === name || candidate.startsWith(`${name} `));
    if (!headings.length) continue;
    for (const part of blockNameParts(name)) markers.add(part);
    // The qualifier on the heading line ("TEAM CONTEXT — REFERENCE DATA ONLY") is part of the marker.
    for (const heading of headings) {
      if (!/\s[—–]\s/.test(heading)) continue;
      for (const part of blockNameParts(heading)) markers.add(part);
    }
  }
}

/** A JSON key: a quoted snake_case identifier where JSON grammar puts a key, straight after `{` or `,`
 *  (whitespace and line breaks allowed, so pretty-printed blocks read the same) and followed by a colon
 *  and the start of a value. A VALUE can never form one: inside a JSON string every quote is escaped,
 *  the closing one included, so `\"vip_plan\": 1` does not match. Nor does a tenant's prose that merely
 *  quotes a word and puts a colon after it. */
const JSON_KEY = /(?<=[{,]\s*)"([a-z][a-z0-9]*(?:_[a-z0-9]+)+)"\s*:\s*(?=["{[\-\d]|(?:true|false|null)\b)/g;
const SECTION_REF = /§\s*(\d+(?:\.\d+)*[a-z]?)/g;
/** The platform's own spelling of a doctrine reference: "§13", "(§9)", "§13/§14" — never "§ 13", "§ 13(a)"
 *  or "§13.2" unless that exact sub-number is ours. */
const DOCTRINE_SPELLING = /§(\d+(?:\.\d+)*[a-z]?)(?![\d(]|\.\d)/g;

/** The top-level keys of a tool result: the platform's own envelope. */
function topLevelKeys(result: string): string[] {
  try {
    const parsed = JSON.parse(result);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? Object.keys(parsed) : [];
  } catch {
    return [];
  }
}

export function deriveInternalVocabulary(input: {
  /** The tool definitions sent to the model this turn. */
  tools?: readonly unknown[];
  /** Text the caller declares server-written end to end (see AUTHORSHIP above), vouched explicitly where
   *  it was built. Never a block that pastes in tenant, client, uploaded or fetched prose, never the
   *  person's own messages or the model's own turns, and never tool results (pass those as
   *  `toolResults`). Keys and block names are derived from these texts alone. */
  vouchedTexts?: readonly string[];
  /** Tool results the model was sent, as the JSON strings it received. */
  toolResults?: readonly string[];
  /** Code constants that carry § references (a doctrine index, a prompt constant). Never runtime text. */
  doctrineSources?: readonly string[];
}): InternalVocabulary {
  const toolNames = new Set<string>();
  const keys = new Set<string>();
  const markers = new Set<string>();
  const doctrineRefs = new Set<string>();
  const addRefs = (text: string) => { for (const match of text.matchAll(SECTION_REF)) doctrineRefs.add(`§${match[1]}`); };

  for (const tool of input.tools ?? []) {
    const name = toolName(tool);
    if (typeof name === "string" && IDENTIFIER.test(name)) toolNames.add(name);
    for (const text of stringsIn(tool)) addRefs(text);
  }

  for (const raw of input.vouchedTexts ?? []) {
    if (typeof raw !== "string" || !raw) continue;
    const text = stripFencedBodies(raw, markers);
    collectPairedHeadings(text, markers);
    for (const match of text.matchAll(JSON_KEY)) keys.add(match[1]);
  }

  for (const result of input.toolResults ?? []) {
    if (typeof result !== "string") continue;
    for (const key of topLevelKeys(result)) if (IDENTIFIER.test(key)) keys.add(key);
  }

  for (const constant of input.doctrineSources ?? []) if (typeof constant === "string") addRefs(constant);

  return { toolNames, keys, markers, doctrineRefs };
}

// ── Finding it in a reply ───────────────────────────────────────────────────────────────────────

/** Links, email addresses and merge tags are the reader's to use as written: an id or an underscore
 *  inside one is part of an address or a placeholder, not a leak. They are blanked (same length, so
 *  offsets hold) before scanning. Each pattern starts at a boundary it cannot re-enter, so a long run
 *  of letters and digits is scanned once, not once per position. */
const LINK = /(?<![A-Za-z0-9.-])(?:https?:\/\/|www\.)[^\s<>()"'`]+|(?<![A-Za-z0-9.-])[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}[/?#][^\s<>()"'`]*/gi;
const EMAIL = /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const MERGE_TAG = /\{\{\s*[A-Za-z][\w.]*\s*\}\}|\{[a-z][a-z0-9_]*\}/g;

function blank(text: string, pattern: RegExp): string {
  return text.replace(pattern, (match) => " ".repeat(match.length));
}

const SNAKE_TOKEN = /(?<![A-Za-z0-9])[A-Za-z0-9]+(?:_[A-Za-z0-9]+)+/g;
/** Postgres renders a uuid in lowercase; an uppercase one is someone's code, not our record. */
const UUID = /(?<![0-9a-zA-Z])[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?![0-9a-zA-Z])/g;

/**
 * Postgres and PostgREST error text, in wording only those servers produce: a Postgres-specific phrase,
 * a schema-qualified or constraint-named object, or a PostgREST/SQLSTATE code. Advice that merely
 * sounds similar ("the function XLOOKUP() does not exist", `column "Revenue" does not exist in the Q3
 * tab`, "leave no null value in column C") is not matched.
 */
const DATABASE_ERROR: RegExp[] = [
  /\bviolates row-level security policy\b/gi,
  /\bviolates (?:foreign key|unique|check|not-null) constraint "[^"\n]+"/gi,
  /\bduplicate key value violates\b/gi,
  /\brelation "(?:[a-z_][a-z0-9_]*\.)?[a-z_][a-z0-9_]*" does not exist\b/gi,
  // Not "column": an owner's own export has columns like "zip_code", and the logged form of a missing
  // column carries the ERROR: prefix below. Case-sensitive, as Postgres writes it.
  /\b(?:type|schema) "[a-z][a-z0-9]*_[a-z0-9_]*" does not exist\b/g,
  /\bERROR:\s+(?:column|function|type|schema|relation|operator)\b[^\n]{0,160}?\bdoes not exist\b/g,
  /\boperator does not exist: /gi,
  /\bfunction [a-z_][a-z0-9_]*\((?:(?:uuid|text|integer|int|bigint|smallint|numeric|boolean|jsonb?|timestamptz|timestamp|date|character varying|varchar|unknown)(?:\[\])?(?:, )?)+\) does not exist\b/gi,
  /\b(?:column|function|type|table) [a-z_][a-z0-9_]*\.[a-z_][\w.]*(?:\([^)\n]*\))? does not exist\b/gi,
  /\bcolumn "[^"\n]+" of relation "[^"\n]+"/gi,
  /\bnull value in column "[^"\n]+" (?:of relation "[^"\n]+" )?violates\b/gi,
  /\bpermission denied for (?:table|relation|function|schema|sequence|view)\b/gi,
  /\binvalid input syntax for type\b/gi,
  /\binfinite recursion detected in policy\b/gi,
  /\bCould not find the (?:function|table|relation)\b[^.\n]{0,200}?\bschema cache\b/gi,
  /\bPGRST\d{3}\b/g,
  /\bSQLSTATE\b/g,
  /\bJWSError\b/g,
];

/** The operator codename the regression lint bans from shipped code, with that lint's own pattern
 *  (scripts/ci/regression-lint.mjs). */
const OPERATOR_JARGON = /\bMMA OS\b/gi;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Every place `text` carries platform-internal vocabulary, in reading order. Empty means none of the
 * known vocabulary is present; see THE HONEST LIMIT above for what that does and does not mean.
 */
export function findInternalLeaks(text: string, vocabulary: InternalVocabulary): InternalLeak[] {
  const source = typeof text === "string" ? text : "";
  if (!source) return [];
  const scan = blank(blank(blank(source, LINK), EMAIL), MERGE_TAG);
  const leaks: InternalLeak[] = [];
  const add = (kind: InternalLeakKind, index: number, length: number) =>
    leaks.push({ kind, index, text: source.slice(index, index + length) });

  for (const match of scan.matchAll(SNAKE_TOKEN)) {
    const token = match[0].toLowerCase();
    if (vocabulary.toolNames.has(token)) add("tool_name", match.index!, match[0].length);
    else if (vocabulary.keys.has(token)) add("internal_key", match.index!, match[0].length);
  }

  // Block names are matched in capitals only. "Your team context" is ordinary English; "TEAM CONTEXT"
  // is the name of a server block.
  for (const marker of vocabulary.markers) {
    const pattern = new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(marker).replace(/ /g, "\\s+")}(?![A-Za-z0-9])`, "g");
    for (const match of scan.matchAll(pattern)) add("context_marker", match.index!, match[0].length);
  }

  // Only the § references the platform's own definitions carry, in its own spelling: "§ 1983" or
  // "FLSA § 13(a)(1)" in a legal answer is not ours.
  for (const match of scan.matchAll(DOCTRINE_SPELLING)) {
    if (vocabulary.doctrineRefs.has(`§${match[1]}`)) add("doctrine_ref", match.index!, match[0].length);
  }

  for (const match of scan.matchAll(UUID)) add("record_id", match.index!, match[0].length);
  for (const pattern of DATABASE_ERROR) {
    for (const match of scan.matchAll(pattern)) add("database_error", match.index!, match[0].length);
  }
  for (const match of scan.matchAll(OPERATOR_JARGON)) add("operator_jargon", match.index!, match[0].length);

  // Two markers can start at the same place ("TEAM CONTEXT" inside a longer marker): the longest wins.
  leaks.sort((a, b) => a.index - b.index || b.text.length - a.text.length);
  return leaks.filter((leak, i) => i === 0 || leak.index !== leaks[i - 1].index || leak.kind !== leaks[i - 1].kind);
}
