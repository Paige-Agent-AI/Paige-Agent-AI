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
}: {
  methods: ContactMethod[];
  onChange: (next: ContactMethod[]) => void;
  errors?: Record<string, string>;
  disabled?: boolean;
  /** Polite live-region text for changes a screen reader would otherwise miss. */
  announce: (message: string) => void;
  copy: Record<ContactMethodKind, KindCopy>;
  firstPersonNoun?: "their" | "your";
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
        const box = root.querySelector<HTMLElement>(`[id="cm-lb-${target.slice(8)}"]`);
        (box?.querySelector<HTMLElement>('[aria-selected="true"]') ?? box?.querySelector<HTMLElement>('[role="option"]'))?.focus();
      } else root.querySelector<HTMLElement>(target)?.focus();
    }
    if (!pending || !root || reduceMotion) return;
    const moved: HTMLElement[] = [];
    root.querySelectorAll<HTMLElement>(`[data-cm-list="${pending.kind}"] [data-cm-id]`).forEach((row) => {
      const before = pending.rects.get(row.dataset.cmId ?? "");
      if (!before) return;
      const dy = before.top - row.getBoundingClientRect().top;
      if (!dy) return;
      row.style.transform = `translateY(${dy}px)`;
      moved.push(row);
      const orb = row.querySelector<HTMLElement>("[data-cm-orb]");
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
      node.addEventListener("transitionend", () => { node.style.transition = ""; }, { once: true });
    })));
  });

  // A click anywhere outside the open label list closes it.
  useEffect(() => {
    if (!labelOpen) return;
    const close = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest(".cm-label")) setLabelOpen(null);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [labelOpen]);

  const capture = (kind: ContactMethodKind) => {
    const root = listRef.current;
    if (!root) return;
    const rects = new Map<string, DOMRect>();
    root.querySelectorAll<HTMLElement>(`[data-cm-list="${kind}"] [data-cm-id]`).forEach((row) => rects.set(row.dataset.cmId ?? "", row.getBoundingClientRect()));
    flip.current = { rects, orb: root.querySelector<HTMLElement>(`[data-cm-list="${kind}"] [data-cm-orb]`)?.getBoundingClientRect() ?? null, kind };
  };

  const describe = (method: ContactMethod) => method.value.trim() || `new ${KIND[method.kind].noun}`;

  const add = (kind: ContactMethodKind) => {
    const { methods: next, id } = addContactMethod(methods, kind);
    setJustAdded(id);
    focusAfter.current = `[id="cm-value-${id}"]`;
    onChange(next);
    announce(`New ${KIND[kind].noun} row added${methodsOfKind(methods, kind).length === 0 ? "; it is the primary" : ""}.`);
  };

  const promote = (method: ContactMethod) => {
    const was = methodsOfKind(methods, method.kind).find((m) => m.isPrimary);
    capture(method.kind);
    focusAfter.current = `[data-cm-id="${method.id}"] [data-cm-label]`;
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
    focusAfter.current = focusTarget ? `[data-cm-id="${focusTarget.id}"] [data-cm-remove]` : `[data-cm-add="${method.kind}"]`;
    onChange(next);
    announce(`Removed ${method.value.trim() || "the empty row"}.${method.isPrimary && remaining[0] ? ` ${describe(remaining[0])} is now the primary ${KIND[method.kind].noun}.` : ""}`);
  };

  const move = (method: ContactMethod, delta: -1 | 1) => {
    const next = moveContactMethod(methods, method.id, delta);
    const ofKind = methodsOfKind(next, method.kind);
    const at = ofKind.findIndex((m) => m.id === method.id);
    capture(method.kind);
    const canKeep = delta === -1 ? at > 1 : at < ofKind.length - 1;
    focusAfter.current = `[data-cm-id="${method.id}"] [data-cm-move="${canKeep ? delta : -delta}"]`;
    onChange(next);
    announce(`${describe(method)} moved to position ${at + 1} of ${ofKind.length}.`);
  };

  const setValue = (method: ContactMethod, value: string) =>
    onChange(methods.map((m) => (m.id === method.id ? { ...m, value } : m)));

  const setLabel = (method: ContactMethod, label: string) => {
    setLabelOpen(null);
    focusAfter.current = `[data-cm-id="${method.id}"] [data-cm-label]`;
    onChange(methods.map((m) => (m.id === method.id ? { ...m, label } : m)));
    announce(`Labelled ${label}.`);
  };

  const onOptionKey = (event: ReactKeyboardEvent<HTMLLIElement>, method: ContactMethod, label: string) => {
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
      focusAfter.current = `[data-cm-id="${method.id}"] [data-cm-label]`;
    }
  };

  return (
    <div className="cm-editor" ref={listRef} onBlur={(event) => {
      if (labelOpen && !event.currentTarget.contains(event.relatedTarget as Node | null)) setLabelOpen(null);
    }}>
      {(["email", "phone"] as const).map((kind) => {
        const k = KIND[kind];
        const list = methodsOfKind(methods, kind);
        const Icon = ICON[kind];
        const full = list.length >= CONTACT_METHODS_PER_KIND;
        return (
          <section key={kind} className="cm-sec" aria-labelledby={`cm-h-${kind}`}>
            <div className="cm-sec-h">
              <h3 id={`cm-h-${kind}`}>{k.title}{list.length > 0 && <span className="cm-n">{list.length}</span>}</h3>
              {list.length > 0 && <p>{list.length > 1 ? `Paige ${k.verb} to the primary and recognises every one.` : `Paige ${k.verb} here.`}</p>}
            </div>
            <ul className="cm-list" data-cm-list={kind}>
              {list.length === 0 ? (
                <li className="cm-row cm-slot">
                  <button type="button" className="cm-add" data-cm-add={kind} disabled={disabled} onClick={() => add(kind)}>
                    <span className="cm-ring" aria-hidden />
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
                    data-cm-id={method.id}
                    className={["cm-row", method.isPrimary && "is-primary", error && "has-err", justAdded === method.id && "is-new"].filter(Boolean).join(" ")}
                    onAnimationEnd={() => justAdded === method.id && setJustAdded(null)}
                  >
                    <span className="cm-mark">{method.isPrimary ? <span className="cm-orb" data-cm-orb aria-hidden /> : <Icon aria-hidden />}</span>
                    <span className="cm-body">
                      <label className="sr-only" htmlFor={`cm-value-${method.id}`}>{kind === "email" ? "Email address" : "Phone number"} {index + 1}{method.isPrimary ? ", primary" : ""}</label>
                      <input
                        id={`cm-value-${method.id}`}
                        className={kind === "phone" ? "cm-in is-mono" : "cm-in"}
                        type={k.type}
                        inputMode={k.inputMode}
                        autoComplete="off"
                        spellCheck={false}
                        value={method.value}
                        placeholder={k.placeholder}
                        disabled={disabled}
                        aria-invalid={error ? true : undefined}
                        aria-describedby={error ? `cm-err-${method.id}` : undefined}
                        onChange={(event) => setValue(method, event.target.value)}
                      />
                      {method.isPrimary && <span className="cm-meta"><b>Primary</b> · Paige {k.verb} here</span>}
                      {error && <span className="cm-err" id={`cm-err-${method.id}`}>{error}</span>}
                    </span>
                    <span className="cm-label">
                      <button
                        type="button"
                        className="cm-tag"
                        data-cm-label
                        aria-haspopup="listbox"
                        aria-expanded={open}
                        aria-controls={open ? `cm-lb-${method.id}` : undefined}
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
                        <ul className="cm-lb" role="listbox" id={`cm-lb-${method.id}`} aria-label={`Label for ${name}`}>
                          {labels.map((label) => (
                            <li key={label} role="option" tabIndex={-1} aria-selected={label === method.label} onClick={() => setLabel(method, label)} onKeyDown={(event) => onOptionKey(event, method, label)}>
                              {label}{label === method.label && <Check aria-hidden />}
                            </li>
                          ))}
                        </ul>
                      )}
                    </span>
                    <span className="cm-acts">
                      {!method.isPrimary && (
                        <button type="button" className="cm-mk" aria-label={`Make ${name} the primary ${k.noun}`} disabled={disabled} onClick={() => promote(method)}>Make primary</button>
                      )}
                      <span className="cm-tools">
                        {!method.isPrimary && (
                          <>
                            <button type="button" className="cm-ib" data-cm-move="-1" aria-label={`Move ${name} up`} disabled={disabled || index <= 1} onClick={() => move(method, -1)}><ChevronUp aria-hidden /></button>
                            <button type="button" className="cm-ib" data-cm-move="1" aria-label={`Move ${name} down`} disabled={disabled || index === list.length - 1} onClick={() => move(method, 1)}><ChevronDown aria-hidden /></button>
                          </>
                        )}
                        <button type="button" className="cm-ib is-rm" data-cm-remove aria-label={`Remove ${name}`} disabled={disabled} onClick={() => remove(method)}><X aria-hidden /></button>
                      </span>
                    </span>
                  </li>
                );
              })}
              {list.length > 0 && !full && (
                <li className="cm-row cm-addrow">
                  <button type="button" className="cm-add" data-cm-add={kind} disabled={disabled} onClick={() => add(kind)}>
                    <span className="cm-ring" aria-hidden><Plus /></span><span>{k.add}</span>
                  </button>
                </li>
              )}
            </ul>
            {full && <p className="cm-cap">{CONTACT_METHODS_PER_KIND} is the most a record can hold.</p>}
          </section>
        );
      })}
    </div>
  );
}

