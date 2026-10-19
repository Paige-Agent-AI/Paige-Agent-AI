import { useRef, useState } from "react";
import { ExternalLink, Inbox, Lock, RefreshCw, Share2, Upload } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { SCOPE_CHANGED_MESSAGE, useClientFilesOwner, type OwnerFile, type PortalAccessWord } from "@/hooks/useClientFilesOwner";
import { CLIENT_DOCUMENT_ACCEPT } from "@/lib/client-portal-documents";
import type { PortalAccessStateName } from "@/lib/client-portal-access";
import "./client-files.css";

/**
 * E09 Slice 4 (4A) — "Files for {client}" on the Solo client record, after "Shared with {client}".
 *
 * One list of this client's files in three sections, never tabs: what the client can see, what the
 * client sent, and what stays with the team. Every file the business adds starts private (owner decision
 * D1); sharing is a separate, explicit switch, and a change is reported only once a fresh read of this
 * client's files shows it (§70.1). The client's own uploads carry no switch — who sent a file never
 * changes. Opening a file mints a one-minute link. Sharing is a visibility setting, not an approval, so
 * there is no gold here: the switch is the record's indigo.
 *
 * `portalAccess` (E09 Slice 7): the record's own access state. A paused client keeps their login link but sees
 * nothing, and an ended one has lost it, so neither may be told "can open it in their portal" — whatever an
 * answer that reads the link alone says.
 *
 * Which answer speaks for "joined" and "paused", newest first (round 3): the latest share answer's
 * `portal_access` (the server, at the moment of the share); then the record's live props; then the list read,
 * and only to say the client has joined since. A Pause or Restore on the record changes the props, and the
 * share answer heard before that stops speaking, as does the list read while access was paused: the record
 * is newer.
 */
type Props = { contactId: string; clientName: string; portalConnected: boolean; portalAccess?: PortalAccessStateName };
type Note = { tone: "ok" | "warn" | "bad"; text: string; /** A link to click when the browser kept the new tab from opening. */ href?: string };

const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;
const size = (bytes: number | null) => bytes === null ? null : bytes < 1024 * 1024
  ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
const KIND: Record<string, string> = {
  "application/pdf": "PDF", "image/jpeg": "JPG", "image/png": "PNG",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "DOCX",
};
const day = (iso: string) => new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(iso));

/** The server's named refusals, in the owner's words. The internal code never reaches the screen. */
function shareRefusal(code: string, name: string): string {
  switch (code) {
    case "FILE_CHANGED": return "This file changed. Check it and share again.";
    case "FILE_NOT_FOUND": return "This file is no longer on this record.";
    case "FILE_IS_CLIENT_UPLOAD": return `${name} sent this file, so it’s already theirs to see.`;
    case "FILE_NOT_READY": return "This file hasn’t finished uploading, so it can’t be shared yet.";
    case "CONTACT_NOT_FOUND": return `${name}’s record isn’t active, so nothing can be shared with them.`;
    case "CLIENT_FILES_UNAVAILABLE": return "Sharing files with clients isn’t available for this account.";
    default: return "That change wasn’t made. Check the list and try again.";
  }
}

