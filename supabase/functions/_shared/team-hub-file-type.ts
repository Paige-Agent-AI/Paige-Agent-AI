// EXP08 Team Hub increment 3: the real-type check for an attached file.
// Contract: docs/delivery/exp08-team-hub-increment3-attachments-contract.md §1 (allowed types) and §5.
//
// Files are NOT scanned for malware. What makes that acceptable is this check: only nine safe
// types are admitted, and each must be what its bytes say it is, not what its name or the
// browser's declared MIME claims. Pure by construction: bytes in, verdict out. No I/O, and no Deno
// or Node globals beyond the Web-standard TextDecoder, Blob and DecompressionStream, so the same
// module runs in the edge function and under test.
//
// Word and Excel need more than a signature: a file can do harm with no macro at all. So their
// check also refuses ActiveX, embedded objects, ribbon customisation, external workbook links, any
// relationship that fetches from outside the file (the remote-template route), and DDE fields, by
// inflating the parts that carry them under a hard ceiling against ZIP bombs.
//
// Every refusal carries a reason CODE, never a file name or a byte, so a caller can log it.

export const TEAM_HUB_FILE_MIMES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "text/csv",
] as const;
export type TeamHubFileMime = typeof TEAM_HUB_FILE_MIMES[number];

export const TEAM_HUB_MAX_FILE_BYTES = 10 * 1024 * 1024;

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Why bytes were refused. `mismatch` means the bytes are an allowed type, just not the declared one. */
export type TeamHubFileRefusal =
  | "empty"
  | "too_large"
  | "not_allowed"
  | "mismatch"
  | "legacy_office"
  | "macro_content"
  | "embedded_content"
  | "external_content"
  | "dde_field"
  | "oversized_document"
  | "malformed_document"
  | "unrecognised";

export type TeamHubFileVerdict =
  | { accept: true; detectedMime: TeamHubFileMime; reason: null }
  | { accept: false; detectedMime: TeamHubFileMime | null; reason: TeamHubFileRefusal };

const startsWith = (bytes: Uint8Array, signature: readonly number[], at = 0) =>
  bytes.length >= at + signature.length && signature.every((value, index) => bytes[at + index] === value);
const ascii = (text: string) => Array.from(text, (char) => char.charCodeAt(0));

const PDF = ascii("%PDF-");
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff];
const RIFF = ascii("RIFF");
const WEBP = ascii("WEBP");
const GIF87 = ascii("GIF87a");
const GIF89 = ascii("GIF89a");
const ZIP_LOCAL = [0x50, 0x4b, 0x03, 0x04];
const OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

const u16 = (bytes: Uint8Array, at: number) => bytes[at] | (bytes[at + 1] << 8);
const u32 = (bytes: Uint8Array, at: number) => (bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24)) >>> 0;

type ZipEntry = { name: string; method: number; compressedSize: number; size: number; dataStart: number };

/**
 * A ZIP's central directory, or null when the archive is not one well-formed, single-disk,
 * non-ZIP64, unencrypted archive whose directory and entry data lie inside the bytes. A 10 MB cap
 * means ZIP64 is never legitimate here. The directory is the authority Office reads; each entry's
 * data starts after its own local header.
 */
