// @vitest-environment node
// INT-328 — files a governed email carries: the request parser (server tenant only), what a file may
// be (signature + extension + type), the size limits, the manifest's strict re-parse, the card's words,
// and the three storage steps (read + hash, copy-on-approve, re-check at send) over an in-memory bucket.
import { describe, expect, it } from "vitest";
import {
  parseCommsEmailAttachmentRequest, commsEmailAttachmentName, commsEmailGovernedAttachmentPath,
  COMMS_EMAIL_ATTACHMENT_MAX_BYTES, COMMS_EMAIL_ATTACHMENTS_TOTAL_MAX_BYTES,
} from "../../supabase/functions/_shared/comms-email/contract";
import {
  commsEmailAttachmentMatches, canonicalCommsEmailAttachmentMime, parseCommsEmailAttachmentManifest, commsEmailManifestsEqual,
  commsEmailAttachmentPreview, commsEmailAttachmentSummary, readCommsEmailAttachmentSources, copyCommsEmailAttachmentsToGoverned,
  readGovernedCommsEmailAttachments, commsEmailSha256Hex, commsEmailBase64, commsEmailManifestDigest, type CommsEmailStorage,
} from "../../supabase/functions/_shared/comms-email/attachments";
import { parseConfirmPreview, formatFileSize } from "@/components/chat/confirmPreview";
import { governedAttachmentRequest } from "@/pages/admin/conversations/governedSend";

const T = "10000000-0000-4000-8000-000000000001";
const F = "10000000-0000-4000-8000-000000000002";
const OP = "20000000-0000-4000-8000-000000000001";
const U = "90000000-0000-4000-8000-000000000001";
const enc = (s: string) => new TextEncoder().encode(s);
const PDF = enc("%PDF-1.4\n%%EOF\n");
const sig = (...b: number[]) => new Uint8Array([...b, 1, 2, 3, 4, 5, 6, 7, 8]);
// A real (empty-entry, stored) ZIP: local headers, the central directory every Office reader uses, and
// the end-of-central-directory record pointing at it.
function zip(names: string[]): Uint8Array {
  const out: number[] = [], central: number[] = [], offsets: number[] = [];
  const u16 = (n: number) => [n & 255, (n >> 8) & 255], u32 = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
  for (const name of names) {
    const nb = [...enc(name)];
    offsets.push(out.length);
    out.push(...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(0), ...u32(0), ...u16(nb.length), ...u16(0), ...nb);
  }
  const cdStart = out.length;
  names.forEach((name, i) => {
    const nb = [...enc(name)];
    central.push(...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(0), ...u32(0),
      ...u16(nb.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offsets[i]), ...nb);
  });
  out.push(...central, ...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(names.length), ...u16(names.length), ...u32(central.length), ...u32(cdStart), ...u16(0));
  return new Uint8Array(out);
}
const OLE_SIG = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const oleWith = (stream: string) => new Uint8Array([...OLE_SIG, ...new Array(64).fill(0), ...[...stream].flatMap((c) => [c.charCodeAt(0), 0]), 0, 0]);

