import { db } from '@infra/db/database';
import { createCardTransaction } from '@infra/db/transactions';
import { enqueueSearchUpsert, enqueueSearchDelete } from '@app/search/search-index';
import { nowIso } from '@shared/utils/date';
import { createError } from '@shared/protocol/envelope';
import type { InboxItem } from '@domain/inbox/inbox.model';
import type {
  InboxBatchPreview,
  InboxBatchResult,
} from '@shared/protocol/protocol-map';

/**
 * InboxService — triage operations and safe batch apply/undo (PRD §9.4-9.5,
 * §15.4). Each batch records an operation log entry with an inverse payload so
 * the most recent batch can be undone (§15.4). Low-risk same-kind actions may
 * be batch-confirmed; higher-risk actions are gated by RiskPolicy at the
 * handler layer.
 */

export type InboxAction = 'save' | 'save-to-inbox' | 'skip' | 'merge';

interface PreviewEntry {
  previewId: string;
  itemIds: string[];
  action: InboxAction;
  createdAt: number;
}

const previews = new Map<string, PreviewEntry>();

export async function previewBatch(itemIds: string[], action: InboxAction): Promise<InboxBatchPreview> {
  const previewId = crypto.randomUUID();
  previews.set(previewId, { previewId, itemIds, action, createdAt: Date.now() });
  const items = await db.inboxItems.where('id').anyOf(itemIds).toArray();
  const riskSummary =
    action === 'skip'
      ? 'Low risk: discards selected items (undoable).'
      : action === 'save'
        ? `Creates ${items.length} new card(s) from these items (undoable).`
        : 'Keeps items in Inbox.';
  return {
    previewId,
    items: items.map((i) => ({ itemId: i.id, action, summary: summarize(i) })),
    riskSummary,
  };
}

function summarize(item: InboxItem): string {
  return item.draft?.headword ?? `capture ${item.sourceCaptureId.slice(0, 8)}`;
}

/**
 * Apply a previewed batch. Returns per-item results and records an undo entry.
 */
export async function applyBatch(previewId: string): Promise<InboxBatchResult> {
  const preview = previews.get(previewId);
  if (!preview) throw createError('NOT_FOUND', 'Preview expired or not found', false);
  previews.delete(previewId);

  const batchId = crypto.randomUUID();
  const results: InboxBatchResult['results'] = [];
  const inverse: Array<{ kind: 'delete-card' | 'restore-inbox'; cardId?: string; itemId: string; prevStatus: InboxItem['status'] }> = [];

  for (const itemId of preview.itemIds) {
    const item = await db.inboxItems.get(itemId);
    if (!item) {
      results.push({ itemId, success: false, error: 'Item not found' });
      continue;
    }
    try {
      if (preview.action === 'skip') {
        await db.inboxItems.update(itemId, { status: 'discarded', updatedAt: nowIso() });
        inverse.push({ kind: 'restore-inbox', itemId, prevStatus: item.status });
        results.push({ itemId, success: true });
      } else if (preview.action === 'save') {
        const capture = await db.sourceCaptures.get(item.sourceCaptureId);
        if (!capture) {
          results.push({ itemId, success: false, error: 'Source capture missing' });
          continue;
        }
        const card = await createCardTransaction({
          requestId: `${batchId}:${itemId}`,
          type: item.draft?.type ?? 'word',
          headword: item.draft?.headword ?? capture.selectedText,
          explanations: (item.draft?.explanations ?? []).map((v) => ({ value: v, origin: 'model' as const })),
          examples: (item.draft?.examples ?? []).map((v) => ({ value: v, origin: 'model' as const })),
          sourceCaptureId: item.sourceCaptureId,
        });
        await db.inboxItems.update(itemId, { status: 'resolved', resolvedByOperationId: batchId, updatedAt: nowIso() });
        await enqueueSearchUpsert(card.id);
        inverse.push({ kind: 'delete-card', cardId: card.id, itemId, prevStatus: item.status });
        results.push({ itemId, success: true, cardId: card.id });
      } else {
        results.push({ itemId, success: true });
      }
    } catch (error) {
      results.push({ itemId, success: false, error: error instanceof Error ? error.message : 'Failed' });
    }
  }

  await db.operationLogs.add({
    id: batchId,
    requestId: batchId,
    type: `inbox.batch.${preview.action}`,
    status: 'completed',
    executedAt: nowIso(),
    entityIds: preview.itemIds,
    details: { inverse },
  });

  return { batchId, results };
}

/**
 * Undo the most recent (or a specific) batch operation (§15.4).
 */
export async function undoBatch(batchId: string): Promise<{ reverted: boolean }> {
  const log = await db.operationLogs.get(batchId);
  if (!log || !log.details || typeof log.details !== 'object') {
    throw createError('NOT_FOUND', 'Batch not found or not undoable', false);
  }
  const inverse = (log.details as { inverse?: Array<{ kind: string; cardId?: string; itemId: string; prevStatus: InboxItem['status'] }> }).inverse ?? [];
  for (const op of inverse) {
    if (op.kind === 'delete-card' && op.cardId) {
      await db.cards.delete(op.cardId);
      await db.cardSourceLinks.where('cardId').equals(op.cardId).delete();
      await enqueueSearchDelete(op.cardId);
    }
    await db.inboxItems.update(op.itemId, { status: op.prevStatus, resolvedByOperationId: undefined, updatedAt: nowIso() });
  }
  await db.operationLogs.update(batchId, { status: 'failed', errorCode: 'REVERTED' });
  return { reverted: true };
}
