import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { loadAssignableStaff } from "@/lib/team/assignableStaff";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Check, ChevronsUpDown, UserPlus } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Pipeline, PipelineStage, dollarsToCents, logDealActivity } from "@/lib/pipelines";
import { useTenantOffers } from "@/hooks/useTenantOffers";
import { NewContactDialog } from "@/components/admin/contacts/NewContactDialog";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  pipeline: Pipeline | null;
  stages: PipelineStage[];
  defaultStageId?: string | null;
  defaultContactId?: string | null;
  onCreated: () => void;
};

type ContactOption = { id: string; label: string; email?: string | null };
type CoachOption = { user_id: string; name: string };

export function NewDealDialog({ open, onOpenChange, pipeline, stages, defaultStageId, defaultContactId, onCreated }: Props) {
  const [title, setTitle] = useState("");
  const [stageId, setStageId] = useState<string>("");
  const [contactId, setContactId] = useState<string>("none");
  const [ownerId, setOwnerId] = useState<string>("me");
  const [value, setValue] = useState<string>("");
  const [closeDate, setCloseDate] = useState<string>("");
  const [offerType, setOfferType] = useState<string>("none");
  const [offerCustom, setOfferCustom] = useState("");
  const [contacts, setContacts] = useState<ContactOption[]>([]);
  const [contactSearch, setContactSearch] = useState("");
  const [contactPickerOpen, setContactPickerOpen] = useState(false);
  const [newContactOpen, setNewContactOpen] = useState(false);
  const [coaches, setCoaches] = useState<CoachOption[]>([]);
  const [saving, setSaving] = useState(false);
  const [meId, setMeId] = useState<string | null>(null);
  const { offers: tenantOffers } = useTenantOffers();

  const loadContacts = async () => {
    const { data: cs } = await supabase
      .from("clients")
      .select("id, first_name, last_name, entity_name, email")
      .order("created_at", { ascending: false })
      .limit(500);
    setContacts((cs || []).map((c) => ({
      id: c.id,
      label: `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() + (c.entity_name ? ` · ${c.entity_name}` : ""),
      email: c.email,
    })));
  };

  useEffect(() => {
    if (!open) return;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setMeId(user?.id ?? null);
      await loadContacts();
      setCoaches(await loadAssignableStaff());
      setStageId(defaultStageId || stages[0]?.id || "");
      setTitle("");
      setContactId(defaultContactId || "none");
      setOwnerId("me");
      setValue("");
      setCloseDate("");
      setOfferType("none");
      setOfferCustom("");
      setContactSearch("");
    })();
  }, [open, defaultStageId, stages, defaultContactId]);

  const orderedStages = useMemo(() => [...stages].sort((a, b) => a.order_index - b.order_index), [stages]);
  const selectedContact = contacts.find((c) => c.id === contactId);

  const handleContactCreated = async (newId: string) => {
    await loadContacts();
    setContactId(newId);
    setContactPickerOpen(false);
  };

  const handleSave = async () => {
    if (!pipeline || !stageId || !title.trim()) {
      toast.error("Title and stage are required");
      return;
    }
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    const resolvedOwner = ownerId === "me" ? user?.id : ownerId === "none" ? null : ownerId;
    const resolvedOffer =
      offerType === "none" ? null :
      offerType === "other" ? (offerCustom.trim() || "other") :
      offerType;
    const { data, error } = await supabase
      .from("deals")
      .insert({
        title: title.trim(),
        pipeline_id: pipeline.id,
        stage_id: stageId,
        contact_client_id: contactId === "none" ? null : contactId,
        owner_user_id: resolvedOwner ?? null,
        value_cents: dollarsToCents(value || "0"),
        expected_close_date: closeDate || null,
        offer_type: resolvedOffer,
        created_by: user?.id ?? null,
      })
      .select()
      .single();
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    if (data) await logDealActivity(data.id, "deal_created", `Deal created in ${pipeline.name}`);
    toast.success("Deal created");
    onOpenChange(false);
    onCreated();
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Deal</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Title *</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Acme SBA Loan" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Stage</Label>
                <Select value={stageId} onValueChange={setStageId}>
                  <SelectTrigger><SelectValue placeholder="Pick stage" /></SelectTrigger>
                  <SelectContent>
                    {orderedStages.map((s) => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Value ($)</Label>
                <Input type="number" min="0" value={value} onChange={(e) => setValue(e.target.value)} placeholder="50000" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Contact</Label>
                <Popover open={contactPickerOpen} onOpenChange={setContactPickerOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      role="combobox"
                      className="w-full justify-between font-normal"
                    >
                      <span className="truncate">
                        {contactId === "none"
                          ? "— None —"
                          : selectedContact?.label || "Unnamed contact"}
                      </span>
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                    <Command>
                      <CommandInput
                        placeholder="Search contacts by name, business, email…"
                        value={contactSearch}
                        onValueChange={setContactSearch}
                      />
                      <CommandList>
                        <CommandEmpty>
                          <div className="p-2 text-center text-sm text-muted-foreground">
                            No contacts found.
                          </div>
                        </CommandEmpty>
                        <CommandGroup>
                          <CommandItem
                            value="__create_new__"
                            onSelect={() => {
                              setContactPickerOpen(false);
                              setNewContactOpen(true);
                            }}
                            className="text-primary font-medium"
                          >
                            <UserPlus className="mr-2 h-4 w-4" />
                            Create new contact{contactSearch ? `: "${contactSearch}"` : ""}
                          </CommandItem>
                          <CommandItem
                            value="none"
                            onSelect={() => {
                              setContactId("none");
                              setContactPickerOpen(false);
                            }}
                          >
                            <Check className={cn("mr-2 h-4 w-4", contactId === "none" ? "opacity-100" : "opacity-0")} />
                            — None —
                          </CommandItem>
                          {contacts.map((c) => (
                            <CommandItem
                              key={c.id}
                              value={`${c.label} ${c.email ?? ""} ${c.id}`}
                              onSelect={() => {
                                setContactId(c.id);
                                setContactPickerOpen(false);
                              }}
                            >
                              <Check className={cn("mr-2 h-4 w-4", contactId === c.id ? "opacity-100" : "opacity-0")} />
                              <div className="flex flex-col">
                                <span>{c.label || "Unnamed"}</span>
                                {c.email && <span className="text-xs text-muted-foreground">{c.email}</span>}
                              </div>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>
              <div>
                <Label className="text-xs">Owner</Label>
                <Select value={ownerId} onValueChange={setOwnerId}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="me">Me</SelectItem>
                    <SelectItem value="none">Unassigned</SelectItem>
                    {coaches.filter((c) => c.user_id !== meId).map((c) => (
                      <SelectItem key={c.user_id} value={c.user_id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Offer / product</Label>
                <Select value={offerType} onValueChange={setOfferType}>
                  <SelectTrigger><SelectValue placeholder="Select offer" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— None —</SelectItem>
                    {tenantOffers.length === 0 && (
                      <SelectItem value="__no_offers__" disabled>
                        No products yet — add them in Settings → Storefront
                      </SelectItem>
                    )}
                    {tenantOffers.map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                    <SelectItem value="other">Other (custom)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Expected close date</Label>
                <Input type="date" value={closeDate} onChange={(e) => setCloseDate(e.target.value)} />
              </div>
            </div>
            {offerType === "other" && (
              <div>
                <Label className="text-xs">Custom offer name</Label>
                <Input value={offerCustom} onChange={(e) => setOfferCustom(e.target.value)} placeholder="Name this offer" />
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? "Saving…" : "Create deal"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <NewContactDialog
        open={newContactOpen}
        onOpenChange={setNewContactOpen}
        onCreated={handleContactCreated}
      />
    </>
  );
}
