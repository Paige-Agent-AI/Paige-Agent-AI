// The tenant's CLIENT AGREEMENTS read — Campaigns → Sales, Slice 2.
//
// WHAT THIS IS. Catalog says what the business SELLS. An agreement is the different fact: what ONE
// named client agreed to, on terms that may not be the list terms. This hook reads the agreements,
// the minimum client identity needed to choose one, and whether the caller may write any of it.
//
// WHAT IT DELIBERATELY DOES NOT DO.
// - It does not read offers. `useCatalogOffers` is the one home for the canonical offer record
//   (§18) and the surface calls it directly, exactly as `sales-ops.tsx` already does. If this file
//   ever grows a `products` array of its own, that is the bug.
// - It does not create, edit or copy client records. The read is SELECT-only and projects six
//   columns, and the agreement row holds a `contact_id` POINTER — never a copied name or email.
//   This is structurally backed rather than promised: the live ACL on `public.clients` is
//   `authenticated=rwdDxtm`, with no `a`, so PostgREST cannot insert a client from here at all.
// - It computes no revenue, no forecast, no attribution, no "performance". An agreement records
//   what was agreed; it observes nothing about whether it was paid, invoiced or delivered, and the
//   status vocabulary has no word for any of those (§13/§38).
import { useCallback, useEffect, useRef, useState } from "react";
import { useTenantContext } from "@/hooks/useTenantContext";
import { supabase } from "@/integrations/supabase/client";
import { CLIENT_CONTACT_METHODS_EMBED, primaryAddressesOf, type ContactMethodRow } from "@/lib/contact-methods";

// The picker's six identity columns; the email is the contact's primary, from its contact methods.
// Widened to string: the generated types do not know the contact-methods embed yet.
const CLIENT_CONTACT_METHODS_TABLE = "client_contact_methods";
const AGREEMENT_CLIENT_SELECT: string = `id,first_name,last_name,entity_name,entity_type,${CLIENT_CONTACT_METHODS_EMBED}`;

/** Mirrors `tenant_client_agreements_term_kind_check`. */
export type TermKind = "one_time" | "recurring" | "installment" | "deposit" | "custom_quote";
export const TERM_KINDS: readonly TermKind[] =
  ["one_time", "recurring", "installment", "deposit", "custom_quote"];

/** Mirrors `tenant_client_agreements_price_basis_check`. */
export type PriceBasis = "catalog" | "negotiated" | "quote_pending";
export const PRICE_BASES: readonly PriceBasis[] = ["catalog", "negotiated", "quote_pending"];

export type BillingInterval = "one_time" | "day" | "week" | "month" | "year";
export const BILLING_INTERVALS: readonly BillingInterval[] =
  ["one_time", "day", "week", "month", "year"];

export type PaymentSchedule =
  | "on_signing" | "on_start" | "in_advance" | "in_arrears" | "on_milestone" | "custom";
export const PAYMENT_SCHEDULES: readonly PaymentSchedule[] =
  ["on_signing", "on_start", "in_advance", "in_arrears", "on_milestone", "custom"];

/**
 * The owner-ruled state set, plus `unrecognised` for a value this build has no reading for. The
 * sixth member is not a state anything can record: it is what the surface SAYS when a later
 * migration widens the CHECK and this deployment has not caught up. Coercing it to `draft` would
 * assert a commercial state the record does not prove — the same rule `OrderStatus` follows.
 *
 * There is deliberately no `paid`, `invoiced` or `delivered`. This table can observe none of them.
 */
export type AgreementStatus =
  | "draft" | "active" | "paused" | "completed" | "cancelled" | "unrecognised";
const AGREEMENT_STATUSES: readonly AgreementStatus[] =
  ["draft", "active", "paused", "completed", "cancelled"];

