/**
 * useSoloComms — the Solo Setup › Comms & data adapter (§18: composes the EXISTING
 * `manage-tenant-domain` + platform-billing seams, never a new query family).
 *
 * READ-ONLY this slice. It surfaces two real things:
 *   1. SENDING IDENTITY — the tenant's sender domains via the EmailDomainsPanel
 *      seam (`manage-tenant-domain` verb:"list") + the brand from_name/support_email
 *      (tenants.brand). The platform default is `no-reply@paigeagent.ai`.
 *   2. BILLING — the tenant's real Paige plan/status via the SetupBilling seam
 *      (platform_subscription_plans + get_tenant_platform_subscription +
 *      is_current_user_tenant_admin). §217/§38: a SUB-ACCOUNT's billing is the
 *      parent agency's — we do NOT fetch a plan and report `isSubAccount` so the
 *      caller renders the honest "managed by your agency" empty state.
 *
 * WRITES (this slice, 2026-08-31). The domain lifecycle, the carrier-facing business
 * details, and the Google sending-account connection are now real, because a surface
 * that reports "business name still missing" and gives nobody a field to type it in
 * is describing a capability rather than providing one (§70). Every write reuses a
 * seam that ALREADY EXISTED and already enforces authority server-side:
 *
 *   domains         → `manage-tenant-domain` verbs add/refresh/set_default/remove,
 *     the same seam `EmailDomainsPanel` has used on the legacy admin route.
 *   Google account  → `gmail-oauth-start` / `gmail-disconnect`.
 *
 * STILL DEFERRED (§13/§38 — NO fake action): notification toggles and
 * subscribe/checkout (money, §38). Those controls stay DISABLED/Preview.
 *
 * NO SILENT PROVIDER ACTION (§38): `startGmailConnect` RETURNS a consent URL and
 * does not navigate — the CALLER performs the redirect, in response to a click.
 * Nothing in this adapter reaches a provider, spends money, or changes a
 * credential on its own. (An earlier version of this note said it "navigates
 * nowhere. The person clicks it", which read as though no code performed a
 * redirect at all; the panel does, on the click. Said precisely, since the whole
 * point of the line is that the boundary is real.)
 *
 * §9: no client tenant selects a write target. `manage-tenant-domain` derives the
 * tenant from the verified session, the connector read is RLS-scoped, and the
 * gmail functions resolve it server-side and compare an expected-tenant stale
 * request guard. (This adapter briefly also wrote the
 * business record via `set_tenant_brand`, which DID take a client-supplied
 * `_tenant_id`; that editor moved to Setup on the owner's ruling, so the claim is
 * now true again — it was not while that write lived here.) Honest degrade (§13): a failed read surfaces an error and
 * an empty/`null` shape, never a fabricated domain or plan.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTenantContext } from "@/hooks/useTenantContext";
import { createSettingsRequestGate } from "../settings-contract";
import { readFunctionErrorBody, resolveFunctionError } from "@/lib/integrations/connectError";

export interface DnsRecord {
  record: string;
  name: string;
  type: string;
  ttl?: string;
  status?: string;
  priority?: string;
}

export interface SoloDomain {
  id: string;
  domain: string;
  fromEmailLocal: string;
  fromName: string;
  status: string;
  isDefault: boolean;
  /** The DNS records Resend returned for this domain — what the tenant must
   *  publish at their registrar for sending to verify. Displayed copy-paste-able. */
  dnsRecords: DnsRecord[];
}

export interface SoloSendingIdentity {
  fromName: string | null;
  supportEmail: string | null;
  /** The tenant's own verified/default sender, or null when only the platform default applies. */
  defaultSender: string | null;
}

export interface SoloBillingPlan {
  name: string;
  /** "trialing" | "active" | "past_due" | … | null when no subscription. */
  status: string | null;
  priceLabel: string | null;
  renewsLabel: string | null;
  /** True when the caller may manage billing (tenant admin), fail-closed. */
  canManage: boolean;
  hasActiveSub: boolean;
}

/**
 * A connected Google sending account.
 *
 * NOT called a mailbox, deliberately (§13). `gmail-oauth-start` requests
 * `gmail.send` and `userinfo.email` only — there is no `gmail.readonly` or
 * `gmail.modify` in the scope set, so nothing here proves inbound mail is read.
 * Calling it a mailbox would claim a capability the OAuth grant does not carry.
 */
