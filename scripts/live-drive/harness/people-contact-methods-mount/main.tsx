import { useState } from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "sonner";
import { PeopleContactEditor } from "@/components/tenant-relationships/PeopleContactEditor";
import { ContactMethodsList } from "@/components/contact-methods/ContactMethodsEditor";
import type { RelationshipPerson } from "@/components/tenant-relationships/useTenantRelationshipsData";
import "@/index.css";
import "@/components/tenant-shell/tenant-command-center-shell.css";
import "@/components/tenant-relationships/tenant-relationships-clients-workspace.css";

// Design fixture: an invented person, labelled as such. `?theme=light|dark`, `?view=record|editor|empty`.
const params = new URLSearchParams(window.location.search);
const theme = params.get("theme") === "light" ? "light" : "dark";
const view = params.get("view") ?? "editor";
// The shell's PAIGE dock narrows the content column; `?paige=open` sets the shell's own switch.
const paige = params.get("paige") === "open" ? "open" : "closed";
document.documentElement.setAttribute("data-pg", theme);
document.documentElement.classList.toggle("dark", theme === "dark");
document.documentElement.setAttribute("data-theme", theme);

const jordan = {
  id: "harness-contact-1", firstName: "Jordan", lastName: "Reyes", name: "Jordan Reyes", recordType: "person", entityType: null, company: "Reyes Build Co.",
  contactMethods: [
    { id: "e1", kind: "email", value: "jordan@reyesbuild.co", label: "Work", isPrimary: true },
    { id: "e2", kind: "email", value: "jordan.reyes.home@fastmail.com", label: "Personal", isPrimary: false },
    { id: "e3", kind: "email", value: "accounts@reyesbuild.co", label: "Billing", isPrimary: false },
    { id: "e4", kind: "email", value: "hello@reyesbuild.co", label: "Work", isPrimary: false },
    { id: "p1", kind: "phone", value: "+1 (512) 555-0148", label: "Mobile", isPrimary: true },
    { id: "p2", kind: "phone", value: "(512) 555-0190", label: "Work", isPrimary: false },
  ],
  email: "jordan@reyesbuild.co", phone: "+1 (512) 555-0148", title: null, website: null, linkedinUrl: null, streetAddress: null, city: null, state: null, zipCode: null,
  location: null, source: "referral", status: "active", tags: [], doNotContact: false, sharedContextConsent: false, linkedUserId: null, relationship: "client active",
  lifecycleStage: "client_active", primaryOffer: null, notes: null, assignedCoachUserId: null, owner: "Unassigned", lastTouch: null, createdAt: null, updatedAt: null,
} as RelationshipPerson;

function Harness() {
  const [open, setOpen] = useState(true);
  if (view === "record") {
    return <div className="trc-solo-people" style={{ padding: 24, background: "var(--pg-workspace)", minHeight: "100vh" }}><section className="trc-record-section" style={{ maxWidth: 860 }}><header><div><span>Identity</span><h3>Contact details</h3></div></header><div className="trc-record-methods"><ContactMethodsList methods={jordan.contactMethods} heardId={params.get("heard") ?? null} /></div></section></div>;
  }
  // Mounted in the shell's own chrome (as the Team harness is) so the PAIGE dock state changes the
  // content column exactly as it does in the app. People's container query needs .trc-solo-people.
  return (
    <div data-tenant-shell data-nav="expanded" data-paige={paige}>
      <nav className="tcs-nav" />
      <section className="tcs-canvas">
        <header className="tcs-command-row"><div className="tcs-context"><span>Clients / People · structural harness</span></div></header>
        <main id="tenant-shell-main" className="tcs-main">
          <div className="trc-workspace trc-workspace--people"><div className="trc-panel trc-panel--people">
            <div className="trc-solo-people" style={{ height: "100%" }}>
              {open ? <PeopleContactEditor open onOpenChange={setOpen} tenantId="harness-tenant" contact={view === "empty" ? null : jordan} onSaved={() => undefined} /> : <p style={{ color: "var(--pg-ink)" }}>Editor closed.</p>}
            </div>
          </div></div>
        </main>
      </section>
      <aside className="tcs-paige" hidden={paige !== "open"} aria-label="PAIGE dock (harness placeholder)"><div className="tcs-paige-header"><span style={{ color: "var(--pg-ink)" }}>PAIGE</span></div></aside>
      <Toaster />
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<Harness />);
