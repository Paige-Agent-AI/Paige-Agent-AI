import { useRef, useCallback, useLayoutEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

interface SessionMemoryScope {
  actorId: string;
  tenantId: string | null;
  clientId: string | null;
  enabled: boolean;
}
interface MemoryLifetime {
  key: string;
  valid: boolean;
  requests: Set<AbortController>;
}

interface DocumentSummary {
  fileName: string;
  summary: string;
}

/**
 * Hook that manages within-session document context and cross-session memory.
 * - Stores document analysis summaries for follow-up questions
 * - Triggers session summary generation on session end
 */
export function usePaigeMemory(scope: SessionMemoryScope) {
  const sessionDocuments = useRef<DocumentSummary[]>([]);
  const sessionStartTime = useRef<number>(Date.now());
  const lastActivityTime = useRef<number>(Date.now());
  const inactivityTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scopeKey = JSON.stringify([scope.actorId, scope.tenantId, scope.clientId, scope.enabled]);
  const lifetimeRef = useRef<MemoryLifetime>({ key: scopeKey, valid: true, requests: new Set() });
  if (lifetimeRef.current.key !== scopeKey) {
    lifetimeRef.current = { key: scopeKey, valid: true, requests: new Set() };
  }
  const lifetime = lifetimeRef.current;
  useLayoutEffect(() => {
    lifetime.valid = true;
    return () => {
      lifetime.valid = false;
      for (const request of lifetime.requests) request.abort();
      lifetime.requests.clear();
    };
  }, [lifetime]);

  // Extract a compressed summary from Paige's analysis response
  const extractDocumentSummary = useCallback((analysisText: string, fileName: string) => {
    // Try to extract <document_summary> block if present
    const summaryMatch = analysisText.match(/<document_summary>([\s\S]*?)<\/document_summary>/);
    
    let summary: string;
    if (summaryMatch) {
      summary = summaryMatch[1].trim();
    } else {
      // Build a compressed summary from the analysis text (max ~500 tokens ≈ ~2000 chars)
      const lines = analysisText.split('\n').filter(l => l.trim());
      const importantLines: string[] = [];
      let charCount = 0;
      
      for (const line of lines) {
        // Prioritize lines with scores, numbers, account names
        if (
          /score|fico|equifax|experian|transunion|\d{3,}/i.test(line) ||
          /negative|collection|late|charge.off|inquiry|discrepanc/i.test(line) ||
          /positive|good standing|current|utilization/i.test(line) ||
          /action|priority|dispute/i.test(line)
        ) {
          if (charCount + line.length < 2000) {
            importantLines.push(line.replace(/\*\*/g, '').trim());
            charCount += line.length;
          }
        }
      }
      
      summary = importantLines.join('\n') || analysisText.substring(0, 2000);
    }

    const docSummary: DocumentSummary = { fileName, summary };
    sessionDocuments.current = [...sessionDocuments.current, docSummary];
    return docSummary;
  }, []);

  // Get current session document context for inclusion in API calls
  const getSessionDocumentContext = useCallback(() => {
    return sessionDocuments.current.length > 0 ? sessionDocuments.current : undefined;
  }, []);

  // Reset activity timer
  const trackActivity = useCallback(() => {
    lastActivityTime.current = Date.now();
  }, []);

  // Generate session summary and store in client_memory
  const generateSessionSummary = useCallback(async (
    messages: Array<{ role: string; content: string }>,
    sessionId?: string
  ) => {
    if (messages.length < 3) return; // Not enough conversation to summarize
    const deadline = Date.now() + 35_000;
    const controller = new AbortController();
    const current = () => {
      if (Date.now() >= deadline) controller.abort();
      return scope.enabled && lifetime.valid && lifetimeRef.current === lifetime && !controller.signal.aborted;
    };
    if (!current() || !scope.actorId || (!scope.tenantId && !scope.clientId)) return null;
    // Copy before the first await; a delayed callback may never borrow a later
    // transcript, auth session or focused view, including an A→B→A transition.
    const transcript = messages.slice(-20).map(message => ({ role: message.role as "user" | "assistant", content: message.content }));
    lifetime.requests.add(controller);
    const timer = setTimeout(() => controller.abort(), 35_000);
    let onAbort!: () => void;
    const cancelled = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(new DOMException("Summary cancelled", "AbortError"));
      controller.signal.addEventListener("abort", onAbort, { once: true });
    });
    const within = <T,>(work: PromiseLike<T>): Promise<T> => Promise.race([Promise.resolve(work), cancelled]);
    try {
      // §13 — THIS SENT `Bearer undefined` ON EVERY CALL. The object it read the token from was
      // `{ user: { id: __uid } }`, built locally two lines above; it has no `access_token`, so the
      // template produced the literal string "undefined" and `paige-ai-chat` rejected every request
      // with 401. The catch below logs and returns, so the failure was silent and the session
      // summary this hook exists to write has never been written from this path.
      //
      // The real token comes from the session, which is also the only thing that makes the request
      // attributable to a person at all. Absent session → return rather than send an unauthenticated
      // request that cannot succeed.
      const { data: { session } } = await within(supabase.auth.getSession());
      const accessToken = session?.access_token;
      if (!current() || controller.signal.aborted || !accessToken || session.user.id !== scope.actorId) return null;
      const { data: { user }, error } = await within(supabase.auth.getUser());
      if (!current() || controller.signal.aborted || error || user?.id !== scope.actorId) return null;

      const response = await within(fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/paige-ai-chat`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          signal: controller.signal,
          body: JSON.stringify({
            messages: [{ role: "user", content: "summarize" }],
            generateSessionSummary: true,
            sessionMessages: transcript,
            sessionId,
            ...(scope.clientId ? { clientId: scope.clientId } : {}),
            sessionMemoryScope: { v: 1, actor_id: scope.actorId, tenant_id: scope.tenantId, client_id: scope.clientId },
          }),
        }
      ));
      return current() && !controller.signal.aborted ? response : null;
    } catch (err) {
      if (!controller.signal.aborted) console.error("Session summary generation failed:", err);
      return null;
    } finally {
      clearTimeout(timer);
      controller.signal.removeEventListener("abort", onAbort);
      lifetime.requests.delete(controller);
    }
  }, [lifetime, scope.actorId, scope.tenantId, scope.clientId, scope.enabled]);

  // Clear session data
  const resetSession = useCallback(() => {
    lifetime.valid = false;
    for (const request of lifetime.requests) request.abort();
    lifetime.requests.clear();
    lifetimeRef.current = { key: scopeKey, valid: true, requests: new Set() };
    sessionDocuments.current = [];
    sessionStartTime.current = Date.now();
    lastActivityTime.current = Date.now();
  }, [lifetime, scopeKey]);

  return {
    extractDocumentSummary,
    getSessionDocumentContext,
    trackActivity,
    generateSessionSummary,
    resetSession,
  };
}
