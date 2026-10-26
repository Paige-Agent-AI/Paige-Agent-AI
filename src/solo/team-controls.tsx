/**
 * Settings → Team building blocks (EXP08, approved design 2026-10-26). One home for the dialog and
 * drawer trap, the picker, the switch, the row menu and the bottom notice, so every flow on this
 * surface uses the same vocabulary.
 */
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Check, X } from "lucide-react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { Select, SelectContent, SelectTrigger, SelectValue } from "@/components/ui/select";

/**
 * `onEscape` lets the dialog's own content own the Escape key for as long as it has something to
 * back out of — a destructive confirmation being the case that needs it. Returning `true` means
 * "handled"; anything else falls through to closing the dialog. Without it, backing out of "Remove
 * X?" discarded the whole editor, including unsaved work details the footer's Cancel/Close wording
 * exists to protect.
 *
 * Moved here unchanged from team-workspace.tsx so the departure-review drawer and the suspend
 * dialog share the same trap, Escape ownership and busy-close rule. `variant="drawer"` renders the
 * right-hand drawer (a full-width sheet on a phone); `role="alertdialog"` is for the brief blocking
 * decision (suspend).
 */
export function Modal({ title, description, onClose, onEscape, busy, wide, variant = "dialog", role = "dialog", titleRef, children }: { title: string; description: string; onClose: () => void; onEscape?: () => boolean; /** A request is in flight and must not be interrupted: the close control is DISABLED, not merely inert. */ busy?: boolean; /** Opens at the wider size from the first frame, so content arriving later never resizes it. */ wide?: boolean; variant?: "dialog" | "drawer"; role?: "dialog" | "alertdialog"; titleRef?: React.Ref<HTMLHeadingElement>; children: React.ReactNode }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  // The key handler and the focus capture read the latest callbacks through refs so the effect can
  // run ONCE. It used to depend on `onClose`, which the caller re-creates on every render, so every
  // parent state change re-ran it: re-capturing the return-focus target and yanking focus back to
  // the close button — including in the middle of a confirmation the user was reading.
  const latest = useRef({ onClose, onEscape, busy });
  // Assigned on COMMIT, not during render: a render that is discarded (StrictMode, concurrent
  // rendering) would otherwise leave this ref holding callbacks from a pass that never took effect.
  useEffect(() => { latest.current = { onClose, onEscape, busy }; });
  useEffect(() => {
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // `[data-initial-focus]` is tried on its own FIRST. A single querySelector with a comma-joined
    // list returns the first match in DOCUMENT order across all branches, and the header's close
    // button precedes every child — so the opt-in marker never once won.
    const marked = dialogRef.current?.querySelector<HTMLElement>("[data-initial-focus]");
    const firstFocus = marked ?? dialogRef.current?.querySelector<HTMLElement>("input, select, textarea, button");
    (firstFocus ?? closeRef.current)?.focus();
    const onKey = (event: KeyboardEvent) => {
      // A popover (picker, menu) inside the dialog owns Escape while it is open.
      if (event.defaultPrevented) return;
      if (event.key === "Escape") {
        if (event.target instanceof Element && event.target.closest('[role="listbox"], [role="menu"]')) return;
        event.preventDefault();
        if (latest.current.onEscape?.() === true) return;
        if (latest.current.busy) return;
        latest.current.onClose();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex="-1"])')];
      // Nothing tabbable at all: Tab must not walk out of an aria-modal dialog into the roster beneath.
      if (!focusable.length) { event.preventDefault(); return; }
      const first = focusable[0]; const last = focusable[focusable.length - 1];
      // The caret is on a `tabIndex={-1}` target that was focused programmatically (a live "Removing…"
      // line). The first/last comparison below can never match it, so it is handled explicitly.
      if (!focusable.includes(document.activeElement as HTMLElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
        return;
      }
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      // Only restore focus to a node that is still in the document; the caller moves focus
      // deliberately when the invoking row is gone.
      if (returnFocus && document.contains(returnFocus)) returnFocus.focus();
    };
  }, []);
  const drawer = variant === "drawer";
  return <div className={drawer ? "stw-modal-backdrop is-drawer" : "stw-modal-backdrop"} role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target && !busy) onClose(); }}>
    <section ref={dialogRef} className={drawer ? "stw-drawer" : wide ? "stw-modal is-wide" : "stw-modal"} role={role} aria-modal="true" aria-labelledby="stw-modal-title" aria-describedby="stw-modal-desc">
      <header><div><h2 id="stw-modal-title" ref={titleRef} tabIndex={-1}>{title}</h2><p id="stw-modal-desc">{description}</p></div><button ref={closeRef} type="button" className="stw-icon-btn" onClick={onClose} disabled={busy} aria-label="Close"><X /></button></header>
      {children}
    </section>
  </div>;
}

