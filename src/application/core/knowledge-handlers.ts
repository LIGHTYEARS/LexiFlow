import { messageRegistry } from '@infra/messaging/message-registry';
import { ok, fail, createError } from '@shared/protocol/envelope';
import { z } from 'zod';
import { parsePayload } from './validate-payload';
import { searchCards, rebuildSearchIndex } from '@app/search/search-index';
import { getCard, queryCards, getScheduleSnapshot, getSourcePages, getInboxItems, countCardsByStatus, countDueReviews } from '@infra/db/repository-impl';
import { db } from '@infra/db/database';
import * as tagService from '@app/tags/tag-service';
import { requireConfirmation, mintConfirmationToken } from '@app/safety/risk-policy';
import type {
  SearchResult,
  CardDetail,
  SourcePageResult,
  PageSummary,
  InboxListItem,
  SourcePageListItem,
  KnowledgeStats,
} from '@shared/protocol/protocol-map';
import type { Card } from '@domain/card/card.model';

/**
 * Knowledge & search handlers (PRD §11). Search is served by the MiniSearch
 * projection; card detail aggregates sources, tags, relations, and review state.
 */

export function registerKnowledgeHandlers(): void {
  // ── knowledge/search ──
  messageRegistry.register<unknown, SearchResult>(
    'knowledge/search',
    async (payload, envelope) => {
      const parsed = parsePayload(
        z.object({
          query: z.string(),
          filters: z
            .object({
              type: z.enum(['word', 'phrase', 'sentence', 'technical_term']).optional(),
              status: z.enum(['active', 'paused', 'archived', 'deleted']).optional(),
              tagId: z.string().optional(),
            })
            .optional(),
          cursor: z.string().optional(),
          limit: z.number().optional(),
        }),
        payload,
        envelope,
      );
      if (!parsed.ok) return parsed.result;
      const { query, filters, limit } = parsed.value;

      // Empty query → fall back to a filtered card listing (browse mode).
      if (!query.trim()) {
        const res = await queryCards({
          type: filters?.type,
          status: filters?.status,
          tagIds: filters?.tagId ? [filters.tagId] : undefined,
          limit: limit ?? 50,
          cursor: parsed.value.cursor,
        });
        return ok(envelope.requestId, {
          items: res.cards.map(cardToSearchItem),
          nextCursor: res.nextCursor,
          total: res.total,
        });
      }

      const hits = await searchCards(query, { type: filters?.type, status: filters?.status });
      const items = hits.slice(0, limit ?? 50).map((h) => ({
        cardId: h.cardId,
        headword: h.headword,
        type: h.type as SearchResult['items'][number]['type'],
        matchFields: h.matchFields,
      }));
      return ok(envelope.requestId, { items, total: hits.length });
    },
  );

  // ── knowledge/getCard ──
  messageRegistry.register<unknown, CardDetail>(
    'knowledge/getCard',
    async (payload, envelope) => {
      const parsed = parsePayload(z.object({ cardId: z.string() }), payload, envelope);
      if (!parsed.ok) return parsed.result;
      const card = await getCard(parsed.value.cardId);
      if (!card) return fail(envelope.requestId, createError('NOT_FOUND', 'Card not found', false));
      const detail = await buildCardDetail(card);
      return ok(envelope.requestId, detail);
    },
  );

  // ── knowledge/listBySource ──
  messageRegistry.register<unknown, SourcePageResult>(
    'knowledge/listBySource',
    async (payload, envelope) => {
      const parsed = parsePayload(z.object({ pageId: z.string(), limit: z.number().optional() }), payload, envelope);
      if (!parsed.ok) return parsed.result;
      const page = await db.sourcePages.get(parsed.value.pageId);
      if (!page) return fail(envelope.requestId, createError('NOT_FOUND', 'Page not found', false));
      const captures = await db.sourceCaptures.where('pageId').equals(page.id).toArray();
      const captureIds = captures.map((c) => c.id);
      const links = captureIds.length
        ? await db.cardSourceLinks.where('sourceCaptureId').anyOf(captureIds).toArray()
        : [];
      const cardIds = [...new Set(links.map((l) => l.cardId))];
      const cards = cardIds.length ? await db.cards.where('id').anyOf(cardIds).toArray() : [];
      const inboxCount = captureIds.length
        ? await db.inboxItems.where('sourceCaptureId').anyOf(captureIds).filter((i) => i.status === 'pending').count()
        : 0;
      return ok(envelope.requestId, {
        page: { id: page.id, url: page.url, title: page.title, domain: page.domain, lastCapturedAt: page.lastSeenAt },
        cards: cards.map((c) => ({
          cardId: c.id,
          headword: c.headword.value,
          type: c.type,
          role: (links.find((l) => l.cardId === c.id)?.role ?? 'origin') as 'origin' | 'additional_context' | 'example',
        })),
        inboxCount,
      });
    },
  );

  // ── knowledge/rebuildSearch ──
  messageRegistry.register<unknown, { ok: true }>(
    'knowledge/rebuildSearch',
    async (payload, envelope) => {
      const parsed = parsePayload(z.object({ reason: z.string() }), payload, envelope);
      if (!parsed.ok) return parsed.result;
      await rebuildSearchIndex();
      return ok(envelope.requestId, { ok: true });
    },
  );

  // ── knowledge/getPageSummary ──
  messageRegistry.register<unknown, PageSummary>(
    'knowledge/getPageSummary',
    async (payload, envelope) => {
      const parsed = parsePayload(z.object({ canonicalPageKey: z.string() }), payload, envelope);
      if (!parsed.ok) return parsed.result;
      const page = await db.sourcePages.get({ canonicalKey: parsed.value.canonicalPageKey });
      if (!page) {
        return ok(envelope.requestId, { pageId: '', pageUrl: '', title: '', cardCount: 0, inboxCount: 0 });
      }
      const summary = await summarizePage(page.id);
      return ok(envelope.requestId, {
        pageId: page.id,
        pageUrl: page.url,
        title: page.title,
        cardCount: summary.cardCount,
        inboxCount: summary.inboxCount,
        lastCapturedAt: page.lastSeenAt,
      });
    },
  );

  // ── knowledge/listInbox: list Inbox items with source + suggestions ──
  messageRegistry.register<unknown, { items: InboxListItem[]; nextCursor?: string }>(
    'knowledge/listInbox',
    async (payload, envelope) => {
      const parsed = parsePayload(
        z.object({ status: z.string().optional(), limit: z.number().optional(), cursor: z.string().optional() }),
        payload,
        envelope,
      );
      if (!parsed.ok) return parsed.result;
      const { items, nextCursor } = await getInboxItems({
        status: parsed.value.status ?? 'pending',
        limit: parsed.value.limit,
        cursor: parsed.value.cursor,
      });
      const list: InboxListItem[] = await Promise.all(
        items.map(async (item) => {
          const capture = await db.sourceCaptures.get(item.sourceCaptureId);
          const page = capture ? await db.sourcePages.get(capture.pageId) : undefined;
          return {
            itemId: item.id,
            status: item.status,
            selectedText: capture?.selectedText ?? '(missing capture)',
            pageTitle: page?.title,
            url: page?.url,
            createdAt: item.createdAt,
            hasFailure: !!item.failure,
            suggestions: (item.suggestions ?? []).map((s) => ({
              confidence: s.confidence,
              targetCardId: s.targetCardId,
              rationale: s.rationale,
            })),
          };
        }),
      );
      return ok(envelope.requestId, { items: list, nextCursor });
    },
  );

  // ── knowledge/listSources: all source pages with counts ──
  messageRegistry.register<unknown, { pages: SourcePageListItem[]; nextCursor?: string }>(
    'knowledge/listSources',
    async (payload, envelope) => {
      const parsed = parsePayload(z.object({ limit: z.number().optional(), cursor: z.string().optional() }), payload, envelope);
      if (!parsed.ok) return parsed.result;
      const { pages, nextCursor } = await getSourcePages({ limit: parsed.value.limit, cursor: parsed.value.cursor });
      const withInbox: SourcePageListItem[] = await Promise.all(
        pages.map(async (p) => {
          const captures = await db.sourceCaptures.where('pageId').equals(p.id).toArray();
          const captureIds = captures.map((c) => c.id);
          const inboxCount = captureIds.length
            ? await db.inboxItems.where('sourceCaptureId').anyOf(captureIds).filter((i) => i.status === 'pending').count()
            : 0;
          return {
            pageId: p.id,
            url: p.url,
            title: p.title,
            domain: p.domain,
            cardCount: p.cardCount,
            inboxCount,
            lastCapturedAt: p.lastSeenAt,
          };
        }),
      );
      return ok(envelope.requestId, { pages: withInbox, nextCursor });
    },
  );

  // ── knowledge/stats: record-traceable statistics (§11.5) ──
  messageRegistry.register<unknown, KnowledgeStats>('knowledge/stats', async (_payload, envelope) => {
    const cards = await db.cards.filter((c) => c.status !== 'deleted').toArray();
    const byType: Record<string, number> = {};
    for (const c of cards) byType[c.type] = (byType[c.type] ?? 0) + 1;
    const byStatusRaw = await countCardsByStatus();
    const dueCounts = await countDueReviews();
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const newThisWeek = cards.filter((c) => c.createdAt >= weekAgo).length;
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const reviewsToday = await db.reviewEvents.filter((e) => e.occurredAt >= todayStart.toISOString()).count();
    const anns = await db.errorAnnotations.toArray();
    const errCounts: Record<string, number> = {};
    for (const a of anns) errCounts[a.type] = (errCounts[a.type] ?? 0) + 1;
    const topErrorTypes = Object.entries(errCounts)
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);
    return ok(envelope.requestId, {
      totalCards: cards.length,
      byType,
      byStatus: { active: byStatusRaw.active, paused: byStatusRaw.paused, archived: byStatusRaw.archived },
      newThisWeek,
      reviewsToday,
      dueCounts,
      topErrorTypes,
    });
  });
}

