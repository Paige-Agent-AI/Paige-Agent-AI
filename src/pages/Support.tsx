import { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { useClientPortalBrandState } from "@/hooks/useClientPortalBrand";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LifeBuoy, Lightbulb, MessageSquarePlus, ArrowUp, AlertTriangle } from "lucide-react";
import { NewTicketDialog } from "@/components/support/NewTicketDialog";
import { ClientTicketThread } from "@/components/support/ClientTicketThread";
import { NewFeatureRequestDialog } from "@/components/support/NewFeatureRequestDialog";
import {
  TICKET_STATUS_LABEL, TICKET_STATUS_STYLES, FEATURE_STATUS_LABEL, FEATURE_STATUS_STYLES,
  ticketCategoryLabel, featureCategoryLabel, timeAgo, PRIORITY_STYLES,
  type TicketStatus, type TicketPriority, type FeatureStatus,
} from "@/components/support/supportTypes";
import { toast } from "sonner";

interface TicketRow {
  id: string;
  ticket_number: string;
  subject: string;
  category: string;
  status: TicketStatus;
  priority: TicketPriority;
  created_at: string;
  updated_at: string;
}

interface FeatureRow {
  id: string;
  title: string;
  description: string;
  category: string;
  status: FeatureStatus;
  vote_count: number;
  admin_response: string | null;
  planned_release: string | null;
  created_at: string;
}

type FeatureFilter = "all" | "voted" | "recent" | "planned" | "shipped";

/**
 * /app/support is Paige's PLATFORM help desk + feature board, for business owners and
 * staff. A customer of ONE business never lands here (E09 owner decision): their help
 * comes from that business, so they are sent to "Contact your team" in their portal
 * thread. A customer of more than one business keeps this desk until picking a business
 * exists (Slice 8). Nothing platform-side renders until the relationship has resolved.
 */
export default function Support() {
  const { brand, loading, error, multipleBusinesses } = useClientPortalBrandState();
  if (loading) {
    return (
      <div role="status" aria-busy="true" className="max-w-5xl mx-auto p-6 space-y-4">
        <span className="sr-only">Loading support…</span>
        <Skeleton className="h-8 w-48 motion-reduce:animate-none" />
        <Skeleton className="h-32 w-full motion-reduce:animate-none" />
      </div>
    );
  }
  // Only a customer of exactly ONE business has a business thread to send help to. A customer of
  // several keeps this desk until choosing a business exists: their help page would otherwise be one
  // that cannot send anything.
  if (brand?.tenant_id && !multipleBusinesses) return <Navigate to="/app/messages?topic=help" replace />;
  if (error) {
    return (
      <div role="alert" className="max-w-xl mx-auto space-y-3 py-12 text-center">
        <p className="text-sm font-medium">We couldn't check your account</p>
        <p className="text-sm text-muted-foreground">Reload the page to try again.</p>
        <Button variant="outline" onClick={() => window.location.reload()}>Reload</Button>
      </div>
    );
  }
  return <PlatformSupportDesk />;
}

