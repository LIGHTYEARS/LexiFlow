import { z } from 'zod';
import type { ConfidenceLabel } from '../types';

export type { ConfidenceLabel };

/**
 * Failure codes for inbox item failures.
 * Keep in sync with AppErrorCode in @shared/protocol/envelope.
 */
export type FailureCode =
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'PERMISSION_DENIED'
  | 'TIMEOUT'
  | 'INTERNAL'
  | 'STORAGE_FAILURE';

const FAILURE_CODES: readonly [FailureCode, ...FailureCode[]] = [
  'INVALID_INPUT',
  'NOT_FOUND',
  'CONFLICT',
  'PERMISSION_DENIED',
  'TIMEOUT',
  'INTERNAL',
  'STORAGE_FAILURE',
];

/**
 * InboxItem — a safe buffer between capture and the formal knowledge base.
 * See PRD §9.3-9.4 and technical-design/04 §5.3.
 */
/**
 * Draft — a partial card structure captured before formalization.
 */
export const DraftSchema = z.object({
  type: z.enum(['word', 'phrase', 'sentence', 'technical_term']).optional(),
  headword: z.string().optional(),
  explanations: z.array(z.string()).optional(),
  examples: z.array(z.string()).optional(),
  tagIds: z.array(z.string()).optional(),
});

/**
 * Suggestion — an AI-generated proposal for resolving an inbox item.
 */
export const SuggestionSchema = z.object({
  id: z.string().uuid(),
  type: z.string(),
  confidence: z.enum(['exact', 'likely_same', 'possibly_related', 'insufficient_context']),
  targetCardId: z.string().optional(),
  rationale: z.string().optional(),
});

export const InboxItemSchema = z.object({
  id: z.string().uuid(),
  revision: z.number().int().positive(),
  status: z.enum(['pending', 'processing', 'resolved', 'discarded']),
  sourceCaptureId: z.string().uuid(),
  draft: DraftSchema.optional(),
  suggestions: z.array(SuggestionSchema).optional(),
  failure: z
    .object({
      code: z.enum(FAILURE_CODES),
      userMessage: z.string(),
      retryable: z.boolean(),
    })
    .optional(),
  resolvedByOperationId: z.string().uuid().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type InboxItem = z.infer<typeof InboxItemSchema>;

/**
 * Inbox status transitions:
 * pending ↔ paused → processing → pending (retry) → resolved → discarded
 * See technical-design/06 §7.
 */
export type InboxStatus = InboxItem['status'];
