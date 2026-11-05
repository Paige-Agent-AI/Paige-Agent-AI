import { useEffect, useRef, useState } from "react";
import { TriangleAlert, X } from "lucide-react";
import { IntegrationLogo } from "../../solo/integration-logos";
import { SOCIAL_PLATFORMS, type SocialPlatformDefinition } from "../../solo/social-platform-catalog";
import { OperatorSocialDrawer, useOperatorSocialDoor } from "./OperatorSocialDoor";
import "../../solo/settings-integrations.css";

/**
 * Settings → Integrations — the Platform Operator's connection home, built as the
 * SAME page the Solo shell ships (owner ruling 2026-11-05, mockup
 * `po-integrations-solo-shell.html`: "make the Platform Operator account
 * Integrations look just like the Solo Shell account").
 *
 * SAME PARTS, NOT AN IMITATION: this surface renders the Solo page's own markup
 * (`ss-subtabs`, `ig-bar` count chips, `ig-group` sections with their one-line
 * descriptions, `ig-grid` brand-tile cards) on the Solo page's own stylesheet,
 * imported above. The catalogue is the SAME FIXED LADDER of options every Solo
 * account sees — the same eleven Social platforms and the same provider groups —
 * so "every account gets the same fixed options" is literally what is on screen.
 *
 * WHAT IS DELIBERATELY ABSENT (owner, 2026-11-05): "There should be no reason
 * that I need to approve any of the Solo account." The per-workspace grants
 * matrix is gone — not hidden, deleted; it was never enforced outside its own
 * screen, so no invisible gate remains. The separate Company-channels and
 * Social-hub cards are gone too: their truth lives inside the Social cards,
 * exactly where the Solo page shows it. Social is connected ONCE, here, by the
 * God Level account (owner: "these Social integrations are ONLY for the
 * Platform Operator").
 *
 * HONEST STATES ONLY: an unread state asserts nothing ("Checking connection…",
 * "Status unavailable"); only provider-proven channels render as connected; a
 * card with no seam behind it says "Not available" rather than pretending a
 * path exists.
 */

/** The provider ladder — the same rows and groups the Solo page shows, with notes
 *  written for this audience: a seam that does not exist at platform level yet
 *  says so, rather than offering a connect that would quietly not work. */
type ProviderRow = {
  id: string;
  name: string;
  kind: string;
  group: GroupId;
  fallbackMark: string;
  note: string;
};

const PROVIDERS: ReadonlyArray<ProviderRow> = [
  { id: "n8n", name: "n8n", kind: "Automation", group: "automation", fallbackMark: "n8",
    note: "Solo workspaces connect their own n8n instances under their Settings → Integrations. A connection the platform itself runs on is not offered here yet." },
  { id: "mcp", name: "Zapier", kind: "Automation", group: "automation", fallbackMark: "za",
    note: "Solo workspaces authorize their own Zapier access under their Settings → Integrations. Platform-level Zapier is not offered here yet." },
  { id: "slack", name: "Slack", kind: "Team chat", group: "collaboration", fallbackMark: "Sl",
    note: "Solo workspaces connect their own Slack under their Settings → Integrations. Platform-level Slack is not offered here yet." },
  { id: "microsoft-teams", name: "Microsoft Teams", kind: "Team chat", group: "collaboration", fallbackMark: "Te",
    note: "A Teams connection needs an Azure AD app registration with Microsoft 365 admin consent — an owner and administrator step, not a switch Paige can flip." },
  { id: "stripe", name: "Stripe Connect", kind: "Commerce", group: "financial", fallbackMark: "St",
    note: "Each Solo workspace connects its own Stripe account to receive customer payments. A platform-level Stripe connection is not offered here yet." },
  { id: "paypal", name: "PayPal", kind: "Commerce", group: "financial", fallbackMark: "Pa",
    note: "PayPal customer payments run on the platform's approved seller-onboarding connection, which is not available yet." },
  { id: "quickbooks", name: "QuickBooks", kind: "Financial tools", group: "financial", fallbackMark: "QB",
    note: "The sync seams exist for workspaces, but nothing yet proves a connection belongs to the platform itself, so no setup is offered." },
  { id: "plaid", name: "Plaid", kind: "Financial tools", group: "financial", fallbackMark: "Pl",
    note: "Bank-link scaffolding exists but does not amount to a connection the platform owns." },
  { id: "docusign", name: "DocuSign", kind: "Documents", group: "documents", fallbackMark: "DS",
    note: "The signature seams are older than the tenant-safe rules this surface follows, so setup is not offered yet." },
  { id: "apollo", name: "Apollo", kind: "Client data", group: "client-data", fallbackMark: "Ap",
    note: "Enrichment settings are shared platform-wide, which cannot establish a per-platform connection here." },
  { id: "api", name: "Webhooks & direct API", kind: "Developer tools", group: "developer", fallbackMark: "{ }",
    note: "Platform webhook and key records are not the same thing as a connection shown on this page." },
];

