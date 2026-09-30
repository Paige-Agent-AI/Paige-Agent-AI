import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ArrowLeft, DollarSign, FileText, Mail, Brain, Upload,
  AlertTriangle, User, Building2, Phone, AtSign, Save, Archive, ArchiveRestore,
  TrendingUp, ClipboardList, Database, MessageSquare, Trash2, Edit3, Loader2
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { ReportUploadTab } from "./ReportUploadTab";
import { OutreachCenter } from "./OutreachCenter";
import { PMEFundingReadiness } from "./PMEFundingReadiness";
import { ClientMemoryTab } from "./ClientMemoryTab";
import { FundingApplicationLog } from "./FundingApplicationLog";
// [§194] ClientOutcomesTab removed — monitoring-only.
import { AdminAccountManagement } from "./AdminAccountManagement";
import { AdminFactoryResetDialog, AdminChatHistory, AdminFundingOverride } from "./admin/AdminClientTools";
import { toast } from "sonner";
import { CLIENT_CONTACT_METHODS_EMBED, withPrimaryAddresses, type ContactMethodRow, type WithClientContactMethods } from "@/lib/contact-methods";
import { setContactPrimaryAddresses } from "@/lib/contacts";

// Widened to string: the generated types do not know the contact-methods embed yet.
const CLIENT_RECORD_SELECT: string = `*,${CLIENT_CONTACT_METHODS_EMBED}`;

interface InternalClientFileViewProps {
  clientId: string;
  onBack: () => void;
}

interface ClientRecord {
  id: string;
  /** The contact's workspace: the address write is scoped to it. */
  tenant_id: string | null;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  /** Every address as read; the save names this list, so a change made since is refused. */
  client_contact_methods?: readonly ContactMethodRow[] | null;
  entity_name: string | null;
  entity_type: string | null;
  funding_goal: number | null;
  monthly_revenue: number | null;
  current_notes: string | null;
  status: string;
  linked_user_id: string | null;
  created_at: string;
}

