import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

// Exercise the real native dependency graph. Ordinary PDF tests can pass after
// their own literal npm imports have primed a local cache while a deployable
// runtime graph still omits the library behind a variable dynamic import.
const root = fileURLToPath(new URL('../../', import.meta.url));
const option = process.argv.indexOf('--deno');
if (option >= 0) assert(process.argv[option + 1], '--deno needs an executable');
const deno = option >= 0 ? process.argv[option + 1] : 'deno';
const entries = [
  { entry: 'supabase/functions/_shared/agreements/document.ts', nativePdf: true },
  { entry: 'supabase/functions/_shared/agreements/document-preparation.ts', nativePdf: true },
  { entry: 'supabase/functions/_shared/agreements/field-preparation.ts', nativePdf: false },
];
const results = entries.map(({ entry, nativePdf }) => {
  const result = spawnSync(deno, [
    'info', '--json', '--no-config', '--no-lock', '--node-modules-dir=none',
    pathToFileURL(resolve(root, entry)).href,
  ], { cwd: root, encoding: 'utf8', timeout: 120000, maxBuffer: 16 * 1024 * 1024 });
  assert.equal(result.error, undefined, `Native graph command failed: ${entry}`);
  assert.equal(result.status, 0, `Native graph could not be read: ${entry}`);
  const graph = JSON.parse(result.stdout);
  assert(Array.isArray(graph.modules), `Missing native graph: ${entry}`);
  assert(!graph.modules.some(module => module.error), `Unresolved native module: ${entry}`);
  const libraries = Object.keys(graph.npmPackages ?? {}).filter(name => name.startsWith('pdf-lib@'));
  const nativeDocumentIncluded = graph.modules.some(module => module.specifier.endsWith('/agreements/document.ts'));
  return {
    entry, modules: graph.modules.length,
    nativePdfExpected: nativePdf, nativeDocumentIncluded,
    pinnedPdfIncluded: libraries.length === 1 && libraries[0] === 'pdf-lib@1.17.1',
    libraries,
  };
});
console.log(JSON.stringify({
  schemaVersion: 1, proof: 'original-native-pdf-dependency-graph', results,
  boundary: 'Dependency registration only; not production, provider or customer acceptance.',
}, null, 2));
assert(results.every(result => result.nativePdfExpected
  ? result.pinnedPdfIncluded
  : result.libraries.length === 0 && !result.nativeDocumentIncluded),
  'Native document graphs must include the pinned PDF engine; pure field preparation must not import the native renderer.');
