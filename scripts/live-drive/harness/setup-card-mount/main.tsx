/**
 * Dev-only mount for the INT-345 K-3 calling-setup card: the REAL
 * CallingSetupCard (which composes the REAL settings primitives) with only a
 * query-driven harness state — no transport involved at all (the card is
 * presentational; its props are the canonical record's calling block).
 *
 * `?state=absent|noprim|ready` selects the honest state; the mount renders the
 * card inside the Registration view's content column width (the PAIGE-open
 * variant subtracts the 380px reserved rail, modeling the real shell's content
 * width shift).
 *
 * WHAT THIS DOES NOT PROVE (§13/§32.c): the full SoloSettings route integration
 * (component tests cover the wiring; the settings-mount harness has a
 * pre-existing Tailwind-resolution breakage on this box, parked with its owner).
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "next-themes";
import { CallingSetupCard } from "@/solo/CallingSetupCard";
import "@/index.css";

const params = new URLSearchParams(window.location.search);
const state = params.get("state") ?? "absent";
const paige = params.get("paige") === "open";

const CALLING = {
  absent: { ready: false, code: "calling_not_configured", reason_code: null, account: "absent", number_assigned: false, primary_selected: false, primary_e164: null, twiml_app: "absent" },
  noprim: { ready: false, code: "calling_number_needs_verification", reason_code: "no_active_primary_number", account: "configured", number_assigned: true, primary_selected: false, primary_e164: null, twiml_app: "configured" },
  ready: { ready: true, code: "calling_ready", reason_code: null, account: "configured", number_assigned: true, primary_selected: true, primary_e164: "+15550100", twiml_app: "configured" },
} as const;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
      <div
        data-setup-card-harness
        style={{
          display: "flex",
          height: "100vh",
          alignItems: "flex-start",
          justifyContent: "center",
          padding: 24,
          background: "hsl(240 10% 3.9%)",
        }}
      >
        <div style={{ width: paige ? "min(560px, 100%)" : "min(760px, 100%)" }}>
          <CallingSetupCard
            calling={CALLING[state as keyof typeof CALLING] ?? CALLING.absent}
            settingUp={false}
            note={null}
            canManage
            onRun={() => { /* captured statically; the component suite proves the handler */ }}
          />
        </div>
      </div>
    </ThemeProvider>
  </StrictMode>,
);
