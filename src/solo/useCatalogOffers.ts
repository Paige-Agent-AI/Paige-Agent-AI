// The tenant's canonical OFFER read — Campaigns → Catalog → Offers (Slice 2A).
//
// WHY THIS IS ITS OWN HOOK AND NOT A FIFTH READ INSIDE `useSoloCampaigns`.
// `growth2.contract.test.tsx` asserts that the campaigns adapter performs EXACTLY four
// `.eq("tenant_id", activeTenantId)` reads. That assertion exists to prove the adapter fails
// closed on tenant identity, and it is worth keeping sharp — a test that has to be edited every
// time a read is added stops being a guard. Offers are a different domain (the tenant's
// commercial record) from published creative artifacts (Vibe Studio's output), so they get their
// own adapter carrying its own identical fail-closed guard, and the existing assertion is left
// untouched. `catalog-offers.contract.test.tsx` asserts the same discipline over this file.
//
// It also keeps the diff off `useSoloCampaigns.ts`, which PR #706 currently owns.
//
// TRUTH BOUNDARY (§13). This reads what the tenant has recorded. It does not compute revenue,
// stock, conversion or demand, because none of those exist. A price recorded here is a PRESENTED
// price, never a checkout: tenant checkout is unreachable in production today.
import { useCallback, useEffect, useState } from "react";
import { useTenantContext } from "@/hooks/useTenantContext";
import { supabase } from "@/integrations/supabase/client";

/**
 * Mirrors `tenant_prices.kind` — what SHAPE of plan a price row is, allow-listed here because it
 * was the one classified field the adapter passed through raw. An unmapped value reached the
 * surface, produced no sub-label, and fell through to the presentation label, printing "Fixed
 * amount" over a per-period figure with only a database CHECK standing in the way.
 */
export type OfferPlanKind = "one_time" | "deposit" | "recurring" | "installment";

/**
 * Mirrors `tenant_products.status` after migration 20261048000000 — the four recorded states,
 * plus `unrecognised` for a value this build has no reading for. That fifth member is NOT a status
 * a tenant can record: it is what the surface says when the column holds something a later
 * migration added and this deployment does not know. Coercing it to "draft" was safe — a draft is
 * shown to nobody — but it asserted a state the record does not prove, which is the same class of
 * lie as a price the record does not prove.
 */
export type OfferAvailability = "draft" | "active" | "paused" | "archived" | "unrecognised";
/**
 * `tenant_products.product_type` is BILLING CADENCE, not product-vs-service — its CHECK is
 * ('one_time','recurring','service') but the only writer on production
 * (`tenant-product-upsert`) sets it from whether a recurring plan exists and never writes
 * 'service'. Deriving Product/Service from it would have labelled every coaching retainer a
 * "Product". The commercial kind is its own column, added by 20261048000000.
 */
export type OfferBillingCadence = "one_time" | "recurring" | "service";
export type OfferKind = "product" | "service";
export type OfferDeliveryShape =
  | "digital" | "physical" | "appointment" | "program" | "membership" | "hybrid";
export type OfferPricePresentation = "fixed" | "from" | "contact" | "none";
export type OfferCustomerAction = "buy" | "book" | "apply" | "enquire" | "learn";

export type OfferPrice = {
  readonly id: string;
  readonly nickname: string | null;
  /** Minor units, exactly as `tenant_prices.unit_amount` stores them. */
  readonly unitAmount: number | null;
  readonly currency: string | null;
  readonly billingInterval: string | null;
  readonly intervalCount?: number | null;
  readonly kind: OfferPlanKind | null;
  /** Number of instalments when `kind === "installment"`. `unitAmount` is then PER INSTALMENT. */
  readonly installmentsTotal: number | null;
  readonly active: boolean;
};

