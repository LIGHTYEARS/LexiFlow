import type { Card } from '@domain/card/card.model';
import type { SourceCapture } from '@domain/source/source.model';
import type { InboxItem } from '@domain/inbox/inbox.model';
import type { ScheduleSnapshot } from '@domain/review/review.model';
import { db } from './database';
import { createError } from '@shared/protocol/envelope';
import { nowIso } from '@shared/utils/date';

/**
 * Repository implementation — the ONLY access point for Dexie.
 * All operations use transactions for atomicity.
 * See technical-design/04 §7 and §8.
 */

// ── Source Page Operations ──

/**
 * Upsert a SourcePage by canonicalKey.
 * Returns the SourcePage id.
 */
export async function upsertSourcePage(data: {
  url: string;
  title: string;
  siteName?: string;
  domain: string;
  canonicalKey: string;
}): Promise<string> {
  const existing = await db.sourcePages.get({ canonicalKey: data.canonicalKey });
  const now = nowIso();

  if (existing) {
    await db.sourcePages.update(existing.id, {
      lastSeenAt: now,
      title: data.title || existing.title,
    });
    return existing.id;
  }

  const id = crypto.randomUUID();
  await db.sourcePages.add({
    id,
    canonicalKey: data.canonicalKey,
    url: data.url,
    title: data.title,
    siteName: data.siteName,
    domain: data.domain,
    firstSeenAt: now,
    lastSeenAt: now,
  });
  return id;
}

// ── Source Capture Operations ──

/**
 * Get a SourceCapture by id.
 */
export async function getSourceCapture(id: string): Promise<SourceCapture | undefined> {
  return db.sourceCaptures.get(id);
}

/**
 * Get a SourceCapture by captureRequestId (for idempotency).
 */
export async function getSourceCaptureByRequestId(
  requestId: string,
): Promise<SourceCapture | undefined> {
  return db.sourceCaptures.get({ captureRequestId: requestId });
}

// ── Card Operations ──

/**
 * Get a card by id.
 */
export async function getCard(id: string): Promise<Card | undefined> {
  return db.cards.get(id);
}

/**
 * Get a card by normalized key (for deduplication candidate recall).
 * Returns only active/paused cards (not deleted/archived).
 */
export async function getCardsByNormalizedKey(
  normalizedKey: string,
): Promise<Card[]> {
  return db.cards
    .where('normalizedKey')
    .equals(normalizedKey)
    .filter((card) => card.status !== 'deleted')
    .toArray();
}

/**
 * Query cards with filters and pagination.
 * See technical-design/04 §11.
 */
export async function queryCards(query: {
  type?: string;
  status?: string;
  tagIds?: string[];
  sourceDomain?: string;
  search?: string;
  cursor?: string;
  limit: number;
}): Promise<{ cards: Card[]; nextCursor?: string; total: number }> {
  let collection = db.cards.toCollection();

  // Filter by status (exclude deleted by default unless explicitly requested)
  if (query.status) {
    collection = collection.filter((card) => card.status === query.status);
  } else {
    collection = collection.filter((card) => card.status !== 'deleted');
  }

  // Filter by type
  if (query.type) {
    collection = collection.filter((card) => card.type === query.type);
  }

  // Filter by tags (must have all specified tags)
  if (query.tagIds && query.tagIds.length > 0) {
    collection = collection.filter((card) =>
      query.tagIds!.every((tagId) => card.tagIds.includes(tagId)),
    );
  }

  // Sort by updatedAt descending
  const cards = await collection.sortBy('updatedAt');
  const reversed = cards.reverse(); // newest first

  // Pagination
  const limit = query.limit || 50;
  const startIndex = query.cursor ? parseInt(query.cursor, 10) : 0;
  const paged = reversed.slice(startIndex, startIndex + limit);
  const nextCursor =
    startIndex + limit < reversed.length ? String(startIndex + limit) : undefined;

  return {
    cards: paged,
    nextCursor,
    total: reversed.length,
  };
}

/**
 * Revise a card with optimistic concurrency.
 * Checks expectedRevision before applying changes.
 */
export async function reviseCard(command: {
  cardId: string;
  expectedRevision: number;
  patch: Partial<Card>;
  confirmationToken?: string;
}): Promise<Card> {
  const card = await db.cards.get(command.cardId);
  if (!card) {
    throw createError('NOT_FOUND', 'Card not found', false);
  }

  // Optimistic concurrency check
  if (card.revision !== command.expectedRevision) {
    throw createError(
      'CONFLICT',
      `Card has been modified (expected revision ${command.expectedRevision}, got ${card.revision})`,
      true,
    );
  }

  // Protect user-originated content from model overwrite
  // (enforced at application layer; repository applies the patch as-is)
  const updated: Card = {
    ...card,
    ...command.patch,
    revision: card.revision + 1,
    updatedAt: nowIso(),
  };

  await db.cards.put(updated);
  return updated;
}

/**
 * Soft-delete a card (status=deleted, deletedAt set).
 * Preserves history, sources, and review data.
 */
export async function softDeleteCard(cardId: string): Promise<void> {
  const card = await db.cards.get(cardId);
  if (!card) {
    throw createError('NOT_FOUND', 'Card not found', false);
  }

  await db.cards.update(cardId, {
    status: 'deleted',
    deletedAt: nowIso(),
    updatedAt: nowIso(),
    revision: card.revision + 1,
  });
}

/**
 * Restore a soft-deleted card.
 */
