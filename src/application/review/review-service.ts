import { db } from '@infra/db/database';
import { getSettings } from '@infra/storage/settings-gateway';
import { recordReviewTransaction } from '@infra/db/transactions';
import { getScheduleSnapshot } from '@infra/db/repository-impl';
import {
  computeNextState,
  createInitialState,
  stateHash,
} from '@adapters/fsrs/fsrs-scheduler';
import { enqueueSearchUpsert } from '@app/search/search-index';
import { nowIso } from '@shared/utils/date';
import type { ReviewRating } from '@domain/review/review.model';
import type { ErrorType } from '@domain/error/error.model';
import type {
  ReviewSession,
  ReviewItem,
  ReviewReveal,
  RatingPreview,
  ReviewCommitResult,
  CreateReviewSessionCommand,
  ReviewMode,
} from '@shared/protocol/protocol-map';

/**
 * ReviewService — builds today's queue, serves items, and commits ratings via
 * the FSRS scheduler and the append-only review transaction.
 * See PRD §6.3, §12.1-12.4 and technical-design/08 §6-7.
 */

interface QueuedItem {
  cardId: string;
  attemptId: string;
  priority: 'overdue' | 'due' | 'learning' | 'new';
  mode: ReviewMode;
}

interface Session {
  sessionId: string;
  queue: QueuedItem[];
  cursor: number;
  dueCounts: { overdue: number; due: number; learning: number; new: number };
}

const sessions = new Map<string, Session>();
// attemptId → cardId lookup, so reveal/commit can find the card.
const attemptIndex = new Map<string, { cardId: string; sessionId: string }>();

/**
 * Build today's review queue ordered by PRD §12.1 priority:
 * overdue → due today → learning/relearning → new (within daily caps).
 */
export async function createSession(cmd: CreateReviewSessionCommand): Promise<ReviewSession> {
  const settings = await getSettings();
  const now = new Date();
  const nowMs = now.getTime();
  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);
  const endOfDayMs = endOfDay.getTime();

  const maxReview = cmd.limits?.maxReview ?? settings.review.dailyReviewLimit;
  const maxNew = cmd.limits?.maxNew ?? settings.review.dailyNewLimit;
  const defaultMode = (cmd.modes?.[0] ?? settings.review.defaultReviewMode) as ReviewMode;

  const snapshots = await db.scheduleSnapshots.toArray();
  const overdue: QueuedItem[] = [];
  const due: QueuedItem[] = [];
  const learning: QueuedItem[] = [];

  for (const snap of snapshots) {
    const dueMs = new Date(snap.dueAt).getTime();
    const item: QueuedItem = {
      cardId: snap.cardId,
      attemptId: crypto.randomUUID(),
      priority: 'due',
      mode: defaultMode,
    };
    if (snap.state.state === 'learning' || snap.state.state === 'relearning') {
      item.priority = 'learning';
      if (dueMs <= endOfDayMs) learning.push(item);
    } else if (dueMs < nowMs) {
      item.priority = 'overdue';
      overdue.push(item);
    } else if (dueMs <= endOfDayMs) {
      item.priority = 'due';
      due.push(item);
    }
  }

  // Optionally prioritize harder cards (higher difficulty) within each tier.
  if (settings.review.prioritizeHard) {
    const diffOf = async (cardId: string) => (await getScheduleSnapshot(cardId))?.state.difficulty ?? 0;
    // Sort synchronously using a difficulty map to avoid await-in-sort.
    const diffMap = new Map<string, number>();
    for (const snap of snapshots) diffMap.set(snap.cardId, snap.state.difficulty);
    const byDiff = (a: QueuedItem, b: QueuedItem) => (diffMap.get(b.cardId) ?? 0) - (diffMap.get(a.cardId) ?? 0);
    overdue.sort(byDiff);
    due.sort(byDiff);
    void diffOf;
  } else {
    // Order overdue by how overdue they are (most overdue first).
    const dueAtMap = new Map(snapshots.map((s) => [s.cardId, new Date(s.dueAt).getTime()]));
    overdue.sort((a, b) => (dueAtMap.get(a.cardId) ?? 0) - (dueAtMap.get(b.cardId) ?? 0));
  }

  let queue = [...overdue, ...due, ...learning].slice(0, maxReview);

  // New cards: only cards with no schedule snapshot yet, within maxNew.
  const scheduledIds = new Set(snapshots.map((s) => s.cardId));
  const newCards = await db.cards
    .filter((c) => c.status === 'active' && !scheduledIds.has(c.id))
    .limit(maxNew)
    .toArray();
  const newItems: QueuedItem[] = newCards.map((c) => ({
    cardId: c.id,
    attemptId: crypto.randomUUID(),
    priority: 'new',
    mode: defaultMode,
  }));
  queue = [...queue, ...newItems];

  const sessionId = crypto.randomUUID();
  const dueCounts = {
    overdue: overdue.length,
    due: due.length,
    learning: learning.length,
    new: newItems.length,
  };
  const session: Session = { sessionId, queue, cursor: 0, dueCounts };
  sessions.set(sessionId, session);
  for (const item of queue) {
    attemptIndex.set(item.attemptId, { cardId: item.cardId, sessionId });
  }

  // Persist the session record.
  await db.reviewSessions.add({
    id: sessionId,
    status: 'active',
    startedAt: nowIso(),
    config: { maxNew, maxReview, modes: cmd.modes },
  });

  return { sessionId, dueCounts };
}

