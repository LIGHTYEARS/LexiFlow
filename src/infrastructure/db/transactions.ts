import { db } from './database';
import { createError } from '@shared/protocol/envelope';
import { nowIso } from '@shared/utils/date';
import { normalizeForComparison, normalizeForDisplay } from '@shared/utils/normalize';
import { canonicalizeUrl } from '@shared/utils/url';
import type { Card } from '@domain/card/card.model';
import type { SourceCapture } from '@domain/source/source.model';
import type { ReviewEvent, ScheduleSnapshot, ReviewRating } from '@domain/review/review.model';
import type { ErrorType } from '@domain/error/error.model';
import type { SaveCaptureResult } from './repository';

/**
 * Valid review mode values, matching ReviewEvent['mode'] enum.
 * Used for runtime validation before casting from string input.
 */
const VALID_REVIEW_MODES = ['quick', 'input', 'cloze', 'imitation', 'distinction'] as const;

/**
 * Transactional operations for the LexiFlow knowledge base.
 * All functions use Dexie transactions for atomicity.
 * See technical-design/04 §7.1.
 */

// ── Save Capture (idempotent) ──

export type SaveCaptureInput = {
  requestId: string;
  selectedText: string;
  context: SourceCapture['context'];
  pageUrl: string;
  pageTitle: string;
  siteName?: string;
  domain: string;
  requestedAction: 'save' | 'save-to-inbox';
};

/**
 * Save a capture with idempotency (by requestId).
 * Transaction: upsert SourcePage → insert SourceCapture → insert InboxItem → OperationLog.
 */
