// Fictional, isolated content proof. No session, provider client or approval executor.
import { createRoot } from "react-dom/client";
import { PaigeConfirmCard } from "@/components/chat/PaigeConfirmCard";
import { GovernedReplyStrip } from "@/pages/admin/conversations/GovernedReplyStrip";

const email = { kind:"email" as const, to_address:"client@example.invalid", from_address:"owner@example.invalid", subject:"Original saved email", body_text:"Welcome. Read your offer.",
  body_html:'<p><strong>Welcome.</strong> <a href="https://offer.example.invalid/terms">Read your offer.</a></p><img src="https://tracking.example.invalid/pixel" onerror="window.__exp03Danger=true"><script>window.__exp03Danger=true</script><style>@import "https://tracking.example.invalid/css";</style><iframe src="https://tracking.example.invalid/frame"></iframe><form action="https://tracking.example.invalid/form"><input autofocus onfocus="window.__exp03Danger=true"></form><div style="background:url(https://tracking.example.invalid/style)">Original footer.</div>' };
const noop = () => {};
createRoot(document.getElementById("root")!).render(<main>
  <section aria-label="Original shared card"><PaigeConfirmCard actions={[{summary:"Review the saved email",fingerprint:"0123456789abcdef",preview:email}]} /></section>
  <section aria-label="Original inline check"><GovernedReplyStrip state={{phase:"check",fromName:"Example business",sending:false,check:{fingerprint:"0123456789abcdef",deadlineMs:Date.now()+600_000,uncertain:false,preview:email,when:null,files:[]}}} onEdit={noop} onConfirm={noop} onAction={noop} onChooseSender={noop} settingsHref="/settings" /></section>
</main>);
