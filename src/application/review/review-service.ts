import { db } from '@infra/db/database';
import { recordReviewTransaction } from '@infra/db/transactions';
import { calculateNextState, createInitialFsrsState, previewRating, Rating, Grade, SCHEDULER_VERSION } from './fsrs-scheduler-adapter';
import { nowIso } from '@shared/utils/date';
import { createError } from '@shared/protocol/envelope';
import type { AppError } from '@shared/protocol/envelope';
import type { FsrsStateDto, ReviewRating } from '@domain/review/review.model';

/**
 * ReviewService — orchestrates the review session lifecycle.
 * See PRD §12.1-12.4 and technical-design/08 §4.
 */

export interface ReviewSession {
  sessionId: string;
  dueCounts: { overdue: number; due: number; learning: number; new: number };
  cardQueue: string[];
  currentIndex: number;
}

const activeSessions = new Map<string, ReviewSession>();

/**
 * Create a new review session.
 * Orders cards per PRD §12.1: overdue → due → learning/relearning → new (within daily limit).
 */
export async function createReviewSession(
  limits?: { maxNew?: number; maxReview?: number },
): Promise<ReviewSession> {
  const sessionId = crypto.randomUUID();
  const now = nowIso();
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayIso = todayStart.toISOString();

  // Get all snapshots
  const allSnapshots = await db.scheduleSnapshots.toArray();

  const overdue: string[] = [];
  const due: string[] = [];
  const learning: string[] = [];
  const newCards: string[] = [];

  for (const snap of allSnapshots) {
    // Skip cards that are paused/archived/deleted
    const card = await db.cards.get(snap.cardId);
    if (!card || card.status !== 'active') continue;

    if (snap.state.state === 'new') {
      newCards.push(snap.cardId);
    } else if (snap.state.state === 'learning' || snap.state.state === 'relearning') {
      learning.push(snap.cardId);
      if (snap.dueAt <= now) due.push(snap.cardId);
    } else if (snap.dueAt < todayIso) {
      overdue.push(snap.cardId);
    } else if (snap.dueAt <= now) {
      due.push(snap.cardId);
    }
  }

  // Build queue per PRD §12.1 priority
  const maxNew = limits?.maxNew ?? 20;
  const maxReview = limits?.maxReview ?? 200;

  const queue: string[] = [];
  queue.push(...overdue);
  queue.push(...due.filter((id) => !overdue.includes(id)));
  queue.push(...learning);
  queue.push(...newCards.slice(0, maxNew));

  // Limit total
  const limitedQueue = queue.slice(0, maxReview);

  const session: ReviewSession = {
    sessionId,
    dueCounts: {
      overdue: overdue.length,
      due: due.length,
      learning: learning.length,
      new: Math.min(newCards.length, maxNew),
    },
    cardQueue: limitedQueue,
    currentIndex: 0,
  };

  activeSessions.set(sessionId, session);

  // Record session in DB
  await db.reviewSessions.add({
    id: sessionId,
    status: 'active',
    startedAt: now,
    config: { maxNew, maxReview },
  });

  return session;
}

/**
 * Get the next card to review in the session.
 */
export async function getNextReviewItem(
  sessionId: string,
): Promise<{ attemptId: string; cardId: string; prompt: string; mode: 'quick' } | null> {
  const session = activeSessions.get(sessionId);
  if (!session) {
    throw createError('NOT_FOUND', 'Review session not found', false);
  }
  if (session.currentIndex >= session.cardQueue.length) {
    return null;
  }

  const cardId = session.cardQueue[session.currentIndex];
  const card = await db.cards.get(cardId);
  if (!card) {
    session.currentIndex++;
    return getNextReviewItem(sessionId);
  }

  const attemptId = crypto.randomUUID();

  // Build prompt from card headword
  const prompt = card.headword.value;

  return { attemptId, cardId, prompt, mode: 'quick' as const };
}

/**
 * Reveal the answer for the current card.
 */
export async function revealAnswer(
  sessionId: string,
  cardId: string,
  attemptId: string,
): Promise<{ answer: string; context?: { sentenceContaining?: string; pageTitle?: string; url?: string } }> {
  const card = await db.cards.get(cardId);
  if (!card) {
    throw createError('NOT_FOUND', 'Card not found', false);
  }

  // Build answer from explanations
  const answer = card.explanations.map((e) => e.value).join('; ') || card.headword.value;

  // Get source context
  let context: { sentenceContaining?: string; pageTitle?: string; url?: string } | undefined;
  const links = await db.cardSourceLinks.where('cardId').equals(cardId).toArray();
  if (links.length > 0) {
    const capture = await db.sourceCaptures.get(links[0].sourceCaptureId);
    if (capture) {
      context = {
        sentenceContaining: capture.context.sentenceContaining,
        pageTitle: capture.context.pageTitle,
        url: capture.context.url,
      };
    }
  }

  return { answer, context };
}

/**
 * Preview the next due date for a rating without committing.
 */
export async function previewReviewRating(
  cardId: string,
  rating: ReviewRating,
): Promise<{ rating: ReviewRating; nextDueAt: string; state: 'new' | 'learning' | 'review' | 'relearning' }> {
  const snapshot = await db.scheduleSnapshots.get(cardId);
  if (!snapshot) {
    // No snapshot yet — create initial state
    const initial = createInitialFsrsState();
    const preview = previewRating(initial);
    const fsrsRating = ratingToFsrsRating(rating);
    return {
      rating,
      nextDueAt: preview[fsrsRating].nextDueAt,
      state: preview[fsrsRating].state.state,
    };
  }

  const preview = previewRating(snapshot.state);
  const fsrsRating = ratingToFsrsRating(rating);
  return {
    rating,
    nextDueAt: preview[fsrsRating].nextDueAt,
    state: preview[fsrsRating].state.state,
  };
}

/**
 * Commit a review rating.
 * Advances the session to the next card.
 */
export async function commitReviewRating(
  sessionId: string,
  attemptId: string,
  cardId: string,
  rating: ReviewRating,
): Promise<{ eventId: string; nextDueAt: string; state: 'new' | 'learning' | 'review' | 'relearning' }> {
  const session = activeSessions.get(sessionId);
  if (!session) {
    throw createError('NOT_FOUND', 'Review session not found', false);
  }

  // Get current snapshot or create initial
  let currentState: FsrsStateDto;
  let expectedSequence = 0;
  const snapshot = await db.scheduleSnapshots.get(cardId);
  if (snapshot) {
    currentState = snapshot.state;
    expectedSequence = snapshot.lastSequence;
  } else {
    currentState = createInitialFsrsState();
  }

  // Calculate next state
  const fsrsRating = ratingToFsrsRating(rating);
  const nextState = calculateNextState(currentState, fsrsRating);

  // Record the review
  const result = await recordReviewTransaction({
    attemptId,
    cardId,
    sessionId,
    rating,
    mode: 'quick',
    expectedSequence,
    previousStateHash: '',
    resultingState: nextState,
  });

  // Advance session
  session.currentIndex++;

  return {
    eventId: result.eventId,
    nextDueAt: result.nextDueAt,
    state: result.state as 'new' | 'learning' | 'review' | 'relearning',
  };
}

function ratingToFsrsRating(rating: ReviewRating): Grade {
  switch (rating) {
    case 'again': return Rating.Again;
    case 'hard': return Rating.Hard;
    case 'good': return Rating.Good;
    case 'easy': return Rating.Easy;
    default: return Rating.Good;
  }
}

export { SCHEDULER_VERSION };
