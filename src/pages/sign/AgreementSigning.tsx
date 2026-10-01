/**
 * /sign/:token — the counterparty's signing surface.
 *
 * PUBLIC AND UNAUTHENTICATED. The person signing has no account here and will never make one. The
 * TOKEN is the authorisation, and it is the ONLY thing this page sends: it never supplies a tenant,
 * a contact or an agreement id, because a page that can name the record it wants is a page that can
 * ask for somebody else's (§9). `peek_agreement_signing` derives all of it server-side.
 *
 * ONE REFUSAL FOR EVERY INVALID CASE. Unknown, expired, already signed, declined and voided all
 * come back as the same empty result, and this page says the same sentence for all of them. Telling
 * them apart would confirm to a stranger that a token they guessed is real (the enumeration oracle
 * `save_client_agreement` refuses to be, for the same reason). The BUSINESS sees the true state —
 * Expired vs Voided vs Declined — in Commercial Terms, where they are entitled to know.
 *
 * The design is APPROVED-FROZEN (§28, owner 2026-09-22). Do not restyle during a sweep.
 *
 * §38: nothing is charged, collected or authorised here. The figure shown is what the document
 * says was agreed; this page holds no payment instrument and creates none.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { supabase } from "@/integrations/supabase/client";
import "./agreement-signing.css";

type PeekRow = {
  document_title: string | null;
  document_body: string | null;
  document_path: string | null;
  business_name: string | null;
  brand: { logo_url?: string | null; primary_color?: string | null } | null;
  signer_display_name: string | null;
  amount_minor: number | null;
  amount_currency: string | null;
  term_summary: string | null;
  expires_at: string | null;
  signature_state: string | null;
  is_valid: boolean | null;
};

type Phase = "loading" | "ready" | "refused" | "completed" | "declined" | "error";

function money(minor: number | null, currency: string | null): string | null {
  if (minor === null || minor === undefined) return null;
  const code = (currency || "usd").toUpperCase();
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: code }).format(minor / 100);
  } catch {
    // An unrecognised currency code is not a reason to show nothing — show the number and the code.
    return `${(minor / 100).toFixed(2)} ${code}`;
  }
}

function longDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
}

/* ── the signature pad ──────────────────────────────────────────────────────────────────
 * Pointer events, so one implementation serves mouse, trackpad, pen AND touch. The owner's
 * requirement is that this works on a phone, and a mouse-only pad fails that silently. */
function SignaturePad({ onChange }: { onChange: (dataUrl: string | null) => void }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const dirty = useRef(false);

  const ink = useCallback(() => {
    const el = ref.current;
    if (!el) return "#171331";
    return getComputedStyle(el).getPropertyValue("--ink").trim() || "#171331";
  }, []);

  // The backing store is sized to the element's real pixels so the stroke is not resampled into
  // mush on a high-DPR phone, and re-sized on rotate.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      el.width = Math.round(r.width * dpr);
      el.height = Math.round(r.height * dpr);
      const ctx = el.getContext("2d");
      if (!ctx) return;
      ctx.scale(dpr, dpr);
      ctx.lineWidth = 2.2;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  const at = (e: React.PointerEvent<HTMLCanvasElement>): [number, number] => {
    const r = e.currentTarget.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };

  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const ctx = ref.current?.getContext("2d");
    if (!ctx) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    ctx.strokeStyle = ink();
    ctx.beginPath();
    const [x, y] = at(e);
    ctx.moveTo(x, y);
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = ref.current?.getContext("2d");
    if (!ctx) return;
    const [x, y] = at(e);
    ctx.lineTo(x, y);
    ctx.stroke();
    if (!dirty.current) dirty.current = true;
  };
  const up = () => {
    if (!drawing.current) return;
    drawing.current = false;
    onChange(dirty.current ? (ref.current?.toDataURL("image/png") ?? null) : null);
  };
  const clear = () => {
    const el = ref.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return;
    ctx.clearRect(0, 0, el.width, el.height);
    dirty.current = false;
    onChange(null);
  };

  return (
    <div>
      <canvas
        ref={ref}
        className="ags-pad"
        aria-label="Draw your signature"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onPointerLeave={up}
      />
      <div className="ags-pad-foot">
        <span>Sign with your finger, a pen or a mouse.</span>
        <span style={{ flex: 1 }} />
        <button type="button" className="ags-decline" onClick={clear} style={{ textDecoration: "none" }}>
          Clear
        </button>
      </div>
    </div>
  );
}

