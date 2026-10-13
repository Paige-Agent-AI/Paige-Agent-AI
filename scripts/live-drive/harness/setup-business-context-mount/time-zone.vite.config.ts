import path from "node:path";
import settingsConfig from "../settings-mount/vite.config";

// Experience 04 E4-S2: the Setup harness plus the business time zone stub. Built explicitly (not via
// mergeConfig) because the stub must PRECEDE the Settings mount's own client alias to win the match.
// Isolated dev harness: never imported by the production application.
const inherited = (settingsConfig.resolve?.alias ?? []) as Array<{ find: string | RegExp; replacement: string }>;
export default {
  ...settingsConfig,
  resolve: {
    ...settingsConfig.resolve,
    alias: [
      { find: /^@\/integrations\/supabase\/client$/, replacement: path.join(import.meta.dirname, "time-zone-stub.ts") },
      { find: "./data/useSoloBusinessContext", replacement: path.join(import.meta.dirname, "context-stub.ts") },
      ...inherited.filter((a) => String(a.find) !== String(/^@\/integrations\/supabase\/client$/)),
    ],
  },
  server: { host: "127.0.0.1", port: 5226, strictPort: true },
};
