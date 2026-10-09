/**
 * useSoloNumbers — the number marketplace, reachable from the Solo shell.
 *
 * WHY THIS EXISTS. `comms-search-numbers` and `comms-purchase-number` are real and have
 * been for a while: they authenticate as the tenant's OWN Twilio subaccount, search live
 * inventory, and buy into that subaccount. Production proves it — one workspace already
 * holds two purchased numbers. But the only caller was `NumbersTab`, mounted on a legacy
 * route a Solo tenant is redirected away from, and Solo's own "Find a number" panel was
 * marked PROPOSED and ran nothing at all. The capability was built, then orphaned. This
 * adapter is the Solo caller it never had (§18 — the same two seams, not a third).
 *
 * WHAT IS DELIBERATELY NOT HERE (§38). Buying a number is a REAL CHARGE: Twilio's
 * wholesale plus a flat platform fee, read live from `platform_number_pricing`. This
 * adapter therefore never purchases on its own initiative, never retries a purchase, and
 * never treats a failed purchase as a success. A person presses Buy, once, and is told
 * exactly what happened.
 *
 * §9: no tenant id crosses the wire. Both edge functions derive the tenant from the
 * verified JWT via `current_user_tenant_id()`, resolve that tenant's subaccount
 * credentials from Vault under the service role, and the inserted
 * `tenant_phone_numbers.tenant_id` is stamped by a database trigger from the subaccount
 * parent — a request body cannot point the purchase at another workspace.
 *
 * §13: `needs_config` is a first-class answer, not an error and not an empty list. A
 * workspace with no messaging account provisioned CANNOT buy yet, and saying "no numbers
 * found" would blame the search for a setup gap.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTenantContext } from "@/hooks/useTenantContext";
import { useUserRoles } from "@/hooks/useUserRoles";
import { createSettingsRequestGate } from "../settings-contract";
import { resolveFunctionError } from "@/lib/integrations/connectError";

/** What a person can narrow the search by. Every field is optional. */
export interface NumberSearchFilters {
  /** "local" — an ordinary area-code number — or "tollfree" for an 800/833/844/855/866/877/888. */
  kind: "local" | "tollfree";
  /** Three digits. Ignored for toll-free, where the prefix IS the area code. */
  areaCode: string;
  /** Two-letter state, e.g. GA. */
  region: string;
  /** City, e.g. Atlanta. */
  locality: string;
  /**
   * Digits the number should begin with. These are matched from the START of the
   * ten-digit national number, so with an area code set they follow it (404 + 555 →
   * 404555****) and without one they ARE the leading digits. The docs here used to say
   * "after the area code" while the pattern meant "instead of it", which made the two
   * controls contradict each other and return nothing.
   */
  startsWith: string;
}

export const EMPTY_NUMBER_FILTERS: NumberSearchFilters = {
  kind: "local", areaCode: "", region: "", locality: "", startsWith: "",
};

export interface AvailableNumber {
  phoneNumber: string;
  locality: string | null;
  region: string | null;
  capabilities: { sms: boolean; mms: boolean; voice: boolean };
  /** Monthly price in cents, or null when the operator has not priced this type yet. */
  priceCents: number | null;
}

export interface OwnedNumber {
  id: string;
  phoneNumber: string;
  isPrimary: boolean;
  status: string | null;
  friendlyName: string | null;
}

export type SearchOutcome =
  | { state: "results"; numbers: AvailableNumber[]; priceConfigured: boolean }
  /** The workspace cannot buy yet — a setup gap, NOT an empty result (§13). */
  | { state: "needs_config"; message: string }
  | { state: "error"; message: string };

export interface SoloNumbersData {
  loading: boolean;
  error: string | null;
  /** Numbers this workspace already owns. */
  owned: OwnedNumber[];
  /** True when the caller may search and buy — fail-closed; the server re-checks. */
  canManage: boolean;
  refresh: () => void;
  search: (filters: NumberSearchFilters) => Promise<SearchOutcome>;
  /**
   * Buys ONE number. Never called except from a person's click (§38).
   *
   * `agreedMonthlyCents` is the price the person was actually shown and agreed to. The
   * server refuses the purchase if the live price no longer matches it, so a price that
   * moved between the search and the click is never silently charged. Omit it (or pass
   * `null`) only when the operator has not priced this number type and there is therefore
   * no amount to hold anyone to.
   */
  purchase: (
    phoneNumber: string,
    agreedMonthlyCents?: number | null,
  ) => Promise<{ ok: boolean; error: string | null }>;
  /** Names or renames a number. An empty string clears the name. */
  rename: (id: string, friendlyName: string) => Promise<{ ok: boolean; error: string | null }>;
  /** Chooses which number this business calls and texts FROM. */
  setPrimary: (id: string) => Promise<{ ok: boolean; error: string | null }>;
  /**
   * INT-345 K-3: connects this workspace's calling account through the governed
   * seam (comms-setup-calling). Free, idempotent, and it buys/chooses NO number —
   * the four facts stay four facts. Never called except from a person's click.
   */
  setupCalling: () => Promise<SetupCallingOutcome>;
}

