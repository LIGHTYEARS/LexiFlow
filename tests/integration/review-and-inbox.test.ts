import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '@infra/db/database';
import { createCardTransaction, saveCaptureTransaction } from '@infra/db/transactions';
import * as reviewService from '@app/review/review-service';
import * as inboxService from '@app/inbox/inbox-service';
import type { SaveCaptureInput } from '@infra/db/transactions';

const context: SaveCaptureInput['context'] = {
  pageTitle: 'Test',
  url: 'https://example.com/x',
  extractedAt: new Date().toISOString(),
  quality: 'full',
};

async function clearAll(): Promise<void> {
  await Promise.all(db.tables.map((t) => t.clear()));
}

async function makeCard(headword: string): Promise<string> {
  const cap = await saveCaptureTransaction({
    requestId: crypto.randomUUID(),
    selectedText: headword,
    context,
    pageUrl: context.url,
    pageTitle: context.pageTitle,
    domain: 'example.com',
    requestedAction: 'save',
  });
  const card = await createCardTransaction({
    requestId: crypto.randomUUID(),
    type: 'word',
    headword,
    explanations: [{ value: `${headword} means something`, origin: 'model' }],
    examples: [],
    sourceCaptureId: cap.captureId,
  });
  return card.id;
}

beforeEach(async () => {
  await clearAll();
  (chrome.storage.local.get as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({});
});

describe('Review flow (FSRS end to end)', () => {
  it('creates a session with a new card, serves it, and commits a rating that schedules next-due', async () => {
    await makeCard('perspicacious');

    const session = await reviewService.createSession({});
    expect(session.dueCounts.new).toBe(1);

    const item = await reviewService.nextItem(session.sessionId);
    expect(item).not.toBeNull();
    expect(item!.cardId).toBeDefined();

    const reveal = await reviewService.reveal(item!.attemptId);
    expect(reveal.answer).toContain('means something');

    const preview = await reviewService.previewRating(item!.attemptId, 'good');
    expect(preview.nextDueAt).toBeDefined();

    const result = await reviewService.commitRating(item!.attemptId, 'good', 0);
    expect(result.eventId).toBeDefined();

    // A schedule snapshot now exists and history is persisted (survives restart).
    const snap = await db.scheduleSnapshots.get(item!.cardId);
    expect(snap).toBeDefined();
    const events = await db.reviewEvents.where('cardId').equals(item!.cardId).toArray();
    expect(events).toHaveLength(1);
    expect(events[0].rating).toBe('good');
  });

  it('records confirmed error types into errorAnnotations', async () => {
    await makeCard('recalcitrant');
    const session = await reviewService.createSession({});
    const item = await reviewService.nextItem(session.sessionId);
    await reviewService.commitRating(item!.attemptId, 'again', 0, undefined, undefined, ['forgot_meaning']);
    const anns = await db.errorAnnotations.where('cardId').equals(item!.cardId).toArray();
    expect(anns.some((a) => a.type === 'forgot_meaning')).toBe(true);
  });
});

describe('Inbox batch apply + undo', () => {
  it('promotes inbox items to cards and can undo the batch', async () => {
    // Two captures land in the Inbox.
    const cap1 = await saveCaptureTransaction({
      requestId: crypto.randomUUID(),
      selectedText: 'lucid',
      context,
      pageUrl: context.url,
      pageTitle: context.pageTitle,
      domain: 'example.com',
      requestedAction: 'save-to-inbox',
    });
    const item1 = await db.inboxItems.where('sourceCaptureId').equals(cap1.captureId).first();
    // Give it a draft so promotion creates a meaningful card.
    await db.inboxItems.update(item1!.id, { draft: { type: 'word', headword: 'lucid' } });

    const preview = await inboxService.previewBatch([item1!.id], 'save');
    expect(preview.items).toHaveLength(1);

    const result = await inboxService.applyBatch(preview.previewId);
    expect(result.results[0].success).toBe(true);
    const cardId = result.results[0].cardId!;
    expect(await db.cards.get(cardId)).toBeDefined();

    // Undo removes the created card and restores the inbox item.
    const undo = await inboxService.undoBatch(result.batchId);
    expect(undo.reverted).toBe(true);
    expect(await db.cards.get(cardId)).toBeUndefined();
    const restored = await db.inboxItems.get(item1!.id);
    expect(restored!.status).toBe('pending');
  });
});