describe("parseCommsEmailAttachmentRequest", () => {
  it("takes 1..10 composer paths of the server tenant, in order", () => {
    expect(parseCommsEmailAttachmentRequest([{ path: `${T}/${U}-a.pdf` }, { path: `${T}/${U.replace(/1$/, "2")}-b_c.png` }], T))
      .toEqual([`${T}/${U}-a.pdf`, `${T}/${U.replace(/1$/, "2")}-b_c.png`]);
  });
  it("refuses another tenant, other folders, traversal, encoding, repeats, extra keys and bad counts", () => {
    const bad: unknown[] = [
      [{ path: `${F}/${U}-a.pdf` }], [{ path: `${T}/team-hub/${U}-a.pdf` }], [{ path: `${T}/governed/${OP}/1-a.pdf` }],
      [{ path: `${T}/${U}-..a.pdf` }], [{ path: `${T}/${U}-a%20b.pdf` }], [{ path: `${T}\\${U}-a.pdf` }], [{ path: `${T}/${U}-a b.pdf` }],
      [{ path: `${T}/${U}-` }], [{ path: `${T}/${U}-${"x".repeat(121)}` }], [{ path: `${T}/${U}-a.pdf` }, { path: `${T}/${U}-a.pdf` }],
      [{ path: `${T}/${U}-a.pdf`, mime: "application/pdf" }], [{ url: `${T}/${U}-a.pdf` }], [], [`${T}/${U}-a.pdf`], null, {},
      Array.from({ length: 11 }, (_, i) => ({ path: `${T}/${U.slice(0, -2)}${String(i).padStart(2, "0")}-a.pdf` })),
      [{ path: `${T}/AAAAAAAA-0000-4000-8000-000000000001-a.pdf` }],
    ];
    for (const v of bad) expect(() => parseCommsEmailAttachmentRequest(v, T), JSON.stringify(v)).toThrow("COMMS_EMAIL_ATTACHMENTS_INVALID");
    expect(() => parseCommsEmailAttachmentRequest([{ path: `${T}/${U}-a.pdf` }], "not-a-tenant")).toThrow("COMMS_EMAIL_ATTACHMENTS_INVALID");
  });
  it("names the file and its governed copy deterministically", () => {
    expect(commsEmailAttachmentName(`${T}/${U}-My_File.v2.pdf`)).toBe("My_File.v2.pdf");
    expect(commsEmailGovernedAttachmentPath(T, OP, 0, "a.pdf")).toBe(`${T}/governed/${OP}/1-a.pdf`);
  });
});

