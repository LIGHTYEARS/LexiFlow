import { fsrs, createEmptyCard, Rating, State, Grade } from 'ts-fsrs';
import type { Card as FsrsCard, RecordLogItem } from 'ts-fsrs';
import type { FsrsStateDto } from '@domain/review/review.model';

/**
 * FsrsSchedulerAdapter — wraps ts-fsrs to produce FsrsStateDto objects.
 * This is the ONLY component that performs FSRS math.
 * See technical-design/08 §4 (FsrsSchedulerAdapter) and PRD §12.1.
 */

const SCHEDULER_VERSION = 'fsrs-6';
const fsrsInstance = fsrs();

/** Valid review grades (excludes Manual). */
const GRADES: Grade[] = [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy];

/**
 * Create an initial FSRS state for a new card.
 */
export function createInitialFsrsState(): FsrsStateDto {
  const card = createEmptyCard(new Date());
  return cardToStateDto(card);
}

/**
 * Preview the next state for each rating without committing.
 */
export function previewRating(
  currentState: FsrsStateDto,
  now: Date = new Date(),
): Record<Grade, { state: FsrsStateDto; nextDueAt: string }> {
  const card = stateDtoToCard(currentState);
  const recordLog = fsrsInstance.repeat(card, now);

  const result = {} as Record<Grade, { state: FsrsStateDto; nextDueAt: string }>;
  for (const grade of GRADES) {
    const item: RecordLogItem = recordLog[grade];
    result[grade] = {
      state: cardToStateDto(item.card),
      nextDueAt: item.card.due.toISOString(),
    };
  }
  return result;
}

/**
 * Calculate the next FSRS state for a given rating.
 */
export function calculateNextState(
  currentState: FsrsStateDto,
  rating: Grade,
  now: Date = new Date(),
): FsrsStateDto {
  const card = stateDtoToCard(currentState);
  const recordLog = fsrsInstance.repeat(card, now);
  const item = recordLog[rating];
  return cardToStateDto(item.card);
}

/**
 * Convert an FsrsStateDto to a ts-fsrs Card.
 */
function stateDtoToCard(dto: FsrsStateDto): FsrsCard {
  return {
    due: new Date(dto.dueAt),
    stability: dto.stability,
    difficulty: dto.difficulty,
    elapsed_days: dto.elapsedDays,
    scheduled_days: dto.scheduledDays,
    reps: dto.reps,
    lapses: dto.lapses,
    state: stateStringToEnum(dto.state),
    last_review: dto.lastReviewedAt ? new Date(dto.lastReviewedAt) : undefined,
    learning_steps: 0,
  };
}

/**
 * Convert a ts-fsrs Card to an FsrsStateDto.
 */
function cardToStateDto(card: FsrsCard): FsrsStateDto {
  return {
    schedulerVersion: SCHEDULER_VERSION,
    state: stateEnumToString(card.state),
    dueAt: card.due.toISOString(),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsedDays: card.elapsed_days,
    scheduledDays: card.scheduled_days,
    reps: card.reps,
    lapses: card.lapses,
    lastReviewedAt: card.last_review ? card.last_review.toISOString() : undefined,
  };
}

function stateStringToEnum(state: FsrsStateDto['state']): State {
  switch (state) {
    case 'new': return State.New;
    case 'learning': return State.Learning;
    case 'review': return State.Review;
    case 'relearning': return State.Relearning;
    default: return State.New;
  }
}

function stateEnumToString(state: State): FsrsStateDto['state'] {
  switch (state) {
    case State.New: return 'new';
    case State.Learning: return 'learning';
    case State.Review: return 'review';
    case State.Relearning: return 'relearning';
    default: return 'new';
  }
}

export { Rating, State, SCHEDULER_VERSION };
export type { Grade };
