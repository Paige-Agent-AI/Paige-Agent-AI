import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { DocumentPreview } from "@/components/admin/studio/DocumentPreview";
import { parseStudioDocument } from "@/components/admin/studio/studio-document";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import type { StudioDocument } from "@/components/admin/studio/studio-types";
import { DocumentWindowContext, type DocumentWindowScope, type DocumentWindowTarget } from "./paigeDocumentWindowContext";
import "./paige-document-window.css";

interface SavedDocument {
  document: StudioDocument;
  revision: number;
  fingerprint: string;
}

type ViewerState =
  | { state: "loading" | "unavailable" | "changed" }
  | { state: "ready"; saved: SavedDocument };

interface Selection {
  scopeKey: string;
  target: DocumentWindowTarget;
  view: ViewerState;
  expanded: boolean;
}

async function readSavedDocument(scope: DocumentWindowScope, id: string, signal: AbortSignal): Promise<SavedDocument | null> {
  const { data: before } = await supabase.auth.getSession();
  if (signal.aborted || before.session?.user.id !== scope.actorId) return null;
  const { data, error } = await supabase.from("marketing_content")
    .select("id,title,body,kind,document_revision")
    .eq("tenant_id", scope.tenantId)
    .eq("id", id)
    .abortSignal(signal)
    .maybeSingle()
    .overrideTypes<{ id: string; title: string | null; body: string | null; kind: string; document_revision: number }>();
  if (signal.aborted || error || data?.id !== id || data.kind !== "document" || typeof data.body !== "string" ||
      !Number.isSafeInteger(data.document_revision) || data.document_revision < 1) return null;
  const document = parseStudioDocument(data.id, data.title, data.body);
  if (!document) return null;
  const bytes = new TextEncoder().encode(JSON.stringify([data.title, data.body]));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const { data: after } = await supabase.auth.getSession();
  if (signal.aborted || after.session?.user.id !== scope.actorId) return null;
  const fingerprint = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  return { document, revision: data.document_revision, fingerprint };
}