/** The minimum client identity a picker needs. Six columns, and every one is load-bearing. */
export type AgreementClient = {
  readonly id: string;
  /**
   * Composed by the SAME precedence `useTenantRelationshipsData.clientName` uses. Copied rather
   * than approximated on purpose: a row carrying both a person name and a company name would
   * otherwise render one way in Sales and the other in Clients — two surfaces disagreeing about
   * one client's name (§57). That divergence is already live in the Deals picker
   * (`NewDealDialog.tsx` selects five columns without `entity_type` and builds its own label);
   * this does not add a third opinion.
   */
  readonly name: string;
};

export type ClientAgreement = {
  readonly id: string;
  readonly contactId: string;
  readonly offerId: string;
  readonly title: string | null;
  readonly notes: string | null;
  readonly termKind: TermKind | null;
  readonly billingInterval: BillingInterval | null;
  readonly intervalCount: number | null;
  readonly installmentsTotal: number | null;
  readonly paymentSchedule: PaymentSchedule | null;
  readonly priceBasis: PriceBasis | null;
  /** MINOR units, exactly as the column stores them. Never divided here — see `money()`. */
  readonly agreedAmountMinor: number | null;
  readonly agreedCurrency: string | null;
  /** What the catalog said when this was written. Dated, immutable, and never written back. */
  readonly catalogSnapshotMinor: number | null;
  readonly catalogSnapshotCurrency: string | null;
  readonly catalogSnapshotAt: string | null;
  readonly startsOn: string | null;
  readonly renewsOn: string | null;
  readonly endsOn: string | null;
  readonly status: AgreementStatus;
  readonly updatedAt: string | null;
};

/**
 * What the editor sends. `tenantId` is the workspace the FORM WAS OPENED AGAINST — not the current
 * one. Sending the current tenant makes the server's refusal guard unable to fire, because the
 * caller keeps agreeing with itself; that exact mistake shipped once on `save_solo_offer` and cost
 * a workspace-A offer created in workspace B.
 */
export type AgreementDraft = {
  readonly tenantId: string | null;
  readonly id: string | null;
  readonly contactId: string;
  readonly offerId: string;
  readonly termKind: TermKind;
  readonly priceBasis: PriceBasis;
  readonly catalogPriceId: string | null;
  readonly agreedAmountMinor: number | null;
  readonly agreedCurrency: string | null;
  readonly billingInterval: BillingInterval | null;
  readonly intervalCount: number | null;
  readonly installmentsTotal: number | null;
  readonly paymentSchedule: PaymentSchedule | null;
  readonly startsOn: string | null;
  readonly renewsOn: string | null;
  readonly endsOn: string | null;
  readonly title: string | null;
  readonly notes: string | null;
  readonly expectedUpdatedAt: string | null;
};

export type AgreementWriteResult = {
  readonly ok: boolean;
  readonly message?: string;
  /** True on 40001. The surface must offer RELOAD, never retry — a retry overwrites the other writer. */
  readonly stale?: boolean;
  readonly result?: Record<string, unknown> | null;
};

