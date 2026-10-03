// One Vibe Studio project (owner-locked layout C, 2026-10-03): the conversation with Paige on the
// left, the work itself on the stage, every saved version along the bottom, and one Publish. The
// owner never picks an artifact type: Paige decides from the brief, and the project holds whatever
// she builds. Pending image approvals for this project surface here, beside the conversation.
import React from "react";
import { ArrowLeft, Monitor, Smartphone, MessageSquare, SlidersHorizontal, ArrowUp, Check, AlertCircle } from "lucide-react";
import { Logo } from "../_shared";
import { buildGrowthBrandFloor } from "@/components/growth/growth-theme";
import { useMediaJobs } from "../useMediaJobs";
import { formFromRow, isUnnamed, sessionName, loadBrand, openSession, pageFromRow, plainError, renameSession, type ArtifactRef, type StudioSession as Session, type StudioVersion } from "./studio-data";
import { MarkdownMessage } from "@/components/chat/MarkdownMessage";
import { useStudioChat, type Choices } from "./useStudioChat";
import { StudioStage } from "./StudioStage";
import { artifactId, loadArtifact, hasPendingChanges, isLive, type Brand, type Device, type LoadedArtifact } from "./artifact-state";
import { PublishPanel } from "./PublishPanel";
import { FormSettings } from "./FormSettings";
import { Timeline } from "./Timeline";

const KIND_WORD: Record<ArtifactRef["kind"], string> = { form: "Form", page: "Page", funnel: "Funnel", content: "Content" };

function AskCard({ choices, disabled, onAnswer }: { choices: Choices; disabled: boolean; onAnswer: (value: string, display: string) => void }) {
  const [picked, setPicked] = React.useState<string[]>([]);
  React.useEffect(() => { setPicked([]); }, [choices]);
  const toggle = (v: string) => setPicked((p) => (choices.multi ? (p.includes(v) ? p.filter((x) => x !== v) : [...p, v]) : [v]));
  const chosen = choices.options.filter((o) => picked.includes(o.value));
  return (
    <div className="vs-ask" role="group" aria-label={choices.prompt || "Paige has a question"}>
      {choices.prompt && <b>{choices.prompt}</b>}
      <div className="vs-ask-options">
        {choices.options.map((o) => (
          <button key={o.value} type="button" aria-pressed={picked.includes(o.value)} disabled={disabled} onClick={() => toggle(o.value)}>
            {o.label}{o.description && <small>{o.description}</small>}
          </button>
        ))}
      </div>
      <div className="vs-ask-foot">
        <button type="button" className="vs-btn vs-btn-violet" disabled={disabled || chosen.length === 0}
          onClick={() => onAnswer(chosen.map((o) => o.value).join(", "), chosen.map((o) => o.label).join(", "))}>
          {choices.multi ? "Use these" : "Use this"}
        </button>
        <button type="button" className="vs-link" disabled={disabled} onClick={() => onAnswer("Use your best guess for that and carry on.", "Use your best guess")}>
          Skip, use your best guess
        </button>
      </div>
    </div>
  );
}