export interface SoloMailbox {
  /** Identity/version of the exact visible connection; preconditions, never authority. */
  connectorId?: string | null;
  updatedAt?: string | null;
  connected: boolean;
  address: string | null;
  displayName: string | null;
  provider: string | null;
  status: string | null;
}

/** Thrown-free result shape: every mutation reports what actually happened (§13). */
export interface SoloMutationResult {
  ok: boolean;
  error: string | null;
}

export interface SoloCommsData {
  loading: boolean;
  error: string | null;
  /** True when this tenant is a sub-account (billing is the parent agency's). */
  isSubAccount: boolean;
  domains: SoloDomain[];
  sending: SoloSendingIdentity;
  /** Null while loading or unresolved; `connected:false` is a real answer. */
  mailbox: SoloMailbox | null;
  /** Null while loading, for a sub-account (parent-managed), or when unresolved. */
  billing: SoloBillingPlan | null;
  /** True when the caller may write brand/domains here — fail-closed. */
  canManage: boolean;
  refresh: () => void;

  /* ----- mutations (this slice) --------------------------------------------
   * Every one goes through a seam that already existed and already enforces
   * authority server-side: `manage-tenant-domain` derives its tenant from the
   * verified session and re-checks the caller's role, and the gmail functions
   * resolve the tenant server-side. Gmail takes an expected-tenant stale-request
   * guard; that value never selects or authorizes a target.
   */
  addDomain: (input: { domain: string; fromEmailLocal: string; fromName: string }) => Promise<SoloMutationResult>;
  refreshDomain: (id: string) => Promise<SoloMutationResult>;
  setDefaultDomain: (id: string) => Promise<SoloMutationResult>;
  removeDomain: (id: string) => Promise<SoloMutationResult>;
  /** Returns the provider consent URL for the CALLER to open. Never auto-navigated. */
  startGmailConnect: () => Promise<{ url: string | null; error: string | null }>;
  disconnectGmail: () => Promise<SoloMutationResult>;
}

/* ----- billing helpers (mirrors SetupBilling) --------------------------------- */
interface PlanRow {
  id: string;
  slug: string;
  name: string;
  monthly_price_cents: number;
  annual_price_cents: number | null;
}
interface CurrentSub {
  plan_id?: string | null;
  plan_slug?: string | null;
  status?: string | null;
  billing_period?: string | null;
  current_period_end?: string | null;
  cancel_at_period_end?: boolean | null;
}

