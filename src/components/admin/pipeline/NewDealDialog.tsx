import { useEffect, useMemo, useState } from "react";
import { loadAssignableStaff, type AssignableStaff } from "@/lib/team/assignableStaff";
import { useTenantContext } from "@/hooks/useTenantContext";
import { CrmDealCommandReview } from "@/solo/deals/CrmDealCommandReview";
import { useSoloDealClients } from "@/solo/deals/useSoloDealClients";

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
import { Pipeline, PipelineStage, dollarsToCents } from "@/lib/pipelines";
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

export function NewDealDialog({ open, onOpenChange, pipeline, stages, defaultStageId, defaultContactId, onCreated }: Props) {
  const [title, setTitle] = useState("");
  const [stageId, setStageId] = useState<string>("");
  const [contactId, setContactId] = useState<string>("none");
  const { activeTenantId, accountContextLoading } = useTenantContext();
  const clientPicker = useSoloDealClients(activeTenantId, open);
  const contacts = clientPicker.clients.map(c => ({ id: c.id, label: c.name, email: c.primaryEmail }));
  const [unlinkedReason, setUnlinkedReason] = useState("");
  const [review, setReview] = useState<{tenantId: string; command: Record<string, unknown>} | null>(null);
  const [ownerId, setOwnerId] = useState("me");
  const [staff, setStaff] = useState<AssignableStaff[]>([]);
  const [staffLoading, setStaffLoading] = useState(false);
  const [value, setValue] = useState<string>("");
  const [closeDate, setCloseDate] = useState<string>("");
  const [offerType, setOfferType] = useState<string>("none");
  const [offerCustom, setOfferCustom] = useState("");

  const [contactSearch, setContactSearch] = useState("");
  const [contactPickerOpen, setContactPickerOpen] = useState(false);
  const [newContactOpen, setNewContactOpen] = useState(false);



  const { offers: tenantOffers } = useTenantOffers();

  useEffect(() => {
    setStaff([]); setOwnerId("me");
    if (!open || !activeTenantId || accountContextLoading) return;
    let cancelled = false;
    setStaffLoading(true);
    loadAssignableStaff().then(rows => { if (!cancelled) setStaff(rows); })
      .catch(() => { if (!cancelled) setStaff([]); })
      .finally(() => { if (!cancelled) setStaffLoading(false); });
    return () => { cancelled = true; };
  }, [open, activeTenantId, accountContextLoading]);

  const initialStageId = defaultStageId || stages[0]?.id || "";
  useEffect(() => {
    if (!open) return;
    setStageId(initialStageId);
    setTitle(""); setContactId(defaultContactId || "none");
    setValue(""); setCloseDate(""); setOfferType("none");
    setOfferCustom(""); setContactSearch(""); setUnlinkedReason(""); setReview(null);
    setContactPickerOpen(false); setNewContactOpen(false);
  }, [open, activeTenantId, defaultContactId, initialStageId]);

  const orderedStages = useMemo(() => [...stages].sort((a, b) => a.order_index - b.order_index), [stages]);
  const selectedContact = contacts.find((c) => c.id === contactId);

  const handleContactCreated = async (newId: string) => {
    clientPicker.retry();
    setContactId(newId);
    setContactPickerOpen(false);
  };

  const handleSave = () => {
    if (!activeTenantId || accountContextLoading || !pipeline || !stageId || !title.trim()) {
      toast.error("Choose a workspace, title and stage"); return;
    }
    if (!stages.some(stage => stage.id === stageId && stage.pipeline_id === pipeline.id)) {
      toast.error("Choose a stage from this pipeline"); return;
    }
    if (contactId === "none" && (defaultContactId || !unlinkedReason.trim())) {
      toast.error("Choose a client or explain why this opportunity is unlinked"); return;
    }
    if (value && (!/^\d+(?:\.\d{1,2})?$/.test(value) || !Number.isSafeInteger(dollarsToCents(value)))) {
      toast.error("Enter a non-negative amount with up to two decimal places"); return;
    }
    if (ownerId !== "me" && (staffLoading || !staff.some(member => member.user_id === ownerId))) {
      toast.error("Choose an available workspace member"); return;
    }
    setReview({tenantId: activeTenantId, command: {
      action: "deal.create", title: title.trim(), pipeline_id: pipeline.id, stage_id: stageId,
      ...(contactId === "none" ? {unlinked_reason: unlinkedReason.trim()} : {contact_id: contactId}),
      ...(ownerId === "me" ? {} : {owner_user_id: ownerId}),
      value_cents: dollarsToCents(value || "0"), currency: "USD",
      expected_close_date: closeDate || null,
      offer_type: offerType === "none" ? null : offerType === "other" ? (offerCustom.trim() || "other") : offerType,
    }});
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Deal</DialogTitle></DialogHeader>
          {review ? <CrmDealCommandReview tenantId={review.tenantId} command={review.command} onClose={() => setReview(null)} onComplete={() => { setReview(null); toast.success("Deal created"); onOpenChange(false); onCreated(); }} /> : <div className="space-y-3">
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
                          : selectedContact?.label || "Selected client (details loading)"}
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
                            disabled={!!defaultContactId}
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
                <Label htmlFor="deal-owner" className="text-xs">Owner</Label>
                <select id="deal-owner" className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={ownerId} onChange={e => setOwnerId(e.target.value)} disabled={staffLoading}>
                  <option value="me">Me</option>
                  {staff.map(member => <option key={member.user_id} value={member.user_id}>{member.name}</option>)}
                </select>
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
            {contactId === "none" && !defaultContactId && <div><Label htmlFor="deal-unlinked-reason">Reason for no linked client *</Label><select id="deal-unlinked-reason" className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={unlinkedReason} onChange={e => setUnlinkedReason(e.target.value)}>
                <option value="">Choose a reason</option>
                <option value="anonymous_prospect">Anonymous prospect</option>
                <option value="early_stage_prospect">Early-stage prospect</option>
                <option value="import_pending_identity">Imported record · identity pending</option>
              </select></div>}
            {clientPicker.phase === "error" && <p role="alert">Could not load clients. <Button type="button" variant="outline" onClick={clientPicker.retry}>Retry clients</Button></p>}
            {clientPicker.hasMore && <Button type="button" variant="outline" onClick={clientPicker.loadMore}>Load more clients</Button>}
          </div>}

          {!review && <DialogFooter>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={!activeTenantId || accountContextLoading || clientPicker.phase !== "ready"}>Review deal</Button>
          </DialogFooter>}
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
