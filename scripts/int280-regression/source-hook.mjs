import { readFile } from 'node:fs/promises';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import { transform } from 'esbuild';
import { createHash } from 'node:crypto';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const CURRENT = pathToFileURL(path.resolve(HERE, '../../supabase/functions/sync-credit-report-data/index.ts')).href;
const HISTORY = pathToFileURL(path.join(HERE, 'fixtures/history/sync-credit-report-data.6c76675.ts.fixture')).href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'int280:credit-source') {
    const mode = process.env.PAIGE_REGRESSION_MODE;
    if (!['historical', 'current', 'reintroduced'].includes(mode)) throw new Error('unsupported_regression_mode');
    return { url: mode === 'historical' ? HISTORY : CURRENT, shortCircuit: true };
  }
  // Existing exact_match is used. Any semantic-provider dispatch is a hard failure.
  if (specifier === '../model-router.ts' && context.parentURL?.endsWith('/_shared/eval/scorers.ts')) {
    return { url: 'data:text/javascript,export async function routedChatCompletion(){throw new Error("offline_provider_dispatch_refused")}', shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
export async function load(url, context, nextLoad) {
  if (url === HISTORY || url === CURRENT) {
    let source = (await readFile(fileURLToPath(url), 'utf8')).replace(/\r\n/g, '\n');
    if (url === CURRENT && process.env.PAIGE_REGRESSION_MODE === 'reintroduced') {
      const needle = 'disputes_auto_created: results.disputes_auto_created,';
      if (source.split(needle).length !== 2) throw new Error('regression_mutation_anchor_unavailable');
      source = source.replace(needle, 'disputes_auto_created: disputesCreated,');
    }
    const out = await transform(source, { loader: 'ts', format: 'esm', target: 'node20', sourcefile: fileURLToPath(url) });
    const hash = createHash('sha256').update(source).digest('hex');
    return { format: 'module', source: `${out.code}\nexport const __regression_source_hash = '${hash}';`, shortCircuit: true };
  }
  return nextLoad(url, context);
}
