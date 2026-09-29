import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { loadAssignableStaff } from "@/lib/team/assignableStaff";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { LIFECYCLE_STAGES, CONTACT_SOURCES, contactIdsWithAddress } from "@/lib/contacts";
import { useTenantOffers } from "@/hooks/useTenantOffers";

type Coach = { user_id: string; name: string };

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: (newId: string) => void;
};

export function NewContactDialog({ open, onOpenChange, onCreated }: Props) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [entityName, setEntityName] = useState("");
  const [title, setTitle] = useState("");
  const [lifecycleStage, setLifecycleStage] = useState("new_lead");
  const [source, setSource] = useState<string>("manual");
  const [coachId, setCoachId] = useState<string>("unassigned");
  const [primaryOffer, setPrimaryOffer] = useState<string>("none");
  const [offerCustom, setOfferCustom] = useState("");
  const [tagsRaw, setTagsRaw] = useState("");
  const [notes, setNotes] = useState("");
  const [coaches, setCoaches] = useState<Coach[]>([]);
  const [saving, setSaving] = useState(false);
  const { offers: tenantOffers } = useTenantOffers();

  useEffect(() => {
    if (!open) return;
    setFirstName(""); setLastName(""); setEmail(""); setPhone("");
    setEntityName(""); setTitle(""); setLifecycleStage("new_lead");
    setSource("manual"); setCoachId("unassigned");
    setPrimaryOffer("none"); setOfferCustom("");
    setTagsRaw(""); setNotes("");
    (async () => {
      setCoaches(await loadAssignableStaff());
    })();
  }, [open]);

  const handleSave = async () => {
    const fn = firstName.trim();
    const ln = lastName.trim();
    const em = email.trim();
    if (!fn && !ln && !em) {
      toast.error("Add at least a name or email");
      return;
    }
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user?.id) {
      setSaving(false);
      toast.error("You must be signed in to create a contact");
      return;
    }
    const tags = tagsRaw.split(",").map((t) => t.trim()).filter(Boolean);
    // first_name / last_name are NOT NULL — derive sensible fallbacks from email when missing.
    const emailLocal = em ? em.split("@")[0] : "";
    const safeFirst = fn || emailLocal || "New";
    const safeLast  = ln || (em ? "Contact" : "Contact");
    const offerValue =
      primaryOffer === "none" ? null :
      primaryOffer === "other" ? (offerCustom.trim() || "other") :
      primaryOffer;

    // Server-owned contract: tenant, UUID, public reference, and tenant-scoped idempotency.
    const { data, error } = await supabase.rpc("create_contact", {
      p_first_name: safeFirst, p_last_name: safeLast, p_email: em || null,
      p_phone: phone.trim() || null, p_entity_name: entityName.trim() || null,
      p_title: title.trim() || null, p_lifecycle_stage: lifecycleStage, p_source: source,
      p_tags: tags, p_primary_offer: offerValue, p_notes: notes.trim() || null,
      p_assigned_coach_user_id: coachId === "unassigned" ? null : coachId, p_channel: "manual",
    } as never);
    setSaving(false);
    if (error) {
      console.error("[NewContactDialog] insert failed", error);
      // 23505 = unique_violation. Race with the pre-check above, or constraint on another column.
      if ((error as { code?: string }).code === "23505" || /duplicate key/i.test(error.message || "")) {
        if (em) {
          // The contact already holding this address — any of its addresses, matched as the
          // database matches them — among the ones this user created.
          const holders = await contactIdsWithAddress("email", em).catch((cause: unknown) => {
            console.warn("[NewContactDialog] looking up the contact holding this email failed", cause);
            return [] as string[];
          });
          const { data: existing } = holders.length
            ? await supabase
              .from("clients")
              .select("id")
              .eq("created_by", user.id)
              .in("id", holders)
              .maybeSingle()
            : { data: null };
          if (existing) {
            toast.message("Contact already exists — opening it");
            onOpenChange(false);
            onCreated(existing.id);
            return;
          }
        }
        toast.error("A contact with this email already exists in your account.");
        return;
      }
      toast.error(error.message || "Could not create contact");
      return;
    }
    toast.success("Contact created");
    onOpenChange(false);
    if (data) onCreated(data);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>New Contact</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">First name</Label>
              <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Last name</Label>
              <Input value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Email</Label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Phone</Label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Business / Entity</Label>
              <Input value={entityName} onChange={(e) => setEntityName(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Title</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Founder, CFO…" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label className="text-xs">Lifecycle stage</Label>
              <Select value={lifecycleStage} onValueChange={setLifecycleStage}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {LIFECYCLE_STAGES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Source</Label>
              <Select value={source} onValueChange={setSource}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CONTACT_SOURCES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Coach</Label>
              <Select value={coachId} onValueChange={setCoachId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="unassigned">Unassigned</SelectItem>
                  {coaches.map((c) => <SelectItem key={c.user_id} value={c.user_id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Primary offer / product</Label>
              <Select value={primaryOffer} onValueChange={setPrimaryOffer}>
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
            {primaryOffer === "other" && (
              <div>
                <Label className="text-xs">Custom offer name</Label>
                <Input value={offerCustom} onChange={(e) => setOfferCustom(e.target.value)} placeholder="Name this offer" />
              </div>
            )}
          </div>
          <div>
            <Label className="text-xs">Tags (comma separated)</Label>
            <Input value={tagsRaw} onChange={(e) => setTagsRaw(e.target.value)} placeholder="vip, funding-ready, mma" />
          </div>

          <div>
            <Label className="text-xs">Notes</Label>
            <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? "Saving…" : "Create contact"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
