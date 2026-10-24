// node --test supabase/functions/_shared/team-hub-file-type.test.ts
// EXP08 Team Hub increment 3: the real-type check (contract §1 table, §8 unit tests).
// Every fixture is real bytes: the Office files are genuine ZIP archives written by the tiny writer
// below (stored and deflated entries, real CRC-32, central directory and end record), so the
// detector is exercised on the structure Office itself produces, not on a string that merely
// starts with "PK".
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import { detectTeamHubFileType, teamHubFileVerdict, zipEntryNames } from "./team-hub-file-type.ts";

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const text = (value: string) => new TextEncoder().encode(value);
const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) { out.set(part, at); at += part.length; }
  return out;
};

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes: Uint8Array) {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

type Entry = { name: string; data: string | Uint8Array; deflate?: boolean; hideFromDirectory?: boolean };

/** A real ZIP: local header + data per entry, then the central directory and the end record. */
function zip(entries: Entry[]): Uint8Array {
  const locals: Uint8Array[] = [], centrals: Uint8Array[] = [];
  let offset = 0, listed = 0;
  for (const entry of entries) {
    const name = text(entry.name);
    const raw = typeof entry.data === "string" ? text(entry.data) : entry.data;
    const body = entry.deflate ? new Uint8Array(deflateRawSync(raw)) : raw;
    const method = entry.deflate ? 8 : 0, crc = crc32(raw);
    const local = new Uint8Array(30 + name.length), lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(8, method, true);
    lv.setUint32(14, crc, true); lv.setUint32(18, body.length, true); lv.setUint32(22, raw.length, true);
    lv.setUint16(26, name.length, true); local.set(name, 30);
    if (!entry.hideFromDirectory) {
      const central = new Uint8Array(46 + name.length), cv = new DataView(central.buffer);
      cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true);
      cv.setUint16(10, method, true); cv.setUint32(16, crc, true); cv.setUint32(20, body.length, true);
      cv.setUint32(24, raw.length, true); cv.setUint16(28, name.length, true); cv.setUint32(42, offset, true);
      central.set(name, 46);
      centrals.push(central);
      listed++;
    }
    locals.push(local, body);
    offset += local.length + body.length;
  }
  const directory = concat(...centrals);
  const end = new Uint8Array(22), ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, listed, true); ev.setUint16(10, listed, true);
  ev.setUint32(12, directory.length, true); ev.setUint32(16, offset, true);
  return concat(...locals, directory, end);
}

const CONTENT_TYPES = '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>';
const RELS = '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>';
const docxEntries = (deflate = false): Entry[] => [
  { name: "[Content_Types].xml", data: CONTENT_TYPES, deflate },
  { name: "_rels/.rels", data: RELS, deflate },
  { name: "word/document.xml", data: '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Hello team</w:t></w:r></w:p></w:body></w:document>', deflate },
];
const xlsxEntries = (deflate = false): Entry[] => [
  { name: "[Content_Types].xml", data: CONTENT_TYPES, deflate },
  { name: "_rels/.rels", data: RELS, deflate },
  { name: "xl/workbook.xml", data: '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheets/></workbook>', deflate },
  { name: "xl/worksheets/sheet1.xml", data: '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"/>', deflate },
];
const VBA = new Uint8Array([0xcc, 0x61, 0xff, 0xff, 0x00, 0x00, 0x01, 0x00]);