/** The theme a portalled popover must carry, read from where its trigger sits. */
function closestTheme(node: Element | null): string {
  return node?.closest("[data-pg]")?.getAttribute("data-pg") ?? "dark";
}

export type PickOption = { value: string; label: string; hint?: string; disabled?: boolean };

/**
 * The one picker on this surface, built on the repo's Select primitive (Radix: listbox semantics,
 * typeahead, Escape, focus return). Replaces every native <select> here (CLAUDE.md §11). `prefix`
 * draws the muted "Show:" lead the approved design puts inside the filter trigger.
 */
export function TeamPicker({ value, options, onChange, label, labelledBy, placeholder, prefix, changed, disabled, id, className }: { value: string; options: PickOption[]; onChange: (value: string) => void; label?: string; labelledBy?: string; placeholder?: string; prefix?: string; changed?: boolean; disabled?: boolean; id?: string; className?: string }) {
  const trigger = useRef<HTMLButtonElement>(null);
  const [theme, setTheme] = useState("dark");
  const current = options.find((o) => o.value === value);
  return <Select value={value || undefined} disabled={disabled} onValueChange={onChange} onOpenChange={(open) => { if (open) setTheme(closestTheme(trigger.current)); }}>
    <SelectTrigger ref={trigger} id={id} aria-label={label ? `${label}: ${current?.label ?? placeholder ?? ""}` : undefined} aria-labelledby={labelledBy} data-changed={changed ? "true" : undefined} data-empty={current ? undefined : "true"} className={`stw-pick${className ? ` ${className}` : ""}`}>
      {prefix && <span className="stw-pick-prefix">{prefix}</span>}
      <SelectValue placeholder={placeholder} />
    </SelectTrigger>
    <SelectContent className="paige-solo stw-listbox" data-pg={theme} data-theme={theme}>
      {/* The item text is the label alone, so the trigger shows the choice once; the hint sits
          beside it in the list only. Built from the same Radix primitive the shared SelectItem uses. */}
      {options.map((o) => <SelectPrimitive.Item key={o.value} value={o.value} data-value={o.value} disabled={o.disabled} className="stw-option">
        <span className="stw-option-check"><SelectPrimitive.ItemIndicator><Check aria-hidden="true" /></SelectPrimitive.ItemIndicator></span>
        <SelectPrimitive.ItemText>{o.label}</SelectPrimitive.ItemText>{o.hint && <small className="stw-option-hint">{o.hint}</small>}
      </SelectPrimitive.Item>)}
    </SelectContent>

  </Select>;
}

/** A real switch: role="switch", the state in the text as well as the thumb, busy while saving. */
export function TeamSwitch({ checked, onToggle, label, labelledBy, describedBy, busy, disabled, id }: { checked: boolean; onToggle: () => void; label?: string; labelledBy?: string; describedBy?: string; busy?: boolean; disabled?: boolean; id?: string }) {
  return <button type="button" role="switch" id={id} className="stw-switch" aria-checked={checked} aria-label={label} aria-labelledby={labelledBy} aria-describedby={describedBy} aria-busy={busy || undefined} aria-disabled={busy || undefined} disabled={disabled}
    onClick={() => { if (!busy) onToggle(); }}>
    <span className="stw-track" aria-hidden="true"><span className="stw-thumb" /></span><span aria-hidden="true">{checked ? "On" : "Off"}</span>
  </button>;
}

export type MenuItem = { key: string; label: string; icon?: React.ReactNode; tone?: "danger"; onSelect: () => void; separatorBefore?: boolean };

/**
 * The "⋯" row menu. Only the acts the viewer may take are listed; a row the viewer cannot act on
 * renders no button at all, so there is nothing to try and be refused. Arrow keys move, Escape
 * closes and returns focus to the trigger, Tab closes. Positioned fixed so the settings page (the
 * one scroll owner) never clips it.
 */