export type CatalogOffer = {
  readonly id: string;
  readonly name: string;
  /** One customer-facing sentence. Null when the tenant has not written one. */
  readonly summary: string | null;
  readonly description: string | null;
  readonly availability: OfferAvailability;
  readonly billingCadence: OfferBillingCadence;
  /** Null until the tenant states it. Never guessed from billing cadence. */
  readonly kind: OfferKind | null;
  readonly deliveryShape: OfferDeliveryShape | null;
  readonly pricePresentation: OfferPricePresentation | null;
  readonly customerAction: OfferCustomerAction | null;
  readonly category: string | null;
  readonly imageUrl: string | null;
  readonly updatedAt: string | null;
  /** Every recorded price, ordered as the tenant ordered them. Never collapsed to one. */
  readonly prices: readonly OfferPrice[];
};

export type CatalogOffersOptions = {
  readonly search?: string;
  /** Zero-based page; applied only when options are supplied. */
  readonly page?: number;
  readonly pageSize?: number;
  /** Exact canonical records needed alongside search, never merged into the result page. */
  readonly referenceIds?: readonly string[];
};

export type CatalogOffersState = {
  readonly tenantId: string | null;
  readonly phase: "resolving" | "loading" | "ready" | "error" | "unavailable";
  readonly offers: readonly CatalogOffer[];
  readonly hasMore: boolean;
  readonly referencedOffers: readonly CatalogOffer[];
  /** True only for a tenant admin/owner. Slice 2A shows no acts; 2B gates its commands on this. */
  readonly canManage: boolean;
  /** The authority read itself failed. Distinct from "the caller is not an admin". */
  readonly authorityUnknown: boolean;
  /** The offer columns are not on this deployment yet, so classified fields read as absent. */
  readonly fieldsUnavailable: boolean;
  readonly retry: () => void;
  /** Slice 2B. Create when `draft.id` is null, edit when it is set. Never changes status. */
  readonly saveOffer: (draft: OfferDraft) => Promise<OfferWriteResult>;
  /** Slice 2B. The lifecycle, separate from the editor — see `set_solo_offer_status`. */
  readonly setOfferStatus: (
    offerId: string,
    next: OfferAvailability,
    expectedUpdatedAt: string | null,
  ) => Promise<OfferWriteResult>;
};

/**
 * What the editor collects. Deliberately NOT `Partial<CatalogOffer>`: a draft is what a person
 * typed, so every optional field is an empty string rather than absent, and `expectedUpdatedAt`
 * carries the version the form was opened against so a concurrent edit refuses instead of winning.
 */
export type OfferDraft = {
  readonly id: string | null;
  /** The workspace this form was opened in. Sent as `_expected_tenant_id` so a switch ABORTS. */
  readonly tenantId: string | null;
  /** The exact `tenant_prices` row the form was populated from, or null if no plan was shown. */
  readonly priceId: string | null;
  readonly name: string;
  readonly summary: string;
  readonly description: string;
  readonly kind: OfferKind | "";
  readonly deliveryShape: OfferDeliveryShape | "";
  readonly pricePresentation: OfferPricePresentation | "";
  readonly customerAction: OfferCustomerAction | "";
  readonly category: string;
  /** MINOR units, matching `tenant_prices.unit_amount`. `null` states no price at all. */
  readonly priceAmount: number | null;
  readonly priceCurrency: string;
  readonly priceInterval: "" | "one_time" | "day" | "week" | "month" | "year";
  readonly expectedUpdatedAt: string | null;
};

/**
 * A write reports what actually happened (§13). `ok: false` always means NOTHING was written —
 * both functions are single-statement and atomic, so there is no partial outcome to describe.
 */
export type OfferWriteResult = {
  readonly ok: boolean;
  readonly message?: string;
  /** The row moved under the editor. Offer a reload, never a retry — a retry overwrites them. */
  readonly stale?: boolean;
  readonly result?: {
    id?: string; status?: string; updated_at?: string;
    /** Set when the definition saved but the PRICE was deliberately left alone. */
    price_note?: string | null;
  } | null;
};

