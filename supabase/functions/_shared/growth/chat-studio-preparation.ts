/** Studio-only answer metadata. This is neither a model tool nor an executor.
 * The caller owns ordinary decision-round eligibility; native current scope
 * owns actual Chat R2 authority. No project starts from this module. */
import { decodeChunks } from "../client-seat-reply.ts";
import { UUID } from "../comms-email/contract.ts";
import { createWeeklyDraftDeadline } from "../paige-orchestration/weekly-draft-deadline.ts";

export type ChatStudioPreparation = Readonly<{ brief: string }>;
export const CHAT_STUDIO_TARGET_QUESTION = "Which business or project should NEXUS build this for?";
export const CHAT_STUDIO_PREPARATION_PROMPT = [
  "STUDIO BRIEF PREPARATION — this eligible decision answer only: when the person explicitly asks to prepare a public page/form/funnel design, you may append one reserved terminal fence after the ordinary reply.",
  `When choosing this optional metadata for a clear design request, make the entire ordinary visible reply exactly this question: "${CHAT_STUDIO_TARGET_QUESTION}" Do not add a preface, completion claim, promise or other prose. This is a truthful clarification under the normal answer rules.`,
  'In this answer no native save or stage has been confirmed. Do not say "Choose below", refer to an available button/card/link, or claim a prepared/saved/staged project, page, handoff or receipt. The original UI may offer target selection only after actual native confirmation.',
  'Use exactly: ```paige_studio_brief\n{"brief":"the plain design brief"}\n``` at the END. Emit at most one fence. Omit it when a requested design is unclear; ask a useful question instead.',
  "This prepares text only. You have NOT created a project, built a page, saved a version, approved, published or executed anything. Never claim those outcomes.",
  "The person still chooses the project target and explicitly starts the original Studio project. Never infer workspace/client/prospect authority or a ready project from this metadata.",
  "JSON contains ONLY brief, a nonempty plain string of at most 10000 characters, without NUL. No IDs, URL metadata, navigation, approval, status or receipt fields. A public URL inside the requested brief is input, never authority.",
  "Use only the public design input the person requested. Never copy unrelated private history, Knowledge, Vault material or secrets into a brief. Never put this protocol in tool narration, tool arguments or a later closing answer.",
].join("\n");

