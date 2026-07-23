import MiniSearch from 'minisearch';
import { db } from '@infra/db/database';
import type { Card } from '@domain/card/card.model';

/**
 * SearchService — wraps MiniSearch for full-text card search.
 * Builds an in-memory index from all active cards.
 * See technical-design/07 §7 and PRD §11.1.
 */

interface SearchDocument {
  id: string;
  headword: string;
  type: string;
  explanations: string;
  examples: string;
  notes: string;
  tags: string;
  updatedAt: string;
}

let miniSearch: MiniSearch<SearchDocument> | null = null;
let indexBuilt = false;

/**
 * Build or rebuild the search index from all active cards.
 */
export async function rebuildSearchIndex(): Promise<void> {
  const cards = await db.cards.toArray();
  const activeCards = cards.filter((c) => c.status !== 'deleted');

  const documents: SearchDocument[] = activeCards.map((card) => ({
    id: card.id,
    headword: card.headword.value,
    type: card.type,
    explanations: card.explanations.map((e) => e.value).join(' '),
    examples: card.examples.map((e) => e.value).join(' '),
    notes: card.notes.map((n) => n.value).join(' '),
    tags: card.tagIds.join(' '),
    updatedAt: card.updatedAt,
  }));

  miniSearch = new MiniSearch({
    fields: ['headword', 'explanations', 'examples', 'notes', 'tags'],
    storeFields: ['headword', 'type', 'updatedAt'],
    searchOptions: {
      boost: { headword: 3, explanations: 2 },
      fuzzy: 0.2,
      prefix: true,
    },
  });

  if (documents.length > 0) {
    miniSearch.addAll(documents);
  }
  indexBuilt = true;
}

/**
 * Ensure the index is built (lazy initialization).
 */
async function ensureIndex(): Promise<void> {
  if (!indexBuilt) {
    await rebuildSearchIndex();
  }
}

/**
 * Search cards by text query.
 * Returns matching card IDs with scores.
 */
export async function searchCards(
  query: string,
  filters?: { type?: string; status?: string; tagId?: string },
  limit = 50,
): Promise<{ cardId: string; headword: string; type: string; score: number }[]> {
  await ensureIndex();
  if (!miniSearch) return [];

  if (!query.trim()) {
    // No query — return all cards sorted by updatedAt
    const cards = await db.cards.toArray();
    const filtered = cards
      .filter((c) => c.status !== 'deleted')
      .filter((c) => !filters?.type || c.type === filters.type)
      .filter((c) => !filters?.status || c.status === filters.status)
      .filter((c) => !filters?.tagId || c.tagIds.includes(filters.tagId))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, limit);
    return filtered.map((c) => ({
      cardId: c.id,
      headword: c.headword.value,
      type: c.type,
      score: 0,
    }));
  }

  const results = miniSearch.search(query, {
    fuzzy: 0.2,
    prefix: true,
    boost: { headword: 3, explanations: 2 },
  });

  // Apply filters
  const filtered = results.filter((r) => {
    if (filters?.type && r.type !== filters.type) return false;
    return true;
  });

  return filtered.slice(0, limit).map((r) => ({
    cardId: r.id,
    headword: r.headword,
    type: r.type,
    score: r.score,
  }));
}

/**
 * Add or update a card in the search index.
 */
export async function indexCard(card: Card): Promise<void> {
  await ensureIndex();
  if (!miniSearch) return;

  const doc: SearchDocument = {
    id: card.id,
    headword: card.headword.value,
    type: card.type,
    explanations: card.explanations.map((e) => e.value).join(' '),
    examples: card.examples.map((e) => e.value).join(' '),
    notes: card.notes.map((n) => n.value).join(' '),
    tags: card.tagIds.join(' '),
    updatedAt: card.updatedAt,
  };

  try {
    miniSearch.add(doc);
  } catch {
    // Document may already exist — replace it
    miniSearch.discard(card.id);
    miniSearch.add(doc);
  }
}

/**
 * Remove a card from the search index.
 */
export async function removeCardFromIndex(cardId: string): Promise<void> {
  await ensureIndex();
  if (!miniSearch) return;
  try {
    miniSearch.discard(cardId);
  } catch {
    // Not in index — ignore
  }
}