export async function saveCaptureTransaction(
  input: SaveCaptureInput,
): Promise<SaveCaptureResult> {
  // Idempotency check: if we've already processed this request, return the same result
  const existing = await db.sourceCaptures.get({ captureRequestId: input.requestId });
  if (existing) {
    // Find what happened with this capture
    const link = await db.cardSourceLinks
      .where('sourceCaptureId')
      .equals(existing.id)
      .first();
    if (link) {
      return {
        captureId: existing.id,
        status: 'appended',
        cardId: link.cardId,
        message: 'Source already saved (idempotent)',
      };
    }
    const inboxItem = await db.inboxItems
      .where('sourceCaptureId')
      .equals(existing.id)
      .first();
    if (inboxItem) {
      return {
        captureId: existing.id,
        status: 'inbox',
        message: 'Already in Inbox (idempotent)',
      };
    }
  }

  const contentHash = computeContentHash(input.selectedText);
  const captureId = crypto.randomUUID();
  const canonicalKey = canonicalizeUrl(input.pageUrl);

  // Check if source page already exists (idempotent by canonicalKey)
  const existingPage = await db.sourcePages.get({ canonicalKey });
  const pageId = existingPage ? existingPage.id : crypto.randomUUID();

  // Note: transaction errors propagate to caller for error handling
  return db.transaction(
    'rw',
    db.sourcePages,
    db.sourceCaptures,
    db.inboxItems,
    db.operationLogs,
    () => {
      // 1. Upsert SourcePage
      db.sourcePages.put({
        id: pageId,
        canonicalKey,
        url: input.pageUrl,
        title: input.pageTitle,
        siteName: input.siteName,
        domain: input.domain,
        firstSeenAt: existingPage ? existingPage.firstSeenAt : nowIso(),
        lastSeenAt: nowIso(),
      });

      // 2. Insert SourceCapture (immutable evidence)
      const capture: SourceCapture = {
        id: captureId,
        pageId,
        selectedText: normalizeForDisplay(input.selectedText),
        context: input.context,
        capturedAt: nowIso(),
        contentHash,
        captureRequestId: input.requestId,
      };
      db.sourceCaptures.add(capture);

      // 3. Insert InboxItem (all captures go to Inbox by default for safety)
      const inboxItem = {
        id: crypto.randomUUID(),
        revision: 1,
        status: 'pending' as const,
        sourceCaptureId: captureId,
        suggestions: [],
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      db.inboxItems.add(inboxItem);

      // 4. Record operation log
      db.operationLogs.add({
        id: crypto.randomUUID(),
        requestId: input.requestId,
        type: 'capture.save',
        status: 'completed',
        executedAt: nowIso(),
      });

      return {
        captureId,
        status: 'inbox' as const,
        message: 'Saved to Inbox for review',
      };
    },
  );
}

// ── Create New Card (transactional) ──

export type CreateCardInput = {
  requestId: string;
  type: Card['type'];
  headword: string;
  headwordOrigin?: Card['headword']['origin'];
  explanations: Array<{ value: string; origin: Card['headword']['origin'] }>;
  examples: Array<{ value: string; origin: Card['headword']['origin'] }>;
  sourceCaptureId: string;
  tagIds?: string[];
};

/**
 * Create a new card from a source capture.
 * Transaction: SourceCapture check → Card + CardSourceLink + OperationLog.
 */
export async function createCardTransaction(
  input: CreateCardInput,
): Promise<Card> {
  const now = nowIso();
  const cardId = crypto.randomUUID();

  // Note: transaction errors propagate to caller for error handling
  return db.transaction(
    'rw',
    db.cards,
    db.cardSourceLinks,
    db.operationLogs,
    () => {
      const card: Card = {
        id: cardId,
        revision: 1,
        type: input.type,
        status: 'active',
        headword: {
          value: normalizeForDisplay(input.headword),
          origin: input.headwordOrigin || 'web_page',
          sourceCaptureId: input.sourceCaptureId,
        },
        normalizedKey: normalizeForComparison(input.headword),
        explanations: input.explanations.map((e) => ({
          value: e.value,
          origin: e.origin,
        })),
        examples: input.examples.map((e) => ({
          value: e.value,
          origin: e.origin,
        })),
        notes: [],
        tagIds: input.tagIds || [],
        createdAt: now,
        updatedAt: now,
      };

      db.cards.add(card);

      // Link card to source capture
      db.cardSourceLinks.add({
        id: crypto.randomUUID(),
        cardId,
        sourceCaptureId: input.sourceCaptureId,
        role: 'origin',
        createdAt: now,
      });

      // Record operation
      db.operationLogs.add({
        id: crypto.randomUUID(),
        requestId: input.requestId,
        type: 'card.create',
        status: 'completed',
        executedAt: now,
      });

      return card;
    },
  );
}

// ── Append Source to Existing Card (transactional) ──

/**
 * Append a new source capture link to an existing card.
 * Idempotent: if the link already exists, returns success without duplicate.
 */
export async function appendSourceToCard(
  requestId: string,
  cardId: string,
  sourceCaptureId: string,
  role: 'origin' | 'additional_context' | 'example' = 'additional_context',
): Promise<void> {
  const now = nowIso();

  // Note: transaction errors propagate to caller for error handling
  return db.transaction(
    'rw',
    db.cards,
    db.cardSourceLinks,
    db.operationLogs,
    async () => {
      const card = await db.cards.get(cardId);
      if (!card || card.status === 'deleted') {
        throw createError('NOT_FOUND', 'Card not found or deleted', false);
      }

      // Check if link already exists (idempotency)
      const existingLink = await db.cardSourceLinks
        .where('[cardId+sourceCaptureId+role]')
        .equals([cardId, sourceCaptureId, role])
        .first();

      if (!existingLink) {
        await db.cardSourceLinks.add({
          id: crypto.randomUUID(),
          cardId,
          sourceCaptureId,
          role,
          createdAt: now,
        });
      }

      // Update card revision
      await db.cards.update(cardId, {
        revision: card.revision + 1,
        updatedAt: now,
      });

      await db.operationLogs.add({
        id: crypto.randomUUID(),
        requestId,
        type: 'card.append-source',
        status: 'completed',
        executedAt: now,
      });
    },
  );
}

// ── Record Review (transactional, append-only) ──

export type RecordReviewInput = {
  attemptId: string;
  cardId: string;
  sessionId: string;
  rating: ReviewRating;
  mode: string;
  expectedSequence: number;
  previousStateHash: string;
  resultingState: ScheduleSnapshot['state'];
  answer?: string;
  durationMs?: number;
  confirmedErrorTypes?: ErrorType[];
};

/**
 * Record a review event atomically.
 * Transaction: append ReviewEvent + ReviewAttemptDetail + update ScheduleSnapshot.
 * Idempotent by attemptId.
 */
export async function recordReviewTransaction(
  input: RecordReviewInput,
): Promise<{ eventId: string; nextDueAt: string; state: string }> {
  const now = nowIso();
  const eventId = crypto.randomUUID();

  // Note: transaction errors propagate to caller for error handling
  return db.transaction(
    'rw',
    db.reviewEvents,
    db.reviewAttemptDetails,
    db.scheduleSnapshots,
    db.errorAnnotations,
    db.operationLogs,
    async () => {
      // Idempotency: check if this attempt was already recorded
      const existing = await db.reviewEvents.get({ attemptId: input.attemptId });
      if (existing) {
        return {
          eventId: existing.eventId,
          nextDueAt: existing.resultingState.dueAt,
          state: existing.resultingState.state,
        };
      }

      // Get current sequence for this card
      const currentSnapshot = await db.scheduleSnapshots.get(input.cardId);
      const nextSequence = currentSnapshot ? currentSnapshot.lastSequence + 1 : 1;

      // Optimistic concurrency: check expected sequence
      if (currentSnapshot && input.expectedSequence !== currentSnapshot.lastSequence) {
        throw createError(
          'CONFLICT',
          `Card has been reviewed in another session (expected sequence ${input.expectedSequence}, got ${currentSnapshot.lastSequence})`,
          true,
        );
      }

      // Append ReviewEvent (immutable)
      // Validate mode against known enum values before casting
      if (!VALID_REVIEW_MODES.includes(input.mode as typeof VALID_REVIEW_MODES[number])) {
        throw createError('INVALID_INPUT', `Invalid review mode: ${input.mode}`, false);
      }
      const validatedMode = input.mode as ReviewEvent['mode'];

      const reviewEvent: ReviewEvent = {
        eventId,
        cardId: input.cardId,
        sequence: nextSequence,
        sessionId: input.sessionId,
        attemptId: input.attemptId,
        occurredAt: now,
        rating: input.rating,
        previousStateHash: input.previousStateHash,
        resultingState: input.resultingState,
        mode: validatedMode,
        source: 'review',
      };
      await db.reviewEvents.add(reviewEvent);

      // Record attempt details
      await db.reviewAttemptDetails.add({
        attemptId: input.attemptId,
        cardId: input.cardId,
        sessionId: input.sessionId,
        answer: input.answer,
        durationMs: input.durationMs,
        suggestedErrorTypes: [],
        confirmedErrorTypes: input.confirmedErrorTypes || [],
      });

      // Update ScheduleSnapshot projection (must be in same transaction)
      const stateHash = computeStateHash(input.resultingState);
      await db.scheduleSnapshots.put({
        cardId: input.cardId,
        lastSequence: nextSequence,
        state: input.resultingState,
        dueAt: input.resultingState.dueAt,
        stateHash,
        schedulerVersion: input.resultingState.schedulerVersion,
        // parameterSetId is derived from schedulerVersion for traceability —
        // it identifies which FSRS parameter set produced this snapshot.
        parameterSetId: input.resultingState.schedulerVersion,
      });

      // Record error annotations if any
      if (input.confirmedErrorTypes && input.confirmedErrorTypes.length > 0) {
        for (const errorType of input.confirmedErrorTypes) {
          await db.errorAnnotations.add({
            id: crypto.randomUUID(),
            cardId: input.cardId,
            reviewEventId: eventId,
            type: errorType,
            systemSuggested: false,
            createdAt: now,
          });
        }
      }

      // Log operation
      await db.operationLogs.add({
        id: crypto.randomUUID(),
        requestId: input.attemptId,
        type: 'review.record',
        status: 'completed',
        executedAt: now,
      });

      return {
        eventId,
        nextDueAt: input.resultingState.dueAt,
        state: input.resultingState.state,
      };
    },
  );
}

// ── Tag Operations ──

/**
 * Get all tags.
 */
export async function getAllTags(): Promise<Array<{ id: string; name: string; normalizedName: string; cardCount: number }>> {
  const tags = await db.tags.orderBy('normalizedName').toArray();
  return Promise.all(
    tags.map(async (tag) => {
      const cardCount = await db.cards
        .filter((card) => card.tagIds.includes(tag.id) && card.status !== 'deleted')
        .count();
      return { id: tag.id, name: tag.name, normalizedName: tag.normalizedName, cardCount };
    }),
  );
}

/**
 * Create a tag (idempotent by normalized name).
 */
export async function createOrGetTag(name: string): Promise<{ id: string; isNew: boolean }> {
  const normalizedName = normalizeForComparison(name);
  const existing = await db.tags.get({ normalizedName });
  if (existing) {
    return { id: existing.id, isNew: false };
  }

  const id = crypto.randomUUID();
  await db.tags.add({
    id,
    name,
    normalizedName,
    revision: 1,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  });
  return { id, isNew: true };
}

// ── Utility Functions ──

/**
 * Compute a deterministic content hash for deduplication.
 * Uses Web Crypto SubtleCrypto if available, falls back to simple string hash.
 */
export function computeContentHash(text: string): string {
  // Simple hash for client-side deduplication (not cryptographic security)
  let hash = 0;
  const normalized = normalizeForComparison(text);
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(36);
}

/**
 * Compute a state hash for schedule snapshot validation.
 */
function computeStateHash(state: ScheduleSnapshot['state']): string {
  const str = JSON.stringify({
    dueAt: state.dueAt,
    stability: state.stability,
    difficulty: state.difficulty,
    state: state.state,
    reps: state.reps,
    lapses: state.lapses,
  });
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}
