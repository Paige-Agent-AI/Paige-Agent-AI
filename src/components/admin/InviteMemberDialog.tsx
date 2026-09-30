import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Enums } from "@/integrations/supabase/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { toast } from "sonner";
import { z } from "zod";

// Mirrors STAFF_ROLES in MembersAdmin — non-staff are clients/leads.
const STAFF_ROLE_SET = new Set([
  "admin","sales_rep","broker","broker_team_member","cs_rep","finance","viewer","moderator","owner","super_admin",
]);

const ROLE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "admin",     label: "Administrator" },
  { value: "sales_rep", label: "Sales Rep" },
  { value: "broker",    label: "Broker" },
  { value: "cs_rep",    label: "Customer Success" },
  { value: "finance",   label: "Finance" },
  { value: "viewer",    label: "Viewer (read-only)" },
];

const schema = z.object({
  email: z.string().trim().email("Valid email required").max(255),
  role: z.string().min(1, "Pick a role"),
  message: z.string().max(500).optional(),
});

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onInvited?: () => void;
}

interface UserOption {
  id: string;
  email: string | null;
  full_name: string | null;
  roles: string[];
}

export function InviteMemberDialog({ open, onOpenChange, onInvited }: Props) {
  // Invite-new state
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("viewer");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Promote-existing state
  const [users, setUsers] = useState<UserOption[]>([]);
  const [promoteFilter, setPromoteFilter] = useState("");
  const [promoteSelected, setPromoteSelected] = useState<string | null>(null);
  const [promoteRole, setPromoteRole] = useState("viewer");

  const reset = () => {
    setEmail(""); setRole("viewer"); setMessage("");
    setPromoteSelected(null); setPromoteFilter(""); setPromoteRole("viewer");
  };

  useEffect(() => {
    if (!open) return;
    (async () => {
      const { data: usersRes, error } = await supabase.functions.invoke("admin-list-users", { body: {} });
      if (error) return;
      const list: Array<{ id: string; email?: string | null }> = usersRes?.users ?? [];
      const ids = list.map((u) => u.id);
      const [{ data: profs }, { data: roleRows }] = await Promise.all([
        supabase.from("coach_client_profiles_safe").select("user_id, full_name").in("user_id", ids),
        supabase.from("user_roles").select("user_id, role").in("user_id", ids),
      ]);
      const nameById = new Map((profs ?? []).map((p) => [p.user_id, p.full_name]));
      const rolesById = new Map<string, string[]>();
      (roleRows ?? []).forEach((r) => {
        const arr = rolesById.get(r.user_id) || [];
        arr.push(r.role); rolesById.set(r.user_id, arr);
      });
      setUsers(list.map((u) => ({
        id: u.id,
        email: u.email ?? null,
        full_name: nameById.get(u.id) ?? null,
        roles: rolesById.get(u.id) ?? [],
      })));
    })();
  }, [open]);

  // Non-staff users only — promotion is for clients/leads, not existing staff.
  const promotable = useMemo(() => {
    const f = promoteFilter.toLowerCase();
    return users
      .filter((u) => !u.roles.some((r) => STAFF_ROLE_SET.has(r)))
      .filter((u) => {
        if (!f) return true;
        return (u.email || "").toLowerCase().includes(f) || (u.full_name || "").toLowerCase().includes(f);
      })
      .slice(0, 50);
  }, [users, promoteFilter]);

  const handleInvite = async () => {
    const parsed = schema.safeParse({ email, role, message: message || undefined });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("send-admin-invitation", {
        body: { email: parsed.data.email, role, message: parsed.data.message },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      if (data?.emailSent === false) {
        toast.warning(`Invite created for ${parsed.data.email}, but the email didn't send. Check delivery in the table.`);
      } else {
        toast.success(`Invitation sent to ${parsed.data.email}`);
      }
      reset();
      onOpenChange(false);
      onInvited?.();
    } catch (e) {
      toast.error((e instanceof Error ? e.message : "") || "Failed to send invitation");
    } finally {
      setSubmitting(false);
    }
  };

  const handlePromote = async () => {
    if (!promoteSelected) return;
    setSubmitting(true);
    try {
      const { error } = await supabase.rpc("grant_tenant_member_role", {
        _user_id: promoteSelected,
        _role: promoteRole as Enums<"app_role">,
      });
      if (error) throw error;
      const target = users.find((u) => u.id === promoteSelected);
      toast.success(`Granted ${promoteRole} to ${target?.email ?? "user"}`);
      reset();
      onOpenChange(false);
      onInvited?.();
    } catch (e) {
      toast.error((e instanceof Error ? e.message : "") || "Failed to promote user");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!submitting) onOpenChange(o); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add a team member</DialogTitle>
          <DialogDescription>
            Promote an existing client/lead to a staff role, or email a brand-new invite.
          </DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="promote">
          <TabsList className="grid grid-cols-2 w-full">
            <TabsTrigger value="promote">Promote existing</TabsTrigger>
            <TabsTrigger value="invite">Invite new</TabsTrigger>
          </TabsList>

          <TabsContent value="promote" className="space-y-3 pt-3">
            <div className="space-y-1.5">
              <Label>Find user</Label>
              <Command shouldFilter={false} className="rounded-md border">
                <CommandInput placeholder="Search by name or email…" value={promoteFilter} onValueChange={setPromoteFilter} />
                <CommandList>
                  <CommandEmpty>No matching non-staff users.</CommandEmpty>
                  <CommandGroup>
                    {promotable.map((u) => (
                      <CommandItem
                        key={u.id}
                        value={u.id}
                        onSelect={() => setPromoteSelected(u.id)}
                        className={promoteSelected === u.id ? "bg-accent" : ""}
                      >
                        <div className="flex flex-col">
                          <span className="font-medium">{u.full_name || u.email || u.id}</span>
                          <span className="text-xs text-muted-foreground">{u.email}</span>
                        </div>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </div>
            <div className="space-y-1.5">
              <Label>Grant role</Label>
              <Select value={promoteRole} onValueChange={setPromoteRole}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ROLE_OPTIONS.map((r) => (
                    <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>Cancel</Button>
              <Button onClick={handlePromote} disabled={!promoteSelected || submitting}>
                {submitting ? "Granting…" : "Grant role"}
              </Button>
            </DialogFooter>
          </TabsContent>

          <TabsContent value="invite" className="space-y-4 pt-3">
            <div className="space-y-1.5">
              <Label htmlFor="invite-email">Email</Label>
              <Input
                id="invite-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="person@example.com"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="invite-role">Role</Label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger id="invite-role"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ROLE_OPTIONS.map((r) => (
                    <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="invite-msg">Personal note (optional)</Label>
              <Textarea
                id="invite-msg"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={3}
                placeholder="Quick context they'll see in the invite email…"
              />
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>Cancel</Button>
              <Button onClick={handleInvite} disabled={submitting}>
                {submitting ? "Sending…" : "Send invite"}
              </Button>
            </DialogFooter>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
