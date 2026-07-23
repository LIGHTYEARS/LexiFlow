import { messageRegistry } from '@infra/messaging/message-registry';
import { ok, fail, createError } from '@shared/protocol/envelope';
import { z } from 'zod';
import { parsePayload } from './validate-payload';
import * as reviewService from '@app/review/review-service';
import { db } from '@infra/db/database';
import { ERROR_TYPES } from '@domain/error/error.model';
import { nowIso } from '@shared/utils/date';
import type {
  ReviewSession,
  ReviewItem,
  ReviewReveal,
  RatingPreview,
  ReviewCommitResult,
} from '@shared/protocol/protocol-map';

/**
 * Review & FSRS handlers (PRD §6.3, §12). All scheduling goes through the
 * FSRS adapter via ReviewService; ratings are recorded append-only.
 */

const RatingSchema = z.enum(['again', 'hard', 'good', 'easy']);

export function registerReviewHandlers(): void {
  messageRegistry.register<unknown, ReviewSession>(
    'review/createSession',
    async (payload, envelope) => {
      const parsed = parsePayload(
        z.object({
          dateBoundary: z.string().optional(),
          limits: z.object({ maxNew: z.number().optional(), maxReview: z.number().optional() }).optional(),
          modes: z.array(z.enum(['quick', 'input', 'cloze', 'imitation', 'distinction'])).optional(),
        }),
        payload,
        envelope,
      );
      if (!parsed.ok) return parsed.result;
      const session = await reviewService.createSession(parsed.value);
      return ok(envelope.requestId, session);
    },
  );

  messageRegistry.register<unknown, ReviewItem | null>(
    'review/next',
    async (payload, envelope) => {
      const parsed = parsePayload(z.object({ sessionId: z.string() }), payload, envelope);
      if (!parsed.ok) return parsed.result;
      const item = await reviewService.nextItem(parsed.value.sessionId);
      return ok(envelope.requestId, item);
    },
  );

  messageRegistry.register<unknown, ReviewReveal>(
    'review/reveal',
    async (payload, envelope) => {
      const parsed = parsePayload(
        z.object({ sessionId: z.string(), cardId: z.string(), attemptId: z.string() }),
        payload,
        envelope,
      );
      if (!parsed.ok) return parsed.result;
      const reveal = await reviewService.reveal(parsed.value.attemptId);
      return ok(envelope.requestId, reveal);
    },
  );

  messageRegistry.register<unknown, RatingPreview>(
    'review/previewRating',
    async (payload, envelope) => {
      const parsed = parsePayload(
        z.object({ attemptId: z.string(), rating: RatingSchema }),
        payload,
        envelope,
      );
      if (!parsed.ok) return parsed.result;
      const preview = await reviewService.previewRating(parsed.value.attemptId, parsed.value.rating);
      return ok(envelope.requestId, preview);
    },
  );

  messageRegistry.register<unknown, ReviewCommitResult>(
    'review/commitRating',
    async (payload, envelope) => {
      const parsed = parsePayload(
        z.object({
          attemptId: z.string(),
          rating: RatingSchema,
          expectedSequence: z.number(),
          answer: z.string().optional(),
          durationMs: z.number().optional(),
          confirmedErrorTypes: z.array(z.enum(ERROR_TYPES)).optional(),
        }),
        payload,
        envelope,
      );
      if (!parsed.ok) return parsed.result;
      const v = parsed.value;
      try {
        const result = await reviewService.commitRating(
          v.attemptId,
          v.rating,
          v.expectedSequence,
          v.answer,
          v.durationMs,
          v.confirmedErrorTypes,
        );
        return ok(envelope.requestId, result);
      } catch (error) {
        if (error && typeof error === 'object' && 'code' in error) {
          return fail(envelope.requestId, error as never);
        }
        return fail(envelope.requestId, createError('INTERNAL', 'Failed to record review', true));
      }
    },
  );

  // ── review/annotateError: add or override error types on a review event ──
  messageRegistry.register<unknown, { annotated: boolean }>(
    'review/annotateError',
    async (payload, envelope) => {
      const parsed = parsePayload(
        z.object({
          eventId: z.string(),
          confirmedTypes: z.array(z.enum(ERROR_TYPES)),
          note: z.string().optional(),
        }),
        payload,
        envelope,
      );
      if (!parsed.ok) return parsed.result;
      const { eventId, confirmedTypes, note } = parsed.value;
      const event = await db.reviewEvents.get(eventId);
      if (!event) return fail(envelope.requestId, createError('NOT_FOUND', 'Review event not found', false));

      // Remove prior user annotations for this event, then add the confirmed set.
      const existing = await db.errorAnnotations.where('reviewEventId').equals(eventId).toArray();
      await db.errorAnnotations.bulkDelete(existing.filter((e) => !e.systemSuggested).map((e) => e.id));
      for (const type of confirmedTypes) {
        await db.errorAnnotations.add({
          id: crypto.randomUUID(),
          cardId: event.cardId,
          reviewEventId: eventId,
          type,
          systemSuggested: false,
          note,
          createdAt: nowIso(),
        });
      }
      return ok(envelope.requestId, { annotated: true });
    },
  );
}
