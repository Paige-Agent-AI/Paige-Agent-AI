import {Inflate} from "npm:fflate@0.8.2";
import {DOMParser} from "npm:@xmldom/xmldom@0.8.15";

const WORD = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const MAX_XML = 1024 * 1024;
const MAX_ENTRIES = 256;
const UTF8 = new TextDecoder("utf-8", {fatal: true});
export class CustomerDocxError extends Error {
  constructor(readonly code: "invalid_document" | "processing_limit" | "interrupted") {super(code);}
}
function refuse(code: CustomerDocxError["code"]): never {throw new CustomerDocxError(code);}
type Member = {offset: number; compressed: number; size: number; crc: number; method: number};

/** Locate one unambiguous original body; never unpack other archive members or
 * resolve relationships, links, external objects, macros, headers or notes.
 * Native caller-JWT/immutable-object authorization stays in the original loader.
 */
function bodyMember(bytes: Uint8Array): Member {
  if (bytes.length < 22) refuse("invalid_document");
  if (bytes.length > 20971520) refuse("processing_limit");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (n: number) => view.getUint16(n, true), u32 = (n: number) => view.getUint32(n, true);
  let end = -1;
  for (let n = bytes.length - 22; n >= Math.max(0, bytes.length - 65557); n--) {
    if (u32(n) === 0x06054b50 && n + 22 + u16(n + 20) === bytes.length) {end = n; break;}
  }
  if (end < 0 || u16(end + 4) !== 0 || u16(end + 6) !== 0) refuse("invalid_document");
  const count = u16(end + 10), centralSize = u32(end + 12), central = u32(end + 16);
  if (count < 1 || count !== u16(end + 8) || central + centralSize !== end) refuse("invalid_document");
  if (count > MAX_ENTRIES || centralSize > 524288) refuse("processing_limit");
  const names = new Set<string>(), ranges: Array<[number, number]> = [];
  let at = central, body: Member | null = null;
  const extra = (start: number, length: number) => {
    const limit = start + length;
    while (start < limit) {
      if (start + 4 > limit) refuse("invalid_document");
      const kind = u16(start), size = u16(start + 2); start += 4;
      // ZIP64/AES/alternate path names are not interpreted by this bounded reader.
      if ([0x0001, 0x9901, 0x7075].includes(kind) || start + size > limit) refuse("invalid_document");
      start += size;
    }
  };
  for (let index = 0; index < count; index++) {
    if (at + 46 > end || u32(at) !== 0x02014b50) refuse("invalid_document");
    const flags = u16(at + 8), method = u16(at + 10), crc = u32(at + 16);
    const compressed = u32(at + 20), size = u32(at + 24), nameLength = u16(at + 28);
    const extraLength = u16(at + 30), commentLength = u16(at + 32), local = u32(at + 42);
    const next = at + 46 + nameLength + extraLength + commentLength;
    if (next > end || u16(at + 34) !== 0 || !nameLength || nameLength > 512
      || (flags & ~(method === 8 ? 0x080e : 0x0808)) !== 0 || ![0, 8].includes(method)) refuse("invalid_document");
    const name = UTF8.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    if (name.startsWith("/") || name.includes("\\") || Array.from(name).some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)
      || name.split("/").some(part => part === "." || part === "..")
      || names.has(name)) refuse("invalid_document");
    names.add(name); extra(at + 46 + nameLength, extraLength);
    if (local + 30 > central || u32(local) !== 0x04034b50 || u16(local + 6) !== flags
      || u16(local + 8) !== method || u16(local + 26) !== nameLength) refuse("invalid_document");
    const localExtra = u16(local + 28), start = local + 30 + nameLength + localExtra;
    if (start > central || UTF8.decode(bytes.subarray(local + 30, local + 30 + nameLength)) !== name
      || start + compressed > central) refuse("invalid_document");
    extra(local + 30 + nameLength, localExtra);
    let finish = start + compressed;
    if (flags & 8) {
      const descriptor = finish + 4 <= central && u32(finish) === 0x08074b50 ? finish + 4 : finish;
      if (descriptor + 12 > central || u32(descriptor) !== crc || u32(descriptor + 4) !== compressed
        || u32(descriptor + 8) !== size) refuse("invalid_document");
      finish = descriptor + 12;
    } else if (u32(local + 14) !== crc || u32(local + 18) !== compressed || u32(local + 22) !== size) {
      refuse("invalid_document");
    }
    if (ranges.some(([left, right]) => local < right && finish > left)) refuse("invalid_document");
    ranges.push([local, finish]);
    if (name === "word/document.xml") body = {offset: start, compressed, size, crc, method};
    at = next;
  }
  if (at !== end || !body) refuse("invalid_document");
  if (body.size < 1) refuse("invalid_document");
  if (body.size > MAX_XML || body.compressed > 2 * MAX_XML + 4096) refuse("processing_limit");
  return body;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let n = 0; n < 8; n++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Bound the input before giving it to the existing XML parser. Reject DTDs,
 * entities, processing instructions, excessive nesting/tags and ambiguous edits.
 * No DOM/HTML is ever returned to a browser or used as an authority source.
 */
