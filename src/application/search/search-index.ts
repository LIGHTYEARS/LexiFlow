import MiniSearch from 'minisearch';
import { db } from '@infra/db/database';
import type { Card } from '@domain/card/card.model';

/**
 * Search projection (technical-design/07 §1, §3-D1, §7).
 *
 * MiniSearch is a Dexie-derived, rebuildable projection. Writes go through an
 * outbox (`searchOutbox`) so the index can be rebuilt deterministically after
 * an MV3 worker restart or a "rebuild search" request. The index is lazily
 * built from the cards table on first use and kept warm in the worker.
 *
 * Indexed fields (PRD §11.1): headword, explanations, examples, notes, tags,
 * source page title/url. We flatten a card into a search document here.
 */

export interface SearchDoc {
  id: string;
  headword: string;
  explanations: string;
  examples: string;
  notes: string;
  tags: string;
  source: string;
  type: string;
  status: string;
}

let indexPromise: Promise<MiniSearch<SearchDoc>> | null = null;

function createIndex(): MiniSearch<SearchDoc> {
  return new MiniSearch<SearchDoc>({
    fields: ['headword', 'explanations', 'examples', 'notes', 'tags', 'source'],
    storeFields: ['headword', 'type', 'status'],
    searchOptions: { boost: { headword: 3, tags: 2 }, prefix: true, fuzzy: 0.2 },
  });
}

async function buildDoc(card: Card): Promise<SearchDoc> {
  // Tag names.
  const tags = card.tagIds.length
    ? (await db.tags.where('id').anyOf(card.tagIds).toArray()).map((t) => t.name).join(' ')
    : '';
  // Source page titles/urls linked to this card.
  const links = await db.cardSourceLinks.where('cardId').equals(card.id).toArray();
  let source = '';
  if (links.length) {
    const captureIds = links.map((l) => l.sourceCaptureId);
    const captures = await db.sourceCaptures.where('id').anyOf(captureIds).toArray();
    const pageIds = [...new Set(captures.map((c) => c.pageId))];
    const pages = await db.sourcePages.where('id').anyOf(pageIds).toArray();
    source = pages.map((p) => `${p.title} ${p.url} ${p.domain}`).join(' ');
  }
  return {
    id: card.id,
    headword: card.headword.value,
    explanations: card.explanations.map((e) => e.value).join(' '),
    examples: card.examples.map((e) => e.value).join(' '),
    notes: card.notes.map((n) => n.value).join(' '),
    tags,
    source,
    type: card.type,
    status: card.status,
  };
}

/**
 * Get (building if needed) the warm MiniSearch index over active/paused cards.
 */
export async function getSearchIndex(): Promise<MiniSearch<SearchDoc>> {
  if (!indexPromise) {
    indexPromise = (async () => {
      const index = createIndex();
      const cards = await db.cards.filter((c) => c.status !== 'deleted').toArray();
      const docs = await Promise.all(cards.map(buildDoc));
      index.addAll(docs);
      return index;
    })();
  }
  return indexPromise;
}

/**
 * Enqueue a card upsert into the outbox and update the warm index if present.
 */
export async function enqueueSearchUpsert(cardId: string): Promise<void> {
  await db.searchOutbox.add({
    sequence: undefined as unknown as number, // ++sequence auto-increments
    entityId: cardId,
    operation: 'upsert',
    entityType: 'card',
    createdAt: new Date().toISOString(),
  });
  if (indexPromise) {
    const index = await indexPromise;
    const card = await db.cards.get(cardId);
    if (card && card.status !== 'deleted') {
      const doc = await buildDoc(card);
      if (index.has(cardId)) index.replace(doc);
      else index.add(doc);
    } else if (index.has(cardId)) {
      index.discard(cardId);
    }
  }
}

/**
 * Enqueue a delete and remove from the warm index.
 */
export async function enqueueSearchDelete(cardId: string): Promise<void> {
  await db.searchOutbox.add({
    sequence: undefined as unknown as number,
    entityId: cardId,
    operation: 'delete',
    entityType: 'card',
    createdAt: new Date().toISOString(),
  });
  if (indexPromise) {
    const index = await indexPromise;
    if (index.has(cardId)) index.discard(cardId);
  }
}

/**
 * Rebuild the index from scratch (PRD §14.5 "rebuild search").
 */
export async function rebuildSearchIndex(): Promise<{ ok: true }> {
  indexPromise = null;
  await db.searchOutbox.clear();
  await getSearchIndex();
  return { ok: true };
}

export interface SearchHit {
  cardId: string;
  headword: string;
  type: string;
  matchFields: string[];
}

/**
 * Search the index. Filtering by type/status is applied post-hoc so it stays
 * consistent with the stored fields.
 */
export async function searchCards(
  query: string,
  filter?: { type?: string; status?: string },
): Promise<SearchHit[]> {
  const index = await getSearchIndex();
  const results = index.search(query, {
    filter: (r) => {
      if (filter?.type && r.type !== filter.type) return false;
      if (filter?.status && r.status !== filter.status) return false;
      return true;
    },
  });
  return results.map((r) => ({
    cardId: r.id as string,
    headword: (r as unknown as { headword: string }).headword,
    type: (r as unknown as { type: string }).type,
    matchFields: Object.keys(r.match ?? {}),
  }));
}
