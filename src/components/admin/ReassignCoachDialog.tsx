import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { loadAssignableStaff } from "@/lib/team/assignableStaff";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  fromCoachId: string | null;
  fromCoachLabel?: string;
  onReassigned?: () => void;
}

interface CoachOpt { user_id: string; email: string; }

export function ReassignCoachDialog({ open, onOpenChange, fromCoachId, fromCoachLabel, onReassigned }: Props) {
  const [coaches, setCoaches] = useState<CoachOpt[]>([]);
  const [target, setTarget] = useState<string>("__unassign__");
  const [count, setCount] = useState<number>(0);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open || !fromCoachId) return;
    (async () => {
      const [staff, { count: assignedCount }] = await Promise.all([
        loadAssignableStaff(),
        supabase.from("clients").select("id", { count: "exact", head: true })
          .eq("assigned_coach_user_id", fromCoachId),
      ]);
      setCount(assignedCount || 0);
      setCoaches(staff
        .filter((s) => s.user_id !== fromCoachId)
        .map((s) => ({ user_id: s.user_id, email: s.name })));
    })();
  }, [open, fromCoachId]);

  const handleSubmit = async () => {
    if (!fromCoachId) return;
    setSubmitting(true);
    try {
      const toCoach = target === "__unassign__" ? null : target;
      const { data, error } = await supabase.rpc("reassign_coach_clients", {
        _from_coach: fromCoachId,
        _to_coach: toCoach,
      });
      if (error) throw error;
      toast.success(`Reassigned ${data ?? 0} client(s)`);
      onOpenChange(false);
      onReassigned?.();
    } catch (e) {
      toast.error((e instanceof Error ? e.message : null) || "Reassignment failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!submitting) onOpenChange(o); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reassign coach's clients</DialogTitle>
          <DialogDescription>
            {fromCoachLabel ?? "This coach"} has <strong>{count}</strong> active client{count === 1 ? "" : "s"}. Pick where they should go.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <Label>Send to</Label>
          <Select value={target} onValueChange={setTarget}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__unassign__">— Unassign (no coach) —</SelectItem>
              {coaches.map((c) => (
                <SelectItem key={c.user_id} value={c.user_id}>{c.email}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={submitting || count === 0}>
            {submitting ? "Reassigning…" : count === 0 ? "Nothing to reassign" : "Reassign"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
