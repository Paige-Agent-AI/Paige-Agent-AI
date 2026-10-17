/** Optional narrowing of the incumbent Research search budget; never provider authority. */
export interface ResearchSourcePolicy {
  max_sources?: number;
  allowed_domains?: string[];
}

export interface ResearchSourceCoverage extends ResearchSourcePolicy {
  admitted_sources: number;
  limit_reached: boolean;
}

// The largest incumbent dossier budget is18 searches x5 hits; general runs remain50.
export const RESEARCH_MAX_SOURCE_REQUEST = 90;
export const RESEARCH_SEARCH_LIMIT = 5;

/** Hostnames only. A root includes dot-boundary subdomains, never suffix lookalikes. */
export function parseResearchSourcePolicy(value: Record<string, unknown>): ResearchSourcePolicy {
  const policy: ResearchSourcePolicy = {};
  if (value.max_sources !== undefined) {
    if (!Number.isInteger(value.max_sources) || (value.max_sources as number) < 1 ||
        (value.max_sources as number) > RESEARCH_MAX_SOURCE_REQUEST) throw new Error('Invalid research source limit.');
    policy.max_sources = value.max_sources as number;
  }
  if (value.allowed_domains !== undefined) {
    if (!Array.isArray(value.allowed_domains) || !value.allowed_domains.length || value.allowed_domains.length > 20) {
      throw new Error('Provide 1-20 allowed research hostnames.');
    }
    const domains: string[] = [];
    for (const entry of value.allowed_domains) {
      if (typeof entry !== 'string') throw new Error('Invalid research hostname.');
      const domain = entry.trim().toLowerCase();
      if (domain.length > 253 || !domain.includes('.') || !domain.split('.').every(label =>
        /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) ||
        /^\d+(?:\.\d+){3}$/.test(domain)) throw new Error('Invalid research hostname.');
      if (!domains.includes(domain)) domains.push(domain);
    }
    policy.allowed_domains = domains;
  }
  return policy;
}

/** Normalize only URL identity, retaining meaningful query/path terms; strip fragments. */
export function researchSourceUrl(value: unknown, policy: ResearchSourcePolicy): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    if (policy.allowed_domains && !policy.allowed_domains.some(domain => host === domain || host.endsWith(`.${domain}`))) return null;
    url.hostname = host;
    url.hash = '';
    return url.href;
  } catch { return null; }
}

/** Validate the completed native contract; never clip results or renumber citations here. */
export function researchResultHonorsSourcePolicy(policy: ResearchSourcePolicy, sources: unknown[], coverage: Record<string, unknown>): boolean {
  if (policy.max_sources === undefined && !policy.allowed_domains) return true; // incumbent callers
  const proof = coverage.source_policy as ResearchSourceCoverage | undefined;
  if (!proof || typeof proof !== 'object' || Array.isArray(proof) ||
      proof.admitted_sources !== sources.length || typeof proof.limit_reached !== 'boolean') return false;
  if (policy.max_sources !== undefined && (!Number.isInteger(proof.max_sources) ||
      proof.max_sources! < 1 || proof.max_sources! > policy.max_sources || sources.length > proof.max_sources! ||
      proof.limit_reached !== (sources.length >= proof.max_sources!))) return false;
  if (JSON.stringify(proof.allowed_domains ?? []) !== JSON.stringify(policy.allowed_domains ?? [])) return false;
  const seen = new Set<string>();
  return sources.every(source => {
    const raw = source && typeof source === 'object' ? (source as Record<string, unknown>).url : null;
    const url = researchSourceUrl(raw, policy);
    if (!url || raw !== url || seen.has(url)) return false;
    seen.add(url);
    return true;
  });
}
