import path from 'node:path';
import { defineConfig } from 'vite';
import base from '../sales-invoice-lifecycle/vite.config';

// Extend the existing local Sales runtime. No alternate production or QA execution path.
const original = path.resolve(import.meta.dirname, '../sales-invoice-lifecycle/fixture.ts');
const fixture = path.join(import.meta.dirname, 'fixture.ts');
export default defineConfig({ ...base, root: import.meta.dirname,
  resolve: { alias: (base.resolve!.alias as { find: string; replacement: string }[])
    .map(alias => alias.replacement === original ? { ...alias, replacement: fixture } : alias) },
  server: { host: '127.0.0.1', port: 5294, strictPort: true },
});