/**
 * Register tag management handlers (PRD §11.4).
 */
export function registerTagHandlers(): void {
  messageRegistry.register<unknown, { tags: Array<{ id: string; name: string; cardCount: number }> }>(
    'tags/list',
    async (_payload, envelope) => ok(envelope.requestId, { tags: await tagService.listTags() }),
  );

  messageRegistry.register<unknown, { id: string; isNew: boolean }>('tags/create', async (payload, envelope) => {
    const parsed = parsePayload(z.object({ name: z.string() }), payload, envelope);
    if (!parsed.ok) return parsed.result;
    try {
      return ok(envelope.requestId, await tagService.createTag(parsed.value.name));
    } catch (error) {
      return failFrom(envelope.requestId, error);
    }
  });

  messageRegistry.register<unknown, { renamed: boolean }>('tags/rename', async (payload, envelope) => {
    const parsed = parsePayload(z.object({ tagId: z.string(), newName: z.string() }), payload, envelope);
    if (!parsed.ok) return parsed.result;
    try {
      return ok(envelope.requestId, await tagService.renameTag(parsed.value.tagId, parsed.value.newName));
    } catch (error) {
      return failFrom(envelope.requestId, error);
    }
  });

  messageRegistry.register<unknown, { deleted: boolean }>('tags/delete', async (payload, envelope) => {
    const parsed = parsePayload(z.object({ tagId: z.string(), confirmationToken: z.string() }), payload, envelope);
    if (!parsed.ok) return parsed.result;
    try {
      requireConfirmation('tags.bulk-modify', 'tags', parsed.value.confirmationToken);
      return ok(envelope.requestId, await tagService.deleteTag(parsed.value.tagId));
    } catch (error) {
      return failFrom(envelope.requestId, error);
    }
  });

  messageRegistry.register<unknown, { merged: boolean }>('tags/merge', async (payload, envelope) => {
    const parsed = parsePayload(
      z.object({ sourceTagId: z.string(), targetTagId: z.string(), confirmationToken: z.string() }),
      payload,
      envelope,
    );
    if (!parsed.ok) return parsed.result;
    try {
      requireConfirmation('tags.bulk-modify', 'tags', parsed.value.confirmationToken);
      return ok(envelope.requestId, await tagService.mergeTags(parsed.value.sourceTagId, parsed.value.targetTagId));
    } catch (error) {
      return failFrom(envelope.requestId, error);
    }
  });

  messageRegistry.register<unknown, { modified: number }>('tags/bulkModify', async (payload, envelope) => {
    const parsed = parsePayload(
      z.object({ cardIds: z.array(z.string()), tagId: z.string(), action: z.enum(['add', 'remove']), confirmationToken: z.string() }),
      payload,
      envelope,
    );
    if (!parsed.ok) return parsed.result;
    try {
      requireConfirmation('tags.bulk-modify', 'tags', parsed.value.confirmationToken);
      return ok(envelope.requestId, await tagService.bulkModifyTag(parsed.value.cardIds, parsed.value.tagId, parsed.value.action));
    } catch (error) {
      return failFrom(envelope.requestId, error);
    }
  });

  messageRegistry.register<unknown, { token: string }>('tags/mintConfirmation', (payload, envelope) => {
    const parsed = parsePayload(z.object({ operation: z.literal('tags.bulk-modify') }), payload, envelope);
    if (!parsed.ok) return parsed.result;
    return ok(envelope.requestId, { token: mintConfirmationToken('tags.bulk-modify', 'tags') });
  });
}

