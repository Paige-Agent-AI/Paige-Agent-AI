/**
 * The Supabase project's server-side password policy, stated once so the
 * signup schema and the visible PasswordStrengthIndicator requirements can
 * never disagree. The symbol set is transcribed verbatim from the live
 * weak_password 422 observed during the first real signup drive (EXP00,
 * 2026-10-17): characters outside this set (whitespace, emoji, other
 * non-ASCII) do NOT satisfy the server's "symbol" class.
 */
export const PASSWORD_SYMBOL_SET = "!@#$%^&*()_+-=[]{};'\\:\"|<>?,./`~.";

export const hasServerSymbol = (v: string): boolean =>
  [...v].some((ch) => PASSWORD_SYMBOL_SET.includes(ch));

export const passwordRequirementChecks = (v: string) => ({
  length: v.length >= 6,
  lowercase: /[a-z]/.test(v),
  uppercase: /[A-Z]/.test(v),
  digit: /[0-9]/.test(v),
  symbol: hasServerSymbol(v),
});

/** The four character classes the server enforces when a password is SET
 *  (signup/reset). Length minimums stay at each surface's own rule. */
export const passwordMeetsServerClasses = (v: string): boolean => {
  const c = passwordRequirementChecks(v);
  return c.lowercase && c.uppercase && c.digit && c.symbol;
};
