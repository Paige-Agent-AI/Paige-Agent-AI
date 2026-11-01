// Local evidence only: reuse the original real SoloApp mount and both original context fixtures.
import path from 'node:path';
import base from './vite.config';
export default {
  ...base,
  resolve: { ...base.resolve, alias: [
    { find: /^@\/integrations\/supabase\/client$/, replacement: path.join(import.meta.dirname,'team-departure-supabase-stub.ts') },
    ...base.resolve!.alias as Array<{ find: string | RegExp; replacement: string }>,
  ] },
  server: { ...base.server, port: 5298, strictPort: true },
};
