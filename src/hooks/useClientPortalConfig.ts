import { supabase } from "@/integrations/supabase/client";
import { useClientPortalRead } from "./useClientPortalRead";

/**
 * The tenant's PRESENTATION OVERLAY for the signed-in customer's client portal.
 * Resolves via get_client_portal_config() (SECURITY DEFINER, keyed on
 * the canonical active relationship), mirroring get_client_portal_brand().
 *
 * This is a purely presentational overlay over the portal menu — it NEVER
 * introduces new module keys. It hides keys (visible:false), reorders keys
 * (order), renames keys (label, E09 Slice M), and carries an optional welcome
 * greeting. Shape:
 *   { modules?: [{ key, visible, order, label }], welcome?: { headline?, subhead? } }
 * The customer read also carries the server-owned `_catalog` (the tenant's
 * Playbook menu inputs, never the rest of the Playbook), parsed into `catalog`
 * so the customer's menu is built from THEIR business's catalog (§57).
 *
 * FAIL-OPEN: any error / empty / non-client caller resolves to {} so the nav
 * renders byte-for-byte the current (catalog-only) behavior. This hook never
 * throws and never blocks nav render.
 */
export interface PortalModuleOverlay {
  key: string;
  /** When explicitly false, the module is hidden from the client nav. */
  visible?: boolean;
  /** When a number, the module sorts by it within its group; absent keeps the default order. */
  order?: number;
  /** The business's own name for the entry (E09 Slice M), trimmed, at most 40 characters. */
  label?: string;
}

/** The server's `_catalog` (get_client_portal_config, E09 Slice M), mirrored by catalogInputFromFeatures. */
export interface PortalCatalogInput {
  slug: string | null;
  authoredUsable: boolean;
  modules: { key: string; label: string }[] | null;
}

export interface PortalWelcome {
  headline?: string;
  subhead?: string;
}

export interface PortalAssistant {
  enabled?: boolean;
  display_name?: string;
  tone?: string;
  service_scope?: string;
  human_handoff?: string;
}
export interface ClientPortalConfig {
  modules?: PortalModuleOverlay[];
  welcome?: PortalWelcome;
  assistant?: PortalAssistant;
  /** Customer read only: the business's menu catalog inputs. Absent until the server sends `_catalog`. */
  catalog?: PortalCatalogInput;
  /**
   * Customer read only (E09 F2): what the customer's business is entitled to, computed server-side by
   * get_client_portal_config() from _tenant_finance_entitled and concatenated last, so a stored value can never
   * shadow it. Absent means unknown, which every reader treats as not entitled. Staff surfaces never read this:
   * they ask current_tenant_finance_entitled() (useFinanceEntitlement).
   */
  entitlements?: PortalEntitlements;
}

export interface PortalEntitlements {
  /** Funding and credit surfaces (a deliberate Marketplace install). */
  finance: boolean;
}

export interface ClientPortalConfigState {
  /** The resolved overlay, or {} while loading / for a non-client / on error. */
  config: ClientPortalConfig;
  /** True until the resolver round-trips. Nav renders regardless (fail-open). */
  loading: boolean;
}

/**
 * Loading-aware resolver for the tenant portal presentation overlay. Always
 * returns a defined `config` object ({} until/unless a real overlay resolves),
 * so callers can apply it unconditionally without a null guard. Malformed
 * payloads are normalized to {} — an absent/empty overlay must never hide a tab.
 */
export function useClientPortalConfigState(): ClientPortalConfigState {
  const { data: config, loading } = useClientPortalRead(readConfig, EMPTY_CONFIG);
  return { config, loading };
}

const EMPTY_CONFIG: ClientPortalConfig = {};
async function readConfig(): Promise<ClientPortalConfig> {
  const { data, error } = await supabase.rpc("get_client_portal_config");
  if (error) throw error;
  return normalizePortalConfig(Array.isArray(data) ? data[0] : data);
}

/**
 * Coerce an arbitrary RPC payload into a safe ClientPortalConfig. Anything that
 * isn't a well-formed overlay collapses to {} (or drops the bad field), so a
 * malformed row can never hide or reorder a tab. Guards every access.
 */
