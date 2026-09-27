import { useState, useRef, useEffect, useCallback, useMemo, useLayoutEffect } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Send, Loader2, Paperclip } from "lucide-react";
import paigeAvatar from "@/assets/paige-ai-avatar.png";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { parsePaigeChatError } from "@/lib/paigeChatError";
import { useNavigate, useLocation } from "react-router-dom";
import { getCurrentPageName, getPageOpeningInstruction } from "@/lib/pageContext";
import type { User, Session } from "@supabase/supabase-js";
import { DictationMicButton } from "@/components/voice/DictationMicButton";
import { appendDictation } from "@/lib/voice/useDictation";
import { useChatDocumentUpload } from "@/hooks/useChatDocumentUpload";
import { useBeforeUnloadGuard } from "@/hooks/useBeforeUnloadGuard";
import { usePaigeMemory } from "@/hooks/usePaigeMemory";
import { useClientChatContext } from "@/hooks/useClientChatContext";
import { DocumentAttachmentChip } from "@/components/chat/DocumentAttachmentChip";
import { DocumentMessageBubble } from "@/components/chat/DocumentMessageBubble";
import { MarkdownMessage } from "@/components/chat/MarkdownMessage";
import { EntityDiagramCard } from "@/components/chat/EntityDiagramCard";
import { extractEntityDiagram } from "@/lib/entityDiagram";
import { RootCauseCard, extractRootCauseAnalysis } from "@/components/chat/RootCauseCard";
import { SyncStatusPanel, type SyncStatus } from "@/components/chat/SyncStatusPanel";
import { useQueryClient } from "@tanstack/react-query";
import { useIsMobile } from "@/hooks/use-mobile";
import { getUserClock } from "@/lib/userClock";
import { ExtractionProposalCard, type ExtractionProposal } from "@/components/chat/ExtractionProposalCard";
import { extractFromMessage } from "@/lib/conversationalExtractor";
import { fieldToWriteBackUpdate } from "@/lib/extractionProposal";
import { useProfileSnapshot } from "@/hooks/useProfileSnapshot";
import { trackEvent } from "@/hooks/useAnalytics";
import { usePlaybook } from "@/lib/playbook";
import { useClientPortalBrandState } from "@/hooks/useClientPortalBrand";
import { readableTextOn } from "@/lib/brand/contrast";
import { PaigeReasoningStrip, upsertStep, type PaigeStep } from "@/components/dashboard/PaigeStepTrace";
import { PaigeThinkingIndicator } from "@/components/paige/chat/PaigeThinkingIndicator";
import { createAnchoredTranscriptScroll } from "@/components/chat/anchoredTranscriptScroll";

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  documentFileName?: string;
  syncStatus?: SyncStatus;
  /** Inline extraction proposal rendered as a confirmation card after this message. */
  extractionProposal?: ExtractionProposal;
};

