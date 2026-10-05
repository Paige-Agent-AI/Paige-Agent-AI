#!/usr/bin/env node
// fetch-brand-fonts — the ONE repeatable way the workspace-page brand font library is self-hosted (§24).
//
//   node scripts/fonts/fetch-brand-fonts.mjs
//
// What it does, for every family below:
//   1. Reads the family's METADATA.pb from the google/fonts repository and REFUSES anything that is not
//      licensed OFL (the library is open-licence by owner ruling, 2026-10-04).
//   2. Requests the family from the Google Fonts CSS2 API with its full variable axis ranges (or the
//      exact static weights a static family ships in), keeps ONLY the `latin` and `latin-ext` subset
//      blocks (latin-ext covers Central European, Turkish and Vietnamese letters in business names; the
//      browser fetches it only when a page actually uses one of those characters, via unicode-range), and
//      downloads each unique WOFF2 into public/fonts/brand/<slug>/. A variable family yields ONE file,
//      not one copy per weight (the P0 harness saved the same variable file once per weight).
//   3. Opens every downloaded file (WOFF2 header + brotli-decoded `fvar` table) and FAILS the run when a
//      file that was requested as variable does not carry every requested axis. This is the guard for
//      GRAMMAR §19.17: Bodoni Moda's per-weight CSS2 download was the high-opsz static instance with no
//      live `opsz` axis, so its hairlines vanished at display sizes. Requested as a range it carries a
//      live opsz 6–96 axis, and this check proves it on every run instead of trusting the request.
//   4. Writes the family's OFL.txt beside its files — the OFL requires the licence to travel with the
//      font files.
//   5. Regenerates src/lib/brand-fonts.files.ts: the file manifest (paths, weight/stretch descriptors,
//      axes, unicode-range, byte sizes). The POLICY — which faces are offered, their character, their
//      body partner, the fallback stack — lives in src/lib/brand-fonts.ts and is never generated.
//
// Network: uses curl so the agent proxy and its CA bundle apply unchanged. Nothing at runtime ever
// fetches from Google: tenant pages load only these self-hosted files (no remote font URL is ever built
// from tenant text — see src/lib/brand-fonts.ts).
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { brotliDecompressSync } from "node:zlib";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const OUT_DIR = path.join(ROOT, "public", "fonts", "brand");
const MANIFEST = path.join(ROOT, "src", "lib", "brand-fonts.files.ts");
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

// `axes` is the CSS2 request after the family name. A range (`a..b`) asks for the variable file; a `;`
// list asks for those static weights. `null` = the family's single default style. `variable` lists the
// fvar axis tags every downloaded file MUST carry (the run fails otherwise).
export const FAMILIES = [
  // ── curated library (GRAMMAR §19.6) ──
  { family: "Source Serif 4", repo: "ofl/sourceserif4", axes: "opsz,wght@8..60,200..900", variable: ["opsz", "wght"] },
  { family: "Literata", repo: "ofl/literata", axes: "opsz,wght@7..72,200..900", variable: ["opsz", "wght"] },
  { family: "Spectral", repo: "ofl/spectral", axes: "wght@400;500;600;700;800" },
  { family: "Bodoni Moda", repo: "ofl/bodonimoda", axes: "opsz,wght@6..96,400..900", variable: ["opsz", "wght"] },
  { family: "Libre Caslon Display", repo: "ofl/librecaslondisplay", axes: null },
  { family: "Gloock", repo: "ofl/gloock", axes: null },
  { family: "Source Sans 3", repo: "ofl/sourcesans3", axes: "wght@200..900", variable: ["wght"] },
  { family: "Public Sans", repo: "ofl/publicsans", axes: "wght@100..900", variable: ["wght"] },
  { family: "Urbanist", repo: "ofl/urbanist", axes: "wght@100..900", variable: ["wght"] },
  { family: "Figtree", repo: "ofl/figtree", axes: "wght@300..900", variable: ["wght"] },
  { family: "Onest", repo: "ofl/onest", axes: "wght@100..900", variable: ["wght"] },
  { family: "Manrope", repo: "ofl/manrope", axes: "wght@200..800", variable: ["wght"] },
  { family: "Barlow Semi Condensed", repo: "ofl/barlowsemicondensed", axes: "wght@400;500;600;700;800" },
  { family: "Oswald", repo: "ofl/oswald", axes: "wght@200..700", variable: ["wght"] },
  { family: "Anton", repo: "ofl/anton", axes: null },
  { family: "Unbounded", repo: "ofl/unbounded", axes: "wght@200..900", variable: ["wght"] },
  { family: "Archivo", repo: "ofl/archivo", axes: "wdth,wght@62..125,100..900", variable: ["wdth", "wght"] },
  // ── classic picks: today's FONT_OPTIONS (src/components/ui/page/BrandControls.tsx), honoured ──
  { family: "Montserrat", repo: "ofl/montserrat", axes: "wght@100..900", variable: ["wght"] },
  { family: "Inter", repo: "ofl/inter", axes: "opsz,wght@14..32,100..900", variable: ["opsz", "wght"] },
  { family: "Plus Jakarta Sans", repo: "ofl/plusjakartasans", axes: "wght@200..800", variable: ["wght"] },
  { family: "Poppins", repo: "ofl/poppins", axes: "wght@400;500;600;700" },
  { family: "Playfair Display", repo: "ofl/playfairdisplay", axes: "wght@400..900", variable: ["wght"] },
  { family: "Lora", repo: "ofl/lora", axes: "wght@400..700", variable: ["wght"] },
  { family: "DM Sans", repo: "ofl/dmsans", axes: "opsz,wght@9..40,100..1000", variable: ["opsz", "wght"] },
  { family: "Space Grotesk", repo: "ofl/spacegrotesk", axes: "wght@300..700", variable: ["wght"] },
];