function zipEntries(bytes: Uint8Array): ZipEntry[] | null {
  const EOCD = 0x06054b50, CENTRAL = 0x02014b50;
  // The end-of-central-directory record is 22 bytes plus a comment of at most 65535 bytes.
  const floor = Math.max(0, bytes.length - 22 - 0xffff);
  let eocd = -1;
  for (let at = bytes.length - 22; at >= floor; at--) {
    if (u32(bytes, at) === EOCD && at + 22 + u16(bytes, at + 20) === bytes.length) { eocd = at; break; }
  }
  if (eocd < 0) return null;
  const disk = u16(bytes, eocd + 4), directoryDisk = u16(bytes, eocd + 6);
  const onDisk = u16(bytes, eocd + 8), total = u16(bytes, eocd + 10);
  const size = u32(bytes, eocd + 12), offset = u32(bytes, eocd + 16);
  if (disk !== 0 || directoryDisk !== 0 || onDisk !== total || total === 0xffff || size === 0xffffffff || offset === 0xffffffff) return null;
  if (offset + size > eocd) return null;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const entries: ZipEntry[] = [];
  let at = offset;
  for (let index = 0; index < total; index++) {
    if (at + 46 > offset + size || u32(bytes, at) !== CENTRAL) return null;
    const flags = u16(bytes, at + 8), method = u16(bytes, at + 10);
    const compressedSize = u32(bytes, at + 20), entrySize = u32(bytes, at + 24);
    const nameLength = u16(bytes, at + 28), extraLength = u16(bytes, at + 30), commentLength = u16(bytes, at + 32);
    const local = u32(bytes, at + 42);
    if (at + 46 + nameLength > offset + size || local + 30 > offset || !startsWith(bytes, ZIP_LOCAL, local)) return null;
    // Bit 0 is encryption: an encrypted part cannot be inspected, so it is not a document we accept.
    if (flags & 1) return null;
    const dataStart = local + 30 + u16(bytes, local + 26) + u16(bytes, local + 28);
    if (dataStart + compressedSize > offset) return null;
    let name: string;
    try {
      name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    } catch {
      return null;
    }
    entries.push({ name, method, compressedSize, size: entrySize, dataStart });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return at === offset + size ? entries : null;
}

/** Entry names from a ZIP's central directory, or null when it is not a well-formed archive (see zipEntries). */
export function zipEntryNames(bytes: Uint8Array): string[] | null {
  return zipEntries(bytes)?.map((entry) => entry.name) ?? null;
}

/** Case-insensitive search for an ASCII needle anywhere in the bytes. */
function containsAscii(bytes: Uint8Array, needle: string): boolean {
  const lower = ascii(needle.toLowerCase());
  const first = lower[0];
  outer: for (let at = 0; at + lower.length <= bytes.length; at++) {
    if ((bytes[at] | 0x20) !== first) continue;
    for (let index = 1; index < lower.length; index++) {
      const byte = bytes[at + index];
      const folded = byte >= 0x41 && byte <= 0x5a ? byte | 0x20 : byte;
      if (folded !== lower[index]) continue outer;
    }
    return true;
  }
  return false;
}

type Detection = { mime: TeamHubFileMime | null; reason: TeamHubFileRefusal | null };

/** Total bytes the check will inflate for one document. A real 10 MB Office file is far below it. */
// 12 MB of inspected XML is far beyond any real document's relationships, content types and word/*.xml
// text (media is never inflated), and keeps the linear walk well inside the edge CPU budget.
export const TEAM_HUB_MAX_INFLATED_BYTES = 12 * 1024 * 1024;

/**
 * Compressed bytes handed to the decompressor at a time. Deflate expands at most about 1032:1, so
 * no single piece can produce more than about 4 MB of output. That bound matters because Deno's
 * DecompressionStream returns ALL the output of one written chunk as one chunk: writing the whole
 * entry at once would inflate a 1 MB bomb to 1 GB before the ceiling below could be checked.
 */
export const TEAM_HUB_INFLATE_PIECE_BYTES = 4096;

/**
 * One entry's uncompressed bytes, or null when it is not stored (0) or deflated (8), its bytes do
 * not come to exactly its recorded size, or inflating it would pass what is left of the ceiling.
 * The compressed bytes are fed in small pieces and the output is read between them, so inflation
 * stops within one piece of the first byte over and a ZIP bomb never expands in memory, on Deno
 * and on Node alike.
 */
async function inflateEntry(bytes: Uint8Array, entry: ZipEntry, budget: { left: number }): Promise<Uint8Array | null> {
  if (entry.size > budget.left) return null;
  const raw = bytes.subarray(entry.dataStart, entry.dataStart + entry.compressedSize);
  let out: Uint8Array;
  if (entry.method === 0) {
    if (entry.compressedSize !== entry.size) return null;
    out = raw;
  } else if (entry.method === 8) {
    const limit = Math.min(entry.size, budget.left);
    const chunks: Uint8Array[] = [];
    let total = 0;
    const stream = new DecompressionStream("deflate-raw");
    const writer = stream.writable.getWriter();
    const reader = stream.readable.getReader();
    // The writer waits on each piece, and a piece is only taken once the output before it has been
    // read, so at most one piece is ever in flight. Cancelling the reader errors the writer too.
    const feeding = (async () => {
      for (let at = 0; at < raw.length; at += TEAM_HUB_INFLATE_PIECE_BYTES) {
        // slice, not subarray: a copied piece owns its ArrayBuffer, which the stream's BufferSource type requires.
        await writer.write(raw.slice(at, Math.min(at + TEAM_HUB_INFLATE_PIECE_BYTES, raw.length)));
      }
      await writer.close();
    })();
    feeding.catch(() => {});
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.length;
        if (total > limit) {
          await reader.cancel().catch(() => {});
          await writer.abort().catch(() => {});
          return null;
        }
        chunks.push(value);
      }
      await feeding;
    } catch {
      await reader.cancel().catch(() => {});
      await writer.abort().catch(() => {});
      return null;
    }
    if (total !== entry.size) return null;
    out = new Uint8Array(total);
    let at = 0;
    for (const chunk of chunks) { out.set(chunk, at); at += chunk.length; }
  } else {
    return null;
  }
  budget.left -= out.length;
  return out;
}

