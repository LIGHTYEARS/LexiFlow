import {
  fsrs,
  createEmptyCard,
  generatorParameters,
  Rating,
  State,
  type Grade,
  type Card as FsrsCard,
  type FSRS,
} from 'ts-fsrs';
import type { FsrsStateDto } from '@domain/review/review.model';
import type { ReviewRating } from '@domain/review/review.model';
import type { UserSettings } from '@infra/storage/settings-schema';

/**
 * FsrsSchedulerAdapter — the ONLY wrapper around ts-fsrs (technical-design/08
 * §4, §D1). Converts between our persisted FsrsStateDto and the library's Card
 * instance, and computes the resulting state for a given rating.
 *
 * We never serialize the library's class instance directly; we store the DTO
 * (§04 §5.5).
 */

export const SCHEDULER_VERSION = 'fsrs-6';

const STATE_TO_DTO: Record<number, FsrsStateDto['state']> = {
  [State.New]: 'new',
  [State.Learning]: 'learning',
  [State.Review]: 'review',
  [State.Relearning]: 'relearning',
};

const RATING_MAP: Record<ReviewRating, Grade> = {
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
  easy: Rating.Easy,
};

function makeScheduler(settings?: UserSettings): FSRS {
  const params = generatorParameters({
    enable_fuzz: true,
    ...(settings?.review.fsrsRequestRetention
      ? { request_retention: settings.review.fsrsRequestRetention }
      : {}),
    ...(settings?.review.fsrsMaximumInterval
      ? { maximum_interval: settings.review.fsrsMaximumInterval }
      : {}),
  });
  return fsrs(params);
}

function dtoToFsrsCard(dto: FsrsStateDto): FsrsCard {
  const stateNum =
    dto.state === 'new'
      ? State.New
      : dto.state === 'learning'
        ? State.Learning
        : dto.state === 'review'
          ? State.Review
          : State.Relearning;
  return {
    due: new Date(dto.dueAt),
    stability: dto.stability,
    difficulty: dto.difficulty,
    elapsed_days: dto.elapsedDays,
    scheduled_days: dto.scheduledDays,
    reps: dto.reps,
    lapses: dto.lapses,
    learning_steps: 0,
    state: stateNum,
    last_review: dto.lastReviewedAt ? new Date(dto.lastReviewedAt) : undefined,
  };
}

function fsrsCardToDto(card: FsrsCard): FsrsStateDto {
  return {
    schedulerVersion: SCHEDULER_VERSION,
    state: STATE_TO_DTO[card.state],
    dueAt: new Date(card.due).toISOString(),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsedDays: card.elapsed_days,
    scheduledDays: card.scheduled_days,
    reps: card.reps,
    lapses: card.lapses,
    lastReviewedAt: card.last_review ? new Date(card.last_review).toISOString() : undefined,
  };
}

/**
 * Create the initial state for a brand-new card (never reviewed).
 */
export function createInitialState(now: Date = new Date()): FsrsStateDto {
  return fsrsCardToDto(createEmptyCard(now));
}

/**
 * Compute the next state for a rating without committing. Used by both the
 * commit path and the "preview rating" path (§12.1, review/previewRating).
 */
export function computeNextState(
  current: FsrsStateDto | undefined,
  rating: ReviewRating,
  now: Date = new Date(),
  settings?: UserSettings,
): FsrsStateDto {
  const scheduler = makeScheduler(settings);
  const card = current ? dtoToFsrsCard(current) : createEmptyCard(now);
  const scheduling = scheduler.repeat(card, now);
  const next = scheduling[RATING_MAP[rating]].card;
  return fsrsCardToDto(next);
}

/**
 * Preview next-due for all four ratings (for the review UI).
 */
export function previewAllRatings(
  current: FsrsStateDto | undefined,
  now: Date = new Date(),
  settings?: UserSettings,
): Record<ReviewRating, FsrsStateDto> {
  return {
    again: computeNextState(current, 'again', now, settings),
    hard: computeNextState(current, 'hard', now, settings),
    good: computeNextState(current, 'good', now, settings),
    easy: computeNextState(current, 'easy', now, settings),
  };
}

/**
 * Deterministic hash of an FSRS state, for optimistic-concurrency checks.
 */
export function stateHash(state: FsrsStateDto): string {
  const str = JSON.stringify({
    dueAt: state.dueAt,
    stability: state.stability,
    difficulty: state.difficulty,
    state: state.state,
    reps: state.reps,
    lapses: state.lapses,
  });
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}
