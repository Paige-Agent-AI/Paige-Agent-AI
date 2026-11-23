import { useEffect, useRef } from "react";
import { PaigeCommandMark } from "@/components/brand/PaigeCommandMark";
import type { AudioEnergy } from "@/lib/paigeLiveConversation/presence";
import { createMeetPaigeGalaxy, MEET_PAIGE_INTRO_MS } from "./meetPaigeGalaxy";

const GALAXY_PIXEL_BUDGET = 1_500_000;
const WAVE_SAMPLE_MS = 1000 / 30;
const REDUCED_WAVE_SAMPLE_MS = 100;

function sizeCanvas(canvas: HTMLCanvasElement, context: CanvasRenderingContext2D, width: number, height: number, pixelBudget = Infinity) {
  if (!width || !height) return null;
  const ratio = Math.min(canvas.ownerDocument.defaultView?.devicePixelRatio || 1, 1.55, Math.sqrt(pixelBudget / (width * height)));
  const wide = Math.round(width * ratio), tall = Math.round(height * ratio);
  if (canvas.width !== wide) canvas.width = wide;
  if (canvas.height !== tall) canvas.height = tall;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  return { width, height };
}

function observeCanvasSize(element: HTMLElement, view: Window & typeof globalThis, resize: () => void) {
  let resolution = view.matchMedia(`(resolution: ${view.devicePixelRatio}dppx)`);
  const resolutionChanged = () => {
    resolution.removeEventListener("change", resolutionChanged);
    resolution = view.matchMedia(`(resolution: ${view.devicePixelRatio}dppx)`);
    resolution.addEventListener("change", resolutionChanged);
    resize();
  };
  resolution.addEventListener("change", resolutionChanged);
  const observer = typeof view.ResizeObserver === "function" ? new view.ResizeObserver(resize) : null;
  observer?.observe(element);
  view.addEventListener("resize", resize);
  return () => {
    resolution.removeEventListener("change", resolutionChanged);
    observer?.disconnect();
    view.removeEventListener("resize", resize);
  };
}

export function PaigeFilmPresence({ intro, held }: { intro: boolean; held: boolean }) {
  const presenceRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const orbitRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const presence = presenceRef.current;
    const scene = sceneRef.current;
    const canvas = canvasRef.current;
    const orbits = orbitRef.current;
    const document = canvas?.ownerDocument;
    const view = document?.defaultView;
    if (!presence || !scene || !canvas || !orbits || !view || !document || typeof view.CanvasRenderingContext2D !== "function") return;
    const stars = canvas.getContext("2d");
    const rings = orbits.getContext("2d");
    if (!stars || !rings) return;
    const paint = createMeetPaigeGalaxy(stars, rings);
    let previousSize = 0;
    let previousRatio = 0;
    let previousCompact = false;

    const resize = () => {
      const { clientWidth: width, clientHeight: height } = presence;
      const size = Math.round(Math.min(width * .32, height * .335) * 3.08);
      const compact = width < 650;
      const ratio = view.devicePixelRatio;
      if (!size || (size === previousSize && ratio === previousRatio && compact === previousCompact)) return;
      previousSize = size;
      previousRatio = ratio;
      previousCompact = compact;
      scene.style.width = `${size}px`;
      scene.style.top = compact ? "36%" : "40%";
      sizeCanvas(canvas, stars, size, size, GALAXY_PIXEL_BUDGET);
      sizeCanvas(orbits, rings, size, size, GALAXY_PIXEL_BUDGET);
      paint(size, compact);
    };
    const updateVisibility = () => {
      presence.dataset.hidden = String(document.hidden);
    };
    const stopObservingSize = observeCanvasSize(presence, view, resize);
    document.addEventListener("visibilitychange", updateVisibility);
    updateVisibility();
    resize();
    return () => {
      stopObservingSize();
      document.removeEventListener("visibilitychange", updateVisibility);
    };
  }, []);

  return (
    <div ref={presenceRef} className="plc-film-presence" data-held={held} aria-hidden="true">
      <div ref={sceneRef} className="plc-film-galaxy-scene" data-arriving={intro}>
        <div className="plc-film-galaxy-reveal">
          <canvas ref={canvasRef} className="plc-film-galaxy" />
          <canvas ref={orbitRef} className="plc-film-orbits" />
        </div>
      </div>
      {intro && <>
        <div className="plc-film-mark-flight" style={{ animationDuration: `${MEET_PAIGE_INTRO_MS}ms` }}>
          <div className="plc-film-mark">
            <PaigeCommandMark className="plc-film-mark__depth" plated={false} label={null} />
            <PaigeCommandMark className="plc-film-mark__face" plated={false} label={null} />
          </div>
        </div>
        <span className="plc-film-command">Listen</span>
        <span className="plc-film-command">Understand</span>
        <span className="plc-film-command">Prepare</span>
      </>}
    </div>
  );
}

