import { describe, it, expect } from 'vitest';
import { nowIso, parseIso, isDue, formatDuration } from '@shared/utils/date';

describe('nowIso', () => {
  it('returns valid ISO string', () => {
    const iso = nowIso();
    expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(parseIso(iso)).not.toBeNull();
  });
});

describe('parseIso', () => {
  it('parses valid ISO', () => {
    const d = parseIso('2026-07-18T12:00:00.000Z');
    expect(d).not.toBeNull();
    expect(d!.getUTCFullYear()).toBe(2026);
  });

  it('returns null for invalid', () => {
    expect(parseIso('not-a-date')).toBeNull();
  });
});

describe('isDue', () => {
  it('returns true for past dates', () => {
    expect(isDue('2020-01-01T00:00:00.000Z')).toBe(true);
  });

  it('returns false for future dates', () => {
    expect(isDue('2099-01-01T00:00:00.000Z')).toBe(false);
  });

  it('throws for invalid', () => {
    expect(() => isDue('invalid')).toThrow();
  });
});

describe('formatDuration', () => {
  it('formats milliseconds', () => {
    expect(formatDuration(500)).toBe('500ms');
  });

  it('formats seconds', () => {
    expect(formatDuration(2500)).toBe('2.5s');
  });

  it('formats minutes', () => {
    expect(formatDuration(125000)).toBe('2m 5s');
  });
});
