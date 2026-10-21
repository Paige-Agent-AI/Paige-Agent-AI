import { createRoot } from "react-dom/client";
import { MarkdownMessage } from "@/components/chat/MarkdownMessage";
import { PaigeRecordLinks } from "@/components/chat/PaigeRecordLinks";
import { workspaceLinkTargets } from "@/lib/links/workspaceLinks";
import { readRecordLinks } from "../../../../supabase/functions/_shared/paige-turn/record-links";
import uiFont from "../../../../public/fonts/schibsted-grotesk/schibsted-grotesk-latin-wght-normal.woff2?url";
import "@/index.css";
import "@/solo/solo-tokens.css";

// Actual existing renderers and product font; synthetic source/account inputs only.
const query = new URLSearchParams(location.search);
const theme = query.get("theme") === "dark" ? "dark" : "light";
const unavailable = query.get("state") === "unavailable";
document.documentElement.classList.toggle("dark", theme === "dark");
document.documentElement.setAttribute("data-pg", theme);
const account = { account_type: "standalone", parent_tenant_id: query.get("state") === "parented" ? "test-parent" : null, account_number: "7001" };
const links = readRecordLinks(unavailable ? [] : [{ destination: "conversations", record_id: null }]);
const verifiedAppPaths = workspaceLinkTargets(links, account).map(target => target.to);
const content = unavailable
  ? "The message source could not be verified. [Open Conversations](/app/conversations). No result or action is inferred."
  : "The permitted inbox sample is available; it is not a business total. [Open Conversations](/app/conversations).\n\nA [source citation](https://example.org/research) remains available. Nothing was sent or changed.";
createRoot(document.getElementById("root")!).render(
  <div data-pg={theme} style={{ minHeight: "100vh", background: "var(--pg-canvas)", color: "var(--pg-ink)", fontFamily: "var(--pg-font-ui)" }}>
    <style>{`@font-face{font-family:"Schibsted Grotesk";font-style:normal;font-weight:100 900;src:url("${uiFont}") format("woff2");font-display:swap}`}</style>
    <main style={{ maxWidth: 720, padding: 24, margin: "0 auto", boxSizing: "border-box", fontSize: 15, lineHeight: 1.6 }}>
      <h1 style={{ fontSize: 24, fontWeight: 600, marginBottom: 20 }}>Message review</h1>
      <MarkdownMessage content={content} verifiedAppPaths={verifiedAppPaths} />
      <PaigeRecordLinks links={links} account={account} />
      <p style={{ marginTop: 32, color: "var(--pg-ink-2)", fontSize: 13 }}>Synthetic reference preview. No real account, message, provider or action.</p>
    </main>
  </div>,
);