export function PaigeFilmAudioStream({ playing, readEnergy }: {
  playing: boolean;
  readEnergy: () => AudioEnergy;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const document = canvas?.ownerDocument;
    const view = document?.defaultView;
    if (!canvas || !view || !document || typeof view.CanvasRenderingContext2D !== "function") return;
    const ink = canvas.getContext("2d");
    if (!ink) return;
    const reduce = view.matchMedia("(prefers-reduced-motion: reduce)");
    const samples = new Float32Array(52);
    let first = 0;
    let frame: number | null = null;
    let lastSample: number | null = null;
    let bounds: ReturnType<typeof sizeCanvas> = null;
    let gradient: CanvasGradient;
    let progress = 1;

    const paint = () => {
      if (!bounds) return;
      const { width, height } = bounds;
      ink.clearRect(0, 0, width, height);
      ink.strokeStyle = gradient;
      ink.lineCap = "round";
      ink.lineWidth = 1.5;
      const columns = Math.max(2, Math.floor(width / 4.15));
      for (let index = 0; index < columns; index++) {
        const position = Math.max(0, index / (columns - 1) * (samples.length - 1) + progress - 1);
        const lower = Math.floor(position);
        const earlier = samples[(first + lower) % samples.length];
        const later = samples[(first + Math.min(lower + 1, samples.length - 1)) % samples.length];
        const sample = (earlier + (later - earlier) * (position - lower)) ** .73;
        const extent = .6 + sample * Math.max(1, height / 2 - 2);
        const x = 1.5 + index / (columns - 1) * (width - 3);
        ink.globalAlpha = .25 + sample * .75;
        ink.beginPath();
        ink.moveTo(x, height / 2 - extent);
        ink.lineTo(x, height / 2 + extent);
        ink.stroke();
      }
      ink.globalAlpha = 1;
    };
    const resize = () => {
      bounds = sizeCanvas(canvas, ink, canvas.clientWidth, canvas.clientHeight);
      if (!bounds) return;
      gradient = ink.createLinearGradient(0, 0, 0, bounds.height);
      gradient.addColorStop(0, "#b891e4");
      gradient.addColorStop(.49, "#fff0d3");
      gradient.addColorStop(1, "#ab87d0");
      if (!document.hidden) paint();
    };
    const tick = (now: number) => {
      frame = null;
      if (document.hidden || !playing) return;
      const reduced = reduce.matches;
      const interval = reduced ? REDUCED_WAVE_SAMPLE_MS : WAVE_SAMPLE_MS;
      const sampleDue = lastSample === null || now - lastSample >= interval;
      if (sampleDue) {
        const sample = readEnergy().amplitude;
        samples[first] = Number.isFinite(sample) ? Math.max(0, Math.min(1, sample)) : 0;
        first = (first + 1) % samples.length;
        // Keep the audio history's timescale on 60 Hz and high-refresh screens.
        lastSample = lastSample === null ? now : now - (now - lastSample) % interval;
      }
      if (!reduced || sampleDue) {
        progress = reduced ? 1 : Math.min(1, (now - (lastSample ?? now)) / interval);
        paint();
      }
      frame = view.requestAnimationFrame(tick);
    };
    const refresh = () => {
      if (frame !== null) view.cancelAnimationFrame(frame);
      frame = null;
      lastSample = null;
      progress = 1;
      if (document.hidden) { samples.fill(0); return; }
      paint();
      if (playing) frame = view.requestAnimationFrame(tick);
    };
    const stopObservingSize = observeCanvasSize(canvas, view, resize);
    document.addEventListener("visibilitychange", refresh);
    reduce.addEventListener("change", refresh);
    resize();
    if (!document.hidden && playing) frame = view.requestAnimationFrame(tick);
    return () => {
      if (frame !== null) view.cancelAnimationFrame(frame);
      stopObservingSize();
      document.removeEventListener("visibilitychange", refresh);
      reduce.removeEventListener("change", refresh);
    };
  }, [playing, readEnergy]);

  return <div className="plc-film-audio" data-playing={playing} role="img" aria-label="Paige voice playback waveform">
    <span>Audio stream</span>
    <canvas ref={canvasRef} aria-hidden="true" />
  </div>;
}
