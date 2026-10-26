import config from "./solo.vite.config";
import path from "node:path";

// INT-338 renders the actual canonical upload hook; only authentication/history/model data are fake.
export default {
  ...config,
  // Worktrees share dependencies; keep this prototype's optimizer cache local.
  cacheDir: path.resolve(import.meta.dirname, "../../../../work/exp05-attachment-vite-cache"),
  resolve: {
    ...config.resolve,
    alias: config.resolve.alias.filter(entry => !String(entry.find).includes("useChatDocumentUpload")),
  },
  define: {
    ...config.define,
    "import.meta.env.VITE_SUPABASE_URL": JSON.stringify("https://unit-test.invalid"),
    "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify("unit-test-public-key"),
  },
  server: { ...config.server, port: 5215, headers: {
    "Content-Security-Policy": "default-src 'self'; connect-src 'self' ws://127.0.0.1:*; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: blob:;",
  } },
};