export function PaigeDocumentWindowHost({ scope, children }: { scope: DocumentWindowScope | null; children: ReactNode }) {
  const [selection, setSelection] = useState<Selection | null>(null);
  const [wide, setWide] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const pane = useRef<HTMLElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const pending = useRef<AbortController | null>(null);
  const sourceRect = useRef<DOMRect | null>(null);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const pinned = useRef(new Map<string, { revision: number; fingerprint: string }>());
  const current = selection?.scopeKey === scope?.key ? selection : null;
  const mode = current ? current.expanded || !wide ? "full" : "beside" : null;

  useLayoutEffect(() => {
    const media = host.current?.ownerDocument.defaultView?.matchMedia?.("(min-width: 1024px)");
    if (!media) return;
    const update = () => setWide(media.matches);
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);

  useLayoutEffect(() => {
    setSelection(null);
    const pins = pinned.current;
    return () => {
      pending.current?.abort();
      pending.current = null;
      opener.current = null;
      pins.clear();
      sourceRect.current = null;
    };
  }, [scope?.key]);

  useLayoutEffect(() => {
    if (!mode) {
      const button = opener.current;
      opener.current = null;
      if (button?.isConnected) button.focus({ preventScroll: true });
      return;
    }
    title.current?.focus({ preventScroll: true });
    const from = sourceRect.current;
    sourceRect.current = null;
    const element = pane.current;
    const win = element?.ownerDocument.defaultView;
    if (!from?.width || !element?.animate || !win || win.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) return;
    const to = element.getBoundingClientRect();
    if (!to.width || !to.height) return;
    const page = element.ownerDocument.createElement("span");
    page.className = "paige-document-flight";
    page.setAttribute("aria-hidden", "true");
    const height = Math.min(to.height, win.innerHeight * 0.68);
    Object.assign(page.style, { left: to.left + "px", top: to.top + "px", width: to.width + "px", height: height + "px" });
    element.ownerDocument.body.append(page);
    const motion = { duration: 340, easing: "cubic-bezier(0.16, 1, 0.3, 1)" };
    const flight = page.animate([
      { transform: `translate(${from.left - to.left}px,${from.top - to.top}px) scale(${from.width / to.width},${Math.min(1, from.height / height)})` },
      { transform: "none", opacity: 1, offset: 0.72 },
      { transform: "none", opacity: 0 },
    ], motion);
    const reveal = element.animate([{ opacity: 0 }, { opacity: 0, offset: 0.35 }, { opacity: 1 }], motion);
    flight.onfinish = () => page.remove();
    return () => { flight.cancel(); reveal.cancel(); page.remove(); };
  }, [mode, current?.target.id]);

  function open(target: DocumentWindowTarget, button: HTMLButtonElement | null, expanded = false) {
    const origin = currentScope.current;
    if (!origin || target.tenantId !== origin.tenantId) return;
    if (button) {
      opener.current = button;
      sourceRect.current = (button.closest("[data-paige-artifact-card]")?.querySelector("[data-paige-document-thumbnail]") ?? button).getBoundingClientRect();
    }
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setSelection({ scopeKey: origin.key, target, expanded, view: { state: "loading" } });
    const finish = (saved: SavedDocument | null) => {
      if (controller.signal.aborted || currentScope.current?.key !== origin.key) return;
      const previous = pinned.current.get(target.id);
      let view: ViewerState;
      if (!saved) view = { state: "unavailable" };
      else if (previous && (previous.revision !== saved.revision || previous.fingerprint !== saved.fingerprint)) view = { state: "changed" };
      else {
        pinned.current.set(target.id, { revision: saved.revision, fingerprint: saved.fingerprint });
        view = { state: "ready", saved };
      }
      setSelection(value => value?.scopeKey === origin.key && value.target.id === target.id ? { ...value, view } : value);
    };
    void readSavedDocument(origin, target.id, controller.signal).then(finish, () => finish(null));
  }

  function close() {
    pending.current?.abort();
    setSelection(null);
  }

  function changeLayout(expanded: boolean) {
    sourceRect.current = pane.current?.getBoundingClientRect() ?? null;
    setSelection(value => value ? { ...value, expanded } : value);
  }

  return <DocumentWindowContext.Provider value={scope ? open : null}>
    <div ref={host} className="paige-document-host" data-paige-document-mode={mode ?? undefined}
      onKeyDown={event => { if (current && event.key === "Escape" && !event.defaultPrevented) { event.preventDefault(); close(); } }}>
      <div className="paige-document-chat" hidden={mode === "full"}>{children}</div>
      {current && <section ref={pane} className="paige-document-pane" aria-label="Saved document">
        <header className="paige-document-toolbar">
          <div className="min-w-0">
            <h2 ref={title} tabIndex={-1} className="break-words font-semibold">{current.view.state === "ready" ? current.view.saved.document.title : current.target.title}</h2>
            {current.view.state === "ready" && <p className="text-xs text-muted-foreground">Saved version {current.view.saved.revision}</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            {wide && <Button type="button" variant="outline" size="sm" onClick={() => changeLayout(mode !== "full")}>
              {mode === "full" ? "Show beside Chat" : "Expand"}
            </Button>}
            <Button type="button" variant="outline" size="sm" onClick={close}>{mode === "full" ? "Back to chat" : "Close document"}</Button>
          </div>
        </header>
        {current.view.state === "ready" ? <div className="min-h-0 min-w-0">
          <DocumentPreview document={current.view.saved.document} />
        </div> : <div className="min-h-0 overflow-auto p-5">
          {current.view.state === "loading" ? <p role="status">Loading saved documentâ€¦</p> : <>
            <p role="alert">{current.view.state === "changed"
              ? "The saved document changed since you opened it. This preview cannot confirm the earlier version."
              : "The saved document could not be loaded. Check access and try again."}</p>
            {current.view.state === "unavailable" && <Button type="button" variant="outline" className="mt-3"
              onClick={() => open(current.target, null, current.expanded)}>Retry preview</Button>}
          </>}
        </div>}
      </section>}
    </div>
  </DocumentWindowContext.Provider>;
}
