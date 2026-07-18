/**
 * Text normalization for deduplication and search keys.
 * See technical-design/04 §5.1 (normalizedKey) and technical-design/06 §6.
 */

/**
 * Normalize text for comparison:
 * - Unicode NFKC normalization
 * - Trim whitespace
 * - Collapse internal whitespace
 * - Fold case for English
 *
 * This is used for candidate recall only — it does NOT imply semantic identity.
 * Same normalizedKey can have different senses.
 */
export function normalizeForComparison(text: string): string {
  return text
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/**
 * Normalize a display value:
 * - Unicode NFKC
 * - Trim
 * - Collapse internal whitespace
 *
 * Preserves original case for display.
 */
export function normalizeForDisplay(text: string): string {
  return text.normalize('NFKC').trim().replace(/\s+/g, ' ');
}

/**
 * Count Unicode code points (not UTF-16 code units).
 * Used for selection length validation. See technical-design/03 §7.
 */
export function countCodePoints(text: string): number {
  let count = 0;
  for (const _ of text) {
    count++;
  }
  return count;
}

/**
 * Check if text contains at least one Latin letter (a-z, A-Z).
 * Used for selection validity. See technical-design/03 §7.
 */
export function hasLatinLetter(text: string): boolean {
  return /[a-zA-Z]/.test(text);
}
