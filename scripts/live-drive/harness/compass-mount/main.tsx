// Experience 04 E4-S3 — the Solo Trust Compass (`TrustCompass`, the real component CommandCenter
// mounts) with its four data hooks stubbed (stubs.ts), inside the real `.paige-solo` token scope, so
// the notices above the instrument can be SEEN in both themes. HARNESS RENDER · NOT LIVE: the reads
// are fixtures; the deployed, signed-in Trust Compass is a separate, owed check (§32/§70.1).
//
// ?variant=limits    the platform-ceiling note, the unconfirmed-ceiling status and the unconfirmed-access status
// ?variant=readonly  the platform-ceiling note and the read-only note
// ?theme=light|dark
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { TrustCompass } from "@/solo/compass";
import "@/index.css";
import "@/solo/solo-tokens.css";

const params = new URLSearchParams(window.location.search);
const theme = params.get("theme") === "dark" ? "dark" : "light";
document.documentElement.classList.toggle("dark", theme === "dark");
const TC = TrustCompass as unknown as React.FC<{ accountEpoch?: string; openPaige?: () => void }>;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <div className="paige-solo" data-theme={theme} style={{ minHeight: "100vh", padding: "16px 0" }}>
      <TC accountEpoch="harness-tenant" openPaige={() => undefined} />
    </div>
  </StrictMode>,
);
