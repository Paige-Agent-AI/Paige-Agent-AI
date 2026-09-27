import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { loadAssignableStaff } from "@/lib/team/assignableStaff";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ArrowLeft, Mail, Phone, Building2, DollarSign, ExternalLink,
  MessageSquare, CheckSquare, FileText, StickyNote, Activity, Briefcase,
  CreditCard, User, Landmark, TrendingUp, Send, Pencil, ClipboardCheck, Trash2, Zap, Wallet, Sparkles,
  ListChecks,
} from "lucide-react";
import { CallButton } from "@/components/admin/voice/CallButton";
import { ContactAutomationHistory } from "@/components/admin/contacts/ContactAutomationHistory";
import { ContactBillingPanel } from "@/components/admin/contacts/ContactBillingPanel";
import { ContactPaigePanel } from "@/components/contact/ContactPaigePanel";

import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { LIFECYCLE_STAGES, lifecycleMeta, deleteContact } from "@/lib/contacts";
import { ContactDealsSection } from "@/components/admin/contacts/ContactDealsSection";
import { FundingReadinessLens } from "@/components/funding-lens/FundingReadinessLens";
import { EditContactDialog } from "@/components/admin/contacts/EditContactDialog";
import { QuickLogMenu } from "@/components/admin/contacts/QuickLogMenu";
import { DuplicatesBanner } from "@/components/admin/contacts/DuplicatesBanner";
import { ContactCampaignAttribution } from "@/components/admin/contacts/ContactCampaignAttribution";
import { BusinessVerificationCard } from "@/components/admin/contacts/BusinessVerificationCard";
import { BusinessTabPanel } from "@/components/admin/contacts/BusinessTabPanel";
import { ClientOrgChartPanel } from "@/components/admin/contacts/ClientOrgChartPanel";
import { ContactNotesPanel } from "@/components/admin/contacts/ContactNotesPanel";
import { ContactFilesPanel } from "@/components/admin/contacts/ContactFilesPanel";
import { ContactCustomFieldsPanel } from "@/components/admin/contacts/ContactCustomFieldsPanel";
import { ContactPlanningPanel } from "@/components/admin/contacts/ContactPlanningPanel";
import { ContactPortalPanel } from "@/components/admin/contacts/ContactPortalPanel";
import { ClientOnboardingStatusPanel } from "@/components/admin/contacts/ClientOnboardingStatusPanel";
import { ImpersonateClientButton } from "@/components/admin/ImpersonateClientButton";
import { useTenantContext } from "@/hooks/useTenantContext";
import { useTierFeatures } from "@/hooks/useTierFeatures";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

import { useTenantFeature } from "@/hooks/useTenantFeature";
import { usePendingApprovals } from "@/hooks/usePendingApprovals";
import { useUserRoles } from "@/hooks/useUserRoles";
import { CATEGORY_LABEL, RISK_COLOR, type ApprovalCategory } from "@/lib/approvals";


type Client = {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  entity_name: string | null;
  title?: string | null;
  funding_goal: number | null;
  status: string;
  lifecycle_stage?: string | null;
  tags?: string[] | null;
  source?: string | null;
  assigned_coach_user_id: string | null;
  linked_user_id: string | null;
  created_at: string;
  current_notes?: string | null;
  account_number?: string | null;
  tenant_id?: string | null;
};

type Coach = { user_id: string; name: string };

type Business = {
  id: string;
  legal_name: string | null;
  dba: string | null;
  entity_type: string | null;
};

// Minimal shapes for the merged Activity-tab feed (communication_log + tasks rows).
type ActivityRow = {
  id: string;
  created_at: string;
  channel?: string | null;
  subject?: string | null;
  message_type?: string | null;
  preview?: string | null;
};
type TaskRow = {
  id: string;
  created_at: string;
  title?: string | null;
  description?: string | null;
};

