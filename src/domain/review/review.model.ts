import { z } from 'zod';

/**
 * FSRS state DTO — stores what ts-fsrs needs.
 * We do NOT serialize the library's class instance directly.
 * See technical-design/04 §5.5 and technical-design/08 §5.
 */
export const FsrsStateDtoSchema = z.object({
  schedulerVersion: z.string(),
  state: z.enum(['new', 'learning', 'review', 'relearning']),
  dueAt: z.string().datetime(),
  stability: z.number(),
  difficulty: z.number(),
  elapsedDays: z.number(),
  scheduledDays: z.number(),
  reps: z.number().int(),
  lapses: z.number().int(),
  lastReviewedAt: z.string().datetime().optional(),
});

export type FsrsStateDto = z.infer<typeof FsrsStateDtoSchema>;

/**
 * ReviewEvent — append-only record of a single review.
 * This is the truth; ScheduleSnapshot is a derived projection.
 * See technical-design/08 §5.
 */
export const ReviewEventSchema = z.object({
  eventId: z.string().uuid(),
  cardId: z.string().uuid(),
  sequence: z.number().int().positive(),
  sessionId: z.string().uuid(),
  attemptId: z.string().uuid(),
  occurredAt: z.string().datetime(),
  rating: z.enum(['again', 'hard', 'good', 'easy']),
  previousStateHash: z.string(),
  resultingState: FsrsStateDtoSchema,
  mode: z.enum(['quick', 'input', 'cloze', 'imitation', 'distinction']),
  source: z.enum(['review', 'practice-confirmed']),
});

export type ReviewEvent = z.infer<typeof ReviewEventSchema>;

export type ReviewRating = ReviewEvent['rating'];

/**
 * ScheduleSnapshot — a projection of the latest review state per card.
 * Must be updated in the same transaction as the ReviewEvent.
 * See technical-design/08 §5.
 */
export const ScheduleSnapshotSchema = z.object({
  cardId: z.string().uuid(),
  lastSequence: z.number().int(),
  state: FsrsStateDtoSchema,
  dueAt: z.string().datetime(),
  stateHash: z.string(),
  schedulerVersion: z.string(),
  parameterSetId: z.string(),
});

export type ScheduleSnapshot = z.infer<typeof ScheduleSnapshotSchema>;

/**
 * ReviewAttemptDetail — per-attempt details (answer, duration, error types).
 * See technical-design/08 §5.
 */
export const ReviewAttemptDetailSchema = z.object({
  attemptId: z.string().uuid(),
  cardId: z.string().uuid(),
  sessionId: z.string().uuid(),
  answer: z.string().optional(),
  referenceAnswerRef: z.string().optional(),
  durationMs: z.number().int().optional(),
  personalNote: z.string().optional(),
  suggestedErrorTypes: z.array(z.string()),
  confirmedErrorTypes: z.array(z.string()),
});

export type ReviewAttemptDetail = z.infer<typeof ReviewAttemptDetailSchema>;
