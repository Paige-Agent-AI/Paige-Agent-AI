import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const output = path.resolve(root, process.argv[2] ?? "work/solo-screen-recovery-render");
const adapter = path.join(root, "scripts/proof/ant21-screen-recovery/adapter.tsx");
const bundle = await build({ entryPoints: [path.join(root, "scripts/proof/ant21-screen-recovery/source.tsx")], bundle: true, write: false, format: "iife", jsx: "automatic", loader: { ".css": "empty" }, define: { "process.env.NODE_ENV": '"production"', "import.meta.env.PROD": "true", "import.meta.env.DEV": "false", "__BUILD_ID__": '"test-current-build"' }, plugins: [{ name: "isolated-render-only", setup(api) {
  api.onResolve({ filter: /^@\/(?:components\/ui\/paige|components\/admin\/voice\/DialPadTrigger|components\/dashboard\/PaigeAIChat|hooks\/useScopedUserId)$/ }, () => ({ path: adapter }));
} }] });
const assets = path.join(root, "dist/assets");
const cssFiles = (await fs.readdir(assets)).filter(file => file.endsWith(".css"));
let css = (await Promise.all(cssFiles.map(file => fs.readFile(path.join(assets, file), "utf8")))).join("\n");
for (const match of [...css.matchAll(/url\(([^)]*\.woff2)\)/g)]) {
  const url = match[1].replace(/["']/g, "");
  if (url.startsWith("/assets/")) css = css.replaceAll(match[0], `url(data:font/woff2;base64,${(await fs.readFile(path.join(root, "dist", url.slice(1)))).toString("base64")})`);
}
await fs.mkdir(output, { recursive: true });
await fs.writeFile(path.join(output, "index.html"), `<!doctype html><html class="light" lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Isolated source recovery proof</title><style>${css}</style><body><div id="root"></div><script>${bundle.outputFiles[0].text.replaceAll("</script", "<\\/script")}</script></body></html>`);
const files = ["src/solo/SoloApp.tsx", "src/solo/SoloScreenBoundary.tsx", "src/hooks/usePlatformUpdate.ts", "src/hooks/useBeforeUnloadGuard.ts", "src/components/PlatformUpdateBanner.tsx", "src/components/tenant-shell/TenantCommandCenterShell.tsx", "scripts/proof/ant21-screen-recovery/source.tsx", "scripts/proof/ant21-screen-recovery/adapter.tsx", "scripts/proof/ant21-screen-recovery/build.mjs", ...cssFiles.map(file => `dist/assets/${file}`)];
const sources = await Promise.all(files.map(async file => ({ file, sha256: createHash("sha256").update(await fs.readFile(path.join(root, file))).digest("hex") })));
await fs.writeFile(path.join(output, "sources.json"), JSON.stringify({ sources, boundary: "Isolated actual-source rendering with synthetic presence/identity/department and version responses. No authenticated, provider, domain record or business execution proof." }, null, 2) + "\n");
console.log(JSON.stringify({ output, sources: sources.length, network: "Synthetic local version only; no business APIs" }));