export function ClientFiles({ contactId, clientName, portalConnected, portalAccess = "open" }: Props) {
  const files = useClientFilesOwner(contactId);
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [notes, setNotes] = useState<Record<string, Note>>({});
  // What the latest share answer said, until the record's access props change under it.
  const [heard, setHeard] = useState<{ connected: boolean | null; access: PortalAccessWord | null } | null>(null);
  const basis = `${portalConnected}|${portalAccess}`;
  const [seenBasis, setSeenBasis] = useState(basis);
  if (basis !== seenBasis) { setSeenBasis(basis); setHeard(null); }
  // The list can only ADD "joined" (the client joined after the record loaded). Its false is linked AND open
  // read at that moment, which a later Restore on the record outdates, so it never says "hasn't joined".
  const listJoined = files.list?.portal_connected === true;
  const withheld = heard?.access ? (heard.access === "paused" || heard.access === "ended" ? heard.access : null)
    : portalAccess === "paused" || portalAccess === "ended" ? portalAccess : null;
  const joined = heard?.access ? heard.access === "open"
    : heard && heard.connected !== null ? heard.connected : portalConnected || listJoined;
  const [resume, setResume] = useState<OwnerFile | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const first = firstName(clientName);
  const list = files.list?.files ?? [];
  const shared = list.filter(f => f.visibility === "shared");
  const fromClient = list.filter(f => f.source === "client");
  const internal = list.filter(f => f.visibility === "internal");
  const busy = files.phase === "loading" || files.phase === "idle";
  const uploading = files.upload.kind === "working";

  const note = (id: string, value: Note | null) => setNotes(current => {
    const next = { ...current };
    if (value) next[id] = value; else delete next[id];
    return next;
  });

  const share = async (file: OwnerFile, next: boolean) => {
    if (pending[file.id] !== undefined) return;
    setPending(current => ({ ...current, [file.id]: next }));
    note(file.id, null);
    try {
      const result = await files.setShared(file, next);
      if (result.kind === "confirmed") {
        const answer = { connected: result.portalConnected, access: result.portalAccess };
        if (answer.connected !== null || answer.access !== null) setHeard(answer);
        // The server's word, when it gave one, is newer than the record; without one, the record decides.
        const held = answer.access ? (answer.access === "paused" || answer.access === "ended" ? answer.access : null) : withheld;
        const nowJoined = !held && (answer.access ? answer.access === "open" : (answer.connected ?? joined));
        note(file.id, { tone: "ok", text: !next ? `No longer shared with ${clientName}.`
          : nowJoined ? `Shared. ${clientName} can open it in their portal.`
            : held === "paused" ? `Shared. ${first} will see it if you restore their access.`
              : held === "ended" ? `Shared. ${first} will see it if you invite them back and they accept.`
                : `Shared. ${first} will see it once they join your portal.` });
      } else if (result.kind === "refused") {
        let reread = true;
        if (result.reread) { try { await files.reload(); } catch { reread = false; } }
        const text = shareRefusal(result.code, clientName);
        note(file.id, { tone: "warn", text: reread ? text : `${text} Use Refresh to see what’s current.` });
      } else if (result.kind === "scope") {
        note(file.id, { tone: "bad", text: "Your account or workspace changed. Reopen this client to share files." });
      } else {
        note(file.id, { tone: "bad", text: "We couldn’t confirm whether that changed. Refresh before trying again." });
      }
    } finally {
      setPending(current => { const rest = { ...current }; delete rest[file.id]; return rest; });
    }
  };

  /**
   * The tab is opened synchronously, inside the click, because a browser (Safari above all) blocks a window
   * opened after an await. It is pointed at the signed link once that arrives. If the browser blocked even
   * the immediate tab, nothing claims it opened: the link itself is shown to click.
   */
  const open = async (file: OwnerFile) => {
    note(file.id, null);
    let tab: Window | null = null;
    try { tab = window.open("", "_blank"); } catch { tab = null; }
    if (tab) { try { tab.opener = null; } catch { /* a cross-origin tab already has no opener */ } }
    try {
      const url = await files.link(file);
      if (tab && !tab.closed) {
        tab.location.replace(url);
        note(file.id, { tone: "ok", text: "Opened in a new tab. The link works for one minute." });
      } else {
        note(file.id, { tone: "warn", text: "Your browser didn’t open a new tab. Use this link within one minute:", href: url });
      }
    } catch (error) {
      if (tab && !tab.closed) tab.close();
      note(file.id, { tone: "bad", text: error instanceof Error && error.message ? error.message : "This file couldn’t be opened. Try again." });
    }
  };

  const pick = (row?: OwnerFile) => {
    if (uploading) return;
    setResume(row ?? null);
    if (input.current) { input.current.value = ""; input.current.click(); }
  };

  /** The file just added, still private and saved: offered for sharing right where the upload was reported. */
  const added = files.upload.kind === "saved" ? list.find(f => f.id === files.upload.id && f.visibility === "internal" && f.upload_state === "ready") : undefined;
  const shareAdded = async (file: OwnerFile) => {
    await share(file, true);
    files.dismiss();
  };

  const addButton = (where: "head" | "empty") => (
    <button type="button" className="trc-files-add" data-where={where} onClick={() => pick()} aria-disabled={uploading || undefined}>
      <Upload aria-hidden />Add a file
    </button>
  );

  const row = (file: OwnerFile) => {
    const kind = KIND[file.mime_type ?? ""] ?? "File";
    // Each row says where it stands at a glance, even when its section heading has scrolled away.
    const state = file.source === "client" ? "client" : file.visibility === "shared" ? "shared" : "private";
    const Icon = state === "client" ? Inbox : state === "shared" ? Share2 : Lock;
    const facts = [kind, size(file.size_bytes), file.source === "client" ? `Sent ${day(file.created_at)}` : `Added ${day(file.created_at)}`].filter(Boolean) as string[];
    if (file.visibility === "shared" && file.shared_at) facts.push(`Shared ${day(file.shared_at)}`);
    const switchable = file.source === "business" && file.upload_state === "ready";
    const asked = pending[file.id];
    const checked = asked !== undefined ? asked : file.visibility === "shared";
    const switchId = `trc-file-share-${file.id}`;
    return (
      <li key={file.id} className="trc-files-row" aria-busy={asked !== undefined || undefined}>
        <Icon aria-hidden className="trc-files-icon" data-kind={state} />
        <div className="trc-files-item">
          <strong title={file.filename}>{file.filename}</strong>
          <span>{facts.map((fact, i) => <span key={`${fact}-${i}`}>{i > 0 && " · "}<span className="trc-files-nowrap">{fact}</span></span>)}</span>
          {file.upload_state === "pending" && <span className="trc-files-quiet">This upload didn’t finish.</span>}
        </div>
        <div className="trc-files-control">
          {file.upload_state === "ready"
            ? <button type="button" className="trc-files-open" onClick={() => void open(file)} aria-label={`Open ${file.filename}`}><ExternalLink aria-hidden />Open</button>
            : file.source === "business" && <button type="button" className="trc-files-quiet-btn" onClick={() => pick(file)} aria-disabled={uploading || undefined} aria-label={`Finish uploading ${file.filename}`}><Upload aria-hidden />Finish upload</button>}
          {switchable && (
            <label className="trc-files-toggle" htmlFor={switchId}>
              <span>{asked === true ? "Sharing…" : asked === false ? "Stopping…" : checked ? "Shared" : "Private"}</span>
              <Switch id={switchId} className="trc-files-switch" checked={checked} disabled={asked !== undefined}
                aria-label={`Share ${file.filename} with ${clientName}`} onCheckedChange={next => void share(file, next)} />
            </label>
          )}
        </div>
        {notes[file.id] && <p className="trc-files-note" data-tone={notes[file.id].tone} role={notes[file.id].tone === "ok" ? "status" : "alert"}>
          {notes[file.id].text}
          {notes[file.id].href && <a href={notes[file.id].href} target="_blank" rel="noopener noreferrer">Open {file.filename}</a>}
        </p>}
      </li>
    );
  };

  const section = (title: string, rows: OwnerFile[], empty: string, id: string) => (
    <section className="trc-files-group" aria-labelledby={id}>
      <h4 id={id}>{title} <span className="trc-files-count">{rows.length}</span></h4>
      {rows.length ? <ul className="trc-files-rows">{rows.map(row)}</ul> : <p className="trc-files-none">{empty}</p>}
    </section>
  );

  return (
    <section id="client-files" className="trc-record-section trc-files" aria-labelledby="trc-files-title" aria-busy={busy || files.reading || undefined}>
      {/* One header in every state: the title with its actions beside it, the rule beneath (Refresh never jumps). */}
      <div className="trc-files-head">
        <h3 id="trc-files-title" className="trc-files-title">Files for {clientName}</h3>
        <p className="trc-files-lede">{clientName} sees only files you share. New files stay private.</p>
        <div className="trc-files-meta">
          <span className="sr-only" role="status">{files.reading && files.list ? "Checking again…" : ""}</span>
          {files.phase === "ready" && (
            <button type="button" className="trc-files-refresh" onClick={() => { if (!files.reading) void files.reload().catch(() => undefined); }} aria-disabled={files.reading || undefined}>
              <RefreshCw aria-hidden />{files.reading ? "Refreshing…" : "Refresh"}
            </button>
          )}
          {files.phase === "ready" && list.length > 0 && addButton("head")}
        </div>
      </div>

      {files.phase === "ready" && (withheld === "paused" ? (
        <p className="trc-files-connect" role="note">Paused — {first} can’t see shared files right now. They show again if you restore their access.</p>
      ) : withheld === "ended" ? (
        <p className="trc-files-connect" role="note">{first}’s portal access has ended, so they can’t see shared files. They show again if you invite them back and they accept.</p>
      ) : !joined && (
        <p className="trc-files-connect" role="note">{clientName} hasn’t joined your portal yet; shared files appear when they do.</p>
      ))}

      <input ref={input} type="file" className="sr-only" tabIndex={-1} aria-hidden="true" accept={CLIENT_DOCUMENT_ACCEPT}
        onChange={event => {
          const chosen = event.target.files?.[0];
          if (!chosen) return;
          const target = resume;
          setResume(null);
          void files.add(chosen, target ? { id: target.id, name: target.filename, size: target.size_bytes, mime: target.mime_type } : undefined);
        }} />

      {files.upload.kind !== "idle" && (
        <div className="trc-files-upload" data-kind={files.upload.kind} role={files.upload.kind === "error" ? "alert" : "status"}>
          <p>{files.upload.notice}</p>
          <div>
            {files.upload.kind === "uncertain" && <button type="button" className="trc-files-quiet-btn" onClick={() => void files.check()}>Check saved upload</button>}
            {files.upload.kind === "continue" && <button type="button" className="trc-files-quiet-btn" onClick={() => {
              const held = list.find(f => f.id === files.upload.id);
              pick(held);
            }}>Choose the file</button>}
            {added && <button type="button" className="trc-files-quiet-btn" disabled={pending[added.id] !== undefined}
              onClick={() => void shareAdded(added)}><Share2 aria-hidden />{pending[added.id] !== undefined ? "Sharing…" : `Share with ${first}`}</button>}
            {["saved", "error", "uncertain", "continue"].includes(files.upload.kind) && <button type="button" className="trc-files-quiet-btn" onClick={files.dismiss}>Dismiss</button>}
          </div>
        </div>
      )}

      <div className="trc-files-content">
        {busy && (
          <>
            <span className="sr-only" role="status">Reading {clientName}’s files…</span>
            <ul className="trc-files-rows" aria-hidden="true">{[0, 1, 2].map(i => <li key={i} className="trc-files-row trc-files-skeleton"><b /><b /><i /></li>)}</ul>
          </>
        )}
        {files.phase === "refused" && <p className="trc-files-state" role="status">Only the business owner or an admin can see and share {clientName}’s files.</p>}
        {files.phase === "changed" && (
          <div className="trc-files-state" role="status">
            <p>{SCOPE_CHANGED_MESSAGE}</p>
            <button type="button" className="trc-files-quiet-btn" onClick={files.retry}><RefreshCw aria-hidden />Refresh</button>
          </div>
        )}
        {files.phase === "unavailable" && <p className="trc-files-state" role="status">Client files aren’t available for this account.</p>}
        {files.phase === "inactive" && <p className="trc-files-state" role="status">{clientName}’s record isn’t active in this workspace, so their files can’t be shown.</p>}
        {files.phase === "no_workspace" && <p className="trc-files-state" role="status">Open a business workspace to see this client’s files.</p>}
        {files.phase === "error" && (
          <div className="trc-files-state" role="alert">
            <p>We couldn’t read {clientName}’s files. Nothing has been shared or unshared.</p>
            <button type="button" className="trc-files-quiet-btn" onClick={files.retry}><RefreshCw aria-hidden />Try again</button>
          </div>
        )}
        {files.phase === "ready" && list.length === 0 && (
          <div className="trc-files-empty">
            <p><strong>No files for {clientName} yet.</strong></p>
            <p>Add a file. It stays private to your team until you share it.</p>
            {addButton("empty")}
          </div>
        )}
        {files.phase === "ready" && list.length > 0 && (
          <>
            {section(`Shared with ${first}`, shared, `Nothing shared with ${first} yet. Switch a file on below to share it.`, "trc-files-shared")}
            {section(`From ${first}`, fromClient, `${first} hasn’t sent you any files.`, "trc-files-client")}
            {section("Private to your team", internal, "No private files.", "trc-files-internal")}
            {/* Older files, 100 at a time, after the last one shown (client_file_owner_list's (created_at, id) cursor). */}
            {files.list?.has_more && (
              <div className="trc-files-foot trc-files-more">
                <p>Showing the newest {list.length} files.</p>
                <button type="button" className="trc-files-quiet-btn" onClick={() => void files.loadMore()}
                  aria-disabled={files.more.loading || files.reading || undefined}>
                  {files.more.loading ? "Loading…" : "Load more"}
                </button>
                {files.more.failed && <p className="trc-files-more-error" role="alert">Older files couldn’t be loaded. Try again.</p>}
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
