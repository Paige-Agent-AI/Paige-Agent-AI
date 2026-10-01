import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Check, ChevronDown, ChevronUp, Mail, Phone, Plus, X } from "lucide-react";
import { useReducedMotion } from "framer-motion";
import {
  CONTACT_METHOD_LABELS,
  CONTACT_METHODS_PER_KIND,
  addContactMethod,
  makePrimary,
  methodsOfKind,
  moveContactMethod,
  removeContactMethod,
  type ContactMethod,
  type ContactMethodKind,
} from "@/lib/contact-methods";
import "./contact-methods.css";

type KindCopy = { empty: string };

const KIND = {
  email: { title: "Email", noun: "email", add: "Add an email", first: "Add their first email", placeholder: "name@company.com", verb: "sends", type: "email", inputMode: "email" },
  phone: { title: "Phone", noun: "phone", add: "Add a phone", first: "Add their first phone", placeholder: "+1 (512) 555-0100", verb: "texts", type: "tel", inputMode: "tel" },
} as const;

const ICON = { email: Mail, phone: Phone };

/** Who the addresses belong to decides what may be promised about them. For a client, Paige sends to
 *  the primary and recognises every address on inbound; for a person on the team neither is true, so
 *  the copy only says which address is primary (§13). */
export type ContactMethodsAudience = "client" | "person";
const sectionHint = (audience: ContactMethodsAudience, verb: string, count: number): string | null =>
  audience === "client"
    ? count > 1 ? `Paige ${verb} to the primary and recognises every one.` : count === 1 ? `Paige ${verb} here.` : null
    : count > 1 ? "The primary comes first." : null;
const PrimaryMeta = ({ audience, verb }: { audience: ContactMethodsAudience; verb: string }) =>
  audience === "client" ? <span className="ctm-meta"><b>Primary</b> · Paige {verb} here</span> : <span className="ctm-meta"><b>Primary</b></span>;

/**
 * Several emails and phones, one primary of each (approved design, comp A, 2026-09-28).
 * The primary is always first and carries the orb; "Make primary" moves an address to the top and
 * the orb travels to it. Every change goes through the pure helpers in @/lib/contact-methods, so
 * the screen can never hold a list the database would refuse for shape.
 */
