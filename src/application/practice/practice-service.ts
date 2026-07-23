import { db } from '@infra/db/database';
import { getSettings } from '@infra/storage/settings-gateway';
import { recordReviewTransaction } from '@infra/db/transactions';
import { getScheduleSnapshot } from '@infra/db/repository-impl';
import { computeNextState, createInitialState, stateHash } from '@adapters/fsrs/fsrs-scheduler';
import { nowIso } from '@shared/utils/date';
import { createError } from '@shared/protocol/envelope';
import type { PracticeItemRecord } from '@infra/db/database';
import type { ReviewRating } from '@domain/review/review.model';
import type { FsrsImpactPreview } from '@shared/protocol/protocol-map';

/**
 * PracticeService — generates targeted practice from errors/difficult cards/
 * tags/manual selection and records attempts (PRD §12.5). The 8 confirmed forms
 * (§12.5) are represented by `PracticeType`. By default practice does NOT affect
 * FSRS; only an explicit, previewed, confirmed opt-in does (§12.5, §19.6).
 */

export type PracticeType =
  | 'zh-to-en'
  | 'en-to-zh'
  | 'cloze'
  | 'multiple-choice'
  | 'synonym-distinction'
  | 'imitation'
  | 'term-explanation'
  | 'error-replay';

export type PracticeSource =
  | { type: 'errors'; errorTypes?: string[] }
  | { type: 'difficult' }
  | { type: 'tag'; tagId: string }
  | { type: 'manual'; cardIds: string[] };

/**
 * Select source cards for a practice session.
 */
async function selectSourceCards(source: PracticeSource): Promise<string[]> {
  switch (source.type) {
    case 'manual':
      return source.cardIds;
    case 'tag': {
      const cards = await db.cards.filter((c) => c.status === 'active' && c.tagIds.includes(source.tagId)).toArray();
      return cards.map((c) => c.id);
    }
    case 'errors': {
      const anns = await db.errorAnnotations.toArray();
      const filtered = source.errorTypes?.length
        ? anns.filter((a) => source.errorTypes!.includes(a.type))
        : anns;
      return [...new Set(filtered.map((a) => a.cardId))];
    }
    case 'difficult': {
      const snaps = await db.scheduleSnapshots.toArray();
      return snaps
        .filter((s) => s.state.difficulty >= 6 || s.state.lapses >= 2)
        .map((s) => s.cardId);
    }
  }
}

/**
 * Generate a practice session with rule-based items for the given cards + type.
 * (Model-generated items can be layered on later via the AI coordinator; the
 * rule path guarantees at least one working form for §19.6.)
 */
export async function generateSession(
  source: PracticeSource,
  practiceType: PracticeType,
): Promise<{ sessionId: string; itemCount: number }> {
  const cardIds = (await selectSourceCards(source)).slice(0, 20);
  if (cardIds.length === 0) {
    throw createError('NOT_FOUND', 'No cards match this practice source', false);
  }
  const cards = await db.cards.where('id').anyOf(cardIds).toArray();

  const sessionId = crypto.randomUUID();
  await db.practiceSessions.add({
    id: sessionId,
    status: 'active',
    source: { type: source.type, cardIds, errorIds: [] },
    blueprint: { itemCount: cards.length, types: [practiceType] },
    affectsFsrs: false,
    startedAt: nowIso(),
  });

  const items: PracticeItemRecord[] = cards.map((card) => {
    const answer = card.explanations[0]?.value ?? card.headword.value;
    let prompt: string;
    let choices: string[] | undefined;
    switch (practiceType) {
      case 'zh-to-en':
        prompt = `Translate to English: ${card.explanations[0]?.value ?? card.headword.value}`;
        break;
      case 'en-to-zh':
        prompt = `What does "${card.headword.value}" mean (in Chinese)?`;
        break;
      case 'cloze':
        prompt = `Fill the blank with the right word: ___ (hint: ${card.explanations[0]?.value ?? ''})`;
        break;
      case 'multiple-choice':
        prompt = `Which is the correct meaning of "${card.headword.value}"?`;
        choices = [answer, 'Distractor A', 'Distractor B'];
        break;
      case 'synonym-distinction':
        prompt = `Explain how "${card.headword.value}" differs from similar expressions.`;
        break;
      case 'imitation':
        prompt = `Write a sentence using "${card.headword.value}".`;
        break;
      case 'term-explanation':
        prompt = `Explain the technical term "${card.headword.value}".`;
        break;
      case 'error-replay':
        prompt = `Retry: ${card.headword.value}`;
        break;
    }
    return {
      id: crypto.randomUUID(),
      sessionId,
      type: practiceType,
      cardIds: [card.id],
      prompt,
      acceptAnswers: [answer],
      explanation: card.explanations.map((e) => e.value).join(' '),
      choices,
      source: 'rule',
    } as PracticeItemRecord & { choices?: string[] };
  });
  await db.practiceItems.bulkAdd(items);

  return { sessionId, itemCount: items.length };
}

