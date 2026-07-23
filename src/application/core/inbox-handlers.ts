import { messageRegistry } from '@infra/messaging/message-registry';
import { ok, fail, createError } from '@shared/protocol/envelope';
import { z } from 'zod';
import { parsePayload } from './validate-payload';
import * as inboxService from '@app/inbox/inbox-service';
import { requireConfirmation, mintConfirmationToken, signatureFor } from '@app/safety/risk-policy';
import type {
  InboxBatchPreview,
  InboxBatchResult,
} from '@shared/protocol/protocol-map';

/**
 * Inbox batch handlers (PRD §9.5, §15.4). Batch apply of destructive/promoting
 * actions requires a confirmation token minted from the preview (§10.2).
 */

const ActionSchema = z.enum(['save', 'save-to-inbox', 'skip', 'merge']);

export function registerInboxHandlers(): void {
  messageRegistry.register<unknown, InboxBatchPreview & { confirmationToken: string }>(
    'inbox/batchPreview',
    async (payload, envelope) => {
      const parsed = parsePayload(
        z.object({ itemIds: z.array(z.string()).min(1), proposedAction: ActionSchema }),
        payload,
        envelope,
      );
      if (!parsed.ok) return parsed.result;
      const preview = await inboxService.previewBatch(parsed.value.itemIds, parsed.value.proposedAction);
      // Mint a confirmation token bound to this preview for the apply step.
      const token = mintConfirmationToken('inbox.batch-promote', preview.previewId);
      return ok(envelope.requestId, { ...preview, confirmationToken: token });
    },
  );

  messageRegistry.register<unknown, InboxBatchResult>(
    'inbox/batchApply',
    async (payload, envelope) => {
      const parsed = parsePayload(
        z.object({ batchPreviewId: z.string(), confirmationToken: z.string() }),
        payload,
        envelope,
      );
      if (!parsed.ok) return parsed.result;
      try {
        requireConfirmation('inbox.batch-promote', parsed.value.batchPreviewId, parsed.value.confirmationToken);
        const result = await inboxService.applyBatch(parsed.value.batchPreviewId);
        return ok(envelope.requestId, result);
      } catch (error) {
        if (error && typeof error === 'object' && 'code' in error) return fail(envelope.requestId, error as never);
        return fail(envelope.requestId, createError('INTERNAL', 'Batch apply failed', true));
      }
    },
  );

  messageRegistry.register<unknown, { reverted: boolean }>(
    'inbox/undoBatch',
    async (payload, envelope) => {
      const parsed = parsePayload(
        z.object({ batchId: z.string(), expectedRevision: z.number() }),
        payload,
        envelope,
      );
      if (!parsed.ok) return parsed.result;
      try {
        const result = await inboxService.undoBatch(parsed.value.batchId);
        return ok(envelope.requestId, result);
      } catch (error) {
        if (error && typeof error === 'object' && 'code' in error) return fail(envelope.requestId, error as never);
        return fail(envelope.requestId, createError('INTERNAL', 'Undo failed', true));
      }
    },
  );

  // Signature helper is used server-side; expose nothing extra.
  void signatureFor;
}
