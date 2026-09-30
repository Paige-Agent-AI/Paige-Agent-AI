import { useCallback, useEffect, useState } from "react";
import { CircleAlert, Link2, LoaderCircle, RefreshCw, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type AccountState = "not_connected" | "active" | "paused" | "revoked" | "expired";
type ConnectedAccount = {
  id: string;
  label: string;
  targetDisplayHost: string;
  state: AccountState;
  expiresAt: string | null;
  lastUsedAt: string | null;
};

function isAccount(value: unknown): value is ConnectedAccount {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === "string" && typeof item.label === "string" &&
    typeof item.targetDisplayHost === "string" &&
    ["not_connected", "active", "paused", "revoked", "expired"].includes(String(item.state));
}

export function SecureBrowserConnectedAccounts() {
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState("loading");
    setMessage(null);
    const { data, error } = await supabase.rpc("list_secure_browser_connected_accounts" as never);
    if (error) {
      setState("error");
      setMessage("Connected Accounts are unavailable. No account details were returned.");
      return;
    }
    const rows = Array.isArray(data) ? data as unknown[] : [];
    setAccounts(rows.filter(isAccount));
    setState("ready");
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function control(account: ConnectedAccount, command: "pause" | "revoke" | "delete") {
    if (command === "delete" &&
        !window.confirm(`Delete ${account.label} from Connected Accounts? This cannot be undone.`)) return;
    setBusyId(account.id);
    setMessage(null);
    const { error } = await supabase.rpc("control_secure_browser_connected_account" as never, {
      p_account: account.id,
      p_command: command,
    } as never);
    if (error) {
      setMessage("The account status was not changed. Refresh and try again.");
    } else {
      await load();
    }
    setBusyId(null);
  }

  if (state === "loading") {
    return (
      <section className="bv-card bv-connected-boundary" aria-live="polite">
        <LoaderCircle className="bv-spin" size={20} />
        <div><h2>Checking Connected Accounts…</h2><p className="bv-copy">No account details appear until workspace access is verified.</p></div>
      </section>
    );
  }

  if (state === "error") {
    return (
      <section className="bv-card bv-connected-boundary" role="alert">
        <CircleAlert size={20} />
        <div><h2>Connected Accounts unavailable</h2><p className="bv-copy">{message}</p>
          <button className="bv-button" onClick={() => void load()}><RefreshCw size={16} />Retry</button>
        </div>
      </section>
    );
  }

  return (
    <div className="bv-grid">
      {message && <div className="bv-callout bv-callout--bad" role="alert"><CircleAlert size={16} />{message}</div>}
      <section className="bv-card">
        <header><h2>Paige Secure Browser</h2><span className="bv-status bv-status--violet">Under setup</span></header>
        <p className="bv-copy">
          Secure account connections are not available yet. Paige will not ask for a password,
          verification code, or sign-in secret in chat.
        </p>
        <div className="bv-connected-safety">
          <ShieldCheck size={18} />
          <span>Future downloads must enter private Vault quarantine before access.</span>
        </div>
        <button className="bv-button bv-button--gold" disabled title="Connection setup is not yet available">
          <Link2 size={16} />Connect account · Unavailable
        </button>
      </section>
      <section className="bv-card">
        <header><h2>Connected Accounts</h2><span className="bv-status bv-status--neutral">{accounts.length}</span></header>
        {accounts.length === 0 ? (
          <div className="bv-connected-empty">
            <Link2 size={22} />
            <strong>No accounts connected</strong>
            <p className="bv-copy">Nothing has been authorized, opened, or retained for this workspace.</p>
          </div>
        ) : accounts.map((account) => (
          <article className="bv-connected-account" key={account.id}>
            <div>
              <strong>{account.label}</strong>
              <small>{account.targetDisplayHost}</small>
              {account.state === "expired" && <small>This connection expired. Reconnect will be required when setup becomes available.</small>}
            </div>
            <span className="bv-status bv-status--neutral">{account.state.replace("_", " ")}</span>
            <div className="bv-record__actions">
              {account.state === "active" && <button className="bv-button" disabled={busyId === account.id} onClick={() => void control(account, "pause")}>Pause</button>}
              {!["revoked", "not_connected"].includes(account.state) && <button className="bv-button bv-button--danger" disabled={busyId === account.id} onClick={() => void control(account, "revoke")}>Revoke</button>}
              <button className="bv-button bv-button--danger" disabled={busyId === account.id} onClick={() => void control(account, "delete")}>Delete</button>
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}
