import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";

// E09 Slice 5 — the CUSTOMER portal Payments page (/app/billing) and one invoice's page (/app/billing/:id),
// rendered with the REAL pages inside the REAL customer chrome (AppNav) in AppShell's layout, plus the customer
// home's REAL tile grid with the Payments line above it. Only the data boundary is stubbed (stubs.ts): the
// Supabase transport (client_portal_invoices, client_portal_invoice_payment_request, the brand/config/profile
// reads, empty sessions/progress for the home tiles), the scoped invoice document function (answered in-page
// with the REAL shared renderer) and the DashboardMode context. Its own root: never part of the app build (§9).
//   /app/billing?state=populated|empty|loading|unavailable|multiple|error|hasmore|paidup|test|test-settled|mixed-settled&theme=light|dark
//   /app/billing/<invoice id>?state=populated|test|testlink|test-settled|mixed-settled|pay-unavailable|other-processor|doc-error|pay-error
//     |part-settled|part-settled-test|inflight-test|corrected
//   /app?state=populated|home-empty   /app/messages (the real Messages page, reached from an invoice's Ask)
// The chrome is the REAL Slice M AppNav: Payments is reached through its Paperwork group (desktop menu, phone drawer).
// HARNESS_PAYMENTS_MUTANT=<name> (drive self-test only) swaps in harness-only defects through a transform of the
// served module; no product file is edited. See payments-drive.mjs --selftest.
const repo = path.resolve(import.meta.dirname, "../../../..");
const stubs = path.join(import.meta.dirname, "stubs.ts");
const mutant = process.env.HARNESS_PAYMENTS_MUTANT ?? "";
export default defineConfig({
  root: import.meta.dirname,
  cacheDir: path.join(repo, `node_modules/.vite/harness-portal-payments-customer-mount${mutant ? `-${mutant}` : ""}`),
  css: { postcss: repo },
  plugins: [
    react(),
    {
      // Defects for the drive's own negative controls, injected into the served module only.
      name: "harness-payments-mutant",
      enforce: "pre",
      transform(code, id) {
        if (!mutant) return null;
        const swap = (from: string, to: string) => {
          if (!code.includes(from)) throw new Error(`harness mutant ${mutant}: anchor not found: ${from}`);
          return code.replace(from, to);
        };
        if (id.endsWith("/supabase/functions/_shared/sales-invoice-document.ts")) {
          // The document ignores the portal's provider environment: a test receipt reads as money received.
          if (mutant === "doclabel") return swap(`const portal=portalTestEvidence(value,balance.verified);`, `const portal=null as ReturnType<typeof portalTestEvidence>;`);
          // The portal document forgets the invoice was voided: the outstanding figure and equation come back.
          if (mutant === "docvoid") return swap(`const isVoid = (value: ObjectValue) => value.status === 'void' || value.status === 'voided';`, `const isVoid = (_value: ObjectValue) => false;`);
          // The portal document calls a corrected payment "no payments" (the round-4 wording).
          if (mutant === "doccorrected") return swap(`return ledger.receipt_total_cents===0?'No payments recorded.':'Recorded payments were corrected; nothing counts toward this invoice.';`, `return 'No payments recorded.';`);
          return null;
        }
        if (id.endsWith("/src/pages/app/Billing.tsx")) {
          // Gold spent on a resting row (the list must carry none).
          if (mutant === "gold") return swap(`paid: "border-success/40 bg-success/10 text-foreground",`, `paid: "border-accent bg-accent text-accent-foreground",`);
          if (mutant === "contrast") return swap(`<p className="mt-0.5 text-sm text-muted-foreground">{issued}</p>`, `<p className="mt-0.5 text-sm text-muted-foreground opacity-40">{issued}</p>`);
          if (mutant === "overflow") return swap(`<header className="space-y-1 pb-4">`, `<header className="space-y-1 pb-4"><div aria-hidden="true" style={{ width: 1600, height: 1 }} />`);
          if (mutant === "target") return swap(`const LINK_BUTTON = \`inline-flex min-h-[44px]`, `const LINK_BUTTON = \`inline-flex h-7`);
          if (mutant === "clip") return swap(`<p className="break-words text-sm font-semibold">{title}</p>`, `<p className="w-10 truncate text-sm font-semibold">{title}</p>`);
          return null;
        }
        if (id.endsWith("/src/lib/portal/portalMenu.ts")) {
          const anchor = `icon: CreditCard, group: "paperwork", floor: "customer", catalogLabel: false,`;
          // The catalog's name wins again: the customer's menu says "Billing" (the owner ruled "Payments").
          if (mutant === "navlabel") return swap(anchor, `icon: CreditCard, group: "paperwork", floor: "customer",`);
          // Payments filed under "Your work" instead of Paperwork.
          if (mutant === "navgroup") return swap(anchor, `icon: CreditCard, group: "work", floor: "customer", catalogLabel: false,`);
          return null;
        }
        if (id.endsWith("/src/components/app/AppNav.tsx")) {
          // An invoice no longer keeps Payments' group active (the active-section rule dropped).
          if (mutant === "navactive") return swap(`const SECTION_HREFS = new Set(["/app/billing"]);`, `const SECTION_HREFS = new Set<string>([]);`);
          // The current drawer entry in gold (gold is spent on acts only).
          if (mutant === "navgold") return swap(`const DRAWER_ACTIVE = "bg-sidebar-accent text-primary-foreground font-medium";`, `const DRAWER_ACTIVE = "bg-sidebar-accent text-accent font-medium";`);
          return null;
        }
        if (id.endsWith("/src/pages/app/Messages.tsx")) {
          // The suggested draft left in the address after it was put in the composer.
          if (mutant === "draftkept") return swap(`next.delete("draft");`, `void next;`);
          return null;
        }
        if (id.endsWith("/src/pages/app/BillingInvoice.tsx")) {
          // A Pay link that keeps the opener (the drive reads rel off the rendered anchor).
          if (mutant === "opener") return swap(`rel="noopener noreferrer"`, `rel="external"`);
          // Pay offered with no link from the business.
          if (mutant === "paywithout") return swap(`<p className="text-sm">{businessName} hasn't sent a payment link for this invoice.</p>`, `<p className="text-sm">{businessName} hasn't sent a payment link for this invoice.</p><a data-testid="pay-now" href="#" className={buttonVariants({ variant: "gold" })}>Pay</a>`);
          return null;
        }
        return null;
      },
    },
  ],
  resolve: {
    alias: [
      { find: /^@\/integrations\/supabase\/client$/, replacement: stubs },
      { find: /^@\/contexts\/DashboardModeContext$/, replacement: stubs },
      { find: "@", replacement: path.join(repo, "src") },
    ],
  },
  define: {
    "import.meta.env.VITE_SUPABASE_URL": JSON.stringify("http://harness.invalid"),
    "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify("harness-not-a-real-key"),
  },
  appType: "spa",
  server: { host: "127.0.0.1", port: 5245, strictPort: true },
});
