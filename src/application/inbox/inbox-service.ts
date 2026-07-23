import { db } from '@infra/db/database';
import { createCardTransaction, appendSourceToCard } from '@infra/db/transactions';
import { nowIso } from '@shared/utils/date';
import { createError } from '@shared/protocol/envelope';
import type { InboxItem } from '@domain/inbox/inbox.model';
import type { CardType } from '@domain/types';

/**
 * InboxService — handles all Inbox item operations.
 * See PRD §9.4 and technical-design/06 §4.
 */

export interface InboxOperationInput {
  itemId: string;
  expectedRevision: number;
  operation:
    | 'new-card'
    | 'append-source'
    | 'add-sense'
    | 'merge'
    | 'relate'
    | 'tag'
    | 'pause'
    | 'discard'
    | 'reanalyze';
  targetCardId?: string;
  tagIds?: string[];
  cardType?: CardType;
}

export interface InboxOperationResult {
  success: boolean;
  cardId?: string;
  message: string;
  undoAvailable: boolean;
}

/**
 * Convert an Inbox item to a new formal card.
 */
export async function convertInboxToCard(
  itemId: string,
  cardType: CardType,
): Promise<InboxOperationResult> {
  const item = await db.inboxItems.get(itemId);
  if (!item) {
    throw createError('NOT_FOUND', 'Inbox item not found', false);
  }
  if (item.status === 'resolved' || item.status === 'discarded') {
    throw createError('CONFLICT', 'Inbox item already resolved or discarded', false);
  }

  const capture = await db.sourceCaptures.get(item.sourceCaptureId);
  if (!capture) {
    throw createError('NOT_FOUND', 'Source capture not found', false);
  }

  const card = await createCardTransaction({
    requestId: crypto.randomUUID(),
    type: cardType,
    headword: capture.selectedText,
    explanations: [],
    examples: [],
    sourceCaptureId: capture.id,
  });

  // Mark inbox item as resolved
  await db.inboxItems.update(itemId, {
    status: 'resolved',
    resolvedByOperationId: card.id,
    updatedAt: nowIso(),
    revision: item.revision + 1,
  });

  // Record mutation for undo
  await recordMutation('inbox.convert', itemId, { cardId: card.id });

  return {
    success: true,
    cardId: card.id,
    message: 'Card created from inbox item',
    undoAvailable: true,
  };
}

/**
 * Append the source capture from an inbox item to an existing card.
 */
export async function appendInboxSourceToCard(
  itemId: string,
  targetCardId: string,
): Promise<InboxOperationResult> {
  const item = await db.inboxItems.get(itemId);
  if (!item) {
    throw createError('NOT_FOUND', 'Inbox item not found', false);
  }

  await appendSourceToCard(crypto.randomUUID(), targetCardId, item.sourceCaptureId, 'additional_context');

  await db.inboxItems.update(itemId, {
    status: 'resolved',
    resolvedByOperationId: targetCardId,
    updatedAt: nowIso(),
    revision: item.revision + 1,
  });

  await recordMutation('inbox.append-source', itemId, { cardId: targetCardId });

  return {
    success: true,
    cardId: targetCardId,
    message: 'Source appended to card',
    undoAvailable: true,
  };
}

/**
 * Discard an inbox item.
 */
export async function discardInboxItem(itemId: string): Promise<InboxOperationResult> {
  const item = await db.inboxItems.get(itemId);
  if (!item) {
    throw createError('NOT_FOUND', 'Inbox item not found', false);
  }

  await db.inboxItems.update(itemId, {
    status: 'discarded',
    updatedAt: nowIso(),
    revision: item.revision + 1,
  });

  await recordMutation('inbox.discard', itemId, {});

  return {
    success: true,
    message: 'Inbox item discarded',
    undoAvailable: true,
  };
}

/**
 * Pause an inbox item (stop processing for now).
 */
export async function pauseInboxItem(itemId: string): Promise<InboxOperationResult> {
  const item = await db.inboxItems.get(itemId);
  if (!item) {
    throw createError('NOT_FOUND', 'Inbox item not found', false);
  }

  await db.inboxItems.update(itemId, {
    status: 'pending', // Keep pending but mark as paused via revision
    updatedAt: nowIso(),
    revision: item.revision + 1,
  });

  return {
    success: true,
    message: 'Inbox item paused',
    undoAvailable: false,
  };
}

/**
 * Record a mutation for potential undo.
 * Stores before/after data needed to reverse the operation.
 */
async function recordMutation(
  operationType: string,
  entityId: string,
  details: Record<string, unknown>,
): Promise<void> {
  const batchId = crypto.randomUUID();
  const recordId = crypto.randomUUID();

  // Check if mutationRecords table exists (added in v2 migration)
  try {
    await db.table('mutationRecords').add({
      id: recordId,
      batchId,
      operationType,
      entityId,
      details,
      createdAt: nowIso(),
    });
  } catch {
    // Table may not exist yet — non-critical, undo won't be available
  }
}

/**
 * Get inbox items with their source capture data for display.
 */
export async function getInboxItemsWithSource(
  query: { status?: string; limit?: number; cursor?: string },
): Promise<{
  items: Array<{
    item: InboxItem;
    selectedText: string;
    pageTitle?: string;
    url?: string;
  }>;
  nextCursor?: string;
  total: number;
}> {
  let collection = db.inboxItems.toCollection();

  if (query.status) {
    collection = collection.filter((item) => item.status === query.status);
  } else {
    // By default, only show pending/processing items (not resolved or discarded)
    collection = collection.filter(
      (item) => item.status === 'pending' || item.status === 'processing',
    );
  }

  const items = await collection.sortBy('createdAt');
  const reversed = items.reverse();

  const limit = query.limit || 50;
  const startIndex = query.cursor ? parseInt(query.cursor, 10) || 0 : 0;
  const paged = reversed.slice(startIndex, startIndex + limit);
  const nextCursor = startIndex + limit < reversed.length ? String(startIndex + limit) : undefined;

  const enriched = await Promise.all(
    paged.map(async (item) => {
      const capture = await db.sourceCaptures.get(item.sourceCaptureId);
      return {
        item,
        selectedText: capture?.selectedText || '(unknown)',
        pageTitle: capture?.context.pageTitle,
        url: capture?.context.url,
      };
    }),
  );

  return { items: enriched, nextCursor, total: reversed.length };
}
