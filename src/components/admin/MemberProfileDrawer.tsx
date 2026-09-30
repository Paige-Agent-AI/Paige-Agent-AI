import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Crown, ShieldCheck, ShieldOff, Mail, Calendar, Clock, Users, FileText, Pencil, Save, X, KeyRound, LogOut, Send, RefreshCcw, GraduationCap } from "lucide-react";
import { toast } from "sonner";
import { callAdminAccountAction } from "@/lib/functions/adminAccountActions";
import { AvatarUploader, isAvatarBucketUrl, removeAvatarObject } from "@/components/ui/avatar-uploader";
import { useTenantFeature } from "@/hooks/useTenantFeature";
import { cn } from "@/lib/utils";
import { readUserContactMethods, saveUserPrimaryAddresses } from "@/lib/userPrimaryContact";
import { primaryValue, type ContactMethod } from "@/lib/contact-methods";
import { userContactMethodsRefusal } from "@/components/contact-methods/useUserContactMethods";

// Coaching-generic specialties every tenant can assign (§2/§9).
const BASE_SPECIALTY_OPTIONS = [{ value: "entity", label: "Entity Setup" }];
// Credit/funding specialties — shown ONLY when the tenant opted into the funding
// vertical; never a default for generic coaching/consulting tenants (§2).
const FUNDING_SPECIALTY_OPTIONS = [
  { value: "personal_credit", label: "Personal Credit" },
  { value: "business_credit", label: "Business Credit" },
  { value: "funding", label: "Funding Strategy" },
  { value: "btf", label: "Build-to-Fund" },
  { value: "underwriting", label: "Underwriting" },
];

/** Coach-management fields, resolved by the parent via get_tenant_coach_fields
 *  (the own-record-or-tenant-admin definer read RPC — cross-user profile SELECT is
 *  own-row only, so these cannot be read client-side for another member). */
export interface CoachFields {
  specialties: string[];
  capacity: number | null;
  accepting: boolean;
  timezone: string | null;
  bio?: string | null;
}

export interface MemberProfile {
  user_id: string;
  email: string | null;
  full_name: string | null;
  created_at: string;
  last_sign_in_at: string | null;
  suspended_at: string | null;
  suspended_reason: string | null;
  roles: string[];
  // #227 G1: per-tenant owner (tenant_members.is_owner for the active tenant). Drives the
  // Owner crown/badge here (cosmetic only — no role edit happens in this drawer).
  tenant_is_owner: boolean;
}

interface Props {
  member: MemberProfile | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialEdit?: boolean;
  onSaved?: () => void;
  /** Coach-management fields for this member (parent-resolved via the gated RPC).
   *  When the parent resolves them, a "Coaching" section renders and saves
   *  through set_coach_fields (own-record-or-tenant-admin), NOT the broad upsert. */
  coachFields?: CoachFields | null;
  onCoachSaved?: () => void;
}

/** `phone` / `work_email` are the member's PRIMARY phone and email contact methods
 *  (`user_contact_methods`), read and saved apart from the profile row. */
interface ProfileFields {
  full_name: string;
  first_name: string;
  middle_initial: string;
  last_name: string;
  phone: string;
  work_email: string;
  business_name: string;
  website_url: string;
  address: string;
  city: string;
  state: string;
  postal_code: string;
  coach_bio: string;
  staff_notes: string;
  avatar_url: string;
}

const EMPTY: ProfileFields = {
  full_name: "", first_name: "", middle_initial: "", last_name: "",
  phone: "", work_email: "", business_name: "", website_url: "",
  address: "", city: "", state: "", postal_code: "", coach_bio: "", staff_notes: "", avatar_url: "",
};

const fmt = (d?: string | null) => (d ? new Date(d).toLocaleString() : "—");

