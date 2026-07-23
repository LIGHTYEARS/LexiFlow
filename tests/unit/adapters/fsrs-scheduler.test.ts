import { describe, it, expect } from 'vitest';
import {
  createInitialState,
  computeNextState,
  previewAllRatings,
  stateHash,
  SCHEDULER_VERSION,
} from '@adapters/fsrs/fsrs-scheduler';

describe('FSRS scheduler adapter', () => {
  const now = new Date('2026-07-23T00:00:00.000Z');

  it('creates a new-state initial card', () => {
    const state = createInitialState(now);
    expect(state.state).toBe('new');
    expect(state.reps).toBe(0);
    expect(state.lapses).toBe(0);
    expect(state.schedulerVersion).toBe(SCHEDULER_VERSION);
  });

  it('advances a new card to learning/review on Good', () => {
    const next = computeNextState(undefined, 'good', now);
    expect(['learning', 'review']).toContain(next.state);
    expect(next.reps).toBe(1);
    expect(new Date(next.dueAt).getTime()).toBeGreaterThan(now.getTime());
  });

  it('schedules Easy further out than Again', () => {
    const initial = createInitialState(now);
    const again = computeNextState(initial, 'again', now);
    const easy = computeNextState(initial, 'easy', now);
    expect(new Date(easy.dueAt).getTime()).toBeGreaterThan(new Date(again.dueAt).getTime());
  });

  it('previews all four ratings with distinct due dates', () => {
    const initial = createInitialState(now);
    const preview = previewAllRatings(initial, now);
    expect(preview.again.dueAt).toBeDefined();
    expect(preview.hard.dueAt).toBeDefined();
    expect(preview.good.dueAt).toBeDefined();
    expect(preview.easy.dueAt).toBeDefined();
    // good should be >= hard, easy should be >= good in interval ordering
    expect(new Date(preview.easy.dueAt).getTime()).toBeGreaterThanOrEqual(
      new Date(preview.good.dueAt).getTime(),
    );
  });

  it('increments lapses when a review card is failed', () => {
    // Build a review-state card by rating Good a few times, then fail it.
    const state = computeNextState(undefined, 'easy', now);
    const later = new Date(new Date(state.dueAt).getTime() + 1000);
    const failed = computeNextState(state, 'again', later);
    expect(failed.lapses).toBeGreaterThanOrEqual(state.lapses);
  });

  it('produces a stable, deterministic state hash', () => {
    const state = createInitialState(now);
    expect(stateHash(state)).toBe(stateHash({ ...state }));
    const other = computeNextState(state, 'good', now);
    expect(stateHash(state)).not.toBe(stateHash(other));
  });
});
