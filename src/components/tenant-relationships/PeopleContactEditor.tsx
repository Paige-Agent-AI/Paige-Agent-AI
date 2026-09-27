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
import type { RelationshipPerson } from "./useTenantRelationshipsData";
import { upsertRelationshipContact, type ContactUpsertPatch } from "./contactUpsert";
import { toAssignableStaff } from "@/lib/team/assignableStaff";

type Coach = { user_id: string; name: string };
type EditorStep = 0 | 1 | 2;

type FormState = {
  recordType: "person" | "business";
  firstName: string;
  lastName: string;
  entityName: string;
  title: string;
  email: string;
  phone: string;
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
  email: "",
  phone: "",
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
  email: contact.email ?? "",
  phone: contact.phone ?? "",
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
    setSaving(false);
    let current = true;
    void (async () => {
      // Generated Supabase types do not yet include this established roster RPC.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase as any).rpc("get_tenant_assignable_members");
      // One home for "who may own a contact": the shared roster filter, not a second copy of it.
      if (current) setCoaches(toAssignableStaff(data));
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

  const validateIdentity = () => {
    const hasIdentity = Boolean(form.firstName.trim() || form.lastName.trim() || form.entityName.trim() || form.email.trim());
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
      email: optional(form.email),
      phone: optional(form.phone),
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
      setError(message);
      toast.error(message);
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
            <p>{step === 0 ? "Identify the tenant-owned contact." : step === 1 ? "Add business and lifecycle context." : "Review notes, tags, and communication controls."}</p>
          </div>
          <span>Draft retained locally</span>
        </header>

        {step === 0 && (
          <div className="trc-contact-editor-fields">
            <Field label="Record type"><Select value={form.recordType} onValueChange={(value) => set("recordType", value as FormState["recordType"])}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="person">Person</SelectItem><SelectItem value="business">Business</SelectItem></SelectContent></Select></Field>
            <Field label="First name"><Input value={form.firstName} onChange={(event) => set("firstName", event.target.value)} /></Field>
            <Field label="Last name"><Input value={form.lastName} onChange={(event) => set("lastName", event.target.value)} /></Field>
            <Field label="Business / company"><Input value={form.entityName} onChange={(event) => set("entityName", event.target.value)} /></Field>
            <Field label="Email" className="trc-contact-editor-span-2"><Input type="email" value={form.email} onChange={(event) => set("email", event.target.value)} /></Field>
            <Field label="Phone" className="trc-contact-editor-span-2"><Input value={form.phone} onChange={(event) => set("phone", event.target.value)} /></Field>
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

function Field({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return <div className={className}><Label className="mb-1.5 block text-xs">{label}</Label>{children}</div>;
}