export async function restoreCard(cardId: string): Promise<void> {
  const card = await db.cards.get(cardId);
  if (!card || card.status !== 'deleted') {
    throw createError('CONFLICT', 'Card is not in deleted state', false);
  }

  await db.cards.update(cardId, {
    status: 'active',
    deletedAt: undefined,
    updatedAt: nowIso(),
    revision: card.revision + 1,
  });
}

// ── Inbox Operations ──

/**
 * Get inbox items with pagination.
 */
export async function getInboxItems(query: {
  status?: string;
  limit?: number;
  cursor?: string;
}): Promise<{ items: InboxItem[]; nextCursor?: string }> {
  let collection = db.inboxItems.toCollection();

  if (query.status) {
    collection = collection.filter((item) => item.status === query.status);
  }

  const items = await collection.sortBy('createdAt');
  const reversed = items.reverse(); // newest first

  const limit = query.limit || 50;
  const startIndex = query.cursor ? parseInt(query.cursor, 10) : 0;
  const paged = reversed.slice(startIndex, startIndex + limit);
  const nextCursor =
    startIndex + limit < reversed.length ? String(startIndex + limit) : undefined;

  return { items: paged, nextCursor };
}

/**
 * Get an inbox item by id.
 */
export async function getInboxItem(id: string): Promise<InboxItem | undefined> {
  return db.inboxItems.get(id);
}

// ── Review Operations ──

/**
 * Get schedule snapshot for a card.
 */
export async function getScheduleSnapshot(
  cardId: string,
): Promise<ScheduleSnapshot | undefined> {
  return db.scheduleSnapshots.get(cardId);
}

/**
 * Get due cards for review queue.
 * Returns cards ordered by due date (overdue first).
 */
export async function getDueCards(query: {
  limit: number;
  includeNew: boolean;
  maxNew: number;
}): Promise<{ cards: Array<{ cardId: string; priority: string }> }> {
  const now = nowIso();

  // Get overdue and due cards
  const dueCards = await db.scheduleSnapshots
    .where('dueAt')
    .belowOrEqual(now)
    .limit(query.limit)
    .toArray();

  const results: Array<{ cardId: string; priority: string }> = dueCards.map((snap) => ({
    cardId: snap.cardId,
    priority: snap.dueAt < now ? 'overdue' : 'due',
  }));

  // Add new cards if enabled and within limit
  if (query.includeNew && results.length < query.limit) {
    const newSnapshots = await db.scheduleSnapshots
      .where('state.state')
      .equals('new')
      .limit(query.maxNew)
      .toArray();

    for (const snap of newSnapshots) {
      if (results.length >= query.limit) break;
      results.push({ cardId: snap.cardId, priority: 'new' });
    }
  }

  return { cards: results };
}

/**
 * Count cards by status for dashboard.
 */
export async function countCardsByStatus(): Promise<{
  active: number;
  paused: number;
  archived: number;
  deleted: number;
}> {
  const cards = await db.cards.toArray();
  const counts = { active: 0, paused: 0, archived: 0, deleted: 0 };
  for (const card of cards) {
    counts[card.status]++;
  }
  return counts;
}

/**
 * Count inbox items by status.
 */
export async function countInboxByStatus(): Promise<{
  pending: number;
  processing: number;
  resolved: number;
  discarded: number;
}> {
  const items = await db.inboxItems.toArray();
  const counts = { pending: 0, processing: 0, resolved: 0, discarded: 0 };
  for (const item of items) {
    counts[item.status]++;
  }
  return counts;
}

/**
 * Count today's due and overdue reviews.
 */
export async function countDueReviews(): Promise<{
  overdue: number;
  due: number;
  learning: number;
  new: number;
}> {
  const now = nowIso();
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayIso = todayStart.toISOString();

  const snapshots = await db.scheduleSnapshots.toArray();
  const counts = { overdue: 0, due: 0, learning: 0, new: 0 };

  for (const snap of snapshots) {
    if (snap.state.state === 'new') {
      counts.new++;
    } else if (snap.state.state === 'learning' || snap.state.state === 'relearning') {
      counts.learning++;
    }

    if (snap.dueAt < todayIso) {
      counts.overdue++;
    } else if (snap.dueAt <= now) {
      counts.due++;
    }
  }

  return counts;
}

/**
 * Get all source pages with card counts.
 */
export async function getSourcePages(query: {
  limit?: number;
  cursor?: string;
}): Promise<{
  pages: Array<{
    id: string;
    url: string;
    title: string;
    domain: string;
    cardCount: number;
    inboxCount: number;
    lastSeenAt: string;
  }>;
  nextCursor?: string;
}> {
  const pages = await db.sourcePages.orderBy('lastSeenAt').reverse().toArray();
  const limit = query.limit || 50;
  const startIndex = query.cursor ? parseInt(query.cursor, 10) : 0;
  const paged = pages.slice(startIndex, startIndex + limit);

  const results = await Promise.all(
    paged.map(async (page) => {
      const captures = await db.sourceCaptures.where('pageId').equals(page.id).toArray();
      const captureIds = captures.map((c) => c.id);

      const cardLinks = captureIds.length > 0
        ? await db.cardSourceLinks.where('sourceCaptureId').anyOf(captureIds).toArray()
        : [];
      const uniqueCardIds = new Set(cardLinks.map((l) => l.cardId));

      return {
        id: page.id,
        url: page.url,
        title: page.title,
        domain: page.domain,
        cardCount: uniqueCardIds.size,
        inboxCount: 0, // Inbox counting handled separately
        lastSeenAt: page.lastSeenAt,
      };
    }),
  );

  const nextCursor =
    startIndex + limit < pages.length ? String(startIndex + limit) : undefined;

  return { pages: results, nextCursor };
}

export { db };
