export type SettingsTruth = "LIVE" | "PARTIAL" | "UNAVAILABLE" | "PROPOSED";

export type ConnectionStateTone = "neutral" | "ok" | "warn" | "bad";

export type ManagedIdentityRecord = {
  default_email_sender?: string | null;
  default_email_domain?: string | null;
  default_email_kind?: string | null;
  default_email_status?: string | null;
};

export type ConnectionPresentation = {
  capability: SettingsTruth;
  accountState: "loading" | "not-configured" | "pending" | "active" | "configured" | "degraded" | "unavailable";
  accountLabel: string;
  healthLabel: string;
  tone: ConnectionStateTone;
};

const ACTIVE_IDENTITY_STATUSES = new Set(["active", "verified", "outbound_ready"]);
const PENDING_IDENTITY_STATUSES = new Set(["pending", "provisioning", "activation_pending", "dns_pending"]);
const DEGRADED_IDENTITY_STATUSES = new Set(["failed", "error", "degraded", "revoked"]);

function statusLabel(status: string) {
  return status.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

/** Keeps platform capability maturity orthogonal to this account's persisted configuration and health. */
export function getManagedIdentityPresentation({
  identity,
  loading,
  error,
}: {
  identity: ManagedIdentityRecord | null;
  loading: boolean;
  error: string | null;
}): ConnectionPresentation {
  if (loading) return { capability: "LIVE", accountState: "loading", accountLabel: "Resolving", healthLabel: "Checking this account", tone: "neutral" };
  if (error) return { capability: "LIVE", accountState: "unavailable", accountLabel: "Unavailable", healthLabel: "Read failed", tone: "bad" };
  if (!identity) return { capability: "LIVE", accountState: "not-configured", accountLabel: "Not configured", healthLabel: "Not available until configured", tone: "neutral" };

  const status = identity.default_email_status?.trim().toLowerCase() ?? "";
  if (ACTIVE_IDENTITY_STATUSES.has(status)) {
    return { capability: "LIVE", accountState: "active", accountLabel: "Active", healthLabel: status === "outbound_ready" ? "Outbound ready" : statusLabel(status), tone: "ok" };
  }
  if (PENDING_IDENTITY_STATUSES.has(status)) {
    return { capability: "LIVE", accountState: "pending", accountLabel: "Activation pending", healthLabel: statusLabel(status), tone: "warn" };
  }
  if (DEGRADED_IDENTITY_STATUSES.has(status)) {
    return { capability: "LIVE", accountState: "degraded", accountLabel: "Configured", healthLabel: statusLabel(status), tone: "bad" };
  }
  return { capability: "LIVE", accountState: "configured", accountLabel: "Configured", healthLabel: status ? statusLabel(status) : "Status not reported", tone: "neutral" };
}

export function getCustomDomainPresentation({
  statuses,
  loading,
  error,
}: {
  statuses: ReadonlyArray<string | null | undefined>;
  loading: boolean;
  error: string | null;
}): ConnectionPresentation {
  if (loading) return { capability: "PARTIAL", accountState: "loading", accountLabel: "Resolving", healthLabel: "Checking this account", tone: "neutral" };
  if (error) return { capability: "PARTIAL", accountState: "unavailable", accountLabel: "Unavailable", healthLabel: "Read failed", tone: "bad" };
  if (!statuses.length) return { capability: "PARTIAL", accountState: "not-configured", accountLabel: "Not configured", healthLabel: "Not available until configured", tone: "neutral" };
  const normalized = statuses.map((status) => status?.trim().toLowerCase() ?? "");
  if (normalized.some((status) => DEGRADED_IDENTITY_STATUSES.has(status))) {
    return { capability: "PARTIAL", accountState: "degraded", accountLabel: `${statuses.length} configured`, healthLabel: "Degraded", tone: "bad" };
  }
  if (normalized.some((status) => PENDING_IDENTITY_STATUSES.has(status))) {
    return { capability: "PARTIAL", accountState: "pending", accountLabel: `${statuses.length} configured`, healthLabel: "Verification pending", tone: "warn" };
  }
  if (normalized.every((status) => status === "verified" || status === "active")) {
    return { capability: "PARTIAL", accountState: "active", accountLabel: `${statuses.length} configured`, healthLabel: "Verified", tone: "ok" };
  }
  return { capability: "PARTIAL", accountState: "configured", accountLabel: `${statuses.length} configured`, healthLabel: "Status not fully reported", tone: "neutral" };
}

export type SoloSettingsKey =
  | "setup"
  | "team"
  | "connections"
  | "integrations"
  | "analytics"
  | "security-data"
  | "vault"
  | "billing";

export const SOLO_SETTINGS_DESTINATIONS: ReadonlyArray<{
  key: SoloSettingsKey;
  label: string;
  truth: SettingsTruth;
}> = [
  { key: "setup", label: "Setup", truth: "PARTIAL" },
  { key: "team", label: "Team", truth: "PARTIAL" },
  { key: "connections", label: "Connections", truth: "PARTIAL" },
  { key: "integrations", label: "Integrations", truth: "PARTIAL" },
  { key: "analytics", label: "Analytics", truth: "PARTIAL" },
  { key: "security-data", label: "Security & data", truth: "PARTIAL" },
  { key: "vault", label: "Vault", truth: "PROPOSED" },
  { key: "billing", label: "Billing", truth: "PARTIAL" },
] as const;

export type SoloSettingsEntry = {
  origin: "conversations" | "calendar";
  returnTo: string | null;
} | null;

/**
 * Return navigation is address-only UI state. It never supplies tenant authority: only the
 * server-resolved active tenant may do that. The exact account segment and destination are
 * allowlisted so a copied query cannot escape the active Solo workspace.
 */
export function resolveSoloSettingsEntry(search: string, accountNumber: string): SoloSettingsEntry {
  const params = new URLSearchParams(search);
  const origin = params.get("origin");
  if (origin !== "conversations" && origin !== "calendar") return null;

  const expected = origin === "conversations"
    ? `/solo/${accountNumber}/clients/conversations`
    : `/solo/${accountNumber}/clients/calendar`;
  return { origin, returnTo: params.get("returnTo") === expected ? expected : null };
}

/** A tiny epoch gate used by tenant-scoped readers to reject late responses after switching. */
export function createSettingsRequestGate() {
  let epoch = 0;
  return {
    begin() {
      epoch += 1;
      return epoch;
    },
    isCurrent(token: number) {
      return token === epoch;
    },
    clear() {
      epoch += 1;
    },
  };
}