export function normalizePortalConfig(raw: unknown): ClientPortalConfig {
  if (!raw || typeof raw !== "object") return {};
  // The RPC may return the config directly, or wrapped under a `portal_config`
  // column (jsonb). Unwrap the latter defensively.
  const source = raw as Record<string, unknown>;
  const candidate =
    source.portal_config && typeof source.portal_config === "object"
      ? (source.portal_config as Record<string, unknown>)
      : source;

  const out: ClientPortalConfig = {};
  if ("assistant" in candidate && (!candidate.assistant || typeof candidate.assistant !== "object" || Array.isArray(candidate.assistant))) {
    out.assistant = { enabled: false };
  } else if(candidate.assistant&&typeof candidate.assistant==="object"&&!Array.isArray(candidate.assistant)){
    const source=candidate.assistant as Record<string,unknown>;
    const assistant:NonNullable<ClientPortalConfig["assistant"]>={};
    if(typeof source.display_name==="string"&&source.display_name.trim())assistant.display_name=source.display_name.trim().slice(0,80);
    if(typeof source.enabled==="boolean")assistant.enabled=source.enabled;
    else if ("enabled" in source) assistant.enabled = false;
    for (const [key, limit] of [["tone", 180], ["service_scope", 1600], ["human_handoff", 600]] as const) {
      if (typeof source[key] === "string") assistant[key] = source[key].trim().slice(0, limit);
    }
    out.assistant=assistant;
  }

  if (Array.isArray(candidate.modules)) {
    const modules = candidate.modules
      .filter((m): m is Record<string, unknown> => !!m && typeof m === "object")
      .map((m) => {
        const key = typeof m.key === "string" ? m.key : null;
        if (!key) return null;
        const overlay: PortalModuleOverlay = { key };
        if (typeof m.visible === "boolean") overlay.visible = m.visible;
        if (typeof m.order === "number" && Number.isFinite(m.order)) overlay.order = m.order;
        if (typeof m.label === "string") {
          const label = m.label.trim().slice(0, PORTAL_MENU_LABEL_MAX);
          if (label) overlay.label = label;
        }
        return overlay;
      })
      .filter((m): m is PortalModuleOverlay => m !== null);
    if (modules.length > 0) out.modules = modules;
  }

  if (candidate.welcome && typeof candidate.welcome === "object") {
    const w = candidate.welcome as Record<string, unknown>;
    const welcome: PortalWelcome = {};
    if (typeof w.headline === "string") welcome.headline = w.headline;
    if (typeof w.subhead === "string") welcome.subhead = w.subhead;
    if (welcome.headline !== undefined || welcome.subhead !== undefined) out.welcome = welcome;
  }

  const catalog = parsePortalCatalog(candidate._catalog);
  if (catalog) out.catalog = catalog;

  // Only `true` grants; anything else (absent, malformed, a string) is not entitled.
  if (candidate.entitlements && typeof candidate.entitlements === "object" && !Array.isArray(candidate.entitlements)) {
    out.entitlements = { finance: (candidate.entitlements as Record<string, unknown>).finance === true };
  }

  return out;
}

export const PORTAL_MENU_LABEL_MAX = 40;
const CATALOG_MAX_ENTRIES = 40;
const CATALOG_MAX_CHARS = 80;

/** Bound a Playbook module list the way the server's `_catalog` does: string key and label, 40 x 80. */
export function boundCatalogModules(raw: unknown): { key: string; label: string }[] | null {
  if (!Array.isArray(raw)) return null;
  return raw
    .filter((m): m is { key: string; label: string } =>
      !!m && typeof m === "object" && typeof (m as { key?: unknown }).key === "string" && typeof (m as { label?: unknown }).label === "string")
    .slice(0, CATALOG_MAX_ENTRIES)
    .map((m) => ({ key: m.key.slice(0, CATALOG_MAX_CHARS), label: m.label.slice(0, CATALOG_MAX_CHARS) }));
}

function parsePortalCatalog(raw: unknown): PortalCatalogInput | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const c = raw as Record<string, unknown>;
  return {
    slug: typeof c.slug === "string" ? c.slug : null,
    authoredUsable: c.authored_usable === true,
    modules: boundCatalogModules(c.modules),
  };
}

/**
 * Overlay-only accessor (backward-friendly). Returns {} until loaded / for
 * non-clients / on error. Use useClientPortalConfigState() when you also need
 * the loading flag.
 */
export function useClientPortalConfig(): ClientPortalConfig {
  return useClientPortalConfigState().config;
}