function PlatformSupportDesk() {
  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [features, setFeatures] = useState<FeatureRow[]>([]);
  const [myVotes, setMyVotes] = useState<Set<string>>(new Set());
  const [loadingTickets, setLoadingTickets] = useState(true);
  const [loadingFeatures, setLoadingFeatures] = useState(true);

  const [newTicketOpen, setNewTicketOpen] = useState(false);
  const [newFeatureOpen, setNewFeatureOpen] = useState(false);
  const [activeTicketId, setActiveTicketId] = useState<string | null>(null);
  const [filter, setFilter] = useState<FeatureFilter>("all");

  useEffect(() => {
    void (async () => {
      const { data } = await supabase.auth.getUser();
      if (data.user) {
        setUserId(data.user.id);
        setUserEmail(data.user.email ?? null);
      }
    })();
  }, []);

  useEffect(() => {
    if (!userId) return;
    void loadTickets();
    void loadFeatures();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const loadTickets = async () => {
    if (!userId) return;
    setLoadingTickets(true);
    const { data } = await supabase
      .from("support_tickets")
      .select("id,ticket_number,subject,category,status,priority,created_at,updated_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    setTickets((data ?? []) as TicketRow[]);
    setLoadingTickets(false);
  };

  const loadFeatures = async () => {
    if (!userId) return;
    setLoadingFeatures(true);
    const [{ data: rows }, { data: votes }] = await Promise.all([
      supabase
        .from("feature_requests")
        .select("id,title,description,category,status,vote_count,admin_response,planned_release,created_at")
        .neq("status", "declined")
        .order("vote_count", { ascending: false }),
      supabase
        .from("feature_request_votes")
        .select("feature_request_id")
        .eq("user_id", userId),
    ]);
    setFeatures((rows ?? []) as FeatureRow[]);
    setMyVotes(new Set((votes ?? []).map((v: { feature_request_id: string }) => v.feature_request_id)));
    setLoadingFeatures(false);
  };

  const toggleVote = async (id: string) => {
    if (!userId) return;
    const has = myVotes.has(id);
    try {
      if (has) {
        await supabase.from("feature_request_votes").delete()
          .eq("feature_request_id", id).eq("user_id", userId);
      } else {
        await supabase.from("feature_request_votes").insert({
          feature_request_id: id, user_id: userId,
        });
      }
      // Optimistic — trigger keeps vote_count in sync
      void loadFeatures();
    } catch (err) {
      toast.error((err as { message?: string } | null)?.message || "Could not update vote");
    }
  };

  const filteredFeatures = useMemo(() => {
    let list = [...features];
    switch (filter) {
      case "voted":
        list.sort((a, b) => b.vote_count - a.vote_count);
        break;
      case "recent":
        list.sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));
        break;
      case "planned":
        list = list.filter((f) => f.status === "planned" || f.status === "in_progress");
        break;
      case "shipped":
        list = list.filter((f) => f.status === "shipped");
        break;
      default:
        list.sort((a, b) => b.vote_count - a.vote_count);
    }
    return list;
  }, [features, filter]);

  if (!userId) {
    return <div className="p-8 text-muted-foreground">Sign in to access support.</div>;
  }

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <LifeBuoy className="w-7 h-7 text-accent" /> Support & Feedback
        </h1>
        <p className="text-muted-foreground mt-1">
          Get help from our team or shape what we build next.
        </p>
      </div>

      <Tabs defaultValue="help" className="w-full">
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="help" className="gap-2">
            <LifeBuoy className="w-4 h-4" /> Get Help
          </TabsTrigger>
          <TabsTrigger value="feedback" className="gap-2">
            <Lightbulb className="w-4 h-4" /> Share Feedback
          </TabsTrigger>
        </TabsList>

        {/* GET HELP */}
        <TabsContent value="help" className="space-y-6 pt-6">
          <Card className="p-6 border-border">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <h2 className="text-xl font-semibold">How can we help you?</h2>
                <p className="text-muted-foreground text-sm mt-1">
                  Our team typically responds within 24 hours. For urgent issues use the priority flag.
                </p>
              </div>
              <Button onClick={() => setNewTicketOpen(true)} className="gap-2">
                <MessageSquarePlus className="w-4 h-4" /> New Support Request
              </Button>
            </div>
          </Card>

          <Card className="border-border">
            <div className="p-4 border-b border-border">
              <h3 className="font-semibold">My Tickets</h3>
            </div>

            {loadingTickets ? (
              <div className="p-6 text-sm text-muted-foreground">Loading tickets...</div>
            ) : tickets.length === 0 ? (
              <div className="p-10 text-center">
                <LifeBuoy className="w-10 h-10 mx-auto mb-3 text-muted-foreground/50" />
                <p className="font-medium">No support tickets yet.</p>
                <p className="text-sm text-muted-foreground mt-1">
                  If you run into any issues or have questions, our team is here to help.
                </p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[110px]">Ticket</TableHead>
                    <TableHead>Subject</TableHead>
                    <TableHead className="hidden md:table-cell">Category</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="hidden lg:table-cell">Created</TableHead>
                    <TableHead className="hidden lg:table-cell">Updated</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tickets.map((t) => (
                    <TableRow
                      key={t.id}
                      className="cursor-pointer"
                      onClick={() => setActiveTicketId(t.id)}
                    >
                      <TableCell className="font-mono text-xs">{t.ticket_number}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{t.subject}</span>
                          {t.priority === "urgent" && (
                            <Badge variant="outline" className={PRIORITY_STYLES.urgent}>
                              <AlertTriangle className="w-3 h-3 mr-1" /> Urgent
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        <Badge variant="outline">{ticketCategoryLabel(t.category)}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={TICKET_STATUS_STYLES[t.status]}>
                          {TICKET_STATUS_LABEL[t.status]}
                        </Badge>
                      </TableCell>
                      <TableCell className="hidden lg:table-cell text-xs text-muted-foreground">
                        {timeAgo(t.created_at)}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell text-xs text-muted-foreground">
                        {timeAgo(t.updated_at)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>
        </TabsContent>

        {/* SHARE FEEDBACK */}
        <TabsContent value="feedback" className="space-y-6 pt-6">
          <Card className="p-6 border-border">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <h2 className="text-xl font-semibold">Help shape PaigeAgent</h2>
                <p className="text-muted-foreground text-sm mt-1">
                  Your feedback directly influences what we build next. Submit ideas and vote on features you want most.
                </p>
              </div>
              <Button onClick={() => setNewFeatureOpen(true)} className="gap-2">
                <Lightbulb className="w-4 h-4" /> Submit an Idea
              </Button>
            </div>
          </Card>

          <Tabs value={filter} onValueChange={(v) => setFilter(v as FeatureFilter)}>
            <TabsList>
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="voted">Most Voted</TabsTrigger>
              <TabsTrigger value="recent">Recently Added</TabsTrigger>
              <TabsTrigger value="planned">Planned</TabsTrigger>
              <TabsTrigger value="shipped">Shipped</TabsTrigger>
            </TabsList>
          </Tabs>

          {loadingFeatures ? (
            <div className="text-sm text-muted-foreground">Loading feature requests...</div>
          ) : filteredFeatures.length === 0 ? (
            <Card className="p-10 text-center border-border">
              <Lightbulb className="w-10 h-10 mx-auto mb-3 text-muted-foreground/50" />
              <p className="font-medium">No feature requests yet.</p>
              <p className="text-sm text-muted-foreground mt-1">
                Be the first to share an idea — your suggestions directly shape what gets built next.
              </p>
            </Card>
          ) : (
            <div className="space-y-3">
              {filteredFeatures.map((f) => {
                const voted = myVotes.has(f.id);
                return (
                  <Card key={f.id} className="p-4 border-border">
                    <div className="flex gap-4">
                      <button
                        onClick={() => toggleVote(f.id)}
                        className={`flex flex-col items-center justify-center min-w-[60px] py-2 px-3 rounded-md border transition-colors ${
                          voted
                            ? "bg-accent/10 border-accent text-accent"
                            : "bg-muted/30 border-border hover:border-accent/50"
                        }`}
                      >
                        <ArrowUp className={`w-4 h-4 ${voted ? "" : "text-muted-foreground"}`} />
                        <span className="text-sm font-bold tabular-nums mt-0.5">{f.vote_count}</span>
                      </button>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h4 className="font-semibold">{f.title}</h4>
                          <Badge variant="outline" className={FEATURE_STATUS_STYLES[f.status]}>
                            {FEATURE_STATUS_LABEL[f.status]}
                          </Badge>
                          <Badge variant="outline">{featureCategoryLabel(f.category)}</Badge>
                          {f.planned_release && (
                            <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-500/30">
                              {f.planned_release}
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{f.description}</p>

                        {f.admin_response && (
                          <div className="mt-3 rounded-md border border-accent/30 bg-accent/5 p-3">
                            <div className="text-[11px] font-bold uppercase tracking-wider text-accent mb-1">
                              PaigeAgent Team
                            </div>
                            <p className="text-sm text-foreground whitespace-pre-wrap">{f.admin_response}</p>
                          </div>
                        )}

                        <div className="flex items-center gap-2 text-xs text-muted-foreground mt-2">
                          <span>Submitted by a PaigeAgent member</span>
                          <span>•</span>
                          <span>{timeAgo(f.created_at)}</span>
                        </div>
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <NewTicketDialog
        open={newTicketOpen}
        onOpenChange={setNewTicketOpen}
        userId={userId}
        userEmail={userEmail}
        onCreated={loadTickets}
      />
      <NewFeatureRequestDialog
        open={newFeatureOpen}
        onOpenChange={setNewFeatureOpen}
        userId={userId}
        onCreated={loadFeatures}
      />
      <ClientTicketThread
        ticketId={activeTicketId}
        userId={userId}
        open={!!activeTicketId}
        onOpenChange={(o) => !o && setActiveTicketId(null)}
        onTicketUpdated={loadTickets}
      />
    </div>
  );
}
