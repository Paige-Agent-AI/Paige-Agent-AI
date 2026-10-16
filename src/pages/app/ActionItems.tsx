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
import { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Loader2, CheckCircle2, XCircle, MessageCircleQuestion, Sparkles, Clock, Inbox } from "lucide-react";
import { useMyActions, type CustomerAction, type ActionResponseType } from "@/hooks/useMyActions";
import { useClientPortalBrand } from "@/hooks/useClientPortalBrand";
import { readableTextOn } from "@/lib/brand/contrast";
import { ClientActivityFeed } from "@/components/app/ClientActivityFeed";
import { useBeforeUnloadGuard } from "@/hooks/useBeforeUnloadGuard";
import { useClientAccountExit } from "@/components/client/useClientAccountExit";

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
  blocked,
  uncertain,
  onCheck,
  question,
  onQuestionChange,
}: {
  action: CustomerAction;
  accent: string | null;
  open: boolean;
  blocked: boolean;
  uncertain: boolean;
  onCheck: () => void;
  question: string;
  onQuestionChange: (value: string) => void;
  onRespond: (id: string, type: ActionResponseType, text?: string) => Promise<void>;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState<ActionResponseType | null>(null);
  const [asking, setAsking] = useState(!!question);
  const alive = useRef(true), restoreAskFocus = useRef(false), askButton = useRef<HTMLButtonElement>(null), checkButton = useRef<HTMLButtonElement>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (!asking && restoreAskFocus.current) { askButton.current?.focus(); restoreAskFocus.current = false; }
  }, [asking]);
  useEffect(() => { if (uncertain && !blocked) checkButton.current?.focus(); }, [uncertain,blocked]);
  const accentStyle = accent ? { backgroundColor: accent, color: readableTextOn(accent) } : undefined;
  const disabled = busy !== null || blocked || uncertain;

  const primaryType: ActionResponseType = action.action_type === "task" ? "completed" : "accepted";
  const primaryLabel = action.action_type === "task" ? "Mark complete" : "Got it";

  const submit = async (type: ActionResponseType, text?: string) => {
    if (busy) return;
    setBusy(type);
    try {
      await onRespond(action.id, type, text);
      if (!alive.current) return;
      if (type === "question") { restoreAskFocus.current = true; setAsking(false); onQuestionChange(""); }
    } catch (e) {
      if (!alive.current) return;
      // An uncertain write has persistent inline recovery. Never label it a
      // failed submission: the canonical response may already have committed.
      if (e instanceof Error && e.name === "CustomerActionUnconfirmed") return;
      toast({ title: "Couldn't submit", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      if (alive.current) setBusy(null);
    }
  };

  const nearExpiry = expiryLabel(action.expires_at);
  const expiredUnswept =
    (action.status === "customer_notified" || action.status === "proposed") &&
    new Date(action.expires_at).getTime() <= Date.now();
  const nonOpenStatus = expiredUnswept ? "Expired" : STATUS_LABEL[action.status];
  const responses = [...action.paige_customer_responses].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));

  return (
    <Card id={`action-item-${action.id}`} role="group" aria-labelledby={`action-title-${action.id}`} tabIndex={-1}
      className={`${open ? "" : "opacity-80"} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}>
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
            <CardTitle id={`action-title-${action.id}`} className="text-base leading-snug break-words">{action.title}</CardTitle>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0 space-y-4">
        {action.body && <p className="text-sm text-muted-foreground whitespace-pre-wrap break-words">{action.body}</p>}
        {uncertain && <div role="status" className="space-y-3 text-sm">
          <p>We couldn’t confirm your response. Check the saved result before trying again.</p>
          <Button ref={checkButton} variant="outline" disabled={blocked} onClick={onCheck}>Check saved response</Button>
        </div>}

        {responses.length > 0 && (
          <div className="space-y-1.5 border-l-2 pl-3 break-words" style={accent ? { borderColor: accent } : undefined}>
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
                <Label htmlFor={`action-question-${action.id}`}>Your question</Label>
                <Textarea
                  id={`action-question-${action.id}`}
                  value={question}
                  onChange={(e) => onQuestionChange(e.target.value)}
                  placeholder="What would you like to ask your team?"
                  aria-label="Your question for your team"
                  rows={3}
                  maxLength={4000}
                  disabled={disabled}
                  autoFocus
                />
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => submit("question", question)} disabled={disabled || !question.trim()} style={accentStyle}>
                    {busy === "question" ? <Loader2 aria-hidden="true" className="w-4 h-4 mr-1 animate-spin motion-reduce:animate-none" /> : null} Send question
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => { restoreAskFocus.current = true; setAsking(false); onQuestionChange(""); }} disabled={busy !== null}>Cancel</Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => submit(primaryType)} disabled={disabled} style={accentStyle}>
                  {busy === primaryType ? <Loader2 aria-hidden="true" className="w-4 h-4 mr-1 animate-spin motion-reduce:animate-none" /> : <CheckCircle2 className="w-4 h-4 mr-1" />}
                  {primaryLabel}
                </Button>
                <Button ref={askButton} size="sm" variant="outline" onClick={() => setAsking(true)} disabled={disabled}>
                  <MessageCircleQuestion className="w-4 h-4 mr-1" /> Ask a question
                </Button>
                <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => submit("declined")} disabled={disabled}>
                  {busy === "declined" ? <Loader2 aria-hidden="true" className="w-4 h-4 mr-1 animate-spin motion-reduce:animate-none" /> : <XCircle className="w-4 h-4 mr-1" />}
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
  const { actions, open, past, loading, error, respond, contactId, refresh, pendingActionId, uncertainActionIds, scopeEpoch, confirmation } = useMyActions();
  const {toast}=useToast();
  const announced=useRef<string|null>(null);
  const [drafts, setDrafts] = useState<{epoch:number;values:Record<string,string>}>({epoch:scopeEpoch,values:{}});
  useEffect(() => {
    if (!confirmation || confirmation.epoch !== scopeEpoch) { announced.current=null; return; }
    if (announced.current===confirmation.responseId) return;
    announced.current=confirmation.responseId;
    if (confirmation.type==="question") setDrafts(previous => previous.epoch===scopeEpoch
      ? {...previous,values:{...previous.values,[confirmation.actionId]:""}} : previous);
    toast({title:confirmation.type==="question"?"Question saved":"Response saved",description:"Your response is recorded for your team."});
    if (confirmation.type!=="question") document.getElementById(`action-item-${confirmation.actionId}`)?.focus();
  }, [confirmation,scopeEpoch,toast]);
  const questions = drafts.epoch === scopeEpoch ? drafts.values : {};
  useEffect(() => { setDrafts(previous => previous.epoch === scopeEpoch ? previous : {epoch:scopeEpoch,values:{}}); }, [scopeEpoch]);
  const editQuestion = (id:string,value:string) => setDrafts(previous => ({epoch:scopeEpoch,
    values:{...(previous.epoch === scopeEpoch ? previous.values : {}),[id]:value}}));
  const guarded = Object.values(questions).some(value => value.length > 0) || !!pendingActionId || uncertainActionIds.length > 0;
  useBeforeUnloadGuard(guarded);
  useClientAccountExit(guarded, !!pendingActionId);
  const brand = useClientPortalBrand();
  const accent = brand?.primary_color ?? null;

  const handleRespond = useMemo(
    () => async (id: string, type: ActionResponseType, text?: string) => { await respond(id, type, text); },
    [respond],
  );

  return (
    <section aria-labelledby="action-items-title" aria-busy={loading || !!pendingActionId} className="p-4 sm:p-6 max-w-2xl mx-auto space-y-6 [&_button]:min-h-[44px] [&_textarea]:text-[16px]">
      <div>
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5" style={accent ? { color: accent } : undefined} />
          <h1 id="action-items-title" className="text-2xl font-semibold">Your action items</h1>
        </div>
        <p className="text-sm text-muted-foreground mt-1">
          Review requests from your team and your saved responses.
        </p>
      </div>

      <ClientActivityFeed contactId={contactId} />

      {error && <div role="alert" className="space-y-3 text-sm"><p>{error}</p><Button variant="outline" disabled={loading} onClick={() => void refresh()}>Try again</Button></div>}
      {loading && actions.length === 0 ? (
        <div role="status" className="flex justify-center py-10"><Loader2 aria-hidden="true" className="w-6 h-6 animate-spin motion-reduce:animate-none text-muted-foreground" /><span className="sr-only">Loading your action items…</span></div>
      ) : !error && open.length === 0 && past.length === 0 ? (
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
              {open.map((a) => <ActionCard key={`${scopeEpoch}:${a.id}`} action={a} accent={accent} open onRespond={handleRespond}
                question={questions[a.id] ?? ""} onQuestionChange={value => editQuestion(a.id,value)}
                blocked={loading || !!error || !!pendingActionId} uncertain={uncertainActionIds.includes(a.id)} onCheck={() => void refresh()} />)}
            </div>
          )}
          {past.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Earlier</h2>
              {past.map((a) => <ActionCard key={`${scopeEpoch}:${a.id}`} action={a} accent={accent} open={false} onRespond={handleRespond}
                question={questions[a.id] ?? ""} onQuestionChange={value => editQuestion(a.id,value)}
                blocked={loading || !!error || !!pendingActionId} uncertain={uncertainActionIds.includes(a.id)} onCheck={() => void refresh()} />)}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
