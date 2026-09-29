// _shared/contact-search.ts — §18 ONE HOME for the CRM "look up a contact by name"
// search filter, shared by every lookup tool (paige-ai-chat `crm_search_contacts`,
// paige-mcp `search_contacts` + `search_clients_fuzzy`).
//
// THE BUG THIS FIXES (owner live-drive 2026-08-11, hotfix #127): the old filter matched
// the WHOLE query phrase against EACH single column —
//   or(first_name.ilike.%Tashia Anderson%, last_name.ilike.%Tashia Anderson%, …)
// so a real contact whose first_name="Tashia" and last_name="Anderson" (SEPARATE
// columns) matched NOTHING → 0 rows → Paige wrongly told the operator "no contact on
// file." Full names never live in one column, so every multi-word search false-missed.
//
// THE FIX: tokenize on whitespace. EACH token must match SOME column (OR across
// columns), and ALL tokens must match (AND across tokens — chained `.or()` calls are
// AND-combined by PostgREST, i.e. `and(or(tok0…),or(tok1…))`). So "Tashia Anderson"
// resolves: token "Tashia" matches first_name, token "Anderson" matches last_name. A
// single-token query produces exactly ONE or()-group — identical to the old behavior,
// so short/one-word searches are unchanged.

export const CONTACT_SEARCH_COLUMNS = [
  "first_name",
  "last_name",
  "email",
  "entity_name",
  "phone",
] as const;

/** Strip PostgREST `.or()`-grammar-significant chars from a token so a stray char can't
 *  break the filter string (comma separates conditions, parens group, % is our wildcard). */
function sanitizeToken(t: string): string {
  return t.replace(/[%,()]/g, "").trim();
}

/** Split a raw search into safe, non-empty, whitespace-delimited tokens. Pure — exported
 *  so the tokenizer is unit-testable independently of a query builder. */
export function contactSearchTokens(raw: string): string[] {
  return String(raw ?? "")
    .replace(/[%,]/g, " ")
    .trim()
    .split(/\s+/)
    .map(sanitizeToken)
    .filter((t) => t.length > 0);
}

/** The per-token PostgREST `or()`-group string (OR across the given columns). Pure. */
export function contactSearchOrGroup(
  token: string,
  columns: readonly string[] = CONTACT_SEARCH_COLUMNS,
  addressMatches: readonly string[] = [],
): string {
  const clauses = columns.map((c) => `${c}.ilike.%${token}%`);
  if (addressMatches.length) clauses.push(`id.in.(${addressMatches.join(",")})`);
  return clauses.join(",");
}

/** The name columns a contact is searched on; its addresses are searched through its methods. */
export const CONTACT_NAME_SEARCH_COLUMNS = ["first_name", "last_name", "entity_name"] as const;

// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MethodsClient = { from: (...args: any[]) => any };

/**
 * For each search token, the contacts in ONE workspace holding an email or phone that contains it —
 * whichever of their addresses it is, not only the primary. A phone token also matches on its
 * digits, so "555 0101" finds "+1 (555) 010-0101". A lookup failure is logged and reads as no
 * address match; the name columns still search.
 */
export async function contactIdsByAddressToken(
  admin: MethodsClient,
  tenantId: string,
  raw: string,
  caller: string,
): Promise<Map<string, string[]>> {
  const byToken = new Map<string, string[]>();
  for (const token of contactSearchTokens(raw)) {
    const digits = token.replace(/\D/g, "");
    const clauses = [`value.ilike.%${token}%`];
    if (digits.length >= 4) clauses.push(`match_key.ilike.%${digits}%`);
    const { data, error } = await admin.from("client_contact_methods").select("client_id")
      .eq("tenant_id", tenantId).or(clauses.join(",")).limit(500);
    if (error) {
      console.error(`[${caller}] contact_address_search_failed`, { code: error.code, message: error.message });
      continue;
    }
    const ids = [...new Set(((data ?? []) as Array<{ client_id: string }>).map((row) => row.client_id))];
    if (ids.length) byToken.set(token, ids);
  }
  return byToken;
}

export interface ContactSearchOpts {
  /**
   * `"all"` (default) — every token must match SOME column (AND across tokens, one
   *   `.or()` group per token, AND-combined by PostgREST). For strict "look up a
   *   contact by name" tools where "Tashia Anderson" must match first+last.
   * `"any"` — a SINGLE `.or()` spanning every token × column (OR everything). For
   *   natural-language/fuzzy tools ("Marcus from Atlanta") where stopword tokens must
   *   not zero out the result — surfaces candidates and the caller disambiguates.
   */
  mode?: "all" | "any";
  /** Searchable columns (defaults to CONTACT_SEARCH_COLUMNS). */
  columns?: readonly string[];
  /** Per token, contact ids whose addresses match it (contactIdsByAddressToken). */
  addressMatches?: ReadonlyMap<string, readonly string[]>;
}

/**
 * Apply the tokenized contact search to a PostgREST query builder. If the search is
 * empty/blank the builder is returned unchanged. Generic-passthrough so each caller
 * gets its own builder type back; the internal `any` is only the builder-shape bridge.
 */
export function applyContactSearchFilter<Q>(query: Q, raw: string, opts: ContactSearchOpts = {}): Q {
  const mode = opts.mode ?? "all";
  const columns = opts.columns ?? CONTACT_SEARCH_COLUMNS;
  const tokens = contactSearchTokens(raw);
  // deno-lint-ignore no-explicit-any
  let q: any = query;
  if (tokens.length === 0) return q as Q;
  if (mode === "any") {
    // One OR-group over every token × column — natural-language tolerant (a stopword
    // token simply matches nothing rather than zeroing the whole result).
    const clauses = tokens.flatMap((t) => columns.map((c) => `${c}.ilike.%${t}%`));
    const ids = [...new Set(tokens.flatMap((t) => [...(opts.addressMatches?.get(t) ?? [])]))];
    if (ids.length) clauses.push(`id.in.(${ids.join(",")})`);
    q = q.or(clauses.join(","));
  } else {
    // AND across tokens: each token is its own OR-group; chained `.or()` are
    // AND-combined by PostgREST, so every token must match some column.
    for (const token of tokens) {
      q = q.or(contactSearchOrGroup(token, columns, opts.addressMatches?.get(token) ?? []));
    }
  }
  return q as Q;
}
