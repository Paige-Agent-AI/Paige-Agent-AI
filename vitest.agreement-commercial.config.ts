import { defineConfig } from 'vitest/config';

export default defineConfig({test:{environment:'node',include:[
  'supabase/functions/_shared/agreements/commercial-presentation-read.test.ts',
]}});