const EMPTY = {
  offers: [] as readonly CatalogOffer[],
  hasMore: false,
  referencedOffers: [] as readonly CatalogOffer[],
  canManage: false,
  authorityUnknown: false,
  fieldsUnavailable: false,
};

/**
 * A row is only as classified as the tenant made it. An unrecognised value from the database is
 * narrowed to null rather than coerced into a neighbour — a wrong label is worse than no label.
 */
function narrow<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : null;
}

const SHAPES: readonly OfferDeliveryShape[] =
  ["digital", "physical", "appointment", "program", "membership", "hybrid"];
const PRESENTATIONS: readonly OfferPricePresentation[] = ["fixed", "from", "contact", "none"];
/**
 * What `tenant_prices.kind` may say. This was the ONE classified field the adapter passed through
 * raw while allow-listing every other one, and an independent review proved what that cost: an
 * unmapped kind produced no sub-label, which fell through to the presentation fallback and printed
 * "Fixed amount" over a per-period figure. Only `tenant_prices_kind_check` stood between that and
 * a tenant — a DATABASE constraint guarding a rendering decision, with nothing linking the two, so
 * the day a migration widens the CHECK and forgets the surface it reprints silently. Narrowed here
 * so an unreadable kind is null and the surface can say so.
 */
const PLAN_KINDS: readonly OfferPlanKind[] = ["one_time", "deposit", "recurring", "installment"];
const ACTIONS: readonly OfferCustomerAction[] = ["buy", "book", "apply", "enquire", "learn"];
// `unrecognised` is deliberately absent: it is a READING, never a value that can match a row.
const AVAILABILITIES: readonly OfferAvailability[] = ["draft", "active", "paused", "archived"];

