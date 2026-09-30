import { Component, Suspense, lazy, useEffect, useRef, useState, type ReactNode } from "react";
import { PaigePresence } from "./PaigePresence";
import { SILENT_ENERGY, type AudioEnergy, type PresenceState } from "@/lib/paigeLiveConversation/presence";
import { supportsWebGL } from "@/lib/webgl";
import "./paige-presence-3d.css";

/**
 * The live wave presence, with the flat presence underneath it as a real fallback rather than a blank.
 *
 * §58 — the flat presence is NOT removed. It is what renders when WebGL is absent and when the
 * scene throws. A corner of the Live stage with nothing in it would be worse than the simpler design.
 *
 * §32 — a failure here is LOUD. The cycle this contract exists to break is a boundary that renders
 * null on a throw, so a runtime crash and "it just didn't populate" look identical and cost hours.
 * Every degrade path logs its cause and then shows something.
 *
 * The scene is behind `lazy` so three.js is fetched when someone opens Live and never for anyone who
 * does not. It no longer downloads a model at all: the presence is now geometry and a shader built
 * at runtime, so the 3.87 MB GLB this wrapper used to wait on is gone from the surface entirely.
 */

const PaigePresenceScene = lazy(() => import("./PaigePresenceScene"));

class SceneBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown, info: unknown) {
    // Never silent. A blank corner with no console line is how a compiles-but-crashes bug hides.
    console.error("[PaigePresence3D] the 3D presence crashed — falling back to the flat presence. Cause:", error, info);
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export interface PaigePresence3DProps {
  state: PresenceState;
  visible?: boolean;
  /** Read only from the actual output/microphone analyser. Never a generated speech timer. */
  readEnergy?: () => AudioEnergy;
}

export function PaigePresence3D({ state, visible = true, readEnergy = () => SILENT_ENERGY }: PaigePresence3DProps) {
  const [reduced, setReduced] = useState(false);
  const [webgl, setWebgl] = useState<boolean | null>(null);
  // Set when the scene tells us it cannot keep going: a loop throw, or the browser taking the
  // context away. Neither reaches an error boundary, and both end with a frozen or blank canvas
  // unless something stands the flat presence back up.
  const [sceneFailed, setSceneFailed] = useState(false);
  const frame = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // The stage is portaled into a pop-out window on "Open in window", so the preference and the
    // probe belong to THAT document, not to the opener. The flat presence has always read its own
    // realm this way; the first draft of this wrapper used the bare globals and lost that care.
    const view = frame.current?.ownerDocument.defaultView ?? window;
    const media = view.matchMedia?.("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(media?.matches ?? false);
    sync();
    media?.addEventListener("change", sync);
    setWebgl(supportsWebGL());
    return () => media?.removeEventListener("change", sync);
  }, []);

  // A LOST CONTEXT DOES NOT THROW. The browser caps live WebGL contexts and evicts the oldest by
  // firing this event; without a listener the canvas simply goes blank, the boundary never fires,
  // and nothing is logged — the empty corner with no signal that this whole component exists to
  // make impossible. Listening at the wrapper catches it wherever inside the canvas it happens.
  useEffect(() => {
    const node = frame.current;
    if (!node || webgl !== true) return;
    const onLost = (event: Event) => {
      event.preventDefault();
      console.error("[PaigePresence3D] the WebGL context was lost — standing down to the flat presence.");
      setSceneFailed(true);
    };
    node.addEventListener("webglcontextlost", onLost, true);
    return () => node.removeEventListener("webglcontextlost", onLost, true);
  }, [webgl]);

  const flat = <PaigePresence state={state} visible={visible} readEnergy={readEnergy} />;
  // Until the capability check has run, whenever it says no, and once the scene has told us it
  // cannot continue, the approved design stands. Note the wrapper still renders in the failed case
  // so its own realm-aware effects keep their node; the flat presence sits inside the same frame.
  if (webgl !== true) return flat;

  return (
    <div ref={frame} className="paige-presence-3d" data-presence-state={state} data-motion={reduced ? "reduced" : "ambient"} aria-hidden="true">
      {sceneFailed ? <div className="paige-presence-3d__await">{flat}</div> : (
      <SceneBoundary fallback={flat}>
        {/* While the model streams, the flat presence holds the frame — so the corner is never empty
            and the transition is a deepening rather than a pop-in from nothing. */}
        <Suspense fallback={<div className="paige-presence-3d__await">{flat}</div>}>
          <PaigePresenceScene
            state={state}
            reduced={reduced}
            readEnergy={visible ? readEnergy : () => SILENT_ENERGY}
            onCrash={() => setSceneFailed(true)}
          />
        </Suspense>
      </SceneBoundary>
      )}
    </div>
  );
}