export async function nextItem(sessionId: string): Promise<ReviewItem | null> {
  const session = sessions.get(sessionId);
  if (!session) return null;
  if (session.cursor >= session.queue.length) return null;
  const item = session.queue[session.cursor];
  session.cursor += 1;
  const card = await db.cards.get(item.cardId);
  if (!card) return nextItem(sessionId);
  return {
    attemptId: item.attemptId,
    cardId: item.cardId,
    prompt: buildPrompt(card.headword.value, item.mode),
    mode: item.mode,
  };
}

function buildPrompt(headword: string, mode: ReviewMode): string {
  switch (mode) {
    case 'input':
      return `Type the meaning or usage of: ${headword}`;
    case 'cloze':
      return `Fill in the blank using: ${headword}`;
    case 'imitation':
      return `Write your own sentence modeled on: ${headword}`;
    case 'distinction':
      return `Explain how ${headword} differs from similar expressions`;
    default:
      return `Recall the meaning of: ${headword}`;
  }
}

export async function reveal(attemptId: string): Promise<ReviewReveal> {
  const ref = attemptIndex.get(attemptId);
  if (!ref) throw new Error('Attempt not found');
  const card = await db.cards.get(ref.cardId);
  const answer = card
    ? [card.explanations[0]?.value, card.examples[0]?.value].filter(Boolean).join(' — ')
    : '';
  // Provide the origin context if available.
  const links = card ? await db.cardSourceLinks.where('cardId').equals(card.id).toArray() : [];
  let context: ReviewReveal['context'];
  if (links[0]) {
    const capture = await db.sourceCaptures.get(links[0].sourceCaptureId);
    if (capture) {
      const page = await db.sourcePages.get(capture.pageId);
      context = {
        sentenceContaining: capture.context.sentenceContaining,
        paragraphExcerpt: capture.context.paragraphExcerpt,
        pageTitle: page?.title,
        url: page?.url,
      };
    }
  }
  return { attemptId, answer: answer || '(no explanation yet)', context };
}

export async function previewRating(attemptId: string, rating: ReviewRating): Promise<RatingPreview> {
  const ref = attemptIndex.get(attemptId);
  if (!ref) throw new Error('Attempt not found');
  const settings = await getSettings();
  const current = await getScheduleSnapshot(ref.cardId);
  const next = computeNextState(current?.state, rating, new Date(), settings);
  return { rating, nextDueAt: next.dueAt, state: next.state };
}

export async function commitRating(
  attemptId: string,
  rating: ReviewRating,
  _expectedSequence: number,
  answer?: string,
  durationMs?: number,
  confirmedErrorTypes?: ErrorType[],
): Promise<ReviewCommitResult> {
  const ref = attemptIndex.get(attemptId);
  if (!ref) throw new Error('Attempt not found');
  const settings = await getSettings();
  const current = await getScheduleSnapshot(ref.cardId);
  const currentState = current?.state ?? createInitialState();
  const resultingState = computeNextState(current?.state, rating, new Date(), settings);

  const mode = sessionModeFor(ref.sessionId, attemptId);

  // Derive the expected sequence server-side from the current snapshot rather
  // than trusting the client — the transaction still guards against a
  // concurrent review via optimistic concurrency.
  const expectedSequence = current?.lastSequence ?? 0;

  const result = await recordReviewTransaction({
    attemptId,
    cardId: ref.cardId,
    sessionId: ref.sessionId,
    rating,
    mode,
    expectedSequence,
    previousStateHash: stateHash(currentState),
    resultingState,
    answer,
    durationMs,
    confirmedErrorTypes,
  });

  await enqueueSearchUpsert(ref.cardId);

  return { eventId: result.eventId, nextDueAt: result.nextDueAt, state: resultingState.state };
}

function sessionModeFor(sessionId: string, attemptId: string): string {
  const session = sessions.get(sessionId);
  const item = session?.queue.find((q) => q.attemptId === attemptId);
  return item?.mode ?? 'quick';
}