export function InternalClientFileView({ clientId, onBack }: InternalClientFileViewProps) {
  const [client, setClient] = useState<ClientRecord | null>(null);
  const [activeTab, setActiveTab] = useState("overview");
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<Partial<ClientRecord>>({});
  const [saving, setSaving] = useState(false);
  const [showFactoryReset, setShowFactoryReset] = useState(false);

  // Credit scores from profiles (if linked) or credit_factor_scores
  const [scores, setScores] = useState<{ eq: number; ex: number; tu: number }>({ eq: 0, ex: 0, tu: 0 });
  const [negativeCount, setNegativeCount] = useState(0);

  useEffect(() => {
    fetchClient();
    fetchClientData();
  }, [clientId]);

  const fetchClient = async () => {
    const { data } = await supabase
      .from("clients")
      .select(CLIENT_RECORD_SELECT)
      .eq("id", clientId)
      .maybeSingle();
    if (data) {
      // `email` / `phone` are the contact's primary addresses, from its contact methods.
      const record = withPrimaryAddresses(data as unknown as ClientRecord & WithClientContactMethods);
      setClient(record);
      setEditForm(record);
    }
  };

  const fetchClientData = async () => {
    const negRes = await supabase
      .from("credit_negative_items")
      .select("id", { count: "exact", head: true })
      .eq("client_id", clientId);
    setNegativeCount(negRes.count || 0);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // The primary email and phone live in the contact's methods. Set them first, so an address
      // another contact already holds is refused before anything else on the record changes.
      const addresses: { email?: string | null; phone?: string | null } = {};
      if ((editForm.email?.trim() || null) !== (client?.email ?? null)) addresses.email = editForm.email?.trim() || null;
      if ((editForm.phone?.trim() || null) !== (client?.phone ?? null)) addresses.phone = editForm.phone?.trim() || null;
      if (Object.keys(addresses).length) {
        await setContactPrimaryAddresses(clientId, addresses, {
          tenantId: client?.tenant_id ?? null,
          loaded: client?.client_contact_methods,
        });
      }

      const { error } = await supabase
        .from("clients")
        .update({
          first_name: editForm.first_name,
          last_name: editForm.last_name,
          entity_name: editForm.entity_name || null,
          entity_type: editForm.entity_type || null,
          funding_goal: editForm.funding_goal,
          monthly_revenue: editForm.monthly_revenue,
          current_notes: editForm.current_notes || null,
        })
        .eq("id", clientId);
      if (error) throw error;
      toast.success("Client record updated");
      setEditing(false);
      fetchClient();
    } catch (err) {
      toast.error("Failed to save", { description: (err as Error).message });
    } finally {
      setSaving(false);
    }
  };

  const updateStatus = async (newStatus: string) => {
    if (!client || newStatus === client.status) return;
    const previous = client;
    // Optimistic update so the badge + dropdown reflect the new value instantly.
    setClient({ ...client, status: newStatus });
    const { error } = await supabase
      .from("clients")
      .update({ status: newStatus })
      .eq("id", clientId);
    if (error) {
      setClient(previous);
      const msg = (error.message || "").toLowerCase();
      if (msg.includes("clients_status_check")) {
        toast.error("Invalid status value");
      } else {
        toast.error("Failed to update status", { description: error.message });
      }
    } else {
      toast.success(
        newStatus === "archived"
          ? "Client archived"
          : newStatus === "active" && previous.status === "archived"
            ? "Client restored"
            : `Status updated to ${newStatus}`
      );
    }
  };

  const toggleArchive = () => {
    if (!client) return;
    updateStatus(client.status === "archived" ? "active" : "archived");
  };

  if (!client) {
    return (
      <div className="flex items-center justify-center p-12" role="status" aria-live="polite">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground motion-reduce:animate-none" aria-hidden="true" />
        <span className="sr-only">Loading client</span>
      </div>
    );
  }

  const fullName = `${client.first_name} ${client.last_name}`;
  // Use linked_user_id for components that need a user_id, or fall back to a placeholder
  const effectiveUserId = client.linked_user_id || clientId;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="w-4 h-4 mr-1" /> Back
        </Button>
        <div className="flex-1">
          <h2 className="text-2xl font-bold text-foreground">{fullName}</h2>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            {client.entity_name && (
              <span className="text-sm text-muted-foreground flex items-center gap-1">
                <Building2 className="w-3 h-3" /> {client.entity_name}
              </span>
            )}
            {client.email && (
              <span className="text-sm text-muted-foreground flex items-center gap-1">
                <AtSign className="w-3 h-3" /> {client.email}
              </span>
            )}
            <Select value={client.status} onValueChange={updateStatus}>
              <SelectTrigger className="w-[130px] h-7 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
                <SelectItem value="archived">Archived</SelectItem>
              </SelectContent>
            </Select>
            {client.linked_user_id && (
              <Badge variant="outline" className="text-xs">Portal Linked</Badge>
            )}
            {negativeCount > 0 && (
              <Badge variant="destructive" className="flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" /> {negativeCount} Negative Items
              </Badge>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={toggleArchive}>
            {client.status === "archived" ? (
              <><ArchiveRestore className="w-4 h-4 mr-1" /> Restore</>
            ) : (
              <><Archive className="w-4 h-4 mr-1" /> Archive</>
            )}
          </Button>
          {client.linked_user_id && (
            <Button size="sm" variant="destructive" onClick={() => setShowFactoryReset(true)}>
              <Trash2 className="w-4 h-4 mr-1" /> Factory Reset
            </Button>
          )}
        </div>
      </div>

      {client.linked_user_id && (
        <AdminFactoryResetDialog
          clientUserId={client.linked_user_id}
          clientName={fullName}
          open={showFactoryReset}
          onOpenChange={setShowFactoryReset}
        />
      )}

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="flex flex-wrap h-auto gap-1">
          <TabsTrigger value="overview" className="text-xs">
            <User className="w-3 h-3 mr-1" /> Overview
          </TabsTrigger>
          <TabsTrigger value="credit-reports" className="text-xs">
            <Upload className="w-3 h-3 mr-1" /> Credit Reports
          </TabsTrigger>
          <TabsTrigger value="account-mgmt" className="text-xs">
            <Database className="w-3 h-3 mr-1" /> Account Mgmt
          </TabsTrigger>
          <TabsTrigger value="funding" className="text-xs">
            <DollarSign className="w-3 h-3 mr-1" /> Funding
          </TabsTrigger>
          <TabsTrigger value="applications" className="text-xs">
            <ClipboardList className="w-3 h-3 mr-1" /> Applications
          </TabsTrigger>
          <TabsTrigger value="documents" className="text-xs">
            <FileText className="w-3 h-3 mr-1" /> Documents
          </TabsTrigger>
          <TabsTrigger value="outreach" className="text-xs">
            <Mail className="w-3 h-3 mr-1" /> Outreach
          </TabsTrigger>
          <TabsTrigger value="memory" className="text-xs">
            <Brain className="w-3 h-3 mr-1" /> Memory
          </TabsTrigger>
          {client.linked_user_id && (
            <TabsTrigger value="chat-history" className="text-xs">
              <MessageSquare className="w-3 h-3 mr-1" /> Chat
            </TabsTrigger>
          )}
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="mt-4">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Client Info Card */}
            <Card className="lg:col-span-2">
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-lg">Client Information</CardTitle>
                {!editing ? (
                  <Button size="sm" variant="outline" onClick={() => setEditing(true)}>Edit</Button>
                ) : (
                  <div className="flex gap-2">
                    <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setEditForm(client); }}>Cancel</Button>
                    <Button size="sm" onClick={handleSave} disabled={saving}>
                      <Save className="w-3 h-3 mr-1" /> {saving ? "Saving..." : "Save"}
                    </Button>
                  </div>
                )}
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-xs text-muted-foreground">First Name</Label>
                    {editing ? (
                      <Input value={editForm.first_name || ""} onChange={(e) => setEditForm({ ...editForm, first_name: e.target.value })} />
                    ) : (
                      <p className="font-medium">{client.first_name}</p>
                    )}
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Last Name</Label>
                    {editing ? (
                      <Input value={editForm.last_name || ""} onChange={(e) => setEditForm({ ...editForm, last_name: e.target.value })} />
                    ) : (
                      <p className="font-medium">{client.last_name}</p>
                    )}
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Email</Label>
                    {editing ? (
                      <Input type="email" value={editForm.email || ""} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} />
                    ) : (
                      <p>{client.email || "—"}</p>
                    )}
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Phone</Label>
                    {editing ? (
                      <Input type="tel" value={editForm.phone || ""} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} />
                    ) : (
                      <p>{client.phone || "—"}</p>
                    )}
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Entity Name</Label>
                    {editing ? (
                      <Input value={editForm.entity_name || ""} onChange={(e) => setEditForm({ ...editForm, entity_name: e.target.value })} />
                    ) : (
                      <p>{client.entity_name || "—"}</p>
                    )}
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Entity Type</Label>
                    <p>{client.entity_type || "—"}</p>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Funding Goal</Label>
                    <p>{client.funding_goal ? `$${Number(client.funding_goal).toLocaleString()}` : "—"}</p>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Monthly Revenue</Label>
                    <p>{client.monthly_revenue ? `$${Number(client.monthly_revenue).toLocaleString()}` : "—"}</p>
                  </div>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Notes</Label>
                  {editing ? (
                    <Textarea value={editForm.current_notes || ""} onChange={(e) => setEditForm({ ...editForm, current_notes: e.target.value })} rows={3} />
                  ) : (
                    <p className="text-sm text-muted-foreground whitespace-pre-wrap">{client.current_notes || "No notes yet."}</p>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Quick Stats */}
            <div className="space-y-4">
              <Card>
                <CardContent className="pt-6 space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Negative Items</span>
                    <Badge variant={negativeCount > 0 ? "destructive" : "default"}>{negativeCount}</Badge>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Portal Access</span>
                    <Badge variant={client.linked_user_id ? "default" : "outline"}>
                      {client.linked_user_id ? "Linked" : "Not Invited"}
                    </Badge>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Created</span>
                    <span className="text-sm">{new Date(client.created_at).toLocaleDateString()}</span>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        {/* Credit Reports — uses linked_user_id if available, otherwise client_id */}
        <TabsContent value="credit-reports" className="mt-4">
          <ReportUploadTab clientUserId={effectiveUserId} />
        </TabsContent>

        {/* Account Management */}
        <TabsContent value="account-mgmt" className="mt-4">
          <AdminAccountManagement clientUserId={effectiveUserId} clientId={clientId} userRole="admin" />
        </TabsContent>

        {/* Funding */}
        <TabsContent value="funding" className="mt-4">
          <div className="space-y-6">
            <PMEFundingReadiness />
            <AdminFundingOverride clientUserId={effectiveUserId} />
          </div>
        </TabsContent>

        {/* Funding Applications */}
        <TabsContent value="applications" className="mt-4">
          <FundingApplicationLog clientId={clientId} />
        </TabsContent>

        {/* Documents */}
        <TabsContent value="documents" className="mt-4">
          <Card>
            <CardContent className="py-12 text-center">
              <FileText className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
              <p className="text-muted-foreground">Upload and manage client documents</p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Outreach */}
        <TabsContent value="outreach" className="mt-4">
          <OutreachCenter clientUserId={effectiveUserId} />
        </TabsContent>

        {/* Memory */}
        <TabsContent value="memory" className="mt-4">
          <ClientMemoryTab clientUserId={effectiveUserId} />
        </TabsContent>

        {/* [§194] Outcomes tab removed */}

        {/* Chat History */}
        {client.linked_user_id && (
          <TabsContent value="chat-history" className="mt-4">
            <AdminChatHistory clientUserId={client.linked_user_id} />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