/** Plain-English phrase per verb, for `resolveFunctionError`'s copy (§3 — no jargon). */
const DOMAIN_ACTION: Record<string, string> = {
  add: "add that sending domain",
  refresh: "check that domain's DNS",
  set_default: "make that domain the default sender",
  remove: "remove that sending domain",
  list: "read your sending domains",
};

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}
function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
function formatUsd(cents: number): string {
  const d = cents / 100;
  return `$${d.toLocaleString("en-US", {
    minimumFractionDigits: Number.isInteger(d) ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}
function formatDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? null
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function useSoloComms(): SoloCommsData {
  const { activeTenant, activeTenantId, activeUserId, loading: tenantLoading } = useTenantContext();
  const tenantId = activeTenantId;
  const isSubAccount = activeTenant?.parent_tenant_id != null;
  const gmailScope = useRef({ tenantId, activeUserId, tenantLoading, epoch: 0 });
  const gmailMounted = useRef(false);
  if (gmailScope.current.tenantId !== tenantId || gmailScope.current.activeUserId !== activeUserId
    || gmailScope.current.tenantLoading !== tenantLoading) {
    gmailScope.current = { tenantId, activeUserId, tenantLoading, epoch: gmailScope.current.epoch + 1 };
  }
  useEffect(() => {
    gmailMounted.current = true;
    return () => { gmailMounted.current = false; gmailScope.current.epoch += 1; };
  }, []);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [domains, setDomains] = useState<SoloDomain[]>([]);
  const [sending, setSending] = useState<SoloSendingIdentity>({
    fromName: null,
    supportEmail: null,
    defaultSender: null,
  });
  const [billing, setBilling] = useState<SoloBillingPlan | null>(null);
  const [mailbox, setMailbox] = useState<SoloMailbox | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [loadedTenantId, setLoadedTenantId] = useState<string | null>(null);
  const visibleGmail = useRef<SoloMailbox | null>(null);
  visibleGmail.current = loadedTenantId === tenantId ? mailbox : null;
  const requestGate = useRef(createSettingsRequestGate());

  const load = useCallback(async () => {
    const requestToken = requestGate.current.begin();
    // Clear the previous account before the next account resolves — but ONLY when
    // the account actually CHANGED. Nothing tenant-derived may remain visible
    // across a switch (§9); blanking on a same-account REFRESH is a different
    // thing entirely, and it was a real defect once this adapter gained writes.
    //
    // Every mutation calls `load()` to re-read the persisted answer. With an
    // unconditional reset, that re-read momentarily set `canManage` false, and
    // all three panels early-return a read-only notice on `!canManage` — so the
    // editor flickered to "Only a workspace admin can change this" and UNMOUNTED
    // the panel holding the "Saved." confirmation, at the exact moment it had
    // something to say. Caught by driving the save in a browser; the unit suite
    // mocks this adapter and cannot see it.
    const switchingAccount = loadedTenantId !== null && loadedTenantId !== tenantId;
    if (switchingAccount) {
      setLoadedTenantId(null);
      setDomains([]);
      setSending({ fromName: null, supportEmail: null, defaultSender: null });
      setBilling(null);
      setMailbox(null);
      setCanManage(false);
    }
    setError(null);
    if (!tenantId) {
      setLoading(false);
      return;
    }
    // `loading` means "there is nothing to show for this account yet" — NOT "a
    // refresh is in flight". Every mutation re-reads, and the panels sit inside a
    // `ReadState` keyed on this flag: setting it true on a same-account refresh
    // swapped them for a loading state and UNMOUNTED the panel holding the
    // result message, so a successful save or domain change reported nothing.
    // The returned value still gates on `loadedTenantId === tenantId`, so stale
    // data can never be shown across a switch (§9) — that guarantee does not
    // depend on this flag.
    if (loadedTenantId !== tenantId) setLoading(true);
    try {
      // Sending identity is meaningful on every tier; billing is skipped for a
      // sub-account (its plan is the parent agency's — §217/§38).
      const [domainRes, brandRes, mailboxRes, manageRes, ...billingRes] = await Promise.all([
        supabase.functions.invoke("manage-tenant-domain", { body: { verb: "list" } }),
        supabase.from("tenants").select("brand").eq("id", tenantId).maybeSingle(),
        // The read the "Connected mailbox" card said did not exist. The contract
        // DOES exist — `gmail-oauth-callback` writes this row — nobody had wired
        // the read, so the card reported UNAVAILABLE for a live capability.
        // NOT `.maybeSingle()`. Nothing constrains this table to one gmail row per
        // tenant — `gmail-oauth-callback` keys its lookup on `inbound_address`, so
        // a second Google address INSERTS a second row and never deactivates the
        // first. `maybeSingle()` throws PGRST116 on two rows, which would have
        // turned a second connection into a permanently unreadable card.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- table not in generated types (repo-wide pattern, cf. OwnerWelcome/EmailIntegrationConfig)
        (supabase as any)
          .from("channel_connectors")
          .select("id, updated_at, provider, from_address, display_name, status, active")
          .eq("tenant_id", tenantId)
          .eq("channel_type", "email")
          .eq("provider", "gmail")
          .order("active", { ascending: false })
          .order("updated_at", { ascending: false })
          .order("id", { ascending: true })
          .limit(1),
        // Fail-closed authority for the write controls. The server re-checks on
        // every mutation regardless; this only decides whether to render them.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- RPC not in generated types (repo-wide pattern)
        supabase.rpc("is_current_user_tenant_admin" as any),
        ...(isSubAccount
          ? []
          : [
              supabase
                .from("platform_subscription_plans")
                .select("id,slug,name,monthly_price_cents,annual_price_cents")
                .eq("is_active", true),
              // eslint-disable-next-line @typescript-eslint/no-explicit-any -- RPC not in generated types (repo-wide pattern)
              supabase.rpc("get_tenant_platform_subscription" as any),
              // eslint-disable-next-line @typescript-eslint/no-explicit-any -- RPC not in generated types (repo-wide pattern)
              supabase.rpc("is_current_user_tenant_admin" as any),
            ]),
      ]);
      if (!requestGate.current.isCurrent(requestToken)) return;

      // --- sending identity ---
      if (domainRes.error) throw domainRes.error;
      const domainData = domainRes.data as { domains?: unknown } | null;
      const rawDomains = Array.isArray(domainData?.domains) ? domainData!.domains : [];
      const parsedDomains: SoloDomain[] = rawDomains.map((d) => {
        const r = asRecord(d);
        // dns_records: Resend's record set, stored on the domain row by the
        // manage-tenant-domain edge function (add and refresh both write it).
        const rawRecords = Array.isArray(r.dns_records) ? r.dns_records : [];
        const dnsRecords: DnsRecord[] = rawRecords.map((rec) => {
          const rr = asRecord(rec);
          return {
            record: str(rr.record) ?? str(rr.value) ?? "",
            name: str(rr.name) ?? str(rr.host) ?? "",
            type: str(rr.type) ?? "",
            ttl: str(rr.ttl) ?? undefined,
            status: str(rr.status) ?? undefined,
            priority: str(rr.priority) ?? undefined,
          };
        });
        return {
          id: String(r.id ?? ""),
          domain: str(r.domain) ?? "",
          fromEmailLocal: str(r.from_email_local) ?? "no-reply",
          fromName: str(r.from_name) ?? "",
          status: str(r.status) ?? "pending",
          isDefault: r.is_default === true,
          dnsRecords,
        };
      });
      setDomains(parsedDomains);

      const brand = asRecord(brandRes.data?.brand);
      const defaultDomainRow =
        parsedDomains.find((d) => d.isDefault) ??
        parsedDomains.find((d) => d.status === "verified") ??
        null;
      setSending({
        fromName: str(brand.from_name),
        supportEmail: str(brand.support_email),
        defaultSender: defaultDomainRow
          ? `${defaultDomainRow.fromEmailLocal}@${defaultDomainRow.domain}`
          : null,
      });


      // "Not connected" is a CLAIM ABOUT THE ACCOUNT, and it may only be made
      // from a read that was actually allowed to see the answer.
      //
      // An error is the easy case. The hard one is RLS: `channel_connectors_select`
      // requires a global admin/coach role on top of the tenant match, so a
      // tenant_members OWNER without that app_role gets ZERO ROWS AND NO ERROR —
      // indistinguishable, to a naive guard, from having no connector. Reported as
      // "Not connected" that invites someone to re-run an OAuth grant they already
      // hold. So an empty result is only read as "none" when the caller is one the
      // policy admits; otherwise the card says it could not read it (§13).
      const canManageRead = manageRes.data === true;
      setCanManage(canManageRead);
      const mailboxRows = Array.isArray(mailboxRes.data) ? mailboxRes.data : [];
      const mailboxRow = asRecord(mailboxRows[0]);
      if (mailboxRes.error || (mailboxRows.length === 0 && !canManageRead)) {
        setMailbox(null);
      } else {
        setMailbox({
          connectorId: str(mailboxRow.id),
          updatedAt: str(mailboxRow.updated_at),
          connected: Boolean(mailboxRow.active) && str(mailboxRow.status) !== "revoked",
          address: str(mailboxRow.from_address),
          displayName: str(mailboxRow.display_name),
          provider: str(mailboxRow.provider),
          status: str(mailboxRow.status),
        });
      }

      // --- billing (skipped for sub-accounts) ---
      if (isSubAccount) {
        setBilling(null);
      } else {
        const [plansRes, subRes, adminRes] = billingRes as unknown as [
          { data: PlanRow[] | null; error: unknown },
          { data: unknown; error: unknown },
          { data: unknown; error: unknown },
        ];
        const canManage = adminRes.data === true; // fail-closed
        const plans = (plansRes.data ?? []) as PlanRow[];
        const subRaw = (subRes.data as CurrentSub[] | CurrentSub | null) ?? null;
        const sub = Array.isArray(subRaw) ? (subRaw[0] ?? null) : subRaw;
        const hasActiveSub = Boolean(
          sub && (sub.status ? sub.status !== "canceled" && sub.status !== "cancelled" : true),
        );
        const plan =
          sub &&
          plans.find(
            (p) =>
              (sub.plan_slug && p.slug === sub.plan_slug) || (sub.plan_id && p.id === sub.plan_id),
          );
        let priceLabel: string | null = null;
        if (plan) {
          const annual = sub?.billing_period === "annual";
          const cents = annual
            ? plan.annual_price_cents ?? plan.monthly_price_cents * 12
            : plan.monthly_price_cents;
          priceLabel = `${formatUsd(cents)}/${annual ? "yr" : "mo"}`;
        }
        const periodEnd = formatDate(sub?.current_period_end);
        setBilling({
          name: plan?.name ?? (hasActiveSub ? "Your Paige plan" : "No plan yet"),
          status: sub?.status ?? null,
          priceLabel,
          renewsLabel: sub?.cancel_at_period_end
            ? periodEnd
              ? `Cancels ${periodEnd}`
              : "Cancels at period end"
            : periodEnd
              ? `Renews ${periodEnd}`
              : null,
          canManage,
          hasActiveSub,
        });
      }
      setLoadedTenantId(tenantId);
    } catch (e) {
      if (!requestGate.current.isCurrent(requestToken)) return;
      setError(e instanceof Error ? e.message : "Couldn't load your comms settings.");
    } finally {
      if (requestGate.current.isCurrent(requestToken)) setLoading(false);
    }
  }, [tenantId, isSubAccount, loadedTenantId]);

  useEffect(() => {
    const activeGate = requestGate.current;
    if (tenantLoading) return;
    void load();
    return () => activeGate.clear();
  }, [tenantLoading, load]);

  const refresh = useCallback(() => {
    void load();
  }, [load]);

  /* ----- mutations ---------------------------------------------------------
   * Shared shape: never throw at the call site, always report what actually
   * happened, and re-read afterwards so the surface shows the PERSISTED answer
   * rather than the value that was typed (§70.1 — a toast is not persistence).
   */
  const asResult = (e: unknown): SoloMutationResult => ({
    ok: false,
    error: e instanceof Error ? e.message : typeof e === "string" ? e : "That didn't save.",
  });


  const domainVerb = useCallback(
    async (verb: string, payload: Record<string, unknown> = {}): Promise<SoloMutationResult> => {
      try {
        const { data, error: fnError } = await supabase.functions.invoke("manage-tenant-domain", {
          body: { verb, ...payload },
        });
        // BOTH shapes, and neither read raw. On a non-2xx, supabase-js sets
        // `data = null` and `error.message` to "Edge Function returned a non-2xx
        // status code" — the real code (`invalid_domain`, `forbidden`,
        // `not_found`) is inside `error.context`. Reading `error.message` shows a
        // person framework jargon for an ordinary typo, so this goes through the
        // one home that already exists for exactly this (§18).
        const inner = asRecord(data).error;
        if (fnError || inner) {
          const { message } = await resolveFunctionError({
            error: fnError, data, action: DOMAIN_ACTION[verb] ?? "update your sending domain",
          });
          return { ok: false, error: message };
        }
        await load();
        return { ok: true, error: null };
      } catch (e) {
        return asResult(e);
      }
    },
    [load],
  );

  const addDomain = useCallback(
    (input: { domain: string; fromEmailLocal: string; fromName: string }) =>
      domainVerb("add", {
        domain: input.domain.trim().toLowerCase(),
        from_email_local: input.fromEmailLocal.trim() || "no-reply",
        from_name: input.fromName.trim(),
      }),
    [domainVerb],
  );
  const refreshDomain = useCallback((id: string) => domainVerb("refresh", { id }), [domainVerb]);
  const setDefaultDomain = useCallback((id: string) => domainVerb("set_default", { id }), [domainVerb]);
  const removeDomain = useCallback((id: string) => domainVerb("remove", { id }), [domainVerb]);

  /**
   * Returns Google's consent URL. It does NOT navigate.
   *
   * The caller opens it, so the provider handshake is something the person
   * chose, in a window they can see — never a redirect this adapter performed
   * on their behalf.
   */
  const startGmailConnect = useCallback(async (): Promise<{ url: string | null; error: string | null }> => {
    const epoch = gmailScope.current.epoch;
    const current = () => gmailMounted.current && gmailScope.current.epoch === epoch
      && gmailScope.current.tenantId === tenantId && gmailScope.current.activeUserId === activeUserId
      && !gmailScope.current.tenantLoading;
    const changed = { url: null, error: "Workspace changed. Refresh this workspace before connecting Google." };
    if (!tenantId || !activeUserId || tenantLoading || !current()) return changed;
    try {
      const { data, error: fnError } = await supabase.functions.invoke("gmail-oauth-start", {
        body: { origin: window.location.origin, expected_tenant_id: tenantId },
      });
      if (!current()) return changed;
      const rec = asRecord(data);
      if (rec.error === "workspace_changed") return changed;
      const url = str(rec.authorization_url);
      if (fnError || rec.error || !url) {
        // The likeliest real answer here is `gmail_oauth_not_configured` — the
        // function's own header says so — and that is a "not switched on yet"
        // note, not a failure scream. Left raw it read as "Edge Function returned
        // a non-2xx status code".
        const { message, code } = await resolveFunctionError({
          error: fnError, data, action: "connect a Google account",
        });
        if (code === "workspace_changed") return changed;
        return current() ? { url: null, error: message } : changed;
      }
      return { url, error: null };
    } catch (e) {
      return current() ? { url: null, error: asResult(e).error } : changed;
    }
  }, [tenantId, activeUserId, tenantLoading]);

  const disconnectGmail = useCallback(async (): Promise<SoloMutationResult> => {
    const selected = mailbox;
    const epoch = gmailScope.current.epoch;
    const current = () => gmailMounted.current && gmailScope.current.epoch === epoch
      && gmailScope.current.tenantId === tenantId && gmailScope.current.activeUserId === activeUserId
      && !gmailScope.current.tenantLoading;
    const changed = { ok: false, error: "Workspace changed. Check the original workspace's Google connection before retrying." };
    const unknown = { ok: false, error: "The Google disconnect could not be confirmed. Inspect the original workspace before retrying." };
    const nativeFailure = (rec: Record<string, unknown>): SoloMutationResult | null => {
      const code = rec.error;
      if (code === "workspace_changed") return changed;
      if (code === "gmail_connection_changed") return { ok: false,
        error: "The Google connection changed. Refresh its current state before disconnecting it." };
      if (code === "gmail_disconnected_result_withheld") return rec.disconnected === true ? { ok: false,
        error: "PAIGE disconnected Google in the original workspace. Refresh that workspace to inspect the result." } : unknown;
      if (code === "gmail_disconnect_outcome_unknown") return unknown;
      return null;
    };
    if (!tenantId || !activeUserId || tenantLoading || !current()) return changed;
    if (loadedTenantId !== tenantId || !selected?.connected || !selected.address || selected.provider !== "gmail" || !selected.connectorId || !selected.updatedAt
      || !Number.isFinite(Date.parse(selected.updatedAt))
      || visibleGmail.current?.connectorId !== selected.connectorId || visibleGmail.current?.updatedAt !== selected.updatedAt) {
      return { ok: false, error: "The Google connection changed or could not be read. Refresh before disconnecting it." };
    }
    try {
      const { data, error: fnError } = await supabase.functions.invoke("gmail-disconnect", {
        body: { expected_tenant_id: tenantId, connector_id: selected.connectorId, expected_updated_at: selected.updatedAt },
      });
      if (!current()) return changed;
      const rec = asRecord(data ?? await readFunctionErrorBody(fnError, data));
      if (!current()) return changed;
      const nativeMessage = nativeFailure(rec);
      if (nativeMessage) return nativeMessage;
      if (fnError || rec.error) {
        const { message, code } = await resolveFunctionError({
          error: fnError, data: rec, action: "disconnect the Google account",
        });
        if (!current()) return changed;
        return code ? { ok: false, error: message } : unknown;
      }
      // `gmail-disconnect` answers `{ ok: true, disconnected: false }` when it
      // found no connector to revoke — a NO-OP, not a disconnection. Reporting
      // that as "Disconnected." tells someone their account is detached while it
      // is still active and still sending, which is the §13 failure this branch
      // exists to remove, not to add.
      if (rec.ok === true && rec.disconnected === false) {
        return { ok: false, error: "Nothing was disconnected — no connected Google account was found on this workspace." };
      }
      if (rec.ok !== true || rec.disconnected !== true || rec.connector_id !== selected.connectorId) return unknown;
      await load();
      return current() ? { ok: true, error: null } : changed;
    } catch {
      return current() ? unknown : changed;
    }
  }, [load, tenantId, activeUserId, tenantLoading, mailbox, loadedTenantId]);

  return useMemo(
    () => ({
      loading: loading || tenantLoading || Boolean(tenantId && loadedTenantId !== tenantId),
      error,
      isSubAccount,
      domains: loadedTenantId === tenantId ? domains : [],
      sending: loadedTenantId === tenantId ? sending : { fromName: null, supportEmail: null, defaultSender: null },
      billing: loadedTenantId === tenantId ? billing : null,
      mailbox: loadedTenantId === tenantId ? mailbox : null,
      canManage: loadedTenantId === tenantId ? canManage : false,
      refresh,
      addDomain,
      refreshDomain,
      setDefaultDomain,
      removeDomain,
      startGmailConnect,
      disconnectGmail,
    }),
    [
      loading, tenantLoading, tenantId, loadedTenantId, error, isSubAccount, domains, sending,
      billing, mailbox, canManage, refresh, addDomain, refreshDomain,
      setDefaultDomain, removeDomain, startGmailConnect, disconnectGmail,
    ],
  );
}
