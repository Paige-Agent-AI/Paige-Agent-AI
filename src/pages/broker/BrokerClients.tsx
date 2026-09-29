// Broker → Clients tab. Add / list / mark-inactive client relationships and
// fire the broker-client-invite transactional email so the client can sign up
// at the broker rate via /auth?ref=<broker_code>&mode=signup.

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Plus, Mail, Loader2, Brain } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useBrokerContext } from "@/hooks/useBrokerContext";
import { useToast } from "@/hooks/use-toast";

interface ClientRow {
  id: string;
  client_first_name: string;
  client_last_name: string;
  client_email: string;
  client_phone: string | null;
  client_goal: string | null;
  client_subscription_status: string;
  is_active: boolean;
  added_at: string;
}

const BrokerClients = () => {
  const { activeBrokerId, parentBrokerProfile, permissions } = useBrokerContext();
  const profile = parentBrokerProfile; // alias for legacy field reads below
  const { toast } = useToast();
  const navigate = useNavigate();
  const [rows, setRows] = useState<ClientRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    goal: "",
  });

  const load = async () => {
    if (!activeBrokerId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("broker_client_relationships")
      .select(
        "id, client_first_name, client_last_name, client_email, client_phone, client_goal, client_subscription_status, is_active, added_at",
      )
      .eq("broker_id", activeBrokerId)
      .order("added_at", { ascending: false });
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      setRows((data as ClientRow[]) || []);
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeBrokerId]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeBrokerId || !profile?.referral_code) return;
    setSubmitting(true);

    const email = form.email.trim().toLowerCase();
    if (!email || !form.firstName.trim() || !form.lastName.trim()) {
      toast({ title: "Missing info", description: "First name, last name, and email are required.", variant: "destructive" });
      setSubmitting(false);
      return;
    }

    // 1. Insert relationship row
    const { data: inserted, error: insertErr } = await supabase
      .from("broker_client_relationships")
      .insert({
        broker_id: activeBrokerId,
        client_email: email,
        client_first_name: form.firstName.trim(),
        client_last_name: form.lastName.trim(),
        client_phone: form.phone.trim() || null,
        client_goal: form.goal.trim() || null,
        discount_code: profile.broker_client_discount_code,
        client_subscription_status: "invited",
      })
      .select("id")
      .single();

    if (insertErr) {
      toast({
        title: "Could not add client",
        description: insertErr.message,
        variant: "destructive",
      });
      setSubmitting(false);
      return;
    }

    // 2. The platform does not email the client for you: a broker profile is self-serve today, so
    //    platform-domain mail on a broker's behalf is held until approval is operator-only. You
    //    share your own signup link, which carries the broker rate.
    toast({
      title: "Client added",
      description: `Share your invite link with ${email} — use Copy invite link in their row. They get the $17/mo broker rate when they sign up with it.`,
    });
    setForm({ firstName: "", lastName: "", email: "", phone: "", goal: "" });
    setOpen(false);
    setSubmitting(false);
    load();
  };

  const handleCopyInviteLink = async (row: ClientRow) => {
    if (!profile?.referral_code) return;
    const signupLink = `https://paigeagent.ai/auth?ref=${encodeURIComponent(profile.referral_code)}&mode=signup`;
    try {
      await navigator.clipboard.writeText(signupLink);
      toast({ title: "Invite link copied", description: `Send it to ${row.client_email} from your own email or phone.` });
    } catch {
      toast({ title: "Copy your invite link", description: signupLink });
    }
  };

  const handleArchive = async (row: ClientRow) => {
    const { error } = await supabase
      .from("broker_client_relationships")
      .update({ is_active: !row.is_active })
      .eq("id", row.id);
    if (error) {
      toast({ title: "Update failed", description: error.message, variant: "destructive" });
      return;
    }
    load();
  };

  const statusBadge = (status: string, active: boolean) => {
    if (!active) return <Badge variant="outline">Archived</Badge>;
    if (status === "active") return <Badge>Active</Badge>;
    if (status === "invited") return <Badge variant="secondary">Invited</Badge>;
    if (status === "trialing") return <Badge variant="secondary">Trialing</Badge>;
    return <Badge variant="outline">{status}</Badge>;
  };

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Clients</h1>
          <p className="text-muted-foreground">
            Invite clients onto PaigeAgent at your $17/mo broker rate.
          </p>
        </div>
        {permissions.can_add_clients && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Add client
              </Button>
            </DialogTrigger>
          <DialogContent>
            <form onSubmit={handleAdd}>
              <DialogHeader>
                <DialogTitle>Invite a new client</DialogTitle>
                <DialogDescription>
                  We’ll email them a signup link with your broker code and a $10 forever discount applied.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-3 py-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="firstName">First name</Label>
                    <Input
                      id="firstName"
                      value={form.firstName}
                      onChange={(e) => setForm({ ...form, firstName: e.target.value })}
                      required
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="lastName">Last name</Label>
                    <Input
                      id="lastName"
                      value={form.lastName}
                      onChange={(e) => setForm({ ...form, lastName: e.target.value })}
                      required
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="phone">Phone (optional)</Label>
                  <Input
                    id="phone"
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="goal">What are they working toward? (optional)</Label>
                  <Textarea
                    id="goal"
                    rows={3}
                    value={form.goal}
                    onChange={(e) => setForm({ ...form, goal: e.target.value })}
                    placeholder="e.g. Building business credit for SBA loan in 9 months"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button type="submit" disabled={submitting}>
                  {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Send invite
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Your client roster</CardTitle>
          <CardDescription>
            {rows.length} {rows.length === 1 ? "client" : "clients"} on file
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : rows.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Mail className="h-8 w-8 mx-auto mb-3 opacity-40" />
              <p>No clients yet. Add your first to send them an invite.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Client</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Added</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id} className={!row.is_active ? "opacity-60" : ""}>
                    <TableCell className="font-medium">
                      {row.client_first_name} {row.client_last_name}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{row.client_email}</TableCell>
                    <TableCell>{statusBadge(row.client_subscription_status, row.is_active)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(row.added_at).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right space-x-2">
                      {row.is_active && permissions.can_run_sessions && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="border-[#CFAE70] text-[#CFAE70] hover:bg-[#CFAE70]/10 hover:text-[#CFAE70]"
                          onClick={() => navigate(`/broker/app/sessions/${row.id}`)}
                        >
                          <Brain className="h-3.5 w-3.5 mr-1" />
                          Start Paige Session
                        </Button>
                      )}
                      {row.client_subscription_status !== "active" && row.is_active && permissions.can_add_clients && (
                        <Button variant="ghost" size="sm" onClick={() => handleCopyInviteLink(row)}>
                          Copy invite link
                        </Button>
                      )}
                      {permissions.can_remove_clients && (
                        <Button variant="ghost" size="sm" onClick={() => handleArchive(row)}>
                          {row.is_active ? "Archive" : "Restore"}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default BrokerClients;
