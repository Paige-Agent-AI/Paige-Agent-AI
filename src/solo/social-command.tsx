import React from "react";
import { Link, useParams } from "react-router-dom";
import { useTenantContext } from "@/hooks/useTenantContext";
import { GoLive } from "./go-live";
import { RecordAccountsForm } from "./social-account-record";
import { SocialPublishingDesk } from "./social-publishing-desk";
import { buildConnectionsPanel, CONNECTION_COPY } from "./social-truth";
import { useSocialCommand, type SocialCommandState } from "./useSocialCommand";
import "./social-command.css";

type SocialCommandProps = {
  onOpenStudio: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onAskPaige: () => void;
};

export function SocialCommand({ onOpenStudio, onAskPaige }: SocialCommandProps) {
  const { activeTenantId, activeUserId, loading, accountContextLoading } = useTenantContext();
  if (loading || accountContextLoading) {
    return <p className="social-state" role="status">Resolving this account’s Social workspace…</p>;
  }
  if (!activeTenantId || !activeUserId) {
    return <p className="social-state">Social needs a resolved workspace.</p>;
  }
  return <SocialWorkspace key={`${activeUserId}:${activeTenantId}`} tenantId={activeTenantId}
    onOpenStudio={onOpenStudio} onAskPaige={onAskPaige} />;
}

function SocialWorkspace({ tenantId, onOpenStudio, onAskPaige }: SocialCommandProps & { tenantId: string }) {
  const social = useSocialCommand();
  const { recordHandles } = social;
  const [hasResolved, setHasResolved] = React.useState(false);
  const ready = social.tenantId === tenantId && social.phase === "ready";
  React.useEffect(() => {
    if (ready) setHasResolved(true);
  }, [ready]);
  const [recording, setRecording] = React.useState(false);
  const opener = React.useRef<HTMLButtonElement | null>(null);
  const dismissTimer = React.useRef<number | null>(null);
  const mounted = React.useRef(false);
  const recordSession = React.useRef(0);
  const cancelDismiss = React.useCallback(() => {
    if (dismissTimer.current !== null) window.clearTimeout(dismissTimer.current);
    dismissTimer.current = null;
  }, []);
  const retireSession = React.useCallback(() => {
    recordSession.current++;
    cancelDismiss();
  }, [cancelDismiss]);
  React.useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; retireSession(); };
  }, [retireSession]);

  const openRecord = React.useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    retireSession();
    opener.current = event?.currentTarget ?? null;
    setRecording(true);
  }, [retireSession]);
  const closeRecord = React.useCallback(() => {
    retireSession();
    setRecording(false);
    opener.current?.focus?.({ preventScroll: true });
  }, [retireSession]);
  // The read refresh temporarily unmounts the form, but this page still owns its
  // recording session. Retire that session's timer on close, context change or exit.
  const saveRecord = React.useCallback(async (draft: Record<string, string>) => {
    const session = recordSession.current;
    cancelDismiss();
    const result = await recordHandles(draft);
    if (result.ok && mounted.current && recordSession.current === session) {
      dismissTimer.current = window.setTimeout(closeRecord, 900);
    }
    return result;
  }, [recordHandles, cancelDismiss, closeRecord]);


  // Keep an open draft and broadcast mounted during the same workspace’s presence refresh.
  // A different actor or workspace remounts this entire view through its resolved context key.
  const refreshing = hasResolved && social.tenantId === tenantId && social.phase === "loading";
  return (
    <div className="social-page">
      {ready || refreshing ? (
        <SocialPublishingDesk tenantId={tenantId} canManage={social.canManage}
          onOpenStudio={onOpenStudio} onAskPaige={onAskPaige} />
      ) : social.phase === "error" ? (
        <div className="social-state" role="alert">
          <p>This workspace’s Social access could not be checked.</p>
          <button type="button" className="btn btn-s" onClick={social.retry}>Try again</button>
        </div>
      ) : <p className="social-state" role="status">Reading this workspace’s Social access…</p>}
      {ready || refreshing ? <GoLive tenantId={tenantId} /> : null}
      {ready || refreshing ? <SocialAccounts social={social} onRecord={openRecord} refreshing={refreshing} /> : null}
      {ready && recording && (
        <RecordAccountsForm handles={social.handles} canManage={social.canManage}
          onSave={saveRecord} onClose={closeRecord} />
      )}
    </div>
  );
}

function SocialAccounts({ social, onRecord, refreshing }: {
  social: SocialCommandState;
  onRecord: (event: React.MouseEvent<HTMLButtonElement>) => void;
  refreshing: boolean;
}) {
  const { account } = useParams<{ account: string }>();
  const settingsPath = account && /^\d{1,20}$/.test(account)
    ? `/solo/${account}/settings/integrations`
    : null;
  const entries = buildConnectionsPanel(social.connections);
  return (
    <section className="social-panel social-connections" aria-labelledby="social-accounts-heading" aria-busy={refreshing}>
      <header className="social-accounts-head">
        <h3 id="social-accounts-heading">Connected accounts</h3>
        {settingsPath && <Link to={settingsPath} className="social-connections-manage">Manage in Integrations</Link>}
      </header>
      {entries.length > 0 ? <ul className="social-connections-list">
        {entries.map((entry) => (
          <li key={entry.network} data-state={entry.status}>
            <span className="social-channel-dot" aria-hidden="true" />
            <div className="social-connection-main">
              <h4>{entry.networkLabel}</h4>
              {entry.label && <small className="mono">{entry.label}</small>}
              <p>{CONNECTION_COPY[entry.status]}
                {entry.status === "connected" && entry.verifiedAt
                  ? ` Last verified ${new Date(entry.verifiedAt).toLocaleDateString()}.`
                  : ""}
              </p>
            </div>
          </li>
        ))}
      </ul> : <p className="social-accounts-note">No connections were returned for this workspace.</p>}
      <details className="social-declared-accounts">
        <summary>Accounts on record</summary>
        {social.notPermitted ? <p>Only workspace owners and admins can see the account record.</p>
          : social.handlesUnknown ? <p>The account record could not be read.</p>
          : social.handles.length ? <ul>
            {social.handles.map(({ network, label, handle }) => <li key={network}>{label} <span>{handle}</span></li>)}
          </ul> : <p>No account is on record.</p>}
        {social.recordChangedAt && !social.notPermitted && !social.handlesUnknown && <p className="social-record-stamp">
          Workspace account record updated {new Date(social.recordChangedAt).toLocaleString()}.
        </p>}
        {social.authorityUnknown && <button type="button" className="btn btn-s" onClick={social.retry}>Check access again</button>}
        {social.canManage && !social.handlesUnknown && !social.notPermitted && (
          <button type="button" className="btn btn-s" disabled={refreshing} onClick={onRecord}>
            {social.handles.length ? "Update accounts" : "Record accounts"}
          </button>
        )}
      </details>
    </section>
  );
}

export default SocialCommand;
