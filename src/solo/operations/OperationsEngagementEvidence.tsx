import { inspectEngagementReadiness } from "./operations-engagement-readiness";
import { useOperationsEngagementEvidence } from "./useOperationsEngagementEvidence";
import type { ComponentProps } from "react";
import { OperationsEngagementHandoff } from "./OperationsEngagementHandoff";

type Props = { actorId: string; tenantId: string; signingId: string; contactId: string;
  commercialTermsId: string; offerId: string | null;
  handoff?: Omit<ComponentProps<typeof OperationsEngagementHandoff>, "evidence"> };

/** Inspect frozen Sales provenance; this read never creates a project or authorizes fulfillment. */
export function OperationsEngagementEvidence(props: Props) {
  const read = useOperationsEngagementEvidence(props.actorId, props.tenantId, props.signingId);
  if (read.loading) return <p role="status">Checking the signed scope…</p>;
  if (read.error) return <div><p role="alert">{read.error}</p><button type="button" onClick={() => void read.refresh()}>Check evidence again</button></div>;
  const result = inspectEngagementReadiness(read.evidence, props);
  const titles = {
    unavailable: "Signing evidence is unavailable",
    source_mismatch: "The signing does not match this engagement",
    signing_incomplete: "Signing is still in progress",
    sealed_evidence_unavailable: "The sealed signing evidence is incomplete",
    ready_for_scope_review: "Signed scope ready for review",
  };
  return <section className="op-delivery-signing" aria-label="Frozen signing evidence">
    <strong>{titles[result.state]}</strong>
    {result.source && <p>Version {result.source.version} · sealed copy recorded</p>}
    <p>No delivery project or client acceptance is confirmed by this signing check.</p>
    {result.state === "ready_for_scope_review" && read.evidence && props.handoff
      && <OperationsEngagementHandoff key={JSON.stringify([props.handoff.scope, read.evidence])}
        {...props.handoff} evidence={read.evidence} />}
  </section>;
}