export type AgreementsState = {
  readonly tenantId: string | null;
  readonly phase: "resolving" | "loading" | "ready" | "error" | "unavailable";
  readonly agreements: readonly ClientAgreement[];
  readonly clients: readonly AgreementClient[];
  /**
   * FALSE when the caller cannot read `clients` at all.
   *
   * This CANNOT be derived from `!error`, and that is the whole reason the flag is computed the way
   * it is. `clients` GRANTs SELECT to `authenticated` and gates on RLS, and RLS is a ROW FILTER —
   * a caller matching no permissive policy gets HTTP 200, an EMPTY array and NO error. A plain
   * tenant member is exactly that caller: `tenant_role 'member'` maps to `app_role 'user'`, and
   * none of the ten live policies on `clients` references `'user'`. Modelling authorization as an
   * error channel here would make this flag unreachable — the identical defect that shipped on
   * `ordersReadable` and had to be repaired.
   */
  readonly clientsReadable: boolean;
  /**
   * The same rule, for this table's own read. `tenant_client_agreements` GRANTs SELECT to
   * `authenticated` and gates on RLS, so a caller outside the policy gets 200/[]/no error here
   * too — which means `if (error)` is unreachable for authorization and cannot stand in for it.
   *
   * This is NOT the same flag as `clientsReadable`, and proxying one off the other fails for a
   * COACH: `clients_coaches_assigned` returns their assigned clients, so the client read succeeds,
   * while the agreements read is row-filtered to that same subset. A coach whose assigned clients
   * happen to have no terms, in a workspace holding twelve, would be told "Nothing recorded yet."
   */
  readonly agreementsReadable: boolean;
  readonly canManage: boolean;
  /** The authority read itself failed. Distinct from "the caller is not an admin". */
  readonly authorityUnknown: boolean;
  readonly retry: () => void;
  readonly saveAgreement: (draft: AgreementDraft) => Promise<AgreementWriteResult>;
  readonly setAgreementStatus: (
    id: string,
    status: Exclude<AgreementStatus, "unrecognised">,
    expectedUpdatedAt: string | null,
    loadedTenantId: string | null,
  ) => Promise<AgreementWriteResult>;
};

const EMPTY = {
  agreements: [] as readonly ClientAgreement[],
  clients: [] as readonly AgreementClient[],
  clientsReadable: false,
  agreementsReadable: false,
  canManage: false,
  authorityUnknown: false,
};

/** An unrecognised value is narrowed to null rather than coerced. */
function narrow<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : null;
}

function toNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toText(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

// Public copy is chosen from stable error codes, never database/provider messages.
function safeWriteMessage(code?: string): string {
  if (code === "40001") return "Someone else changed this record. Close and reopen it before saving.";
  if (code === "42501") return "Your permission or workspace changed. Reopen this form with owner or admin access.";
  if (code === "22023" || code === "23514" || code === "22P02") return "Check the selected records, amounts and dates, then try again.";
  return "The save could not be confirmed. Refresh and check your records before trying again.";
}

export function useSoloAgreements(): AgreementsState {
  const { activeTenantId, accountContextLoading } = useTenantContext();
  // An identity epoch also invalidates a completion after A -> B -> A.
  const identity = useRef({ tenantId: activeTenantId, resolving: accountContextLoading });
  if (identity.current.tenantId !== activeTenantId || identity.current.resolving !== accountContextLoading) {
    identity.current = { tenantId: activeTenantId, resolving: accountContextLoading };
  }

  const [refreshKey, setRefreshKey] = useState(0);
  const [state, setState] = useState<
    Omit<AgreementsState, "retry" | "saveAgreement" | "setAgreementStatus">
  >({
    tenantId: activeTenantId ?? null,
    phase: accountContextLoading ? "resolving" : "loading",
    ...EMPTY,
  });
  const retry = useCallback(() => setRefreshKey((key) => key + 1), []);

  const saveAgreement = useCallback(async (draft: AgreementDraft): Promise<AgreementWriteResult> => {
    // The draft's OWN tenant, never the current one. If the workspace changed while the drawer was
    // open, this disagrees with the server's session tenant and the write is refused — which is
    // the entire point of a refusal-only guard.
    if (!draft.tenantId) {
      return { ok: false, message: "This workspace could not be resolved, so nothing was saved." };
    }
    const openedIdentity = identity.current;
    if (openedIdentity.resolving || !openedIdentity.tenantId) {
      return { ok: false, message: "Wait for your workspace to finish loading, then try again." };
    }
    try {
      const { data, error } = await supabase.rpc(
        "save_client_agreement" as never,
        {
          _expected_tenant_id: draft.tenantId,
          _agreement_id: draft.id,
          _contact_id: draft.contactId,
          _offer_id: draft.offerId,
          _term_kind: draft.termKind,
          _price_basis: draft.priceBasis,
          // An ID only. The server reads the amount off `tenant_prices` itself, so the browser
          // cannot forge what the catalog said.
          _catalog_price_id: draft.catalogPriceId,
          _agreed_amount_minor: draft.agreedAmountMinor,
          _agreed_currency: draft.agreedCurrency,
          _billing_interval: draft.billingInterval,
          _interval_count: draft.intervalCount,
          _installments_total: draft.installmentsTotal,
          _payment_schedule: draft.paymentSchedule,
          _starts_on: draft.startsOn,
          _renews_on: draft.renewsOn,
          _ends_on: draft.endsOn,
          _title: draft.title,
          _notes: draft.notes,
          _expected_updated_at: draft.expectedUpdatedAt,
        } as never,
      );
      if (identity.current !== openedIdentity) {
        return { ok: false, message: "Your workspace changed. Reopen this form in the intended workspace." };
      }
      if (error) {
        console.error("[sales] save_client_agreement failed", { code: error.code });
        // 40001 means someone else wrote while this drawer was open. It is NOT a retry: retrying
        // would overwrite them. The surface offers a reload instead.
        const stale = error.code === "40001";
        return {
          ok: false,
          stale,
          message: safeWriteMessage(error.code),
        };
      }
      if (data === null || data === undefined) {
        return { ok: false, message: "The save could not be confirmed. Refresh and check your records before trying again." };
      }
      setRefreshKey((key) => key + 1);
      return { ok: true, result: (data ?? null) as Record<string, unknown> | null };
    } catch {
      return {
        ok: false,
        message: identity.current !== openedIdentity
          ? "Your workspace changed. Reopen this form in the intended workspace."
          : "The save could not be confirmed. Refresh and check your records before trying again.",
      };
    }

  }, []);

  const setAgreementStatus = useCallback(async (
    id: string,
    status: Exclude<AgreementStatus, "unrecognised">,
    expectedUpdatedAt: string | null,
    // The workspace the ROW WAS LOADED AGAINST. Sending the CURRENT tenant instead makes the
    // server's refusal guard unable to fire, because the caller keeps agreeing with itself — the
    // same anti-pattern `useCatalogOffers` records. It failed closed only by accident, through the
    // UPDATE's own row scope, and answered "that agreement is not in this workspace" when the real
    // answer was "your workspace changed".
    loadedTenantId: string | null,
  ): Promise<AgreementWriteResult> => {
    const expected = loadedTenantId ?? activeTenantId;
    if (!expected) {
      return { ok: false, message: "This workspace could not be resolved, so nothing was changed." };
    }
    const openedIdentity = identity.current;
    if (openedIdentity.resolving || !openedIdentity.tenantId) {
      return { ok: false, message: "Wait for your workspace to finish loading, then try again." };
    }
    try {
      const { data, error } = await supabase.rpc(
        "set_client_agreement_status" as never,
        {
          _expected_tenant_id: expected,
          _agreement_id: id,
          _status: status,
          _expected_updated_at: expectedUpdatedAt,
        } as never,
      );
      if (identity.current !== openedIdentity) {
        return { ok: false, message: "Your workspace changed. Reopen this form in the intended workspace." };
      }
      if (error) {
        console.error("[sales] set_client_agreement_status failed", { code: error.code });
        return {
          ok: false,
          stale: error.code === "40001",
          message: safeWriteMessage(error.code),
        };
      }
      if (data === null || data === undefined) {
        return { ok: false, message: "The save could not be confirmed. Refresh and check your records before trying again." };
      }
      setRefreshKey((key) => key + 1);
      return { ok: true, result: (data ?? null) as Record<string, unknown> | null };
    } catch {
      return {
        ok: false,
        message: identity.current !== openedIdentity
          ? "Your workspace changed. Reopen this form in the intended workspace."
          : "The save could not be confirmed. Refresh and check your records before trying again.",
      };
    }

  }, [activeTenantId]);

  useEffect(() => {
    let current = true;

    // Fail closed on identity, exactly as the sibling adapters do. No tenant, no read.
    if (accountContextLoading) {
      setState({ tenantId: activeTenantId ?? null, phase: "resolving", ...EMPTY });
      return () => { current = false; };
    }
    if (!activeTenantId) {
      setState({ tenantId: null, phase: "unavailable", ...EMPTY });
      return () => { current = false; };
    }

    setState({ tenantId: activeTenantId, phase: "loading", ...EMPTY });
    void (async () => {
      try {
        const { data: authData } = await supabase.auth.getUser();
        const callerId = authData.user?.id ?? null;

        const [agreementResponse, clientResponse, roleResponse] = await Promise.all([
          supabase
            .from("tenant_client_agreements" as never)
            .select(
              "id,contact_id,offer_id,title,notes,term_kind,billing_interval,interval_count," +
              "installments_total,payment_schedule,price_basis,agreed_amount_minor,agreed_currency," +
              "catalog_price_snapshot_minor,catalog_price_snapshot_currency,catalog_price_snapshot_at," +
              "starts_on,renews_on,ends_on,status,updated_at",
            )
            .eq("tenant_id", activeTenantId)
            .order("created_at", { ascending: false })
            .limit(200),
          // The picker's read. Six columns, the tenant filter, and nothing else.
          //
          // `.eq("tenant_id", ...)` is NOT redundant with RLS. Three live paths admit a foreign
          // row without it: `is_platform_owner()` is a disjunct in BOTH the restrictive isolation
          // policy and `clients_admins_full`, so a platform operator acting inside a tenant would
          // otherwise see every client on the platform; `clients_linked_self_read` matches any row
          // linked to the caller's own user in any tenant; and `current_user_tenant_id()` reads
          // `profiles.active_tenant_id`, which a workspace switch writes before the browser
          // repaints. The filter closes the first two outright and the synchronous guard below
          // closes the third.
          supabase
            .from("clients")
            .select(AGREEMENT_CLIENT_SELECT)
            .eq("tenant_id", activeTenantId)
            // Identity only: of the contact's methods, just its primary email (the name fallback).
            .eq(`${CLIENT_CONTACT_METHODS_TABLE}.kind`, "email")
            .eq(`${CLIENT_CONTACT_METHODS_TABLE}.is_primary`, true)
            .order("created_at", { ascending: false })
            .limit(250),
          callerId
            ? supabase
                .from("tenant_members")
                .select("role")
                .eq("tenant_id", activeTenantId)
                .eq("user_id", callerId)
                .maybeSingle()
            : Promise.resolve({ data: null, error: null } as { data: null; error: null }),
        ]);

        if (!current) return;

        if (agreementResponse.error) {
          console.error("[agreements] agreement read failed", agreementResponse.error);
          setState({ tenantId: activeTenantId, phase: "error", ...EMPTY });
          return;
        }

        const rows = (agreementResponse.data ?? []) as unknown as Record<string, unknown>[];
        const agreements: ClientAgreement[] = rows.map((row) => ({
          id: String(row.id),
          contactId: String(row.contact_id),
          offerId: String(row.offer_id),
          title: toText(row.title),
          notes: toText(row.notes),
          termKind: narrow(row.term_kind, TERM_KINDS),
          billingInterval: narrow(row.billing_interval, BILLING_INTERVALS),
          intervalCount: toNumber(row.interval_count),
          installmentsTotal: toNumber(row.installments_total),
          paymentSchedule: narrow(row.payment_schedule, PAYMENT_SCHEDULES),
          priceBasis: narrow(row.price_basis, PRICE_BASES),
          agreedAmountMinor: toNumber(row.agreed_amount_minor),
          agreedCurrency: toText(row.agreed_currency),
          catalogSnapshotMinor: toNumber(row.catalog_price_snapshot_minor),
          catalogSnapshotCurrency: toText(row.catalog_price_snapshot_currency),
          catalogSnapshotAt: toText(row.catalog_price_snapshot_at),
          startsOn: toText(row.starts_on),
          renewsOn: toText(row.renews_on),
          endsOn: toText(row.ends_on),
          // A value this build cannot read is NAMED, never coerced into a state it might not be.
          status: narrow(row.status, AGREEMENT_STATUSES) ?? "unrecognised",
          updatedAt: toText(row.updated_at),
        }));

        const clientRows = (clientResponse.data ?? []) as unknown as Record<string, unknown>[];
        const clients: AgreementClient[] = clientRows.map((row) => {
          const full = `${toText(row.first_name) ?? ""} ${toText(row.last_name) ?? ""}`.trim();
          const company = toText(row.entity_name)?.trim();
          const entityType = toText(row.entity_type)?.trim();
          const name = company && (Boolean(entityType) || !full)
            ? company
            : full || company || primaryAddressesOf(row.client_contact_methods as ContactMethodRow[] | null).email?.trim() || "Unnamed contact";
          return { id: String(row.id), name };
        });

        const role = typeof roleResponse.data?.role === "string" ? roleResponse.data.role : null;
        const canManage = role === "owner" || role === "admin";

        // See `clientsReadable` above: authority, not the error channel. The `|| length > 0`
        // disjunct keeps a platform operator and an assigned coach honest — a coach satisfies
        // `clients_coaches_assigned` without holding a tenant_members admin role, so authority
        // alone would tell them their successful read had failed.
        //
        // HONEST CAVEAT (§13): this is an APPROXIMATION of a ten-policy disjunction, not a mirror
        // of it. It is exact for the two callers a Solo workspace actually has — owner/admin can
        // read, member cannot — and it fails SAFE for the rest: a coach with zero assigned clients
        // reads as "unknown" rather than "none". Claiming it mirrors RLS would be the false green.
        const clientsReadable =
          !clientResponse.error && (canManage || clients.length > 0);
        // Derived from THIS table's own policy shape, never proxied off the client read.
        const agreementsReadable =
          !agreementResponse.error && (canManage || agreements.length > 0);

        setState({
          tenantId: activeTenantId,
          phase: "ready",
          agreements,
          clients,
          clientsReadable,
          agreementsReadable,
          canManage,
          authorityUnknown: Boolean(roleResponse.error) || !callerId,
        });
      } catch (error) {
        console.error("[agreements] tenant-scoped agreements read failed", error);
        if (!current) return;
        setState({ tenantId: activeTenantId, phase: "error", ...EMPTY });
      }
    })();

    return () => { current = false; };
  }, [activeTenantId, accountContextLoading, refreshKey]);

  // The synchronous tenant guard, copied from the sibling adapters rather than reinvented.
  // `setState` inside the effect runs AFTER paint, so on the render where `activeTenantId` changes
  // IN PLACE — which is what `switchTenant` does, without remounting, because `GrowthHub` is keyed
  // by route and not by tenant — `state` still holds the PREVIOUS workspace's data. Here that
  // would paint another tenant's CLIENT NAMES BOUND TO NEGOTIATED AMOUNTS, which is the most
  // sensitive commercial record this product holds. The surface's own "clear the drawer on switch"
  // effect also depends on this: it keys on `tenantId`, and only fires on the switch paint because
  // the value it reads is the guarded one.
  const synchronousTenantId = activeTenantId ?? null;
  const visible = !accountContextLoading && state.tenantId === synchronousTenantId ? state : {
    tenantId: synchronousTenantId,
    phase: accountContextLoading ? "resolving" as const
      : synchronousTenantId ? "loading" as const
      : "unavailable" as const,
    ...EMPTY,
  };
  return { ...visible, retry, saveAgreement, setAgreementStatus };
}
