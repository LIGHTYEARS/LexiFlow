import { getCardsByNormalizedKey } from '@infra/db/repository-impl';
import { normalizeForComparison } from '@shared/utils/normalize';
import { computeContentHash } from '@infra/db/transactions';
import type { Card } from '@domain/card/card.model';
import type { ConfidenceLabel } from '@domain/types';

/**
 * DedupService — implements the save-before judgment pipeline.
 * Pipeline: normalize → exact match → candidate recall → domain comparison → risk strategy → preview.
 * See technical-design/06 §6 and PRD §9.1-9.2.
 */

export type RelationAssessment =
  | 'exact_duplicate'
  | 'same_word_form'
  | 'same_expression_new_context'
  | 'same_word_different_sense'
  | 'expression_variant'
  | 'near_synonym'
  | 'antonym_or_confusable'
  | 'topic_related'
  | 'unrelated';

export interface DedupSuggestion {
  candidateCardId: string;
  candidateHeadword: string;
  relation: RelationAssessment;
  confidence: ConfidenceLabel;
  rationale: string;
  proposedAction: 'skip' | 'append-source' | 'new-card' | 'add-sense' | 'relate' | 'inbox';
  risk: 'low' | 'medium' | 'high';
}

export interface DedupPreview {
  captureId: string;
  suggestions: DedupSuggestion[];
  defaultAction: 'new-card' | 'inbox' | 'skip' | 'append-source';
}

/**
 * Assess the relationship between a new selection and an existing card.
 * Uses deterministic domain rules (no AI in this path).
 */
function assessRelation(
  newText: string,
  newNormalized: string,
  newHash: string,
  card: Card,
): { relation: RelationAssessment; confidence: ConfidenceLabel; rationale: string } {
  const cardNormalized = card.normalizedKey;
  const cardHeadword = card.headword.value;

  // Exact duplicate: same normalized text
  if (newNormalized === cardNormalized) {
    return {
      relation: 'exact_duplicate',
      confidence: 'exact',
      rationale: 'Identical normalized text',
    };
  }

  // Same word form: one is a morphological variant of the other (e.g., "running" vs "run")
  if (areWordForms(newNormalized, cardNormalized)) {
    return {
      relation: 'same_word_form',
      confidence: 'likely_same',
      rationale: 'Likely morphological variant (e.g., different tense or plural)',
    };
  }

  // Substring containment: new text contains the card headword or vice versa
  if (newNormalized.includes(cardNormalized) || cardNormalized.includes(newNormalized)) {
    if (newNormalized.split(' ').length > 1 || cardNormalized.split(' ').length > 1) {
      return {
        relation: 'same_expression_new_context',
        confidence: 'likely_same',
        rationale: 'One expression contains the other',
      };
    }
  }

  // Expression variant: high overlap of words (e.g., "take into account" vs "take into consideration")
  const overlap = wordOverlap(newNormalized, cardNormalized);
  if (overlap >= 0.6 && newNormalized.split(' ').length > 1 && cardNormalized.split(' ').length > 1) {
    return {
      relation: 'expression_variant',
      confidence: 'possibly_related',
      rationale: 'High word overlap suggests a variant expression',
    };
  }

  // Default: possibly related (same topic) or unrelated
  return {
    relation: 'topic_related',
    confidence: 'insufficient_context',
    rationale: 'May be topically related but needs confirmation',
  };
}

/**
 * Check if two words are likely morphological variants.
 * Simple heuristic: share a common stem of 4+ characters.
 */
function areWordForms(a: string, b: string): boolean {
  if (a === b) return false;
  const minLen = Math.min(a.length, b.length);
  if (minLen < 4) return false;
  // Find common prefix length
  let commonPrefix = 0;
  for (let i = 0; i < minLen; i++) {
    if (a[i] === b[i]) commonPrefix++;
    else break;
  }
  // Common prefix of 4+ chars and one is a suffix variant
  return commonPrefix >= 4 && Math.abs(a.length - b.length) <= 4;
}

/**
 * Calculate word overlap ratio between two strings.
 */
function wordOverlap(a: string, b: string): number {
  const wordsA = new Set(a.split(/\s+/).filter(Boolean));
  const wordsB = new Set(b.split(/\s+/).filter(Boolean));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  let common = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) common++;
  }
  return common / Math.max(wordsA.size, wordsB.size);
}

/**
 * Determine the proposed action and risk level based on the relation assessment.
 * See PRD §10.1-10.2 (risk matrix).
 */
function determineAction(
  relation: RelationAssessment,
  confidence: ConfidenceLabel,
): { action: DedupSuggestion['proposedAction']; risk: DedupSuggestion['risk'] } {
  switch (relation) {
    case 'exact_duplicate':
      return { action: 'skip', risk: 'low' };
    case 'same_word_form':
    case 'same_expression_new_context':
      return { action: 'append-source', risk: 'low' };
    case 'same_word_different_sense':
    case 'expression_variant':
      return { action: 'add-sense', risk: 'high' };
    case 'near_synonym':
    case 'antonym_or_confusable':
      return { action: 'relate', risk: 'medium' };
    case 'topic_related':
      return { action: 'inbox', risk: 'medium' };
    default:
      return { action: 'new-card', risk: 'medium' };
  }
}

/**
 * Generate a dedup preview for a new selection.
 * Returns candidate cards with relationship assessments and proposed actions.
 */
export async function generateDedupPreview(
  captureId: string,
  selectedText: string,
): Promise<DedupPreview> {
  const normalized = normalizeForComparison(selectedText);
  const hash = computeContentHash(selectedText);

  // Step 1: Exact match by normalized key
  const exactMatches = await getCardsByNormalizedKey(normalized);

  // Step 2: Candidate recall — also try prefix matches for word forms
  const candidates: Card[] = [...exactMatches];
  if (candidates.length === 0) {
    // For single words, try matching by first 4 chars as stem
    if (normalized.length >= 4) {
      const stem = normalized.slice(0, 4);
      // This would use MiniSearch in production; for now skip
    }
  }

  // Step 3: Assess each candidate
  const suggestions: DedupSuggestion[] = candidates.map((card) => {
    const { relation, confidence, rationale } = assessRelation(selectedText, normalized, hash, card);
    const { action, risk } = determineAction(relation, confidence);
    return {
      candidateCardId: card.id,
      candidateHeadword: card.headword.value,
      relation,
      confidence,
      rationale,
      proposedAction: action,
      risk,
    };
  });

  // Step 4: Determine default action
  let defaultAction: DedupPreview['defaultAction'] = 'new-card';
  const lowRiskSuggestions = suggestions.filter((s) => s.risk === 'low');
  if (lowRiskSuggestions.length > 0) {
    const skipSuggestion = lowRiskSuggestions.find((s) => s.proposedAction === 'skip');
    if (skipSuggestion) {
      defaultAction = 'skip';
    } else {
      defaultAction = 'append-source';
    }
  } else if (suggestions.length > 0) {
    // Has candidates but all medium/high risk — default to inbox for safety
    defaultAction = 'inbox';
  }

  return {
    captureId,
    suggestions,
    defaultAction,
  };
}
