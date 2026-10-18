import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import fs from "fs";

// TEMPORARY native-capture harness config — never committed.
const ROOT = path.resolve(__dirname, "..");
const stub = (name: string) => fs.readFileSync(path.join(ROOT, "tmp-capture", `stub-${name}.ts`), "utf8");
const intercept = (suffix: string, stubName: string) => ({
  name: `intercept-${stubName}`,
  load(id: string) {
    const norm = id.split("?")[0].replaceAll("\\", "/");
    if (norm.endsWith(suffix)) return stub(stubName);
    return null;
  },
});

export default defineConfig({
  root: path.resolve(__dirname),
  server: { host: "127.0.0.1", port: 4173, strictPort: true, fs: { allow: [ROOT] } },
  plugins: [
    react(),
    intercept("/src/solo/data/useSoloBusinessContext.ts", "context"),
    intercept("/src/hooks/useTenantContext.tsx", "tenant"),
    intercept("/src/integrations/supabase/client.ts", "supabase"),
  ],
  define: { __BUILD_ID__: JSON.stringify("capture-harness") },
  resolve: { alias: { "@": path.resolve(ROOT, "./src"), "@/index.css": path.resolve(ROOT, "./src/index.css") }, dedupe: ["react", "react-dom", "react/jsx-runtime"] },
});
