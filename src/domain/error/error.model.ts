import { z } from 'zod';

/**
 * ErrorAnnotation — records a specific error from a review or practice attempt.
 * System suggestions and user confirmations are stored separately.
 * See PRD §12.4 and technical-design/08 §5.6.
 */
export const ErrorAnnotationSchema = z.object({
  id: z.string().uuid(),
  cardId: z.string().uuid(),
  reviewEventId: z.string().uuid().optional(),
  practiceAttemptId: z.string().uuid().optional(),
  type: z.string(),
  userOverride: z.string().optional(),
  note: z.string().optional(),
  systemSuggested: z.boolean(),
  createdAt: z.string().datetime(),
});

export type ErrorAnnotation = z.infer<typeof ErrorAnnotationSchema>;

/**
 * Error types per PRD §12.4.
 */
export const ERROR_TYPES = [
  'forgot_meaning',
  'recognized_but_cannot_use',
  'collocation_error',
  'confused_with_similar',
  'register_inappropriate',
  'context_inappropriate',
] as const;

export type ErrorType = (typeof ERROR_TYPES)[number];