function xmlPreflight(xml: string) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) refuse("invalid_document");
  for (const char of xml) if (char.charCodeAt(0) < 32 && ![9, 10, 13].includes(char.charCodeAt(0))) refuse("invalid_document");
  let cursor = 0, tokens = 0;
  const stack: string[] = [];
  while (cursor < xml.length) {
    const start = xml.indexOf("<", cursor); if (start < 0) break;
    if (++tokens > 10000) refuse("processing_limit");
    if (xml.startsWith("<!--", start) || xml.startsWith("<![CDATA[", start)) {
      const cdata = xml.startsWith("<![CDATA[", start), close = cdata ? "]]>" : "-->";
      const end = xml.indexOf(close, start + (cdata ? 9 : 4));
      if (end < 0) refuse("invalid_document"); cursor = end + close.length; continue;
    }
    if (xml.startsWith("<?", start)) {
      const end = xml.indexOf("?>", start + 2);
      if (start > 1 || end < 0 || end - start > 200 || !/^<\?xml\s/.test(xml.slice(start, end))) refuse("invalid_document");
      const declaration = xml.slice(start, end);
      if (/encoding\s*=\s*["'](?!utf-8["'])/i.test(declaration)) refuse("invalid_document");
      cursor = end + 2; continue;
    }
    let end = start + 1, quote = "";
    for (; end < xml.length && end - start <= 8192; end++) {
      const char = xml[end];
      if (quote) {if (char === quote) quote = "";}
      else if (char === '"' || char === "'") quote = char;
      else if (char === ">") break;
    }
    if (end >= xml.length || end - start > 8192 || quote) refuse("processing_limit");
    const tag = xml.slice(start + 1, end), closing = tag.startsWith("/");
    const name = /^\/?([A-Za-z_][A-Za-z0-9_.:-]*)/.exec(tag)?.[1];
    if (!name) refuse("invalid_document");
    if (closing) {if (stack.pop() !== name) refuse("invalid_document");}
    else if (!/\/\s*$/.test(tag)) {stack.push(name); if (stack.length > 64) refuse("processing_limit");}
    cursor = end + 1;
  }
  if (stack.length) refuse("invalid_document");
}

export async function readCustomerDocxBody(bytes: Uint8Array, signal?: AbortSignal): Promise<string> {
  const deadline = Date.now() + 10000;
  const current = () => {if (signal?.aborted) refuse("interrupted"); if (Date.now() >= deadline) refuse("processing_limit");};
  try {
    current(); const member = bodyMember(bytes); current();
    const compressed = bytes.subarray(member.offset, member.offset + member.compressed);
    let xmlBytes: Uint8Array;
    if (member.method === 0) {
      if (member.compressed !== member.size) refuse("invalid_document"); xmlBytes = compressed;
    } else {
      let length = 0, finished = false; const chunks: Uint8Array[] = [];
      const inflater = new Inflate((chunk, final) => {
        current(); length += chunk.length;
        if (length > member.size || length > MAX_XML) refuse("processing_limit");
        chunks.push(chunk); finished = final;
      });
      for (let offset = 0; offset < compressed.length; offset += 128) {
        current(); const finish = Math.min(compressed.length, offset + 128);
        inflater.push(compressed.subarray(offset, finish), finish === compressed.length);
        // Yield to the original request's Abort/deadline, without another worker.
        if (offset > 0 && offset % 65536 === 0) await new Promise(resolve => setTimeout(resolve, 0));
      }
      if (!finished || length !== member.size) refuse("invalid_document");
      xmlBytes = new Uint8Array(length); let offset = 0;
      for (const chunk of chunks) {xmlBytes.set(chunk, offset); offset += chunk.length;}
    }
    await new Promise(resolve => setTimeout(resolve, 0));
    current(); if (crc32(xmlBytes) !== member.crc) refuse("invalid_document");
    const xml = UTF8.decode(xmlBytes); xmlPreflight(xml); current();
    const invalid = () => refuse("invalid_document");
    const document = new DOMParser({errorHandler: {warning: invalid, error: invalid, fatalError: invalid}})
      .parseFromString(xml, "application/xml");
    const root = document.documentElement;
    if (!root || root.localName !== "document" || root.namespaceURI !== WORD) refuse("invalid_document");
    const bodies = Array.from(root.childNodes).filter(node => node.nodeType === 1
      && (node as Element).localName === "body" && (node as Element).namespaceURI === WORD);
    if (bodies.length !== 1) refuse("invalid_document");
    const stack: Array<{node: Node; exit: boolean}> = [{node: bodies[0], exit: false}];
    const text: string[] = []; let nodes = 0;
    while (stack.length) {
      current(); const {node, exit} = stack.pop()!;
      const element = node as Element;
      if (exit) {
        if (element.namespaceURI === WORD && element.localName === "p") text.push("\n");
        else if (element.namespaceURI === WORD && element.localName === "tc") text.push("\t");
        continue;
      }
      if (++nodes > 20000) refuse("processing_limit");
      if (node.nodeType !== 1) continue;
      if (element.namespaceURI === WORD) {
        if (["ins", "del", "moveFrom", "moveTo", "altChunk"].includes(element.localName ?? "")) refuse("invalid_document");
        if (element.localName === "t") {text.push(element.textContent ?? ""); continue;}
        if (element.localName === "tab") text.push("\t");
        if (["br", "cr"].includes(element.localName ?? "")) text.push("\n");
      }
      stack.push({node, exit: true});
      for (let i = node.childNodes.length - 1; i >= 0; i--) stack.push({node: node.childNodes[i], exit: false});
    }
    current(); return text.join("").trim();
  } catch (error) {
    if (error instanceof CustomerDocxError) throw error;
    return refuse("invalid_document");
  }
}
