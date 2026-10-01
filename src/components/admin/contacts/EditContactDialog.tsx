/* eslint-disable @typescript-eslint/no-explicit-any -- pre-existing legacy `any` debt in this
   dialog (untyped contact update path, #234 stale generated types). The §2 field strip (removing
   the Funding goal field + its patch write) introduced ZERO new `any`s. Retyping tracked (#234). */
import { useEffect, useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import { toast } from "sonner";
import { LIFECYCLE_STAGES, CONTACT_SOURCES, setContactPrimaryAddresses, updateContact, type ContactPatch } from "@/lib/contacts";
import { primaryAddressesOf, type ContactMethodRow } from "@/lib/contact-methods";
import { TagPicker } from "./TagPicker";

type Coach = { user_id: string; name: string };

type Contact = {
  id: string;
  /** The contact's workspace, for the address write; the caller's current workspace when absent. */
  tenant_id?: string | null;
  first_name: string;
  last_name: string;
  /** The contact's PRIMARY email and phone. Editing one sets that primary; other addresses stay. */
  email: string | null;
  phone: string | null;
  /** Every address the contact held when the page read it. A save names this list, so a change
   *  someone made since is refused rather than overwritten. Read at save time when absent. */
  client_contact_methods?: readonly ContactMethodRow[] | null;
  entity_name: string | null;
  title: string | null;
  funding_goal: number | null;
  lifecycle_stage: string | null;
  source: string | null;
  tags: string[] | null;
  do_not_contact: boolean | null;
  current_notes?: string | null;
  assigned_coach_user_id: string | null;
};

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  contact: Contact | null;
  coaches: Coach[];
  knownTags?: string[];
  onSaved: (updated: Contact) => void;
};

export function EditContactDialog({
  open, onOpenChange, contact, coaches, knownTags, onSaved,
}: Props) {
  const [form, setForm] = useState<Contact | null>(contact);
  const [saving, setSaving] = useState(false);

  useEffect(() => { setForm(contact); }, [contact]);

  if (!form) return null;
  const set = <K extends keyof Contact>(k: K, v: Contact[K]) =>
    setForm((p) => (p ? { ...p, [k]: v } : p));

  const save = async () => {
    if (!form.first_name?.trim()) { toast.error("First name is required"); return; }
    setSaving(true);
    try {
      // Addresses first: they are the write most likely to be refused (an address another contact
      // in the workspace already holds), and a refusal then leaves the rest of the record as it was.
      const nextEmail = form.email?.trim() || null;
      const nextPhone = form.phone?.trim() || null;
      const addresses: { email?: string | null; phone?: string | null } = {};
      if (nextEmail !== (contact?.email?.trim() || null)) addresses.email = nextEmail;
      if (nextPhone !== (contact?.phone?.trim() || null)) addresses.phone = nextPhone;
      const methods = Object.keys(addresses).length
        ? await setContactPrimaryAddresses(form.id, addresses, { tenantId: form.tenant_id ?? null, loaded: contact?.client_contact_methods })
        : contact?.client_contact_methods;

      const patch: ContactPatch = {
        first_name: form.first_name.trim(),
        last_name: form.last_name?.trim() || "",
        entity_name: form.entity_name?.trim() || null,
        title: form.title?.trim() || null,
        lifecycle_stage: form.lifecycle_stage || "new_lead",
        source: form.source || null,
        tags: form.tags || [],
        do_not_contact: !!form.do_not_contact,
        current_notes: form.current_notes?.trim() || null,
        assigned_coach_user_id: form.assigned_coach_user_id,
      };
      const updated = await updateContact(form.id, patch);
      toast.success("Contact saved");
      // The primaries as stored: clearing a primary promotes the next address, which the field
      // alone cannot know.
      const primaries = methods ? primaryAddressesOf(methods) : { email: nextEmail, phone: nextPhone };
      onSaved({ ...form, ...(updated as any), ...primaries, client_contact_methods: methods });
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit contact</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>First name</Label>
              <Input value={form.first_name || ""} onChange={(e) => set("first_name", e.target.value)} />
            </div>
            <div>
              <Label>Last name</Label>
              <Input value={form.last_name || ""} onChange={(e) => set("last_name", e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Email</Label>
              <Input type="email" value={form.email || ""} onChange={(e) => set("email", e.target.value)} />
            </div>
            <div>
              <Label>Phone</Label>
              <Input value={form.phone || ""} onChange={(e) => set("phone", e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Business / Entity</Label>
              <Input value={form.entity_name || ""} onChange={(e) => set("entity_name", e.target.value)} />
            </div>
            <div>
              <Label>Title</Label>
              <Input value={form.title || ""} onChange={(e) => set("title", e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Lifecycle stage</Label>
              <Select value={form.lifecycle_stage || "new_lead"} onValueChange={(v) => set("lifecycle_stage", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {LIFECYCLE_STAGES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Source</Label>
              <Select value={form.source || "manual"} onValueChange={(v) => set("source", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CONTACT_SOURCES.map((s) => (
                    <SelectItem key={s} value={s} className="capitalize">{s.replace(/_/g, " ")}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label>Assigned coach</Label>
            <Select
              value={form.assigned_coach_user_id || "unassigned"}
              onValueChange={(v) => set("assigned_coach_user_id", v === "unassigned" ? null : v)}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="unassigned">Unassigned</SelectItem>
                {coaches.map((c) => (
                  <SelectItem key={c.user_id} value={c.user_id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Tags</Label>
            <TagPicker
              value={form.tags || []}
              onChange={(t) => set("tags", t)}
              knownTags={knownTags}
            />
          </div>

          <div>
            <Label>Internal notes</Label>
            <Textarea
              rows={3}
              value={form.current_notes || ""}
              onChange={(e) => set("current_notes", e.target.value)}
              placeholder="Visible to coaches and admins, not to the client."
            />
          </div>

          <div className="flex items-center justify-between rounded border border-border p-3">
            <div>
              <div className="font-medium text-sm">Do Not Contact</div>
              <div className="text-xs text-muted-foreground">Suppresses all outbound email + SMS.</div>
            </div>
            <Switch
              checked={!!form.do_not_contact}
              onCheckedChange={(v) => set("do_not_contact", v)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save changes"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
