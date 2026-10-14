import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';

const repo = path.resolve(import.meta.dirname, '../../../..');
const fixture = path.join(import.meta.dirname, 'fixture.ts');
export default defineConfig({
  root: import.meta.dirname, envDir: import.meta.dirname, publicDir: path.join(repo, 'public'),
  cacheDir: path.join(repo, 'node_modules/.vite/exp04-client-review'),
  css: { postcss: repo }, plugins: [react()], appType: 'spa',
  resolve: { dedupe: ['react', 'react-dom', 'react/jsx-runtime'], alias: [
    { find: /^@\/integrations\/supabase\/client$/, replacement: fixture },
    { find: /^@\/contexts\/(ImpersonationContext|DashboardModeContext)$/, replacement: fixture },
    { find: '@', replacement: path.join(repo, 'src') },
  ] },
  define: {
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify('https://unit-test.invalid'),
    'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': JSON.stringify('synthetic-not-a-key'),
  },
  server: { host: '127.0.0.1', port: 5295, strictPort: true, hmr: false },
});
