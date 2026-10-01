import { describe, expect, it } from "vitest";
import { presenceFrame, resolvePresenceState, SILENT_ENERGY, type PresenceState } from "./presence";

describe("truthful Paige Presence", () => {
  it("never derives speaking or listening from text or an unverified session", () => {
    expect(resolvePresenceState({ phase: "speaking", outputPlaying: false })).toBe("ready");
    expect(resolvePresenceState({ phase: "listening", microphoneActive: false })).toBe("ready");
    expect(resolvePresenceState({ phase: "unavailable", working: true })).toBe("working");
    expect(resolvePresenceState({ phase: "unavailable", working: false })).toBe("unavailable");
  });
  it("preserves honest terminal and damped states", () => {
    for (const phase of ["held", "interrupted", "unavailable", "disconnected"] as const) {
      expect(resolvePresenceState({ phase, outputPlaying: true, microphoneActive: true })).toBe(phase);
      expect(presenceFrame(phase, 2, { amplitude: 1, brightness: 1 }).energy).toBe(0);
    }
  });
  it("morphs an irregular idle silhouette, with no invented audio energy", () => {
    const a = presenceFrame("ready", 0);
    const b = presenceFrame("ready", 4);
    expect(a.path).not.toBe(b.path);
    expect(a.energy).toBe(0);
    expect(a.path).toContain("C");
    expect(a.path).not.toContain("NaN");
  });
  it("real normalized analyzer samples change speaking deformation and light", () => {
    const quiet = presenceFrame("speaking", 2, { amplitude: 0, brightness: 0 });
    const loud = presenceFrame("speaking", 2, { amplitude: .8, brightness: .5 });
    expect(loud.path).not.toBe(quiet.path);
    expect(loud.light).toBeGreaterThan(quiet.light);
    expect(loud.energy).toBe(.8);
    expect(presenceFrame("speaking", 2, { amplitude: NaN, brightness: Infinity }).energy).toBe(0);
  });
  it("makes unavailable and ready ambient motion perceptible within two seconds without fake audio", () => {
    for (const state of ["ready", "unavailable"] as const) {
      const first = presenceFrame(state, 0), later = presenceFrame(state, 2);
      expect(Math.abs(later.drift - first.drift)).toBeGreaterThan(5);
      expect(Math.abs(later.turn - first.turn)).toBeGreaterThan(3);
      expect(later.energy).toBe(0);
      const a = first.path.match(/-?\d+\.\d+/g)!.map(Number);
      const b = later.path.match(/-?\d+\.\d+/g)!.map(Number);
      expect(Math.max(...a.map((n, i) => Math.abs(n - b[i])))).toBeGreaterThan(6);
    }
  });

  // The 3D presence (PaigePresenceScene) drives every animated value — position, rotation, scale,
  // emissive intensity, the halo's opacity — from this one function. Two of those, `drift` and
  // `turn`, are timers and DO move in silence: that is the owner-approved flat presence's own
  // ambient behaviour, carried over rather than introduced, and it is identity, not a claim about
  // hearing. What must never move without audio is the energy term, which is the only thing scale,
  // the halo's opacity and the emissive lift key off. So these assertions are about energy
  // specifically, and the test above is named for what it actually proves. That makes them the
  // assertions the thing standing between "she reacts when you speak" and a scene that moves on a
  // timer and merely LOOKS like it is listening. The 3D smoke cannot make them: it runs on CI's
  // Node 20, which has no type stripping, so importing this module there would have skipped them
  // silently. They live here instead, where they actually execute.
  it("no AUDIO-DERIVED cue moves without audio: silence produces zero energy in every state", () => {
    const states: PresenceState[] = ["ready", "listening", "thinking", "working", "speaking", "held", "interrupted", "unavailable", "disconnected"];
    for (const state of states) {
      for (const seconds of [0, 1.7, 3.5, 11]) {
        expect(presenceFrame(state, seconds, SILENT_ENERGY).energy).toBe(0);
      }
    }
  });

  it("...and a real sample does drive it, so the scene is not merely inert", () => {
    expect(presenceFrame("speaking", 3.5, { amplitude: 0.8, brightness: 0.5 }).energy).toBeGreaterThan(0);
    expect(presenceFrame("listening", 3.5, { amplitude: 0.42, brightness: 0.2 }).energy).toBeGreaterThan(0);
    // A sample arriving in a state that is not speaking or listening is still silence: Paige is not
    // hearing anything, so nothing about her may imply she is.
    expect(presenceFrame("thinking", 3.5, { amplitude: 0.9, brightness: 0.9 }).energy).toBe(0);
    expect(presenceFrame("held", 3.5, { amplitude: 0.9, brightness: 0.9 }).energy).toBe(0);
  });
});
