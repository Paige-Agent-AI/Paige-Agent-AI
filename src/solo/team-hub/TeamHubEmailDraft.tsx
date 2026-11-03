import { useEffect, useId, useRef, useState } from "react";
import { FileText, Check, AlertCircle, ChevronRight } from "lucide-react";
import { CustomerSelector } from "@/components/paige/CustomerSelector";
import type { FocusedClient } from "@/components/paige/commandCenterTypes";
import { CheckLinks } from "@/components/chat/CheckLinks";
import { workspaceLinkTarget, type WorkspaceLinkTenant } from "@/lib/links/workspaceLinks";
import type { NexusEmailDraft, NexusEmailDraftAnswer, NexusEmailDraftRequest, NexusEmailSavedReference } from "../../../supabase/functions/_shared/team-hub/nexus-email-contract";
import { nexusEmailDraftHref } from "./team-hub-email-links";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function TeamHubEmailDraft({ draft, account, act }: {
  draft: NexusEmailDraft;
  account: WorkspaceLinkTenant | null | undefined;
  act: (request: NexusEmailDraftRequest, signal?: AbortSignal) => Promise<NexusEmailDraftAnswer>;
}) {
  const subjectId = useId(), senderId = useId();
  const [expanded, setExpanded] = useState(false);
  const [senders, setSenders] = useState<ReadonlyArray<{ connector_id: string; from_address: string }> | null>(null);
  const [recipient, setRecipient] = useState<FocusedClient | null>(null);
  const [connectorId, setConnectorId] = useState(draft.connectorId ?? "");
  const [state, setState] = useState<"idle" | "loading" | "saving" | "checking" | "unknown" | "refused" | "unavailable">("idle");
  const [savedResult, setSavedResult] = useState<NexusEmailSavedReference | null>(null);
  const pending = useRef<AbortController | null>(null), alive = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; pending.current?.abort(); }; }, []);
  const saved = draft.saved ?? savedResult;
  const bound = !!draft.contactId || state === "unknown";
  const busy = state === "loading" || state === "saving" || state === "checking";
  const selectedContact = draft.contactId ?? recipient?.id;
  const selectedSender = draft.connectorId ?? connectorId;
  const run = async (intent: "save" | "check" | "inspect") => {
    if (pending.current || intent === "save" && (!selectedContact || !selectedSender)) return;
    const controller = new AbortController(); pending.current = controller;
    setState(intent === "save" ? "saving" : intent === "check" ? "checking" : "loading");
    const result = await act({ messageId: draft.messageId, intent,
      ...(intent === "save" ? { contactId: selectedContact!, connectorId: selectedSender } : {}) }, controller.signal)
      .catch(() => ({ ok: false, outcome: intent === "inspect" ? "unavailable" : "unknown" } as NexusEmailDraftAnswer));
    if (pending.current === controller) pending.current = null;
    if (!alive.current) return;
    if (result.outcome === "saved" && result.result) { setSavedResult(result.result); setState("idle"); }
    else if (result.outcome === "available" && result.senders) {
      setSenders(result.senders); setConnectorId(value => value || (result.senders!.length === 1 ? result.senders![0].connector_id : "")); setState("idle");
    } else setState(result.outcome === "unknown" ? "unknown" : result.outcome === "refused" ? "refused" : "unavailable");
  };
  const effective = { ...draft, contactId: draft.contactId ?? recipient?.id ?? null };
  const href = saved ? nexusEmailDraftHref(effective, saved, account) : null;
  const settings = workspaceLinkTarget({ destination: "conversations", record_id: null }, account)?.to;
  return <div className="th-email-draft" role="group" aria-labelledby={subjectId}>
    <details open={expanded} onToggle={event => {
      const open = event.currentTarget.open; setExpanded(open);
      if (!open && (state === "saving" || state === "checking")) { pending.current?.abort(); setState("unknown"); }
    }}>
      <summary className="th-email-summary" aria-label={`Review email draft: ${draft.preparation.subject}`}><FileText aria-hidden="true" /><span id={subjectId}>{draft.preparation.subject}</span><ChevronRight aria-hidden="true" /></summary>
      <div className="th-email-body">{draft.preparation.body}</div>
      {saved ? <p className="th-email-help">Original preparation. Open the saved draft to see any later edits.</p>
        : bound ? <p className="th-email-help">This request keeps the same recipient and email account. Check its saved status before making another request.</p>
          : <div className="th-email-fields">
            {senders === null ? <button type="button" className="th-btn" disabled={busy} onClick={() => void run("inspect")}>{busy ? "Loading email accounts…" : "Choose recipient and email account"}</button>
              : senders.length === 0 ? <p className="th-email-help" role="status">No permitted email account is available here. Open Messages to check your email setup.</p>
                : <>
                  <fieldset disabled={busy}><legend>To</legend>
                    {recipient && <p className="th-email-recipient">{recipient.name}{recipient.email ? ` · ${recipient.email}` : " · Email address needed"}</p>}
                    <CustomerSelector tenantId={draft.tenantId} scopeKey={draft.actorId} onSelect={setRecipient} />
                  </fieldset>
                  <label htmlFor={senderId}>From</label>
                  <Select value={connectorId} disabled={busy} onValueChange={setConnectorId}>
                    <SelectTrigger id={senderId}><SelectValue placeholder="Choose an email account" /></SelectTrigger>
                    <SelectContent>{senders.map(sender => <SelectItem key={sender.connector_id} value={sender.connector_id}>{sender.from_address}</SelectItem>)}</SelectContent>
                  </Select>
                  <p className="th-email-help">Save this selected text in Messages, where the email account’s access rules apply. It will not be sent.</p>
                </>}
          </div>}
    </details>
    <div className="th-email-footer">
      {saved ? <><span className="th-email-status"><Check aria-hidden="true" />Saved unsent in Messages</span>{href && <CheckLinks links={[{ label: "Open draft", to: href }]} />}</>
        : bound ? <>
          <button type="button" className="th-btn" disabled={busy} onClick={() => void run("check")}>{state === "checking" ? "Checking…" : "Check saved status"}</button>
          {state === "unknown" && selectedContact && selectedSender && <button type="button" className="th-btn" disabled={busy} onClick={() => void run("save")}>Retry same save</button>}
        </> : senders && senders.length > 0 && <button type="button" className="th-btn" disabled={busy || !recipient?.email || !connectorId}
          onClick={() => void run("save")}>{state === "saving" ? "Saving…" : "Save unsent email"}</button>}
      {!saved && senders?.length === 0 && settings && <CheckLinks links={[{ label: "Open Messages", to: settings }]} />}
    </div>
    {!saved && (state === "unknown" || state === "refused" || state === "unavailable") && <p className="th-email-feedback" role="status">
      <AlertCircle aria-hidden="true" />{state === "unknown" ? "The save isn’t confirmed. Check its status; retrying here keeps the same request."
        : state === "refused" ? "This request couldn’t save the draft. Check the recipient and email account, then try again."
          : "Email draft details aren’t available right now. Try again when your connection is ready."}
    </p>}
  </div>;
}
