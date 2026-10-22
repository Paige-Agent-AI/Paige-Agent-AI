import { Volume2 } from "lucide-react";
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
 * save, timer-driven completion or second progress store is started here.
 * The voice entry only REQUESTS the existing Live Conversation surface; that
 * surface owns permission, terms and every audio state. */
export function SoloOnboardingStage({ thinking, profile, onResumeProfile, profileOpen, onTalkLive }: { thinking: boolean; profile: OnboardingProfileStatus | null; onResumeProfile?: () => void; profileOpen?: boolean; onTalkLive?: () => void }) {
  const state = profile?.state ?? "reading";
  const checking = state === "saving" || state === "reconciling" || state === "reading";
  const held = state === "unknown" || state === "unavailable";
  const presence = held ? "held" : checking ? "working" : thinking ? "thinking" : "ready";
  return <section className="sos" aria-label="PAIGE onboarding progress" data-onboarding-state={presence}>
    <div className="sos-presence">
      <PaigePresence state={presence} />
      <div className="sos-mark" aria-hidden="true"><PaigeCommandMark plated={false} label={null} /></div>
    </div>
    <div className="sos-introduction">
      <div className="sos-state" role="status"><span aria-hidden="true" />{thinking && !checking && !held ? "PAIGE is preparing your response" : LABEL[state]}</div>
      {onTalkLive && <div className="sos-voice-entry">
        <button type="button" className="sos-voice" disabled={thinking} onClick={onTalkLive}><Volume2 aria-hidden />Talk with Paige live</button>
        <p>Same conversation — she speaks and listens. Before anything starts, Paige explains what the speech provider keeps and your browser asks for microphone permission. Minimize Live any time to keep typing.</p>
      </div>}
      {onResumeProfile
        ? <button type="button" className="sos-progress sos-progress--link" data-empty={profile?.confirmedCount ? undefined : "true"} aria-expanded={profileOpen} onClick={onResumeProfile}>{profile && profile.confirmedCount > 0
            ? `${held ? "Last verified: " : ""}${profile.confirmedCount} confirmed business ${profile.confirmedCount === 1 ? "detail" : "details"} in Setup`
            : "Your business profile takes shape as you confirm details."}</button>
        : <p className="sos-progress" data-empty={profile?.confirmedCount ? undefined : "true"}>{profile && profile.confirmedCount > 0
            ? `${held ? "Last verified: " : ""}${profile.confirmedCount} confirmed business ${profile.confirmedCount === 1 ? "detail" : "details"} in Setup`
            : "Your business profile takes shape as you confirm details."}</p>}
    </div>
  </section>;
}
