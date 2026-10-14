// execute-approval's own test lane. The root vitest config globs src/** only, so a test beside an
// edge function runs nowhere unless a config names it (the sales-payments lane is the precedent).
// Run from the repo root: node node_modules/vitest/vitest.mjs run --config supabase/functions/execute-approval/vitest.config.ts
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { environment: "node", include: ["supabase/functions/execute-approval/**/*.test.ts"] } });
