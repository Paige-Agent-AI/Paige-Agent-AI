// BrokerPaigeSession — private peer-advisor strategy chat between a broker
// and Paige about a specific client. Streams responses via the
// broker-paige-chat edge function. Brokers can edit private notes, change
// the relationship stage, generate a shareable client summary, and end the
// session (which triggers a final summary).

import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import {
  ArrowLeft,
  Send,
  Loader2,
  FileText,
  Share2,
  Save,
  StopCircle,
  Info,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useBrokerContext } from "@/hooks/useBrokerContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { trackEvent } from "@/hooks/useAnalytics";
import { PaigeThinkingIndicator } from "@/components/paige/chat/PaigeThinkingIndicator";
import { PaigeCompactingCard, type CompactingSignal } from "@/components/paige/chat/PaigeCompactingCard";

interface RelationshipRow {
  id: string;
  broker_id: string;
  client_user_id: string | null;
  client_first_name: string;
  client_last_name: string;
  client_email: string;
  client_goal: string | null;
  broker_notes: string | null;
  relationship_stage: string | null;
  shared_goal: string | null;
  last_session_summary: string | null;
  last_session_at: string | null;
  session_count: number;
}

interface CreditSnapshot {
  equifax: number | null;
  experian: number | null;
  transunion: number | null;
}

type Msg = { role: "broker" | "assistant"; content: string };

const STAGE_LABEL: Record<string, string> = {
  new: "New",
  active: "Active",
  monitoring: "Monitoring",
  completed: "Completed",
};