export function ContactMethodsEditor({
  methods,
  onChange,
  errors = {},
  disabled = false,
  announce,
  copy,
  firstPersonNoun = "their",
  audience = "client",
}: {
  methods: ContactMethod[];
  onChange: (next: ContactMethod[]) => void;
  errors?: Record<string, string>;
  disabled?: boolean;
  /** Polite live-region text for changes a screen reader would otherwise miss. */
  announce: (message: string) => void;
  copy: Record<ContactMethodKind, KindCopy>;
  firstPersonNoun?: "their" | "your";
  audience?: ContactMethodsAudience;
}) {
  const reduceMotion = useReducedMotion();
  const listRef = useRef<HTMLDivElement | null>(null);
  const flip = useRef<{ rects: Map<string, DOMRect>; orb: DOMRect | null; kind: ContactMethodKind } | null>(null);
  const [labelOpen, setLabelOpen] = useState<string | null>(null);
  const [justAdded, setJustAdded] = useState<string | null>(null);
  const focusAfter = useRef<string | null>(null);

  // Rows glide to their new places; the orb travels from the old primary to the new one.
  useLayoutEffect(() => {
    const pending = flip.current;
    flip.current = null;
    const root = listRef.current;
    if (focusAfter.current && root) {
      const target = focusAfter.current;
      focusAfter.current = null;
      if (target.startsWith("listbox:")) {
        const box = root.querySelector<HTMLElement>(`[id="ctm-lb-${target.slice(8)}"]`);
        (box?.querySelector<HTMLElement>('[aria-selected="true"]') ?? box?.querySelector<HTMLElement>('[role="option"]'))?.focus();
      } else root.querySelector<HTMLElement>(target)?.focus();
    }
    if (!pending || !root || reduceMotion) return;
    const moved: HTMLElement[] = [];
    root.querySelectorAll<HTMLElement>(`[data-ctm-list="${pending.kind}"] [data-ctm-id]`).forEach((row) => {
      const before = pending.rects.get(row.dataset.ctmId ?? "");
      if (!before) return;
      const dy = before.top - row.getBoundingClientRect().top;
      if (!dy) return;
      row.style.transform = `translateY(${dy}px)`;
      moved.push(row);
      const orb = row.querySelector<HTMLElement>("[data-ctm-orb]");
      if (orb && pending.orb) {
        const now = orb.getBoundingClientRect();
        orb.style.transform = `translate(${pending.orb.left - now.left}px, ${pending.orb.top - now.top - dy}px)`;
        moved.push(orb);
      }
    });
    if (!moved.length) return;
    requestAnimationFrame(() => requestAnimationFrame(() => moved.forEach((node) => {
      node.style.transition = "transform 420ms cubic-bezier(.22,1,.36,1)";
      node.style.transform = "";
      // transitionend bubbles: only this node's own transform ends the glide, never a child's fade.
      const done = (event: TransitionEvent) => {
        if (event.target !== node || event.propertyName !== "transform") return;
        node.style.transition = "";
        node.removeEventListener("transitionend", done);
      };
      node.addEventListener("transitionend", done);
    })));
  });

  // A click anywhere outside the open label list closes it.
  useEffect(() => {
    if (!labelOpen) return;
    const close = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest(".ctm-label")) setLabelOpen(null);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [labelOpen]);

  const capture = (kind: ContactMethodKind) => {
    const root = listRef.current;
    if (!root) return;
    const rects = new Map<string, DOMRect>();
    root.querySelectorAll<HTMLElement>(`[data-ctm-list="${kind}"] [data-ctm-id]`).forEach((row) => rects.set(row.dataset.ctmId ?? "", row.getBoundingClientRect()));
    flip.current = { rects, orb: root.querySelector<HTMLElement>(`[data-ctm-list="${kind}"] [data-ctm-orb]`)?.getBoundingClientRect() ?? null, kind };
  };

  const describe = (method: ContactMethod) => method.value.trim() || `new ${KIND[method.kind].noun}`;

  const add = (kind: ContactMethodKind) => {
    const { methods: next, id } = addContactMethod(methods, kind);
    setJustAdded(id);
    focusAfter.current = `[id="ctm-value-${id}"]`;
    onChange(next);
    announce(`New ${KIND[kind].noun} row added${methodsOfKind(methods, kind).length === 0 ? "; it is the primary" : ""}.`);
  };

  const promote = (method: ContactMethod) => {
    const was = methodsOfKind(methods, method.kind).find((m) => m.isPrimary);
    capture(method.kind);
    focusAfter.current = `[data-ctm-id="${method.id}"] [data-ctm-label]`;
    onChange(makePrimary(methods, method.id));
    announce(`${describe(method)} is now the primary ${KIND[method.kind].noun}${was ? `; ${describe(was)} is kept as a secondary` : ""}.`);
  };

  const remove = (method: ContactMethod) => {
    const ofKind = methodsOfKind(methods, method.kind);
    const index = ofKind.findIndex((m) => m.id === method.id);
    const next = removeContactMethod(methods, method.id);
    const remaining = methodsOfKind(next, method.kind);
    const focusTarget = remaining[Math.min(index, remaining.length - 1)];
    capture(method.kind);
    focusAfter.current = focusTarget ? `[data-ctm-id="${focusTarget.id}"] [data-ctm-remove]` : `[data-ctm-add="${method.kind}"]`;
    onChange(next);
    announce(`Removed ${method.value.trim() || "the empty row"}.${method.isPrimary && remaining[0] ? ` ${describe(remaining[0])} is now the primary ${KIND[method.kind].noun}.` : ""}`);
  };

  const move = (method: ContactMethod, delta: -1 | 1) => {
    const next = moveContactMethod(methods, method.id, delta);
    const ofKind = methodsOfKind(next, method.kind);
    const at = ofKind.findIndex((m) => m.id === method.id);
    capture(method.kind);
    const canKeep = delta === -1 ? at > 1 : at < ofKind.length - 1;
    focusAfter.current = `[data-ctm-id="${method.id}"] [data-ctm-move="${canKeep ? delta : -delta}"]`;
    onChange(next);
    announce(`${describe(method)} moved to position ${at + 1} of ${ofKind.length}.`);
  };

  const setValue = (method: ContactMethod, value: string) =>
    onChange(methods.map((m) => (m.id === method.id ? { ...m, value } : m)));

  const setLabel = (method: ContactMethod, label: string | null) => {
    setLabelOpen(null);
    focusAfter.current = `[data-ctm-id="${method.id}"] [data-ctm-label]`;
    onChange(methods.map((m) => (m.id === method.id ? { ...m, label } : m)));
    announce(label ? `Labelled ${label}.` : "Label removed.");
  };

  const onOptionKey = (event: ReactKeyboardEvent<HTMLLIElement>, method: ContactMethod, label: string | null) => {
    const options = Array.from(event.currentTarget.parentElement?.querySelectorAll<HTMLLIElement>('[role="option"]') ?? []);
    const index = options.indexOf(event.currentTarget);
    const go = (i: number) => { event.preventDefault(); options[(i + options.length) % options.length]?.focus(); };
    if (event.key === "ArrowDown") go(index + 1);
    else if (event.key === "ArrowUp") go(index - 1);
    else if (event.key === "Home") go(0);
    else if (event.key === "End") go(options.length - 1);
    else if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setLabel(method, label); }
    else if (event.key === "Escape" || event.key === "Tab") {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); }
      setLabelOpen(null);
      focusAfter.current = `[data-ctm-id="${method.id}"] [data-ctm-label]`;
    }
  };

  return (
    <div className="ctm-editor" ref={listRef} onBlur={(event) => {
      if (labelOpen && !event.currentTarget.contains(event.relatedTarget as Node | null)) setLabelOpen(null);
    }}>
      {(["email", "phone"] as const).map((kind) => {
        const k = KIND[kind];
        const list = methodsOfKind(methods, kind);
        const Icon = ICON[kind];
        const full = list.length >= CONTACT_METHODS_PER_KIND;
        return (
          <section key={kind} className="ctm-sec" aria-labelledby={`ctm-h-${kind}`}>
            <div className="ctm-sec-h">
              <h3 id={`ctm-h-${kind}`}>{k.title}{list.length > 0 && <span className="ctm-n">{list.length}</span>}</h3>
              {sectionHint(audience, k.verb, list.length) && <p>{sectionHint(audience, k.verb, list.length)}</p>}
            </div>
            <ul className="ctm-list" data-ctm-list={kind}>
              {list.length === 0 ? (
                <li className="ctm-row ctm-slot">
                  <button type="button" className="ctm-add" data-ctm-add={kind} disabled={disabled} onClick={() => add(kind)}>
                    <span className="ctm-ring" aria-hidden />
                    <span><strong>{firstPersonNoun === "your" ? `Add your first ${k.noun}` : k.first}</strong><small>{copy[kind].empty}</small></span>
                  </button>
                </li>
              ) : list.map((method, index) => {
                const error = errors[method.id];
                const name = describe(method);
                const labels = method.label && !CONTACT_METHOD_LABELS[kind].includes(method.label) ? [method.label, ...CONTACT_METHOD_LABELS[kind]] : CONTACT_METHOD_LABELS[kind];
                const open = labelOpen === method.id;
                return (
                  <li
                    key={method.id}
                    data-ctm-id={method.id}
                    className={["ctm-row", method.isPrimary && "is-primary", error && "has-err", justAdded === method.id && "is-new"].filter(Boolean).join(" ")}
                    onAnimationEnd={() => justAdded === method.id && setJustAdded(null)}
                  >
                    <span className="ctm-mark">{method.isPrimary ? <span className="ctm-orb" data-ctm-orb aria-hidden /> : <Icon aria-hidden />}</span>
                    <span className="ctm-body">
                      <label className="sr-only" htmlFor={`ctm-value-${method.id}`}>{kind === "email" ? "Email address" : "Phone number"} {index + 1}{method.isPrimary ? ", primary" : ""}</label>
                      <input
                        id={`ctm-value-${method.id}`}
                        className={kind === "phone" ? "ctm-in is-mono" : "ctm-in"}
                        type={k.type}
                        inputMode={k.inputMode}
                        autoComplete="off"
                        spellCheck={false}
                        value={method.value}
                        placeholder={k.placeholder}
                        disabled={disabled}
                        aria-invalid={error ? true : undefined}
                        aria-describedby={error ? `ctm-err-${method.id}` : undefined}
                        onChange={(event) => setValue(method, event.target.value)}
                      />
                      {method.isPrimary && <PrimaryMeta audience={audience} verb={k.verb} />}
                      {error && <span className="ctm-err" id={`ctm-err-${method.id}`}>{error}</span>}
                    </span>
                    <span className="ctm-label">
                      <button
                        type="button"
                        className="ctm-tag"
                        data-ctm-label
                        aria-haspopup="listbox"
                        aria-expanded={open}
                        aria-controls={open ? `ctm-lb-${method.id}` : undefined}
                        aria-label={`Label for ${name}: ${method.label ?? "none"}`}
                        disabled={disabled}
                        onClick={() => {
                          setLabelOpen(open ? null : method.id);
                          focusAfter.current = open ? null : `listbox:${method.id}`;
                        }}
                      >
                        {method.label ?? "Label"}<ChevronDown aria-hidden />
                      </button>
                      {open && (
                        <ul className="ctm-lb" role="listbox" id={`ctm-lb-${method.id}`} aria-label={`Label for ${name}`}>
                          {[...labels, null].map((label) => (
                            <li key={label ?? "none"} role="option" tabIndex={-1} className={label ? undefined : "is-none"} aria-selected={label === method.label} onClick={() => setLabel(method, label)} onKeyDown={(event) => onOptionKey(event, method, label)}>
                              {label ?? "No label"}{label === method.label && <Check aria-hidden />}
                            </li>
                          ))}
                        </ul>
                      )}
                    </span>
                    <span className="ctm-acts">
                      {!method.isPrimary && (
                        <button type="button" className="ctm-mk" aria-label={`Make primary: ${name}`} disabled={disabled} onClick={() => promote(method)}>Make primary</button>
                      )}
                      <span className="ctm-tools">
                        {!method.isPrimary && (
                          <>
                            <button type="button" className="ctm-ib" data-ctm-move="-1" aria-label={`Move ${name} up`} title="Move up" disabled={disabled || index <= 1} onClick={() => move(method, -1)}><ChevronUp aria-hidden /></button>
                            <button type="button" className="ctm-ib" data-ctm-move="1" aria-label={`Move ${name} down`} title="Move down" disabled={disabled || index === list.length - 1} onClick={() => move(method, 1)}><ChevronDown aria-hidden /></button>
                          </>
                        )}
                        <button type="button" className="ctm-ib is-rm" data-ctm-remove aria-label={`Remove ${name}`} title="Remove" disabled={disabled} onClick={() => remove(method)}><X aria-hidden /></button>
                      </span>
                    </span>
                  </li>
                );
              })}
              {list.length > 0 && !full && (
                <li className="ctm-row ctm-addrow">
                  <button type="button" className="ctm-add" data-ctm-add={kind} disabled={disabled} onClick={() => add(kind)}>
                    <span className="ctm-ring" aria-hidden><Plus /></span><span>{k.add}</span>
                  </button>
                </li>
              )}
            </ul>
            {full && <p className="ctm-cap">{CONTACT_METHODS_PER_KIND} is the most a record can hold.</p>}
          </section>
        );
      })}
    </div>
  );
}

