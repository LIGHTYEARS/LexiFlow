import { messageRegistry } from '@infra/messaging/message-registry';
import { ok, fail, createError } from '@shared/protocol/envelope';
import { z } from 'zod';
import { parsePayload } from './validate-payload';
import * as practiceService from '@app/practice/practice-service';
import { getSettings } from '@infra/storage/settings-gateway';
import { requireConfirmation, mintConfirmationToken } from '@app/safety/risk-policy';
import type { FsrsImpactPreview } from '@shared/protocol/protocol-map';

/**
 * Practice handlers (PRD §12.5, §19.6). Practice never affects FSRS unless the
 * user opted in AND confirmed the previewed impact.
 */

const PracticeTypeSchema = z.enum([
  'zh-to-en',
  'en-to-zh',
  'cloze',
  'multiple-choice',
  'synonym-distinction',
  'imitation',
  'term-explanation',
  'error-replay',
]);

const SourceSchema = z.union([
  z.object({ type: z.literal('errors'), errorTypes: z.array(z.string()).optional() }),
  z.object({ type: z.literal('difficult') }),
  z.object({ type: z.literal('tag'), tagId: z.string() }),
  z.object({ type: z.literal('manual'), cardIds: z.array(z.string()) }),
]);

export function registerPracticeHandlers(): void {
  messageRegistry.register<unknown, { sessionId: string; itemCount: number }>(
    'practice/generate',
    async (payload, envelope) => {
      const parsed = parsePayload(
        z.object({ source: SourceSchema, practiceType: PracticeTypeSchema }),
        payload,
        envelope,
      );
      if (!parsed.ok) return parsed.result;
      try {
        const result = await practiceService.generateSession(parsed.value.source, parsed.value.practiceType);
        return ok(envelope.requestId, result);
      } catch (error) {
        if (error && typeof error === 'object' && 'code' in error) return fail(envelope.requestId, error as never);
        return fail(envelope.requestId, createError('INTERNAL', 'Failed to generate practice', true));
      }
    },
  );

  messageRegistry.register<unknown, { items: Array<{ itemId: string; type: string; prompt: string; explanation?: string; choices?: string[] }> }>(
    'practice/getSession',
    async (payload, envelope) => {
      const parsed = parsePayload(z.object({ sessionId: z.string() }), payload, envelope);
      if (!parsed.ok) return parsed.result;
      const items = await practiceService.getSessionItems(parsed.value.sessionId);
      return ok(envelope.requestId, { items });
    },
  );

  messageRegistry.register<unknown, { attemptId: string }>(
    'practice/recordAttempt',
    async (payload, envelope) => {
      const parsed = parsePayload(
        z.object({
          itemId: z.string(),
          userAnswer: z.string(),
          outcome: z.enum(['correct', 'incorrect', 'partial', 'skipped']),
          fsrsRating: z.enum(['again', 'hard', 'good', 'easy']).optional(),
        }),
        payload,
        envelope,
      );
      if (!parsed.ok) return parsed.result;
      const v = parsed.value;
      const result = await practiceService.recordAttempt(v.itemId, v.userAnswer, v.outcome, v.fsrsRating);
      return ok(envelope.requestId, result);
    },
  );

  // ── practice/previewFsrsImpact: also mints the confirmation token ──
  messageRegistry.register<unknown, FsrsImpactPreview & { confirmationToken?: string }>(
    'practice/previewFsrsImpact',
    async (payload, envelope) => {
      const parsed = parsePayload(z.object({ practiceAttemptIds: z.array(z.string()) }), payload, envelope);
      if (!parsed.ok) return parsed.result;
      const settings = await getSettings();
      if (!settings.review.allowPracticeAffectsFsrs) {
        return fail(
          envelope.requestId,
          createError('PERMISSION_DENIED', 'Practice-affects-FSRS is disabled in settings', false),
        );
      }
      const preview = await practiceService.previewFsrsImpact(parsed.value.practiceAttemptIds);
      const token = mintConfirmationToken('practice.affect-fsrs', preview.previewId);
      return ok(envelope.requestId, { ...preview, confirmationToken: token });
    },
  );

  messageRegistry.register<unknown, { committed: boolean }>(
    'practice/commitFsrsImpact',
    async (payload, envelope) => {
      const parsed = parsePayload(
        z.object({ previewId: z.string(), confirmationToken: z.string() }),
        payload,
        envelope,
      );
      if (!parsed.ok) return parsed.result;
      const settings = await getSettings();
      if (!settings.review.allowPracticeAffectsFsrs) {
        return fail(envelope.requestId, createError('PERMISSION_DENIED', 'Practice-affects-FSRS is disabled', false));
      }
      try {
        requireConfirmation('practice.affect-fsrs', parsed.value.previewId, parsed.value.confirmationToken);
        const result = await practiceService.commitFsrsImpact(parsed.value.previewId);
        return ok(envelope.requestId, result);
      } catch (error) {
        if (error && typeof error === 'object' && 'code' in error) return fail(envelope.requestId, error as never);
        return fail(envelope.requestId, createError('INTERNAL', 'Commit failed', true));
      }
    },
  );
}
