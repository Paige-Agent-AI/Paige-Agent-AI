import { supabase } from "@/integrations/supabase/client";
import { useClientPortalRead } from "./useClientPortalRead";

/**
 * The tenant's PRESENTATION OVERLAY for the signed-in customer's client portal.
 * Resolves via get_client_portal_config() (SECURITY DEFINER, keyed on
 * the canonical active relationship), mirroring get_client_portal_brand().
 *
 * This is a purely subtractive/reordering overlay over the Playbook's module
 * catalog — it NEVER introduces new module keys. It hides keys (visible:false),
 * reorders keys (order), and carries an optional welcome greeting. Shape:
 *   { modules?: [{ key, visible, order }], welcome?: { headline?, subhead? } }
 *
 * FAIL-OPEN: any error / empty / non-client caller resolves to {} so the nav
 * renders byte-for-byte the current (catalog-only) behavior. This hook never
 * throws and never blocks nav render.
 */
export interface PortalModuleOverlay {
  key: string;
  /** When explicitly false, the module is hidden from the client nav. */
  visible?: boolean;
  /** When a number, the module sorts by it; absent keeps catalog order. */
  order?: number;
}

export interface PortalWelcome {
  headline?: string;
  subhead?: string;
}

export interface ClientPortalConfig {
  modules?: PortalModuleOverlay[];
  welcome?: PortalWelcome;
  assistant?: {display_name?:string;enabled?:boolean};
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
  if(candidate.assistant&&typeof candidate.assistant==="object"&&!Array.isArray(candidate.assistant)){
    const source=candidate.assistant as Record<string,unknown>;
    const assistant:NonNullable<ClientPortalConfig["assistant"]>={};
    if(typeof source.display_name==="string"&&source.display_name.trim())assistant.display_name=source.display_name.trim().slice(0,80);
    if(typeof source.enabled==="boolean")assistant.enabled=source.enabled;
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

  return out;
}

/**
 * Overlay-only accessor (backward-friendly). Returns {} until loaded / for
 * non-clients / on error. Use useClientPortalConfigState() when you also need
 * the loading flag.
 */
export function useClientPortalConfig(): ClientPortalConfig {
  return useClientPortalConfigState().config;
}
