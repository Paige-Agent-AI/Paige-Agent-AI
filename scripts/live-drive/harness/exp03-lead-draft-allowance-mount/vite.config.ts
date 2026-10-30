import path from "node:path";
import base from "../exp03-composer-inline-check-mount/vite.config";

// Separate development-only root. Actual inbox/components; only data is mocked.
export default {
  ...base,
  root: import.meta.dirname,
  cacheDir: path.resolve(import.meta.dirname, "../../../../node_modules/.vite/exp03-lead-draft-allowance"),
  resolve: { ...base.resolve, alias: base.resolve!.alias!.map((entry) =>
    typeof entry.replacement === "string" && entry.replacement.endsWith("stubs.ts")
      ? { ...entry, replacement: path.join(import.meta.dirname, "stubs.ts") } : entry) },
  server: { ...base.server, port: 5251 },
};
