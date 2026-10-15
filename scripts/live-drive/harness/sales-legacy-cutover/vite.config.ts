import path from "node:path";
import { defineConfig } from "vite";
import base from "../sales-mount/vite.config";
const sales = path.resolve(import.meta.dirname, "../sales-mount");
export default defineConfig({ ...base, root: import.meta.dirname, resolve: { alias: [
  { find: "./useSoloCampaignBriefs", replacement: path.resolve(import.meta.dirname, "../marketing-mount/briefs-stub.ts") },
  { find: "./useSoloCampaigns", replacement: path.join(import.meta.dirname, "pipeline-fixture.ts") },
  { find: "../useSoloAgreementSignings", replacement: path.join(sales, "useSoloAgreementSignings-stub.ts") },
  { find: "../useSalesInvoiceDrafts", replacement: path.join(sales, "useSalesInvoiceDrafts-stub.ts") },
  ...base.resolve!.alias as { find: string; replacement: string }[],
] }, server: { host: "127.0.0.1", port: 5264, strictPort: true } });
