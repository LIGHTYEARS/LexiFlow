/**
 * Core domain type definitions for LexiFlow.
 * These types are pure — no DOM, React, Chrome, or SDK imports.
 * See technical-design/04 §4-5 for the full contract.
 */

/** Stable entity id (crypto.randomUUID()) */
export type EntityId = string;

/** Card types as defined in PRD §8.1 */
export type CardType = 'word' | 'phrase' | 'sentence' | 'technical_term';

/** Card lifecycle status */
export type CardStatus = 'active' | 'paused' | 'archived' | 'deleted';

/** Content provenance origin */
export type ContentOrigin = 'web_page' | 'user' | 'model' | 'import';

/**
 * Confidence labels for user-facing decisions.
 * NOT pseudo-precise scores like 0.873.
 * See technical-design/04 §4 and PRD §10.4.
 */
export type ConfidenceLabel =
  | 'exact'
  | 'likely_same'
  | 'possibly_related'
  | 'insufficient_context';

/**
 * A text value with provenance tracking.
 * The origin and source are immutable — model content can never overwrite
 * user or web_page content.
 */
export type ProvenancedText = {
  value: string;
  origin: ContentOrigin;
  sourceCaptureId?: EntityId;
  modelRunId?: EntityId;
  editedAt?: string;
};

/**
 * Relation types between cards. See PRD §8.3.
 */
export type CardRelationType =
  | 'variant'
  | 'synonym'
  | 'antonym'
  | 'confusable'
  | 'word_family'
  | 'pattern_usage'
  | 'related';

/**
 * Direction of a card relation.
 * - directed: from → to has meaning (e.g., "is a form of")
 * - symmetric: bidirectional (e.g., "is a synonym of")
 */
export type RelationDirection = 'directed' | 'symmetric';
