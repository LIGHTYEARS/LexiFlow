import { describe, it, expect } from 'vitest';
import { CardSchema } from '@domain/card/card.model';
import { SourceCaptureSchema } from '@domain/source/source.model';
import { InboxItemSchema } from '@domain/inbox/inbox.model';
import { ReviewEventSchema } from '@domain/review/review.model';
import { TagSchema, CardRelationSchema } from '@domain/tag/tag.model';

describe('Domain Schema Validation', () => {
  describe('CardSchema', () => {
    // Intentionally untyped: verifies schema accepts valid data from untyped inputs
    it('accepts a valid card', () => {
      const card = {
        id: crypto.randomUUID(),
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
      };
      expect(CardSchema.safeParse(card).success).toBe(true);
    });

    it('rejects missing required fields', () => {
      const result = CardSchema.safeParse({ id: '123' });
      expect(result.success).toBe(false);
    });

    it('rejects invalid card type', () => {
      const card = {
        id: crypto.randomUUID(),
        revision: 1,
        type: 'invalid_type',
        status: 'active',
        headword: { value: 'test', origin: 'web_page' },
        normalizedKey: 'test',
        explanations: [],
        examples: [],
        notes: [],
        tagIds: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      expect(CardSchema.safeParse(card).success).toBe(false);
    });
  });

  describe('SourceCaptureSchema', () => {
    // Intentionally untyped: verifies schema accepts valid data from untyped inputs
    it('accepts a valid capture', () => {
      const capture = {
        id: crypto.randomUUID(),
        pageId: crypto.randomUUID(),
        selectedText: 'test selection',
        context: {
          pageTitle: 'Test Page',
          url: 'https://example.com',
          extractedAt: new Date().toISOString(),
          quality: 'selection_only',
        },
        capturedAt: new Date().toISOString(),
        contentHash: 'abc123',
        captureRequestId: crypto.randomUUID(),
      };
      expect(SourceCaptureSchema.safeParse(capture).success).toBe(true);
    });
  });

  describe('InboxItemSchema', () => {
    // Intentionally untyped: verifies schema accepts valid data from untyped inputs
    it('accepts a valid inbox item', () => {
      const item = {
        id: crypto.randomUUID(),
        revision: 1,
        status: 'pending',
        sourceCaptureId: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      expect(InboxItemSchema.safeParse(item).success).toBe(true);
    });
  });

  describe('ReviewEventSchema', () => {
    // Intentionally untyped: verifies schema accepts valid data from untyped inputs
    it('accepts a valid review event', () => {
      const event = {
        eventId: crypto.randomUUID(),
        cardId: crypto.randomUUID(),
        sequence: 1,
        sessionId: crypto.randomUUID(),
        attemptId: crypto.randomUUID(),
        occurredAt: new Date().toISOString(),
        rating: 'good',
        previousStateHash: 'hash123',
        resultingState: {
          schedulerVersion: 'fsrs-6',
          state: 'review',
          dueAt: new Date().toISOString(),
          stability: 2.5,
          difficulty: 5.0,
          elapsedDays: 1,
          scheduledDays: 3,
          reps: 2,
          lapses: 0,
        },
        mode: 'quick',
        source: 'review',
      };
      expect(ReviewEventSchema.safeParse(event).success).toBe(true);
    });
  });

  describe('TagSchema', () => {
    // Intentionally untyped: verifies schema accepts valid data from untyped inputs
    it('accepts a valid tag', () => {
      const tag = {
        id: crypto.randomUUID(),
        name: 'JavaScript',
        normalizedName: 'javascript',
        revision: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      expect(TagSchema.safeParse(tag).success).toBe(true);
    });
  });

  describe('CardRelationSchema', () => {
    // Intentionally untyped: verifies schema accepts valid data from untyped inputs
    it('accepts a valid relation', () => {
      const relation = {
        id: crypto.randomUUID(),
        fromCardId: crypto.randomUUID(),
        toCardId: crypto.randomUUID(),
        type: 'synonym',
        direction: 'symmetric',
        origin: 'user',
        createdAt: new Date().toISOString(),
      };
      expect(CardRelationSchema.safeParse(relation).success).toBe(true);
    });
  });
});
