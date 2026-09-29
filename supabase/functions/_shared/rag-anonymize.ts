// Shared anonymizer for RAG ingestion. Strips PII, business names, EINs,
// SSNs, phone numbers, emails, addresses, and lender-specific account refs
// before any client-derived text is stored in rag_documents.
//
// Strategy: aggressive replace-with-generic-token. We keep numeric ranges,
// states, industries and amounts because those are exactly what makes a
// case study useful — but every direct identifier is scrubbed.

const EIN_RX = /\b\d{2}-\d{7}\b/g;
const SSN_RX = /\b\d{3}-\d{2}-\d{4}\b/g;
const PHONE_RX = /\b(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g;
const EMAIL_RX = /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g;
const URL_RX = /\bhttps?:\/\/\S+/g;
const STREET_RX = /\b\d{1,6}\s+[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){0,3}\s+(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Dr|Drive|Ln|Lane|Way|Ct|Court|Pl|Place|Pkwy|Parkway|Ter|Terrace|Hwy|Highway|Cir|Circle)\b\.?/g;
const ZIP_RX = /\b\d{5}(?:-\d{4})?\b/g;
const ACCT_RX = /\b(?:account|acct|loan|policy)\s*#?\s*[xX*]*\d{3,}\b/gi;

/**
 * Build a redaction set from known sensitive strings (full names, business
 * legal names, DBAs). Each entry is escaped and matched case-insensitively.
 */
function tokenSet(values: Array<string | null | undefined>): RegExp[] {
  const seen = new Set<string>();
  const rxs: RegExp[] = [];
  for (const raw of values) {
    if (!raw) continue;
    const v = raw.trim();
    if (v.length < 3) continue;
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const escaped = v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    rxs.push(new RegExp(`\\b${escaped}\\b`, "gi"));
  }
  return rxs;
}

export interface AnonymizeIdentity {
  fullName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  /** Every address the person holds (user_contact_methods), so a non-standard one is still caught. */
  emails?: string[];
  phones?: string[];
  businessLegalName?: string | null;
  businessDba?: string | null;
  street?: string | null;
  city?: string | null;
}

export function anonymize(text: string, identity: AnonymizeIdentity = {}): string {
  if (!text) return text;
  let out = text;

  // 1) Replace explicit identity tokens first (longest first to avoid partial overlap).
  const tokens = tokenSet([
    identity.fullName,
    identity.businessLegalName,
    identity.businessDba,
    identity.firstName,
    identity.lastName,
    ...(identity.emails ?? []),
    ...(identity.phones ?? []),
    identity.street,
    identity.city,
  ]).sort((a, b) => b.source.length - a.source.length);

  const replacements: Array<[RegExp, string]> = [
    ...tokens.map<[RegExp, string]>((rx) => [rx, "[REDACTED]"]),
    [EIN_RX, "[EIN]"],
    [SSN_RX, "[SSN]"],
    [PHONE_RX, "[PHONE]"],
    [EMAIL_RX, "[EMAIL]"],
    [URL_RX, "[URL]"],
    [STREET_RX, "[ADDRESS]"],
    [ZIP_RX, "[ZIP]"],
    [ACCT_RX, "[ACCOUNT]"],
  ];

  for (const [rx, token] of replacements) {
    out = out.replace(rx, token);
  }

  // Collapse repeated [REDACTED] runs.
  out = out.replace(/(\[REDACTED\][\s,]*){2,}/g, "[REDACTED] ");
  return out.trim();
}

/** Bucket a credit score into a 20-point range token for metadata filters. */
export function scoreBand(score: number | null | undefined): string | null {
  if (score == null || !Number.isFinite(score)) return null;
  const lower = Math.max(300, Math.floor(score / 20) * 20);
  return `${lower}-${lower + 19}`;
}

/** Bucket a dollar amount into a coarse band for metadata filters. */
export function amountBand(amount: number | null | undefined): string | null {
  if (amount == null || !Number.isFinite(amount)) return null;
  if (amount < 5000) return "<5k";
  if (amount < 25000) return "5k-25k";
  if (amount < 75000) return "25k-75k";
  if (amount < 150000) return "75k-150k";
  if (amount < 500000) return "150k-500k";
  return "500k+";
}