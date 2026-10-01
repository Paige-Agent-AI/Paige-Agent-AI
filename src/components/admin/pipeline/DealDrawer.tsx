import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { loadAssignableStaff } from "@/lib/team/assignableStaff";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { Activity, CheckSquare, MessageSquare, StickyNote, Trophy, X, UserCircle, ExternalLink, BarChart3, Trash2 } from "lucide-react";
import { Deal, PipelineStage, formatMoney, dollarsToCents, logDealActivity } from "@/lib/pipelines";

type Coach = { user_id: string; name: string };
type Contact = { id: string; first_name: string; last_name: string; entity_name: string | null; linked_user_id: string | null };

type Props = {
  deal: Deal | null;
  stages: PipelineStage[];
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onChanged: () => void;
};

export function DealDrawer({ deal, stages, open, onOpenChange, onChanged }: Props) {
  const [coaches, setCoaches] = useState<Coach[]>([]);
  const [contact, setContact] = useState<Contact | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- pre-existing type debt; hotfix changes only the retired route destination
  const [activities, setActivities] = useState<any[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- pre-existing type debt; hotfix changes only the retired route destination
  const [comms, setComms] = useState<any[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- pre-existing type debt; hotfix changes only the retired route destination
  const [tasks, setTasks] = useState<any[]>([]);
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDue, setTaskDue] = useState("");
  const [notesDraft, setNotesDraft] = useState("");
  const [valueDraft, setValueDraft] = useState("");
  const [titleDraft, setTitleDraft] = useState("");
  const [closeDateDraft, setCloseDateDraft] = useState("");
  const [lostReason, setLostReason] = useState("");

  const sortedStages = useMemo(() => [...stages].sort((a, b) => a.order_index - b.order_index), [stages]);
  const wonStage = sortedStages.find((s) => s.stage_type === "won");
  const lostStage = sortedStages.find((s) => s.stage_type === "lost");
  const currentStage = sortedStages.find((s) => s.id === deal?.stage_id);

  useEffect(() => {
    if (!open || !deal) return;
    setNotesDraft(deal.notes ?? "");
    setValueDraft(((deal.value_cents || 0) / 100).toString());
    setTitleDraft(deal.title);
    setCloseDateDraft(deal.expected_close_date ?? "");
    (async () => {
      // The workspace's assignable staff (admins), for the owner picker.
      setCoaches(await loadAssignableStaff());
      // Load contact
      if (deal.contact_client_id) {
        const { data: c } = await supabase.from("clients").select("id, first_name, last_name, entity_name, linked_user_id").eq("id", deal.contact_client_id).maybeSingle();
        setContact((c as Contact) || null);
      } else {
        setContact(null);
      }
      // Load deal activity feed
      const { data: acts } = await supabase.from("deal_activities").select("*").eq("deal_id", deal.id).order("created_at", { ascending: false }).limit(50);
      setActivities(acts || []);
      // Tasks linked to deal
      const { data: ts } = await supabase.from("tasks").select("*").eq("deal_id", deal.id).order("created_at", { ascending: false });
      setTasks(ts || []);
      // Communications for the linked contact
      if (deal.contact_client_id) {
        const { data: c2 } = await supabase.from("clients").select("linked_user_id").eq("id", deal.contact_client_id).maybeSingle();
        const uid = c2?.linked_user_id;
        if (uid) {
          const { data: cms } = await supabase.from("communication_log").select("*").eq("user_id", uid).order("created_at", { ascending: false }).limit(30);
          setComms(cms || []);
        } else setComms([]);
      } else setComms([]);
    })();
  }, [open, deal]);

  if (!deal) return null;

  const patch = async (fields: Partial<Deal>, activitySummary?: string) => {
    const { error } = await supabase.from("deals").update(fields).eq("id", deal.id);
    if (error) { toast.error(error.message); return; }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- pre-existing type debt; hotfix changes only the retired route destination
    if (activitySummary) await logDealActivity(deal.id, "deal_updated", activitySummary, fields as any);
    onChanged();
  };

  const moveStage = async (newStageId: string) => {
    const newStage = sortedStages.find((s) => s.id === newStageId);
    if (!newStage) return;
    const payload: Partial<Deal> = { stage_id: newStageId };
    if (newStage.stage_type === "won") {
      payload.status = "won";
      payload.actual_close_date = new Date().toISOString().slice(0, 10);
    } else if (newStage.stage_type === "lost") {
      payload.status = "lost";
      payload.actual_close_date = new Date().toISOString().slice(0, 10);
    } else {
      payload.status = "open";
      payload.actual_close_date = null;
    }
    await patch(payload, `Moved to ${newStage.label}`);
    toast.success(`Moved to ${newStage.label}`);
  };

  const markLost = async () => {
    if (!lostStage) return toast.error("Add a 'Lost' stage in Pipeline Settings first");
    await patch({ stage_id: lostStage.id, status: "lost", actual_close_date: new Date().toISOString().slice(0, 10), lost_reason: lostReason || null }, `Lost: ${lostReason || "no reason given"}`);
    setLostReason("");
    toast.success("Marked lost");
  };

  const markWon = async () => {
    if (!wonStage) return toast.error("Add a 'Won' stage in Pipeline Settings first");
    await patch({ stage_id: wonStage.id, status: "won", actual_close_date: new Date().toISOString().slice(0, 10) }, "Marked won");
    toast.success("Marked won");
  };

  const addTask = async () => {
    if (!taskTitle.trim()) return;
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from("tasks").insert({
      user_id: user?.id,
      title: taskTitle.trim(),
      status: "pending",
      due_date: taskDue || null,
      deal_id: deal.id,
    });
    if (error) return toast.error(error.message);
    setTaskTitle(""); setTaskDue("");
    const { data: ts } = await supabase.from("tasks").select("*").eq("deal_id", deal.id).order("created_at", { ascending: false });
    setTasks(ts || []);
    await logDealActivity(deal.id, "task_created", `Task: ${taskTitle.trim()}`);
  };

  const toggleTask = async (id: string, current: string) => {
    const next = current === "completed" ? "pending" : "completed";
    await supabase.from("tasks").update({ status: next }).eq("id", id);
    setTasks((prev) => prev.map((t) => t.id === id ? { ...t, status: next } : t));
  };

  const deleteDeal = async () => {
    const { error } = await supabase.from("deals").delete().eq("id", deal.id);
    if (error) return toast.error(error.message);
    toast.success("Deal deleted");
    onOpenChange(false);
    onChanged();
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <div className="flex items-center justify-between">
            <SheetTitle className="text-lg truncate">{deal.title}</SheetTitle>
            <button onClick={() => onOpenChange(false)} className="p-1 hover:bg-muted rounded"><X className="w-4 h-4" /></button>
          </div>
          <SheetDescription className="flex items-center gap-2">
            <Badge style={{ backgroundColor: currentStage?.color, color: "#fff" }} className="capitalize">{currentStage?.label}</Badge>
            <span className="text-sm font-semibold text-foreground">{formatMoney(deal.value_cents, deal.currency)}</span>
            {deal.status !== "open" && <Badge variant="outline" className="capitalize">{deal.status}</Badge>}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 flex gap-2 flex-wrap">
          <Button size="sm" variant="default" onClick={markWon} className="gap-1.5"><Trophy className="w-3.5 h-3.5" /> Mark Won</Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="sm" variant="outline">Mark Lost</Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Mark deal as lost?</AlertDialogTitle>
                <AlertDialogDescription>Optionally capture why so you can spot patterns later.</AlertDialogDescription>
              </AlertDialogHeader>
              <Textarea value={lostReason} onChange={(e) => setLostReason(e.target.value)} placeholder="e.g. Went with competitor / out of budget" />
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={markLost}>Confirm</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="sm" variant="ghost" className="text-destructive ml-auto"><Trash2 className="w-3.5 h-3.5" /></Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete this deal?</AlertDialogTitle>
                <AlertDialogDescription>This cannot be undone. Activity history will be removed too.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={deleteDeal}>Delete</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>

        <Tabs defaultValue="overview" className="mt-4">
          <TabsList className="w-full grid grid-cols-4">
            <TabsTrigger value="overview"><BarChart3 className="w-3.5 h-3.5 mr-1" />Overview</TabsTrigger>
            <TabsTrigger value="activity"><Activity className="w-3.5 h-3.5 mr-1" />Activity</TabsTrigger>
            <TabsTrigger value="tasks"><CheckSquare className="w-3.5 h-3.5 mr-1" />Tasks</TabsTrigger>
            <TabsTrigger value="notes"><StickyNote className="w-3.5 h-3.5 mr-1" />Notes</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-3 pt-3">
            <div>
              <Label className="text-xs">Title</Label>
              <Input value={titleDraft} onChange={(e) => setTitleDraft(e.target.value)} onBlur={() => titleDraft !== deal.title && patch({ title: titleDraft }, `Renamed to "${titleDraft}"`)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Stage</Label>
                <Select value={deal.stage_id} onValueChange={moveStage}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {sortedStages.map((s) => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Value ($)</Label>
                <Input type="number" value={valueDraft} onChange={(e) => setValueDraft(e.target.value)} onBlur={() => {
                  const cents = dollarsToCents(valueDraft);
                  if (cents !== deal.value_cents) patch({ value_cents: cents }, `Value set to ${formatMoney(cents)}`);
                }} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Expected close</Label>
                <Input type="date" value={closeDateDraft} onChange={(e) => setCloseDateDraft(e.target.value)} onBlur={() => closeDateDraft !== (deal.expected_close_date ?? "") && patch({ expected_close_date: closeDateDraft || null })} />
              </div>
              <div>
                <Label className="text-xs">Owner / Coach</Label>
                <Select value={deal.owner_user_id ?? "none"} onValueChange={(v) => patch({ owner_user_id: v === "none" ? null : v }, "Owner changed")}>
                  <SelectTrigger><SelectValue placeholder="Unassigned" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Unassigned</SelectItem>
                    {coaches.map((c) => <SelectItem key={c.user_id} value={c.user_id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="rounded-md border border-border p-3">
              <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><UserCircle className="w-3.5 h-3.5" /> Contact</div>
              {contact ? (
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium">{contact.first_name} {contact.last_name}</div>
                    {contact.entity_name && <div className="text-xs text-muted-foreground">{contact.entity_name}</div>}
                  </div>
                  <Link to={"/choose-account"} className="text-xs text-primary flex items-center gap-1 hover:underline">
                    Open <ExternalLink className="w-3 h-3" />
                  </Link>
                </div>
              ) : <div className="text-sm text-muted-foreground">No contact linked.</div>}
            </div>

            <div className="rounded-md border border-border p-3">
              <div className="text-xs text-muted-foreground mb-2 flex items-center gap-1"><MessageSquare className="w-3.5 h-3.5" /> Recent communications</div>
              {comms.length === 0 ? <div className="text-xs text-muted-foreground">No messages logged for this contact.</div> : (
                <div className="space-y-1.5">
                  {comms.slice(0, 4).map((m) => (
                    <div key={m.id} className="text-xs flex justify-between gap-2">
                      <span className="truncate">{m.channel}: {m.subject || m.message_type}</span>
                      <span className="text-muted-foreground shrink-0">{formatDistanceToNow(new Date(m.created_at), { addSuffix: true })}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="activity" className="pt-3">
            {activities.length === 0 ? <div className="text-sm text-muted-foreground text-center py-6">No activity yet.</div> : (
              <div className="space-y-2">
                {activities.map((a) => (
                  <div key={a.id} className="border-l-2 border-accent/60 pl-3 py-1 text-sm">
                    <div className="flex justify-between gap-2">
                      <span className="font-medium">{a.summary}</span>
                      <span className="text-xs text-muted-foreground shrink-0">{formatDistanceToNow(new Date(a.created_at), { addSuffix: true })}</span>
                    </div>
                    <div className="text-xs text-muted-foreground capitalize">{a.type.replace(/_/g, " ")}</div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="tasks" className="pt-3 space-y-3">
            <div className="flex gap-2">
              <Input placeholder="New task…" value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} />
              <Input type="date" value={taskDue} onChange={(e) => setTaskDue(e.target.value)} className="w-40" />
              <Button onClick={addTask}>Add</Button>
            </div>
            {tasks.length === 0 ? <div className="text-sm text-muted-foreground text-center py-4">No tasks for this deal.</div> : (
              <div className="space-y-1.5">
                {tasks.map((t) => (
                  <label key={t.id} className="flex items-center gap-2 text-sm border border-border rounded px-3 py-2 cursor-pointer">
                    <input type="checkbox" checked={t.status === "completed"} onChange={() => toggleTask(t.id, t.status)} />
                    <span className={t.status === "completed" ? "line-through text-muted-foreground" : ""}>{t.title}</span>
                    {t.due_date && <span className="ml-auto text-xs text-muted-foreground">{new Date(t.due_date).toLocaleDateString()}</span>}
                  </label>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="notes" className="pt-3 space-y-2">
            <Textarea rows={10} value={notesDraft} onChange={(e) => setNotesDraft(e.target.value)} placeholder="Deal notes — saved when you click outside." onBlur={() => notesDraft !== (deal.notes ?? "") && patch({ notes: notesDraft || null })} />
            <p className="text-xs text-muted-foreground">Notes save automatically when you click out of the field.</p>
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}