export default function AgreementSigning() {
  const { token = "" } = useParams<{ token: string }>();
  const [phase, setPhase] = useState<Phase>("loading");
  const [row, setRow] = useState<PeekRow | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const [read, setRead] = useState(false);
  // The uploaded document's frozen bytes, streamed by agreement-document through this signer's
  // own token. "ready" is the only state that satisfies the read gate for an uploaded document:
  // a signer cannot consent to a document they cannot see, so loading and failure both hold it.
  const [docPhase, setDocPhase] = useState<"idle" | "loading" | "ready" | "failed">("idle");
  const [docUrl, setDocUrl] = useState<string | null>(null);
  const [pct, setPct] = useState(0);
  const [mode, setMode] = useState<"type" | "draw">("type");
  const [typed, setTyped] = useState("");
  const [drawn, setDrawn] = useState<string | null>(null);
  const [consentRead, setConsentRead] = useState(false);
  const [consentEsign, setConsentEsign] = useState(false);
  const [busy, setBusy] = useState(false);

  const bodyRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!token) { setPhase("refused"); return; }
      const { data, error } = await supabase.rpc("peek_agreement_signing" as never, { _token: token } as never);
      if (cancelled) return;
      if (error) {
        // A transport/server failure is NOT the same as an invalid link, and saying "this link is
        // not valid" when the server simply fell over would be a lie the visitor cannot correct.
        setFailure(error.message);
        setPhase("error");
        return;
      }
      const payload: unknown = data;
      const first = (Array.isArray(payload) ? payload[0] : payload) as PeekRow | undefined;
      if (!first || first.is_valid === false) { setPhase("refused"); return; }
      setRow(first);
      setTyped(first.signer_display_name ?? "");
      setPhase("ready");
    })();
    return () => { cancelled = true; };
  }, [token]);

  useEffect(() => {
    if (phase !== "ready" || !row?.document_path || row?.document_body) { setDocPhase("idle"); return; }
    let revoked = false;
    setDocPhase("loading");
    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke(
          `agreement-document?token=${encodeURIComponent(token)}`,
          { method: "GET" },
        );
        if (revoked) return;
        // §13: only bytes that actually arrived are a document; the door answers every refusal
        // with the same JSON shape, so anything that is not a non-empty Blob is a failure.
        if (error || !(data instanceof Blob) || data.size === 0) { setDocPhase("failed"); return; }
        setDocUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(data); });
        setDocPhase("ready");
      } catch {
        if (!revoked) setDocPhase("failed");
      }
    })();
    return () => { revoked = true; };
  }, [phase, row?.document_path, row?.document_body, token]);
  useEffect(() => () => { if (docUrl) URL.revokeObjectURL(docUrl); }, [docUrl]);

  // The read gate's two honest modes: a text body is measured by scrolling it; an uploaded
  // document is satisfied only by the viewer actually showing it. No percentage is claimed over
  // a PDF the product cannot measure.
  const uploadedDoc = !!row?.document_path && !row?.document_body;
  const docGateOpen = uploadedDoc ? docPhase === "ready" : read;

  /* THE READ GATE.
   * It must never unlock before the document has actually been read to the end, and it must never
   * DEADLOCK on a document short enough not to scroll. Both halves matter: an early build of this
   * measured the element while it was still `display:none`, got 0x0, concluded "it fits without
   * scrolling" and unlocked signing before a word was on screen. So: measure only once the element
   * genuinely has a layout, and re-measure on resize and when the body text arrives. */
  const evaluate = useCallback(() => {
    const el = bodyRef.current;
    if (!el || !el.clientHeight) return;
    const max = el.scrollHeight - el.clientHeight;
    const next = max <= 4 ? 100 : Math.min(100, Math.round((el.scrollTop / max) * 100));
    setPct(next);
    if (max <= 4 || el.scrollTop + el.clientHeight >= el.scrollHeight - 24) setRead(true);
  }, []);

  useEffect(() => {
    if (phase !== "ready") return;
    const raf = requestAnimationFrame(evaluate);
    window.addEventListener("resize", evaluate);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", evaluate); };
  }, [phase, row?.document_body, evaluate]);

  const named = mode === "type" ? typed.trim().length > 1 : !!drawn;
  const canSign = docGateOpen && named && consentRead && consentEsign && !busy;

  const sign = async () => {
    if (!canSign) return;
    setBusy(true);
    setFailure(null);
    try {
      const { data, error } = await supabase.functions.invoke("sign-agreement", {
        body: {
          token,
          typed_name: mode === "type" ? typed.trim() : typed.trim() || (row?.signer_display_name ?? ""),
          signature_image_base64: mode === "draw" ? drawn : null,
          consent_read: consentRead,
          consent_esign: consentEsign,
        },
      });
      const payload = data as { ok?: boolean; error?: string } | null;
      // §13: the ONLY thing that means "signed" is the server saying so. A transport that resolved
      // without an explicit ok is not a signature, and must never be rendered as one.
      if (error || !payload?.ok) {
        setFailure(payload?.error || error?.message || "Your signature could not be recorded. Nothing was signed.");
        setBusy(false);
        return;
      }
      setPhase("completed");
    } catch (e) {
      setFailure(e instanceof Error ? e.message : "Your signature could not be recorded. Nothing was signed.");
      setBusy(false);
    }
  };

  const decline = async () => {
    const reason = window.prompt("If you'd like, say briefly why. This is sent to the business.") ?? "";
    setBusy(true);
    const { error } = await supabase.rpc(
      "decline_agreement_signing" as never,
      { _token: token, _reason: reason.slice(0, 500) } as never,
    );
    setBusy(false);
    if (error) { setFailure(error.message); return; }
    setPhase("declined");
  };

  const amount = useMemo(() => money(row?.amount_minor ?? null, row?.amount_currency ?? null), [row]);
  const business = row?.business_name || "This business";
  const title = row?.document_title || "Agreement";

  if (phase === "loading") {
    return (
      <div className="ags">
        <div className="ags-wrap" style={{ paddingTop: 14 }}>
          <div className="ags-skel" style={{ height: 210 }} role="status" aria-label="Loading your agreement" />
          <div className="ags-skel" style={{ height: 300, marginTop: 16 }} />
        </div>
      </div>
    );
  }

  if (phase === "refused") {
    return (
      <div className="ags">
        <Helmet><title>Signing link · not available</title></Helmet>
        <div className="ags-state">
          <h2>This signing link is no longer available</h2>
          <p>
            It may have expired, already been signed, or been withdrawn by the business that sent it.
            If you still need to sign, ask them to send you a new link.
          </p>
        </div>
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="ags">
        <div className="ags-state">
          <h2>We couldn't load this agreement</h2>
          <p>Nothing was signed. This is a problem on our side, not with your link — please try again in a moment.</p>
          {failure && (
            <div className="ags-alert" style={{ marginTop: 18 }}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 9v4" /><path d="M12 17h.01" /></svg>
              <p>{failure}</p>
            </div>
          )}
          <button className="ags-sign" style={{ marginTop: 18 }} onClick={() => window.location.reload()}>Try again</button>
        </div>
      </div>
    );
  }

  if (phase === "declined") {
    return (
      <div className="ags">
        <Helmet><title>Declined</title></Helmet>
        <div className="ags-state">
          <h2>You declined this agreement</h2>
          <p>{business} has been told. Nothing was signed and this link is now closed.</p>
        </div>
      </div>
    );
  }

  if (phase === "completed") {
    return (
      <div className="ags">
        <Helmet><title>Signed · {title}</title></Helmet>
        <div className="ags-wrap">
          <div className="ags-seal" style={{ marginTop: 40 }}>
            <span className="ags-orb" aria-hidden="true">
              <i className="halo" /><i className="body" /><i className="ring" />
              <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
            </span>
            <div>
              <h2>Signed and completed</h2>
              <p>
                Thank you. {business} has your signed copy, and a copy is on its way to you. Your
                signature, the exact wording you read, and the time you signed are recorded together.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="ags">
      <Helmet><title>{title} · please review and sign</title></Helmet>
      <div className="ags-wrap">
        <div className="ags-top">
          <div className="ags-brand">
            <span className="ags-mark" aria-hidden="true">
              {row?.brand?.logo_url
                ? <img src={row.brand.logo_url} alt="" />
                : business.trim().charAt(0).toUpperCase() || "•"}
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <b>{business}</b>
              <span>sent this to you for signature</span>
            </span>
          </div>
          <div className="ags-hero">
            <h1>
              {row?.signer_display_name ? `${row.signer_display_name}, please review and sign` : "Please review and sign"}
            </h1>
            <p>
              Read it in full below. Nothing is signed, and nothing is charged, until you choose to
              sign at the bottom of this page.
            </p>
            <dl className="ags-meta">
              <div><dt>From</dt><dd>{business}</dd></div>
              {amount && <div><dt>You pay</dt><dd className="ags-mono">{amount}</dd></div>}
              {row?.term_summary && <div><dt>Terms</dt><dd>{row.term_summary}</dd></div>}
              {longDate(row?.expires_at ?? null) && (
                <div><dt>Sign by</dt><dd>{longDate(row?.expires_at ?? null)}</dd></div>
              )}
            </dl>
          </div>
        </div>

        <div className="ags-doc">
          <div className="ags-doc-hd">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></svg>
            <b>{title}</b>
          </div>
          <div
            ref={bodyRef}
            className="ags-doc-body"
            tabIndex={0}
            role="region"
            aria-label={row?.document_body ? "Agreement text — read to the end to enable signing" : "The document you are signing — shown in full to enable signing"}
            onScroll={evaluate}
          >
            {row?.document_body ? row.document_body : uploadedDoc ? (
              docPhase === "ready" && docUrl ? (
                <iframe
                  src={docUrl}
                  title="The document you are signing"
                  className="ags-doc-pdf"
                  aria-label="The document you are signing — review it in full before signing"
                />
              ) : docPhase === "failed" ? (
                <p className="ags-doc-note" role="alert">
                  The document could not be shown. Ask the sender for a new link — signing stays
                  locked until the document itself is on this page.
                </p>
              ) : (
                <p className="ags-doc-note">Opening the document you are signing…</p>
              )
            ) : null}
          </div>
          <div className="ags-doc-foot">
            {row?.document_body ? (
              <>
                <span>Read {pct}%</span>
                <span className="ags-prog"><i style={{ width: `${pct}%` }} /></span>
              </>
            ) : (
              <span>{docPhase === "ready" ? "Document shown — review it in full before signing." : docPhase === "failed" ? "Document unavailable." : "Opening the document…"}</span>
            )}
          </div>
        </div>

        <div className="ags-gate" data-locked={!docGateOpen}>
          <div className="ags-lock" data-open={docGateOpen}>
            {docGateOpen ? (
              <>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
                <span>You have read the whole agreement. You can sign it now.</span>
              </>
            ) : (
              <>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
                <span>Scroll to the end of the agreement above to sign it.</span>
              </>
            )}
          </div>

          <div style={read ? undefined : { pointerEvents: "none" }} aria-hidden={!read}>
            <div className="ags-tabs" role="group" aria-label="How to sign">
              <button type="button" aria-pressed={mode === "type"} onClick={() => setMode("type")}>Type it</button>
              <button type="button" aria-pressed={mode === "draw"} onClick={() => setMode("draw")}>Draw it</button>
            </div>

            {mode === "type" ? (
              <label className="ags-field">
                <span>Your full legal name</span>
                <input
                  className="ags-sig"
                  value={typed}
                  autoComplete="name"
                  placeholder={row?.signer_display_name || "Your name"}
                  onChange={(e) => setTyped(e.target.value)}
                />
              </label>
            ) : (
              <SignaturePad onChange={setDrawn} />
            )}

            <div className="ags-consents">
              <label className="ags-cons">
                <input type="checkbox" checked={consentRead} onChange={(e) => setConsentRead(e.target.checked)} />
                <span>I have <b>read this agreement in full</b> and I agree to be bound by it.</span>
              </label>
              <label className="ags-cons">
                <input type="checkbox" checked={consentEsign} onChange={(e) => setConsentEsign(e.target.checked)} />
                <span>
                  I consent to signing <b>electronically</b> under the E-SIGN Act and applicable UETA.
                  My name and signature above are my legal signature.
                </span>
              </label>
            </div>

            {failure && (
              <div className="ags-alert">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 9v4" /><path d="M12 17h.01" /></svg>
                <p>{failure}</p>
              </div>
            )}

            <div className="ags-acts">
              <button className="ags-sign" disabled={!canSign} onClick={sign}>
                {busy ? "Sealing your signature…" : "Sign and complete"}
              </button>
              <span style={{ flex: 1 }} />
              <button type="button" className="ags-decline" onClick={decline} disabled={busy}>
                I don't agree to these terms
              </button>
            </div>
          </div>
        </div>

        <p className="ags-legal">
          {business} will receive a copy of this signed agreement, and so will you. Your signature,
          the exact wording you saw, and the time you signed are recorded together.
        </p>
      </div>
    </div>
  );
}
