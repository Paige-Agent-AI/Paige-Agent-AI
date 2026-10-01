export type CanonicalPersonName = Readonly<{
  /**
   * Safe human-facing/storage form: Unicode-composed and all Unicode
   * whitespace collapsed to one space. Letter case and format controls are
   * preserved because join controls can be meaningful name orthography.
   */
  display: string;
  /**
   * Stable comparison/hash form. Compatibility normalization and
   * locale-independent Unicode lowercase make equivalent casing and composed
   * spellings share one identity without forcing lowercase into the UI or CRM.
   */
  identity: string;
}>;

// These three controls do not alter name orthography. Remove them only from
// the identity/hash projection. U+180E, U+200C and U+200D are intentionally
// preserved: Mongolian and joining scripts use them meaningfully.
const HASH_IGNORABLE_NAME_FORMAT = /[\u200b\u2060\ufeff]/gu;
const UNICODE_WHITESPACE = /\p{White_Space}+/gu;
const UNICODE_FORMAT = /\p{Cf}/gu;

/**
 * ECMAScript has Unicode case conversion but no full case-fold operation.
 * Per-code-point upper-then-lower matches the Unicode default full fold except
 * for the explicit mappings below: dotless i, sharp s, and Cherokee (whose
 * case-fold identity is uppercase). Keeping that finite gap here makes the
 * comparison form complete without changing the human-facing spelling.
 */
function unicodeDefaultCaseFold(value: string): string {
  return Array.from(value, (character) => {
    const codePoint = character.codePointAt(0)!;
    if (codePoint === 0x0131) return character;
    if (codePoint === 0x00df || codePoint === 0x1e9e) return "ss";
    if ((codePoint >= 0x13a0 && codePoint <= 0x13ef)
      || (codePoint >= 0x13f0 && codePoint <= 0x13f5)) return character;
    if (codePoint >= 0xab70 && codePoint <= 0xabbf) {
      return String.fromCodePoint(codePoint - 0x97d0);
    }
    if (codePoint >= 0x13f8 && codePoint <= 0x13fd) {
      return String.fromCodePoint(codePoint - 0x8);
    }
    return character.toUpperCase().toLowerCase();
  }).join("").normalize("NFKC");
}

/**
 * The one canonical person-name boundary for validation, rendering/storage,
 * and comparison/hash consumers.
 *
 * A null result means the input has no visible name content after normalization.
 */
export function canonicalizePersonName(value: unknown): CanonicalPersonName | null {
  if (typeof value !== "string") return null;
  const display = value
    .normalize("NFC")
    .replace(UNICODE_WHITESPACE, " ")
    .trim();
  const visibleContent = display.replace(UNICODE_FORMAT, "").replace(UNICODE_WHITESPACE, "");
  if (!visibleContent) return null;
  const identity = display
    .normalize("NFKC")
    .replace(HASH_IGNORABLE_NAME_FORMAT, "")
    .replace(UNICODE_WHITESPACE, " ")
    .trim();
  const foldedIdentity = unicodeDefaultCaseFold(identity);
  if (!foldedIdentity) return null;
  return Object.freeze({
    display,
    identity: foldedIdentity,
  });
}