const safeMessageId = (): string => {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  } catch { /* fall through */ }
  return `m-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

const mkMessage = (message: Omit<Message, "id"> & Partial<Pick<Message, "id">>): Message => ({
  ...message,
  id: message.id ?? safeMessageId(),
});

interface PaigeChatProps {
  user: User;
  session: Session | null;
  clientId?: string;
}

function PaigeChatInner({ user, session, clientId }: PaigeChatProps) {
  // Persona + quick actions come from the tenant's active Playbook (doctrine
  // §7/§8) so the client-facing Paige is native to the tenant's practice — not
  // a hardcoded credit/funding script. Defaults to neutral coaching today.
  const playbook = usePlaybook();
  const quickActions = playbook.quickActions;
  // The chat header wears the TENANT's brand, not a hardcoded Paige face (§6/§9).
  // Same resolver the /app chrome uses (get_client_portal_brand); `loading` gates
  // a skeleton so the Paige avatar never flashes before the tenant's resolves.
  const { brand: portalBrand, loading: portalBrandLoading } = useClientPortalBrandState();
  const { contextBlock, isLoading: contextLoading, hasCreditData } = useClientChatContext(clientId, clientId ? null : user.id);
  // Snapshot of profile/business fields used by the conversational extractor
  // to skip already-populated values. Refreshed after every successful save.
  const { snapshot: profileSnapshot, refresh: refreshProfileSnapshot } = useProfileSnapshot(user.id);
  // Tracks fields a client has explicitly declined in this session so we don't
  // re-prompt them with the same proposal again.
  const declinedFieldsRef = useRef<Set<string>>(new Set());
  const contextInjectedRef = useRef(false);
  const isMobile = useIsMobile();
  const location = useLocation();
  const dictationScopeEpoch = [
    user.id,
    clientId ?? "",
    location.pathname,
    location.search ?? "",
  ].join("|");

  // Page awareness — derive human-readable page name from current route.
  // Tracked in a ref so the latest value is always included in outgoing
  // requests without requiring a re-render of the chat panel.
  const currentPage = useMemo(() => getCurrentPageName(location.pathname), [location.pathname]);
  const currentPageRef = useRef(currentPage);
  useEffect(() => {
    currentPageRef.current = currentPage;
  }, [currentPage]);

  // Build the contextBlock with the current_page line prepended.
  // Used inside async send handlers so they always see the latest page
  // even if the user navigates mid-chat.
  const buildContextWithPage = useCallback(
    (block: string) => {
      const page = currentPageRef.current;
      if (!block) return `Current page: ${page}`;
      return `Current page: ${page}\n\n${block}`;
    },
    []
  );

  const [messages, setMessages] = useState<Message[]>([
    mkMessage({ role: "assistant", content: playbook.persona.greeting }),
  ]);
  const [input, setInput] = useState("");
  const [dictationActivity, setDictationActivity] = useState({
    epoch: dictationScopeEpoch,
    active: false,
  });
  const dictationActive =
    dictationActivity.epoch === dictationScopeEpoch && dictationActivity.active;
  const handleDictationActivity = useCallback((active: boolean) => {
    setDictationActivity({ epoch: dictationScopeEpoch, active });
  }, [dictationScopeEpoch]);
  const [isLoading, setIsLoading] = useState(false);
  // Paige's live reasoning trace (#95/#125) — the "watch her work" steps she streams.
  const [steps, setSteps] = useState<PaigeStep[]>([]);
  // #11 — true once the first answer token arrives this turn (label flips Thinking→Writing).
  const [writingPhase, setWritingPhase] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const { toast } = useToast();
  // This surface does not hydrate durable message IDs after a remount. Scope its
  // scroll record to this mounted conversation so a stale ID can never strand a
  // fresh transcript in an incorrectly unpinned state.
  const transcriptSessionKeyRef = useRef(`paige-normal-transcript-position-v1:${safeMessageId()}`);
  const transcriptScrollRef = useRef<ReturnType<typeof createAnchoredTranscriptScroll> | null>(null);
  if (!transcriptScrollRef.current) {
    transcriptScrollRef.current = createAnchoredTranscriptScroll({
      storagePrefix: transcriptSessionKeyRef.current,
    });
  }
  const transcriptContext = `${user.id}:${clientId ?? "self"}`;
  const setTranscriptElement = useCallback((node: HTMLDivElement | null) => {
    transcriptScrollRef.current?.attach(node);
  }, []);
  const syncTranscriptPosition = useCallback(() => {
    transcriptScrollRef.current?.handleScroll();
  }, []);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const sessionIdRef = useRef<string>(crypto.randomUUID());

  // When context loads, send a context-aware, PAGE-AWARE opening via the AI
  useEffect(() => {
    if (contextInjectedRef.current || contextLoading || messages.length !== 1) return;
    if (!contextBlock) return;

    if (!hasCreditData) {
      contextInjectedRef.current = true;
      setMessages([mkMessage({ role: "assistant", content: playbook.persona.greeting })]);
      return;
    }

    contextInjectedRef.current = true;
    (async () => {
      try {
        const { data: { session: freshSession } } = await supabase.auth.getSession();
        if (!freshSession) return;

        // Detect fresh sign-in: auth session created within the last 2 minutes.
        // Supabase issues `expires_at` (epoch seconds) and tokens last ~1h, so
        // session age = 3600 - (expires_at - now). If that's < 120s, the user
        // just signed in and Paige should give a warm "welcome back."
        const nowSec = Math.floor(Date.now() / 1000);
        const expiresAt = (freshSession as { expires_at?: number }).expires_at;
        const sessionAgeSec = expiresAt ? Math.max(0, 3600 - (expiresAt - nowSec)) : 9999;
        const freshSignIn = sessionAgeSec < 120;

        setIsLoading(true);
        const firstName = (user.user_metadata?.full_name || "").split(" ")[0] || undefined;
        const pageInstruction = getPageOpeningInstruction(currentPageRef.current, firstName, freshSignIn);
        const greetMessages = [{ role: "user" as const, content: pageInstruction }];

        // Inject a session-age line into the context so Paige's system prompt
        // can also see this signal independently of the user-message instruction.
        const sessionLine = freshSignIn
          ? `Session: client just signed in (${sessionAgeSec}s ago) — give a warm "welcome back" greeting, do NOT recite dashboard data on the opener.`
          : `Session: client is mid-session (signed in ${Math.floor(sessionAgeSec / 60)}m ago).`;
        const contextWithSession = `${sessionLine}\n\n${buildContextWithPage(contextBlock)}`;

        const response = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/paige-ai-chat`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${freshSession.access_token}` },
            body: JSON.stringify({
              messages: greetMessages,
              clientContext: contextWithSession,
              ...(clientId ? { clientId } : {}),
              ...getUserClock(),
            }),
          }
        );

        if (!response.ok) { setIsLoading(false); return; }

        const reader = response.body?.getReader();
        const decoder = new TextDecoder();
        let greeting = "";

        while (reader) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value);
          for (const line of chunk.split("\n")) {
            if (!line.startsWith("data: ")) continue;
            const data = line.slice(6).trim();
            if (data === "[DONE]") continue;
            try {
              const parsed = JSON.parse(data);
              const content = parsed.choices?.[0]?.delta?.content;
              if (content) greeting += content;
            } catch { /* skip */ }
          }
        }

        if (greeting.trim()) {
          setMessages([mkMessage({ role: "assistant", content: greeting.trim() })]);
        }
        setIsLoading(false);
      } catch {
        setIsLoading(false);
      }
    })();
  }, [clientId, contextBlock, contextLoading, hasCreditData, messages.length, user, buildContextWithPage]);
  const inactivityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const {
    extractDocumentSummary,
    getSessionDocumentContext,
    trackActivity,
    generateSessionSummary,
    resetSession,
  } = usePaigeMemory();

  const {
    attachedDoc,
    isProcessingFile,
    isDragOver,
    fileInputRef,
    handleFileSelect,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    removeAttachment,
    openFilePicker,
    setAttachedDoc,
  } = useChatDocumentUpload();
  useBeforeUnloadGuard(input.trim().length > 0 || attachedDoc !== null || isProcessingFile || isLoading);

  useEffect(() => {
    const handleFactoryReset = () => {
      contextInjectedRef.current = false;
      resetSession();
      setInput("");
      transcriptScrollRef.current?.jumpToBottom("auto");
      setMessages([mkMessage({ role: "assistant", content: playbook.persona.greeting })]);
    };

    window.addEventListener("paige-factory-reset", handleFactoryReset);
    return () => window.removeEventListener("paige-factory-reset", handleFactoryReset);
  }, [resetSession, playbook.persona.greeting]);

  useLayoutEffect(() => {
    transcriptScrollRef.current?.setContext(transcriptContext);
  }, [transcriptContext]);

  useLayoutEffect(() => {
    transcriptScrollRef.current?.notifyLayoutChange();
  }, [messages, steps, isLoading, writingPhase]);

  const resetInactivityTimer = useCallback(() => {
    trackActivity();
    if (inactivityTimerRef.current) clearTimeout(inactivityTimerRef.current);
    inactivityTimerRef.current = setTimeout(() => {
      if (messages.length > 2) {
        generateSessionSummary(
          messages.map(m => ({ role: m.role, content: m.content })),
          sessionIdRef.current
        );
      }
    }, 30 * 60 * 1000);
  }, [messages, trackActivity, generateSessionSummary]);

  useEffect(() => {
    return () => {
      if (inactivityTimerRef.current) clearTimeout(inactivityTimerRef.current);
      if (messages.length > 2) {
        generateSessionSummary(
          messages.map(m => ({ role: m.role, content: m.content })),
          sessionIdRef.current
        );
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Confirm a conversational extraction proposal — POST selected fields to
   * paige-write-back, then refresh the local profile snapshot so the extractor
   * stops re-detecting them. Throws on failure so the card can show the error.
   */
  const handleExtractionConfirm = async (proposal: ExtractionProposal, selectedKeys: string[]) => {
    const selected = proposal.fields.filter(f => selectedKeys.includes(f.key));
    if (selected.length === 0) return;

    const { data: { session: freshSession } } = await supabase.auth.getSession();
    if (!freshSession) throw new Error("Session expired — please sign in again.");

    const { data, error } = await supabase.functions.invoke("paige-write-back", {
      body: {
        updates: selected.map(fieldToWriteBackUpdate),
        source: "conversation",
      },
      headers: { Authorization: `Bearer ${freshSession.access_token}` },
    });
    if (error) throw error;

    const failed = (data?.results || []).filter((r: { success?: boolean; error?: string }) => !r.success);
    if (failed.length > 0 && failed.length === selected.length) {
      throw new Error(failed[0]?.error || "Save failed.");
    }
    if (failed.length > 0) {
      toast({
        title: "Saved with warnings",
        description: `${failed.length} field${failed.length === 1 ? "" : "s"} could not be saved.`,
      });
    }
    // Refresh snapshot so the extractor will skip these fields next time.
    await refreshProfileSnapshot();
    queryClient.invalidateQueries({ queryKey: ["client-chat-context"] });
  };

  const handleExtractionSkip = (proposal: ExtractionProposal) => {
    // Remember declined fields so we don't re-prompt for them this session.
    for (const f of proposal.fields) declinedFieldsRef.current.add(f.key);
  };

  const handleSend = async (overrideInput?: string) => {
    if (dictationActive) return;
    const messageText = overrideInput || input;
    if ((!messageText.trim() && !attachedDoc) || isLoading) return;

    resetInactivityTimer();

    const userMessage = mkMessage({ role: "user", content: messageText.trim() || (attachedDoc ? `Analyze this document: ${attachedDoc.name}` : ""), documentFileName: attachedDoc?.name });
    const isFirstUserMessage = messages.every((m) => m.role !== "user");
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput("");

    if (isFirstUserMessage) {
      void trackEvent("paige_session_start", "engagement", { page: currentPageRef.current });
      void trackEvent("first_paige_message", "activation", { page: currentPageRef.current });
    }
    void trackEvent("paige_message_sent", "engagement", {
      has_attachment: !!attachedDoc,
      page: currentPageRef.current,
    });

    // Blur input on mobile to dismiss keyboard after sending
    if (isMobile && inputRef.current) {
      inputRef.current.blur();
    }

    const currentDoc = attachedDoc;
    setAttachedDoc(null);
    setIsLoading(true);

    try {
      const { data: { session: freshSession } } = await supabase.auth.getSession();

      if (!freshSession) {
        toast({ title: "Session Expired", description: "Please sign in again.", variant: "destructive" });
        setMessages(messages);
        setIsLoading(false);
        return;
      }

      const payload: Record<string, unknown> = {
        messages: newMessages.map(m => ({
          role: m.role,
          content: m.content,
          ...(m.documentFileName ? { documentFileName: m.documentFileName } : {}),
        })),
        sessionDocumentContext: getSessionDocumentContext(),
        ...(clientId ? { clientId } : {}),
        ...getUserClock(),
        // Always include current_page even if there's no credit context block yet,
        // so Paige can still tailor responses to the section the client is viewing.
        clientContext: buildContextWithPage(contextBlock || ""),
      };

      if (currentDoc) {
        payload.document = {
          base64: currentDoc.base64,
          fileName: currentDoc.name,
          mimeType: "application/pdf",
        };
      }

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/paige-ai-chat`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${freshSession.access_token}`,
          },
          body: JSON.stringify(payload),
        }
      );

      if (!response.ok) {
        if (response.status === 429) {
          toast({ title: "Rate Limit Reached", description: "Please wait a moment.", variant: "destructive" });
          setMessages(messages);
          setIsLoading(false);
          return;
        }
        // #587 — surface the structured { code, reason, recommendation } from the server (e.g. a
        // size/page limit) rather than a generic "Failed to send message" toast.
        const chatErr = await parsePaigeChatError(response);
        toast({ title: chatErr.title, description: chatErr.description, variant: "destructive" });
        setMessages(messages);
        setIsLoading(false);
        return;
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let assistantMessage = "";
      let textBuffer = "";
      let streamDone = false;
      let syncStatus: SyncStatus | null = null;
      // The server withheld this turn's answer (its text read as internal) and sent one fixed sentence
      // instead. That sentence is not an account of the attached document, so it is never kept as one.
      let answerWithheld = false;
      const assistantId = safeMessageId();

      setMessages([...newMessages, mkMessage({ id: assistantId, role: "assistant", content: "" })]);
      setSteps([]); // clear last turn's reasoning as this one starts
      setWritingPhase(false); // #11 — back to "Thinking…" until the first token this turn

      while (reader && !streamDone) {
        const { done, value } = await reader.read();
        if (done) break;

        textBuffer += decoder.decode(value, { stream: true });

        let newlineIndex: number;
        while ((newlineIndex = textBuffer.indexOf("\n")) !== -1) {
          let line = textBuffer.slice(0, newlineIndex);
          textBuffer = textBuffer.slice(newlineIndex + 1);

          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (line.startsWith(":") || line.trim() === "") continue;
          if (!line.startsWith("data: ")) continue;

          const jsonStr = line.slice(6).trim();
          if (jsonStr === "[DONE]") { streamDone = true; break; }

          try {
            const parsed = JSON.parse(jsonStr);
            if (parsed.paige_step) {
              // Live "watch her work" frame — upsert into the reasoning strip.
              setSteps((prev) => upsertStep(prev, parsed.paige_step as PaigeStep));
              continue;
            }
            // #11 — the server confirmed the reply is starting (belt-and-braces with the first delta).
            if (parsed.paige_phase === "writing") { setWritingPhase(true); continue; }
            if (parsed.sync_status) {
              syncStatus = parsed.sync_status;
              continue;
            }
            if (parsed.paige_withheld === true) { answerWithheld = true; continue; }
            const content = parsed.choices?.[0]?.delta?.content as string | undefined;
            if (content) {
              if (!assistantMessage) setWritingPhase(true); // #11 — first token → "Writing…"
              assistantMessage += content;
              setMessages([...newMessages, mkMessage({ id: assistantId, role: "assistant", content: assistantMessage })]);
            }
          } catch {
            textBuffer = line + "\n" + textBuffer;
            break;
          }
        }
      }

      if (currentDoc && !answerWithheld && assistantMessage.length > 100) {
        extractDocumentSummary(assistantMessage, currentDoc.name);

        if (syncStatus) {
          setMessages(prev => [
            ...prev,
            mkMessage({ role: "assistant", content: "", syncStatus }),
          ]);
          queryClient.invalidateQueries({ queryKey: ["credit-factors"] });
          queryClient.invalidateQueries({ queryKey: ["credit-factors-history"] });
          queryClient.invalidateQueries({ queryKey: ["funding-matches"] });
          queryClient.invalidateQueries({ queryKey: ["funding-matches-profile-scores"] });
          queryClient.invalidateQueries({ queryKey: ["funding-projections"] });
          // Score inputs changed — refresh fundability so the dashboard
          // doesn't keep displaying the pre-upload number.
          queryClient.invalidateQueries({ queryKey: ["three-fundability-inputs"] });
          queryClient.invalidateQueries({ queryKey: ["funding-readiness-supplemental"] });
        }
      }

      // Run conversational extractor against the user message AFTER the assistant
      // reply renders. Attach an inline confirmation card to the last assistant message.
      if (!currentDoc && messageText.trim()) {
        try {
          const proposal = extractFromMessage(messageText, profileSnapshot);
          if (proposal) {
            const filteredFields = proposal.fields.filter(
              (f) => !declinedFieldsRef.current.has(f.key)
            );
            if (filteredFields.length > 0) {
              const finalProposal: ExtractionProposal = { ...proposal, fields: filteredFields };
              setMessages(prev => {
                const next = [...prev];
                for (let i = next.length - 1; i >= 0; i--) {
                  if (next[i].role === "assistant") {
                    next[i] = { ...next[i], extractionProposal: finalProposal };
                    return next;
                  }
                }
                next.push(mkMessage({ role: "assistant", content: "", extractionProposal: finalProposal }));
                return next;
              });
            }
          }
        } catch (err) {
          console.warn("Conversational extractor failed:", err);
        }
      }

      setIsLoading(false);
    } catch (error) {
      console.error("Chat error:", error);
      toast({ title: "Error", description: "Failed to send message. Please try again.", variant: "destructive" });
      setMessages(messages);
      setIsLoading(false);
    }
  };

  // Header avatar, resolved to the tenant brand (§6): tenant logo → tenant/persona
  // monogram on a brand-tinted plate → Paige avatar ONLY when there is no tenant
  // brand at all (staff / neutral default). Skeleton while the brand resolves so
  // the Paige face never flashes and swaps to the tenant's.
  const brandName = portalBrand?.tenant_name?.trim() || null;
  const brandLogo = portalBrand?.logo_url?.trim() || null;
  const brandColor = portalBrand?.primary_color?.trim() || null;
  const personaName = playbook.persona.name?.trim() || null;
  const avatarLabel = brandName || personaName || "Assistant";
  const monogram = (brandName || personaName || "?").charAt(0).toUpperCase();
  const headerAvatar = portalBrandLoading ? (
    <span
      className="w-8 h-8 sm:w-9 sm:h-9 rounded-full border-2 border-border bg-muted animate-pulse flex-shrink-0"
      aria-hidden="true"
    />
  ) : brandLogo ? (
    <img
      src={brandLogo}
      alt={avatarLabel}
      className="w-8 h-8 sm:w-9 sm:h-9 rounded-full border-2 border-accent object-cover flex-shrink-0"
    />
  ) : portalBrand ? (
    <span
      className={`inline-flex w-8 h-8 sm:w-9 sm:h-9 items-center justify-center rounded-full border-2 border-accent text-sm font-semibold flex-shrink-0 ${
        brandColor ? "" : "bg-sidebar-accent text-primary-foreground"
      }`}
      style={brandColor ? { backgroundColor: brandColor, color: readableTextOn(brandColor) } : undefined}
      aria-label={avatarLabel}
    >
      {monogram}
    </span>
  ) : (
    <img src={paigeAvatar} alt="Paige" className="w-8 h-8 sm:w-9 sm:h-9 rounded-full border-2 border-accent flex-shrink-0" />
  );

  return (
    <div
      className={`flex flex-col h-full bg-card border-r border-border relative ${isDragOver ? "ring-2 ring-primary ring-inset" : ""}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragOver && (
        <div className="absolute inset-0 bg-primary/10 z-10 flex items-center justify-center pointer-events-none">
          <div className="bg-card border-2 border-dashed border-primary rounded-xl px-6 py-4 text-center">
            <p className="text-sm font-medium text-primary">Drop PDF here to attach</p>
          </div>
        </div>
      )}

      <input ref={fileInputRef} type="file" accept="application/pdf" onChange={handleFileSelect} className="hidden" />

      {/* Header — compact on mobile */}
      <div className="px-3 sm:px-4 py-2 sm:py-3 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-2 sm:gap-3">
          {headerAvatar}
          <div className="flex-1 min-w-0">
            <h2 className="font-bold text-foreground text-sm capitalize">{playbook.persona.name}</h2>
            <p className="text-[10px] sm:text-[11px] text-muted-foreground truncate capitalize">{playbook.persona.role}</p>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div ref={setTranscriptElement} data-paige-transcript-scroll="true" aria-label="PAIGE conversation" tabIndex={0} onScroll={syncTranscriptPosition} className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-3 sm:space-y-4">
        {messages.map((message) => (
          <div key={message.id} data-paige-message-id={message.id} className={`flex gap-2 sm:gap-3 ${message.role === "user" ? "flex-row-reverse" : "flex-row"}`}>
            {message.role === "assistant" && (
              <img src={paigeAvatar} alt="Paige" className="w-7 h-7 sm:w-8 sm:h-8 rounded-full border border-accent flex-shrink-0" />
            )}
            <div className={`max-w-[88%] sm:max-w-[85%] rounded-lg px-3 py-2 sm:px-3.5 sm:py-2.5 ${message.role === "user" ? "bg-accent text-accent-foreground" : "bg-muted/40 border border-border"}`}>
              {message.documentFileName && <DocumentMessageBubble fileName={message.documentFileName} />}
              {message.content && (
                message.role === "assistant" ? (() => {
                  // Two-stage extraction: root-cause card first, then entity diagram in remainder.
                  const rc = extractRootCauseAnalysis(message.content);
                  const remainder = rc.analysis ? `${rc.before}\n\n${rc.after}`.trim() : message.content;
                  const { before, diagram, after } = extractEntityDiagram(remainder);
                  return (
                    <>
                      {before && <MarkdownMessage content={before} />}
                      {diagram && <EntityDiagramCard data={diagram} />}
                      {after && <MarkdownMessage content={after} />}
                      {rc.analysis && <RootCauseCard data={rc.analysis} />}
                    </>
                  );
                })() : (
                  <p className="text-[13px] sm:text-sm leading-relaxed whitespace-pre-wrap">
                    {message.content}
                  </p>
                )
              )}
              {message.syncStatus && <SyncStatusPanel syncStatus={message.syncStatus} />}
              {message.extractionProposal && (
                <ExtractionProposalCard
                  proposal={message.extractionProposal}
                  onConfirm={(selectedKeys) => handleExtractionConfirm(message.extractionProposal!, selectedKeys)}
                  onSkip={() => handleExtractionSkip(message.extractionProposal!)}
                />
              )}
            </div>
          </div>
        ))}
        {/* #11 — the shared "Thinking… / Writing… Ns" indicator (replaces the bespoke typing dots,
            §18/§25). Shows for a real turn only (not the auto-opener), aligned under the avatar.
            NON-persisting portal → no compacting card (§13 — it never folds). */}
        {isLoading && messages.some((m) => m.role === "user") && (
          <div className="flex gap-2 sm:gap-3">
            <img src={paigeAvatar} alt="Paige" className="w-7 h-7 sm:w-8 sm:h-8 rounded-full border border-accent flex-shrink-0" />
            <PaigeThinkingIndicator
              active={isLoading}
              writing={writingPhase}
              thoughts={steps.filter((s) => s.kind === "thought").map((s) => ({ id: s.id, label: s.label }))}
              personaName={playbook?.persona?.name}
            />
          </div>
        )}
      </div>

      {/* Paige's live reasoning — the "watch her work" strip (#95/#125), now on the
          primary /app surface. Shows an "on watch" resting pill when idle. */}
      <div className="px-3 sm:px-4 pt-1 flex-shrink-0">
        <PaigeReasoningStrip steps={steps} loading={isLoading} personaName={playbook?.persona?.name} />
      </div>

      {/* Quick actions — horizontally scrollable on mobile */}
      <div className="px-3 sm:px-4 pb-1.5 sm:pb-2 flex-shrink-0">
        <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-1">
          {quickActions.map((action) => (
            <button
              key={action.label}
              onClick={() => handleSend(action.prompt)}
              disabled={isLoading || dictationActive}
              className="text-[10px] sm:text-[11px] px-2.5 py-1 rounded-full border border-border bg-background hover:bg-accent/10 hover:border-accent/40 text-muted-foreground hover:text-gold-dark transition-colors disabled:opacity-50 whitespace-nowrap flex-shrink-0"
            >
              {action.label}
            </button>
          ))}
        </div>
      </div>

      {attachedDoc && (
        <div className="px-3 pt-1.5 flex-shrink-0">
          <DocumentAttachmentChip fileName={attachedDoc.name} onRemove={removeAttachment} />
        </div>
      )}

      {/* Input area — safe area padding on mobile */}
      <div className="p-2 sm:p-3 border-t border-border space-y-2 flex-shrink-0 pb-[env(safe-area-inset-bottom,8px)]">
        <div className="flex gap-1.5 sm:gap-2 items-center">
          <Button variant="ghost" size="icon" className="h-9 w-9 sm:h-9 sm:w-9 flex-shrink-0 text-muted-foreground hover:text-primary" onClick={openFilePicker} disabled={isLoading} title="Attach a document (PDF)">
            <Paperclip className="w-4 h-4" />
          </Button>
          <Textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            placeholder={attachedDoc ? "Add a message or send document... (Shift+Enter for new line)" : "Ask Paige anything... (Shift+Enter for new line)"}
            rows={1}
            className="flex-1 text-sm min-h-[40px] max-h-[200px] resize-none py-2"
            disabled={isLoading}
          />
          {/* Tap-to-dictate — neutral/indigo mic (never gold; Send owns the act, §11).
              Dictated words append into the composer for the client to edit + send. */}
          <DictationMicButton
            scopeEpoch={dictationScopeEpoch}
            composerRef={inputRef}
            onText={(seg, insertionPoint) => setInput((prev) => appendDictation(prev, seg, insertionPoint))}
            onActiveChange={handleDictationActivity}
            onError={(msg) => toast({ title: "Voice typing", description: msg, variant: "destructive" })}
            disabled={isLoading}
            variant="secondary"
            className={`flex-shrink-0 ${isMobile ? "h-10 w-10" : "h-9 w-9"}`}
          />
          <Button onClick={() => handleSend()} disabled={isLoading || dictationActive || (!input.trim() && !attachedDoc)} className="bg-gradient-gold hover:opacity-90 h-10 w-10" size="icon">
            {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function PaigeChat(props: PaigeChatProps) {
  return <PaigeChatInner {...props} />;
}
