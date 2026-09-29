import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { useBeforeUnloadGuard } from "@/hooks/useBeforeUnloadGuard";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { CONTACT_SOURCES, LIFECYCLE_STAGES } from "@/lib/contacts";
import { ContactMethodsEditor } from "@/components/contact-methods/ContactMethodsEditor";
import {
  contactMethodErrorFor,
  methodsOfKind,
  toContactMethodsPayload,
  validateContactMethods,
  type ContactMethod,
} from "@/lib/contact-methods";
import type { RelationshipPerson } from "./useTenantRelationshipsData";
import { upsertRelationshipContact, type ContactUpsertPatch } from "./contactUpsert";

type Coach = { user_id: string; name: string };
type EditorStep = 0 | 1 | 2;

type FormState = {
  recordType: "person" | "business";
  firstName: string;
  lastName: string;
  entityName: string;
  title: string;
  contactMethods: ContactMethod[];
  website: string;
  linkedinUrl: string;
  streetAddress: string;
  city: string;
  state: string;
  zipCode: string;
  lifecycleStage: string;
  status: string;
  source: string;
  tags: string;
  primaryOffer: string;
  notes: string;
  assignedCoachUserId: string;
  doNotContact: boolean;
};

const STEPS = ["Identity", "Business context", "Relationship & consent"] as const;

const EMPTY_FORM: FormState = {
  recordType: "person",
  firstName: "",
  lastName: "",
  entityName: "",
  title: "",
  contactMethods: [],
  website: "",
  linkedinUrl: "",
  streetAddress: "",
  city: "",
  state: "",
  zipCode: "",
  lifecycleStage: "new_lead",
  status: "active",
  source: "manual",
  tags: "",
  primaryOffer: "",
  notes: "",
  assignedCoachUserId: "unassigned",
  doNotContact: false,
};

const formFor = (contact: RelationshipPerson | null): FormState => contact ? {
  recordType: contact.recordType,
  firstName: contact.firstName,
  lastName: contact.lastName,
  entityName: contact.company ?? "",
  title: contact.title ?? "",
  contactMethods: contact.contactMethods.map((method) => ({ ...method })),
  website: contact.website ?? "",
  linkedinUrl: contact.linkedinUrl ?? "",
  streetAddress: contact.streetAddress ?? "",
  city: contact.city ?? "",
  state: contact.state ?? "",
  zipCode: contact.zipCode ?? "",
  lifecycleStage: contact.lifecycleStage,
  status: contact.status,
  source: contact.source ?? "manual",
  tags: contact.tags.join(", "),
  primaryOffer: contact.primaryOffer ?? "",
  notes: contact.notes ?? "",
  assignedCoachUserId: contact.assignedCoachUserId ?? "unassigned",
  doNotContact: contact.doNotContact,
} : { ...EMPTY_FORM };

const optional = (value: string) => value.trim() || null;