export function MemberProfileDrawer({ member, open, onOpenChange, initialEdit = false, onSaved, coachFields, onCoachSaved }: Props) {
  const [fields, setFields] = useState<ProfileFields>(EMPTY);
  const [original, setOriginal] = useState<ProfileFields>(EMPTY);
  const [extras, setExtras] = useState<{ assignedClientsCount?: number; invitesSentCount?: number; tenantNames?: string[] }>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(initialEdit);
  const [actionPending, setActionPending] = useState<string | null>(null);
  const [confirmWipe, setConfirmWipe] = useState(false);
  const [confirmSignout, setConfirmSignout] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  // The member's emails and phones as read when the drawer opened: a save names this list as the one
  // it replaces. Null when the read failed — their email and phone are then unknown, not blank.
  const [contactMethods, setContactMethods] = useState<ContactMethod[] | null>(null);
  const [contactLoadFailed, setContactLoadFailed] = useState(false);

  // --- Coaching section (coach-only) — saved via the gated set_coach_fields RPC ---
  const { enabled: fundingEnabled } = useTenantFeature("funding_readiness");
  const specialtyOptions = fundingEnabled
    ? [...BASE_SPECIALTY_OPTIONS, ...FUNDING_SPECIALTY_OPTIONS]
    : BASE_SPECIALTY_OPTIONS;
  const [coachEditing, setCoachEditing] = useState(false);
  const [coachSaving, setCoachSaving] = useState(false);
  const [cSpecs, setCSpecs] = useState<string[]>([]);
  const [cCapacity, setCCapacity] = useState<string>("");
  const [cAccepting, setCAccepting] = useState(true);
  const [cTimezone, setCTimezone] = useState("");

  // Seed the coaching editor whenever the parent resolves the gated fields.
  useEffect(() => {
    setCSpecs(coachFields?.specialties ?? []);
    setCCapacity(coachFields?.capacity != null ? String(coachFields.capacity) : "");
    setCAccepting(coachFields?.accepting ?? true);
    setCTimezone(coachFields?.timezone ?? "");
    setCoachEditing(false);
  }, [coachFields, member?.user_id]);

  useEffect(() => { setEditing(initialEdit); }, [initialEdit, member?.user_id]);
  // A person may only upload to their OWN avatar folder (storage RLS), so the
  // photo control appears only when this drawer is the signed-in user's own.
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setCurrentUserId(data.user?.id ?? null));
  }, []);

  useEffect(() => {
    if (!open || !member) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [{ data: prof }, clientsRes, invitesRes, tenantRes, contact] = await Promise.all([
          supabase.from("profiles")
            .select("full_name, first_name, middle_initial, last_name, business_name, website_url, address, city, state, postal_code, coach_bio, staff_notes, avatar_url")
            .eq("user_id", member.user_id).maybeSingle(),
          supabase.from("clients").select("id", { count: "exact", head: true }).eq("assigned_coach_user_id", member.user_id),
          supabase.from("invitations").select("id", { count: "exact", head: true }).eq("invited_by", member.user_id),
          supabase.from("tenant_members").select("tenants(name)").eq("user_id", member.user_id),
          readUserContactMethods(member.user_id),
        ]);
        if (cancelled) return;
        setContactMethods(contact.error ? null : contact.methods);
        setContactLoadFailed(Boolean(contact.error));
        const p = (prof ?? {}) as Partial<Record<keyof ProfileFields, string | null>>;
        const next: ProfileFields = {
          full_name: p.full_name ?? member.full_name ?? "",
          first_name: p.first_name ?? "",
          middle_initial: p.middle_initial ?? "",
          last_name: p.last_name ?? "",
          phone: primaryValue(contact.methods, "phone") ?? "",
          work_email: primaryValue(contact.methods, "email") ?? "",
          business_name: p.business_name ?? "",
          website_url: p.website_url ?? "",
          address: p.address ?? "",
          city: p.city ?? "",
          state: p.state ?? "",
          postal_code: p.postal_code ?? "",
          coach_bio: p.coach_bio ?? "",
          staff_notes: p.staff_notes ?? "",
          avatar_url: p.avatar_url ?? "",
        };
        setFields(next);
        setOriginal(next);
        const tenantRows = (tenantRes.data ?? []) as { tenants: { name: string | null } | null }[];
        setExtras({
          assignedClientsCount: clientsRes.count ?? 0,
          invitesSentCount: invitesRes.count ?? 0,
          tenantNames: tenantRows.map((r) => r.tenants?.name).filter((n): n is string => !!n),
        });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, member]);

  if (!member) return null;
  const isSelf = !!currentUserId && member.user_id === currentUserId;
  const initials = (fields.full_name || member.email || "?")
    .split(/\s+/).map(s => s[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();

  const set = <K extends keyof ProfileFields>(k: K, v: ProfileFields[K]) => setFields(f => ({ ...f, [k]: v }));

  const handleSave = async () => {
    setSaving(true);
    try {
      const { phone, work_email, ...profileFields } = fields;
      // Phone and work email are the member's primary contact methods: only the one that changed
      // is written, every other address they keep stays as it is, and the save names the list read
      // when the drawer opened — so a change made elsewhere since is refused, not overwritten.
      const contactChanges: { phone?: string; email?: string } = {};
      if (phone.trim() !== original.phone.trim()) contactChanges.phone = phone;
      if (work_email.trim() !== original.work_email.trim()) contactChanges.email = work_email;
      let storedContact: { phone: string; work_email: string } | null = null;
      if (Object.keys(contactChanges).length > 0) {
        if (!contactMethods) throw new Error("Their email and phone couldn't be loaded, so nothing was saved. Close this and open it again.");
        const saved = await saveUserPrimaryAddresses(member.user_id, contactChanges, contactMethods);
        if (saved.ok === false) throw new Error(userContactMethodsRefusal(saved.error));
        setContactMethods(saved.methods);
        storedContact = { phone: primaryValue(saved.methods, "phone") ?? "", work_email: primaryValue(saved.methods, "email") ?? "" };
      }
      const payload = { user_id: member.user_id, ...profileFields, updated_at: new Date().toISOString() };
      const { error } = await supabase.from("profiles").upsert(payload, { onConflict: "user_id" });
      if (error) throw error;
      // Now that the new photo is persisted, tidy the replaced file (never
      // before save — a cancel must leave the live photo intact).
      if (original.avatar_url && original.avatar_url !== fields.avatar_url && isAvatarBucketUrl(original.avatar_url)) {
        void removeAvatarObject(original.avatar_url);
      }
      toast.success("Profile saved");
      // Show the email and phone the server stored as primary, not what was typed.
      const savedFields = storedContact ? { ...fields, ...storedContact } : fields;
      setFields(savedFields);
      setOriginal(savedFields);
      setEditing(false);
      onSaved?.();
    } catch (e) {
      toast.error("Failed to save profile", { description: e instanceof Error ? e.message : undefined });
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => { setFields(original); setEditing(false); };

  const toggleSpecialty = (val: string) =>
    setCSpecs((cur) => (cur.includes(val) ? cur.filter((s) => s !== val) : [...cur, val]));

  const handleCoachSave = async () => {
    if (!member) return;
    setCoachSaving(true);
    try {
      const cap = cCapacity.trim() === "" ? null : Number(cCapacity);
      if (cap != null && (!Number.isFinite(cap) || cap < 0)) {
        toast.error("Capacity must be a non-negative number");
        setCoachSaving(false);
        return;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- new RPC not yet in generated types (#234)
      const { error } = await supabase.rpc("set_coach_fields" as any, {
        _user_id: member.user_id,
        _specialties: cSpecs,
        _capacity: cap,
        _accepting: cAccepting,
        _timezone: cTimezone || null,
      });
      if (error) throw error;
      toast.success("Coaching profile saved");
      setCoachEditing(false);
      onCoachSaved?.();
    } catch (e) {
      toast.error("Failed to save coaching profile", { description: e instanceof Error ? e.message : undefined });
    } finally {
      setCoachSaving(false);
    }
  };

  const runAction = async (action: "password_reset" | "signout_all" | "resend_invite" | "wipe_onboarding", successMsg: string) => {
    if (!member) return;
    setActionPending(action);
    try {
      const data = await callAdminAccountAction(action, member.user_id) as { error?: string } | null;
      if (data?.error) throw new Error(data.error);
      toast.success(successMsg);
    } catch (e) {
      toast.error("Action failed", { description: e instanceof Error ? e.message : undefined });
    } finally {
      setActionPending(null);
      setConfirmWipe(false);
      setConfirmSignout(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full border border-border bg-muted flex items-center justify-center text-base font-semibold text-muted-foreground overflow-hidden">
              {isAvatarBucketUrl(fields.avatar_url)
                ? <img src={fields.avatar_url} alt="" className="w-full h-full object-cover" />
                : initials}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                {member.tenant_is_owner && <Crown className="w-4 h-4 text-gold-dark" />}
                <span className="truncate">{fields.full_name || member.email || "Unnamed"}</span>
              </div>
              <SheetDescription className="text-xs truncate">{member.email}</SheetDescription>
            </div>
            {!editing ? (
              <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                <Pencil className="w-3.5 h-3.5 mr-1.5" /> Edit
              </Button>
            ) : (
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" onClick={handleCancel} disabled={saving}>
                  <X className="w-4 h-4" />
                </Button>
                <Button size="sm" onClick={handleSave} disabled={saving}>
                  <Save className="w-3.5 h-3.5 mr-1.5" /> {saving ? "Saving…" : "Save"}
                </Button>
              </div>
            )}
          </SheetTitle>
        </SheetHeader>

        <div className="space-y-5 mt-6 text-sm">
          <div>
            {member.suspended_at ? (
              <Badge variant="destructive" className="gap-1"><ShieldOff className="w-3 h-3" /> Suspended</Badge>
            ) : (
              <Badge variant="secondary" className="gap-1"><ShieldCheck className="w-3 h-3" /> Active</Badge>
            )}
          </div>

          <Separator />

          <div>
            <div className="text-xs uppercase text-muted-foreground mb-2">Roles</div>
            <div className="flex flex-wrap gap-1">
              {member.tenant_is_owner && <Badge>Owner</Badge>}
              {member.roles.map(r => (
                <Badge key={r} variant="outline" className="capitalize">{r.replace("_", " ")}</Badge>
              ))}
            </div>
          </div>

          {coachFields && (
            <>
              <Separator />
              {/* Coaching — capacity/specialties/availability. Saved via the gated
                  set_coach_fields RPC (own-record-or-tenant-admin), NOT the broad
                  profile upsert, so a tenant admin can manage a coach's coaching
                  attributes without widening cross-user profile writes (§9). */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs uppercase text-muted-foreground">
                    <GraduationCap className="h-3.5 w-3.5" /> Coaching
                  </div>
                  {!coachEditing ? (
                    <Button size="sm" variant="outline" onClick={() => setCoachEditing(true)}>
                      <Pencil className="w-3.5 h-3.5 mr-1.5" /> Edit
                    </Button>
                  ) : (
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setCoachEditing(false)} disabled={coachSaving}>
                        <X className="w-4 h-4" />
                      </Button>
                      <Button size="sm" onClick={handleCoachSave} disabled={coachSaving}>
                        <Save className="w-3.5 h-3.5 mr-1.5" /> {coachSaving ? "Saving…" : "Save"}
                      </Button>
                    </div>
                  )}
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">Specialties</Label>
                  {coachEditing ? (
                    <div className="flex flex-wrap gap-1.5">
                      {specialtyOptions.map((o) => {
                        const on = cSpecs.includes(o.value);
                        return (
                          <button
                            key={o.value}
                            type="button"
                            onClick={() => toggleSpecialty(o.value)}
                            className={cn(
                              "rounded-full border px-2.5 py-1 text-xs transition-colors",
                              on ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:bg-muted",
                            )}
                          >
                            {o.label}
                          </button>
                        );
                      })}
                    </div>
                  ) : cSpecs.length ? (
                    <div className="flex flex-wrap gap-1">
                      {cSpecs.map((s) => (
                        <Badge key={s} variant="outline" className="capitalize">
                          {specialtyOptions.find((o) => o.value === s)?.label ?? s.replace(/_/g, " ")}
                        </Badge>
                      ))}
                    </div>
                  ) : (
                    <div className="text-sm text-muted-foreground">—</div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Client capacity</Label>
                    {coachEditing ? (
                      <Input
                        type="number"
                        min={0}
                        value={cCapacity}
                        onChange={(e) => setCCapacity(e.target.value)}
                        placeholder="No cap"
                      />
                    ) : (
                      <div className="text-sm">{cCapacity || <span className="text-muted-foreground">No cap</span>}</div>
                    )}
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Timezone</Label>
                    {coachEditing ? (
                      <Input value={cTimezone} onChange={(e) => setCTimezone(e.target.value)} placeholder="America/New_York" />
                    ) : (
                      <div className="text-sm">{cTimezone || <span className="text-muted-foreground">—</span>}</div>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
                  <Label className="text-sm">Accepting new clients</Label>
                  <Switch checked={cAccepting} onCheckedChange={setCAccepting} disabled={!coachEditing} />
                </div>
              </div>
            </>
          )}

          <Separator />

          {/* Personal */}
          <div className="space-y-3">
            <div className="text-xs uppercase text-muted-foreground">Personal</div>
            {editing && isSelf && (
              <div className="space-y-1">
                <Label className="text-xs">Profile photo</Label>
                <AvatarUploader
                  userId={member.user_id}
                  value={fields.avatar_url}
                  onChange={(url) => set("avatar_url", url)}
                  name={fields.full_name || member.email}
                  size={72}
                />
              </div>
            )}
            {editing ? (
              <>
                <Field label="First name" value={fields.first_name} editing onChange={v => set("first_name", v)} />
                <Field label="Middle initial" value={fields.middle_initial} editing onChange={v => set("middle_initial", v)} placeholder="M" />
                <Field label="Last name" value={fields.last_name} editing onChange={v => set("last_name", v)} />
              </>
            ) : (
              <Field label="Name" value={fields.full_name} editing={false} onChange={() => {}} />
            )}
            {contactLoadFailed ? (
              <p role="status" className="text-sm text-muted-foreground">
                Their phone and work email couldn&apos;t be loaded. Close this and open it again to see and change them.
              </p>
            ) : (
              <>
                <Field label="Phone" value={fields.phone} editing={editing} onChange={v => set("phone", v)} placeholder="+1 555 555 5555" />
                <Field label="Work email" value={fields.work_email} editing={editing} onChange={v => set("work_email", v)} placeholder="work@company.com" />
              </>
            )}
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Mail className="w-3.5 h-3.5" /> Login email: <span className="text-foreground">{member.email || "—"}</span>
            </div>
          </div>

          <Separator />

          {/* Business */}
          <div className="space-y-3">
            <div className="text-xs uppercase text-muted-foreground">Business</div>
            <Field label="Business name" value={fields.business_name} editing={editing} onChange={v => set("business_name", v)} placeholder="e.g. Acme Capital Partners" />
            <Field label="Website" value={fields.website_url} editing={editing} onChange={v => set("website_url", v)} placeholder="https://" />
          </div>

          <Separator />

          {/* Address */}
          <div className="space-y-3">
            <div className="text-xs uppercase text-muted-foreground">Address</div>
            <Field label="Street" value={fields.address} editing={editing} onChange={v => set("address", v)} />
            <div className="grid grid-cols-2 gap-2">
              <Field label="City" value={fields.city} editing={editing} onChange={v => set("city", v)} />
              <Field label="State" value={fields.state} editing={editing} onChange={v => set("state", v)} />
            </div>
            <Field label="Postal code" value={fields.postal_code} editing={editing} onChange={v => set("postal_code", v)} />
          </div>

          <Separator />

          {/* Bio / notes */}
          <div className="space-y-3">
            <div className="text-xs uppercase text-muted-foreground">Bio & internal notes</div>
            <div className="space-y-1">
              <Label className="text-xs">Public bio (shown to clients for coaches/brokers)</Label>
              {editing
                ? <Textarea rows={3} value={fields.coach_bio} onChange={e => set("coach_bio", e.target.value)} />
                : <p className="text-sm whitespace-pre-wrap text-muted-foreground">{fields.coach_bio || "—"}</p>}
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Internal notes (staff only)</Label>
              {editing
                ? <Textarea rows={3} value={fields.staff_notes} onChange={e => set("staff_notes", e.target.value)} />
                : <p className="text-sm whitespace-pre-wrap text-muted-foreground">{fields.staff_notes || "—"}</p>}
            </div>
          </div>

          <Separator />

          <div className="space-y-2">
            <div className="text-xs uppercase text-muted-foreground">Activity</div>
            <div className="flex items-center gap-2"><Calendar className="w-4 h-4 text-muted-foreground" /> Joined {fmt(member.created_at)}</div>
            <div className="flex items-center gap-2"><Clock className="w-4 h-4 text-muted-foreground" /> Last sign-in {member.last_sign_in_at ? fmt(member.last_sign_in_at) : "Never"}</div>
            <div className="flex items-center gap-2"><Users className="w-4 h-4 text-muted-foreground" /> {loading ? "…" : extras.assignedClientsCount ?? 0} assigned clients</div>
            <div className="flex items-center gap-2"><FileText className="w-4 h-4 text-muted-foreground" /> {loading ? "…" : extras.invitesSentCount ?? 0} invitations sent</div>
            {extras.tenantNames && extras.tenantNames.length > 0 && (
              <div className="flex flex-wrap gap-1 pt-1">
                {extras.tenantNames.map(n => <Badge key={n} variant="secondary">{n}</Badge>)}
              </div>
            )}
          </div>

          <Separator />

          {/* Account actions — admin reset toolkit */}
          <div className="space-y-3">
            <div className="text-xs uppercase text-muted-foreground">Reset account</div>
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="outline" size="sm" className="justify-start"
                disabled={!!actionPending || !member.email}
                onClick={() => runAction("password_reset", "Password reset link sent")}
              >
                <KeyRound className="w-3.5 h-3.5 mr-1.5" />
                {actionPending === "password_reset" ? "Sending…" : "Send password reset"}
              </Button>
              <Button
                variant="outline" size="sm" className="justify-start"
                disabled={!!actionPending || !member.email}
                onClick={() => runAction("resend_invite", "Magic-link invite sent")}
              >
                <Send className="w-3.5 h-3.5 mr-1.5" />
                {actionPending === "resend_invite" ? "Sending…" : "Resend invite"}
              </Button>
              <Button
                variant="outline" size="sm" className="justify-start"
                disabled={!!actionPending}
                onClick={() => setConfirmSignout(true)}
              >
                <LogOut className="w-3.5 h-3.5 mr-1.5" />
                Force sign-out
              </Button>
              <Button
                variant="outline" size="sm" className="justify-start"
                disabled={!!actionPending}
                onClick={() => setConfirmWipe(true)}
              >
                <RefreshCcw className="w-3.5 h-3.5 mr-1.5" />
                Wipe onboarding
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Reset actions never touch a member's records, businesses, or CRM history. Use Delete to remove an account.
            </p>
          </div>

          {confirmSignout && (
            <div className="rounded-md border border-warning/40 bg-warning/5 p-3 space-y-2">
              <p className="text-sm">Sign this user out of every device immediately?</p>
              <div className="flex gap-2 justify-end">
                <Button size="sm" variant="ghost" onClick={() => setConfirmSignout(false)} disabled={!!actionPending}>Cancel</Button>
                <Button size="sm" onClick={() => runAction("signout_all", "Signed out of all sessions")} disabled={!!actionPending}>
                  {actionPending === "signout_all" ? "Working…" : "Sign out everywhere"}
                </Button>
              </div>
            </div>
          )}

          {confirmWipe && (
            <div className="rounded-md border border-warning/40 bg-warning/5 p-3 space-y-2">
              <p className="text-sm">Reset this user's onboarding, intake, and consent flags? They'll re-run the welcome flow on next login.</p>
              <div className="flex gap-2 justify-end">
                <Button size="sm" variant="ghost" onClick={() => setConfirmWipe(false)} disabled={!!actionPending}>Cancel</Button>
                <Button size="sm" onClick={() => runAction("wipe_onboarding", "Onboarding reset")} disabled={!!actionPending}>
                  {actionPending === "wipe_onboarding" ? "Working…" : "Wipe onboarding"}
                </Button>
              </div>
            </div>
          )}

          <div className="text-[11px] text-muted-foreground pt-2">User ID: <code className="text-xs">{member.user_id}</code></div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Field({
  label, value, editing, onChange, placeholder,
}: { label: string; value: string; editing: boolean; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      {editing
        ? <Input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} />
        : <div className="text-sm">{value || <span className="text-muted-foreground">—</span>}</div>}
    </div>
  );
}
