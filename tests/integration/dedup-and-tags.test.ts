import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '@infra/db/database';
import { computeDedupSuggestions, hasExactDuplicate } from '@app/dedup/dedup-service';
import { createCardTransaction, saveCaptureTransaction, computeContentHash } from '@infra/db/transactions';
import * as tagService from '@app/tags/tag-service';
import type { SaveCaptureInput } from '@infra/db/transactions';

const context: SaveCaptureInput['context'] = {
  pageTitle: 'Test Page',
  url: 'https://example.com/article',
  extractedAt: new Date().toISOString(),
  quality: 'full',
};

async function clearAll(): Promise<void> {
  await Promise.all(db.tables.map((t) => t.clear()));
}

beforeEach(async () => {
  await clearAll();
  (chrome.storage.local.get as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({});
});

describe('Dedup service', () => {
  it('returns no suggestions for a novel selection', async () => {
    const suggestions = await computeDedupSuggestions({
      selectedText: 'serendipity',
      contentHash: computeContentHash('serendipity'),
    });
    expect(suggestions).toHaveLength(0);
  });

  it('flags likely_same for a card with the same normalized key', async () => {
    // Create a capture + card for "ephemeral".
    const cap = await saveCaptureTransaction({
      requestId: crypto.randomUUID(),
      selectedText: 'ephemeral',
      context,
      pageUrl: context.url,
      pageTitle: context.pageTitle,
      domain: 'example.com',
      requestedAction: 'save',
    });
    await createCardTransaction({
      requestId: crypto.randomUUID(),
      type: 'word',
      headword: 'ephemeral',
      explanations: [],
      examples: [],
      sourceCaptureId: cap.captureId,
    });

    const suggestions = await computeDedupSuggestions({
      selectedText: 'Ephemeral', // different case → same normalized key
      contentHash: computeContentHash('Ephemeral'),
    });
    expect(suggestions.length).toBeGreaterThan(0);
    expect(['likely_same', 'exact']).toContain(suggestions[0].confidence);
  });

  it('detects an exact duplicate when the same content is captured from the same page', async () => {
    const cap = await saveCaptureTransaction({
      requestId: crypto.randomUUID(),
      selectedText: 'idempotent',
      context,
      pageUrl: context.url,
      pageTitle: context.pageTitle,
      domain: 'example.com',
      requestedAction: 'save',
    });
    const capture = await db.sourceCaptures.get(cap.captureId);
    await createCardTransaction({
      requestId: crypto.randomUUID(),
      type: 'word',
      headword: 'idempotent',
      explanations: [],
      examples: [],
      sourceCaptureId: cap.captureId,
    });

    const suggestions = await computeDedupSuggestions({
      selectedText: 'idempotent',
      contentHash: capture!.contentHash,
      pageId: capture!.pageId,
    });
    expect(hasExactDuplicate(suggestions)).toBeDefined();
  });
});

describe('Tag service', () => {
  it('creates, renames, and lists tags with card counts', async () => {
    const { id } = await tagService.createTag('grammar');
    let tags = await tagService.listTags();
    expect(tags.find((t) => t.id === id)?.name).toBe('grammar');

    await tagService.renameTag(id, 'syntax');
    tags = await tagService.listTags();
    expect(tags.find((t) => t.id === id)?.name).toBe('syntax');
  });

  it('deletes a tag without deleting its cards (§11.4)', async () => {
    const { id: tagId } = await tagService.createTag('temp');
    const cap = await saveCaptureTransaction({
      requestId: crypto.randomUUID(),
      selectedText: 'cohesion',
      context,
      pageUrl: context.url,
      pageTitle: context.pageTitle,
      domain: 'example.com',
      requestedAction: 'save',
    });
    const card = await createCardTransaction({
      requestId: crypto.randomUUID(),
      type: 'word',
      headword: 'cohesion',
      explanations: [],
      examples: [],
      sourceCaptureId: cap.captureId,
      tagIds: [tagId],
    });

    await tagService.deleteTag(tagId);
    const stillThere = await db.cards.get(card.id);
    expect(stillThere).toBeDefined();
    expect(stillThere!.tagIds).not.toContain(tagId);
  });

  it('merges tags, re-pointing cards and preserving them', async () => {
    const { id: a } = await tagService.createTag('js');
    const { id: b } = await tagService.createTag('javascript');
    const cap = await saveCaptureTransaction({
      requestId: crypto.randomUUID(),
      selectedText: 'closure',
      context,
      pageUrl: context.url,
      pageTitle: context.pageTitle,
      domain: 'example.com',
      requestedAction: 'save',
    });
    const card = await createCardTransaction({
      requestId: crypto.randomUUID(),
      type: 'word',
      headword: 'closure',
      explanations: [],
      examples: [],
      sourceCaptureId: cap.captureId,
      tagIds: [a],
    });

    await tagService.mergeTags(a, b);
    const updated = await db.cards.get(card.id);
    expect(updated!.tagIds).toContain(b);
    expect(updated!.tagIds).not.toContain(a);
    expect(await db.tags.get(a)).toBeUndefined();
  });
});
