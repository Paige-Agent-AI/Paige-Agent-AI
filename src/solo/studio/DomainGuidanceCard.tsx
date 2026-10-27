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

/**
 * "Use my own address" — the custom-domain guidance disclosure in the publish panel's live
 * views (EXP06 PR7 — WEB-05/06/07). Guidance and truthful state ONLY: it names the reserved
 * address's real status, walks the six provider profiles, pins the mail records nobody touches,
 * and lays out the owner-gated host path. It contacts nothing and approves nothing — the entry
 * point to any real action is the owner's own chat with Paige, through the governed door.
 */
export function DomainGuidanceCard({ tenantSlug, observations }: {
  tenantSlug: string;
  /** The current facts. Unsupplied = the honest starting state everywhere today: no custom
   *  address, reserved address's live status unknown from here (never claimed). */
  observations?: Partial<WebDomainObservations>;
}) {
  const selectId = useId();
  const [providerId, setProviderId] = useState<string>(PROVIDER_PROFILES[0].id);
  const provider = PROVIDER_PROFILES.find((p) => p.id === providerId) ?? PROVIDER_PROFILES[0];

  const cls = classifyWebDomain({
    reservedAddress: `${tenantSlug}.paigeagent.ai`,
    reservedWebLive: true, // this card only renders inside a live view: the reserved address IS serving
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
        <p className="vs-domain-note">{HOST_PATH_COST_LINE}</p>
      </div>
    </details>
  );
}
