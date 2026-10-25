// Compile immutable expected source, never downloaded code. No execution tools.
import { transpile } from "jsr:@deno/emit@0.46.0";

const MAX_BYTES = 32 * 1024 * 1024;
const chunks: Uint8Array[] = [];
let size = 0;
for await (const chunk of Deno.stdin.readable) {
  size += chunk.byteLength;
  if (size > MAX_BYTES) throw new Error("Expected source budget exceeded");
  chunks.push(chunk);
}
const bytes = new Uint8Array(size);
let offset = 0;
for (const chunk of chunks) {
  bytes.set(chunk, offset);
  offset += chunk.byteLength;
}
const input = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
if (input.version !== 1 || !Array.isArray(input.files) ||
    input.files.length < 1 || input.files.length > 2000) {
  throw new Error("Invalid expected source envelope");
}
const hash = async (text: string) => Array.from(
  new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))),
  (n) => n.toString(16).padStart(2, "0"),
).join("");
const seen = new Set<string>();
const files = [];
for (const file of input.files) {
  if (typeof file.path !== "string" || typeof file.source !== "string" ||
      !/^supabase\/functions\/[A-Za-z0-9_./-]+\.(?:ts|tsx|js|jsx|mjs)$/.test(file.path) ||
      file.path.split("/").some((part: string) => !part || part === "." || part === "..") ||
      seen.has(file.path)) throw new Error("Invalid expected source identity");
  seen.add(file.path);
  const root = "file:///home/runner/work/Paige-Agent-AI/Paige-Agent-AI/" + file.path;
  const result = await transpile(root, {
    // Each dependency is separately verified against its own immutable source.
    // Never fetch imports, run source, or trust downloaded source maps/content.
    load: (specifier: string) => Promise.resolve(specifier === root
      ? { kind: "module", specifier, content: file.source }
      : { kind: "external", specifier }),
  });
  const code = result.get(root);
  if (typeof code !== "string") throw new Error("Missing expected emission");
  files.push({ path: file.path, source_sha256: await hash(file.source), sha256: await hash(code) });
}
console.log(JSON.stringify({ version: 1, compiler: "@deno/emit@0.46.0", files }));