const pdf = text("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n");
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]);
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]);
const webp = concat(text("RIFF"), new Uint8Array([26, 0, 0, 0]), text("WEBPVP8L"), new Uint8Array([13, 0, 0, 0, 0x2f, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
const gif87 = concat(text("GIF87a"), new Uint8Array([1, 0, 1, 0, 0, 0, 0, 0x3b]));
const gif89 = concat(text("GIF89a"), new Uint8Array([1, 0, 1, 0, 0, 0, 0, 0x3b]));
// The OLE compound-file header every legacy .doc/.xls begins with.
const ole = concat(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), new Uint8Array(504));
// A Windows executable's DOS header ("MZ", e_lfanew at 0x3c) followed by the PE signature.
const exe = (() => {
  const bytes = new Uint8Array(256);
  bytes.set([0x4d, 0x5a, 0x90, 0x00, 0x03], 0);
  bytes[0x3c] = 0x80;
  bytes.set([0x50, 0x45, 0x00, 0x00, 0x4c, 0x01], 0x80);
  return bytes;
})();

describe("allowed types are accepted when the bytes match the declared type", () => {
  const cases: Array<[string, Uint8Array, string]> = [
    ["PDF", pdf, "application/pdf"],
    ["PNG", png, "image/png"],
    ["JPEG", jpeg, "image/jpeg"],
    ["WEBP", webp, "image/webp"],
    ["GIF87a", gif87, "image/gif"],
    ["GIF89a", gif89, "image/gif"],
    ["Word (stored)", zip(docxEntries()), DOCX],
    ["Word (deflated)", zip(docxEntries(true)), DOCX],
    ["Excel (stored)", zip(xlsxEntries()), XLSX],
    ["Excel (deflated)", zip(xlsxEntries(true)), XLSX],
    ["text", text("Agenda for Monday\n- review the launch\n"), "text/plain"],
    ["text with a BOM and multibyte UTF-8", concat(new Uint8Array([0xef, 0xbb, 0xbf]), text("Café — 日本語 ✓\n")), "text/plain"],
    ["CSV", text("name,stage\nAva,Onboarding\n"), "text/csv"],
  ];
  for (const [label, bytes, mime] of cases) {
    it(label, () => {
      assert.deepEqual(teamHubFileVerdict(bytes, mime), { accept: true, detectedMime: mime, reason: null });
    });
  }
});

describe("refusals", () => {
  it("a Word file carrying a macro project is refused", () => {
    const bytes = zip([...docxEntries(true), { name: "word/vbaProject.bin", data: VBA }]);
    assert.deepEqual(teamHubFileVerdict(bytes, DOCX), { accept: false, detectedMime: null, reason: "macro_content" });
  });
  it("an Excel file carrying a macro project is refused, whatever the case of its name", () => {
    const bytes = zip([...xlsxEntries(), { name: "xl/VBAPROJECT.BIN", data: VBA, deflate: true }]);
    assert.equal(teamHubFileVerdict(bytes, XLSX).reason, "macro_content");
  });
  it("a macro project hidden from the central directory is still found", () => {
    const bytes = zip([...docxEntries(), { name: "word/vbaProject.bin", data: VBA, hideFromDirectory: true }]);
    assert.deepEqual(zipEntryNames(bytes), ["[Content_Types].xml", "_rels/.rels", "word/document.xml"]);
    assert.equal(teamHubFileVerdict(bytes, DOCX).reason, "macro_content");
  });
  it("a legacy OLE .doc is refused even when it claims to be Word", () => {
    assert.deepEqual(teamHubFileVerdict(ole, DOCX), { accept: false, detectedMime: null, reason: "legacy_office" });
  });
  it("an executable named .pdf is refused", () => {
    assert.deepEqual(teamHubFileVerdict(exe, "application/pdf"), { accept: false, detectedMime: null, reason: "unrecognised" });
  });
  it("text containing a NUL byte is not text", () => {
    assert.equal(teamHubFileVerdict(text("line one\u0000line two"), "text/plain").reason, "unrecognised");
  });
  it("invalid UTF-8 is not text", () => {
    assert.equal(teamHubFileVerdict(new Uint8Array([0x68, 0x69, 0xc3, 0x28, 0x0a]), "text/csv").reason, "unrecognised");
  });
  it("a real type that differs from the declared one is a mismatch", () => {
    assert.deepEqual(teamHubFileVerdict(png, "text/plain"), { accept: false, detectedMime: "image/png", reason: "mismatch" });
    assert.deepEqual(teamHubFileVerdict(zip(docxEntries()), XLSX), { accept: false, detectedMime: DOCX, reason: "mismatch" });
    assert.deepEqual(teamHubFileVerdict(pdf, "image/jpeg"), { accept: false, detectedMime: "application/pdf", reason: "mismatch" });
  });
  it("a ZIP that is not a Word or Excel document is refused", () => {
    assert.equal(teamHubFileVerdict(zip([{ name: "notes.txt", data: "hi" }]), DOCX).reason, "malformed_document");
    assert.equal(teamHubFileVerdict(zip([{ name: "[Content_Types].xml", data: CONTENT_TYPES }]), DOCX).reason, "malformed_document");
  });
  it("an OOXML package without [Content_Types].xml is refused", () => {
    const bytes = zip(docxEntries().filter((entry) => entry.name !== "[Content_Types].xml"));
    assert.equal(teamHubFileVerdict(bytes, DOCX).reason, "malformed_document");
  });
  it("a package claiming to be both Word and Excel is refused", () => {
    const bytes = zip([...docxEntries(), { name: "xl/workbook.xml", data: "<workbook/>" }]);
    assert.equal(teamHubFileVerdict(bytes, DOCX).reason, "malformed_document");
  });
  it("a truncated ZIP is refused", () => {
    const whole = zip(docxEntries());
    assert.equal(teamHubFileVerdict(whole.subarray(0, whole.length - 30), DOCX).reason, "malformed_document");
    assert.equal(zipEntryNames(whole.subarray(0, whole.length - 30)), null);
  });
  it("a RIFF container that is not WEBP is refused", () => {
    const wave = concat(text("RIFF"), new Uint8Array([4, 0, 0, 0]), text("WAVEfmt "));
    assert.equal(teamHubFileVerdict(wave, "image/webp").reason, "unrecognised");
  });
  it("a declared type outside the allow-list is refused before the bytes are read", () => {
    for (const mime of ["application/msword", "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation", "application/zip", "text/html", ""]) {
      assert.deepEqual(teamHubFileVerdict(pdf, mime), { accept: false, detectedMime: null, reason: "not_allowed" });
    }
  });
  it("an empty file is refused", () => {
    assert.equal(teamHubFileVerdict(new Uint8Array(0), "text/plain").reason, "empty");
  });
  it("a file over 10 MB is refused", () => {
    const big = new Uint8Array(10 * 1024 * 1024 + 1).fill(0x61);
    assert.equal(teamHubFileVerdict(big, "text/plain").reason, "too_large");
    assert.equal(teamHubFileVerdict(big.subarray(0, 10 * 1024 * 1024), "text/plain").accept, true);
  });
});

describe("text is the one class the declared type splits", () => {
  it("plain text and CSV are both text, and nothing else", () => {
    const bytes = text("a,b\n1,2\n");
    assert.equal(detectTeamHubFileType(bytes, "text/csv").mime, "text/csv");
    assert.equal(detectTeamHubFileType(bytes, "text/plain").mime, "text/plain");
    assert.equal(detectTeamHubFileType(bytes, "application/pdf").mime, "text/plain");
  });
  it("binary signatures win over text, so a renamed image is never text", () => {
    assert.equal(detectTeamHubFileType(gif89, "text/plain").mime, "image/gif");
  });
});
