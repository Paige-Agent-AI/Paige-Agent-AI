import { createRoot } from "react-dom/client";
import { PaigeRecordLinks } from "@/components/chat/PaigeRecordLinks";
import { readRecordLinks } from "../../../../supabase/functions/_shared/paige-turn/record-links";
import "@/index.css";
import "@/solo/solo-tokens.css";

// Existing actual reference renderer, with explicit synthetic source/account inputs.
// No auth, inbox, message, provider, Chat execution or receipt is simulated as real.
const query = new URLSearchParams(location.search);
const theme = query.get("theme") === "dark" ? "dark" : "light";
const unavailable = query.get("state") === "unavailable";
const parented = query.get("state") === "parented";
const saved = JSON.parse('{"paige_record_links":[{"destination":"conversations","record_id":null}]}');
document.documentElement.classList.toggle("dark", theme === "dark");
document.documentElement.setAttribute("data-pg", theme);
const account = { account_type: "standalone", parent_tenant_id: parented ? "test-parent" : null, account_number: "7001" };

createRoot(document.getElementById("root")!).render(
  <div data-pg={theme} style={{ minHeight: "100vh", background: "var(--pg-canvas)", color: "var(--pg-ink)", fontFamily: "var(--pg-font-ui)" }}>
    <main style={{ maxWidth: 720, padding: 24, margin: "0 auto", boxSizing: "border-box", fontSize: 15, lineHeight: 1.6 }}>
      <h1 style={{ fontSize: 24, fontWeight: 600, marginBottom: 20 }}>Message review</h1>
      <p>{unavailable
        ? "Recent message records could not be read. Try again or open Conversations."
        : "The permitted message records can be checked in Conversations. This bounded read is not a business total or evidence of delivery. Nothing was sent or changed."}</p>
      <PaigeRecordLinks links={unavailable ? [] : readRecordLinks(saved.paige_record_links)} account={account} />
      <p style={{ marginTop: 32, color: "var(--pg-ink-2)", fontSize: 13 }}>Synthetic reference preview. No real account, message, provider or scan.</p>
    </main>
  </div>,
);