describe("what a file may be: type, signature and extension together", () => {
  it("accepts each known type only with its own signature and extension", () => {
    const ok: [Uint8Array, string, string][] = [
      [PDF, "application/pdf", "a.pdf"], [sig(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), "image/png", "a.png"],
      [sig(0xff, 0xd8, 0xff, 0xe0), "image/jpeg", "a.jpeg"], [sig(0xff, 0xd8, 0xff, 0xe1), "image/jpeg", "a.JPG"],
      [enc("GIF89a......"), "image/gif", "a.gif"], [enc("RIFF\u0000\u0000\u0000\u0000WEBPVP8 "), "image/webp", "a.webp"],
      [zip(["[Content_Types].xml", "_rels/.rels", "word/document.xml"]), "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "a.docx"],
      [zip(["[Content_Types].xml", "xl/workbook.xml"]), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "a.xlsx"],
      [oleWith("WordDocument"), "application/msword", "a.doc"],
      [oleWith("Workbook"), "application/vnd.ms-excel", "a.xls"], [oleWith("Book"), "application/vnd.ms-excel", "a.xls"],
      [enc("\uFEFFname,amount\n<b>,1\n"), "text/csv", "a.csv"],
      [enc("hello, world — café"), "text/plain", "a.txt"], [enc("a,b\n1,2\n"), "text/csv", "a.csv"],
    ];
    for (const [b, m, n] of ok) expect(commsEmailAttachmentMatches(b, m, n), `${m} ${n}`).toBe(true);
  });
  it("refuses a disguised file, a wrong extension, broken text, a NUL and an unknown type", () => {
    const no: [Uint8Array, string, string][] = [
      [sig(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), "application/pdf", "a.pdf"], [PDF, "application/pdf", "a.png"],
      [PDF, "application/pdf", "pdf"], [enc("RIFF\u0000\u0000\u0000\u0000AVI "), "image/webp", "a.webp"],
      [new Uint8Array([0x61, 0xff, 0xfe]), "text/plain", "a.txt"], [new Uint8Array([0x61, 0x00, 0x62]), "text/csv", "a.csv"],
      [enc("MZ\u0090"), "application/x-msdownload", "a.exe"], [enc("<svg/>"), "image/svg+xml", "a.svg"],
      [sig(0x50, 0x4b, 0x03, 0x04), "application/msword", "a.doc"],
      // An Office file must really be one: a bare ZIP signature, a ZIP with no content-types part, a Word
      // package called a spreadsheet, a compound file without the document's own stream (an installer).
      [sig(0x50, 0x4b, 0x03, 0x04), "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "a.docx"],
      [zip(["word/document.xml"]), "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "a.docx"],
      [zip(["[Content_Types].xml", "word/document.xml"]), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "a.xlsx"],
      [sig(...OLE_SIG), "application/msword", "a.doc"], [oleWith("Workbook"), "application/msword", "a.doc"], [oleWith("WordDocument"), "application/vnd.ms-excel", "a.xls"],
      [oleWith("WordDocument"), "application/msword", "a.msi"],
      // Text that is really markup is not a text file.
      [enc("<!DOCTYPE html><p>hi"), "text/plain", "a.txt"], [enc("  \n<html>"), "text/plain", "a.txt"], [enc("\uFEFF<svg onload=x>"), "text/csv", "a.csv"], [enc("<?xml version='1.0'?>"), "text/plain", "a.txt"],
    ];
    for (const [b, m, n] of no) expect(commsEmailAttachmentMatches(b, m, n), `${m} ${n}`).toBe(false);
  });
  it("reads image/jpg as JPEG and ignores a type's parameters", () => {
    expect(canonicalCommsEmailAttachmentMime("image/jpg")).toBe("image/jpeg");
    expect(canonicalCommsEmailAttachmentMime("Text/Plain; charset=UTF-8")).toBe("text/plain");
  });
});

const entry = async (i: number, name: string, bytes: Uint8Array, mime = "application/pdf") => ({
  path: `${T}/governed/${OP}/${i + 1}-${name}`, source_path: `${T}/${U.slice(0, -1)}${i}-${name}`, name, mime, size: bytes.length, sha256: await commsEmailSha256Hex(bytes),
});

describe("the manifest, strictly", () => {
  it("re-parses a manifest of this tenant and operation into canonical key order", async () => {
    const e = await entry(0, "a.pdf", PDF);
    const shuffled = { sha256: e.sha256, size: e.size, mime: e.mime, name: e.name, source_path: e.source_path, path: e.path };
    const parsed = parseCommsEmailAttachmentManifest([shuffled], T, OP);
    expect(parsed).toEqual([e]);
    expect(Object.keys(parsed![0])).toEqual(["path", "source_path", "name", "mime", "size", "sha256"]);
    expect(commsEmailManifestsEqual(parsed, [e])).toBe(true);
  });
  it("refuses another tenant's or operation's copy, a renumbered file, an extra key, a bad hash or size, and totals over 10 MiB", async () => {
    const e = await entry(0, "a.pdf", PDF);
    const cases: unknown[] = [
      [{ ...e, path: e.path.replace(T, F) }], [{ ...e, path: e.path.replace(OP, OP.replace(/1$/, "9")) }], [{ ...e, path: `${T}/governed/${OP}/2-a.pdf` }],
      [{ ...e, source_path: e.source_path.replace(T, F) }], [{ ...e, name: "b.pdf" }], [{ ...e, extra: 1 }], [{ ...e, sha256: "ABC" }],
      [{ ...e, size: 0 }], [{ ...e, size: COMMS_EMAIL_ATTACHMENT_MAX_BYTES + 1 }], [{ ...e, size: 1.5 }], [{ ...e, mime: "image/svg+xml" }], [], null,
    ];
    for (const c of cases) expect(parseCommsEmailAttachmentManifest(c, T, OP), JSON.stringify(c)).toBeNull();
    const two = [await entry(0, "a.pdf", PDF), await entry(1, "b.pdf", PDF)].map((x) => ({ ...x, size: COMMS_EMAIL_ATTACHMENT_MAX_BYTES }));
    expect(2 * COMMS_EMAIL_ATTACHMENT_MAX_BYTES).toBeGreaterThan(COMMS_EMAIL_ATTACHMENTS_TOTAL_MAX_BYTES);
    expect(parseCommsEmailAttachmentManifest(two, T, OP)).toBeNull();
    // 10 MiB together (raw; ~14 MB once base64-encoded): two 6 MiB files are over, one 10 MiB file is not.
    expect(COMMS_EMAIL_ATTACHMENTS_TOTAL_MAX_BYTES).toBe(10 * 1024 * 1024);
    const six = [await entry(0, "a.pdf", PDF), await entry(1, "b.pdf", PDF)].map((x) => ({ ...x, size: 6 * 1024 * 1024 }));
    expect(parseCommsEmailAttachmentManifest(six, T, OP)).toBeNull();
    expect(parseCommsEmailAttachmentManifest([{ ...(await entry(0, "a.pdf", PDF)), size: 10 * 1024 * 1024 }], T, OP)).not.toBeNull();
  });
  it("two manifests are one approval only when every field of every file, in order, is equal", async () => {
    const a = await entry(0, "a.pdf", PDF);
    expect(commsEmailManifestsEqual(null, undefined)).toBe(true);
    expect(commsEmailManifestsEqual([a], null)).toBe(false);
    expect(commsEmailManifestsEqual([a], [{ ...a, sha256: "0".repeat(64) }])).toBe(false);
  });
  it("the card shows each file's name, size and type, and the summary names them", async () => {
    const m = [await entry(0, "a.pdf", PDF), await entry(1, "b.pdf", PDF)];
    expect(commsEmailAttachmentPreview(m)).toEqual([{ name: "a.pdf", size: PDF.length, mime: "application/pdf" }, { name: "b.pdf", size: PDF.length, mime: "application/pdf" }]);
    expect(commsEmailAttachmentSummary(m)).toBe(" — with 2 files: a.pdf, b.pdf");
    expect(commsEmailAttachmentSummary(m.slice(0, 1))).toBe(" — with 1 file: a.pdf");
  });
  it("the browser's confirm-card gate keeps a well-formed file list and drops anything else", () => {
    const base = { to_address: "a@b.test", from_address: "c@d.test", subject: "S", body_text: "B" };
    expect(parseConfirmPreview({ ...base, attachments: [{ name: "a.pdf", size: 10, mime: "application/pdf" }] })?.attachments).toEqual([{ name: "a.pdf", size: 10, mime: "application/pdf" }]);
    for (const bad of [[{ name: "", size: 10, mime: "x" }], [{ name: "a", size: -1, mime: "x" }], "a.pdf", [null], Array.from({ length: 11 }, () => ({ name: "a", size: 1, mime: "x" }))]) {
      const p = parseConfirmPreview({ ...base, attachments: bad });
      expect(p, JSON.stringify(bad)).toBeDefined();
      expect(p).not.toHaveProperty("attachments");
    }
  });
});

function bucket(initial: Record<string, { bytes: Uint8Array; type: string }>, opts: { types?: string[] | null } = {}) {
  const objects = new Map(Object.entries(initial));
  const calls: string[] = [];
  const storage: CommsEmailStorage = {
    getBucket: async () => ({ data: { allowed_mime_types: opts.types === undefined ? ["application/pdf", "image/png"] : opts.types }, error: null }),
    from: () => ({
      download: async (p: string) => { calls.push(`download ${p}`); const o = objects.get(p); return o ? { data: new Blob([o.bytes], { type: o.type }), error: null } : { data: null, error: { message: "not found" } }; },
      upload: async (p: string, body: Uint8Array | Blob, o: { contentType: string; upsert: boolean }) => {
        calls.push(`upload ${p} upsert=${o.upsert}`);
        if (objects.has(p) && !o.upsert) return { data: null, error: { statusCode: "409" } };
        objects.set(p, { bytes: body as Uint8Array, type: o.contentType }); return { data: { path: p }, error: null };
      },
    }),
  };
  return { storage, objects, calls };
}

describe("reading, copying and re-checking the bytes", () => {
  const src = `${T}/${U}-a.pdf`;
  it("reads, checks and hashes each file; the total is bounded", async () => {
    const b = bucket({ [src]: { bytes: PDF, type: "application/pdf" } });
    const r = await readCommsEmailAttachmentSources(b.storage, { tenantId: T, operationId: OP, paths: [src] });
    expect(r).toMatchObject({ ok: true, manifest: [{ path: `${T}/governed/${OP}/1-a.pdf`, source_path: src, name: "a.pdf", mime: "application/pdf", size: PDF.length, sha256: await commsEmailSha256Hex(PDF) }] });
    const big = new Uint8Array(8 * 1024 * 1024); big.set(PDF);
    const paths = [0, 1].map((i) => `${T}/${U.slice(0, -1)}${i}-f${i}.pdf`);
    const two = bucket(Object.fromEntries(paths.map((p) => [p, { bytes: big, type: "application/pdf" }])));
    expect(await readCommsEmailAttachmentSources(two.storage, { tenantId: T, operationId: OP, paths })).toEqual({ ok: false, code: "COMMS_EMAIL_ATTACHMENTS_TOO_LARGE" });
  });
  it("a type outside the bucket's live allowlist is refused; a bucket with no allowlist still needs a known type", async () => {
    const txt = `${T}/${U}-a.txt`;
    expect(await readCommsEmailAttachmentSources(bucket({ [txt]: { bytes: enc("hi"), type: "text/plain" } }).storage, { tenantId: T, operationId: OP, paths: [txt] }))
      .toEqual({ ok: false, code: "COMMS_EMAIL_ATTACHMENT_TYPE_REFUSED" });
    expect(await readCommsEmailAttachmentSources(bucket({ [txt]: { bytes: enc("hi"), type: "text/plain" } }, { types: null }).storage, { tenantId: T, operationId: OP, paths: [txt] }))
      .toMatchObject({ ok: true });
  });
  it("copy-on-approve never overwrites; an existing copy counts only with the same bytes", async () => {
    const e = { ...(await entry(0, "a.pdf", PDF)), source_path: src };
    const fresh = bucket({});
    expect(await copyCommsEmailAttachmentsToGoverned(fresh.storage, [{ entry: e, bytes: PDF }])).toEqual({ ok: true });
    expect(fresh.calls).toEqual([`upload ${e.path} upsert=false`]);
    const replay = bucket({ [e.path]: { bytes: PDF, type: "application/pdf" } });
    expect(await copyCommsEmailAttachmentsToGoverned(replay.storage, [{ entry: e, bytes: PDF }])).toEqual({ ok: true });
    const planted = bucket({ [e.path]: { bytes: enc("%PDF-planted"), type: "application/pdf" } });
    expect(await copyCommsEmailAttachmentsToGoverned(planted.storage, [{ entry: e, bytes: PDF }])).toEqual({ ok: false, code: "COMMS_EMAIL_ATTACHMENT_CHANGED" });
    expect(await copyCommsEmailAttachmentsToGoverned(bucket({}).storage, [{ entry: e, bytes: enc("%PDF-other") }])).toEqual({ ok: false, code: "COMMS_EMAIL_ATTACHMENT_CHANGED" });
  });
  it("at send, every governed copy must be the approved bytes; the result is exactly what SendGrid receives", async () => {
    const e = await entry(0, "a.pdf", PDF);
    expect(await readGovernedCommsEmailAttachments(bucket({ [e.path]: { bytes: PDF, type: "application/pdf" } }).storage, [e]))
      .toEqual({ ok: true, files: [{ content: commsEmailBase64(PDF), filename: "a.pdf", type: "application/pdf" }] });
    expect(commsEmailBase64(PDF)).toBe(Buffer.from(PDF).toString("base64"));
    expect(await readGovernedCommsEmailAttachments(bucket({}).storage, [e])).toEqual({ ok: false, code: "COMMS_EMAIL_ATTACHMENT_CHANGED" });
    expect(await readGovernedCommsEmailAttachments(bucket({ [e.path]: { bytes: enc("%PDF-x"), type: "application/pdf" } }).storage, [e])).toEqual({ ok: false, code: "COMMS_EMAIL_ATTACHMENT_CHANGED" });
  });
});

describe("governedAttachmentRequest — what the composer will hand the door", () => {
  it("maps staged uploads to the door's request with the door's own parser, and names what cannot go", () => {
    const ok1 = { url: `${T}/${U}-a.pdf`, name: "a.pdf", mime: "application/pdf", size: 3 };
    const r = governedAttachmentRequest(T, [ok1, { url: `${F}/${U}-x.pdf`, name: "x.pdf" }, { url: `${T}/team-hub/${U}-y.pdf`, name: "y.pdf" }, ok1, { name: "no-path.pdf" }]);
    expect(r).toEqual({ attachments: [{ path: `${T}/${U}-a.pdf` }], refused: ["x.pdf", "y.pdf", "a.pdf", "no-path.pdf"] });
    const many = Array.from({ length: 11 }, (_, i) => ({ url: `${T}/${U.slice(0, -2)}${String(i).padStart(2, "0")}-f.pdf`, name: `f${i}.pdf` }));
    expect(governedAttachmentRequest(T, many)).toMatchObject({ refused: ["f10.pdf"] });
    expect(governedAttachmentRequest(T, many).attachments).toHaveLength(10);
  });
});

describe("review round 2 — sizes, the digest and parallel reads", () => {
  it("a file's size reads the way a person says it", () => {
    expect([1, 820, 1024, 1536, 48 * 1024, 1024 * 1024 - 1, 1024 * 1024, 2.4 * 1024 * 1024, 10 * 1024 * 1024].map(formatFileSize))
      .toEqual(["1 byte", "820 bytes", "1 KB", "2 KB", "48 KB", "1024 KB", "1 MB", "2.4 MB", "10 MB"]);
  });
  it("the manifest digest is the sha256 of its canonical text: key order cannot change it, any field does", async () => {
    const e = await entry(0, "a.pdf", PDF);
    const shuffled = { sha256: e.sha256, size: e.size, mime: e.mime, name: e.name, source_path: e.source_path, path: e.path };
    expect(await commsEmailManifestDigest([shuffled])).toBe(await commsEmailManifestDigest([e]));
    expect(await commsEmailManifestDigest([{ ...e, size: e.size + 1 }])).not.toBe(await commsEmailManifestDigest([e]));
    expect(await commsEmailManifestDigest([e])).toMatch(/^[0-9a-f]{64}$/);
  });
  it("send-time reads of the governed copies run in parallel, and still refuse on any one changed", async () => {
    const m = [await entry(0, "a.pdf", PDF), await entry(1, "b.pdf", PDF), await entry(2, "c.pdf", PDF)];
    let inFlight = 0, peak = 0;
    const storage: CommsEmailStorage = {
      getBucket: async () => ({ data: null, error: null }),
      from: () => ({
        download: async () => { inFlight++; peak = Math.max(peak, inFlight); await new Promise((r) => setTimeout(r, 5)); inFlight--; return { data: new Blob([PDF], { type: "application/pdf" }), error: null }; },
        upload: async () => ({ data: null, error: null }),
      }),
    };
    expect(await readGovernedCommsEmailAttachments(storage, m)).toMatchObject({ ok: true });
    expect(peak).toBe(3);
    expect(await readGovernedCommsEmailAttachments(storage, [...m.slice(0, 2), { ...m[2], sha256: "0".repeat(64) }])).toEqual({ ok: false, code: "COMMS_EMAIL_ATTACHMENT_CHANGED" });
  });
});