export default function ContactDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [client, setClient] = useState<Client | null>(null);
  const [coaches, setCoaches] = useState<Coach[]>([]);
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  // notes + files are fetched to prime the tab counts; the Notes/Files tabs render
  // their own self-fetching panels, so these are write-only (never field-accessed).
  const [notes, setNotes] = useState<unknown[]>([]);
  const [files, setFiles] = useState<unknown[]>([]);
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const { items: contactApprovals } = usePendingApprovals({ contactId: id });
  const { isAdmin } = useUserRoles();


  useEffect(() => { if (id) load(id); }, [id]);

  const load = async (clientId: string) => {
    setLoading(true);
    try {
      const { data: c, error } = await supabase.from("clients").select("*").eq("id", clientId).maybeSingle();
      if (error) throw error;
      if (!c) { toast.error("Contact not found"); navigate("/choose-account"); return; }
      setClient(c as Client);

      setCoaches(await loadAssignableStaff());

      if (c.linked_user_id) {
        const [actRes, taskRes, noteRes, fileRes, bizRes] = await Promise.all([
          supabase.from("communication_log").select("*").eq("user_id", c.linked_user_id).order("created_at", { ascending: false }).limit(50),
          supabase.from("tasks").select("*").eq("user_id", c.linked_user_id).order("created_at", { ascending: false }).limit(50),
          supabase.from("client_memory").select("*").eq("client_user_id", c.linked_user_id).eq("is_active", true).order("created_at", { ascending: false }).limit(50),
          supabase.from("documents").select("*").eq("user_id", c.linked_user_id).order("uploaded_at", { ascending: false }).limit(50),
          supabase.from("businesses").select("id, legal_name, dba, entity_type").eq("owner_user_id", c.linked_user_id).order("created_at", { ascending: false }),
        ]);
        setActivity((actRes.data ?? []) as ActivityRow[]);
        setTasks((taskRes.data ?? []) as TaskRow[]);
        setNotes(noteRes.data ?? []);
        setFiles(fileRes.data ?? []);
        setBusinesses((bizRes.data ?? []) as Business[]);
      } else {
        const [noteRes, fileRes] = await Promise.all([
          supabase.from("client_memory").select("*").eq("client_id", clientId).eq("is_active", true).order("created_at", { ascending: false }).limit(50),
          supabase.from("documents").select("*").eq("client_id", clientId).order("uploaded_at", { ascending: false }).limit(50),
        ]);
        setNotes(noteRes.data || []);
        setFiles(fileRes.data || []);
        setBusinesses([]);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load contact");
    } finally {
      setLoading(false);
    }
  };

  const assignCoach = async (coachId: string | null) => {
    if (!client) return;
    const { error } = await supabase.from("clients").update({ assigned_coach_user_id: coachId }).eq("id", client.id);
    if (error) return toast.error(error.message);
    setClient({ ...client, assigned_coach_user_id: coachId });
    toast.success(coachId ? "Coach assigned" : "Coach unassigned");
  };

  const updateStatus = async (status: string) => {
    if (!client) return;
    const { error } = await supabase.from("clients").update({ status }).eq("id", client.id);
    if (error) return toast.error(error.message);
    setClient({ ...client, status });
    toast.success(`Stage moved to ${status}`);
  };

  const updateLifecycle = async (stage: string) => {
    if (!client) return;
    const { error } = await supabase.from("clients").update({ lifecycle_stage: stage }).eq("id", client.id);
    if (error) return toast.error(error.message);
    setClient({ ...client, lifecycle_stage: stage });
    toast.success(`Lifecycle moved to ${stage}`);
  };

  const fullName = useMemo(() => client ? `${client.first_name} ${client.last_name}`.trim() : "", [client]);
  const { activeTenantId } = useTenantContext();
  // §60 tier lock (owner-ruled 2026-08-11): the client Portal & Agreements tab is
  // the consumer-portal invite surface — solo + sub_account ONLY, never Agency
  // (which manages sub-accounts, not a direct consumer client book).
  const { has: hasTierFeature } = useTierFeatures();
  const canInvitePortal = hasTierFeature("customer_portal_invite");
  const { enabled: btfEnabled } = useTenantFeature("btf_enabled");
  // "Funding Readiness" is a vertical-specific surface (credit/funding coaching).
  // It is NOT a platform default (§2/§9): the tab shows only for tenants whose
  // config turns it on — the credit/funding Playbook enables it; generic
  // coaching/consulting/agency tenants never see it.
  const { enabled: fundingReadinessEnabled } = useTenantFeature("funding_readiness");
  const coachName = (uid: string | null) => uid ? (coaches.find((c) => c.user_id === uid)?.name || "Coach") : "Unassigned";

  const sendClientProgramInvite = async () => {
    // §9: a CLIENT gets the tenant-branded PORTAL invite (/join), never the staff
    // /accept-invite dashboard path. Mirrors ContactPortalPanel's "Grant Paige
    // access" flow — mint a consumer token BOUND to this contact so, on accept,
    // accept_tenant_invite links them to this exact row (clients row + client
    // role, NO tenant_members membership → no operator dashboard).
    // §60: hard-guard the consumer-portal invite — solo + sub_account only.
    if (!canInvitePortal) return;
    if (!client?.email) {
      toast.error("This contact has no email on file — add one before inviting.");
      return;
    }
    if (!activeTenantId) {
      toast.error("No active workspace to invite into.");
      return;
    }
    try {
      const { data: tokRes, error: mintErr } = await supabase.rpc("create_tenant_invite_token", {
        _tenant_id: activeTenantId,
        _kind: "consumer",
        _default_role: "member",
        _expires_in_days: 30,
        _max_uses: null,
        _contact_id: client.id,
        _email: client.email,
      });
      if (mintErr) throw mintErr;
      const row = Array.isArray(tokRes) ? tokRes[0] : tokRes;
      const token = (row as { token?: string } | null)?.token;
      if (!token) throw new Error("Could not create the invite");
      const { data: sent } = await supabase.functions.invoke("send-portal-invite", {
        body: { token, email: client.email },
      });
      const emailed = (sent as { emailed?: boolean } | null)?.emailed;
      if (emailed === false) {
        toast.warning(`Invite created for ${client.email}, but the email didn't send. Check delivery.`);
      } else {
        toast.success(`Client portal invite sent to ${client.email}`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to send client portal invite");
    }
  };

  const startOnboarding = async () => {
    // start-btf-onboarding edge function was retired in Commit N+1
    // (Sprint 211.b close-out). The replacement client-program
    // onboarding kickoff path is scheduled for a follow-up ship.
    // Preserving the button binding so the admin surface still renders
    // under btfEnabled + isAdmin + lifecycle_stage === "won" gating.
    toast.info(
      "Client program onboarding kickoff is temporarily unavailable — reach out to platform admin if needed.",
    );
  };

  if (loading || !client) {
    return <div className="p-8 text-center text-muted-foreground">Loading contact…</div>;
  }

  const lcMeta = lifecycleMeta(client.lifecycle_stage);


  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate("/choose-account")}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Contacts
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl sm:text-3xl font-bold truncate">{fullName || "Unnamed Contact"}</h1>
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm text-muted-foreground">{client.entity_name || "No business on file"}</p>
            {client.account_number && (
              <button
                type="button"
                onClick={() => { navigator.clipboard.writeText(client.account_number!); }}
                title="Click to copy account number"
                className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground hover:bg-muted/70 hover:text-foreground transition"
              >
                #{client.account_number}
              </button>
            )}
          </div>
        </div>
        <QuickLogMenu
          contactId={client.id}
          contactUserId={client.linked_user_id}
          contactDisplay={fullName || client.email || "contact"}
          onLogged={() => id && load(id)}
        />
        {/* §18 — the Conversations hub is the ONE comms home (this replaced the old in-tab
            ContactCommsPanel). Deep-link opens/starts this contact's thread there. Non-gold (§11). */}
        <Button
          variant="outline" size="sm"
          onClick={() => navigate("/choose-account")}
        >
          <MessageSquare className="h-4 w-4 mr-1" /> Message {client.first_name || fullName || "contact"}
        </Button>
        <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
          <Pencil className="h-4 w-4 mr-1" /> Edit
        </Button>
        <Button variant="outline" size="sm" onClick={() => navigate("/choose-account")}>
          <Activity className="h-4 w-4 mr-1" /> Member Journey
        </Button>
        {btfEnabled && isAdmin && (
          <>
            {/* §60: the portal-invite resend is solo + sub_account only — gate the
                button to match its handler (which hard-returns on !canInvitePortal),
                so Agency doesn't see a dead control. Start Onboarding is a SEPARATE
                capability and stays under btfEnabled && isAdmin. */}
            {canInvitePortal && (
              <Button variant="outline" size="sm" onClick={sendClientProgramInvite}>
                <Send className="h-4 w-4 mr-1" /> Resend Client Program Invite
              </Button>
            )}
            {client.lifecycle_stage === "won" && (
              <Button size="sm" onClick={startOnboarding}>
                <Send className="h-4 w-4 mr-1" /> Start Onboarding
              </Button>
            )}
          </>
        )}

        <ImpersonateClientButton contactId={client.id} linkedUserId={client.linked_user_id} />
        {client.linked_user_id && (
          <Button variant="outline" size="sm" onClick={() => navigate("/choose-account")}>
            <ExternalLink className="h-4 w-4 mr-1" /> Full Client File
          </Button>
        )}
        {!client.linked_user_id && (
          <Button variant="outline" size="sm" onClick={() => navigate("/choose-account")}>
            <ExternalLink className="h-4 w-4 mr-1" /> Internal Record
          </Button>
        )}
        {isAdmin && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setDeleteOpen(true)}
            className="text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 className="h-4 w-4 mr-1" /> Delete
          </Button>
        )}
      </div>

      <DuplicatesBanner contactId={client.id} email={client.email} phone={client.phone} />
      <ContactCampaignAttribution contactId={client.id} />




      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Card>
          <CardContent className="p-4 space-y-2 text-sm">
            <div className="flex items-center gap-2 text-muted-foreground"><Mail className="h-4 w-4" /> {client.email || "—"}</div>
            <div className="flex items-center gap-2 text-muted-foreground">
              <Phone className="h-4 w-4" /> <span className="flex-1">{client.phone || "—"}</span>
              {client.phone && <CallButton number={client.phone} />}
            </div>
            <div className="flex items-center gap-2 text-muted-foreground"><Building2 className="h-4 w-4" /> {client.entity_name || "—"}</div>
            <div className="flex items-center gap-2 text-muted-foreground"><DollarSign className="h-4 w-4" /> {client.funding_goal ? `$${Number(client.funding_goal).toLocaleString()} goal` : "No goal set"}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Lifecycle Stage</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <Badge variant="outline" className={`${lcMeta.color} border-transparent`}>{lcMeta.label}</Badge>
            <Select value={client.lifecycle_stage || "new_lead"} onValueChange={updateLifecycle}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                {LIFECYCLE_STAGES.map((s) => (
                  <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {client.tags && client.tags.length > 0 && (
              <div className="flex flex-wrap gap-1 pt-1">
                {client.tags.map((t) => (
                  <Badge key={t} variant="secondary" className="text-xs">{t}</Badge>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Assigned Coach</CardTitle></CardHeader>
          <CardContent>
            <Select
              value={client.assigned_coach_user_id || "unassigned"}
              onValueChange={(v) => assignCoach(v === "unassigned" ? null : v)}
            >
              <SelectTrigger className="h-9"><SelectValue>{coachName(client.assigned_coach_user_id)}</SelectValue></SelectTrigger>
              <SelectContent>
                <SelectItem value="unassigned">Unassigned</SelectItem>
                {coaches.map((co) => <SelectItem key={co.user_id} value={co.user_id}>{co.name}</SelectItem>)}
              </SelectContent>
            </Select>
            {client.source && (
              <div className="text-xs text-muted-foreground mt-2">Source: {client.source}</div>
            )}
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="deals">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="deals"><Briefcase className="h-4 w-4 mr-1" /> Deals</TabsTrigger>
          <TabsTrigger value="activity"><Activity className="h-4 w-4 mr-1" /> Activity</TabsTrigger>
          <TabsTrigger value="tasks"><CheckSquare className="h-4 w-4 mr-1" /> Tasks</TabsTrigger>
          <TabsTrigger value="notes"><StickyNote className="h-4 w-4 mr-1" /> Notes</TabsTrigger>
          <TabsTrigger value="files"><FileText className="h-4 w-4 mr-1" /> Files</TabsTrigger>
          <TabsTrigger value="business"><Building2 className="h-4 w-4 mr-1" /> Business</TabsTrigger>
          <TabsTrigger value="custom-fields"><ListChecks className="h-4 w-4 mr-1" /> Custom Fields</TabsTrigger>
          {fundingReadinessEnabled && (
            <TabsTrigger value="funding-lens"><TrendingUp className="h-4 w-4 mr-1" /> Funding Readiness</TabsTrigger>
          )}
          {canInvitePortal && (
            <TabsTrigger value="portal"><User className="h-4 w-4 mr-1" /> Portal & Agreements</TabsTrigger>
          )}
          <TabsTrigger value="approvals">
            <ClipboardCheck className="h-4 w-4 mr-1" /> Approvals
            {contactApprovals.length > 0 && (
              <Badge variant="secondary" className="ml-1.5 h-4 px-1 text-[10px] bg-accent text-accent-foreground">
                {contactApprovals.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="automation"><Zap className="h-4 w-4 mr-1" /> Automation</TabsTrigger>
          <TabsTrigger value="billing"><Wallet className="h-4 w-4 mr-1" /> Billing</TabsTrigger>
          <TabsTrigger value="paige"><Sparkles className="h-4 w-4 mr-1" /> Paige</TabsTrigger>
        </TabsList>

        <TabsContent value="automation">
          <ContactAutomationHistory contactId={client.id} />
        </TabsContent>

        <TabsContent value="billing">
          <ContactBillingPanel contactId={client.id} />
        </TabsContent>

        <TabsContent value="paige">
          <ContactPaigePanel contactId={client.id} />
        </TabsContent>



        <TabsContent value="deals">

          <Card><CardContent className="p-4">
            <ContactDealsSection contactId={client.id} />
          </CardContent></Card>
        </TabsContent>


        <TabsContent value="activity">
          <Card><CardContent className="p-4">
            {/* §31/§18: live two-way Email & SMS now live in the Conversations hub (the one comms
                home, since the old in-page comms tab was retired). This feed still shows historical
                logged activity; the full live thread is one click away, so a send from the hub is
                never "lost" — it's just in its home (§13 honest). */}
            <button
              type="button"
              onClick={() => navigate("/choose-account")}
              className="mb-3 flex w-full items-center justify-between gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
            >
              <span className="flex items-center gap-1.5">
                <MessageSquare className="h-3.5 w-3.5 shrink-0" />
                Email &amp; SMS with this contact live in Conversations.
              </span>
              <span className="flex shrink-0 items-center gap-1 font-medium text-foreground">
                Open thread <ExternalLink className="h-3 w-3" />
              </span>
            </button>
            {!client.linked_user_id ? (
              <EmptyMsg msg="No activity yet — this contact hasn't created an account." />
            ) : activity.length === 0 && tasks.length === 0 ? (
              <EmptyMsg msg="No recent activity logged." />
            ) : (
              <div className="space-y-3">
                {[...activity.map(a => ({ ...a, _kind: "comm" as const })), ...tasks.map(t => ({ ...t, _kind: "task" as const }))]
                  .sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at))
                  .slice(0, 30)
                  .map((row) => (
                    <div key={`${row._kind}-${row.id}`} className="flex gap-3 text-sm border-l-2 border-primary/40 pl-3 py-1">
                      <span className="text-xs text-muted-foreground w-28 shrink-0">
                        {formatDistanceToNow(new Date(row.created_at), { addSuffix: true })}
                      </span>
                      <div className="min-w-0">
                        <div className="font-medium">
                          {row._kind === "comm" ? `${row.channel || "msg"}: ${row.subject || row.message_type || "Activity"}` : `Task: ${row.title}`}
                        </div>
                        {row._kind === "comm" && row.preview && <div className="text-muted-foreground truncate">{row.preview}</div>}
                        {row._kind === "task" && row.description && <div className="text-muted-foreground truncate">{row.description}</div>}
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="tasks">
          <ContactPlanningPanel contactId={client.id} contactName={fullName || client.email || null} linkedUserId={client.linked_user_id} />
        </TabsContent>

        <TabsContent value="notes">
          <ContactNotesPanel contactId={client.id} tenantId={client.tenant_id ?? null} />
        </TabsContent>

        <TabsContent value="files">
          <ContactFilesPanel contactId={client.id} tenantId={client.tenant_id ?? null} />
        </TabsContent>

        <TabsContent value="business">
          {!client.linked_user_id ? (
            <Card><CardContent className="p-4"><EmptyMsg msg="Link this contact to a user account to manage businesses + run verifications." /></CardContent></Card>
          ) : (
            <div className="space-y-4">
              <ClientOrgChartPanel linkedUserId={client.linked_user_id} />
              <BusinessTabPanel linkedUserId={client.linked_user_id} businesses={businesses} />
            </div>
          )}
        </TabsContent>

        <TabsContent value="custom-fields">
          <ContactCustomFieldsPanel contactId={client.id} tenantId={client.tenant_id ?? null} />
        </TabsContent>

        {fundingReadinessEnabled && (
          <TabsContent value="funding-lens"><FundingReadinessLens contactId={client.id} mode="admin" /></TabsContent>
        )}

        {canInvitePortal && (
          <TabsContent value="portal">
            <div className="space-y-4">
              <ClientOnboardingStatusPanel contactId={client.id} />
              <ContactPortalPanel
                contactId={client.id}
                email={client.email}
                linkedUserId={client.linked_user_id}
              />
            </div>
          </TabsContent>
        )}


        <TabsContent value="approvals">
          <Card><CardContent className="p-4">
            {contactApprovals.length === 0 ? (
              <EmptyMsg msg="No pending approvals for this contact." />
            ) : (
              <div className="space-y-2">
                {contactApprovals.map((a) => {
                  const cat = (a.category ?? a.type ?? "other") as ApprovalCategory;
                  return (
                    <button
                      key={a.id}
                      onClick={() => navigate("/choose-account")}
                      className="w-full text-left border border-border rounded p-3 hover:bg-muted/40 transition"
                    >
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <Badge variant="secondary" className="text-[10px]">{CATEGORY_LABEL[cat] ?? cat}</Badge>
                        {a.risk_level && (
                          <Badge variant="outline" className={`text-[10px] ${RISK_COLOR[a.risk_level] ?? ""}`}>
                            {a.risk_level}
                          </Badge>
                        )}
                        {a.priority && <Badge variant="outline" className="text-[10px]">P{a.priority}</Badge>}
                        <span className="text-[10px] text-muted-foreground ml-auto">
                          {formatDistanceToNow(new Date(a.created_at), { addSuffix: true })}
                        </span>
                      </div>
                      <div className="text-sm font-medium line-clamp-1">
                        {a.summary || a.draft_content?.subject || "Pending approval"}
                      </div>
                      {a.sla_due_at && (
                        <div className="text-[10px] text-muted-foreground mt-1">
                          SLA {formatDistanceToNow(new Date(a.sla_due_at), { addSuffix: true })}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </CardContent></Card>
        </TabsContent>
      </Tabs>

      <EditContactDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        // Client and EditContactDialog's Contact are structurally near-identical but neither is
        // assignable to the other (Client lacks do_not_contact; Contact lacks status/linked_user_id).
        // Bridging awaits the #234 stale-generated-types regen; #502 introduces no new `any`.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        contact={client as any}
        coaches={coaches}
        onSaved={(updated) => {
          setClient((prev) => prev ? { ...prev, ...(updated as Partial<Client>) } : prev);
          setEditOpen(false);
        }}
      />

      <AlertDialog open={deleteOpen} onOpenChange={(v) => !deleting && setDeleteOpen(v)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {fullName || "this contact"}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the contact along with their CRM history — deals,
              activities, notes, documents, and coach assignments. Any linked portal user
              account is left intact. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async (e) => {
                e.preventDefault();
                if (!client) return;
                setDeleting(true);
                try {
                  await deleteContact(client.id);
                  toast.success("Contact deleted");
                  navigate("/choose-account");
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "Delete failed");
                  setDeleting(false);
                }
              }}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? "Deleting…" : "Delete contact"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function EmptyMsg({ msg }: { msg: string }) {
  return <div className="text-sm text-muted-foreground text-center py-6">{msg}</div>;
}