const FN_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/broker-paige-chat`;

const BrokerPaigeSession = () => {
  const { relationshipId } = useParams<{ relationshipId: string }>();
  const navigate = useNavigate();
  const { activeBrokerId, isTeamMember, teamMemberRole, permissions, parentBrokerProfile } =
    useBrokerContext();
  // Synthesize a `profile` object compatible with prior code shape (id + business_name + referral_code).
  const profile = activeBrokerId
    ? {
        id: activeBrokerId,
        business_name: parentBrokerProfile?.business_name || "",
        referral_code: parentBrokerProfile?.referral_code || "",
      }
    : null;
  const { toast } = useToast();

  const [rel, setRel] = useState<RelationshipRow | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  // #11 — first answer token arrived this turn (label flips Thinking→Writing).
  const [writingPhase, setWritingPhase] = useState(false);
  // #12 — compacting signal. broker-paige-chat does not emit these frames today, so the card stays a
  // NO-OP here (never faked, §13); parsed defensively so it lights up if that function ever folds.
  const [compacting, setCompacting] = useState<CompactingSignal | null>(null);
  const [snapshot, setSnapshot] = useState<CreditSnapshot | null>(null);
  const [savingNotes, setSavingNotes] = useState(false);
  const [notes, setNotes] = useState("");
  const [sharedGoal, setSharedGoal] = useState("");
  const [stage, setStage] = useState("new");
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [summary, setSummary] = useState("");
  const [generatingSummary, setGeneratingSummary] = useState(false);
  const [sharing, setSharing] = useState(false);
  const sessionStartRef = useRef<number>(Date.now());
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  // Load relationship + credit snapshot
  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!relationshipId || !profile?.id) return;
      const { data: r, error } = await supabase
        .from("broker_client_relationships")
        .select(
          "id, broker_id, client_user_id, client_first_name, client_last_name, client_email, client_goal, broker_notes, relationship_stage, shared_goal, last_session_summary, last_session_at, session_count",
        )
        .eq("id", relationshipId)
        .eq("broker_id", profile.id)
        .maybeSingle();
      if (error || !r) {
        toast({
          title: "Client not found",
          description: error?.message || "This client isn't in your roster.",
          variant: "destructive",
        });
        navigate("/broker/app/clients");
        return;
      }
      if (!mounted) return;
      const rr = r as RelationshipRow;
      setRel(rr);
      setNotes(rr.broker_notes || "");
      setSharedGoal(rr.shared_goal || "");
      setStage(rr.relationship_stage || "new");

      if (rr.client_user_id) {
        const { data: pi } = await supabase
          .from("credit_report_personal_info")
          .select("equifax_score, experian_score, transunion_score")
          .eq("user_id", rr.client_user_id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (mounted && pi) {
          const scores = pi as unknown as {
            equifax_score: number | null;
            experian_score: number | null;
            transunion_score: number | null;
          };
          setSnapshot({
            equifax: scores.equifax_score ?? null,
            experian: scores.experian_score ?? null,
            transunion: scores.transunion_score ?? null,
          });
        }
      }

      // Seed opening message (not persisted — just UX context)
      const greet = "there"; // server uses preferred greeting in its own prompt
      const opening =
        rr.session_count > 0
          ? `Welcome back, ${greet}. Last time we worked on: ${
              (rr.last_session_summary || "—").slice(0, 220)
            }${(rr.last_session_summary || "").length > 220 ? "…" : ""}\n\n${rr.client_first_name}'s profile is loaded. What are we focusing on today?`
          : `I've pulled up ${rr.client_first_name}'s profile. What would you like to work through today — credit strategy, funding options, or something else?`;
      setMessages([{ role: "assistant", content: opening }]);
    })();
    return () => {
      mounted = false;
    };
  }, [relationshipId, profile?.id, navigate, toast]);

  // Auto-scroll on new tokens
  useEffect(() => {
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, streaming]);

  const greetName = useMemo(
    () => (profile?.business_name ? profile.business_name.split(" ")[0] : "Broker"),
    [profile?.business_name],
  );

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || streaming || !rel || !profile) return;
    setInput("");
    setStreaming(true);
    setWritingPhase(false); // #11 — back to "Thinking…" until the first token this turn
    setCompacting(null); // #12 — clear any prior turn's card

    const history = messages
      .filter((m) => !(m.role === "assistant" && messages.indexOf(m) === 0)) // drop opening seed
      .map<Msg>((m) => ({ role: m.role, content: m.content }));

    setMessages((prev) => [...prev, { role: "broker", content: text }, { role: "assistant", content: "" }]);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const resp = await fetch(FN_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({
          action: "chat",
          broker_id: profile.id,
          client_relationship_id: rel.id,
          session_id: sessionId,
          message: text,
          conversation_history: history.map((m) => ({
            role: m.role === "broker" ? "user" : "assistant",
            content: m.content,
          })),
        }),
      });

      if (!resp.ok || !resp.body) {
        const errText = await resp.text();
        throw new Error(errText || `HTTP ${resp.status}`);
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let assistant = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf("\n")) !== -1) {
          let line = buffer.slice(0, nl);
          buffer = buffer.slice(nl + 1);
          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim();
          if (!payload || payload === "[DONE]") continue;
          try {
            const parsed = JSON.parse(payload);
            if (parsed.session_id && !sessionId) {
              setSessionId(parsed.session_id);
              if (rel.session_count === 0) {
                trackEvent("broker_session_start", "engagement", {
                  broker_id: profile.id,
                  relationship_id: rel.id,
                });
              }
            }
            // #11/#12 — parsed defensively; broker-paige-chat does not emit these today (§13 honest).
            if (parsed.paige_phase === "writing") { setWritingPhase(true); continue; }
            if (parsed.paige_compacting) { setCompacting(parsed.paige_compacting as CompactingSignal); continue; }
            if (parsed.delta) {
              if (!assistant) setWritingPhase(true); // #11 — first token → "Writing…"
              assistant += parsed.delta;
              setMessages((prev) => {
                const copy = [...prev];
                copy[copy.length - 1] = { role: "assistant", content: assistant };
                return copy;
              });
            }
          } catch {
            buffer = line + "\n" + buffer;
            break;
          }
        }
      }
    } catch (e: unknown) {
      console.error(e);
      toast({
        title: "Paige couldn't respond",
        description: e instanceof Error ? e.message : "Please try again.",
        variant: "destructive",
      });
      setMessages((prev) => prev.slice(0, -1));
    } finally {
      setStreaming(false);
    }
  };

  const saveNotes = async () => {
    if (!rel) return;
    setSavingNotes(true);
    const { error } = await supabase
      .from("broker_client_relationships")
      .update({
        broker_notes: notes.trim() || null,
        shared_goal: sharedGoal.trim() || null,
        relationship_stage: stage,
      })
      .eq("id", rel.id);
    setSavingNotes(false);
    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Saved", description: "Client notes updated." });
  };

  const generateSummary = async () => {
    if (!rel || !profile || !sessionId) {
      toast({ title: "Send a message first", description: "Start the conversation, then generate a summary." });
      return;
    }
    setGeneratingSummary(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const resp = await fetch(FN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({
          action: "summarize",
          broker_id: profile.id,
          client_relationship_id: rel.id,
          session_id: sessionId,
        }),
      });
      const body = await resp.json();
      if (!resp.ok) throw new Error(body?.error || "Summary failed");
      setSummary(body.summary || "");
      setSummaryOpen(true);
    } catch (e: unknown) {
      toast({ title: "Summary failed", description: e instanceof Error ? e.message : "Try again.", variant: "destructive" });
    } finally {
      setGeneratingSummary(false);
    }
  };

  const shareSummary = async () => {
    if (!rel || !sessionId || !summary) return;
    setSharing(true);
    try {
      // Mark on session row
      await supabase
        .from("broker_paige_sessions")
        .update({ summary_shared_at: new Date().toISOString() })
        .eq("id", sessionId);

      // In-app card via communication_log so the client sees it in their app
      if (rel.client_user_id) {
        await supabase.from("communication_log").insert({
          user_id: rel.client_user_id,
          channel: "in_app",
          message_type: "broker_session_summary",
          subject: `Notes from your broker at ${profile?.business_name || "your firm"}`,
          preview: summary.slice(0, 240),
          status: "delivered",
        });
      }

      // Email it via the transactional pipeline (best effort)
      try {
        await supabase.functions.invoke("send-transactional-email", {
          body: {
            templateName: "broker-client-invite", // reuse existing template as fallback container
            relationshipId: rel.id,
            idempotencyKey: `broker-summary-${sessionId}`,
            templateData: {
              firstName: rel.client_first_name,
              brokerBusinessName: profile?.business_name || "your broker",
              brokerReferralCode: profile?.referral_code || "",
              signupLink: "https://paigeagent.ai/app",
              customMessage: summary,
            },
          },
        });
      } catch (e) {
        console.warn("[broker session] email send failed (non-blocking)", e);
      }

      trackEvent("broker_summary_shared", "engagement", {
        session_id: sessionId,
        relationship_id: rel.id,
      });

      toast({ title: "Summary shared", description: `Sent to ${rel.client_first_name}.` });
      setSummaryOpen(false);
    } catch (e: unknown) {
      toast({ title: "Share failed", description: e instanceof Error ? e.message : "Try again.", variant: "destructive" });
    } finally {
      setSharing(false);
    }
  };

  const endSession = async () => {
    if (sessionId) {
      const durationSec = Math.round((Date.now() - sessionStartRef.current) / 1000);
      trackEvent("broker_session_end", "engagement", {
        session_id: sessionId,
        relationship_id: rel?.id,
        duration_seconds: durationSec,
        message_count: messages.filter((m) => m.role === "broker").length,
      });
      // Fire summary in the background
      void generateSummary();
    }
    navigate("/broker/app/sessions");
  };

  if (!rel) {
    return (
      <div className="p-8 flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading session…
      </div>
    );
  }

  const ContextPanel = (
    <div className="space-y-4">
      <div>
        <Label>Funding goal</Label>
        <p className="text-sm text-muted-foreground mt-1">{rel.client_goal || "Not specified"}</p>
      </div>
      <div>
        <Label>Credit scores</Label>
        <div className="flex gap-2 mt-1 text-sm">
          <Badge variant="outline">EQ {snapshot?.equifax ?? "—"}</Badge>
          <Badge variant="outline">EX {snapshot?.experian ?? "—"}</Badge>
          <Badge variant="outline">TU {snapshot?.transunion ?? "—"}</Badge>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="stage">Relationship stage</Label>
        <Select value={stage} onValueChange={setStage}>
          <SelectTrigger id="stage"><SelectValue /></SelectTrigger>
          <SelectContent>
            {Object.entries(STAGE_LABEL).map(([v, l]) => (
              <SelectItem key={v} value={v}>{l}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="shared-goal">Shared goal</Label>
        <Input
          id="shared-goal"
          value={sharedGoal}
          onChange={(e) => setSharedGoal(e.target.value)}
          placeholder="What you and the client are working toward"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="notes">Private broker notes</Label>
        <Textarea
          id="notes"
          rows={6}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Anything you want Paige to remember about this client…"
        />
      </div>
      <Button onClick={saveNotes} disabled={savingNotes} variant="outline" className="w-full">
        {savingNotes ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
        Save notes
      </Button>
      {rel.last_session_at && (
        <div className="text-xs text-muted-foreground border-t pt-3">
          Last session: {new Date(rel.last_session_at).toLocaleDateString()} • {rel.session_count} total
        </div>
      )}
    </div>
  );

  return (
    <div className="flex flex-col h-[calc(100vh-7rem)] -m-6">
      {/* Header */}
      <div className="border-b bg-card px-4 py-3 flex items-center justify-between gap-3 flex-shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <Button variant="ghost" size="sm" asChild>
            <Link to="/broker/app/clients">
              <ArrowLeft className="h-4 w-4" />
              <span className="hidden sm:inline ml-1">Clients</span>
            </Link>
          </Button>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="font-semibold truncate">
                {rel.client_first_name} {rel.client_last_name}
              </h1>
              <Badge variant="secondary">{STAGE_LABEL[stage] || "New"}</Badge>
            </div>
            <p className="text-xs text-muted-foreground truncate">
              Session #{rel.session_count + (sessionId ? 1 : 0)} • {profile?.business_name}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Mobile context drawer */}
          <Drawer>
            <DrawerTrigger asChild>
              <Button variant="outline" size="sm" className="lg:hidden">
                <Info className="h-4 w-4" />
              </Button>
            </DrawerTrigger>
            <DrawerContent>
              <DrawerHeader>
                <DrawerTitle>Client context</DrawerTitle>
                <DrawerDescription>
                  Private — only you and Paige see this.
                </DrawerDescription>
              </DrawerHeader>
              <div className="px-4 pb-6">{ContextPanel}</div>
            </DrawerContent>
          </Drawer>
        </div>
      </div>

      {/* Body: chat + side panel */}
      <div className="flex-1 flex min-h-0">
        {/* Chat */}
        <div className="flex-1 flex flex-col min-w-0">
          <div ref={scrollerRef} className="flex-1 overflow-y-auto p-4 space-y-4 bg-muted/20">
            {messages.map((m, i) => (
              <div
                key={i}
                className={`flex ${m.role === "broker" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm ${
                    m.role === "broker"
                      ? "bg-primary text-primary-foreground"
                      : "bg-card border"
                  }`}
                >
                  {m.role === "assistant" ? (
                    <div className="prose prose-sm dark:prose-invert max-w-none">
                      <ReactMarkdown>{m.content || (streaming ? "…" : "")}</ReactMarkdown>
                    </div>
                  ) : (
                    <p className="whitespace-pre-wrap">{m.content}</p>
                  )}
                </div>
              </div>
            ))}
            {/* #11 — the shared "Thinking… / Writing… Ns" indicator (replaces the bespoke line, §18).
                No thoughts/compacting frames stream from broker-paige-chat today, so the timer runs on
                client elapsed and the compacting card stays a no-op (§13). */}
            {streaming && (
              <div className="flex flex-col gap-2">
                <PaigeThinkingIndicator active={streaming} writing={writingPhase} personaName="Paige" />
                <PaigeCompactingCard signal={compacting} personaName="Paige" />
              </div>
            )}
          </div>

          {/* Action bar */}
          <div className="border-t bg-card px-4 py-2 flex flex-wrap items-center gap-2 text-xs flex-shrink-0">
            {permissions.can_share_summaries && (
              <Button
                size="sm"
                variant="outline"
                onClick={generateSummary}
                disabled={generatingSummary || !sessionId}
              >
                {generatingSummary ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <FileText className="h-3.5 w-3.5 mr-1" />}
                Generate client summary
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={endSession}>
              <StopCircle className="h-3.5 w-3.5 mr-1" />
              End session
            </Button>
            <span className="ml-auto text-muted-foreground hidden sm:inline">
              Private peer session — client cannot see this conversation
            </span>
          </div>

          {/* Input — hidden for assistants (read-only) */}
          {teamMemberRole === "assistant" ? (
            <div className="border-t bg-muted/30 px-4 py-3 text-sm text-muted-foreground text-center flex-shrink-0">
              Assistants can view session history but cannot run new sessions.
            </div>
          ) : (
            <div className="border-t bg-background p-3 flex gap-2 flex-shrink-0">
              <Textarea
                rows={1}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={`Ask Paige about ${rel.client_first_name}'s credit strategy, funding options, or next steps…`}
                className="resize-none min-h-[44px] max-h-32"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    sendMessage();
                  }
                }}
                disabled={streaming}
              />
              <Button onClick={sendMessage} disabled={streaming || !input.trim()}>
                {streaming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </div>
          )}
        </div>

        {/* Desktop side panel */}
        <aside className="hidden lg:block w-80 border-l bg-card overflow-y-auto p-4">
          <Card className="border-0 shadow-none">
            <CardHeader className="px-0 pt-0">
              <CardTitle className="text-base">Client context</CardTitle>
            </CardHeader>
            <CardContent className="px-0 pb-0">{ContextPanel}</CardContent>
          </Card>
        </aside>
      </div>

      {/* Summary preview dialog */}
      <Dialog open={summaryOpen} onOpenChange={setSummaryOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Client-ready summary</DialogTitle>
            <DialogDescription>
              Preview what {rel.client_first_name} will receive — by email and in their PaigeAgent dashboard.
            </DialogDescription>
          </DialogHeader>
          <div className="prose prose-sm dark:prose-invert max-w-none max-h-[50vh] overflow-y-auto border rounded-md p-4 bg-muted/30">
            {summary ? <ReactMarkdown>{summary}</ReactMarkdown> : <p className="text-muted-foreground">No summary generated yet.</p>}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSummaryOpen(false)}>Cancel</Button>
            {permissions.can_share_summaries && (
              <Button onClick={shareSummary} disabled={sharing || !summary}>
                {sharing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Share2 className="h-4 w-4 mr-2" />}
                Share with client
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default BrokerPaigeSession;
