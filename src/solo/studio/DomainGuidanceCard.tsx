import { useId, useState } from "react";

import {
  PROVIDER_PROFILES,
  HOST_PATH_PACKAGE,
  HOST_PATH_COST_LINE,
  DNS_PRESERVATION_LINE,
  MAIL_AND_AUTHORITY_RECORDS,
  classifyWebDomain,
  type WebDomainObservations,
} from "./domain-guidance";
import { prepareHostingDeployment, type HostingPrepared } from "./studio-data";

/**
 * "Use my own address" — the custom-domain guidance disclosure in the publish panel's live
 * views (EXP06 PR7 — WEB-05/06/07). Guidance and truthful state ONLY: it names the reserved
 * address's real status, walks the six provider profiles, pins the mail records nobody touches,
 * and lays out the owner-gated host path. The host path's "host it" step asks the ONE hosting
 * door (growth-hosting-command) what is true — today it answers that hosting isn't switched on
 * yet, and that sentence is shown verbatim; when the platform enables the service the same
 * check carries the owner's approval card. Nothing here contacts a provider or approves
 * anything on its own.
 */
export function DomainGuidanceCard({ tenantSlug, pageId, observations }: {
  tenantSlug: string;
  /** The PUBLISHED page this panel is hosting-eligible for (drives the door's deploy check). */
  pageId?: string;
  /** The current facts. Unsupplied = the honest starting state everywhere today: no custom
   *  address, reserved address's live status unknown from here (never claimed). */
  observations?: Partial<WebDomainObservations>;
}) {
  const selectId = useId();
  const [providerId, setProviderId] = useState<string>(PROVIDER_PROFILES[0].id);
  const provider = PROVIDER_PROFILES.find((p) => p.id === providerId) ?? PROVIDER_PROFILES[0];
  const [hostingCheck, setHostingCheck] = useState<HostingPrepared | null>(null);
  const [hostingChecking, setHostingChecking] = useState(false);

  const checkHosting = async () => {
    if (!pageId || hostingChecking) return;
    setHostingChecking(true);
    setHostingCheck(null);
    try {
      setHostingCheck(await prepareHostingDeployment(pageId));
    } catch (e) {
      setHostingCheck({ state: "refused", message: e instanceof Error ? e.message : "Hosting couldn't be checked just now. Nothing was changed." });
    } finally {
      setHostingChecking(false);
    }
  };

  const cls = classifyWebDomain({
    reservedAddress: `${tenantSlug}.paigeagent.ai`,
    // A published artifact proves the artifact's own URL (the link at the top of this pop) —
    // never that the reserved host root serves. Unobserved stays unobserved: the classifier
    // then claims nothing about the reserved address in either direction (spine rule:
    // reserved infrastructure is never called connected or live from a publication receipt).
    reservedWebLive: null,
    customDomain: null,
    ownershipTxtSeen: false,
    dnsAuthorityElsewhere: null,
    routingRecordSeen: false,
    sslVerified: false,
    recordConflict: false,
    revoked: false,
    ownerAuthorization: "none",
    ...observations,
  });

  return (
    <details className="vs-domain-card">
      <summary>Use my own address</summary>
      <div className="vs-domain-state">
        <p><strong>{cls.headline}</strong></p>
        <p>{cls.detail}</p>
        <p className="vs-domain-next">{cls.nextStep}</p>
      </div>
      <div className="vs-domain-providers">
        <label htmlFor={selectId}>Where is your domain?</label>
        <select id={selectId} value={providerId} onChange={(e) => setProviderId(e.target.value)}>
          {PROVIDER_PROFILES.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <p><strong>Proving ownership:</strong> {provider.txtWhere}</p>
        <p><strong>Pointing it here:</strong> {provider.routingWhere}</p>
        <p className="vs-domain-note">{provider.authorityNote}</p>
      </div>
      <p className="vs-domain-mail">
        Untouched by all of this: {MAIL_AND_AUTHORITY_RECORDS.join(", ")}. {DNS_PRESERVATION_LINE}
      </p>
      <div className="vs-domain-hostpath">
        <p><strong>Prefer to host it yourself?</strong> The path, when you want it:</p>
        <ul>
          {HOST_PATH_PACKAGE.map((s) => <li key={s.title}><strong>{s.title}</strong> — {s.detail}</li>)}
        </ul>
        {pageId && (
          <p className="vs-domain-hosting-check">
            <button type="button" className="vs-link" onClick={checkHosting} disabled={hostingChecking}>
              {hostingChecking ? "Checking hosting…" : "Check hosting for this page"}
            </button>
            {hostingCheck && (
              <span className="vs-domain-hosting-answer" data-hosting-state={hostingCheck.state}>
                {hostingCheck.state === "ready"
                  ? `${hostingCheck.summary ?? "Put a hosted copy of this page online."} — review it in your approvals.`
                  : hostingCheck.message}
              </span>
            )}
          </p>
        )}
        <p className="vs-domain-note">{HOST_PATH_COST_LINE}</p>
      </div>
    </details>
  );
}