export const slugOf = (family) => family.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const curlText = (url, extra = []) => execFileSync("curl", ["-sS", "--fail", "--retry", "2", ...extra, url], { encoding: "utf8" });
const curlFile = (url, dest) => execFileSync("curl", ["-sS", "--fail", "--retry", "2", "-o", dest, url]);

// ── WOFF2: read the fvar axes without any dependency ─────────────────────────────────────────────
const KNOWN_TAGS = ["cmap", "head", "hhea", "hmtx", "maxp", "name", "OS/2", "post", "cvt ", "fpgm", "glyf", "loca", "prep", "CFF ", "VORG", "EBDT", "EBLC", "gasp", "hdmx", "kern", "LTSH", "PCLT", "VDMX", "vhea", "vmtx", "BASE", "GDEF", "GPOS", "GSUB", "EBSC", "JSTF", "MATH", "CBDT", "CBLC", "COLR", "CPAL", "SVG ", "sbix", "acnt", "avar", "bdat", "bloc", "bsln", "cvar", "fdsc", "feat", "fmtx", "fvar", "gvar", "hsty", "just", "lcar", "mort", "morx", "opbd", "prop", "trak", "Zapf", "Silf", "Glat", "Gloc", "Feat", "Sill"];

function readBase128(buf, state) {
  let value = 0;
  for (let i = 0; i < 5; i++) {
    const byte = buf[state.pos++];
    value = value * 128 + (byte & 0x7f);
    if ((byte & 0x80) === 0) return value;
  }
  throw new Error("bad UIntBase128");
}

/** Returns the fvar axes ([{tag,min,max}]) of a WOFF2 file, or [] for a static font. Throws on a non-WOFF2. */
export function woff2Axes(buf) {
  if (buf.toString("latin1", 0, 4) !== "wOF2") throw new Error("not a WOFF2 file");
  const numTables = buf.readUInt16BE(12);
  const totalCompressedSize = buf.readUInt32BE(20);
  const state = { pos: 48 };
  const tables = [];
  for (let i = 0; i < numTables; i++) {
    const flags = buf[state.pos++];
    const tagIndex = flags & 0x3f;
    let tag;
    if (tagIndex === 63) { tag = buf.toString("latin1", state.pos, state.pos + 4); state.pos += 4; } else tag = KNOWN_TAGS[tagIndex];
    const transform = (flags >> 6) & 3;
    const origLength = readBase128(buf, state);
    const isGlyfLoca = tag === "glyf" || tag === "loca";
    const transformed = isGlyfLoca ? transform === 0 : transform !== 0;
    const length = transformed ? readBase128(buf, state) : origLength;
    tables.push({ tag, length });
  }
  const data = brotliDecompressSync(buf.subarray(state.pos, state.pos + totalCompressedSize));
  let offset = 0;
  for (const t of tables) {
    if (t.tag === "fvar") {
      const f = data.subarray(offset, offset + t.length);
      const axesOffset = f.readUInt16BE(4);
      const axisCount = f.readUInt16BE(8);
      const axisSize = f.readUInt16BE(10);
      const out = [];
      for (let a = 0; a < axisCount; a++) {
        const o = axesOffset + a * axisSize;
        out.push({ tag: f.toString("latin1", o, o + 4), min: f.readInt32BE(o + 4) / 65536, max: f.readInt32BE(o + 12) / 65536 });
      }
      return out;
    }
    offset += t.length;
  }
  return [];
}

// ── CSS2 parsing: keep only the latin and latin-ext blocks ───────────────────────────────────────
export const SUBSETS = ["latin", "latin-ext"];
function latinFaces(css) {
  const out = [];
  const parts = css.split(/\/\*\s*([a-z0-9-]+)\s*\*\//i).slice(1);
  for (let i = 0; i < parts.length; i += 2) {
    if (!SUBSETS.includes(parts[i])) continue;
    const subset = parts[i];
    const block = parts[i + 1];
    const get = (prop) => block.match(new RegExp(`${prop}:\\s*([^;]+);`))?.[1]?.trim();
    const url = block.match(/url\((https:[^)]+\.woff2)\)/)?.[1];
    if (!url) throw new Error("latin block without a woff2 url");
    out.push({ url, subset, style: get("font-style") ?? "normal", weight: get("font-weight") ?? "400", stretch: get("font-stretch") ?? null, unicodeRange: get("unicode-range") });
  }
  return out;
}