export function RowMenu({ label, items, triggerId, busy }: { label: string; items: MenuItem[]; triggerId: string; busy?: boolean }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();
  useLayoutEffect(() => {
    if (!open || !trigger.current) return;
    const r = trigger.current.getBoundingClientRect();
    const width = menu.current?.offsetWidth || 224;
    const height = menu.current?.offsetHeight || 0;
    const viewportH = window.innerHeight || 800;
    let top = r.bottom + 4;
    if (height && top + height > viewportH - 8) top = Math.max(8, r.top - height - 4);
    setPos({ top, left: Math.max(8, r.right - width) });
  }, [open]);
  // Focus the first item once the menu is placed: on the first open it renders hidden until its
  // position is known, and a hidden element cannot take focus, so focusing above left it on the trigger.
  useEffect(() => {
    if (open && pos) menu.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus({ preventScroll: true });
  }, [open, pos]);
  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => {
      if (menu.current?.contains(event.target as Node) || trigger.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    const scroll = () => setOpen(false);
    document.addEventListener("mousedown", away);
    window.addEventListener("scroll", scroll, true);
    return () => { document.removeEventListener("mousedown", away); window.removeEventListener("scroll", scroll, true); };
  }, [open]);
  const close = (refocus: boolean) => { setOpen(false); if (refocus) trigger.current?.focus(); };
  return <>
    <button ref={trigger} type="button" id={triggerId} className="stw-more" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined} aria-label={label} aria-disabled={busy || undefined}
      onClick={() => { if (busy) return; setOpen((o) => !o); }}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /><circle cx="5" cy="12" r="1" /></svg>
    </button>
    {open && <div ref={menu} id={menuId} className="stw-menu" role="menu" aria-label={label} style={pos ? { top: pos.top, left: pos.left } : { visibility: "hidden" }}
      onKeyDown={(event) => {
        const nodes = [...(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])];
        const at = nodes.indexOf(document.activeElement as HTMLButtonElement);
        if (event.key === "ArrowDown") { event.preventDefault(); nodes[(at + 1) % nodes.length]?.focus(); }
        else if (event.key === "ArrowUp") { event.preventDefault(); nodes[(at - 1 + nodes.length) % nodes.length]?.focus(); }
        else if (event.key === "Home") { event.preventDefault(); nodes[0]?.focus(); }
        else if (event.key === "End") { event.preventDefault(); nodes[nodes.length - 1]?.focus(); }
        else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(true); }
        else if (event.key === "Tab") { close(false); }
      }}>
      {items.map((item) => <div key={item.key} className="stw-menu-group">
        {item.separatorBefore && <hr />}
        <button type="button" role="menuitem" data-tone={item.tone} onClick={() => {
          // Focus goes back to "⋯" BEFORE the act runs, so an overlay it opens records the trigger as
          // its return target (not document.body), and an in-place act keeps focus on the row.
          setOpen(false); trigger.current?.focus(); item.onSelect();
        }}>{item.icon}{item.label}</button>
      </div>)}
    </div>}
  </>;
}

export type TeamNotice = { text: React.ReactNode; spoken: string; tone?: "ok" | "bad"; action?: { label: string; run: () => void }; focus?: boolean; key: number };

/**
 * The bottom notice every flow returns to. It never pushes rows, so the row acted on stays where it
 * was. Spoken through the polite region. Focus moves here only when the caller says so (an overlay
 * closed, or the focused row is gone); otherwise it stays on the control that acted.
 */
export function NoticeBar({ notice, onDismiss }: { notice: TeamNotice | null; onDismiss: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (notice?.focus) ref.current?.focus(); }, [notice]);
  return <>
    <p className="sr-only" role="status" aria-live="polite">{notice?.spoken ?? ""}</p>
    {notice && <div ref={ref} className="stw-notice" data-tone={notice.tone ?? "ok"} role="region" aria-label="Result" tabIndex={-1}>
      {notice.tone === "bad"
        ? <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" /><path d="M12 9v4" /><path d="M12 17h.01" /></svg>
        : <Check aria-hidden="true" />}
      <p>{notice.text}</p>
      {notice.action && <button type="button" className="stw-btn secondary" onClick={notice.action.run}>{notice.action.label}</button>}
      <button type="button" className="stw-icon-btn" aria-label="Dismiss" onClick={onDismiss}><X /></button>
    </div>}
  </>;
}

/** Two-option permission cards, a radiogroup with arrow-key movement. Replaces the permission <select>. */
export function PermissionCards({ value, onChange, labelledBy, adminDisabledReason }: { value: string; onChange: (value: "member" | "admin") => void; labelledBy: string; adminDisabledReason?: string | null }) {
  const options: { v: "member" | "admin"; label: string; hint: string; disabled: boolean }[] = [
    { v: "member", label: "Member", hint: "Works in the business. Can't manage people.", disabled: false },
    { v: "admin", label: "Admin", hint: adminDisabledReason ?? "Also manages members and invitations.", disabled: Boolean(adminDisabledReason) },
  ];
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  return <div className="stw-seg" role="radiogroup" aria-labelledby={labelledBy}
    onKeyDown={(event) => {
      if (!["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
      event.preventDefault();
      const enabled = options.filter((o) => !o.disabled);
      const at = enabled.findIndex((o) => o.v === value);
      const next = enabled[(at + (event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : enabled.length - 1)) % enabled.length];
      onChange(next.v);
      refs.current[next.v]?.focus();
    }}>
    {options.map((o) => <button key={o.v} ref={(n) => { refs.current[o.v] = n; }} type="button" role="radio" aria-checked={value === o.v} aria-disabled={o.disabled || undefined} tabIndex={value === o.v ? 0 : -1}
      onClick={() => { if (!o.disabled) onChange(o.v); }}>
      <strong><span className="stw-radio" aria-hidden="true" />{o.label}</strong><span>{o.hint}</span>
    </button>)}
  </div>;
}
