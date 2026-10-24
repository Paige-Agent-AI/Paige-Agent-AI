import path from "node:path";
import config from "./solo.vite.config";

// Extend the existing actual-Chat harness only. No production auth/provider call.
const repo = path.resolve(import.meta.dirname, "../../../..");
const context = path.join(import.meta.dirname, "draft-reload-stubs.ts");
export default {
  ...config,
  publicDir: path.join(repo, "public"),
  cacheDir: path.join(repo, "node_modules/.vite-e2-draft-reload"),
  define: {
    "import.meta.env.VITE_SUPABASE_URL": JSON.stringify("https://unit-test.invalid"),
    "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify("unit-test-public-key"),
  },
  resolve: { ...config.resolve, alias: [
    { find: /^@\/hooks\/useTenantContext$/, replacement: context },
    { find: /^@\/hooks\/useScopedUserId$/, replacement: context },
    { find: /^@\/contexts\/ImpersonationContext$/, replacement: context },
    ...config.resolve.alias.filter(entry => !/useTenantContext|useScopedUserId/.test(String(entry.find))),
  ] },
  server: { ...config.server, port: 43957 },
};
