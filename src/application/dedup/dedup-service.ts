import { getCardsByNormalizedKey } from '@infra/db/repository-impl';
import { computeContentHash } from '@infra/db/transactions';
import { db } from '@infra/db/database';
import { normalizeForComparison } from '@shared/utils/normalize';
import type { Card } from '@domain/card/card.model';
import type { DedupSuggestion } from '@shared/protocol/protocol-map';

/**
 * Deduplication / similarity judgment before save (PRD §9.1, §9.2,
 * technical-design/06 §6).
 *
 * Deliberately NOT a single opaque similarity score (§10.4, technical-design/04
 * §4 D1). We produce user-facing confidence labels with rationale and a target
 * card, using layered deterministic signals:
 *   - exact content hash match on the same page  → exact duplicate
 *   - same normalized key                        → likely same (word form / sense)
 *   - shared normalized tokens                   → possibly related
 * The model may refine these, but the deterministic layer is authoritative for
 * the "exact" verdict so we never create a second card for an exact duplicate.
 */

export interface DedupCandidate {
  selectedText: string;
  contentHash: string;
  pageId?: string;
}

/**
 * Compute dedup suggestions for a would-be capture against existing cards.
 * Returns suggestions ordered strongest-first.
 */
export async function computeDedupSuggestions(
  candidate: DedupCandidate,
): Promise<DedupSuggestion[]> {
  const normalizedKey = normalizeForComparison(candidate.selectedText);
  const suggestions: DedupSuggestion[] = [];

  // Layer 1 + 2: cards sharing the normalized key.
  const sameKeyCards = await getCardsByNormalizedKey(normalizedKey);
  for (const card of sameKeyCards) {
    const exact = await isExactDuplicate(card, candidate);
    if (exact) {
      suggestions.push({
        candidateCardId: card.id,
        confidence: 'exact',
        relationType: 'variant',
        rationale: 'Same text already captured from this source — exact duplicate.',
      });
    } else {
      suggestions.push({
        candidateCardId: card.id,
        confidence: 'likely_same',
        relationType: 'variant',
        rationale: 'A card with the same headword already exists; this may be a new context or sense.',
      });
    }
  }

  // Layer 3: token-overlap for "possibly related" (only if no stronger match).
  if (suggestions.length === 0) {
    const related = await findTokenRelated(normalizedKey);
    for (const card of related) {
      suggestions.push({
        candidateCardId: card.id,
        confidence: 'possibly_related',
        rationale: 'Shares wording with an existing card; may be related.',
      });
    }
  }

  return suggestions;
}

/**
 * True if this capture is an exact duplicate of an existing card: same content
 * hash AND the card is already linked to a capture from the same page.
 */
async function isExactDuplicate(card: Card, candidate: DedupCandidate): Promise<boolean> {
  const links = await db.cardSourceLinks.where('cardId').equals(card.id).toArray();
  if (links.length === 0) return false;
  const captureIds = links.map((l) => l.sourceCaptureId);
  const captures = await db.sourceCaptures.where('id').anyOf(captureIds).toArray();
  return captures.some(
    (c) => c.contentHash === candidate.contentHash &&
      (candidate.pageId ? c.pageId === candidate.pageId : true),
  );
}

/**
 * Find cards whose headword shares a significant token with the candidate.
 * Bounded scan; suitable for a personal-scale local DB.
 */
async function findTokenRelated(normalizedKey: string): Promise<Card[]> {
  const tokens = new Set(normalizedKey.split(/\s+/).filter((t) => t.length >= 4));
  if (tokens.size === 0) return [];
  const all = await db.cards.filter((c) => c.status === 'active').limit(500).toArray();
  const matches: Card[] = [];
  for (const card of all) {
    if (card.normalizedKey === normalizedKey) continue;
    const cardTokens = card.normalizedKey.split(/\s+/);
    if (cardTokens.some((t) => tokens.has(t))) {
      matches.push(card);
      if (matches.length >= 5) break;
    }
  }
  return matches;
}

/**
 * Whether a capture should be auto-skipped as an exact duplicate.
 * Only exact-confidence with an existing source qualifies for auto-skip (§10.1).
 */
export function hasExactDuplicate(suggestions: DedupSuggestion[]): DedupSuggestion | undefined {
  return suggestions.find((s) => s.confidence === 'exact');
}

export { computeContentHash };