export function PeopleContactEditor({
  open,
  onOpenChange,
  tenantId,
  contact,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenantId: string;
  contact: RelationshipPerson | null;
  onSaved: (contactId: string) => Promise<void> | void;
}) {
  const [form, setForm] = useState<FormState>(() => formFor(contact));
  const [coaches, setCoaches] = useState<Coach[]>([]);
  const [step, setStep] = useState<EditorStep>(0);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  useBeforeUnloadGuard(open && (dirty || saving));
  const [confirmClose, setConfirmClose] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [methodErrors, setMethodErrors] = useState<Record<string, string>>({});
  // The value each shown error was raised against: an error stays until THAT row changes.
  const erroredValues = useRef<Record<string, string>>({});
  const showMethodErrors = (errors: Record<string, string>, methods: ContactMethod[]) => {
    erroredValues.current = Object.fromEntries(Object.keys(errors).map((id) => [id, methods.find((m) => m.id === id)?.value ?? ""]));
    setMethodErrors(errors);
  };
  const [announcement, setAnnouncement] = useState("");
  const [offline, setOffline] = useState(() => typeof navigator !== "undefined" && !navigator.onLine);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const overlayRef = useRef<HTMLHeadingElement | HTMLButtonElement | null>(null);
  const editing = Boolean(contact);

  useEffect(() => {
    if (!open) return;
    setForm(formFor(contact));
    setStep(0);
    setDirty(false);
    setConfirmClose(false);
    setSaved(false);
    setError(null);
    setMethodErrors({});
    erroredValues.current = {};
    setSaving(false);
    let current = true;
    void (async () => {
      // Generated Supabase types do not yet include this established roster RPC.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase as any).rpc("get_tenant_assignable_members");
      if (current) setCoaches((data ?? [])
        .filter(({ roles }: { roles?: string[] }) => (roles ?? []).some((role) => ["admin", "super_admin"].includes(role)))
        .map(({ user_id, full_name }: { user_id: string; full_name: string | null }) => ({ user_id, name: full_name || "Unnamed coach" })));
    })();
    const focusTimer = window.setTimeout(() => headingRef.current?.focus(), 0);
    return () => {
      current = false;
      window.clearTimeout(focusTimer);
    };
  }, [contact, open, tenantId]);

  useEffect(() => {
    if (!open) return;
    const updateOnlineState = () => setOffline(!navigator.onLine);
    window.addEventListener("online", updateOnlineState);
    window.addEventListener("offline", updateOnlineState);
    return () => {
      window.removeEventListener("online", updateOnlineState);
      window.removeEventListener("offline", updateOnlineState);
    };
  }, [open]);

  useEffect(() => {
    if (!confirmClose && !saving && !saved) return;
    const focusTimer = window.setTimeout(() => overlayRef.current?.focus(), 0);
    return () => window.clearTimeout(focusTimer);
  }, [confirmClose, saved, saving]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || saving) return;
      if (saved || !dirty) onOpenChange(false);
      else setConfirmClose(true);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dirty, onOpenChange, open, saved, saving]);

  if (!open) return null;

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((previous) => ({ ...previous, [key]: value }));
    setDirty(true);
    setSaved(false);
    setError(null);
  };

  const setMethods = (contactMethods: ContactMethod[]) => {
    set("contactMethods", contactMethods);
    // A row's problem clears when that row changes and the change fixes it; every other row keeps
    // its problem — including a refusal from the server, which the client's own checks cannot see.
    setMethodErrors((previous) => {
      const fresh = validateContactMethods(contactMethods);
      return Object.fromEntries(Object.entries(previous).filter(([id, text]) => {
        const row = contactMethods.find((method) => method.id === id);
        if (!row) return false;
        if (row.value === erroredValues.current[id]) return true;
        return Boolean(fresh[id]) && fresh[id] === text;
      }));
    });
  };

  const announce = (message: string) => {
    setAnnouncement("");
    window.setTimeout(() => setAnnouncement(message), 30);
  };

  const validateIdentity = () => {
    const rowErrors = validateContactMethods(form.contactMethods);
    if (Object.keys(rowErrors).length) {
      setStep(0);
      showMethodErrors(rowErrors, form.contactMethods);
      setError("Some addresses need attention. Your draft is unchanged.");
      window.setTimeout(() => document.getElementById(`ctm-value-${Object.keys(rowErrors)[0]}`)?.focus(), 0);
      return false;
    }
    const hasIdentity = Boolean(form.firstName.trim() || form.lastName.trim() || form.entityName.trim() || methodsOfKind(form.contactMethods, "email").length);
    if (!hasIdentity) {
      setStep(0);
      setError("Add at least a name, business, or email. Your draft is unchanged.");
      toast.error("Add at least a name, business, or email");
      return false;
    }
    if (form.recordType === "business" && !form.entityName.trim()) {
      setStep(0);
      setError("Business name is required for a business record. Your draft is unchanged.");
      toast.error("Business name is required for a business record");
      return false;
    }
    return true;
  };

  const save = async () => {
    if (!validateIdentity()) return;
    if (offline) {
      setError("You are offline. This draft remains available; saving is unavailable.");
      return;
    }
    const patch: ContactUpsertPatch = {
      first_name: optional(form.firstName),
      last_name: optional(form.lastName),
      entity_name: optional(form.entityName),
      entity_type: form.recordType === "business" ? (contact?.entityType || "business") : null,
      title: optional(form.title),
      website: optional(form.website),
      linkedin_url: optional(form.linkedinUrl),
      street_address: optional(form.streetAddress),
      city: optional(form.city),
      state: optional(form.state),
      zip_code: optional(form.zipCode),
      lifecycle_stage: form.lifecycleStage,
      status: form.status,
      source: optional(form.source),
      tags: Array.from(new Set(form.tags.split(",").map((tag) => tag.trim()).filter(Boolean))),
      primary_offer: optional(form.primaryOffer),
      current_notes: optional(form.notes),
      assigned_coach_user_id: form.assignedCoachUserId === "unassigned" ? null : form.assignedCoachUserId,
      do_not_contact: form.doNotContact,
    };
    // The address list replaces what is stored, so it is sent only when the person changed it (or
    // for a new contact). A save of notes or tags must never overwrite addresses that arrived after
    // this editor opened — a merge, Paige, or an inbound match can add one in the meantime.
    const methodsPayload = toContactMethodsPayload(form.contactMethods);
    if (!contact || JSON.stringify(methodsPayload) !== JSON.stringify(toContactMethodsPayload(contact.contactMethods))) {
      patch.contact_methods = methodsPayload;
    }
    setSaving(true);
    setError(null);
    try {
      const contactId = await upsertRelationshipContact({ tenantId, contactId: contact?.id, patch });
      await onSaved(contactId);
      setDirty(false);
      setSaved(true);
      toast.success(editing ? "Contact updated" : "Contact created");
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : "Contact save failed";
      const onRow = contactMethodErrorFor(form.contactMethods, message);
      if (onRow) {
        setStep(0);
        showMethodErrors({ [onRow.id]: onRow.text }, form.contactMethods);
        setError("Not saved. One address needs attention. Your draft is unchanged.");
        window.setTimeout(() => document.getElementById(`ctm-value-${onRow.id}`)?.focus(), 0);
      } else {
        // A refusal code the rows cannot place (a label, the per-kind cap, a missing primary) never
        // reaches the screen as a raw code: it is named in plain words, and the draft is kept.
        const shown = /^CONTACT_METHODS?_/.test(message)
          ? "Not saved. The addresses could not be accepted as entered; check each row and try again. Your draft is unchanged."
          : message;
        setError(shown);
        toast.error(shown);
      }
    } finally {
      setSaving(false);
    }
  };

  const requestClose = () => {
    if (saving) return;
    if (saved || !dirty) onOpenChange(false);
    else setConfirmClose(true);
  };

  const continueFlow = () => {
    if (step === 0 && !validateIdentity()) return;
    if (step < 2) {
      setError(null);
      setStep((step + 1) as EditorStep);
      return;
    }
    void save();
  };

  const moveStepFocus = (event: ReactKeyboardEvent<HTMLButtonElement>, currentStep: number) => {
    let nextStep: EditorStep | null = null;
    if (event.key === "ArrowRight") nextStep = ((currentStep + 1) % STEPS.length) as EditorStep;
    if (event.key === "ArrowLeft") nextStep = ((currentStep + STEPS.length - 1) % STEPS.length) as EditorStep;
    if (event.key === "Home") nextStep = 0;
    if (event.key === "End") nextStep = 2;
    if (nextStep === null) return;
    event.preventDefault();
    setError(null);
    setStep(nextStep);
    event.currentTarget.parentElement
      ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
      .item(nextStep)
      .focus();
  };

  return (
    <div className="trc-contact-editor" data-contact-editor>
      <header className="trc-contact-editor-header">
        <div>
          <span>People / {editing ? contact?.name : "New contact"}</span>
          <h1 ref={headingRef} tabIndex={-1}>{editing ? "Edit contact" : "Create contact"}</h1>
          <small>Tenant-owned record · owner-editable fields</small>
        </div>
        <Button type="button" variant="outline" onClick={requestClose} disabled={saving}>Close editor</Button>
      </header>

      <div className="trc-contact-editor-steps" role="tablist" aria-label="Contact editor chapters">
        {STEPS.map((label, index) => (
          <button
            key={label}
            id={`trc-contact-step-${index + 1}`}
            type="button"
            role="tab"
            aria-selected={step === index}
            aria-controls="trc-contact-editor-panel"
            tabIndex={step === index ? 0 : -1}
            className={step === index ? "is-active" : undefined}
            onKeyDown={(event) => moveStepFocus(event, index)}
            onClick={() => {
              setError(null);
              setStep(index as EditorStep);
            }}
          >
            <small>Step {index + 1} of 3</small>
            {label}
          </button>
        ))}
      </div>

      <section
        id="trc-contact-editor-panel"
        role="tabpanel"
        aria-labelledby={`trc-contact-step-${step + 1}`}
        className="trc-contact-editor-panel"
        aria-live="polite"
      >
        <header>
          <div>
            <h2>{STEPS[step]}</h2>
            <p>{step === 0 ? "Who this is, and every address they use." : step === 1 ? "Add business and lifecycle context." : "Review notes, tags, and communication controls."}</p>
          </div>
          <span>Draft retained locally</span>
        </header>

        {step === 0 && (
          <div className="trc-identity">
            <IdentityPlate form={form} set={set} dirty={dirty} />
            <ContactMethodsEditor
              methods={form.contactMethods}
              onChange={setMethods}
              errors={methodErrors}
              disabled={saving}
              announce={announce}
              copy={{
                email: { empty: "It becomes the primary: the address Paige sends to. Add every address they write from." },
                phone: { empty: "It becomes the primary: the number Paige texts. Add their mobile and any work line." },
              }}
            />
          </div>
        )}

        {step === 1 && (
          <div className="trc-contact-editor-fields">
            <Field label="Title / role"><Input value={form.title} onChange={(event) => set("title", event.target.value)} /></Field>
            <Field label="Website"><Input type="url" value={form.website} onChange={(event) => set("website", event.target.value)} /></Field>
            <Field label="LinkedIn" className="trc-contact-editor-span-2"><Input type="url" value={form.linkedinUrl} onChange={(event) => set("linkedinUrl", event.target.value)} /></Field>
            <Field label="Street address" className="trc-contact-editor-span-2"><Input value={form.streetAddress} onChange={(event) => set("streetAddress", event.target.value)} /></Field>
            <Field label="City"><Input value={form.city} onChange={(event) => set("city", event.target.value)} /></Field>
            <Field label="State"><Input value={form.state} onChange={(event) => set("state", event.target.value)} /></Field>
            <Field label="ZIP / postal code"><Input value={form.zipCode} onChange={(event) => set("zipCode", event.target.value)} /></Field>
            <Field label="Lifecycle stage"><Select value={form.lifecycleStage} onValueChange={(value) => set("lifecycleStage", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{LIFECYCLE_STAGES.map((stage) => <SelectItem key={stage.value} value={stage.value}>{stage.label}</SelectItem>)}</SelectContent></Select></Field>
            <Field label="Record status"><Select value={form.status} onValueChange={(value) => set("status", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["pending", "active", "inactive", "archived"].map((status) => <SelectItem key={status} value={status}>{status[0].toUpperCase() + status.slice(1)}</SelectItem>)}</SelectContent></Select></Field>
            <Field label="Source"><Select value={form.source} onValueChange={(value) => set("source", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{!CONTACT_SOURCES.includes(form.source) && <SelectItem value={form.source}>{form.source}</SelectItem>}{CONTACT_SOURCES.map((source) => <SelectItem key={source} value={source}>{source.replace(/_/g, " ")}</SelectItem>)}</SelectContent></Select></Field>
            <Field label="Assigned coach"><Select value={form.assignedCoachUserId} onValueChange={(value) => set("assignedCoachUserId", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="unassigned">Unassigned</SelectItem>{coaches.map((coach) => <SelectItem key={coach.user_id} value={coach.user_id}>{coach.name}</SelectItem>)}</SelectContent></Select></Field>
            <Field label="Primary offer"><Input value={form.primaryOffer} onChange={(event) => set("primaryOffer", event.target.value)} /></Field>
          </div>
        )}

        {step === 2 && (
          <div className="trc-contact-editor-fields">
            <Field label="Tags" className="trc-contact-editor-span-2"><Input value={form.tags} onChange={(event) => set("tags", event.target.value)} placeholder="Comma separated" /></Field>
            <Field label="Internal relationship notes" className="trc-contact-editor-span-2"><Textarea rows={3} value={form.notes} onChange={(event) => set("notes", event.target.value)} /></Field>
            <div className="trc-contact-editor-consent trc-contact-editor-span-2">
              <div><strong>Do not contact</strong><p>Suppresses outbound email and SMS for this record.</p></div>
              <Switch checked={form.doNotContact} onCheckedChange={(checked) => set("doNotContact", checked)} aria-label="Do not contact" />
            </div>
            <p className="trc-contact-editor-governed trc-contact-editor-span-2">Tenant, linked account, financial, consent, activity, and system-provenance fields remain governed by their owning workflows.</p>
          </div>
        )}

        {(offline || error) && <div className="trc-contact-editor-message" role="status">{error ?? "You are offline. This draft remains available; saving is unavailable."}</div>}

        {confirmClose && (
          <div className="trc-contact-editor-overlay" role="alertdialog" aria-modal="true" aria-labelledby="trc-contact-close-title">
            <div>
              <h2 id="trc-contact-close-title">Continue editing?</h2>
              <p>Your unsaved draft is still available.</p>
              <span>
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Discard and return</Button>
                <Button ref={(node) => { overlayRef.current = node; }} type="button" onClick={() => setConfirmClose(false)}>Resume draft</Button>
              </span>
            </div>
          </div>
        )}

        {saving && (
          <div className="trc-contact-editor-overlay" role="status">
            <div><h2 ref={(node) => { overlayRef.current = node; }} tabIndex={-1}>Saving contact…</h2><p>The tenant-safe mutation is in progress.</p></div>
          </div>
        )}

        {saved && (
          <div className="trc-contact-editor-overlay" role="status">
            <div>
              <h2 ref={(node) => { overlayRef.current = node; }} tabIndex={-1}>Contact saved</h2>
              <p>The exact tenant-owned record is selected on return.</p>
              <Button type="button" onClick={() => onOpenChange(false)}>Return to saved contact</Button>
            </div>
          </div>
        )}
      </section>

      {/* Outside the chapter panel, which is itself a live region: one announcement per change. */}
      <div className="sr-only" aria-live="polite">{announcement}</div>
      <footer className="trc-contact-editor-footer">
        <Button type="button" variant="outline" onClick={requestClose} disabled={saving}>Cancel</Button>
        <span>
          {step > 0 && <Button type="button" variant="outline" onClick={() => { setError(null); setStep((step - 1) as EditorStep); }} disabled={saving}>Back</Button>}
          <Button type="button" onClick={continueFlow} disabled={saving || offline}>{step < 2 ? "Continue" : error ? "Retry save" : editing ? "Save changes" : "Create contact"}</Button>
        </span>
      </footer>
    </div>
  );
}

function initialsOf(form: FormState) {
  const letters = form.recordType === "business" && form.entityName.trim()
    ? form.entityName.trim().split(/\s+/).slice(0, 2).map((word) => word[0])
    : [form.firstName.trim()[0], form.lastName.trim()[0]];
  return letters.filter(Boolean).join("").toUpperCase();
}

/** The identity plate (approved comp A): who this is, edited in place, and what Paige will recognise. */
function IdentityPlate({ form, set, dirty }: { form: FormState; set: <K extends keyof FormState>(key: K, value: FormState[K]) => void; dirty: boolean }) {
  const initials = initialsOf(form);
  const emails = methodsOfKind(form.contactMethods, "email").filter((method) => method.value.trim()).length;
  const phones = methodsOfKind(form.contactMethods, "phone").filter((method) => method.value.trim()).length;
  const total = emails + phones;
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const types = [["person", "Person"], ["business", "Business"]] as const;
  return (
    <div className="trc-plate">
      <div className={initials ? "trc-plate-tile" : "trc-plate-tile is-blank"} aria-hidden>{initials || "?"}</div>
      <div className="trc-plate-names">
        <label className="sr-only" htmlFor="trc-first-name">First name</label>
        <input id="trc-first-name" className="trc-plate-in" value={form.firstName} placeholder="First name" autoComplete="off" onChange={(event) => set("firstName", event.target.value)} />
        <label className="sr-only" htmlFor="trc-last-name">Last name</label>
        <input id="trc-last-name" className="trc-plate-in" value={form.lastName} placeholder="Last name" autoComplete="off" onChange={(event) => set("lastName", event.target.value)} />
        <label className="sr-only" htmlFor="trc-entity-name">{form.recordType === "business" ? "Business name" : "Business or company"}</label>
        <input id="trc-entity-name" className="trc-plate-in is-org" value={form.entityName} placeholder={form.recordType === "business" ? "Business name" : "Business (optional)"} autoComplete="off" onChange={(event) => set("entityName", event.target.value)} />
      </div>
      <div className="trc-plate-seg" role="radiogroup" aria-label="Record type">
        {types.map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={form.recordType === value}
            tabIndex={form.recordType === value ? 0 : -1}
            onClick={() => set("recordType", value)}
            onKeyDown={(event) => {
              if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
              event.preventDefault();
              const next = form.recordType === "person" ? "business" : "person";
              set("recordType", next);
              (event.currentTarget.parentElement?.querySelector(`[data-type="${next}"]`) as HTMLButtonElement | null)?.focus();
            }}
            data-type={value}
          >{label}</button>
        ))}
      </div>
      <hr className="trc-plate-rule" />
      <p className="trc-plate-stats" aria-live="off">
        {total ? <><b>{plural(emails, "email")} · {plural(phones, "phone")}</b><br /><span>{dirty ? `Paige will recognise ${total === 1 ? "it" : `all ${total}`} once saved` : `Paige recognises ${total === 1 ? "it" : `all ${total}`}`}</span></> : <span>No addresses yet</span>}
      </p>
    </div>
  );
}

function Field({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return <div className={className}><Label className="mb-1.5 block text-xs">{label}</Label>{children}</div>;
}
