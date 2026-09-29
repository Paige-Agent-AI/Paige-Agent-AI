import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { TICKET_CATEGORIES, type TicketCategory } from "./supportTypes";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  userEmail: string | null;
  onCreated: () => void;
}

export function NewTicketDialog({ open, onOpenChange, userId, userEmail, onCreated }: Props) {
  const [category, setCategory] = useState<TicketCategory>("general");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [urgent, setUrgent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setCategory("general");
    setSubject("");
    setDescription("");
    setUrgent(false);
  };

  const handleSubmit = async () => {
    if (!subject.trim() || !description.trim()) {
      toast.error("Please fill in both subject and description");
      return;
    }
    setSubmitting(true);
    try {
      const { data, error } = await supabase
        .from("support_tickets")
        .insert({
          user_id: userId,
          category,
          subject: subject.trim(),
          description: description.trim(),
          priority: urgent ? "urgent" : "normal",
        })
        .select("id, ticket_number, subject, category, priority")
        .single();

      if (error) throw error;

      // Seed first message from the description so the thread reads naturally
      await supabase.from("support_ticket_messages").insert({
        ticket_id: data.id,
        user_id: userId,
        sender_type: "client",
        message: description.trim(),
        is_internal: false,
      });

      // Best-effort confirmation email. The server builds it from this ticket and sends it to the
      // address you sign in with.
      if (userEmail) {
        void supabase.functions.invoke("send-transactional-email", {
          body: {
            templateName: "support-ticket-created",
            idempotencyKey: `support-created-${data.id}`,
            ticketId: data.id,
          },
        });
      }

      toast.success(`Ticket ${data.ticket_number} created — we'll respond within 24 hours`);
      reset();
      onCreated();
      onOpenChange(false);
    } catch (err: unknown) {
      toast.error(err instanceof Error && err.message ? err.message : "Could not create ticket");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New Support Request</DialogTitle>
          <DialogDescription>
            Tell us what's going on. The more context you provide, the faster we can help.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Category</Label>
            <Select value={category} onValueChange={(v) => setCategory(v as TicketCategory)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {TICKET_CATEGORIES.map((c) => (
                  <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Subject</Label>
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Brief summary of your issue"
              maxLength={200}
            />
          </div>

          <div className="space-y-2">
            <Label>Description</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Please describe your issue in detail. The more context you provide the faster we can help."
              rows={6}
              className="resize-none"
            />
          </div>

          <div className="flex items-center justify-between rounded-md border border-border p-3">
            <div>
              <Label className="text-sm font-medium">Mark as Urgent</Label>
              <p className="text-xs text-muted-foreground mt-0.5">For time-sensitive issues that need immediate attention</p>
            </div>
            <Switch checked={urgent} onCheckedChange={setUrgent} />
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? "Submitting..." : "Submit Ticket"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
