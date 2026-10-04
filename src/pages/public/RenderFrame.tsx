// /render-frame — the DB-free page paige-browser screenshots for the Studio visual-critique loop (§33).
//
// A draft page exists only as data until it is published, so the public route (/p/:tenant/:page),
// which loads PUBLISHED rows, cannot show it. paige-browser's /render opens this route and injects
// the page before any script runs (window.__PAIGE_RENDER_PAYLOAD__); this frame renders it through
// the SAME <GrowthPageView> the public page mounts — one renderer, so the critic judges what a
// visitor would see (§18).
//
// Mounted OUTSIDE the app shell and every provider (App.tsx short-circuits on the path, as /invoice
// does): no auth, no tenant context, no Supabase reads. The ONLY input is the injected payload —
// blocks, theme, brand, display name. No tenant id is passed, so an embedded form renders as its
// non-submitting preview and the chatbot block stays static. noindex: this is a machine surface.
//
// It sets data-render-ready="true" on its root once web fonts and images have settled (or a bounded
// wait has passed) — the marker /render waits on. With no payload it shows a neutral state and never
// marks itself ready, so a failed injection is a not_ready refusal, never a screenshot of "nothing".
//
// A block that throws is caught by RenderErrorBoundary: the frame shows a neutral message, sets
// data-render-error="<message>" and console.errors the cause, and never marks itself ready — so
// /render answers render_crashed at once instead of not_ready after its timeout.
import { Component, useEffect, useMemo, useRef, useState, type ErrorInfo, type ReactNode } from "react";
import { resolveGrowthTheme } from "@/components/growth/growth-theme";
import { GrowthPageView } from "@/components/growth/GrowthPageView";
import { readRenderPayload, settleRenderFrame, type RenderPayload } from "@/lib/render-frame";

function useNoIndex() {
  useEffect(() => {
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex, nofollow";
    document.head.appendChild(meta);
    return () => { meta.remove(); };
  }, []);
}

export default function RenderFrame() {
  useNoIndex();
  const payload = useMemo(() => readRenderPayload(), []);

  useEffect(() => {
    if (payload?.tenantName) document.title = payload.tenantName;
  }, [payload?.tenantName]);

  if (!payload) return <NothingToRender />;

  // One malformed block (e.g. a stats block with no items) throws during render. Without a boundary
  // React unmounts the whole tree, no marker ever appears and the caller waits out a misleading
  // not_ready. The boundary turns it into a loud, immediate data-render-error (§32).
  return (
    <RenderErrorBoundary>
      <FramePage payload={payload} />
    </RenderErrorBoundary>
  );
}

function FramePage({ payload }: { payload: RenderPayload }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!rootRef.current) return;
    let cancelled = false;
    void settleRenderFrame(rootRef.current).then(() => { if (!cancelled) setReady(true); });
    return () => { cancelled = true; };
  }, [payload]);

  return (
    <div ref={rootRef} data-render-frame="" data-render-ready={ready ? "true" : "false"}>
      <GrowthPageView blocks={payload.blocks} theme={payload.theme} brand={payload.brand} />
    </div>
  );
}

class RenderErrorBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };

  static getDerivedStateFromError(error: unknown) {
    return { error: String((error as Error)?.message ?? error).slice(0, 500) || "unknown error" };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error("[render-frame] a block threw while rendering:", error, info?.componentStack);
  }

  render() {
    if (this.state.error == null) return this.props.children;
    const vars = resolveGrowthTheme(null, null);
    return (
      <div
        data-render-frame=""
        data-render-error={this.state.error}
        className="flex min-h-dvh flex-col items-center justify-center px-6 text-center"
        style={{ ...(vars as Record<string, string>), background: "var(--gp-bg)", color: "var(--gp-text)", fontFamily: "var(--gp-font)" } as React.CSSProperties}
      >
        <h1 className="font-display text-2xl font-semibold">This draft could not be drawn</h1>
        <p className="mt-2 text-sm" style={{ color: "var(--gp-muted)" }}>One of its blocks is incomplete.</p>
      </div>
    );
  }
}

// Neutral, on-brand-floor state for a frame opened without a payload (a person who followed the URL,
// or an injection that failed). Deliberately never marked ready.
function NothingToRender() {
  const vars = resolveGrowthTheme(null, null);
  return (
    <div
      data-render-frame=""
      data-render-empty="true"
      className="flex min-h-dvh flex-col items-center justify-center px-6 text-center"
      style={{ ...(vars as Record<string, string>), background: "var(--gp-bg)", color: "var(--gp-text)", fontFamily: "var(--gp-font)" } as React.CSSProperties}
    >
      <h1 className="font-display text-2xl font-semibold">Nothing to render</h1>
      <p className="mt-2 text-sm" style={{ color: "var(--gp-muted)" }}>This page only shows a draft that Paige sends to it.</p>
    </div>
  );
}
