import { messageRegistry } from '@infra/messaging/message-registry';
import { ok, fail, createError } from '@shared/protocol/envelope';
import { z } from 'zod';
import { parsePayload } from './validate-payload';
import { aiTaskCoordinator } from '@adapters/ai/ai-task-coordinator';
import { saveCapture, appendSourceToCard } from '@app/capture/capture-service';
import { computeDedupSuggestions, computeContentHash } from '@app/dedup/dedup-service';
import { requireConfirmation, mintConfirmationToken, signatureFor } from '@app/safety/risk-policy';
import { getSourceCapture } from '@infra/db/repository-impl';
import { db } from '@infra/db/database';
import { hostnameOf } from '@shared/utils/url';
import type { SourceCapture } from '@domain/source/source.model';
import type {
  ExplainAccepted,
  SaveCaptureResult,
  DedupPreview,
} from '@shared/protocol/protocol-map';
import type { AiTaskSnapshot } from '@shared/protocol/protocol-map';

/**
 * Capture handlers — the reading-time loop's backend (PRD §6.1, §7, §9).
 * `selection/explain` is the content-script entry point; it validates the page
 * origin implicitly via sender (content scripts only run on authorized origins)
 * and runs a quick-explain AI task. `capture/save` persists via CaptureService.
 */

const ContextSchema = z.object({
  sentenceBefore: z.string().optional(),
  sentenceContaining: z.string().optional(),
  sentenceAfter: z.string().optional(),
  paragraphExcerpt: z.string().optional(),
  nearestHeading: z.string().optional(),
  pageTitle: z.string(),
  url: z.string().url(),
  canonicalUrl: z.string().url().optional(),
  siteName: z.string().optional(),
  extractedAt: z.string(),
  quality: z.enum(['full', 'partial', 'selection_only']),
  omissions: z.array(z.string()).optional(),
});

const ExplainCommandSchema = z.object({
  requestId: z.string(),
  selection: z.string().min(1),
  context: ContextSchema.partial().optional(),
  source: z.object({ origin: z.string(), urlWithoutFragment: z.string() }),
  task: z.literal('quick-explain'),
});

const SaveCommandSchema = z.object({
  requestId: z.string(),
  selectedText: z.string().min(1),
  context: ContextSchema,
  pageUrl: z.string().url(),
  pageTitle: z.string(),
  siteName: z.string().optional(),
  requestedAction: z.enum(['save', 'save-to-inbox']),
  idempotencyKey: z.string().optional(),
  draft: z
    .object({
      type: z.enum(['word', 'phrase', 'sentence', 'technical_term']),
      headword: z.string(),
      explanations: z.array(z.object({ value: z.string(), origin: z.enum(['web_page', 'user', 'model', 'import']) })).optional(),
      examples: z.array(z.object({ value: z.string(), origin: z.enum(['web_page', 'user', 'model', 'import']) })).optional(),
    })
    .optional(),
});

