import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '@infra/db/database';
import {
  saveCaptureTransaction,
  createCardTransaction,
  appendSourceToCard,
  recordReviewTransaction,
  computeContentHash,
  getAllTags,
  createOrGetTag,
} from '@infra/db/transactions';
import type { SaveCaptureInput } from '@infra/db/transactions';
import type { Card } from '@domain/card/card.model';
import {
  queryCards,
  getCard,
  softDeleteCard,
  restoreCard,
} from '@infra/db/repository-impl';
import { runMigrations, verifyInvariants } from '@infra/db/migrations';

describe('Database Repository', () => {
  beforeEach(async () => {
    // Clear all tables between tests
    await db.cards.clear();
    await db.sourcePages.clear();
    await db.sourceCaptures.clear();
    await db.cardSourceLinks.clear();
    await db.inboxItems.clear();
    await db.tags.clear();
    await db.cardRelations.clear();
    await db.reviewEvents.clear();
    await db.scheduleSnapshots.clear();
    await db.reviewAttemptDetails.clear();
    await db.errorAnnotations.clear();
    await db.operationLogs.clear();

    // Mock chrome.storage for schema version
    (chrome.storage.local.get as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({});
    (chrome.storage.local.set as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue(undefined);
  });

  describe('saveCaptureTransaction', () => {
    const captureInput: SaveCaptureInput = {
      requestId: 'req-001',
      selectedText: 'graceful degradation',
      context: {
        pageTitle: 'Test Page',
        url: 'https://example.com/article',
        extractedAt: new Date().toISOString(),
        quality: 'full' as const,
        sentenceContaining: 'This is about graceful degradation.',
      },
      pageUrl: 'https://example.com/article',
      pageTitle: 'Test Page',
      domain: 'example.com',
      requestedAction: 'save' as const,
    };

    it('saves capture to inbox', async () => {
      const result = await saveCaptureTransaction(captureInput);
      expect(result.status).toBe('inbox');
      expect(result.captureId).toBeDefined();

      // Verify source page created
      const pages = await db.sourcePages.toArray();
      expect(pages.length).toBe(1);
      expect(pages[0].url).toBe('https://example.com/article');

      // Verify capture created
      const captures = await db.sourceCaptures.toArray();
      expect(captures.length).toBe(1);
      expect(captures[0].selectedText).toBe('graceful degradation');

      // Verify inbox item created
      const inboxItems = await db.inboxItems.toArray();
      expect(inboxItems.length).toBe(1);
      expect(inboxItems[0].status).toBe('pending');
    });

    it('is idempotent by requestId', async () => {
      await saveCaptureTransaction(captureInput); // First call
      const result2 = await saveCaptureTransaction(captureInput);

      // Should return same result, not create duplicates
      expect(result2.status).toBe('inbox');

      const captures = await db.sourceCaptures.toArray();
      expect(captures.length).toBe(1);

      const inboxItems = await db.inboxItems.toArray();
      expect(inboxItems.length).toBe(1);
    });

    it('creates unique content hash', async () => {
      const hash1 = computeContentHash('hello world');
      const hash2 = computeContentHash('hello world');
      const hash3 = computeContentHash('different text');

      expect(hash1).toBe(hash2); // Same text → same hash
      expect(hash1).not.toBe(hash3); // Different text → different hash
    });
  });

  describe('createCardTransaction', () => {
    it('creates a card with source link', async () => {
      // First save a capture
      await saveCaptureTransaction({
        requestId: 'req-card-1',
        selectedText: 'test word',
        context: {
          pageTitle: 'Test',
          url: 'https://example.com',
          extractedAt: new Date().toISOString(),
          quality: 'selection_only' as const,
        },
        pageUrl: 'https://example.com',
        pageTitle: 'Test',
        domain: 'example.com',
        requestedAction: 'save' as const,
      });

      const captureRecord = await db.sourceCaptures.toArray();

      // Create card from that capture
      const explanations: Array<{ value: string; origin: Card['headword']['origin'] }> = [
        { value: 'a test word', origin: 'model' },
      ];
      const examples: Array<{ value: string; origin: Card['headword']['origin'] }> = [
        { value: 'This is a test word.', origin: 'web_page' },
      ];
      const card = await createCardTransaction({
        requestId: 'req-create-1',
        type: 'word',
        headword: 'test word',
        explanations,
        examples,
        sourceCaptureId: captureRecord[0].id,
      });

      expect(card.id).toBeDefined();
      expect(card.type).toBe('word');
      expect(card.headword.value).toBe('test word');
      expect(card.normalizedKey).toBe('test word');

      // Verify source link
      const links = await db.cardSourceLinks.toArray();
      expect(links.length).toBe(1);
      expect(links[0].cardId).toBe(card.id);
      expect(links[0].role).toBe('origin');
    });
  });

  describe('appendSourceToCard', () => {
    it('appends a source link without duplication', async () => {
      // Save two captures from same page
      await saveCaptureTransaction({
        requestId: 'req-append-1',
        selectedText: 'word',
        context: {
          pageTitle: 'Test',
          url: 'https://example.com',
          extractedAt: new Date().toISOString(),
          quality: 'selection_only' as const,
        },
        pageUrl: 'https://example.com',
        pageTitle: 'Test',
        domain: 'example.com',
        requestedAction: 'save' as const,
      });

      await saveCaptureTransaction({
        requestId: 'req-append-2',
        selectedText: 'word again',
        context: {
          pageTitle: 'Test',
          url: 'https://example.com',
          extractedAt: new Date().toISOString(),
          quality: 'selection_only' as const,
        },
        pageUrl: 'https://example.com',
        pageTitle: 'Test',
        domain: 'example.com',
        requestedAction: 'save' as const,
      });

      const captures = await db.sourceCaptures.toArray();

      // Create card from first capture
      const card = await createCardTransaction({
        requestId: 'req-card-append',
        type: 'word',
        headword: 'word',
        explanations: [],
        examples: [],
        sourceCaptureId: captures[0].id,
      });

      // Append second capture
      await appendSourceToCard('req-append-op', card.id, captures[1].id, 'additional_context');

      // Verify two links exist
      const links = await db.cardSourceLinks.toArray();
      expect(links.length).toBe(2);

      // Appending again should be idempotent
      await appendSourceToCard('req-append-op-2', card.id, captures[1].id, 'additional_context');
      const linksAfter = await db.cardSourceLinks.toArray();
      expect(linksAfter.length).toBe(2); // Still 2, not 3
    });
  });

  describe('queryCards', () => {
    it('returns cards with pagination', async () => {
      // Create test cards
      for (let i = 0; i < 5; i++) {
        await db.cards.add({
          id: `card-${i}`,
          revision: 1,
          type: i % 2 === 0 ? 'word' : 'phrase',
          status: 'active',
          headword: { value: `word ${i}`, origin: 'web_page' },
          normalizedKey: `word ${i}`,
          explanations: [],
          examples: [],
          notes: [],
          tagIds: [],
          createdAt: new Date(Date.now() + i * 1000).toISOString(),
          updatedAt: new Date(Date.now() + i * 1000).toISOString(),
        });
      }

      const result = await queryCards({ limit: 3 });
      expect(result.cards.length).toBe(3);
      expect(result.total).toBe(5);
      expect(result.nextCursor).toBeDefined();

      // Get next page
      const page2 = await queryCards({ limit: 3, cursor: result.nextCursor || undefined });
      expect(page2.cards.length).toBe(2);
    });

    it('filters by type', async () => {
      await db.cards.add({
        id: 'card-word',
        revision: 1,
        type: 'word',
        status: 'active',
        headword: { value: 'test', origin: 'web_page' },
        normalizedKey: 'test',
        explanations: [],
        examples: [],
        notes: [],
        tagIds: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const result = await queryCards({ type: 'word', limit: 10 });
      expect(result.cards.length).toBe(1);
      expect(result.cards[0].type).toBe('word');

      const noResult = await queryCards({ type: 'phrase', limit: 10 });
      expect(noResult.cards.length).toBe(0);
    });

    it('excludes deleted cards by default', async () => {
      await db.cards.add({
        id: 'card-deleted',
        revision: 1,
        type: 'word',
        status: 'deleted',
        headword: { value: 'deleted', origin: 'web_page' },
        normalizedKey: 'deleted',
        explanations: [],
        examples: [],
        notes: [],
        tagIds: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        deletedAt: new Date().toISOString(),
      });

      const result = await queryCards({ limit: 10 });
      expect(result.cards.length).toBe(0);
    });
  });

  describe('softDeleteCard and restoreCard', () => {
    it('soft deletes and restores a card', async () => {
      await db.cards.add({
        id: 'card-soft',
        revision: 1,
        type: 'word',
        status: 'active',
        headword: { value: 'soft', origin: 'web_page' },
        normalizedKey: 'soft',
        explanations: [],
        examples: [],
        notes: [],
        tagIds: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      // Soft delete
      await softDeleteCard('card-soft');
      const deleted = await getCard('card-soft');
      expect(deleted?.status).toBe('deleted');
      expect(deleted?.deletedAt).toBeDefined();

      // Should not appear in normal queries
      const queryResult = await queryCards({ limit: 10 });
      expect(queryResult.cards.length).toBe(0);

      // Restore
      await restoreCard('card-soft');
      const restored = await getCard('card-soft');
      expect(restored?.status).toBe('active');
      expect(restored?.deletedAt).toBeUndefined();
    });

    it('throws when card not found', async () => {
      await expect(softDeleteCard('nonexistent')).rejects.toThrow();
    });
  });

  describe('recordReviewTransaction', () => {
    it('records a review and updates schedule snapshot', async () => {
      // Add a card and initial snapshot
      await db.cards.add({
        id: 'card-review',
        revision: 1,
        type: 'word',
        status: 'active',
        headword: { value: 'review', origin: 'web_page' },
        normalizedKey: 'review',
        explanations: [],
        examples: [],
        notes: [],
        tagIds: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const futureDate = new Date(Date.now() + 86400000).toISOString();
      const result = await recordReviewTransaction({
        attemptId: 'attempt-001',
        cardId: 'card-review',
        sessionId: 'session-001',
        rating: 'good',
        mode: 'quick',
        expectedSequence: 0,
        previousStateHash: 'initial',
        resultingState: {
          schedulerVersion: 'fsrs-6',
          state: 'review',
          dueAt: futureDate,
          stability: 2.5,
          difficulty: 5.0,
          elapsedDays: 1,
          scheduledDays: 3,
          reps: 1,
          lapses: 0,
        },
      });

      expect(result.eventId).toBeDefined();
      expect(result.nextDueAt).toBe(futureDate);

      // Verify event was recorded
      const events = await db.reviewEvents.toArray();
      expect(events.length).toBe(1);
      expect(events[0].rating).toBe('good');
      expect(events[0].sequence).toBe(1);

      // Verify snapshot was updated
      const snapshot = await db.scheduleSnapshots.get('card-review');
      expect(snapshot).toBeDefined();
      expect(snapshot!.lastSequence).toBe(1);
      expect(snapshot!.dueAt).toBe(futureDate);
    });

    it('is idempotent by attemptId', async () => {
      await db.cards.add({
        id: 'card-idem',
        revision: 1,
        type: 'word',
        status: 'active',
        headword: { value: 'idem', origin: 'web_page' },
        normalizedKey: 'idem',
        explanations: [],
        examples: [],
        notes: [],
        tagIds: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const futureDate = new Date(Date.now() + 86400000).toISOString();
      const input = {
        attemptId: 'attempt-idem',
        cardId: 'card-idem',
        sessionId: 'session-001',
        rating: 'good' as const,
        mode: 'quick',
        expectedSequence: 0,
        previousStateHash: 'initial',
        resultingState: {
          schedulerVersion: 'fsrs-6',
          state: 'review' as const,
          dueAt: futureDate,
          stability: 2.5,
          difficulty: 5.0,
          elapsedDays: 1,
          scheduledDays: 3,
          reps: 1,
          lapses: 0,
        },
      };

      const result1 = await recordReviewTransaction(input); // First call
      const result2 = await recordReviewTransaction(input);

      // Same eventId, no duplicate events
      expect(result1.eventId).toBe(result2.eventId);
      const events = await db.reviewEvents.toArray();
      expect(events.length).toBe(1);
    });

    it('detects sequence conflicts', async () => {
      await db.cards.add({
        id: 'card-conflict',
        revision: 1,
        type: 'word',
        status: 'active',
        headword: { value: 'conflict', origin: 'web_page' },
        normalizedKey: 'conflict',
        explanations: [],
        examples: [],
        notes: [],
        tagIds: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      // Set up a snapshot with sequence 5
      await db.scheduleSnapshots.put({
        cardId: 'card-conflict',
        lastSequence: 5,
        state: {
          schedulerVersion: 'fsrs-6',
          state: 'review',
          dueAt: new Date().toISOString(),
          stability: 2.5,
          difficulty: 5.0,
          elapsedDays: 1,
          scheduledDays: 3,
          reps: 5,
          lapses: 0,
        },
        dueAt: new Date().toISOString(),
        stateHash: 'hash',
        schedulerVersion: 'fsrs-6',
        parameterSetId: 'fsrs-6',
      });

      // Try to record with wrong expected sequence
      await expect(
        recordReviewTransaction({
          attemptId: 'attempt-conflict',
          cardId: 'card-conflict',
          sessionId: 'session-001',
          rating: 'good',
          mode: 'quick',
          expectedSequence: 3, // Wrong! Should be 5
          previousStateHash: 'hash',
          resultingState: {
            schedulerVersion: 'fsrs-6',
            state: 'review',
            dueAt: new Date(Date.now() + 86400000).toISOString(),
            stability: 2.5,
            difficulty: 5.0,
            elapsedDays: 1,
            scheduledDays: 3,
            reps: 6,
            lapses: 0,
          },
        }),
      ).rejects.toThrow();
    });
  });

  describe('Tags', () => {
    it('creates and retrieves tags', async () => {
      const tag1 = await createOrGetTag('JavaScript');
      const tag2 = await createOrGetTag('javascript'); // Same normalized name

      expect(tag1.isNew).toBe(true);
      expect(tag2.isNew).toBe(false); // Should return existing tag
      expect(tag1.id).toBe(tag2.id);

      const tags = await getAllTags();
      expect(tags.length).toBe(1);
      expect(tags[0].name).toBe('JavaScript');
    });
  });

  describe('Migrations', () => {
    it('runs initial migration successfully', async () => {
      const status = await runMigrations();
      expect(status.phase).toBe('complete');
    });

    it('verifies invariants on empty database', async () => {
      const violations = await verifyInvariants();
      expect(violations.length).toBe(0);
    });

    it('detects invariant violations', async () => {
      // Add a card with deleted status but no deletedAt
      await db.cards.add({
        id: 'card-invalid',
        revision: 1,
        type: 'word',
        status: 'deleted',
        headword: { value: 'invalid', origin: 'web_page' },
        normalizedKey: 'invalid',
        explanations: [],
        examples: [],
        notes: [],
        tagIds: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        // Missing deletedAt!
      });

      const violations = await verifyInvariants();
      expect(violations.length).toBeGreaterThan(0);
      expect(violations[0]).toContain('deleted');
    });
  });
});