function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const manifest = {};
  let totalBytes = 0;
  for (const f of FAMILIES) {
    const slug = slugOf(f.family);
    const dir = path.join(OUT_DIR, slug);
    if (existsSync(dir)) rmSync(dir, { recursive: true });
    mkdirSync(dir, { recursive: true });

    const meta = curlText(`https://raw.githubusercontent.com/google/fonts/main/${f.repo}/METADATA.pb`);
    const license = meta.match(/^license: "([^"]+)"/m)?.[1];
    const designer = meta.match(/^designer: "([^"]+)"/m)?.[1] ?? null;
    if (license !== "OFL") throw new Error(`${f.family}: licence is ${license}, not OFL — refusing to ship it`);

    const request = f.axes ? `${f.family.replace(/ /g, "+")}:${f.axes}` : f.family.replace(/ /g, "+");
    const faces = latinFaces(curlText(`https://fonts.googleapis.com/css2?family=${request}&display=swap`, ["-A", UA]));
    if (!faces.some((x) => x.subset === "latin")) throw new Error(`${f.family}: no latin faces returned`);

    const byUrl = new Map();
    const files = [];
    for (const face of faces) {
      if (byUrl.has(face.url)) continue; // the same variable file listed once per weight → keep one
      const weightPart = face.weight.replace(/\s+/g, "-");
      const file = `${slug}-${face.subset}-${face.style}-${weightPart}.woff2`;
      const dest = path.join(dir, file);
      curlFile(face.url, dest);
      const buf = readFileSync(dest);
      const axes = woff2Axes(buf);
      for (const tag of f.variable ?? []) {
        if (!axes.some((a) => a.tag === tag)) throw new Error(`${f.family}: ${file} lacks a live "${tag}" axis (has ${axes.map((a) => a.tag).join(",") || "none"}) — refusing to ship a broken cut`);
      }
      byUrl.set(face.url, file);
      files.push({ file, subset: face.subset, style: face.style, weight: face.weight, ...(face.stretch ? { stretch: face.stretch } : {}), unicodeRange: face.unicodeRange, axes: axes.map((a) => `${a.tag} ${a.min}–${a.max}`), bytes: buf.length });
      totalBytes += buf.length;
    }

    const ofl = curlText(`https://raw.githubusercontent.com/google/fonts/main/${f.repo}/OFL.txt`);
    writeFileSync(path.join(dir, "OFL.txt"), ofl);
    manifest[slug] = { family: f.family, license, designer, source: `https://github.com/google/fonts/tree/main/${f.repo}`, files };
    console.log(`${f.family.padEnd(24)} ${files.length} file(s) ${files.map((x) => `${x.subset}:${x.axes.join(",") || `static ${x.weight}`}`).join(" | ")} · ${files.reduce((n, x) => n + x.bytes, 0)} B`);
  }

  // Remove any directory left from a family that is no longer in the list.
  for (const entry of readdirSync(OUT_DIR)) {
    if (statSync(path.join(OUT_DIR, entry)).isDirectory() && !manifest[entry]) rmSync(path.join(OUT_DIR, entry), { recursive: true });
  }

  const header = `// GENERATED by scripts/fonts/fetch-brand-fonts.mjs — do not edit by hand; rerun the script.
// The self-hosted WOFF2 files under public/fonts/brand/<slug>/ (latin + latin-ext, OFL, licence beside each).
// Policy (what is offered, character, pairing, fallback) lives in ./brand-fonts.ts, never here.
`;
  const body = `export interface BrandFontFile {
  /** File name under /fonts/brand/<slug>/. */
  file: string;
  /** Google Fonts subset: "latin" or "latin-ext". */
  subset: string;
  style: string;
  /** CSS font-weight descriptor: a single weight, or "min max" for a variable file. */
  weight: string;
  /** CSS font-stretch descriptor, present only for a width-variable file. */
  stretch?: string;
  /** The code points this file covers (the browser downloads it only when the page uses one). */
  unicodeRange: string;
  /** The fvar axes verified in the file by the fetch script (empty = static). */
  axes: readonly string[];
  bytes: number;
}

export interface BrandFontFileSet {
  family: string;
  license: string;
  designer: string | null;
  source: string;
  files: readonly BrandFontFile[];
}

export const BRAND_FONT_FILES: Record<string, BrandFontFileSet> = ${JSON.stringify(manifest, null, 2)};

/** Total bytes of every self-hosted brand font file. */
export const BRAND_FONT_TOTAL_BYTES = ${totalBytes};

/** Bytes of the latin files only — what a page with Western European text can ever download. */
export const BRAND_FONT_LATIN_BYTES = ${Object.values(manifest).flatMap((m) => m.files).filter((x) => x.subset === "latin").reduce((n, x) => n + x.bytes, 0)};
`;
  writeFileSync(MANIFEST, header + "\n" + body);
  console.log(`\n${Object.keys(manifest).length} families · ${Object.values(manifest).reduce((n, m) => n + m.files.length, 0)} WOFF2 files · ${totalBytes} bytes · wrote ${path.relative(ROOT, MANIFEST)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) main();
