import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { RelayTransport } from "@/lib/paigeLiveConversation/relayTransport";
import { messageTts } from "@/lib/voice/messageTts";
import { observePlayedAudio } from "@/lib/paigeLiveConversation/outputAnalysis";
import { SILENT_ENERGY } from "@/lib/paigeLiveConversation/presence";

/** One output owner, no synthesis/network/provider shortcut. Only the active conversation's
 * actual playing message can drive this Presence. A realtime transport must join that same owner. */
export function usePaigeOutput(visible: boolean, messageIds: readonly string[]) {
  const [relay, setRelay] = useState<RelayTransport | null>(null);
  const relayRef = useRef(relay);
  relayRef.current = relay;
  const attachRelay = useCallback((source: RelayTransport | null) => setRelay(source), []);
  const subscribeRelay = useCallback((listener: () => void) => relay?.subscribeOutput(listener) ?? (() => {}), [relay]);
  const relayPlaying = useSyncExternalStore(subscribeRelay, () => relay?.outputPlaying() ?? false, () => false);
  const snapshot = useSyncExternalStore(messageTts.subscribe, messageTts.getSnapshot, messageTts.getSnapshot);
  const [playing, setPlaying] = useState(false);
  const observer = useRef<ReturnType<typeof observePlayedAudio> | null>(null);
  const belongs = snapshot.activeId !== null && messageIds.includes(snapshot.activeId);
  // Keep the last owned output lease until stopped. A thread-change render must not turn old
  // session cleanup into a no-op, or let it stop a different conversation's newer output.
  const ownedId = useRef<string | null>(null);
  if (belongs) ownedId.current = snapshot.activeId;
  useEffect(() => {
    const audio = messageTts.getAudioElement();
    if (visible && belongs && snapshot.status === "playing" && audio) observer.current = observePlayedAudio(audio, setPlaying);
    else setPlaying(false);
    return () => { observer.current?.dispose(); observer.current = null; };
  }, [visible, belongs, snapshot.activeId, snapshot.status]);
  const readEnergy = useRef(() => relayRef.current?.outputPlaying()
    ? relayRef.current.readEnergy() : observer.current?.readEnergy() ?? SILENT_ENERGY).current;
  const ownsCurrent = () => ownedId.current !== null && messageTts.getSnapshot().activeId === ownedId.current;
  return { playing: visible && (relayPlaying || (belongs && playing)), readEnergy, attachRelay,
    stop: () => { relayRef.current?.clearOutput(); if (ownsCurrent()) messageTts.stop(); ownedId.current = null; },
    pause: () => { relayRef.current?.pauseOutput(); if (ownsCurrent()) messageTts.pause(); },
    resume: () => { relayRef.current?.resumeOutput(); if (ownsCurrent()) void messageTts.resume(); },
  };
}