export function registerCaptureHandlers(): void {
  // ── selection/explain: run a quick-explain AI task and return the result ──
  messageRegistry.register<unknown, ExplainAccepted & { snapshot: AiTaskSnapshot }>(
    'selection/explain',
    async (payload, envelope) => {
      const parsed = parsePayload(ExplainCommandSchema, payload, envelope);
      if (!parsed.ok) return parsed.result;
      const cmd = parsed.value;

      const taskId = crypto.randomUUID();
      const contextText = buildContextText(cmd.context);
      const idempotencyKey = `quick-explain:${computeContentHash(cmd.selection)}:${cmd.source.urlWithoutFragment}`;

      aiTaskCoordinator.start({
        taskId,
        requestId: cmd.requestId,
        idempotencyKey,
        type: 'quick-explain',
        input: {
          selectedText: cmd.selection,
          context: contextText,
          pageTitle: cmd.context?.pageTitle,
        },
      });
      const snapshot = await aiTaskCoordinator.await(taskId);
      return ok(envelope.requestId, { taskId, requestId: cmd.requestId, snapshot });
    },
  );

  // ── selection/cancel ──
  messageRegistry.register<unknown, { cancelled: boolean }>(
    'selection/cancel',
    (payload, envelope) => {
      const parsed = parsePayload(z.object({ requestId: z.string() }), payload, envelope);
      if (!parsed.ok) return parsed.result;
      // requestId maps to taskId in our flow when the caller passes taskId;
      // cancel by taskId if provided, else no-op.
      const state = aiTaskCoordinator.cancel(parsed.value.requestId);
      return ok(envelope.requestId, { cancelled: state.state === 'cancelled' });
    },
  );

  // ── capture/save: persist a capture (idempotent) ──
  messageRegistry.register<unknown, SaveCaptureResult>(
    'capture/save',
    async (payload, envelope) => {
      const parsed = parsePayload(SaveCommandSchema, payload, envelope);
      if (!parsed.ok) return parsed.result;
      const cmd = parsed.value;
      const domain = hostnameOf(cmd.pageUrl) ?? '';

      const context: SourceCapture['context'] = {
        ...cmd.context,
        pageTitle: cmd.context.pageTitle,
        url: cmd.pageUrl,
      };

      const result = await saveCapture({
        requestId: cmd.requestId,
        selectedText: cmd.selectedText,
        context,
        pageUrl: cmd.pageUrl,
        pageTitle: cmd.pageTitle,
        siteName: cmd.siteName,
        domain,
        requestedAction: cmd.requestedAction,
        draft: cmd.draft,
      });
      return ok(envelope.requestId, result);
    },
  );

  // ── capture/previewDecision: dedup suggestions for a stored capture ──
  messageRegistry.register<unknown, DedupPreview>(
    'capture/previewDecision',
    async (payload, envelope) => {
      const parsed = parsePayload(z.object({ captureId: z.string() }), payload, envelope);
      if (!parsed.ok) return parsed.result;
      const capture = await getSourceCapture(parsed.value.captureId);
      if (!capture) {
        return fail(envelope.requestId, createError('NOT_FOUND', 'Capture not found', false));
      }
      const suggestions = await computeDedupSuggestions({
        selectedText: capture.selectedText,
        contentHash: capture.contentHash,
        pageId: capture.pageId,
      });
      return ok(envelope.requestId, { captureId: capture.id, suggestions });
    },
  );

  // ── capture/applyDecision: apply skip/append/merge on an existing capture ──
  messageRegistry.register<unknown, SaveCaptureResult>(
    'capture/applyDecision',
    async (payload, envelope) => {
      const parsed = parsePayload(
        z.object({
          captureId: z.string(),
          suggestionRevision: z.number(),
          action: z.enum(['save', 'save-to-inbox', 'skip', 'merge']),
          targetCardId: z.string().optional(),
          confirmationToken: z.string().optional(),
        }),
        payload,
        envelope,
      );
      if (!parsed.ok) return parsed.result;
      const cmd = parsed.value;
      const capture = await getSourceCapture(cmd.captureId);
      if (!capture) {
        return fail(envelope.requestId, createError('NOT_FOUND', 'Capture not found', false));
      }

      if (cmd.action === 'skip') {
        const item = await db.inboxItems.where('sourceCaptureId').equals(cmd.captureId).first();
        if (item) await db.inboxItems.update(item.id, { status: 'discarded', updatedAt: new Date().toISOString() });
        return ok(envelope.requestId, { captureId: cmd.captureId, status: 'skipped', message: 'Skipped.' });
      }

      if ((cmd.action === 'merge' || cmd.action === 'save') && cmd.targetCardId) {
        // Appending to an existing card / merging is a must-confirm op (§10.2).
        requireConfirmation('card.merge', signatureFor([cmd.targetCardId, cmd.captureId]), cmd.confirmationToken);
        await appendSourceToCard(envelope.requestId, cmd.targetCardId, cmd.captureId, 'additional_context');
        const item = await db.inboxItems.where('sourceCaptureId').equals(cmd.captureId).first();
        if (item) await db.inboxItems.update(item.id, { status: 'resolved', updatedAt: new Date().toISOString() });
        return ok(envelope.requestId, { captureId: cmd.captureId, status: 'appended', cardId: cmd.targetCardId, message: 'Appended to existing card.' });
      }

      return ok(envelope.requestId, { captureId: cmd.captureId, status: 'inbox', message: 'Kept in Inbox.' });
    },
  );

  // ── capture/mintConfirmation: UI asks for a token after showing impact ──
  messageRegistry.register<unknown, { token: string }>(
    'capture/mintConfirmation',
    (payload, envelope) => {
      const parsed = parsePayload(
        z.object({ targetCardId: z.string(), captureId: z.string() }),
        payload,
        envelope,
      );
      if (!parsed.ok) return parsed.result;
      const token = mintConfirmationToken('card.merge', signatureFor([parsed.value.targetCardId, parsed.value.captureId]));
      return ok(envelope.requestId, { token });
    },
  );
}

function buildContextText(context?: Partial<z.infer<typeof ContextSchema>>): string | undefined {
  if (!context) return undefined;
  const parts = [context.sentenceBefore, context.sentenceContaining, context.sentenceAfter]
    .filter(Boolean)
    .join(' ');
  return parts || context.paragraphExcerpt || undefined;
}
