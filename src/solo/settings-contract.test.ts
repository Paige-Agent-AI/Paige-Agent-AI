import { describe, expect, it } from "vitest";
import {
  SOLO_SETTINGS_DESTINATIONS,
  createSettingsRequestGate,
  getCustomDomainPresentation,
  getManagedIdentityPresentation,
  resolveSoloSettingsEntry,
} from "./settings-contract";

describe("Solo Settings ownership contract", () => {
  it("locks the approved customer-facing taxonomy and truth labels", () => {
    expect(SOLO_SETTINGS_DESTINATIONS.map(({ key, label, truth }) => [key, label, truth])).toEqual([
      ["setup", "Setup", "PARTIAL"],
      ["team", "Team", "PARTIAL"],
      ["connections", "Connections", "PARTIAL"],
      ["integrations", "Integrations", "PARTIAL"],
      ["analytics", "Analytics", "PARTIAL"],
      ["security-data", "Security & data", "PARTIAL"],
      ["vault", "Vault", "PROPOSED"],
      ["billing", "Billing", "PARTIAL"],
    ]);
  });

  it("accepts only Conversations or Calendar return paths for the active Solo address", () => {
    expect(resolveSoloSettingsEntry(
      "?origin=conversations&returnTo=%2Fsolo%2F42%2Fclients%2Fconversations",
      "42",
    )).toEqual({ origin: "conversations", returnTo: "/solo/42/clients/conversations" });
    expect(resolveSoloSettingsEntry(
      "?origin=calendar&returnTo=%2Fsolo%2F42%2Fclients%2Fcalendar",
      "42",
    )).toEqual({ origin: "calendar", returnTo: "/solo/42/clients/calendar" });
    expect(resolveSoloSettingsEntry(
      "?origin=calendar&returnTo=https%3A%2F%2Fevil.example%2Fsteal",
      "42",
    )).toEqual({ origin: "calendar", returnTo: null });
    expect(resolveSoloSettingsEntry(
      "?origin=conversations&returnTo=%2Fsolo%2F99%2Fclients%2Fconversations",
      "42",
    )).toEqual({ origin: "conversations", returnTo: null });
  });

  it("invalidates an old account request before the next account settles", () => {
    const gate = createSettingsRequestGate();
    const first = gate.begin();
    const second = gate.begin();
    expect(gate.isCurrent(first)).toBe(false);
    expect(gate.isCurrent(second)).toBe(true);
    gate.clear();
    expect(gate.isCurrent(second)).toBe(false);
  });

  it("keeps capability maturity separate from an absent tenant identity", () => {
    expect(getManagedIdentityPresentation({ identity: null, loading: false, error: null })).toEqual({
      capability: "LIVE",
      accountState: "not-configured",
      accountLabel: "Not configured",
      healthLabel: "Not available until configured",
      tone: "neutral",
    });
  });

  it("shows activation pending only for a persisted pending identity", () => {
    expect(getManagedIdentityPresentation({
      identity: { default_email_sender: "hello@example.com" },
      loading: false,
      error: null,
    })).toMatchObject({ accountState: "configured", accountLabel: "Configured", healthLabel: "Status not reported", tone: "neutral" });
    expect(getManagedIdentityPresentation({
      identity: { default_email_status: "provisioning" },
      loading: false,
      error: null,
    })).toMatchObject({ accountState: "pending", accountLabel: "Activation pending", healthLabel: "Provisioning", tone: "warn" });
  });

  it("reports active and failed persisted identity states without collapsing health into maturity", () => {
    expect(getManagedIdentityPresentation({
      identity: { default_email_status: "outbound_ready" },
      loading: false,
      error: null,
    })).toMatchObject({ capability: "LIVE", accountState: "active", accountLabel: "Active", healthLabel: "Outbound ready", tone: "ok" });
    expect(getManagedIdentityPresentation({
      identity: { default_email_status: "failed" },
      loading: false,
      error: null,
    })).toMatchObject({ capability: "LIVE", accountState: "degraded", accountLabel: "Configured", healthLabel: "Failed", tone: "bad" });
  });

  it("keeps custom-domain maturity, tenant configuration, and health orthogonal", () => {
    expect(getCustomDomainPresentation({ statuses: [], loading: false, error: null })).toMatchObject({
      capability: "PARTIAL", accountState: "not-configured", accountLabel: "Not configured", healthLabel: "Not available until configured",
    });
    expect(getCustomDomainPresentation({ statuses: ["dns_pending"], loading: false, error: null })).toMatchObject({
      capability: "PARTIAL", accountState: "pending", accountLabel: "1 configured", healthLabel: "Verification pending",
    });
    expect(getCustomDomainPresentation({ statuses: ["verified"], loading: false, error: null })).toMatchObject({
      capability: "PARTIAL", accountState: "active", accountLabel: "1 configured", healthLabel: "Verified",
    });
    expect(getCustomDomainPresentation({ statuses: ["failed"], loading: false, error: null })).toMatchObject({
      capability: "PARTIAL", accountState: "degraded", accountLabel: "1 configured", healthLabel: "Degraded",
    });
  });

  it("clears visible account state and rejects a late response after switching", () => {
    const gate = createSettingsRequestGate();
    let visible: string | null = "account-a";
    const accountA = gate.begin();
    gate.clear();
    visible = null;
    const accountB = gate.begin();
    if (gate.isCurrent(accountA)) visible = "late-account-a";
    expect(visible).toBeNull();
    expect(gate.isCurrent(accountA)).toBe(false);
    expect(gate.isCurrent(accountB)).toBe(true);
  });
});