/** The same list, read only: the saved record. */
export function ContactMethodsList({ methods, heardId = null }: { methods: ContactMethod[]; heardId?: string | null }) {
  return (
    <div className="cm-editor is-readonly">
      {(["email", "phone"] as const).map((kind) => {
        const k = KIND[kind];
        const list = methodsOfKind(methods, kind);
        const Icon = ICON[kind];
        return (
          <section key={kind} className="cm-sec" aria-labelledby={`cm-rh-${kind}`}>
            <div className="cm-sec-h">
              <h3 id={`cm-rh-${kind}`}>{k.title}{list.length > 0 && <span className="cm-n">{list.length}</span>}</h3>
              {list.length > 1 && <p>Paige {k.verb} to the primary and recognises every one.</p>}
            </div>
            <ul className="cm-list" data-cm-list={kind}>
              {list.length === 0 ? (
                <li className="cm-row"><span className="cm-mark"><Icon aria-hidden /></span><span className="cm-body"><span className="cm-meta">Not recorded</span></span></li>
              ) : list.map((method) => (
                <li key={method.id} data-cm-id={method.id} className={["cm-row", method.isPrimary && "is-primary", heardId === method.id && "is-heard"].filter(Boolean).join(" ")}>
                  <span className="cm-mark">{method.isPrimary ? <span className="cm-orb" aria-hidden /> : <Icon aria-hidden />}</span>
                  <span className="cm-body">
                    <span className={kind === "phone" ? "cm-val is-mono" : "cm-val"}>{method.value}</span>
                    {method.isPrimary && <span className="cm-meta"><b>Primary</b> · Paige {k.verb} here</span>}
                  </span>
                  <span className="cm-label">{method.label && <span className="cm-tag">{method.label}</span>}</span>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
