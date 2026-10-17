import { defineConfig } from 'vitest/config';

// The ordinary frontend suite includes src/** only. Keep the human address proxy's
// authorization/no-egress tests in an explicit, provider-free security gate.
export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'supabase/functions/lookup-us-address/handler.test.ts',
      'src/solo/sales/addressLookup.test.ts',
    ],
  },
});
