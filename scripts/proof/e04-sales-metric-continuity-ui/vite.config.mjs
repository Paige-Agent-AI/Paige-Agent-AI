import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react-swc';
const root = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(root, '../../..');
// Proof-only alias: product routes never import this synthetic client.
export default {
  root, base: './', publicDir: false, plugins: [react()],
  resolve: { alias: [
    { find: '@/integrations/supabase/client', replacement: path.join(root, 'sdk.ts') },
    { find: '@', replacement: path.join(repo, 'src') },
  ] },
  css: { postcss: repo },
  build: { outDir: path.join(repo, 'node_modules/.cache/e04-metric-continuity-proof'), emptyOutDir: false, sourcemap: false },
};
