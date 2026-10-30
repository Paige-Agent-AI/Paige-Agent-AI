import path from "node:path";
import base from "../exp03-composer-inline-check-mount/vite.config";
// Separate dev-only root. Original canonical inbox and actual new-conversation dialog.
export default {
  ...base,root:import.meta.dirname,
  cacheDir:path.resolve(import.meta.dirname,"../../../../node_modules/.vite/exp03-new-conversation-door"),
  resolve:{...base.resolve,alias:base.resolve!.alias!.map(entry=>entry.replacement.endsWith("stubs.ts")?{...entry,replacement:path.join(import.meta.dirname,"stubs.ts")}:entry)},
  server:{...base.server,port:5252},
};