/** The governed setup seam's answer — the exact outcome plus the canonical calling readback. */
export interface SetupCallingOutcome {
  ok: boolean;
  /** provisioned | adopted | skipped_existing | failed | blocked_needs_config */
  outcome: string;
  message: string | null;
  /** The four calling facts from tenant_comms_readiness, when the seam re-read them. */
  calling: {
    ready: boolean;
    account: string;
    number_assigned: boolean;
    primary_selected: boolean;
    reason_code: string | null;
  } | null;
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}
/** Twilio spells capabilities inconsistently across endpoints ({SMS} vs {sms}). */
function cap(caps: Record<string, unknown>, key: "sms" | "mms" | "voice"): boolean {
  return caps[key] === true || caps[key.toUpperCase()] === true;
}

export function useSoloNumbers(): SoloNumbersData {
  // The client's active tenant is the TRIGGER for a re-read, never the authority for
  // what gets read. `comms-purchase-number` derives its tenant from the verified JWT
  // via `current_user_tenant_id()`, and that resolver can legitimately answer something
  // else — a `profiles.active_tenant_id` whose membership has lapsed falls through to a
  // different tenant, and a multi-tenant user with no stored preference is resolved by
  // `tenant_members.joined_at` here and by `tenants.created_at` on the client. Reading
  // by one and writing by the other is how a surface lists one workspace's numbers and
  // bills another (§9/§51). So: re-read when the client says the tenant moved, but scope
  // every read to the tenant the SERVER resolved.
  const { activeTenantId, loading: tenantLoading } = useTenantContext();
  // The SERVER's gate, mirrored. Both edge functions admit
  // `is_platform_owner() OR global admin OR global coach` — which `isStaff` is exactly.
  // The surface gated on `is_current_user_tenant_admin()` instead and justified it with a
  // comment claiming that was the server's rule. It is not: a tenant COACH maps to the
  // global `coach` role, passes the server, and was shown a read-only surface anyway —
  // a capability hidden from someone the server permits, on a false premise (§13/§70).
  const { isStaff } = useUserRoles();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [owned, setOwned] = useState<OwnedNumber[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [loadedTenantId, setLoadedTenantId] = useState<string | null>(null);
  // A ref, not a dependency. As state in `load`'s dep list it changed `load`'s identity
  // on every completed read, which re-fired the effect that depends on `load` — two
  // full reads on every mount and three on a tenant change.
  const loadedRef = useRef<string | null>(null);
  const gate = useRef(createSettingsRequestGate());

  const load = useCallback(async () => {
    const token = gate.current.begin();
    setError(null);
    if (!activeTenantId) { setLoading(false); return; }
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- RPC not in generated types (repo-wide pattern)
      const { data: resolved } = await (supabase as any).rpc("current_user_tenant_id");
      if (!gate.current.isCurrent(token)) return;
      const tenantId = typeof resolved === "string" ? resolved : null;
      if (!tenantId) {
        // Not an empty account — an unresolved one. Say so rather than rendering a
        // confident "no numbers" over a workspace we never identified.
        setLoadedTenantId(null); loadedRef.current = null;
        setOwned([]); setCanManage(false);
        setError("We couldn’t tell which business you’re in.");
        return;
      }
      // Only forget the previous workspace when it actually CHANGED. Blanking on a
      // same-workspace refresh unmounts whatever the surface was showing, including the
      // result of the purchase that triggered the refresh.
      if (loadedRef.current !== null && loadedRef.current !== tenantId) {
        setLoadedTenantId(null); loadedRef.current = null;
        setOwned([]); setCanManage(false);
      }
      if (loadedRef.current !== tenantId) setLoading(true);

      const [numbersRes, adminRes] = await Promise.all([
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- table not in generated types (repo-wide pattern, cf. channel_connectors)
        (supabase as any)
          .from("tenant_phone_numbers")
          .select("id, phone_number, is_primary, status, friendly_name")
          .eq("tenant_id", tenantId)
          .order("is_primary", { ascending: false }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- RPC not in generated types (repo-wide pattern)
        supabase.rpc("is_current_user_tenant_admin" as any),
      ]);
      if (!gate.current.isCurrent(token)) return;
      if (numbersRes.error) throw numbersRes.error;
      setOwned(((numbersRes.data ?? []) as unknown[]).map((r) => {
        const row = asRecord(r);
        return {
          id: String(row.id ?? ""),
          phoneNumber: str(row.phone_number) ?? "",
          isPrimary: row.is_primary === true,
          status: str(row.status),
          friendlyName: str(row.friendly_name),
        };
      }));
      // Either half is sufficient because either half passes the server. Fail-closed on
      // both: an unreadable role answer is never treated as authority.
      setCanManage(adminRes.data === true || isStaff);
      loadedRef.current = tenantId;
      setLoadedTenantId(tenantId);
    } catch (e) {
      if (!gate.current.isCurrent(token)) return;
      setError(e instanceof Error ? e.message : "Couldn't read this workspace's numbers.");
    } finally {
      if (gate.current.isCurrent(token)) setLoading(false);
    }
  }, [activeTenantId, isStaff]);

  useEffect(() => {
    const active = gate.current;
    if (tenantLoading) return;
    void load();
    return () => active.clear();
  }, [tenantLoading, load]);

  const refresh = useCallback(() => { void load(); }, [load]);

  const search = useCallback(async (filters: NumberSearchFilters): Promise<SearchOutcome> => {
    try {
      const { data, error: fnError } = await supabase.functions.invoke("comms-search-numbers", {
        body: {
          number_type: filters.kind,
          // A toll-free prefix IS its area code, so sending both would contradict itself.
          area_code: filters.kind === "tollfree" ? undefined : filters.areaCode.trim() || undefined,
          in_region: filters.region.trim() || undefined,
          in_locality: filters.locality.trim() || undefined,
          starts_with: filters.startsWith.trim() || undefined,
        },
      });
      const rec = asRecord(data);
      if (fnError) {
        const { message } = await resolveFunctionError({ error: fnError, data, action: "search for numbers" });
        return { state: "error", message };
      }
      // A setup gap is its own answer. Rendering it as "no results" would blame the
      // search for something the search did not do.
      if (rec.needs_config === true) {
        return {
          state: "needs_config",
          message: str(rec.message)
            ?? "This workspace can't buy a number yet — its messaging account isn't set up.",
        };
      }
      if (rec.error) {
        const { message } = await resolveFunctionError({ error: null, data, action: "search for numbers" });
        return { state: "error", message };
      }
      const raw = Array.isArray(rec.numbers) ? rec.numbers : [];
      return {
        state: "results",
        priceConfigured: rec.price_configured === true,
        numbers: raw.map((n) => {
          const row = asRecord(n);
          const caps = asRecord(row.capabilities);
          const price = asRecord(row.retail_price);
          return {
            phoneNumber: str(row.phone_number) ?? "",
            locality: str(row.locality),
            region: str(row.region),
            capabilities: { sms: cap(caps, "sms"), mms: cap(caps, "mms"), voice: cap(caps, "voice") },
            // `monthly_cents`, NOT `retail_monthly_cents`. The latter is the DATABASE
            // column; the response key is `monthly_cents` (comms-search-numbers declares
            // the shape as {monthly_cents, onetime_cents, currency} and the sibling
            // consumer reads it that way). Reading the column name here made every price
            // `null` — so every row showed "—" WITHOUT the "pricing pending" note, which
            // is suppressed when the server says the type IS priced, and the purchase
            // confirm offered "an unlisted monthly price" for a charge whose amount the
            // response was carrying all along.
            priceCents: typeof price.monthly_cents === "number" ? price.monthly_cents : null,
          };
        }).filter((n) => n.phoneNumber),
      };
    } catch (e) {
      return { state: "error", message: e instanceof Error ? e.message : "That search didn't run." };
    }
  }, []);

  /**
   * `agreedMonthlyCents` is the price the person was SHOWN and clicked yes to — not a
   * hint. The server re-reads `platform_number_pricing` and refuses with `price_changed`
   * when it no longer matches, so sending it is what makes "you agreed to $1.20" mean
   * anything. Omitting it (which this lane did) skipped that check entirely: the guard is
   * written `if (agreedMonthlyCents !== null)`, so a price that moved between the search
   * and the click was simply charged.
   *
   * `null` when the operator has not priced this number type. The check is then skipped,
   * exactly as before — there is no amount to hold anyone to.
   */
  const purchase = useCallback(async (phoneNumber: string, agreedMonthlyCents: number | null = null) => {
    try {
      const { data, error: fnError } = await supabase.functions.invoke("comms-purchase-number", {
        body: {
          phone_number: phoneNumber,
          ...(typeof agreedMonthlyCents === "number" && Number.isFinite(agreedMonthlyCents)
            ? { agreed_monthly_cents: Math.round(agreedMonthlyCents) }
            : {}),
        },
      });
      const rec = asRecord(data);
      // Both shapes checked. A purchase that reports success when the provider refused
      // would tell someone they own a number they do not, and bill nobody for it.
      if (fnError || rec.error || rec.needs_config === true) {
        const { message } = await resolveFunctionError({ error: fnError, data, action: "buy that number" });
        return { ok: false, error: message };
      }
      // And the ABSENCE of an error is not a purchase. The server says `purchased: true`
      // when it bought, or `already_owned: true` when this workspace held the number
      // before we asked. Treating any 200 as a buy would let a shape nobody anticipated
      // — a partial write, a future branch — read as "the number is yours".
      if (rec.purchased !== true && rec.already_owned !== true) {
        const { message } = await resolveFunctionError({ error: null, data, action: "buy that number" });
        return { ok: false, error: message };
      }
      await load();
      return { ok: true, error: null };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "That purchase didn't complete." };
    }
  }, [load]);

  /**
   * The two edits a bought number needs, and neither existed.
   *
   * `is_primary` decides which number outbound calls and texts come FROM — it is read by
   * `voice-twiml` and `send-message` to pick the caller ID — and until the migration beside this
   * change, NOTHING in the repository ever wrote it. Every row was `false`, so the ordering both
   * readers rely on was a tie, and `voice-twiml` has no secondary sort: a business with two
   * numbers called out from whichever row Postgres returned. Buying a second number for a
   * different part of the business made the first one unpredictable.
   *
   * Both go through SECURITY DEFINER RPCs that re-enforce the caller's scope in-body (§59); the
   * set-primary one also clears the previous primary in the same transaction, because
   * `uq_tenant_phone_numbers_primary` is a partial unique on (tenant_id) WHERE is_primary.
   */
  const runNumberRpc = useCallback(async (fn: string, params: Record<string, unknown>) => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- RPC not in generated types (repo-wide pattern)
      const { error: rpcError } = await (supabase as any).rpc(fn, params);
      if (rpcError) {
        const { message } = await resolveFunctionError({
          error: null,
          data: { error: { code: rpcError.hint || rpcError.message, message: rpcError.message } },
          action: fn === "tenant_phone_number_set_primary" ? "change your sending number" : "rename that number",
        });
        return { ok: false, error: message };
      }
      await load();
      return { ok: true, error: null };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "That change didn't save." };
    }
  }, [load]);

  const rename = useCallback(
    (id: string, friendlyName: string) =>
      runNumberRpc("tenant_phone_number_rename", { _id: id, _friendly_name: friendlyName }),
    [runNumberRpc],
  );
  const setPrimary = useCallback(
    (id: string) => runNumberRpc("tenant_phone_number_set_primary", { _id: id }),
    [runNumberRpc],
  );

  const setupCalling = useCallback(async (): Promise<SetupCallingOutcome> => {
    try {
      const { data, error } = await supabase.functions.invoke("comms-setup-calling", { body: {} });
      if (error) {
        // Non-2xx (a real failure). The invoke error carries no body we can trust.
        return { ok: false, outcome: "failed", message: "Calling setup couldn't reach the platform. Try again in a moment.", calling: null };
      }
      const rec = (data ?? {}) as Record<string, unknown>;
      const outcome = typeof rec.outcome === "string" ? rec.outcome : "failed";
      const ok = outcome === "provisioned" || outcome === "adopted" || outcome === "skipped_existing";
      const callingRec = (rec.calling && typeof rec.calling === "object") ? rec.calling as Record<string, unknown> : null;
      return {
        ok,
        outcome,
        message: typeof rec.message === "string" ? rec.message : null,
        calling: callingRec
          ? {
            ready: callingRec.ready === true,
            account: String(callingRec.account ?? "absent"),
            number_assigned: callingRec.number_assigned === true,
            primary_selected: callingRec.primary_selected === true,
            reason_code: typeof callingRec.reason_code === "string" ? callingRec.reason_code : null,
          }
          : null,
      };
    } catch {
      return { ok: false, outcome: "failed", message: "Calling setup couldn't reach the platform. Try again in a moment.", calling: null };
    }
  }, []);

  return useMemo(() => ({
    loading: loading || tenantLoading,
    error,
    // Nothing is shown until a workspace has actually been resolved and read. The
    // comparison used to be against the CLIENT's tenant, which permanently hid the
    // list whenever the server legitimately resolved a different one.
    owned: loadedTenantId ? owned : [],
    canManage: loadedTenantId ? canManage : false,
    refresh, search, purchase, rename, setPrimary, setupCalling,
  }), [loading, tenantLoading, loadedTenantId, error, owned, canManage, refresh, search, purchase, rename, setPrimary, setupCalling]);
}
