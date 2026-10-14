/**
 * /app/actions — the customer side of the two-way action bus (§8).
 *
 * This is where "the staff/Paige speak through the portal" pays off: a client
 * opens their portal and sees exactly what their team needs from them — tasks,
 * recommendations, messages, nudges — and responds inline (accept · complete ·
 * decline · ask a question). Responses route back to staff (notification + the
 * admin contact panel), closing the loop. Tenant-brand accent, neutral copy
 * (persona-driven, never "coach").
 */
import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Loader2, CheckCircle2, XCircle, MessageCircleQuestion, Sparkles, Clock, Inbox } from "lucide-react";
import { useMyActions, type CustomerAction, type ActionResponseType } from "@/hooks/useMyActions";
import { usePlaybook } from "@/lib/playbook";
import { useClientPortalBrand } from "@/hooks/useClientPortalBrand";
import { readableTextOn } from "@/lib/brand/contrast";
import { ClientActivityFeed } from "@/components/app/ClientActivityFeed";
import { ClientReleasedWork } from "@/components/client/ClientReleasedWork";

const TYPE_LABEL: Record<CustomerAction["action_type"], string> = {
  task: "Task",
  message: "Message",
  recommendation: "Recommendation",
  nudge: "Nudge",
};

const STATUS_LABEL: Record<CustomerAction["status"], string> = {
  proposed: "New",
  customer_notified: "Needs your response",
  customer_acted: "Done",
  customer_declined: "Declined",
  expired: "Expired",
};

// expires_at is a ~30-day housekeeping TTL, not a coach-set deadline — only
// surface it as the item genuinely nears expiry, and frame it as expiry (never a
// "due date" the team didn't set).
function expiryLabel(expires_at: string): string | null {
  const ms = new Date(expires_at).getTime() - Date.now();
  if (ms <= 0) return "Expired";
  const days = Math.ceil(ms / 86400000);
  if (days > 3) return null;
  return days <= 1 ? "Expires today" : `Expires in ${days} days`;
}

function ActionCard({
  action,
  accent,
  onRespond,
  open,
}: {
  action: CustomerAction;
  accent: string | null;
  open: boolean;
  onRespond: (id: string, type: ActionResponseType, text?: string) => Promise<void>;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState<ActionResponseType | null>(null);
  const [asking, setAsking] = useState(false);
  const [question, setQuestion] = useState("");
  const accentStyle = accent ? { backgroundColor: accent, color: readableTextOn(accent) } : undefined;

  const primaryType: ActionResponseType = action.action_type === "task" ? "completed" : "accepted";
  const primaryLabel = action.action_type === "task" ? "Mark complete" : "Got it";

  const submit = async (type: ActionResponseType, text?: string) => {
    if (busy) return;
    setBusy(type);
    try {
      await onRespond(action.id, type, text);
      if (type === "question") { setAsking(false); setQuestion(""); }
      toast({
        title:
          type === "question" ? "Question sent" :
          type === "declined" ? "Response noted" : "Nice work",
        description:
          type === "question" ? "Your team will get back to you." :
          type === "declined" ? "We let your team know." : "Your team has been updated.",
      });
    } catch (e) {
      toast({ title: "Couldn't submit", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  const nearExpiry = expiryLabel(action.expires_at);
  const expiredUnswept =
    (action.status === "customer_notified" || action.status === "proposed") &&
    new Date(action.expires_at).getTime() <= Date.now();
  const nonOpenStatus = expiredUnswept ? "Expired" : STATUS_LABEL[action.status];
  const responses = action.paige_customer_responses ?? [];

  return (
    <Card className={open ? "" : "opacity-80"}>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <Badge variant="secondary" className="text-[10px]">{TYPE_LABEL[action.action_type]}</Badge>
              {open && nearExpiry && (
                <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                  <Clock className="w-3 h-3" /> {nearExpiry}
                </span>
              )}
              {!open && (
                <span className="text-[11px] text-muted-foreground">{nonOpenStatus}</span>
              )}
            </div>
            <CardTitle className="text-base leading-snug">{action.title}</CardTitle>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0 space-y-4">
        {action.body && <p className="text-sm text-muted-foreground whitespace-pre-wrap">{action.body}</p>}

        {responses.length > 0 && (
          <div className="space-y-1.5 border-l-2 pl-3" style={accent ? { borderColor: accent } : undefined}>
            {responses.map((r) => (
              <div key={r.id} className="text-xs">
                <span className="font-medium capitalize">{r.response_type === "question" ? "You asked" : `You ${r.response_type}`}</span>
                {r.response_text && <span className="text-muted-foreground">: {r.response_text}</span>}
              </div>
            ))}
          </div>
        )}

        {open && (
          <>
            {asking ? (
              <div className="space-y-2">
                <Textarea
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder="What would you like to ask your team?"
                  aria-label="Your question for your team"
                  rows={3}
                  autoFocus
                />
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => submit("question", question)} disabled={busy !== null || !question.trim()} style={accentStyle}>
                    {busy === "question" ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null} Send question
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => { setAsking(false); setQuestion(""); }} disabled={busy !== null}>Cancel</Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => submit(primaryType)} disabled={busy !== null} style={accentStyle}>
                  {busy === primaryType ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-1" />}
                  {primaryLabel}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setAsking(true)} disabled={busy !== null}>
                  <MessageCircleQuestion className="w-4 h-4 mr-1" /> Ask a question
                </Button>
                <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => submit("declined")} disabled={busy !== null}>
                  {busy === "declined" ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <XCircle className="w-4 h-4 mr-1" />}
                  Not now
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default function ActionItems() {
  const { open, past, loading, respond, contactId } = useMyActions();
  const pb = usePlaybook();
  const brand = useClientPortalBrand();
  const accent = brand?.primary_color ?? null;
  const paigeName = pb.persona?.name?.trim() || "Paige";

  const handleRespond = useMemo(
    () => async (id: string, type: ActionResponseType, text?: string) => { await respond(id, type, text); },
    [respond],
  );

  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5" style={accent ? { color: accent } : undefined} />
          <h1 className="text-2xl font-semibold">Your action items</h1>
        </div>
        <p className="text-sm text-muted-foreground mt-1">
          Things {paigeName} and your team flagged for you. Respond right here — they'll see it instantly.
        </p>
      </div>

      <ClientReleasedWork />
      <ClientActivityFeed contactId={contactId} />

      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : open.length === 0 && past.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <Inbox className="w-8 h-8 mx-auto text-muted-foreground/60 mb-3" />
            <p className="text-sm font-medium">You're all caught up</p>
            <p className="text-sm text-muted-foreground mt-1">Nothing needs your attention right now. We'll let you know when it does.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {open.length > 0 && (
            <div className="space-y-3">
              {open.map((a) => <ActionCard key={a.id} action={a} accent={accent} open onRespond={handleRespond} />)}
            </div>
          )}
          {past.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Earlier</h2>
              {past.map((a) => <ActionCard key={a.id} action={a} accent={accent} open={false} onRespond={handleRespond} />)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
