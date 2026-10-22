/** A per-tab navigation hint only. Auth and the native frame still own admission. */
const uuid = (v: string | null): v is string => !!v && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);
const key = (actor: string) => `client-portal-business:${actor}`;
export type ClientPortalEntry = {businessId: string | null; choose: boolean; invalid: boolean; intentional: boolean};

export function clientPortalEntry(actor: string | null, search: string): ClientPortalEntry {
  const params = new URLSearchParams(search);
  const businesses = params.getAll("business"), choices = params.getAll("chooseBusiness");
  const explicit = businesses.length > 0 || choices.length > 0;
  if (businesses.length > 1 || choices.length > 1 || (choices.length && choices[0] !== "1")
    || (businesses.length && !uuid(businesses[0])) || (choices.length && businesses.length)) {
    return {businessId: null, choose: false, invalid: true, intentional: true};
  }
  if (choices.length) return {businessId: null, choose: true, invalid: false, intentional: true};
  if (businesses.length) return {businessId: businesses[0], choose: false, invalid: false, intentional: true};
  let saved: string | null = null;
  try {if (actor) saved = sessionStorage.getItem(key(actor));} catch {/* Optional navigation memory. */}
  return {businessId: uuid(saved) ? saved : null, choose: false, invalid: false, intentional: explicit || uuid(saved)};
}

/** Call only after the original frame and Auth have verified this exact pair. */
export function rememberClientPortalBusiness(actor: string, business: string): void {
  if (!uuid(actor) || !uuid(business)) return;
  try {sessionStorage.setItem(key(actor), business);} catch {/* URL entry still works without storage. */}
}
export const clientPortalBusinessHref = (business: string): string => {
  if (!uuid(business)) throw new Error("Invalid customer business");
  return `/app?business=${business}`;
};
/** Full navigation preserves the existing native unsaved-work guard. */
export const CLIENT_PORTAL_CHOOSE_HREF = "/app?chooseBusiness=1";
