import { PaigePresence } from "@/components/paige/live/PaigePresence";
import { PaigeCommandMark } from "@/components/brand/PaigeCommandMark";
import "./solo-onboarding-stage.css";

export type OnboardingRecordState = "reading" | "ready" | "saving" | "unknown" | "reconciling" | "unavailable";
export type OnboardingProfileStatus = { tenantId: string | null; state: OnboardingRecordState; confirmedCount: number; hasConfirmedPriority?: boolean };

const LABEL: Record<OnboardingRecordState, string> = {
  reading: "Reading your saved business context",
  ready: "Ready for your next message",
  saving: "Saving your reviewed business details",
  unknown: "Save outcome needs verification",
  reconciling: "Checking the saved Setup record",
  unavailable: "Business context could not be verified",
};

/** Presentation of existing request/readback events. No microphone, model,
 * save, timer-driven completion or second progress store is started here. */
export function SoloOnboardingStage({ thinking, profile }: { thinking: boolean; profile: OnboardingProfileStatus | null }) {
  const state = profile?.state ?? "reading";
  const checking = state === "saving" || state === "reconciling" || state === "reading";
  const held = state === "unknown" || state === "unavailable";
  const presence = held ? "held" : checking ? "working" : thinking ? "thinking" : "ready";
  return <section className="sos" aria-label="Meet PAIGE" data-onboarding-state={presence}>
    <div className="sos-presence">
      <PaigePresence state={presence} />
      <div className="sos-mark" aria-hidden="true"><PaigeCommandMark plated={false} label={null} /></div>
    </div>
    <div className="sos-introduction">
      <h1>Meet PAIGE.</h1>
      <p>A conversation about your business.<br />A profile you can see and shape.</p>
      <div className="sos-state" role="status"><span aria-hidden="true" />{thinking && !checking && !held ? "PAIGE is preparing your response" : LABEL[state]}</div>
      <p className="sos-progress" data-empty={profile?.confirmedCount ? undefined : "true"}>{profile && profile.confirmedCount > 0
        ? `${held ? "Last verified: " : ""}${profile.confirmedCount} confirmed business ${profile.confirmedCount === 1 ? "detail" : "details"} in Setup`
        : "Your business profile takes shape as you confirm details."}</p>
    </div>
  </section>;
}