export function StudioSession({ tenantId, tenantSlug, sessionId, seedBrief, onBack }: {
  tenantId: string; tenantSlug: string; sessionId: string; seedBrief: string | null; onBack: () => void;
}) {
  const [session, setSession] = React.useState<Session | null>(null);
  const [sessionError, setSessionError] = React.useState<string | null>(null);
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [artifact, setArtifact] = React.useState<LoadedArtifact | null>(null);
  const [artifactError, setArtifactError] = React.useState<string | null>(null);
  const [brand, setBrand] = React.useState<Brand>({ floor: buildGrowthBrandFloor(null), name: null, logoUrl: null });
  const [device, setDevice] = React.useState<Device>("desktop");
  const [publishOpen, setPublishOpen] = React.useState(false);
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [chatOpen, setChatOpen] = React.useState(false);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [refreshKey, setRefreshKey] = React.useState(0);
  const [previewing, setPreviewing] = React.useState<StudioVersion | null>(null);
  const [input, setInput] = React.useState("");
  const logRef = React.useRef<HTMLDivElement | null>(null);
  const inputRef = React.useRef<HTMLTextAreaElement | null>(null);
  const publishBtnRef = React.useRef<HTMLButtonElement | null>(null);

  const refs = session?.artifacts ?? [];
  // Until it is named, a project is called by what was asked for.
  const displayTitle = session ? sessionName(session) : "Project";
  const activeRef = refs.find((r) => r.id === activeId) ?? refs[0] ?? null;

  const named = React.useRef<string | null>(null);
  const renameFailed = React.useRef(false);
  const reloadSession = React.useCallback(async (select?: string) => {
    try {
      let s = await openSession(sessionId);
      // A project nobody named takes the name of the first thing Paige saves in it.
      const first = s.artifacts.find((r) => r.id === select) ?? s.artifacts[0];
      // A project is still unnamed while its name is a placeholder or just the brief it started from
      // (Studio home titles a new project with its brief).
      const placeholder = isUnnamed(s.title) || (!!s.seedBrief && s.title.trim() === s.seedBrief.trim().replace(/\s+/g, " ").slice(0, 60));
      if (placeholder && named.current) {
        // A reload that read the row before the rename landed keeps the name already given.
        s = { ...s, title: named.current };
      } else if (placeholder && first && !isUnnamed(first.title) && !renameFailed.current) {
        // Two reloads end a turn (the produced piece and the turn itself); only one names it.
        named.current = first.title.trim();
        try {
          await renameSession(sessionId, named.current);
          s = { ...s, title: named.current };
        } catch (e) {
          // Only the creator or an admin may rename; anyone else keeps the brief as the name. Say so
          // once and stop retrying on every reload.
          console.warn("[studio] project rename refused:", e);
          named.current = null; renameFailed.current = true;
        }
      }
      setSession(s);
      if (select) setActiveId(select);
    } catch (e) {
      setSessionError(plainError(e, "This project couldn't be opened."));
    }
  }, [sessionId]);

  React.useEffect(() => { void reloadSession(); }, [reloadSession]);
  React.useEffect(() => { void loadBrand(tenantSlug).then(setBrand); }, [tenantSlug]);

  React.useEffect(() => {
    let live = true;
    setArtifactError(null);
    if (!activeRef) { setArtifact(null); return; }
    // Never leave the previous piece on the stage (and under Publish) while another one loads.
    setArtifact((a) => (a && artifactId(a) === activeRef.id ? a : null));
    loadArtifact(activeRef)
      .then((a) => { if (live) setArtifact(a); })
      .catch((e) => { if (live) { setArtifact(null); setArtifactError(plainError(e, "This piece couldn't be loaded.")); } });
    return () => { live = false; };
  }, [activeRef?.id, activeRef?.kind, refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const chat = useStudioChat({
    sessionId,
    seedBrief,
    canvas: activeRef ? { kind: activeRef.kind, id: activeRef.id } : null,
    onArtifact: (a) => { void reloadSession(a.id); },
    // A turn can link pieces without a produced-artifact frame (a page's form, a document), so the
    // manifest is re-read after every turn as well as the stage.
    onTurnDone: () => { setRefreshKey((k) => k + 1); void reloadSession(); },
  });

  // Images Paige starts in this project run as media jobs: approvals land here, and a finished image
  // is filed onto the project by the server, so a completed job means the manifest changed.
  const media = useMediaJobs();
  const sessionJobs = React.useMemo(
    () => media.jobs.filter((j) => (j.params as Record<string, unknown> | null)?.studio_session_id === sessionId),
    [media.jobs, sessionId],
  );
  const pendingApprovals = sessionJobs.filter((j) => j.state === "blocked" && j.approval_state === "pending");
  const finishedIds = sessionJobs.filter((j) => j.state === "succeeded" && j.content_id).map((j) => String(j.content_id)).join(",");
  React.useEffect(() => {
    if (!finishedIds || !session) return;
    const missing = finishedIds.split(",").find((id) => !session.artifacts.some((r) => r.id === id));
    if (missing) void reloadSession(missing);
  }, [finishedIds, session, reloadSession]);

  // On a narrow screen the chat is a drawer: it opens whenever Paige asks something or is working,
  // so her question is never hidden behind a closed panel.
  const waitingCount = chat.confirms.filter((c) => !c.state).length;
  React.useEffect(() => { if (chat.choices || chat.sending || waitingCount) setChatOpen(true); }, [chat.choices, chat.sending, waitingCount]);
  // Opening a project puts focus in the conversation (the card that opened it is gone).
  React.useEffect(() => { if (chat.ready) inputRef.current?.focus({ preventScroll: true }); }, [chat.ready]);

  React.useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [chat.turns, chat.steps, chat.choices, chat.confirms.length, pendingApprovals.length]);

  // Esc steps back out of the project, unless the owner has typed something or a panel is open (each
  // panel closes itself first).
  React.useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "SELECT" || t.isContentEditable)) return;
      if (t && (t.tagName === "TEXTAREA" || t.tagName === "INPUT") && (t as HTMLInputElement).value.trim()) return;
      if (publishOpen) { setPublishOpen(false); publishBtnRef.current?.focus(); return; }
      if (settingsOpen) { setSettingsOpen(false); return; }
      if (chatOpen) { setChatOpen(false); return; }
      onBack();
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onBack, publishOpen, settingsOpen, chatOpen]);

  const submit = () => {
    const text = input.trim();
    if (!text || chat.sending || !chat.ready) return;
    setInput("");
    void chat.send(text);
  };

  // A picked version shows on the stage from its own snapshot until the owner goes back to it or
  // picks again. Forms and pages carry everything needed; other kinds say so honestly.
  const previewArtifact: LoadedArtifact | null = (() => {
    if (!previewing?.snapshot || !artifact) return null;
    if (artifact.kind === "form") return { kind: "form", form: formFromRow(previewing.snapshot) };
    if (artifact.kind === "page") return { kind: "page", page: pageFromRow(previewing.snapshot) };
    return null;
  })();

  const live = artifact ? isLive(artifact) : false;
  const pending = artifact ? hasPendingChanges(artifact) : false;
  const saveState = chat.sending ? { tone: "busy", text: chat.status ?? "Paige is building" }
    : !artifact ? (chat.preview ? { tone: "idle", text: chat.confirms.some((c) => !c.state) ? "Designed · waiting for your approval" : "Designed · not saved" } : { tone: "idle", text: "Nothing built yet" })
    : live ? (pending ? { tone: "good", text: "Saved · changes not live yet" } : { tone: "good", text: "Live" })
    : { tone: "good", text: "Saved · draft" };
  const publishLabel = live ? (pending ? "Publish changes" : "Live · Manage") : "Publish";

  const lastAssistant = (() => { for (let i = chat.turns.length - 1; i >= 0; i--) if (chat.turns[i].role === "assistant") return i; return -1; })();

  if (sessionError) {
    return (
      <div className="vs-session" style={{ gridTemplateRows: "54px 1fr" }}>
        <div className="vs-top"><button type="button" className="vs-icon-btn" aria-label="Back to Studio" onClick={onBack}><ArrowLeft size={17} /></button></div>
        <div className="vs-stage-empty" role="alert"><b>This project couldn't be opened</b>{sessionError}</div>
      </div>
    );
  }

  return (
    <div className="vs-session">
      <header className="vs-top">
        <button type="button" className="vs-icon-btn" aria-label="Back to Studio" onClick={onBack}><ArrowLeft size={17} /></button>
        <button type="button" className="vs-btn vs-chat-toggle" aria-expanded={chatOpen} onClick={() => setChatOpen((o) => !o)}><MessageSquare size={15} aria-hidden="true" />{chatOpen ? "Hide chat" : "Chat"}</button>
        <nav className="vs-crumbs" aria-label="Project">
          <span className="vs-crumb-studio">Studio /</span>
          <b className="vs-trunc" style={{ maxWidth: 260 }} title={displayTitle}>{displayTitle}</b>
          {refs.length > 1 ? (
            <>
              <span aria-hidden="true">/</span>
              <select aria-label="Piece in this project" value={activeRef?.id ?? ""} onChange={(e) => setActiveId(e.target.value)}>
                {refs.map((r) => <option key={r.id} value={r.id}>{r.title} · {KIND_WORD[r.kind]}</option>)}
              </select>
            </>
          ) : activeRef && activeRef.title !== session?.title ? <><span aria-hidden="true">/</span><span className="vs-trunc" style={{ maxWidth: 220, color: "var(--vs-text)" }}>{activeRef.title}</span></> : null}
          <span className="vs-status" data-tone={saveState.tone} role="status" aria-live="polite" style={{ marginLeft: 8 }}>{saveState.text}</span>
        </nav>
        <div className="vs-top-actions">
          {artifact?.kind === "form" && (
            <button type="button" className="vs-btn" aria-pressed={settingsOpen} onClick={() => setSettingsOpen((o) => !o)}><SlidersHorizontal size={14} />Form settings</button>
          )}
          <div className="vs-seg" role="group" aria-label="Preview size">
            <button type="button" aria-pressed={device === "desktop"} aria-label="Desktop" onClick={() => setDevice("desktop")}><Monitor size={14} /></button>
            <button type="button" aria-pressed={device === "phone"} aria-label="Phone" onClick={() => setDevice("phone")}><Smartphone size={14} /></button>
          </div>
          <button
            ref={publishBtnRef}
            type="button"
            className={live && !pending ? "vs-btn" : "vs-btn vs-btn-gold"}
            disabled={!artifact || chat.sending}
            aria-expanded={publishOpen}
            aria-haspopup="dialog"
            onClick={() => setPublishOpen((o) => !o)}
          >
            {live && !pending && <Check size={14} />}{publishLabel}
          </button>
        </div>
        {publishOpen && artifact && (
          <PublishPanel
            artifact={artifact}
            onClose={() => { setPublishOpen(false); publishBtnRef.current?.focus(); }}
            onDone={(m) => { setNotice(m); setRefreshKey((k) => k + 1); }}
          />
        )}
      </header>

      <div className="vs-body">
        <section className="vs-chat" aria-label="Chat with Paige" data-open={chatOpen}>
          <div className="vs-chat-log" ref={logRef}>
            {chat.loadError && <p className="vs-alert" role="alert">{chat.loadError}</p>}
            {!chat.ready && !chat.loadError && <p className="vs-inspector-note" role="status">Opening the conversation…</p>}
            {chat.turns.map((t, i) => t.role === "user" ? (
              <div key={i} className="vs-msg-you">{t.content}</div>
            ) : (
              <div key={i}>
                {(t.content || (i === lastAssistant && chat.sending && chat.steps.length === 0)) && (
                  <div className="vs-msg-paige">
                    <Logo size={16} />
                    {t.content ? <MarkdownMessage content={t.content} className="vs-md" /> : <p>{chat.status ?? "Working on it…"}</p>}
                  </div>
                )}
                {i === lastAssistant && chat.steps.length > 0 && (
                  <ol className="vs-steps" aria-label="What Paige did">
                    {chat.steps.map((s) => (
                      <li key={s.id}>
                        {s.status === "error" ? <AlertCircle size={14} color="var(--vs-bad)" aria-label="Didn't work" /> : <Check size={14} color="var(--vs-good)" aria-label="Done" />}
                        <span>{s.label}{s.detail && <small>{s.detail}</small>}</span>
                        <time>{new Date(s.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</time>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            ))}
            {chat.choices && <AskCard choices={chat.choices} disabled={chat.sending} onAnswer={(v, d) => void chat.send(v, { display: d })} />}
            {chat.confirms.map((c) => (
              <div key={c.fingerprint} className="vs-confirm" data-state={c.state ?? "waiting"} role="group" aria-label={c.state ? "Your decision" : "Paige is waiting for your approval"}>
                <b>{!c.state ? "Waiting for your approval" : c.state === "declined" ? "Skipped" : c.state === "sent" ? "Approved" : c.state === "ran" ? "Done" : c.state === "not_run" ? "Didn't run" : "Not confirmed"}</b>
                <span>{c.summary}</span>
                {!c.state ? (
                  <div className="vs-confirm-actions">
                    <button type="button" className="vs-btn vs-btn-violet" disabled={chat.sending} onClick={() => void chat.decide(c.fingerprint, true)}>Approve</button>
                    <button type="button" className="vs-btn vs-btn-quiet" disabled={chat.sending} onClick={() => void chat.decide(c.fingerprint, false)}>Not this</button>
                  </div>
                ) : c.state === "sent" ? (
                  <small role="status">Paige is running it…</small>
                ) : c.note ? <small role="status">{c.note}</small> : null}
              </div>
            ))}
            {pendingApprovals.map((job) => (
              <div key={job.id} className="vs-approval" role="group" aria-label="Image waiting for approval">
                <b>An image needs your approval</b>
                <span style={{ color: "var(--vs-dim)" }}>{String((job.params as Record<string, unknown>)?.prompt ?? "").slice(0, 90)}</span>
                <span className="mono" style={{ color: "var(--vs-text)" }}>Estimated ${Number(job.estimated_cost_usd ?? 0).toFixed(2)}</span>
                <div style={{ display: "flex", gap: 8 }}>
                  <button type="button" className="vs-btn vs-btn-gold" onClick={() => void media.decide(job.id, true)}>Approve and make it</button>
                  <button type="button" className="vs-btn vs-btn-quiet" onClick={() => void media.decide(job.id, false)}>Decline</button>
                </div>
              </div>
            ))}
            {chat.sendError && <p className="vs-alert" role="alert">{chat.sendError}</p>}
            {media.actionError && pendingApprovals.length > 0 && <p className="vs-alert" role="alert">{media.actionError}</p>}
          </div>
          <div className="vs-chat-input">
            <div className="vs-chat-box">
              <label className="vs-sr" htmlFor="vs-chat-input">Tell Paige what to change</label>
              <textarea
                id="vs-chat-input"
                ref={inputRef}
                value={input}
                placeholder={chat.choices ? "Answer above, or type here" : artifact ? "Tell Paige what to change" : "Tell Paige what to build"}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
              />
              <button type="button" className="vs-send" aria-label="Send" disabled={!input.trim() || chat.sending || !chat.ready} onClick={submit}><ArrowUp size={16} /></button>
            </div>
          </div>
        </section>

        <div className="vs-stage-wrap">
          <div className="vs-stage" role="region" aria-label="Stage">
            {notice && !publishOpen && (
              <p role="status" className="vs-notice">{notice} <button type="button" className="vs-link" onClick={() => setNotice(null)}>Dismiss</button></p>
            )}
            {previewing && (
              <p role="status" className="vs-notice vs-notice-preview">
                {previewArtifact ? `Showing version ${previewing.versionNo}. Your working copy is unchanged.` : `Version ${previewing.versionNo} can't be shown here, but going back restores it.`}
              </p>
            )}
            {artifactError ? (
              <div className="vs-stage-empty" role="alert"><b>This piece couldn't be loaded</b>{artifactError}</div>
            ) : (
              <StudioStage
                artifact={previewArtifact ?? artifact} brand={brand} device={device} tenantId={tenantId}
                building={chat.sending && !previewing} steps={chat.steps} status={chat.status}
                preview={previewing ? null : chat.preview} waitingApproval={chat.confirms.some((c) => !c.state)}
              />
            )}
          </div>
          {settingsOpen && artifact?.kind === "form" && (
            <FormSettings tenantId={tenantId} formId={artifact.form.id} onClose={() => setSettingsOpen(false)} onSaved={() => setRefreshKey((k) => k + 1)} />
          )}
        </div>
      </div>

      <Timeline
        sessionId={sessionId}
        target={activeRef ? { kind: activeRef.kind, id: activeRef.id } : null}
        refreshKey={refreshKey}
        building={chat.sending ? (chat.status ?? "Working on it") : null}
        onRestored={(m) => { setPreviewing(null); setNotice(m); setRefreshKey((k) => k + 1); }}
        onPreview={setPreviewing}
      />
    </div>
  );
}
