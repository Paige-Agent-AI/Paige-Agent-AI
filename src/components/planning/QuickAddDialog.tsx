/* eslint-disable @typescript-eslint/no-explicit-any -- pre-existing legacy `any` debt in this
   file (untyped Supabase reads, stale generated types). The E09 Customer Portal identity change
   (CURA, never PAIGE, on customer surfaces) only edited copy here and introduced ZERO new `any`s;
   retyping is tracked separately (#234). */
import { useEffect, useState, type ReactNode } from "react";
import { Plus, Bell, CheckSquare, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger, DialogDescription,
} from "@/components/ui/dialog";
import { friendlyPlanError } from "@/lib/planning";
import { useAssistantName } from "@/lib/portal/customerIdentity";

type Kind = "reminder" | "task";

/** Local datetime-local string (YYYY-MM-DDTHH:mm) for a given ISO date at 09:00,
 * so a calendar day-click preselects a sensible time in the viewer's zone. */
function dateToLocalNine(date: string): string {
  // date is YYYY-MM-DD; keep it literal (no TZ shift) and default to 09:00.
  return `${date}T09:00`;
}

interface QuickAddDialogProps {
  userId: string | null;
  onCreated: () => void;
  /** Scope the new item to a client — the contact-record Tasks tab and the
   * calendar's per-contact adds pass this so it shows on that record too. */
  contactId?: string | null;
  /** Name shown in the dialog copy when contact-scoped (e.g. "for Dana Reid"). */
  contactName?: string | null;
  /** Preselect a day (YYYY-MM-DD) — used by the calendar overlay's day add. */
  defaultDate?: string | null;
  /** Default the picker to reminder or task. */
  defaultKind?: Kind;
  /** Custom trigger. Omit to render the default "New" outline button. Pass
   * `null` with `open`/`onOpenChange` to drive the dialog fully controlled. */
  trigger?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/** Human create-path for the Task Manager — a person adds a reminder/task
 * without going through Paige. Calls the SAME plan_* RPCs Paige's tools call
 * (§10), so the UI and Paige are one caller. Reused on the Planning hub, the
 * contact-record Tasks tab, and the calendar overlay. */
export function QuickAddDialog({
  userId, onCreated, contactId = null, contactName = null,
  defaultDate = null, defaultKind = "reminder", trigger, open: openProp, onOpenChange,
}: QuickAddDialogProps) {
  const assistant = useAssistantName();
  const controlled = openProp !== undefined;
  const [openState, setOpenState] = useState(false);
  const open = controlled ? openProp : openState;
  const setOpen = (o: boolean) => { if (!controlled) setOpenState(o); onOpenChange?.(o); };

  const [kind, setKind] = useState<Kind>(defaultKind);
  const [title, setTitle] = useState("");
  const [whenLocal, setWhenLocal] = useState(defaultDate ? dateToLocalNine(defaultDate) : "");
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setKind(defaultKind);
    setTitle("");
    setWhenLocal(defaultDate ? dateToLocalNine(defaultDate) : "");
  };

  // When the preset day changes (calendar overlay reopened on another date),
  // reseed the time field while the dialog is closed.
  useEffect(() => {
    if (!open) setWhenLocal(defaultDate ? dateToLocalNine(defaultDate) : "");
  }, [defaultDate, open]);

  async function submit() {
    const t = title.trim();
    if (!t) { toast.error("Give it a title"); return; }
    if (kind === "reminder" && !whenLocal) { toast.error("Pick a time to be reminded"); return; }
    const iso = whenLocal ? new Date(whenLocal).toISOString() : null;
    if (iso && kind === "reminder" && new Date(iso).getTime() <= Date.now()) { toast.error("Pick a future time"); return; }

    setBusy(true);
    try {
      if (kind === "reminder") {
        const { error } = await supabase.rpc("plan_set_reminder", {
          p_title: t, p_remind_at: iso, p_channel: "in_app", p_contact_id: contactId,
        });
        if (error) throw new Error(friendlyPlanError(error.message));
        toast.success("Reminder set — it'll ping you at that time");
      } else {
        if (!userId) throw new Error("Your account isn't loaded yet");
        const { error } = await supabase.rpc("plan_assign_task", {
          p_title: t, p_assigned_to_user_id: userId, p_due_at: iso, p_contact_id: contactId,
        });
        if (error) throw new Error(friendlyPlanError(error.message));
        toast.success("Task added");
      }
      setOpen(false);
      reset();
      onCreated();
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't add that");
    } finally {
      setBusy(false);
    }
  }

  const forWhom = contactName ? ` for ${contactName}` : "";

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      {trigger !== null && (
        <DialogTrigger asChild>
          {trigger ?? (
            <Button variant="outline">
              <Plus className="mr-1.5 h-4 w-4" /> New
            </Button>
          )}
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{contactName ? `Add${forWhom}` : "Add to your plan"}</DialogTitle>
          <DialogDescription>
            {contactName
              ? `A reminder or task about ${contactName}. For anything more, just ask ${assistant}.`
              : `A quick reminder or task for yourself. For anything more, just ask ${assistant}.`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            {([["reminder", "Reminder", Bell], ["task", "Task", CheckSquare]] as const).map(([k, label, Icon]) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                aria-pressed={kind === k}
                className={cn(
                  "flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  kind === k ? "border-primary bg-primary/5 text-foreground" : "border-border text-muted-foreground hover:bg-muted",
                )}
              >
                <Icon className="h-4 w-4" /> {label}
              </button>
            ))}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="qa-title">{kind === "reminder" ? "Remind me to…" : "Task"}</Label>
            <Input
              id="qa-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={kind === "reminder" ? "Follow up with Dana" : "Draft the week-2 check-in"}
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="qa-when">{kind === "reminder" ? "When" : "Due (optional)"}</Label>
            <Input id="qa-when" type="datetime-local" value={whenLocal} onChange={(e) => setWhenLocal(e.target.value)} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin motion-reduce:animate-none" /> : null}
            {kind === "reminder" ? "Set reminder" : "Add task"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
