/**
 * Dev-only mount for the INT-345 voice-readiness states: the REAL dialer
 * (VoiceDeviceProvider + DialPadTrigger + DialPadSurface + DialPad) with only
 * the Supabase transport and the tenant context stubbed — the same shared
 * tenant stub the other mounts alias (§18). The needs_config copy rendered
 * here is produced by the shipped classifyVoiceReadiness via the stub, so a
 * capture proves the exact string the deployed edge serves.
 *
 * WHAT THIS DOES NOT PROVE (§13/§32.c): a local render is not a deployed one,
 * and no real Twilio Device is constructed (needs_config never boots one).
 * It proves the rendered copy, contrast and composition of every honest
 * calling-readiness state — never production data.
 *
 *   /?state=no_primary        (…&theme=light for the light capture)
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { VoiceDeviceProvider } from "@/lib/voice/VoiceDeviceProvider";
import { DialPadTrigger } from "@/components/admin/voice/DialPadTrigger";
import { DialPadSurface } from "@/components/admin/voice/DialPadSurface";
// The app's real stylesheet (Tailwind + design tokens) — without it the Sheet
// paints unpositioned and a capture proves nothing (§13).
import "@/index.css";

const queryClient = new QueryClient();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
        <VoiceDeviceProvider>
          <div
            data-voice-harness
            style={{
              display: "flex",
              height: "100vh",
              alignItems: "center",
              justifyContent: "center",
              background: "hsl(240 10% 3.9%)",
            }}
          >
            <DialPadTrigger />
          </div>
          <DialPadSurface />
        </VoiceDeviceProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>,
);