/** The group ladder — the Solo page's own seven groups, labels, accents and
 *  one-line descriptions carried verbatim, so the two pages are one vocabulary. */
type GroupId = "automation" | "collaboration" | "social" | "financial" | "documents" | "client-data" | "developer";
const GROUPS: ReadonlyArray<{ id: GroupId; label: string; accent: string; blurb: string }> = [
  { id: "automation", label: "Automation", accent: "var(--k-automation)", blurb: "Run workflows and reach other apps." },
  { id: "collaboration", label: "Team chat", accent: "var(--k-integration)", blurb: "Workplace chat and channels." },
  { id: "social", label: "Social", accent: "var(--k-template)", blurb: "Post, schedule and read." },
  { id: "financial", label: "Finance", accent: "var(--k-integration)", blurb: "Invoices, payments and books." },
  { id: "documents", label: "Documents", accent: "var(--k-agent)", blurb: "Send, sign and track." },
  { id: "client-data", label: "Client data", accent: "var(--k-skill)", blurb: "Find and enrich contacts." },
  { id: "developer", label: "Developer", accent: "var(--pg-muted)", blurb: "Wire it up yourself." },
];

type Category = "all" | GroupId;

export default function IntegrationsSurface() {
  const door = useOperatorSocialDoor();
  const [category, setCategory] = useState<Category>("all");
  const [socialOpen, setSocialOpen] = useState<SocialPlatformDefinition | null>(null);
  const [providerOpen, setProviderOpen] = useState<ProviderRow | null>(null);

  /** One flat ladder of everything this page can show — the same fixed options every
   *  Solo account sees, in the Solo page's own group order. */
  const groups = GROUPS.map((group) => ({
    ...group,
    social: group.id === "social" ? SOCIAL_PLATFORMS : [],
    providers: PROVIDERS.filter((row) => row.group === group.id),
  }));
  const countOf = (id: GroupId) => {
    const group = groups.find((candidate) => candidate.id === id)!;
    return group.social.length + group.providers.length;
  };
  const total = groups.reduce((sum, group) => sum + group.social.length + group.providers.length, 0);
  const shown = (id: GroupId) => category === "all" || category === id;

  return (
    <div className="ss-integrations flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto overflow-x-hidden">
      {/* The Solo page's tab row, carried as shape: this console has one leaf, so
          the single tab is a place marker (aria-current), never a false control. */}
      <div className="ss-subtabs">
        <span className="ss-subtab" aria-current="page">Integrations</span>
      </div>

      <div className="ig-bar" role="group" aria-label="Filter integrations">
        <button type="button" aria-pressed={category === "all"} onClick={() => setCategory("all")}>
          <i className="ig-bar-dot" style={{ background: "var(--pg-violet)" }} aria-hidden />All
          <em>{total}</em>
        </button>
        {GROUPS.map((group) => (
          <button key={group.id} type="button" aria-pressed={category === group.id} onClick={() => setCategory(group.id)}>
            <i className="ig-bar-dot" style={{ background: group.accent }} aria-hidden />{group.label}
            <em>{countOf(group.id)}</em>
          </button>
        ))}
      </div>

      {door.notice && <p className="ig-note" role="status">{door.notice}</p>}

      {door.error && (
        <div className="ig-state" role="alert">
          <TriangleAlert aria-hidden />
          <span>{door.error} Each card below reports only its own available state.</span>
          <button type="button" className="ig-btn" onClick={() => void door.load()}>Try again</button>
        </div>
      )}

      {groups.filter((group) => shown(group.id) && countOf(group.id) > 0).map((group) => (
            <section key={group.id} className="ig-group" aria-label={group.label}>
              <div className="ig-group-head">
                <i className="ig-bar-dot" style={{ background: group.accent }} aria-hidden />
                <b>{group.label}</b><em>{group.blurb}</em><i className="ig-group-rule" aria-hidden />
              </div>
              {group.id === "social" && (
                <p className="ig-category-note">
                  These connections belong to the platform itself. Connect each platform with its own secure sign-in —
                  every account in Paige gets the same fixed options as this one, and nothing is approved or withheld from here.
                </p>
              )}
              <ul className="ig-grid">
                {group.social.map((platform) => {
                  const state = platform.oauthAvailable
                    ? door.cardState(platform.key)
                    : { account: "OAuth unavailable", tone: "neutral" as const };
                  return (
                    <li key={`social-${platform.key}`}>
                      <button type="button" className="ig-card social-platform-card" data-provider={`social-${platform.key}`}
                        onClick={() => setSocialOpen(platform)} aria-haspopup="dialog">
                        <IntegrationLogo id={platform.key} fallback={platform.mark} />
                        <span className="ig-card-title"><strong>{platform.name}</strong></span>
                        <span className="ig-card-foot">
                          <span className="ig-card-state" data-tone={state.tone}><i aria-hidden />{state.account}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
                {group.providers.map((row) => (
                  <li key={row.id}>
                    <button type="button" className="ig-card" data-provider={row.id} onClick={() => setProviderOpen(row)} aria-haspopup="dialog">
                      <IntegrationLogo id={row.id} fallback={row.fallbackMark} />
                      <span className="ig-card-title"><strong>{row.name}</strong></span>
                      <span className="ig-card-foot">
                        <span className="ig-card-state" data-tone="neutral"><i aria-hidden />Not available</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}

      {socialOpen && <OperatorSocialDrawer key={`social-${socialOpen.key}`} platform={socialOpen} door={door} onClose={() => setSocialOpen(null)} />}
      {providerOpen && <ProviderNoteDrawer row={providerOpen} onClose={() => setProviderOpen(null)} />}
    </div>
  );
}

/** A provider card's drawer: the honest reason a platform-level connection is not
 *  offered, in the surface family's drawer chrome. No form, no pretense. */
function ProviderNoteDrawer({ row, onClose }: { row: ProviderRow; onClose: () => void }) {
  const panel = useRef<HTMLElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    close.current?.focus();
    return () => { if (opener && document.contains(opener)) opener.focus(); };
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); return; }
      if (event.key !== "Tab") return;
      const root = panel.current;
      if (!root) return;
      const items = Array.from(root.querySelectorAll<HTMLElement>('button, [tabindex="0"]'))
        .filter((item) => !item.hasAttribute("disabled") && item.tabIndex !== -1 && item.offsetParent !== null);
      if (!items.length) return;
      if (!root.contains(document.activeElement)) { event.preventDefault(); items[0].focus(); }
      else if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items[items.length - 1].focus(); }
      else if (!event.shiftKey && document.activeElement === items[items.length - 1]) { event.preventDefault(); items[0].focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="ig-layer" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <aside className="ig-panel" ref={panel} role="dialog" aria-modal="true" aria-labelledby="op-provider-note-title">
        <header>
          <IntegrationLogo id={row.id} fallback={row.fallbackMark} />
          <div><h2 id="op-provider-note-title">{row.name}</h2><span>{row.kind}</span></div>
          <button ref={close} className="ig-close" type="button" aria-label={`Close ${row.name}`} onClick={onClose}><X aria-hidden size={16} /></button>
        </header>
        <div className="ig-panel-body">
          <p className="ig-lede">{row.note}</p>
          <p className="ig-note">Setting this up is not offered here yet, rather than offered and quietly not working.</p>
        </div>
        <footer><span>No credentials or provider payloads are shown here.</span></footer>
      </aside>
    </div>
  );
}
