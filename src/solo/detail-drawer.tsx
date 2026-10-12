// @ts-nocheck -- moved verbatim from growth2.tsx (which is unchecked); typing it is separate work.
// The one detail drawer for Marketing and Sales: a side panel that traps focus, closes on Escape and
// returns focus to whatever opened it. `detail` carries title, rows ([label, value]), and optional body,
// actions, note, eyebrow and wide (a wider panel for previews: Marketing › Content).
import React from "react";
import { Ic } from "./_shared";

export function DetailDrawer({ detail, onClose }) {
  const closeRef = React.useRef(null);
  const drawerRef = React.useRef(null);
  // The effect runs when a different item opens, never on a re-render of the same one: callers
  // build `detail` and `onClose` inline, and re-running it moved focus to Close mid-edit (INT-342).
  const onCloseRef = React.useRef(onClose);
  onCloseRef.current = onClose;
  const openKey = detail ? (detail.key ?? detail.title) : null;
  React.useEffect(() => {
    if (openKey === null) return;
    const onClose = () => onCloseRef.current();
    const previous = document.activeElement;
    const background = document.querySelectorAll(".solo-campaigns > .campaigns-nav, .solo-campaigns > .campaigns-scroll");
    background.forEach((node) => node.setAttribute("inert", ""));
    closeRef.current?.focus({ preventScroll: true });
    const onKeyDown = (event) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); return; }
      if (event.key !== "Tab") return;
      // Only what Tab can actually reach: controls inside a collapsed <details> are not focusable,
      // except that details' own <summary>.
      const focusable = [...(drawerRef.current?.querySelectorAll('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])') ?? [])]
        .filter((el) => { const closed = el.closest("details:not([open])"); return !closed || el.parentElement === closed && el.tagName === "SUMMARY"; });
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => { window.removeEventListener("keydown", onKeyDown); background.forEach((node) => node.removeAttribute("inert")); if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true }); };
  }, [openKey]);
  if (!detail) return null;
  return <><button className="campaigns-drawer-scrim" tabIndex={-1} aria-label="Close details" onClick={onClose}/><aside ref={drawerRef} className={`campaigns-drawer${detail.wide ? " campaigns-drawer--wide" : ""}`} role="dialog" aria-modal="true" aria-labelledby="campaigns-detail-title">
    <header><div><span className="eyebrow">{detail.eyebrow ?? "Grounded detail"}</span><h2 id="campaigns-detail-title">{detail.title}</h2></div><button ref={closeRef} className="btn btn-s" onClick={onClose} aria-label="Close details"><Ic.x size={14}/></button></header>
    <div className="campaigns-drawer-body">{detail.rows.map(([label, value]) => <div className="campaigns-detail-row" key={label}><span>{label}</span><strong>{value || "Not recorded"}</strong></div>)}{detail.body}{detail.actions&&<div className="campaigns-detail-actions">{detail.actions}</div>}{detail.note&&<p className="campaigns-detail-note">{detail.note}</p>}</div>
  </aside></>;
}