const MARKER = "paige_studio_brief";
const object = (value: unknown): Record<string, unknown> | null => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const exactKeys = (row: Record<string, unknown>, names: readonly string[]) => Object.keys(row).length === names.length && names.every(name => Object.prototype.hasOwnProperty.call(row, name));
function preparation(value: unknown): ChatStudioPreparation | null {
  const row = object(value);
  if (!row || !exactKeys(row, ["brief"]) || typeof row.brief !== "string"
    || !row.brief.trim() || row.brief.length > 10000 || row.brief.includes("\0")) return null;
  return { brief: row.brief.trim() };
}
type Control = { found: boolean; cleanText: string; preparation: ChatStudioPreparation | null; invalid: boolean };
function control(text: string): Control {
  let start = -1;
  const markers = Array.from(text.matchAll(/paige_studio_brief/gi));
  if (markers.length) {
    const marker = markers[0].index!;
    const line = text.lastIndexOf("\n", marker) + 1;
    let fence = text.lastIndexOf("```", marker);
    if (fence < line) fence = -1;
    while (fence > line && text[fence - 1] === "`") fence--;
    start = fence >= 0 ? fence : marker;
  }
  // A cut-off reserved header is control too. Ordinary JSON/Python/etc fences
  // and ordinary mentions of Paige are unaffected.
  for (const match of text.matchAll(/`{3,}[ \t]*([a-z_]+)(?=[ \t]*(?:\r?\n|$))/gi)) {
    const tag = match[1].toLowerCase();
    if (tag.length >= 5 && MARKER.startsWith(tag) && (start < 0 || match.index! < start)) start = match.index!;
  }
  if (start < 0) return { found: false, cleanText: text, preparation: null, invalid: false };
  const cleanText = text.slice(0, start).trimEnd();
  const terminal = /(?:^|\n)```paige_studio_brief\r?\n([\s\S]*?)\r?\n```[ \t]*(?:\r?\n[ \t]*)*$/.exec(text);
  if (markers.length !== 1 || !terminal || terminal.index + (text[terminal.index] === "\n" ? 1 : 0) !== start) {
    return { found: true, cleanText, preparation: null, invalid: true };
  }
  try {
    const parsed = preparation(JSON.parse(terminal[1]));
    return { found: true, cleanText, preparation: parsed, invalid: parsed === null };
  } catch { return { found: true, cleanText, preparation: null, invalid: true }; }
}

/** Tool-round content cannot carry this protocol into later conversation input.
 * Any reserved material here is invalid; this function never returns a brief. */
export function stripChatStudioControl(text: string): { cleanText: string; invalid: boolean } {
  const found = control(text);
  return { cleanText: found.cleanText, invalid: found.found };
}

type LocatedContent = { choice: number; text: string; start: number; end: number };
/** Locate only JSON string VALUES at choices[number].delta.content. Envelopes
 * are never reserialized: large numbers, key spelling/order, unknown fields,
 * role/null/tool deltas and provider finish/usage remain byte-for-byte intact. */
function contentStrings(json: string): LocatedContent[] {
  let position = 0;
  const out: LocatedContent[] = [];
  const whitespace = () => { while (/\s/.test(json[position] ?? "") && position < json.length) position++; };
  const string = () => {
    const start = position++;
    while (position < json.length) {
      const char = json[position++];
      if (char === "\\") position++;
      else if (char === '"') return { start, end: position, value: JSON.parse(json.slice(start, position)) as string };
    }
    throw new Error("unclosed_json_string");
  };
  const skip = () => {
    whitespace();
    if (json[position] === '"') { string(); return; }
    if (json[position] !== "{" && json[position] !== "[") {
      while (position < json.length && !/[\s,}\]]/.test(json[position])) position++;
      return;
    }
    let depth = 0;
    do {
      const char = json[position];
      if (char === '"') { string(); continue; }
      if (char === "{" || char === "[") depth++;
      else if (char === "}" || char === "]") depth--;
      position++;
    } while (position < json.length && depth > 0);
  };
  const wanted = (path: (string | number)[]) => path.length === 0 || path[0] === "choices" &&
    (path.length === 1 || typeof path[1] === "number" && (path.length === 2 || path[2] === "delta" && (path.length === 3 || path.length === 4 && path[3] === "content")));
  const walk = (path: (string | number)[]) => {
    whitespace();
    if (!wanted(path)) { skip(); return; }
    if (path.length === 4 && json[position] === '"') {
      const token = string(); out.push({ choice: path[1] as number, text: token.value, start: token.start, end: token.end }); return;
    }
    if (json[position] === "{") {
      position++; whitespace();
      while (json[position] !== "}") {
        const key = string().value; whitespace(); position++; walk([...path, key]); whitespace();
        if (json[position] !== ",") break;
        position++; whitespace();
      }
      position++; return;
    }
    if (json[position] === "[") {
      position++; whitespace(); let index = 0;
      while (json[position] !== "]") {
        walk([...path, index++]); whitespace();
        if (json[position] !== ",") break;
        position++; whitespace();
      }
      position++; return;
    }
    skip();
  };
  walk([]);
  return out;
}
type DataPart = { text: string; start: number; offset: number };
type Wire = { contents: LocatedContent[]; primary: string; unsafeMapping: boolean; unreadableControl: boolean };
function readWire(raw: string): Wire {
  const contents: LocatedContent[] = [], primary: string[] = [];
  let parts: DataPart[] = [], offset = 0, unsafeMapping = false, unreadableControl = false;
  const record = () => {
    if (!parts.length) return;
    const payload = parts.map(part => part.text).join("\n");
    try {
      if (payload.trim() === "[DONE]") return;
      const parsed = object(JSON.parse(payload));
      const choices = Array.isArray(parsed?.choices) ? parsed.choices : [];
      const value = object(object(choices[0])?.delta)?.content;
      const semantic = typeof value === "string" ? value : "";
      primary.push(semantic);
      const tokens = contentStrings(payload);
      if (tokens.filter(token => token.choice === 0).map(token => token.text).join("") !== semantic) unsafeMapping = true;
      for (const token of tokens) {
        const part = parts.find(item => token.start >= item.offset && token.end <= item.offset + item.text.length);
        if (!part) { unsafeMapping = true; continue; }
        contents.push({ ...token, start: part.start + token.start - part.offset, end: part.start + token.end - part.offset });
      }
    } catch {
      // A malformed record containing reserved control cannot be edited safely.
      // It is withheld, never repaired into a new synthetic answer frame.
      // Even an incomplete JSON string can encode its reserved header. Decode
      // only escape spelling for conservative detection, never for replay.
      const unescaped = payload.replace(/\\u([0-9a-f]{4})/gi, (_match, code: string) => String.fromCharCode(parseInt(code, 16)))
        .replace(/\\[nrt]/g, escape => escape === "\\n" ? "\n" : escape === "\\r" ? "\r" : "\t");
      if (control(payload).found || control(unescaped).found) unreadableControl = true;
    } finally { parts = []; offset = 0; }
  };
  for (let start = 0; start < raw.length;) {
    let end = start;
    while (end < raw.length && raw[end] !== "\n" && raw[end] !== "\r") end++;
    let next = end;
    if (raw[next] === "\r") next++;
    if (raw[next] === "\n") next++;
    let line = raw.slice(start, end), fieldStart = start;
    if (start === 0 && line.startsWith("\uFEFF")) { line = line.slice(1); fieldStart++; }
    if (!line) record();
    else if (line === "data" || line.startsWith("data:")) {
      let valueStart = line === "data" ? line.length : 5;
      if (line[valueStart] === " ") valueStart++;
      const text = line.slice(valueStart);
      parts.push({ text, start: fieldStart + valueStart, offset }); offset += text.length + 1;
    }
    start = next;
  }
  record();
  return { contents, primary: primary.join(""), unsafeMapping, unreadableControl };
}
function originalBytes(chunks: readonly Uint8Array[]): Uint8Array {
  const bytes = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

export function extractChatStudioPreparation({ chunks, text }: { chunks: Uint8Array[]; text: string }): {
  cleanText: string; cleanChunks: Uint8Array[]; preparation: ChatStudioPreparation | null; invalid: boolean;
} {
  const bytes = originalBytes(chunks);
  // decodeChunks is the incumbent UTF-8 reader; restore its stripped leading
  // BOM only for unchanged wire syntax/offsets, not for accumulated content.
  const bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  const raw = (bom ? "\uFEFF" : "") + decodeChunks(chunks);
  const wire = readWire(raw);
  const groups = new Map<number, LocatedContent[]>();
  for (const content of wire.contents) groups.set(content.choice, [...(groups.get(content.choice) ?? []), content]);
  const primary = control(wire.primary), supplied = control(text);
  const groupedControl = [...groups.values()].some(values => control(values.map(value => value.text).join("")).found);
  const secondaryControl = [...groups].some(([choice, values]) => choice !== 0 && control(values.map(value => value.text).join("")).found);
  const mismatch = wire.primary !== text;
  const found = primary.found || supplied.found || groupedControl || wire.unreadableControl;
  if (!found) return { cleanText: text, cleanChunks: chunks, preparation: null, invalid: mismatch || wire.unsafeMapping };
  try {
    if (new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes) !== raw) throw new Error("unreadable_utf8");
  } catch { return { cleanText: "", cleanChunks: [], preparation: null, invalid: true }; }
  if (wire.unreadableControl) return { cleanText: primary.cleanText, cleanChunks: [], preparation: null, invalid: true };
  const edits: { start: number; end: number; replacement: string }[] = [];
  for (const values of groups.values()) {
    const combined = values.map(value => value.text).join("");
    const result = control(combined);
    const keep = wire.unsafeMapping ? 0 : result.cleanText.length;
    if (!result.found && !wire.unsafeMapping) continue;
    let consumed = 0;
    for (const value of values) {
      const kept = value.text.slice(0, Math.max(0, keep - consumed));
      if (kept !== value.text) edits.push({ start: value.start, end: value.end, replacement: JSON.stringify(kept) });
      consumed += value.text.length;
    }
  }
  let cleanWire = raw;
  for (const edit of edits.sort((a, b) => b.start - a.start)) cleanWire = cleanWire.slice(0, edit.start) + edit.replacement + cleanWire.slice(edit.end);
  const invalid = mismatch || wire.unsafeMapping || primary.invalid || secondaryControl || supplied.invalid;
  return { cleanText: wire.unsafeMapping ? "" : primary.cleanText, cleanChunks: edits.length ? [new TextEncoder().encode(cleanWire)] : chunks,
    preparation: invalid ? null : primary.preparation, invalid };
}

type Scope = Readonly<{ threadId: string; actorId: string; tenantId: string; intent: string; requestNonce: string; eligible: boolean }>;
type Deps = Readonly<{ service: { rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }> }; signal?: AbortSignal; timeoutMs?: number }>;
export function createChatStudioPreparation(scope: Scope, deps: Deps) {
  const args = { p_thread: scope.threadId, p_actor: scope.actorId, p_tenant: scope.tenantId, p_intent: scope.intent, p_request_nonce: scope.requestNonce };
  const eligible = scope.eligible === true && [scope.threadId, scope.actorId, scope.tenantId, scope.intent, scope.requestNonce].every(value => typeof value === "string" && UUID.test(value));
  const rpc: Deps["service"]["rpc"] = deps.service.rpc.bind(deps.service);
  let withdrawn = false, sourceTurnId: string | null = null;
  const live = () => eligible && !withdrawn && deps.signal?.aborted !== true;
  const current = async (): Promise<boolean> => {
    if (!live()) return false;
    try {
      const response = await createWeeklyDraftDeadline(deps.timeoutMs ?? 5000, live)(() => rpc("chat_studio_scope", args));
      const row = object(response.data);
      if (response.error || !row || row.ok !== true || !exactKeys(row, ["ok", "source_turn_id"])
        || typeof row.source_turn_id !== "string" || !UUID.test(row.source_turn_id) || sourceTurnId !== null && sourceTurnId !== row.source_turn_id || !live()) {
        withdrawn = true; return false;
      }
      sourceTurnId = row.source_turn_id; return true;
    } catch { withdrawn = true; return false; }
  };
  const stage = async (candidate: ChatStudioPreparation): Promise<{ sourceTurnId: string; outcome: "staged" | "existing" } | null> => {
    const prepared = preparation(candidate);
    if (!prepared || !await current()) return null;
    try {
      const response = await createWeeklyDraftDeadline(deps.timeoutMs ?? 5000, live)(() => rpc("chat_stage_studio_brief", { ...args, p_brief: prepared.brief }));
      const row = object(response.data);
      if (response.error || !row || row.ok !== true || !exactKeys(row, ["ok", "source_turn_id", "outcome"]) || row.source_turn_id !== sourceTurnId
        || (row.outcome !== "staged" && row.outcome !== "existing") || !live()) { withdrawn = true; return null; }
      return { sourceTurnId: sourceTurnId!, outcome: row.outcome };
    } catch { withdrawn = true; return null; }
  };
  return Object.freeze({ current, stage });
}