/** An XML part as text: UTF-8, or UTF-16 by its byte-order mark or its leading `<` byte pattern. */
function xmlText(bytes: Uint8Array): string | null {
  let encoding = "utf-8";
  if ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0x3c && bytes[1] === 0x00)) encoding = "utf-16le";
  else if ((bytes[0] === 0xfe && bytes[1] === 0xff) || (bytes[0] === 0x00 && bytes[1] === 0x3c)) encoding = "utf-16be";
  try {
    return new TextDecoder(encoding, { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

const NAMED_ENTITIES: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

/** XML character references and the five predefined entities. Anything else is left as written, so it never matches a value we accept. */
function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[body] ?? whole;
  });
}

/**
 * The markup with comments and processing instructions removed and each CDATA section turned into
 * the escaped text it stands for, in one left-to-right pass, so text that only looks like a tag can
 * never open, end or hide a field. Null when one of them is left unterminated.
 *
 * Linear by construction: each search for a terminator starts where the construct opens and the
 * scan resumes after it, and the first missing terminator ends the pass. (A regex that retried every
 * unterminated `<!--` to the end of the text took quadratic time on a part of a few hundred KB.)
 */
function markupOnly(xml: string): string | null {
  const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const constructs = [
    { open: "<!--", close: "-->", keep: false },
    { open: "<![CDATA[", close: "]]>", keep: true },
    { open: "<?", close: "?>", keep: false },
  ];
  const parts: string[] = [];
  let copied = 0;
  for (let at = xml.indexOf("<"); at >= 0; at = xml.indexOf("<", at)) {
    const construct = constructs.find((candidate) => xml.startsWith(candidate.open, at));
    if (!construct) { at++; continue; }
    const body = at + construct.open.length;
    const close = xml.indexOf(construct.close, body);
    if (close < 0) return null;
    parts.push(xml.slice(copied, at));
    if (construct.keep) parts.push(escape(xml.slice(body, close)));
    copied = at = close + construct.close.length;
  }
  parts.push(xml.slice(copied));
  const cleaned = parts.join("");
  // Removing one construct can join the text either side into a new opener (`<<!---->!--`).
  return /<!--|<!\[CDATA\[|<\?/.test(cleaned) ? null : cleaned;
}

/**
 * Text content of an element: tags dropped, entities decoded. A tag runs from a `<` to the next `>`,
 * and a `<` with no `>` after it stays as text, exactly as `/<[^>]*>/g` would read it, but in one
 * left-to-right pass: that regex rescanned to the end for every `<` with no `>`, which made a few
 * hundred KB of `<` take tens of seconds.
 */
function characterData(raw: string): string {
  const parts: string[] = [];
  let copied = 0;
  for (let open = raw.indexOf("<"); open >= 0; open = raw.indexOf("<", copied)) {
    const close = raw.indexOf(">", open + 1);
    if (close < 0) break;
    parts.push(raw.slice(copied, open));
    copied = close + 1;
  }
  parts.push(raw.slice(copied));
  return decodeEntities(parts.join(""));
}

type StartTag = { local: string; attributes: Map<string, string[]>; end: number; selfClosing: boolean };

/**
 * Every start tag whose local name (any namespace prefix, any case) is in `locals`, with its
 * attributes keyed by lower-cased local name and entity-decoded. Values are read quote to quote, so a
 * `>` inside a value cannot hide the attributes after it. Null when such a tag does not parse, or
 * when it repeats an attribute name, which XML forbids. Two names that differ only in prefix (`a`,
 * `x:a`) are both kept under one key, so a caller that wants exactly one value can see there are two.
 */
function startTags(xml: string, locals: ReadonlySet<string>): StartTag[] | null {
  const tags: StartTag[] = [];
  const opener = /<(?:[A-Za-z_][\w.-]*:)?([A-Za-z_][\w.-]*)/g;
  const attributeName = /[^\s=/>]+/y;
  for (let match = opener.exec(xml); match; match = opener.exec(xml)) {
    const local = match[1].toLowerCase();
    if (!locals.has(local)) continue;
    const attributes = new Map<string, string[]>();
    const written = new Set<string>();
    let at = match.index + match[0].length;
    let selfClosing = false;
    for (;;) {
      while (at < xml.length && /\s/.test(xml[at])) at++;
      if (at >= xml.length) return null;
      if (xml[at] === ">") { at++; break; }
      if (xml.startsWith("/>", at)) { at += 2; selfClosing = true; break; }
      attributeName.lastIndex = at;
      const name = attributeName.exec(xml);
      if (!name) return null;
      at += name[0].length;
      while (at < xml.length && /\s/.test(xml[at])) at++;
      if (xml[at] !== "=") return null;
      at++;
      while (at < xml.length && /\s/.test(xml[at])) at++;
      const quote = xml[at];
      if (quote !== '"' && quote !== "'") return null;
      const close = xml.indexOf(quote, at + 1);
      if (close < 0) return null;
      const value = xml.slice(at + 1, close);
      if (value.includes("<")) return null;
      if (written.has(name[0])) return null;
      written.add(name[0]);
      const key = name[0].slice(name[0].indexOf(":") + 1).toLowerCase();
      // Appended in place: copying the list on every repeat made one tag of repeated names quadratic.
      const values = attributes.get(key);
      if (values) values.push(decodeEntities(value));
      else attributes.set(key, [decodeEntities(value)]);
      at = close + 1;
    }
    tags.push({ local, attributes, end: at, selfClosing });
    opener.lastIndex = at;
  }
  return tags;
}

// A DTD can declare entities or default attributes that the reader applies and this check would not.
// Office packages never carry one (the packaging standard forbids it), so one is refused outright.
const DTD = /<!(?:DOCTYPE|ENTITY|ATTLIST|ELEMENT)/i;
const HYPERLINK = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink";
const RELATIONSHIP = new Set(["relationship"]);
// Relationship kinds (last Type segment, lower-cased) that carry code or an embedded object. A
// relationship is how Office finds a part, so these are refused wherever the part itself lives.
const MACRO_KINDS = new Set(["vbaproject", "vbaprojectsignature", "vbaprojectsignatureagile", "vbaprojectsignaturev3", "wordvbadata", "keymapcustomizations"]);
const EMBEDDING_KINDS = new Set(["oleobject", "package", "control", "activexcontrolbinary", "extensibility"]);

/**
 * A relationships part. Anything that points outside the file is refused unless it is a plain
 * hyperlink, which Office only follows when the reader clicks it. A remote template, image, frame or
 * OLE link loads on open, which is the route that needs no macro.
 */
function relationshipsRefusal(xml: string): TeamHubFileRefusal | null {
  if (DTD.test(xml)) return "malformed_document";
  const tags = startTags(xml, RELATIONSHIP);
  if (!tags) return "malformed_document";
  for (const tag of tags) {
    const types = tag.attributes.get("type") ?? [];
    // The relationship kind is the last path segment of its Type URI, whatever the namespace year.
    const kind = types.length === 1 ? types[0].trim().split("/").pop()!.toLowerCase() : null;
    // Absent means Internal. Any other spelling is treated as External: it fails closed.
    const external = (tag.attributes.get("targetmode") ?? []).some((mode) => mode.trim() !== "Internal");
    if (external) {
      if (types.length !== 1 || types[0].trim() !== HYPERLINK) return "external_content";
      continue;
    }
    // Inside the file, the kinds that run or embed something are refused by kind, so a part that
    // dodges the folder names (any path, any percent-encoding of it) is still caught by what it is.
    if (kind === null) return "malformed_document";
    if (MACRO_KINDS.has(kind)) return "macro_content";
    if (EMBEDDING_KINDS.has(kind)) return "embedded_content";
    if (kind === "externallink") return "external_content";
    // The one opaque .bin a real document carries is its printer setup, so a .bin target must be that.
    const targets = (tag.attributes.get("target") ?? []).map((target) => partName(target.trim().replace(/^\/+/, "")));
    if (targets.some((target) => target === null)) return "malformed_document";
    if (targets.some((target) => target!.endsWith(".bin")) && kind !== "printersettings") return "embedded_content";
  }
  return null;
}

const FIELD_PARTS = new Set(["fldchar", "instrtext", "fldsimple"]);
const DDE = /^\s*DDE(?:AUTO)?\b/i;

/**
 * A Word XML part's field instructions. A field whose instruction is DDE or DDEAUTO runs a program
 * through Dynamic Data Exchange, so it is refused. A complex field's instruction may be split across
 * runs, so the pieces are joined per field; and a field whose keyword is itself produced by a nested
 * field (the QUOTE trick that spells DDE from character codes) is refused too.
 */
function wordFieldRefusal(xml: string): TeamHubFileRefusal | null {
  if (DTD.test(xml)) return "malformed_document";
  const tags = startTags(xml, FIELD_PARTS);
  if (!tags) return "malformed_document";
  // Every piece of instruction text is kept, before or after the field's separator, so the check
  // fails closed; a nested field counts as computing the keyword only before any instruction text.
  // `worded` records whether any instruction text so far is more than whitespace, so a nested begin
  // need not re-trim the whole instruction (re-trimming it for every nested begin was quadratic).
  type Field = { instruction: string; worded: boolean; computedKeyword: boolean; separated: boolean };
  const open: Field[] = [];
  const refused = (field: Field) => field.computedKeyword || DDE.test(field.instruction);
  const closing = /<\/(?:[A-Za-z_][\w.-]*:)?instrText\s*>/gi;
  // Where the last instruction text ended. instrText holds only text, so a field tag that starts
  // before that point sits inside it; for a second instrText that would mean two opens sharing one
  // close. Each close is therefore searched for only after the previous one, which keeps the whole
  // walk linear (searching from every open to a shared close at the end was quadratic).
  let textEnd = -1;
  for (const tag of tags) {
    if (tag.end <= textEnd) return "malformed_document";
    if (tag.local === "fldsimple") {
      if ((tag.attributes.get("instr") ?? []).some((instruction) => DDE.test(instruction))) return "dde_field";
      continue;
    }
    if (tag.local === "instrtext") {
      let text = "";
      if (!tag.selfClosing) {
        closing.lastIndex = tag.end;
        const close = closing.exec(xml);
        if (!close) return "malformed_document";
        textEnd = close.index;
        text = characterData(xml.slice(tag.end, close.index));
      }
      const field = open[open.length - 1];
      if (field) {
        field.instruction += text;
        if (!field.worded && /\S/.test(text)) field.worded = true;
      } else if (DDE.test(text)) return "dde_field";
      continue;
    }
    // Exactly one field type, as for a relationship's Type: two values under different prefixes could
    // be read one way here and another way by Word.
    const kinds = tag.attributes.get("fldchartype") ?? [];
    if (kinds.length > 1) return "malformed_document";
    const kind = kinds[0]?.trim();
    const field = open[open.length - 1];
    if (kind === "begin") {
      if (field && !field.separated && !field.worded) field.computedKeyword = true;
      open.push({ instruction: "", worded: false, computedKeyword: false, separated: false });
    } else if (kind === "separate") {
      if (field) field.separated = true;
    } else if (kind === "end") {
      if (field && refused(field)) return "dde_field";
      open.pop();
    }
  }
  return open.some(refused) ? "dde_field" : null;
}

/** Printer setup that Excel and Word save as an opaque blob. It is a print-driver record, not code. */
const PRINTER_SETTINGS = /^(?:word|xl)\/printersettings\/printersettings\d+\.bin$/;

/** Why an entry's NAME alone refuses the document, or null. Names arrive lower-cased. */
function entryNameRefusal(name: string): TeamHubFileRefusal | null {
  const segments = name.split("/");
  const base = segments[segments.length - 1];
  const folders = segments.slice(0, -1);
  if (base.startsWith("vbaproject")) return "macro_content";
  if (name.startsWith("xl/externallinks/")) return "external_content";
  if (folders.some((folder) => folder === "activex" || folder === "embeddings" || folder === "customui")) return "embedded_content";
  if (base.endsWith(".bin") && !PRINTER_SETTINGS.test(name)) return "embedded_content";
  return null;
}

/**
 * A part name as Office resolves it: percent-escapes decoded (part names are URIs, so
 * `activ%65X/` IS `activeX/`) and lower-cased. Null for a name no package may carry: one that does
 * not decode, or that uses a backslash or a leading slash, which a reader may treat as a separator.
 */
function partName(name: string): string | null {
  if (name.includes("\\") || name.startsWith("/")) return null;
  try {
    return decodeURIComponent(name).toLowerCase();
  } catch {
    return null;
  }
}

async function detectOfficeOpenXml(bytes: Uint8Array): Promise<Detection> {
  const entries = zipEntries(bytes);
  if (!entries) return { mime: null, reason: "malformed_document" };
  const decoded = entries.map((entry) => partName(entry.name));
  if (decoded.some((name) => name === null)) return { mime: null, reason: "malformed_document" };
  const lowered = decoded as string[];
  const named = new Set(lowered);
  // A macro project anywhere refuses the file. The central directory is the authority Office reads,
  // and the raw search also catches a name hidden in a local header the directory does not list.
  if (containsAscii(bytes, "vbaProject.bin")) return { mime: null, reason: "macro_content" };
  for (const name of lowered) {
    const reason = entryNameRefusal(name);
    if (reason) return { mime: null, reason };
  }
  if (!named.has("[content_types].xml")) return { mime: null, reason: "malformed_document" };
  const word = named.has("word/document.xml"), sheet = named.has("xl/workbook.xml");
  if (word === sheet) return { mime: null, reason: "malformed_document" };

  // The parts that can reach outside the file or run something: every relationships part, the
  // content-type map, and (for Word) every XML part under word/, where fields live.
  const inspected = entries.filter((_, index) => {
    const name = lowered[index];
    return name.endsWith(".rels") || name === "[content_types].xml" || (word && name.startsWith("word/") && name.endsWith(".xml"));
  });
  if (inspected.reduce((sum, entry) => sum + entry.size, 0) > TEAM_HUB_MAX_INFLATED_BYTES) {
    return { mime: null, reason: "oversized_document" };
  }
  const budget = { left: TEAM_HUB_MAX_INFLATED_BYTES };
  for (const entry of inspected) {
    const inflated = await inflateEntry(bytes, entry, budget);
    if (!inflated) return { mime: null, reason: "malformed_document" };
    const text = xmlText(inflated);
    // The packaging standard allows only UTF-8 and UTF-16. A part that declares anything else would
    // be read by Office in an encoding this check did not decode, so its markup is not what we saw.
    const declared = text === null ? null : /^\uFEFF?<\?xml\b[^>]*?\bencoding\s*=\s*["']([^"']*)["']/i.exec(text)?.[1];
    if (declared != null && !/^utf-(?:8|16(?:le|be)?)$/i.test(declared.trim())) return { mime: null, reason: "malformed_document" };
    const xml = text === null ? null : markupOnly(text);
    if (xml === null) return { mime: null, reason: "malformed_document" };
    const name = partName(entry.name)!;
    let reason: TeamHubFileRefusal | null = null;
    if (name === "[content_types].xml") {
      if (DTD.test(xml)) reason = "malformed_document";
      else if (/macroenabled|vbaproject/i.test(xml)) reason = "macro_content";
      else if (/activex|oleobject/i.test(xml)) reason = "embedded_content";
    } else if (name.endsWith(".rels")) {
      reason = relationshipsRefusal(xml);
    } else {
      reason = wordFieldRefusal(xml);
    }
    if (reason) return { mime: null, reason };
  }
  return { mime: word ? DOCX : XLSX, reason: null };
}

function isPlainText(bytes: Uint8Array): boolean {
  if (bytes.includes(0x00)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

/**
 * What the bytes really are. Binary signatures are checked first, so a PNG renamed .txt is a PNG.
 * Text is the one class bytes cannot split: plain text and CSV are both "valid UTF-8, no NUL", so
 * the declared MIME chooses between those two and nothing else.
 */
export async function detectTeamHubFileType(bytes: Uint8Array, declaredMime: string): Promise<Detection> {
  if (bytes.length === 0) return { mime: null, reason: "empty" };
  if (startsWith(bytes, PDF)) return { mime: "application/pdf", reason: null };
  if (startsWith(bytes, PNG)) return { mime: "image/png", reason: null };
  if (startsWith(bytes, JPEG)) return { mime: "image/jpeg", reason: null };
  if (startsWith(bytes, RIFF) && startsWith(bytes, WEBP, 8)) return { mime: "image/webp", reason: null };
  if (startsWith(bytes, GIF87) || startsWith(bytes, GIF89)) return { mime: "image/gif", reason: null };
  if (startsWith(bytes, OLE)) return { mime: null, reason: "legacy_office" };
  if (startsWith(bytes, ZIP_LOCAL)) return await detectOfficeOpenXml(bytes);
  if (isPlainText(bytes)) return { mime: declaredMime === "text/csv" ? "text/csv" : "text/plain", reason: null };
  return { mime: null, reason: "unrecognised" };
}

/** The verdict the edge function records: accept only when the real type equals the declared one. */
export async function teamHubFileVerdict(bytes: Uint8Array, declaredMime: string): Promise<TeamHubFileVerdict> {
  if (!(TEAM_HUB_FILE_MIMES as readonly string[]).includes(declaredMime)) {
    return { accept: false, detectedMime: null, reason: "not_allowed" };
  }
  if (bytes.length > TEAM_HUB_MAX_FILE_BYTES) return { accept: false, detectedMime: null, reason: "too_large" };
  const detected = await detectTeamHubFileType(bytes, declaredMime);
  if (!detected.mime) return { accept: false, detectedMime: null, reason: detected.reason ?? "unrecognised" };
  if (detected.mime !== declaredMime) return { accept: false, detectedMime: detected.mime, reason: "mismatch" };
  return { accept: true, detectedMime: detected.mime, reason: null };
}