/**
 * Get a practice session's items for display (prompts, choices, explanations).
 */
export async function getSessionItems(
  sessionId: string,
): Promise<Array<{ itemId: string; type: string; prompt: string; explanation?: string; choices?: string[] }>> {
  const items = await db.practiceItems.where('sessionId').equals(sessionId).toArray();
  return items.map((i) => ({
    itemId: i.id,
    type: i.type,
    prompt: i.prompt,
    explanation: i.explanation,
    choices: (i as PracticeItemRecord & { choices?: string[] }).choices,
  }));
}

/**
 * Record a practice attempt. Never touches FSRS (§12.5 default).
 */
export async function recordAttempt(
  itemId: string,
  userAnswer: string,
  outcome: 'correct' | 'incorrect' | 'partial' | 'skipped',
  fsrsRating?: ReviewRating,
): Promise<{ attemptId: string }> {
  const item = await db.practiceItems.get(itemId);
  if (!item) throw createError('NOT_FOUND', 'Practice item not found', false);
  const attemptId = crypto.randomUUID();
  await db.practiceAttempts.add({
    id: attemptId,
    itemId,
    sessionId: item.sessionId,
    userAnswer,
    outcome,
    fsrsRating,
    createdAt: nowIso(),
  });
  return { attemptId };
}

/**
 * Preview the FSRS impact of applying practice attempts to scheduling (§19.6).
 * Shows current vs new due dates before anything is committed.
 */
export async function previewFsrsImpact(practiceAttemptIds: string[]): Promise<FsrsImpactPreview> {
  const previewId = crypto.randomUUID();
  const impacts: FsrsImpactPreview['impacts'] = [];
  const settings = await getSettings();
  for (const attemptId of practiceAttemptIds) {
    const attempt = await db.practiceAttempts.get(attemptId);
    if (!attempt || !attempt.fsrsRating) continue;
    const item = await db.practiceItems.get(attempt.itemId);
    const cardId = item?.cardIds[0];
    if (!cardId) continue;
    const snap = await getScheduleSnapshot(cardId);
    const next = computeNextState(snap?.state, attempt.fsrsRating, new Date(), settings);
    impacts.push({
      cardId,
      currentDueAt: snap?.dueAt ?? nowIso(),
      newDueAt: next.dueAt,
      rating: attempt.fsrsRating,
    });
  }
  pendingImpacts.set(previewId, practiceAttemptIds);
  return { previewId, impacts, summary: `${impacts.length} card(s) would be rescheduled.` };
}

const pendingImpacts = new Map<string, string[]>();

/**
 * Commit a previously previewed FSRS impact. Requires the user to have opted in
 * (settings.review.allowPracticeAffectsFsrs) AND a valid confirmation, enforced
 * at the handler layer. Writes review events with source='practice-confirmed'.
 */
export async function commitFsrsImpact(previewId: string): Promise<{ committed: boolean }> {
  const attemptIds = pendingImpacts.get(previewId);
  if (!attemptIds) throw createError('NOT_FOUND', 'Impact preview expired', false);
  pendingImpacts.delete(previewId);
  const settings = await getSettings();

  for (const attemptId of attemptIds) {
    const attempt = await db.practiceAttempts.get(attemptId);
    if (!attempt || !attempt.fsrsRating) continue;
    const item = await db.practiceItems.get(attempt.itemId);
    const cardId = item?.cardIds[0];
    if (!cardId) continue;
    const snap = await getScheduleSnapshot(cardId);
    const currentState = snap?.state ?? createInitialState();
    const resultingState = computeNextState(snap?.state, attempt.fsrsRating, new Date(), settings);
    await recordReviewTransaction({
      attemptId,
      cardId,
      sessionId: item!.sessionId,
      rating: attempt.fsrsRating,
      mode: 'quick',
      expectedSequence: snap?.lastSequence ?? 0,
      previousStateHash: stateHash(currentState),
      resultingState,
      source: 'practice-confirmed',
    });
  }
  return { committed: true };
}
