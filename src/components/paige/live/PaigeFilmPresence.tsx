import { useEffect, useRef } from "react";
import { PaigeCommandMark } from "@/components/brand/PaigeCommandMark";
import type { AudioEnergy } from "@/lib/paigeLiveConversation/presence";
import { createMeetPaigeGalaxy, MEET_PAIGE_INTRO_MS } from "./meetPaigeGalaxy";

function sizeCanvas(canvas: HTMLCanvasElement, context: CanvasRenderingContext2D) {
  const width = canvas.clientWidth, height = canvas.clientHeight;
  if (!width || !height) return null;
  const ratio = Math.min(canvas.ownerDocument.defaultView?.devicePixelRatio || 1, 1.55);
  const wide = Math.round(width * ratio), tall = Math.round(height * ratio);
  if (canvas.width !== wide) canvas.width = wide;
  if (canvas.height !== tall) canvas.height = tall;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  return { width, height };
}

export function PaigeFilmPresence({ intro, held }: { intro: boolean; held: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const elapsed = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    const document = canvas?.ownerDocument;
    const view = document?.defaultView;
    if (!canvas || !view || !document || typeof view.CanvasRenderingContext2D !== "function") return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const paint = createMeetPaigeGalaxy(context);
    const reduce = view.matchMedia("(prefers-reduced-motion: reduce)");
    let frame: number | null = null;
    let last: number | null = null;

    const render = () => {
      const size = sizeCanvas(canvas, context);
      if (size) paint(size.width, size.height, elapsed.current, intro, reduce.matches);
    };
    const tick = (now: number) => {
      frame = null;
      if (document.hidden || reduce.matches || held) return;
      if (last === null || now - last >= 30) {
        elapsed.current += last === null ? 0 : Math.min(85, now - last);
        last = now;
        render();
      }
      frame = view.requestAnimationFrame(tick);
    };
    const refresh = () => {
      if (frame !== null) view.cancelAnimationFrame(frame);
      frame = null;
      last = null;
      if (document.hidden) return;
      render();
      if (!reduce.matches && !held) frame = view.requestAnimationFrame(tick);
    };
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(render) : null;
    observer?.observe(canvas);
    view.addEventListener("resize", render);
    document.addEventListener("visibilitychange", refresh);
    reduce.addEventListener("change", refresh);
    refresh();
    return () => {
      if (frame !== null) view.cancelAnimationFrame(frame);
      observer?.disconnect();
      view.removeEventListener("resize", render);
      document.removeEventListener("visibilitychange", refresh);
      reduce.removeEventListener("change", refresh);
    };
  }, [intro, held]);

  return (
    <div className="plc-film-presence" aria-hidden="true">
      <canvas ref={canvasRef} className="plc-film-galaxy" />
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
    let last = -Infinity;

    const paint = () => {
      const bounds = sizeCanvas(canvas, ink);
      if (!bounds) return;
      const { width, height } = bounds;
      ink.clearRect(0, 0, width, height);
      const gradient = ink.createLinearGradient(0, 0, 0, height);
      gradient.addColorStop(0, "#b891e4");
      gradient.addColorStop(.49, "#fff0d3");
      gradient.addColorStop(1, "#ab87d0");
      ink.strokeStyle = gradient;
      ink.lineCap = "round";
      ink.lineWidth = 1.5;
      const columns = Math.max(2, Math.floor(width / 4.15));
      for (let index = 0; index < columns; index++) {
        const sampleIndex = first + Math.round(index / (columns - 1) * (samples.length - 1));
        const sample = samples[sampleIndex % samples.length] ** .73;
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
    const tick = (now: number) => {
      frame = null;
      if (document.hidden || !playing) return;
      if (now - last >= (reduce.matches ? 100 : 30)) {
        const sample = readEnergy().amplitude;
        samples[first] = Number.isFinite(sample) ? Math.max(0, Math.min(1, sample)) : 0;
        first = (first + 1) % samples.length;
        last = now;
        paint();
      }
      frame = view.requestAnimationFrame(tick);
    };
    const refresh = () => {
      if (frame !== null) view.cancelAnimationFrame(frame);
      frame = null;
      last = -Infinity;
      if (document.hidden) { samples.fill(0); return; }
      paint();
      if (playing) frame = view.requestAnimationFrame(tick);
    };
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(paint) : null;
    observer?.observe(canvas);
    view.addEventListener("resize", paint);
    document.addEventListener("visibilitychange", refresh);
    refresh();
    return () => {
      if (frame !== null) view.cancelAnimationFrame(frame);
      observer?.disconnect();
      view.removeEventListener("resize", paint);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [playing, readEnergy]);

  return <div className="plc-film-audio" data-playing={playing} role="img" aria-label="Paige voice playback waveform">
    <span>Audio stream</span>
    <canvas ref={canvasRef} aria-hidden="true" />
  </div>;
}
