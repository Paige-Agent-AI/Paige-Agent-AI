// _shared/provider-types.ts — Shared types for the Vibe Studio model-router provider clients.
//
// Every provider client (openai/groq/ideogram/replicate/meshy, plus claude via the router)
// speaks this ONE result shape so the router can compose them without knowing which vendor
// ran. Kept dependency-free and side-effect-free so the router AND the pure gate layer can
// both import it.
//
// FAIL-CLOSED contract (doctrine §13 — honest by construction): a provider whose API key is
// unset does NOT crash generically and NEVER fakes a success — it throws NeedsConfigError,
// which the router catches and turns into an honest `needs_config` degrade. Keys are read at
// CALL time (Deno.env.get inside the call), never at module load, so secret rotation never
// needs a redeploy.

/**
 * Thrown by a provider client when its required API key is absent. The router catches this
 * at the boundary and returns { needs_config: true, ... } instead of throwing — an honest
 * "this modality isn't configured yet" degrade, never a fake artifact.
 */
export class NeedsConfigError extends Error {
  readonly provider: string;
  constructor(provider: string, message?: string) {
    super(message ?? `${provider} is not configured (missing API key)`);
    this.name = "NeedsConfigError";
    this.provider = provider;
  }
}

/**
 * Thrown by a provider client when a modality/model is on the roadmap but not yet wired
 * (e.g. video-*). Distinct from NeedsConfigError (which means "key missing"): this means
 * "capability deferred". The router turns it into a clean reject, never a fake success.
 */
export class NotYetConfiguredError extends Error {
  readonly capability: string;
  constructor(capability: string, message?: string) {
    super(message ?? `${capability} is not yet configured (deferred wave)`);
    this.name = "NotYetConfiguredError";
    this.capability = capability;
  }
}

/**
 * The uniform return of every provider client. A text provider fills `content` (+ tokens);
 * a binary provider fills `artifact_bytes`+`artifact_mime` (bytes we host ourselves) OR
 * `artifact_url` (a vendor-hosted URL the router downloads and re-hosts). `latency_ms` is
 * always set; token counts are best-effort (many image/3d/audio vendors report none).
 */
export interface ProviderCallResult {
  content?: string;
  artifact_bytes?: Uint8Array;
  artifact_mime?: string;
  artifact_url?: string;
  provider: string;
  model: string;
  tokens_in?: number;
  tokens_out?: number;
  /** Anthropic prompt-cache counts, best-effort. Kept OUT of tokens_in on purpose: input_tokens is the
   *  uncached remainder, and the meter bills tokens_in + tokens_out. Undefined where unreported. */
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  latency_ms: number;
}
