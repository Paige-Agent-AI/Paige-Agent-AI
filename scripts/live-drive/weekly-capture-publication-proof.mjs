// Local evidence packaging only. No browser, credentials, database or provider calls.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

const [rawDirectory, publicationDirectory] = process.argv.slice(2);
if (!rawDirectory || !publicationDirectory) throw new Error("Raw and publication directories are required");
const digest = bytes => createHash("sha256").update(bytes).digest("hex").toUpperCase();
const pixelPayload = bytes => {
  if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error("Not a PNG");
  const chunks = [];
  for (let offset = 8; offset < bytes.length;) {
    const length = bytes.readUInt32BE(offset), end = offset + 12 + length;
    if (end > bytes.length) throw new Error("Truncated PNG");
    const kind = bytes.toString("ascii", offset + 4, offset + 8);
    if (["IHDR", "PLTE", "tRNS", "IDAT"].includes(kind)) chunks.push(bytes.subarray(offset + 4, end - 4));
    offset = end;
  }
  return digest(Buffer.concat(chunks));
};
const manifest = JSON.parse(readFileSync(join(rawDirectory, "capture-manifest.json"), "utf8"));
const captures = manifest.captures.map(record => {
  const raw = readFileSync(join(rawDirectory, record.file));
  const published = readFileSync(join(publicationDirectory, record.file));
  if (digest(raw) !== record.sha256.toUpperCase()) throw new Error(`Raw capture hash differs: ${record.file}`);
  const rawPixels = pixelPayload(raw), publishedPixels = pixelPayload(published);
  if (rawPixels !== publishedPixels) throw new Error(`PNG pixel payload changed: ${record.file}`);
  return { file: record.file, original_sha256: digest(raw), publication_sha256: digest(published), pixel_payload_sha256: rawPixels, pixels_unchanged: true };
});
writeFileSync(join(publicationDirectory, "publication-manifest.json"), JSON.stringify({
  artifact_sha256: manifest.artifactSHA256, evidence_class: "synthetic_native_component_capture",
  scope: "Publication copies contain embedded origin metadata. Original hashes remain in capture-manifest/proof; PNG header, palette, transparency and compressed pixel chunks are unchanged.",
  count: captures.length, captures,
}, null, 2) + "\n");
process.stdout.write(`PASS: ${captures.length} original hashes verified; all publication pixel payloads unchanged.\n`);