function failFrom(requestId: string, error: unknown) {
  if (error && typeof error === 'object' && 'code' in error) return fail(requestId, error as never);
  return fail(requestId, createError('INTERNAL', 'Tag operation failed', true));
}

function cardToSearchItem(card: Card): SearchResult['items'][number] {
  return { cardId: card.id, headword: card.headword.value, type: card.type, excerpt: card.explanations[0]?.value };
}

async function buildCardDetail(card: Card): Promise<CardDetail> {
  const tags = card.tagIds.length ? await db.tags.where('id').anyOf(card.tagIds).toArray() : [];
  const links = await db.cardSourceLinks.where('cardId').equals(card.id).toArray();
  const sources = await Promise.all(
    links.map(async (l) => {
      const capture = await db.sourceCaptures.get(l.sourceCaptureId);
      const page = capture ? await db.sourcePages.get(capture.pageId) : undefined;
      return { sourceCaptureId: l.sourceCaptureId, role: l.role, pageTitle: page?.title, url: page?.url };
    }),
  );
  const relations = await db.cardRelations.where('fromCardId').equals(card.id).toArray();
  const snap = await getScheduleSnapshot(card.id);
  return {
    id: card.id,
    type: card.type,
    status: card.status,
    headword: card.headword.value,
    explanations: card.explanations.map((e) => ({ value: e.value, origin: e.origin })),
    examples: card.examples.map((e) => ({ value: e.value, origin: e.origin })),
    sources,
    tags: tags.map((t) => ({ id: t.id, name: t.name })),
    relations: relations.map((r) => ({ cardId: r.toCardId, type: r.type, direction: r.direction })),
    reviewState: snap
      ? { dueAt: snap.dueAt, state: snap.state.state, stability: snap.state.stability, difficulty: snap.state.difficulty }
      : undefined,
    revision: card.revision,
    createdAt: card.createdAt,
    updatedAt: card.updatedAt,
  };
}

async function summarizePage(pageId: string): Promise<{ cardCount: number; inboxCount: number }> {
  const captures = await db.sourceCaptures.where('pageId').equals(pageId).toArray();
  const captureIds = captures.map((c) => c.id);
  if (captureIds.length === 0) return { cardCount: 0, inboxCount: 0 };
  const links = await db.cardSourceLinks.where('sourceCaptureId').anyOf(captureIds).toArray();
  const cardCount = new Set(links.map((l) => l.cardId)).size;
  const inboxCount = await db.inboxItems.where('sourceCaptureId').anyOf(captureIds).filter((i) => i.status === 'pending').count();
  return { cardCount, inboxCount };
}

export { getSourcePages };
