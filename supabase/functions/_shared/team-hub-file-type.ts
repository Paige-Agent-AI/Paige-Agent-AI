// EXP08 Team Hub increment 3: the real-type check for an attached file.
// Contract: docs/delivery/exp08-team-hub-increment3-attachments-contract.md §1 (allowed types) and §5.
//
// Files are NOT scanned for malware. What makes that acceptable is this check: only nine safe
// types are admitted, and each must be what its bytes say it is, not what its name or the
// browser's declared MIME claims. Pure by construction: bytes in, verdict out. No I/O, no Deno or
// Node globals beyond TextDecoder, so the same module runs in the edge function and under test.
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

/**
 * Entry names from a ZIP's central directory, or null when the archive is not one well-formed,
 * single-disk, non-ZIP64 archive whose directory lies inside the bytes. Names are stored
 * uncompressed, so no inflate is needed. A 10 MB cap means ZIP64 is never legitimate here.
 */
export function zipEntryNames(bytes: Uint8Array): string[] | null {
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
  const names: string[] = [];
  let at = offset;
  for (let index = 0; index < total; index++) {
    if (at + 46 > offset + size || u32(bytes, at) !== CENTRAL) return null;
    const nameLength = u16(bytes, at + 28), extraLength = u16(bytes, at + 30), commentLength = u16(bytes, at + 32);
    const local = u32(bytes, at + 42);
    if (at + 46 + nameLength > offset + size || !startsWith(bytes, ZIP_LOCAL, local)) return null;
    try {
      names.push(decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength)));
    } catch {
      return null;
    }
    at += 46 + nameLength + extraLength + commentLength;
  }
  return at === offset + size ? names : null;
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

function detectOfficeOpenXml(bytes: Uint8Array): Detection {
  const names = zipEntryNames(bytes);
  if (!names) return { mime: null, reason: "malformed_document" };
  const lowered = new Set(names.map((name) => name.toLowerCase()));
  // A macro project anywhere refuses the file. The central directory is the authority Office reads,
  // and the raw search also catches a name hidden in a local header the directory does not list.
  if ([...lowered].some((name) => name === "vbaproject.bin" || name.endsWith("/vbaproject.bin")) ||
      containsAscii(bytes, "vbaProject.bin")) {
    return { mime: null, reason: "macro_content" };
  }
  if (!lowered.has("[content_types].xml")) return { mime: null, reason: "malformed_document" };
  const word = lowered.has("word/document.xml"), sheet = lowered.has("xl/workbook.xml");
  if (word && !sheet) return { mime: DOCX, reason: null };
  if (sheet && !word) return { mime: XLSX, reason: null };
  return { mime: null, reason: "malformed_document" };
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
export function detectTeamHubFileType(bytes: Uint8Array, declaredMime: string): Detection {
  if (bytes.length === 0) return { mime: null, reason: "empty" };
  if (startsWith(bytes, PDF)) return { mime: "application/pdf", reason: null };
  if (startsWith(bytes, PNG)) return { mime: "image/png", reason: null };
  if (startsWith(bytes, JPEG)) return { mime: "image/jpeg", reason: null };
  if (startsWith(bytes, RIFF) && startsWith(bytes, WEBP, 8)) return { mime: "image/webp", reason: null };
  if (startsWith(bytes, GIF87) || startsWith(bytes, GIF89)) return { mime: "image/gif", reason: null };
  if (startsWith(bytes, OLE)) return { mime: null, reason: "legacy_office" };
  if (startsWith(bytes, ZIP_LOCAL)) return detectOfficeOpenXml(bytes);
  if (isPlainText(bytes)) return { mime: declaredMime === "text/csv" ? "text/csv" : "text/plain", reason: null };
  return { mime: null, reason: "unrecognised" };
}

/** The verdict the edge function records: accept only when the real type equals the declared one. */
export function teamHubFileVerdict(bytes: Uint8Array, declaredMime: string): TeamHubFileVerdict {
  if (!(TEAM_HUB_FILE_MIMES as readonly string[]).includes(declaredMime)) {
    return { accept: false, detectedMime: null, reason: "not_allowed" };
  }
  if (bytes.length > TEAM_HUB_MAX_FILE_BYTES) return { accept: false, detectedMime: null, reason: "too_large" };
  const detected = detectTeamHubFileType(bytes, declaredMime);
  if (!detected.mime) return { accept: false, detectedMime: null, reason: detected.reason ?? "unrecognised" };
  if (detected.mime !== declaredMime) return { accept: false, detectedMime: detected.mime, reason: "mismatch" };
  return { accept: true, detectedMime: detected.mime, reason: null };
}