/** The same list, read only: the saved record. */
export function ContactMethodsList({ methods, headingLevel = 3 }: { methods: ContactMethod[]; /** Sits under the caller's own heading, one level down. */ headingLevel?: 3 | 4 }) {
  const audience: ContactMethodsAudience = "client";
  const Heading = headingLevel === 4 ? "h4" : "h3";
  return (
    <div className="ctm-editor is-readonly">
      {(["email", "phone"] as const).map((kind) => {
        const k = KIND[kind];
        const list = methodsOfKind(methods, kind);
        const Icon = ICON[kind];
        return (
          <section key={kind} className="ctm-sec" aria-labelledby={`ctm-rh-${kind}`}>
            <div className="ctm-sec-h">
              <Heading id={`ctm-rh-${kind}`}>{k.title}{list.length > 0 && <span className="ctm-n">{list.length}</span>}</Heading>
              {list.length > 1 && sectionHint(audience, k.verb, list.length) && <p>{sectionHint(audience, k.verb, list.length)}</p>}
            </div>
            <ul className="ctm-list" data-ctm-list={kind}>
              {list.length === 0 ? (
                <li className="ctm-row"><span className="ctm-mark"><Icon aria-hidden /></span><span className="ctm-body"><span className="ctm-meta">Not recorded</span></span></li>
              ) : list.map((method) => (
                <li key={method.id} data-ctm-id={method.id} className={method.isPrimary ? "ctm-row is-primary" : "ctm-row"}>
                  <span className="ctm-mark">{method.isPrimary ? <span className="ctm-orb" aria-hidden /> : <Icon aria-hidden />}</span>
                  <span className="ctm-body">
                    <span className={kind === "phone" ? "ctm-val is-mono" : "ctm-val"}>{method.value}</span>
                    {method.isPrimary && <PrimaryMeta audience={audience} verb={k.verb} />}
                  </span>
                  <span className="ctm-label">{method.label && <span className="ctm-tag">{method.label}</span>}</span>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
