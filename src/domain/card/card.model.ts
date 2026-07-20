import { z } from 'zod';

import type { EntityId, CardType, CardStatus, ContentOrigin, ProvenancedText } from '../types';

export type { EntityId, CardType, CardStatus, ContentOrigin, ProvenancedText };

/**
 * A text value with provenance tracking.
 * Shared schema reused across headword, explanations, examples, notes.
 * Keep in sync with ProvenancedText in ../types.ts.
 */
export const ProvenancedTextSchema = z.object({
  value: z.string(),
  // Keep in sync with ContentOrigin in ../types.ts
  origin: z.enum(['web_page', 'user', 'model', 'import']),
  sourceCaptureId: z.string().uuid().optional(),
  modelRunId: z.string().uuid().optional(),
  editedAt: z.string().optional(),
});

/**
 * Type-specific card content. Uses discriminated union.
 * See technical-design/04 §5.1 (details field).
 */
export const WordSenseSchema = z.object({
  definition: z.string(),
  partOfSpeech: z.string().optional(),
  register: z.string().optional(),
  examples: z.array(z.string()).optional(),
});

export const WordContentSchema = z.object({
  cardType: z.literal('word'),
  lemma: z.string().optional(),
  partOfSpeech: z.string().optional(),
  pronunciation: z.string().optional(),
  senses: z.array(WordSenseSchema).optional(),
});

export const PhraseContentSchema = z.object({
  cardType: z.literal('phrase'),
  register: z.string().optional(),
  patterns: z.array(z.string()).optional(),
  collocations: z.array(z.string()).optional(),
});

export const SentenceContentSchema = z.object({
  cardType: z.literal('sentence'),
  translation: z.string().optional(),
  reusableStructure: z.array(z.string()).optional(),
  imitationExamples: z.array(z.string()).optional(),
});

export const TechnicalTermContentSchema = z.object({
  cardType: z.literal('technical_term'),
  domain: z.string().optional(),
  relatedConcepts: z.array(z.string()).optional(),
  commonConfusions: z.array(z.string()).optional(),
});

export const CardContentSchema = z.discriminatedUnion('cardType', [
  WordContentSchema,
  PhraseContentSchema,
  SentenceContentSchema,
  TechnicalTermContentSchema,
]);

export type CardContent = z.infer<typeof CardContentSchema>;

/**
 * Card entity — the core knowledge unit.
 * See technical-design/04 §5.1.
 */
export const CardSchema = z.object({
  id: z.string().uuid(),
  revision: z.number().int().positive(),
  // Keep in sync with CardType in ../types.ts
  type: z.enum(['word', 'phrase', 'sentence', 'technical_term']),
  // Keep in sync with CardStatus in ../types.ts
  status: z.enum(['active', 'paused', 'archived', 'deleted']),
  headword: ProvenancedTextSchema,
  normalizedKey: z.string(),
  explanations: z.array(ProvenancedTextSchema),
  examples: z.array(ProvenancedTextSchema),
  notes: z.array(ProvenancedTextSchema),
  content: CardContentSchema.optional(),
  tagIds: z.array(z.string().uuid()),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().optional(),
});

export type Card = z.infer<typeof CardSchema>;