export function useCatalogOffers(options?: CatalogOffersOptions): CatalogOffersState {
  const bounded = options !== undefined;
  const search = (options?.search ?? "").trim().slice(0, 200);
  const pageSize = Number.isFinite(options?.pageSize) ? Math.max(1, Math.min(50, Math.floor(options!.pageSize!))) : 5;
  const page = Number.isFinite(options?.page) ? Math.max(0, Math.min(Math.floor((2147483646 - pageSize) / pageSize), Math.floor(options!.page!))) : 0;
  const referenceIds = [...new Set((options?.referenceIds ?? []).filter(id => typeof id === "string" && id.trim() !== ""))].sort().slice(0, 200);
  // A value key avoids refetching when a caller rebuilds an equivalent options object/ID array.
  const queryKey = bounded ? JSON.stringify([search, page, pageSize, referenceIds]) : "catalog-default";
  const { activeTenantId, accountContextLoading } = useTenantContext();
  const [refreshKey, setRefreshKey] = useState(0);
  const [state, setState] = useState<Omit<CatalogOffersState, "retry" | "saveOffer" | "setOfferStatus"> & { queryKey: string }>({
    queryKey,
    tenantId: activeTenantId ?? null,
    phase: accountContextLoading ? "resolving" : "loading",
    ...EMPTY,
  });
  const retry = useCallback(() => setRefreshKey((key) => key + 1), []);

  // Notifications invalidate; only the canonical tenant-scoped query supplies offer facts.
  useEffect(() => {
    if (!activeTenantId || accountContextLoading) return;
    const changed = (event: Event) => {
      if ((event as CustomEvent<{ tenantId?: unknown }>).detail?.tenantId === activeTenantId) retry();
    };
    const visible = () => { if (document.visibilityState === "visible") retry(); };
    const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("paige-catalog-offers") : null;
    if (channel) channel.onmessage = event => { if (event.data?.tenantId === activeTenantId) retry(); };
    const realtime = typeof supabase.channel === "function"
      ? supabase.channel("catalog-offers:" + crypto.randomUUID())
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "tenant_products", filter: "tenant_id=eq." + activeTenantId }, retry)
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "tenant_products", filter: "tenant_id=eq." + activeTenantId }, retry)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "tenant_prices", filter: "tenant_id=eq." + activeTenantId }, retry)
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "tenant_prices", filter: "tenant_id=eq." + activeTenantId }, retry)
        .subscribe()
      : null;
    window.addEventListener("paige:catalog-offers-changed", changed);
    window.addEventListener("focus", retry);
    document.addEventListener("visibilitychange", visible);
    return () => {
      window.removeEventListener("paige:catalog-offers-changed", changed);
      window.removeEventListener("focus", retry);
      document.removeEventListener("visibilitychange", visible);
      channel?.close();
      if (realtime) void supabase.removeChannel(realtime);
    };
  }, [activeTenantId, accountContextLoading, retry]);

  // WHY THE MUTATIONS LIVE HERE AND NOT IN THE COMPONENT. Every write has to refresh the read that
  // rendered the form, and the read's tenant is resolved here. Putting the write in the component
  // would give it a second opinion about which workspace it is in — which is precisely the class of
  // bug the synchronous guard below exists to prevent, moved one layer up.
  //
  // `_expected_tenant_id` is REFUSAL-ONLY on the server: it never selects a workspace, it can only
  // abort. Sending the tenant this hook currently believes it is in is what makes a form opened
  // against one catalog fail rather than silently save into another.
  const runWrite = useCallback(async (
    fn: "save_solo_offer" | "set_solo_offer_status",
    args: Record<string, unknown>,
  ): Promise<OfferWriteResult> => {
    if (!activeTenantId) {
      return { ok: false, message: "This workspace could not be resolved, so nothing was saved." };
    }
    const { data, error } = await supabase.rpc(
      fn as never,
      // The caller's own `_expected_tenant_id` WINS where it supplies one — that is the whole
      // point of finding 1's fix, so the spread order here is load-bearing rather than stylistic.
      { _expected_tenant_id: activeTenantId, ...args } as never,
    );
    if (error) {
      // The server writes these sentences for the person, not for a log, so they are surfaced as
      // written rather than replaced with a generic failure. A message we cannot read still says
      // plainly that nothing changed, because the functions are single-statement and atomic.
      console.error(`[catalog-offers] ${fn} failed`, error);
      return {
        ok: false,
        message: error.message || "That could not be saved. Nothing was changed.",
        // 40001 is the optimistic-concurrency refusal: someone else moved the row first. The
        // surface offers a reload rather than a retry, because retrying would overwrite them.
        stale: error.code === "40001",
      };
    }
    window.dispatchEvent(new CustomEvent("paige:catalog-offers-changed", { detail: { tenantId: activeTenantId } }));
    if (typeof BroadcastChannel !== "undefined") {
      const channel = new BroadcastChannel("paige-catalog-offers");
      channel.postMessage({ tenantId: activeTenantId });
      channel.close();
    }
    return { ok: true, result: (data ?? null) as OfferWriteResult["result"] };
  }, [activeTenantId]);

  const saveOffer = useCallback((draft: OfferDraft) => runWrite("save_solo_offer", {
    // The workspace the FORM WAS OPENED AGAINST, not the one the hook is in now. An independent
    // review proved why: `_expected_tenant_id` is refusal-only on the server and correct, but the
    // client was sending the CURRENT tenant — so an owner who opened a new-offer form in workspace
    // A, switched to B and pressed Save saw no mismatch, and A's drafted offer was created in B.
    // The guard could never fire because the caller kept agreeing with itself.
    _expected_tenant_id: draft.tenantId,
    _offer_id: draft.id ?? null,
    _name: draft.name,
    _summary: draft.summary || null,
    _description: draft.description || null,
    _offer_kind: draft.kind || null,
    _delivery_shape: draft.deliveryShape || null,
    _price_presentation: draft.pricePresentation || null,
    _customer_action: draft.customerAction || null,
    _category: draft.category || null,
    _price_amount: draft.priceAmount,
    _price_currency: draft.priceCurrency || null,
    _price_interval: draft.priceInterval || null,
    _expected_updated_at: draft.expectedUpdatedAt ?? null,
    // The exact plan the form was populated from. `leadPrice` picks the CHEAPEST active plan, and
    // the previous version always wrote `sort_order = 0` — so on a multi-plan offer a name-only
    // edit copied the displayed plan's figures over a different one.
    _price_id: draft.priceId,
  }), [runWrite]);

  const setOfferStatus = useCallback((
    offerId: string,
    next: OfferAvailability,
    expectedUpdatedAt: string | null,
  ) => runWrite("set_solo_offer_status", {
    _offer_id: offerId,
    _next_status: next,
    _expected_updated_at: expectedUpdatedAt,
  }), [runWrite]);

  useEffect(() => {
    let current = true;

    // Fail closed on identity, exactly as the campaigns adapter does. No tenant, no read.
    if (accountContextLoading) {
      setState({ queryKey, tenantId: activeTenantId ?? null, phase: "resolving", ...EMPTY });
      return () => { current = false; };
    }
    if (!activeTenantId) {
      setState({ queryKey, tenantId: null, phase: "unavailable", ...EMPTY });
      return () => { current = false; };
    }

    setState({ queryKey, tenantId: activeTenantId, phase: "loading", ...EMPTY });
    void (async () => {
      try {
        // THE DEPLOY-ORDER RACE THIS CLOSES. The five offer columns arrive in migration
        // 20261048000000, which CI applies on push to `main` — the same push Vercel builds from.
        // Whichever lands first, this read must not break: asking for a column that does not exist
        // yet makes PostgREST reject the whole request (42703) and the surface would go to its
        // error state for every tenant until the migration caught up. So the extended read is
        // attempted first and falls back to the columns that have always existed, rendering the
        // unmigrated fields as the honest "Not stated" they already render when a tenant has not
        // filled them in. The fallback becomes dead weight once the migration is live; it is
        // removed in Slice 2B, which writes these columns and therefore hard-requires them.
        const EXTENDED = "id,name,summary,description,status,product_type,offer_kind,delivery_shape,price_presentation,customer_action,category,image_url,updated_at";
        const BASE = "id,name,description,status,product_type,image_url,updated_at";
        type ProductRead = {
          data: unknown[] | null;
          error: { code?: string; message?: string } | null;
        };
        // ONLY the undefined-column code. Matching "does not exist" in the message also caught
        // 42P01 (undefined TABLE) and any other Postgres message using that phrase, which would
        // spend a second round-trip before the real error ever surfaced.
        const isMissingColumn = (error: ProductRead["error"]) => error?.code === "42703";
        // One helper for both attempts so the two selects cannot drift apart in scope or order,
        // and so the narrower BASE result stays assignable to the same variable.
        const readProducts = async (columns: string, ids?: readonly string[]): Promise<ProductRead> => {
          let query = supabase.from("tenant_products").select(columns).eq("tenant_id", activeTenantId).order("name", { ascending: true });
          if (bounded) {
            query = query.order("id", { ascending: true });
            if (ids) query = query.in("id", [...ids]);
            else {
              if (search.includes("*")) {
                // PostgREST aliases * to % for ilike. Regex-escape the whole literal term
                // instead of silently widening a name containing an actual asterisk.
                query = query.filter("name", "imatch", search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
              } else if (search) query = query.ilike("name", `%${search.replace(/[\\%_]/g, "\\$&")}%`);
              // Inclusive end: one extra row proves whether another page exists.
              query = query.range(page * pageSize, page * pageSize + pageSize);
            }
          }
          return (await query) as unknown as ProductRead;
        };
        const readWindow = async (columns: string) => Promise.all([
          readProducts(columns),
          bounded && referenceIds.length ? readProducts(columns, referenceIds) : Promise.resolve({ data: [], error: null } as ProductRead),
        ]);
        let [productResponse, referenceResponse] = await readWindow(EXTENDED);
        if (!current) return;
        let fieldsUnavailable = false;
        if (isMissingColumn(productResponse.error) || isMissingColumn(referenceResponse.error)) {
          fieldsUnavailable = true;
          [productResponse, referenceResponse] = await readWindow(BASE);
          if (!current) return;
        }
        const productError = productResponse.error || referenceResponse.error;
        if (productError) throw productError;
        const returnedProducts = (productResponse.data ?? []) as Record<string, unknown>[];
        const hasMore = bounded && returnedProducts.length > pageSize;
        const pageProducts = bounded ? returnedProducts.slice(0, pageSize) : returnedProducts;
        const referenceProducts = (referenceResponse.data ?? []) as Record<string, unknown>[];
        const productIds = [...new Set([...pageProducts, ...referenceProducts].map(row => String(row.id)))];

        // WHY THIS ASKS FOR THE CALLER'S OWN ROW, AND WHY THAT IS NOT OBVIOUS.
        // `tenant_members`'s SELECT policy is `user_id = auth.uid() OR is_tenant_admin(tenant_id)
        // OR is_platform_owner()`. So a plain member sees exactly one row and an ADMIN sees every
        // member row in the workspace — meaning a tenant-scoped `.maybeSingle()` resolves for the
        // member and fails with PGRST116 for the owner, which is precisely backwards. The row we
        // want is the caller's, so the caller is who we ask about: user_id AND tenant_id AND an
        // active membership. A `removed` or `suspended` row can still carry role='owner'.
        const { data: authData } = await supabase.auth.getUser();
        const callerId = authData.user?.id ?? null;

        if (!current) return;
        const readPrices = () => {
          if (bounded && productIds.length === 0) return Promise.resolve({ data: [], error: null });
          let query = supabase.from("tenant_prices")
            .select("id,product_id,nickname,unit_amount,currency,billing_interval,interval_count,kind,installments_total,active,sort_order")
            .eq("tenant_id", activeTenantId).order("sort_order", { ascending: true });
          if (bounded) query = query.in("product_id", productIds);
          return query;
        };
        const [priceResponse, roleResponse] = await Promise.all([
          readPrices(),
          // Authority is asked about THIS workspace, never a global role (§59's global-role trap).
          // The column is `role`; `tenant_role` is the ENUM TYPE's name, not the column's.
          callerId
            ? supabase
                .from("tenant_members")
                .select("role")
                .eq("tenant_id", activeTenantId)
                .eq("user_id", callerId)
                .eq("status", "active")
                .maybeSingle()
            : Promise.resolve({ data: null, error: null }),
        ]);

        const firstError = [productResponse.error, priceResponse.error].find(Boolean);
        if (firstError) throw firstError;
        if (!current) return;

        // An authority read that FAILED is not the same as a caller with no authority. Silently
        // treating the first as the second is how an owner gets told they may not edit their own
        // catalog, so it is logged loudly and reported as unknown rather than as "no".
        if (roleResponse.error) {
          console.error("[catalog-offers] membership read failed; treating authority as unknown", roleResponse.error);
        }

        const pricesByProduct = new Map<string, OfferPrice[]>();
        for (const row of (priceResponse.data ?? []) as Record<string, unknown>[]) {
          const productId = String(row.product_id ?? "");
          if (!productId) continue;
          const list = pricesByProduct.get(productId) ?? [];
          list.push({
            id: String(row.id ?? ""),
            nickname: typeof row.nickname === "string" ? row.nickname : null,
            unitAmount: typeof row.unit_amount === "number" ? row.unit_amount : null,
            currency: typeof row.currency === "string" ? row.currency : null,
            billingInterval: typeof row.billing_interval === "string" ? row.billing_interval : null,
            intervalCount: typeof row.interval_count === "number" ? row.interval_count : null,
            kind: narrow(row.kind, PLAN_KINDS),
            installmentsTotal: typeof row.installments_total === "number" ? row.installments_total : null,
            active: row.active !== false,
          });
          pricesByProduct.set(productId, list);
        }

        // `types.ts` is generated from production, which has not applied 20261048000000 yet, so it
        // does not know the five new columns. The cast is through `unknown` deliberately: it is a
        // statement that this shape is wider than the generated type, not a claim that they match.
        // Regenerating types after the migration lands narrows it back — see the Gate B packet.
        const mapProducts = (rows: Record<string, unknown>[]): CatalogOffer[] => rows.map((row) => ({
            id: String(row.id ?? ""),
            name: typeof row.name === "string" ? row.name : "",
            summary: typeof row.summary === "string" && row.summary.trim() ? row.summary : null,
            description: typeof row.description === "string" && row.description.trim() ? row.description : null,
            // An unreadable status reads as unrecognised, NOT as a draft. This comment used to
            // say the opposite and was left behind when the behaviour changed — the same doc drift
            // this slice has already been caught on twice.
            availability: narrow(row.status, AVAILABILITIES) ?? "unrecognised",
            // The `?? "one_time"` coercion IS the pattern the line above was fixed away from, and
            // it survives deliberately: `billingCadence` has no UI consumer (referenced only in
            // tests), so nothing can render a coerced value at a tenant. If it ever gains one,
            // narrow it to nullable first — otherwise this becomes the same lie one field over.
            billingCadence: narrow(row.product_type, ["one_time", "recurring", "service"] as const) ?? "one_time",
            kind: narrow(row.offer_kind, ["product", "service"] as const),
            deliveryShape: narrow(row.delivery_shape, SHAPES),
            pricePresentation: narrow(row.price_presentation, PRESENTATIONS),
            customerAction: narrow(row.customer_action, ACTIONS),
            category: typeof row.category === "string" && row.category.trim() ? row.category : null,
            imageUrl: typeof row.image_url === "string" ? row.image_url : null,
            updatedAt: typeof row.updated_at === "string" ? row.updated_at : null,
            prices: pricesByProduct.get(String(row.id ?? "")) ?? [],
          }));

        const role = (roleResponse.data as { role?: unknown } | null)?.role;
        const canManage = role === "owner" || role === "admin";

        setState({ queryKey,
          tenantId: activeTenantId,
          phase: "ready",
          offers: mapProducts(pageProducts),
          hasMore,
          referencedOffers: mapProducts(referenceProducts),
          canManage,
          // True only when the authority question itself could not be answered. The surface must
          // not assert "you cannot change this" on the back of a failed read.
          authorityUnknown: Boolean(roleResponse.error) || !callerId,
          // True when the offer columns are not on this deployment yet. Rendering every classified
          // field as "Not stated" would otherwise be indistinguishable from a tenant who simply
          // has not filled them in — the exact ambiguity this surface exists to avoid.
          fieldsUnavailable,
        });
      } catch (error) {
        console.error("[catalog-offers] tenant-scoped offer read failed", error);
        if (!current) return;
        setState({ queryKey, tenantId: activeTenantId, phase: "error", ...EMPTY });
      }
    })();

    return () => { current = false; };
  }, [activeTenantId, accountContextLoading, refreshKey, queryKey]);

  // WHY THIS IS NOT JUST `return state`. `setState` inside the effect above runs AFTER paint, so
  // on the render where `activeTenantId` changes IN PLACE — which is exactly what an operator's
  // `switchTenant` does, without remounting, because `GrowthHub` is keyed by route and not by
  // tenant — `state` still holds the PREVIOUS workspace's `ready` offers. For that one paint the
  // surface would render another tenant's offer names, descriptions and prices under the newly
  // selected workspace. `useSoloCampaigns`, the sibling hook on this same tab, already guards
  // this synchronously; this is the same guard, deliberately not a second invention of it.
  const synchronousTenantId = activeTenantId ?? null;
  const visible = !accountContextLoading && state.tenantId === synchronousTenantId && state.queryKey === queryKey ? state : {
    tenantId: synchronousTenantId,
    phase: accountContextLoading ? "resolving" as const
      : synchronousTenantId ? "loading" as const
      : "unavailable" as const,
    ...EMPTY,
  };
  return { ...visible, retry, saveOffer, setOfferStatus };
}
